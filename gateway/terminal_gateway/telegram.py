"""Envoi des alertes sur le téléphone par un bot Telegram (décision T-020, plan P1 § 11).

Faits vérifiés dans la documentation officielle le 23/11/2026 (core.telegram.org/bots/api
et /bots/faq) :

- requête : POST JSON sur `https://api.telegram.org/bot<jeton>/sendMessage`, champs
  `chat_id`, `text` (1 à 4 096 caractères), `disable_notification`,
  `link_preview_options` ({"is_disabled": true}) ;
- réponse : `ok`, `result` ; en échec `description`, `error_code`, et parfois
  `parameters.retry_after` (secondes à attendre, « flood control ») ;
- débit : pas plus d'un message par seconde dans une conversation ; au-delà, 429.

Le jeton n'apparaît jamais dans un journal, une erreur ou la base : toute chaîne
sortant d'ici passe par `scrub`. Un autre canal s'ajoutera derrière la même
interface `Notifier`.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger(__name__)

API = "https://api.telegram.org"
MAX_TEXT = 4096
SPACING_S = 1.1  # au plus un message par seconde dans la conversation
MAX_TRIES = 3
MAX_WAIT_S = 60


def now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass(frozen=True)
class SendResult:
    ok: bool
    sent_ms: int
    error: str | None = None
    status: int | None = None


class Notifier(Protocol):
    name: str
    configured: bool

    async def send(self, text: str, silent: bool = False) -> SendResult: ...

    async def aclose(self) -> None: ...


Post = Callable[[str, dict], Awaitable[tuple[int | None, dict | None, str | None]]]


def make_post() -> tuple[Post, Callable[[], Awaitable[None]]]:
    import httpx

    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))

    async def post(url: str, body: dict) -> tuple[int | None, dict | None, str | None]:
        try:
            r = await client.post(url, json=body)
        except httpx.HTTPError as exc:
            return None, None, type(exc).__name__  # jamais repr(exc) : il porte l'URL
        try:
            return r.status_code, r.json(), None
        except ValueError:
            return r.status_code, None, "réponse illisible"

    return post, client.aclose


class TelegramNotifier:
    name = "telegram"

    def __init__(self, token: str | None, chat_id: str | None, post: Post | None = None,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._token, self.chat_id = token, chat_id
        self.configured = bool(token and chat_id)
        self._post, self._close = post, None
        self.sleep, self.clock = sleep, clock
        self._lock = asyncio.Lock()
        self._last_send = -SPACING_S
        self.last: SendResult | None = None

    def scrub(self, text: str) -> str:
        return text.replace(self._token, "<jeton>") if self._token else text

    async def send(self, text: str, silent: bool = False) -> SendResult:
        if not self.configured:
            return SendResult(False, now_ms(), "TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent")
        if self._post is None:
            self._post, self._close = make_post()
        body = {"chat_id": self.chat_id, "text": text[:MAX_TEXT],
                "disable_notification": silent, "link_preview_options": {"is_disabled": True}}
        url = f"{API}/bot{self._token}/sendMessage"
        async with self._lock:  # une conversation : envois en file, espacés
            result = SendResult(False, now_ms(), "aucun essai")
            for _ in range(MAX_TRIES):
                wait = self._last_send + SPACING_S - self.clock()
                if wait > 0:
                    await self.sleep(wait)
                status, doc, err = await self._post(url, body)
                self._last_send = self.clock()
                if doc and doc.get("ok"):
                    result = SendResult(True, now_ms(), None, status)
                    break
                desc = self.scrub(str((doc or {}).get("description") or err or f"HTTP {status}"))
                result = SendResult(False, now_ms(), desc[:200], status)
                retry = ((doc or {}).get("parameters") or {}).get("retry_after")
                if status == 429 and isinstance(retry, int) and retry <= MAX_WAIT_S:
                    await self.sleep(retry)
                    continue
                if status is None:  # réseau : un nouvel essai après 2 s
                    await self.sleep(2)
                    continue
                break  # 400, 401, 403… : inutile d'insister
        self.last = result
        if not result.ok:
            log.warning("Telegram : envoi refusé (%s)", result.error)
        return result

    def health(self) -> dict:
        r = self.last
        return {"configured": self.configured,
                "last_ok": r.ok if r else None, "last_ms": r.sent_ms if r else None,
                "last_error": r.error if r else None}

    async def aclose(self) -> None:
        if self._close:
            await self._close()
