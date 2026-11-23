"""Réaction du BTC à une publication (étape E3, docs/plan-p1.md § 7.8). Fonction pure.

Bougies 1 min du perpétuel BTC-USDT d'OKX, de T-5 min à T+30 min. OKX ne sert
que les 1 440 dernières bougies de chaque taille (24 h) : la réaction s'enregistre
à T+31 min, ou au démarrage de la passerelle tant que T a moins de 23 h.

- Prix de référence : clôture de la bougie T-1 min -> T, dernier prix avant la
  publication.
- Prix à T+30 min : clôture de la bougie T+29 min -> T+30 min.
- Variation en %, à deux décimales, calculée en décimal. Une bougie absente ou
  non clôturée est signalée ; sans l'une des deux bornes, la variation reste
  « — » avec sa raison.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

INST = "BTC-USDT-SWAP"
BAR_MS = 60_000
BEFORE_MS = 5 * BAR_MS
AFTER_MS = 30 * BAR_MS
DUE_AFTER_MS = AFTER_MS + BAR_MS  # T+31 min : la bougie T+29 est clôturée
OKX_KEEPS_MS = 23 * 3_600_000  # marge sous les 24 h servies par OKX


def _price(x: float) -> Decimal:
    # Les prix OKX arrivent en flottants : on repasse par leur écriture courte (« 91234.5 »).
    return Decimal(repr(float(x)))


def btc_reaction(candles: list[dict], t_ms: int) -> dict:
    lo, hi = t_ms - BEFORE_MS, t_ms + AFTER_MS
    by_t = {c["t"]: c for c in candles if lo <= c["t"] < hi}
    expected = list(range(lo, hi, BAR_MS))
    missing = [t for t in expected if t not in by_t]
    unconfirmed = [t for t, c in by_t.items() if not c.get("confirmed", True)]
    ref_c, end_c = by_t.get(t_ms - BAR_MS), by_t.get(hi - BAR_MS)
    reason = None
    change = None
    if ref_c is None:
        reason = "bougie T-1 min absente : pas de prix de référence"
    elif end_c is None or not end_c.get("confirmed", True):
        reason = "bougie T+29 min absente ou non clôturée : pas de prix à T+30 min"
    else:
        ref, end = _price(ref_c["c"]), _price(end_c["c"])
        change = format(((end / ref - 1) * 100).quantize(Decimal("0.01"), ROUND_HALF_UP), "f")
        if change in ("-0.00",):
            change = "0.00"
    return {
        "inst": INST, "bar": "1m", "scheduled_ms": t_ms, "from_ms": lo, "to_ms": hi,
        "candles": [{"t": t, "o": by_t[t]["o"], "h": by_t[t]["h"], "l": by_t[t]["l"],
                     "c": by_t[t]["c"]} for t in expected if t in by_t],
        "ref_price": format(_price(ref_c["c"]), "f") if ref_c else None,
        "end_price": format(_price(end_c["c"]), "f") if end_c and change else None,
        "change_pct": change,
        "missing": missing,
        "unconfirmed": sorted(unconfirmed),
        "reason": reason,
    }
