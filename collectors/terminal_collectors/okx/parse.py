"""Analyse des messages WebSocket publics OKX en événements normalisés.

Les champs et unités ont été vérifiés dans la doc v5 puis sur des messages
réels (collectors/tests/fixtures/, enregistrés par scripts/explore_okx.py) :

- trades : `tradeId` est le DERNIER identifiant d'un agrégat de `count` trades
  (même ordre preneur, même prix). `sz` est en contrats, pas en BTC.
- tickers : `volCcy24h` est en devise de base (BTC) pour un perpétuel ;
  `sodUtc0` est le prix d'ouverture du jour UTC ; `open24h` celui d'il y a 24 h.
- funding-rate : `fundingTime` est la PROCHAINE échéance, `prevFundingTime`
  la précédente ; l'écart des deux donne la période (8 h sur BTC-USDT-SWAP).
- open-interest : `oiCcy` en BTC, `oiUsd` en dollars.
- candle* : tableau [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] ;
  `ts` est l'ouverture de la bougie ; volCcyQuote / volCcy est le prix moyen
  exact des trades de la bougie, ce qui permet un VWAP sans approximation.

Chaque événement porte `ts_source` (heure OKX, ms) quand la source en donne
une, et `ts_recv` (heure de réception locale, ms).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Control:
    """Réponse de contrôle (abonnement, erreur, notice) ou pong."""

    event: str
    raw: dict[str, Any]


def _f(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _i(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _trade(d: dict, recv: int) -> dict:
    return {
        "kind": "trade",
        "inst": d["instId"],
        "trade_id": int(d["tradeId"]),
        "count": int(d.get("count") or 1),
        "px": float(d["px"]),
        "sz": float(d["sz"]),
        "side": d["side"],
        "ts_source": int(d["ts"]),
        "ts_recv": recv,
    }


def _ticker(d: dict, recv: int) -> dict:
    return {
        "kind": "ticker",
        "inst": d["instId"],
        "last": float(d["last"]),
        "bid": _f(d.get("bidPx")),
        "ask": _f(d.get("askPx")),
        "open24h": _f(d.get("open24h")),
        "high24h": _f(d.get("high24h")),
        "low24h": _f(d.get("low24h")),
        "sod_utc0": _f(d.get("sodUtc0")),
        "vol_base24h": _f(d.get("volCcy24h")),
        "ts_source": int(d["ts"]),
        "ts_recv": recv,
    }


def _funding(d: dict, recv: int) -> dict:
    nxt = _i(d.get("fundingTime"))
    prev = _i(d.get("prevFundingTime"))
    return {
        "kind": "funding",
        "inst": d["instId"],
        "rate": float(d["fundingRate"]),
        "funding_time": nxt,
        "prev_funding_time": prev,
        "interval_ms": (nxt - prev) if nxt and prev else None,
        "ts_source": int(d["ts"]),
        "ts_recv": recv,
    }


def _open_interest(d: dict, recv: int) -> dict:
    return {
        "kind": "open_interest",
        "inst": d["instId"],
        "oi_base": _f(d.get("oiCcy")),
        "oi_usd": _f(d.get("oiUsd")),
        "ts_source": int(d["ts"]),
        "ts_recv": recv,
    }


def candle_from_row(inst: str, bar: str, row: list[str], recv: int | None = None) -> dict:
    """Bougie OKX (REST ou WebSocket, même tableau) en dictionnaire."""
    return {
        "kind": "candle",
        "inst": inst,
        "bar": bar,
        "t": int(row[0]),
        "o": float(row[1]),
        "h": float(row[2]),
        "l": float(row[3]),
        "c": float(row[4]),
        "vol_base": float(row[6]),
        "vol_quote": float(row[7]),
        "confirmed": row[8] == "1",
        "ts_recv": recv,
    }


_PARSERS = {
    "trades": _trade,
    "tickers": _ticker,
    "funding-rate": _funding,
    "open-interest": _open_interest,
}


def parse(raw: str, recv_ms: int) -> list[dict] | Control:
    """Analyse un message brut. Retourne des événements ou un contrôle."""
    if raw == "pong":
        return Control("pong", {})
    msg = json.loads(raw)
    if "event" in msg:
        return Control(msg["event"], msg)
    arg = msg.get("arg") or {}
    channel = arg.get("channel", "")
    data = msg.get("data") or []
    if channel.startswith("candle"):
        bar = channel.removeprefix("candle")
        return [candle_from_row(arg["instId"], bar, row, recv_ms) for row in data]
    parser = _PARSERS.get(channel)
    if parser is None:
        return Control("unknown", msg)
    return [parser(d, recv_ms) for d in data]
