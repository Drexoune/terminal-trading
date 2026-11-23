"""Surprise brute et surprise z (décision T-018, docs/plan-p1.md § 8) : fonctions pures.

- Surprise brute = réel - prévision, dans l'unité de l'indicateur, en texte décimal.
- z = surprise / sigma des surprises passées, sur nos premières publications
  enregistrées avec leur prévision (ForexFactory ne donne aucun historique).
- z s'affiche à partir de n = 8 et reste « provisoire » jusqu'à n = 24.
- sigma a un plancher : la moitié de la dernière décimale publiée (0,05 pour un
  chiffre au dixième), pour qu'une série de surprises nulles ne divise pas par 0.
- Les publications irrégulières (shutdown 2025) sont exclues par l'appelant.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

Z_MIN_N = 8
Z_FIRM_N = 24


def _decimals(s: str) -> int:
    return len(s.split(".", 1)[1]) if "." in s else 0


def raw_surprise(actual: str | None, forecast: str | None) -> str | None:
    """« 0.4 » - « 0.3 » → « 0.1 » ; avec autant de décimales que la plus précise."""
    if actual is None or forecast is None:
        return None
    try:
        a, f = Decimal(actual), Decimal(forecast)
    except InvalidOperation:
        return None
    places = max(_decimals(actual), _decimals(forecast))
    d = (a - f).quantize(Decimal(1).scaleb(-places))
    return format(abs(d) if d == 0 else d, "f")  # jamais « -0.0 »


def sigma_floor(actual: str) -> Decimal:
    """Moitié de la dernière décimale publiée : 0.05 pour « 0.4 », 0.5 pour « 165 »."""
    return Decimal(1).scaleb(-_decimals(actual)) / 2


@dataclass(frozen=True)
class ZScore:
    z: str | None
    n: int
    provisional: bool
    reason: str | None


def z_score(surprise: str | None, history: list[str], actual: str) -> ZScore:
    """z de `surprise` contre les surprises passées `history` (texte décimal)."""
    n = len(history)
    if surprise is None:
        return ZScore(None, n, False, "pas de prévision avant la publication")
    if n < Z_MIN_N:
        return ZScore(None, n, False, f"historique insuffisant ({n}/{Z_MIN_N})")
    values = [Decimal(h) for h in history]
    sigma = max(statistics.stdev(values), sigma_floor(actual))
    z = (Decimal(surprise) / sigma).quantize(Decimal("0.01"))
    return ZScore(format(z, "f"), n, n < Z_FIRM_N, None)
