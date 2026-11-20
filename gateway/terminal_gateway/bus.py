"""Bus en mémoire : dernier état par clé et diffusion conflatée (décision T-002).

Chaque abonné a une file bornée par construction : elle ne garde que la
dernière valeur de chaque clé en attente. Un client lent reçoit donc moins
de mises à jour intermédiaires, jamais une file qui grossit sans fin, et ne
ralentit ni le collecteur ni les autres clients.

Ajouts de P1 (docs/plan-p1.md § 5) :

- suppression : publier `None` retire la clé de l'état et transmet `null`
  aux clients, qui l'effacent ;
- rétention bornée par préfixe : au-delà de N clés sous un préfixe (titres du
  fil d'actus…), les plus anciennes sont supprimées ;
- écouteurs synchrones : appelés à CHAQUE publication, sans conflation. Une
  alerte de prix ne doit jamais manquer un franchissement parce que deux
  valeurs se sont écrasées dans la file d'un client.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Iterable

log = logging.getLogger(__name__)

Listener = Callable[[str, dict | None], None]


class Subscriber:
    def __init__(self, prefixes: Iterable[str]) -> None:
        self.prefixes = tuple(prefixes)
        self._pending: dict[str, tuple[str, dict | None]] = {}
        self._event = asyncio.Event()
        self.dropped = 0  # mises à jour écrasées avant envoi (client lent)

    def wants(self, key: str) -> bool:
        return any(key.startswith(p) for p in self.prefixes)

    def push(self, key: str, conflate_key: str, msg: dict | None) -> None:
        if conflate_key in self._pending:
            self.dropped += 1
            del self._pending[conflate_key]
        self._pending[conflate_key] = (key, msg)
        self._event.set()

    async def next_batch(self) -> list[tuple[str, dict | None]]:
        """Attend puis rend les mises à jour en attente, dans l'ordre d'arrivée.

        Une même clé peut apparaître deux fois quand ses valeurs ont des clés
        de conflation distinctes (bougie close, puis bougie suivante). Une
        valeur `None` signale une suppression.
        """
        await self._event.wait()
        self._event.clear()
        batch, self._pending = self._pending, {}
        return list(batch.values())


class Bus:
    def __init__(self) -> None:
        self._state: dict[str, dict] = {}
        self._subs: set[Subscriber] = set()
        self._listeners: list[tuple[str, Listener]] = []
        self._retention: dict[str, int] = {}

    def publish(self, key: str, msg: dict | None, conflate_key: str | None = None) -> None:
        """Publie `msg` sous `key` ; `None` supprime la clé.

        `conflate_key` sert quand deux valeurs successives de la même clé
        doivent toutes deux parvenir aux clients (bougie close puis bougie
        suivante) : elles ne s'écrasent pas dans la file d'attente.
        """
        if msg is None:
            if self._state.pop(key, None) is None:
                return
        else:
            self._state[key] = msg
        ck = conflate_key or key
        for sub in self._subs:
            if sub.wants(key):
                sub.push(key, ck, msg)
        for prefix, listener in list(self._listeners):
            if key.startswith(prefix):
                try:
                    listener(key, msg)
                except Exception:  # un écouteur en erreur ne bloque ni le bus ni les autres
                    log.exception("écouteur %s en erreur sur %s", prefix, key)
        if msg is not None:
            self._enforce_retention(key)

    def delete(self, key: str) -> None:
        self.publish(key, None)

    def set_retention(self, prefix: str, max_keys: int) -> None:
        """Au plus `max_keys` clés sous `prefix` : les plus anciennes publiées sont supprimées."""
        if max_keys < 1:
            raise ValueError("rétention : au moins une clé")
        self._retention[prefix] = max_keys

    def _enforce_retention(self, key: str) -> None:
        for prefix, max_keys in self._retention.items():
            if not key.startswith(prefix):
                continue
            keys = [k for k in self._state if k.startswith(prefix)]
            # dict garde l'ordre d'insertion : les premières clés sont les plus anciennes.
            for old in keys[: max(0, len(keys) - max_keys)]:
                self.publish(old, None)

    def listen(self, prefix: str, listener: Listener) -> Callable[[], None]:
        """Écouteur synchrone de chaque publication sous `prefix` ; renvoie de quoi le retirer."""
        entry = (prefix, listener)
        self._listeners.append(entry)
        return lambda: self._listeners.remove(entry) if entry in self._listeners else None

    def get(self, key: str) -> dict | None:
        return self._state.get(key)

    def keys(self, prefix: str) -> list[str]:
        return [k for k in self._state if k.startswith(prefix)]

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
