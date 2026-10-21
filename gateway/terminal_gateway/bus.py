"""Bus en mémoire : dernier état par clé et diffusion conflatée (décision T-002).

Chaque abonné a une file bornée par construction : elle ne garde que la
dernière valeur de chaque clé en attente. Un client lent reçoit donc moins
de mises à jour intermédiaires, jamais une file qui grossit sans fin, et ne
ralentit ni le collecteur ni les autres clients.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable


class Subscriber:
    def __init__(self, prefixes: Iterable[str]) -> None:
        self.prefixes = tuple(prefixes)
        self._pending: dict[str, tuple[str, dict]] = {}
        self._event = asyncio.Event()
        self.dropped = 0  # mises à jour écrasées avant envoi (client lent)

    def wants(self, key: str) -> bool:
        return any(key.startswith(p) for p in self.prefixes)

    def push(self, key: str, conflate_key: str, msg: dict) -> None:
        if conflate_key in self._pending:
            self.dropped += 1
            del self._pending[conflate_key]
        self._pending[conflate_key] = (key, msg)
        self._event.set()

    async def next_batch(self) -> list[tuple[str, dict]]:
        """Attend puis rend les mises à jour en attente, dans l'ordre d'arrivée.

        Une même clé peut apparaître deux fois quand ses valeurs ont des clés
        de conflation distinctes (bougie close, puis bougie suivante).
        """
        await self._event.wait()
        self._event.clear()
        batch, self._pending = self._pending, {}
        return list(batch.values())


class Bus:
    def __init__(self) -> None:
        self._state: dict[str, dict] = {}
        self._subs: set[Subscriber] = set()

    def publish(self, key: str, msg: dict, conflate_key: str | None = None) -> None:
        """Publie `msg` sous `key`.

        `conflate_key` sert quand deux valeurs successives de la même clé
        doivent toutes deux parvenir aux clients (bougie close puis bougie
        suivante) : elles ne s'écrasent pas dans la file d'attente.
        """
        self._state[key] = msg
        ck = conflate_key or key
        for sub in self._subs:
            if sub.wants(key):
                sub.push(key, ck, msg)

    def get(self, key: str) -> dict | None:
        return self._state.get(key)

    def snapshot(self, prefixes: Iterable[str]) -> dict[str, dict]:
        prefixes = tuple(prefixes)
        return {k: v for k, v in self._state.items() if any(k.startswith(p) for p in prefixes)}

    def subscribe(self, prefixes: Iterable[str]) -> Subscriber:
        sub = Subscriber(prefixes)
        self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        self._subs.discard(sub)

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)
