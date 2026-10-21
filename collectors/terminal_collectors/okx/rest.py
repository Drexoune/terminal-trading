"""REST public OKX : instruments, bougies, heure du serveur.

Limites vérifiées dans la doc v5 :
- GET /api/v5/market/candles : 40 requêtes / 2 s par IP, 300 bougies par
  requête au plus, seulement les 1 440 dernières bougies de chaque taille ;
  pagination vers le passé avec `after` (enregistrements antérieurs à ts).
- GET /api/v5/public/instruments : paramètres de contrat (ctVal, lotSz…),
  lus au démarrage, jamais codés en dur.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import httpx

from .parse import candle_from_row

CANDLES_PER_REQUEST = 300
CANDLES_MAX = 1440
MIN_SPACING_S = 2.0 / 40  # 40 requêtes / 2 s


class OkxError(RuntimeError):
    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code      # code OKX (« 51001 » : instrument inexistant), si connu


# Instrument inexistant : inutile de redemander.
UNKNOWN_INSTRUMENT = "51001"


@dataclass(frozen=True)
class ClockSample:
    offset_ms: float      # heure OKX - heure locale
    rtt_ms: float         # aller-retour ; l'incertitude de l'écart vaut rtt / 2


class OkxRest:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(base_url=base_url, timeout=10)
        self._lock = asyncio.Lock()
        self._last_call = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict | None = None) -> list:
        async with self._lock:  # espacement minimal entre deux appels
            wait = self._last_call + MIN_SPACING_S - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()
        r = await self._client.get(path, params=params)
        if r.status_code == 429:
            raise OkxError(f"limite de débit OKX atteinte sur {path}")
        r.raise_for_status()
        body = r.json()
        if body.get("code") != "0":
            raise OkxError(f"{path} : code {body.get('code')} {body.get('msg')}",
                           code=str(body.get("code")))
        return body["data"]

    async def instrument(self, inst_id: str, inst_type: str = "SWAP") -> dict:
        data = await self._get("/api/v5/public/instruments",
                               {"instType": inst_type, "instId": inst_id})
        if not data:
            raise OkxError(f"instrument introuvable : {inst_id}", code=UNKNOWN_INSTRUMENT)
        d = data[0]
        return {
            "inst": d["instId"],
            "ct_val": float(d["ctVal"]),
            "ct_val_ccy": d["ctValCcy"],
            "ct_type": d["ctType"],
            "lot_sz": float(d["lotSz"]),
            "min_sz": float(d["minSz"]),
            "tick_sz": float(d["tickSz"]),
            "settle_ccy": d["settleCcy"],
            "state": d["state"],
        }

    async def candles(self, inst_id: str, bar: str, since_ms: int | None = None,
                      max_count: int = CANDLES_MAX) -> list[dict]:
        """Bougies de `since_ms` à maintenant, de la plus ancienne à la plus récente."""
        out: list[dict] = []
        after: int | None = None
        while len(out) < max_count:
            params = {"instId": inst_id, "bar": bar,
                      "limit": str(min(CANDLES_PER_REQUEST, max_count - len(out)))}
            if after is not None:
                params["after"] = str(after)
            rows = await self._get("/api/v5/market/candles", params)
            if not rows:
                break
            batch = [candle_from_row(inst_id, bar, row) for row in rows]
            out.extend(c for c in batch if since_ms is None or c["t"] >= since_ms)
            oldest = batch[-1]["t"]
            if since_ms is not None and oldest <= since_ms:
                break
            after = oldest
        out.sort(key=lambda c: c["t"])
        return out

    async def clock_sample(self) -> ClockSample:
        t0 = time.time_ns() / 1e6
        data = await self._get("/api/v5/public/time")
        t1 = time.time_ns() / 1e6
        server = int(data[0]["ts"])
        return ClockSample(offset_ms=server - (t0 + t1) / 2, rtt_ms=t1 - t0)


def best_sample(samples: list[ClockSample]) -> ClockSample | None:
    """L'échantillon au plus court aller-retour est le moins incertain (méthode NTP)."""
    return min(samples, key=lambda s: s.rtt_ms) if samples else None
