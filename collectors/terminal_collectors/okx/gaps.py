"""Continuité des trades OKX.

Règle vérifiée sur flux réel (254 trades consécutifs, 0 rupture) : un message
du canal `trades` agrège `count` trades et porte le dernier identifiant, donc
`tradeId - count` doit égaler le `tradeId` du message précédent. Tout écart
est un trou : trades manqués pendant une reconnexion, ou message perdu.

Un trou n'est jamais comblé ni masqué : il est retourné à l'appelant, qui le
journalise et le signale à l'écran.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TradeGap:
    inst: str
    last_seen: int
    next_seen: int
    missing: int
    ts_source: int

    def describe(self) -> str:
        if self.missing <= 0:  # 0 : doublon exact (même identifiant reçu deux fois)
            return (f"{self.inst} : trade {self.next_seen} reçu après {self.last_seen} "
                    f"(doublon ou désordre)")
        return (f"{self.inst} : {self.missing} trade(s) manquant(s) entre "
                f"{self.last_seen} et {self.next_seen}")


class TradeSequence:
    """Suit le dernier identifiant de trade par instrument."""

    def __init__(self) -> None:
        self._last: dict[str, int] = {}

    def check(self, trade: dict) -> TradeGap | None:
        inst, tid, count = trade["inst"], trade["trade_id"], trade["count"]
        prev = self._last.get(inst)
        if prev is not None and tid <= prev:
            # Doublon ou désordre : on garde le plus grand identifiant vu.
            return TradeGap(inst, prev, tid, tid - prev, trade["ts_source"])
        self._last[inst] = tid
        if prev is None:
            return None
        first = tid - count + 1
        if first != prev + 1:
            return TradeGap(inst, prev, tid, first - prev - 1, trade["ts_source"])
        return None

    def reset(self, inst: str | None = None) -> None:
        if inst is None:
            self._last.clear()
        else:
            self._last.pop(inst, None)
