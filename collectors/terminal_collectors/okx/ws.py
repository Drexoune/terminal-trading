"""Connexion WebSocket OKX robuste : maintien en vie, reconnexion, journal des coupures.

Règles OKX v5 (section « Connect », vérifiées dans la doc) :
- la connexion est coupée si aucune donnée n'est poussée pendant 30 s ;
- maintien en vie : après N < 30 s sans message, envoyer la chaîne 'ping'
  et attendre 'pong' dans les N secondes, sinon reconnecter ;
- au plus 3 connexions par seconde et par IP, et 480 abonnements par heure et
  par connexion : la reconnexion attend donc au moins 1 s, avec un délai
  croissant plafonné.

Abonnement refusé (code 60018, instrument ou canal inexistant) : OKX répond
pour chaque argument séparément, garde la connexion ouverte et sert les autres
abonnements (observé sur wseea le 21/10/2026, message recopié dans
collectors/tests/test_ws.py). Le refus est donc mis de côté et affiché, sans
couper le reste du flux.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import ssl
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import certifi
import websockets

from .parse import Control, parse

log = logging.getLogger(__name__)

KEEPALIVE_S = 20.0      # N < 30 s, cf. doc OKX
BACKOFF_MIN_S = 1.0     # 3 connexions/s/IP au maximum
BACKOFF_MAX_S = 30.0
OUTAGES_KEPT = 50       # historique borné : la passerelle tourne des semaines
OUTAGES_SHOWN = 10



def ssl_context() -> ssl.SSLContext:
    """Même magasin de certificats que httpx pour le REST : SSL_CERT_FILE ou
    SSL_CERT_DIR s'ils sont définis (proxy d'entreprise), sinon certifi.

    Sans cela, le Python de python.org pour macOS n'utilise pas le magasin du
    système tant que « Install Certificates » n'a pas été lancé : le REST
    marcherait et wss:// échouerait seul.
    """
    if os.environ.get("SSL_CERT_FILE"):
        return ssl.create_default_context(cafile=os.environ["SSL_CERT_FILE"])
    if os.environ.get("SSL_CERT_DIR"):
        return ssl.create_default_context(capath=os.environ["SSL_CERT_DIR"])
    return ssl.create_default_context(cafile=certifi.where())

# « Subscribe failed, wrong URL or channel:tickers,instId:FOO-USDT-SWAP doesn't exist. »
_REJECTED = re.compile(r"channel:([^,\s]+),instId:(\S+) doesn't exist")


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def backoff_delay(attempt: int, rng: random.Random | None = None) -> float:
    """Délai avant la tentative `attempt` (1, 2, 3…) : exponentiel, plafonné, avec gigue."""
    base = min(BACKOFF_MAX_S, BACKOFF_MIN_S * 2 ** (attempt - 1))
    jitter = (rng or random).uniform(0, base * 0.25)
    return min(BACKOFF_MAX_S, base + jitter)


@dataclass
class FeedState:
    """État d'un flux, exposé à l'écran (statut de flux) et à /api/health."""

    name: str
    status: str = "connecting"          # connecting | connected | reconnecting | stopped
    connected_since_ms: int | None = None
    last_message_ms: int | None = None
    reconnects: int = 0
    outages: deque[dict] = field(default_factory=lambda: deque(maxlen=OUTAGES_KEPT))
    last_error: str | None = None
    # Abonnements refusés par OKX (« trades FOO-USDT-SWAP ») : plus redemandés.
    rejected: list[str] = field(default_factory=list)

    def snapshot(self) -> dict:
        return {
            "name": self.name,
            "status": self.status,
            "connected_since_ms": self.connected_since_ms,
            "last_message_ms": self.last_message_ms,
            "reconnects": self.reconnects,
            "outages": list(self.outages)[-OUTAGES_SHOWN:],
            "last_error": self.last_error,
            "rejected": list(self.rejected),
        }


EventSink = Callable[[list[dict]], Awaitable[None] | None]
StateSink = Callable[[FeedState], Awaitable[None] | None]


class OkxStream:
    """Une connexion OKX (publique ou business) et ses abonnements."""

    def __init__(self, name: str, url: str, args: list[dict], on_events: EventSink,
                 on_state: StateSink | None = None, connect=websockets.connect) -> None:
        self.name = name
        self.url = url
        self.args = list(args)
        self.on_events = on_events
        self.on_state = on_state
        self.state = FeedState(name)
        self._connect = connect
        self._stop = asyncio.Event()
        self._down_since_ms: int | None = None
        # Échecs consécutifs depuis la dernière donnée reçue : remis à zéro à la
        # première donnée d'une connexion, sinon le délai resterait au plafond
        # pour toujours. Pas à la simple confirmation d'abonnement : une
        # connexion qui confirme puis tombe aussitôt doit voir le délai grandir.
        self._attempt = 0

    def stop(self) -> None:
        self._stop.set()

    async def _emit_state(self) -> None:
        if self.on_state:
            res = self.on_state(self.state)
            if asyncio.iscoroutine(res):
                await res

    async def run(self) -> None:
        while not self._stop.is_set():
            try:
                await self._session()
            except asyncio.CancelledError:
                raise
            except ssl.SSLCertVerificationError as exc:
                self.state.last_error = (f"certificat refusé ({exc.verify_message}) : "
                                         "magasin de certificats à vérifier (certifi)")
                log.error("%s : %s", self.name, self.state.last_error)
            except Exception as exc:  # réseau, protocole, requête refusée
                self.state.last_error = f"{type(exc).__name__}: {exc}"
                log.warning("%s : connexion perdue (%s)", self.name, self.state.last_error)
            if self._stop.is_set():
                break
            self._attempt += 1
            self.state.reconnects += 1
            self.state.status = "reconnecting"
            self.state.connected_since_ms = None
            if self._down_since_ms is None:
                self._down_since_ms = now_ms()
            await self._emit_state()
            delay = backoff_delay(self._attempt)
            log.info("%s : reconnexion dans %.1f s (tentative %d)", self.name, delay,
                     self._attempt)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            except TimeoutError:
                pass
        self.state.status = "stopped"
        await self._emit_state()

    async def _session(self) -> None:
        # ssl seulement pour wss:// : websockets le refuse avec ws:// (tests locaux).
        tls = {"ssl": ssl_context()} if self.url.startswith("wss://") else {}
        async with self._connect(self.url, ping_interval=None, open_timeout=10,
                                 close_timeout=2, max_queue=4096, **tls) as ws:
            await ws.send(json.dumps({"id": "sub", "op": "subscribe", "args": self.args}))
            pending_pong = False
            while not self._stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=KEEPALIVE_S)
                except TimeoutError:
                    if pending_pong:
                        raise ConnectionError(f"pas de pong en {KEEPALIVE_S:.0f} s") from None
                    await ws.send("ping")
                    pending_pong = True
                    continue
                pending_pong = False
                recv = now_ms()
                self.state.last_message_ms = recv
                result = parse(raw, recv)
                if isinstance(result, Control):
                    await self._on_control(result, recv)
                    continue
                if result:
                    self._attempt = 0
                    res = self.on_events(result)
                    if asyncio.iscoroutine(res):
                        await res

    async def _on_control(self, ctl: Control, recv: int) -> None:
        if ctl.event == "error":
            if self._reject(ctl):
                return
            raise ConnectionError(f"OKX a refusé la requête : {ctl.raw.get('code')} "
                                  f"{ctl.raw.get('msg')}")
        if ctl.event == "subscribe" and self.state.status != "connected":
            self.state.status = "connected"
            self.state.connected_since_ms = recv
            self.state.last_error = None
            if self._down_since_ms is not None:
                outage = {"from_ms": self._down_since_ms, "to_ms": recv,
                          "duration_ms": recv - self._down_since_ms}
                self.state.outages.append(outage)
                log.warning("%s : coupure de %.1f s refermée", self.name,
                            outage["duration_ms"] / 1000)
                self._down_since_ms = None
            await self._emit_state()
        elif ctl.event == "notice":
            # OKX prévient avant une maintenance : on journalise, la
            # reconnexion se fera d'elle-même à la coupure.
            log.warning("%s : notice OKX %s", self.name, ctl.raw.get("msg"))

    def _reject(self, ctl: Control) -> bool:
        """Refus 60018 d'un abonnement précis : on l'écarte et le flux continue.

        Faux si le refus ne désigne aucun abonnement connu : la connexion est
        alors refaite, comme pour toute autre erreur.
        """
        m = _REJECTED.search(str(ctl.raw.get("msg") or ""))
        if str(ctl.raw.get("code")) != "60018" or not m:
            return False
        arg = {"channel": m[1], "instId": m[2]}
        if arg not in self.args:
            return False
        self.args.remove(arg)        # pas redemandé à la reconnexion
        label = f"{m[1]} {m[2]}"
        self.state.rejected.append(label)
        log.error("%s : abonnement refusé par OKX (60018) : %s", self.name, label)
        if not self.args:
            refused = ", ".join(self.state.rejected)
            self.state.last_error = f"tous les abonnements refusés par OKX : {refused}"
            self.stop()
        return True
