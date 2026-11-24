"""Référence indépendante du moteur de backtest (section Backtest, porte de l'étape S1).

    .venv/bin/python scripts/bt_reference.py [--fixture …] [--out …]

Rejoue, sans PineTS, le croisement de moyennes 20/50 (long et short, toujours en position) sur les
bougies quotidiennes de BTC/USDT du jeu de test, avec les règles documentées de l'émulateur de type
TradingView, puis calcule les mesures avec les définitions de web/src/backtest/metrics.ts :

- signal à la clôture de la barre i (crossover : a > b et a[i-1] <= b[i-1]) ; exécution à
  l'ouverture de la barre i+1, sans glissement ;
- retournement : la position ouverte est fermée au même prix, puis la nouvelle est ouverte ;
- taille = capital à la clôture du signal / (clôture du signal * (1 + commission)), tronquée à
  6 décimales (fixée à la création de l'ordre, comme TradingView) ;
  capital = initial + PnL clos + PnL latent à la clôture - commissions d'entrée déjà payées ;
- commission de 0,05 % sur chaque ordre ; PnL d'un trade = taille * (sortie - entrée) - commissions.

Le résultat (transactions et mesures) est écrit dans un fichier JSON que le test Vitest du moteur
compare, au centime près, à la sortie de PineTS et de metrics.ts.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "web/src/backtest/fixtures/okx-btc-1d-2024-09-16_2026-11-23.json"
OUT = ROOT / "web/src/backtest/fixtures/reference-sma-20-50-btc-1d.json"
CAPITAL = 10_000.0
COMMISSION = 0.0005
FAST, SLOW = 20, 50
BARS_PER_YEAR = 365


def sma(values: list[float], n: int, i: int) -> float | None:
    if i + 1 < n:
        return None
    return sum(values[i - n + 1 : i + 1]) / n


def simulate(candles: list[dict]) -> tuple[list[dict], list[dict]]:
    closes = [b["c"] for b in candles]
    trades: list[dict] = []
    pos: dict | None = None  # {"size", "entry_bar", "entry_price", "entry_comm"}
    closed_pnl = 0.0
    for i in range(1, len(candles) - 1):
        f0, s0 = sma(closes, FAST, i), sma(closes, SLOW, i)
        f1, s1 = sma(closes, FAST, i - 1), sma(closes, SLOW, i - 1)
        if None in (f0, s0, f1, s1):
            continue
        up = f0 > s0 and f1 <= s1
        down = f0 < s0 and f1 >= s1
        if not (up or down):
            continue
        want = 1 if up else -1
        if pos and (pos["size"] > 0) == (want > 0):
            continue
        # Capital à la clôture du signal (latent sans commission de sortie).
        equity = CAPITAL + closed_pnl
        if pos:
            equity += pos["size"] * (closes[i] - pos["entry_price"]) - pos["entry_comm"]
        price = candles[i + 1]["o"]
        if pos:
            exit_comm = abs(pos["size"]) * price * COMMISSION
            pnl = pos["size"] * (price - pos["entry_price"]) - pos["entry_comm"] - exit_comm
            trades.append({**pos, "exit_bar": i + 1, "exit_price": price, "pnl": pnl})
            closed_pnl += pnl
        # Taille fixée à la création de l'ordre : prix de clôture de la barre du signal.
        qty = math.floor(equity / (closes[i] * (1 + COMMISSION)) * 1e6) / 1e6
        size = qty * want
        pos = {
            "size": size,
            "entry_bar": i + 1,
            "entry_price": price,
            "entry_comm": qty * price * COMMISSION,
        }
    return trades, ([pos] if pos else [])


def metrics(candles: list[dict], trades: list[dict], open_: list[dict]) -> dict:
    n = len(candles)
    equity = []
    for i in range(n):
        realized = sum(t["pnl"] for t in trades if t["exit_bar"] <= i)
        latent = sum(
            t["size"] * (candles[i]["c"] - t["entry_price"])
            for t in trades + [{**o, "exit_bar": n} for o in open_]
            if t["entry_bar"] <= i < t["exit_bar"]
        )
        equity.append(CAPITAL + realized + latent)
    pnl = [t["pnl"] for t in trades]
    ret = [t["pnl"] / (abs(t["size"]) * t["entry_price"]) for t in trades]
    wins = [p for p in pnl if p > 0]
    losses = [p for p in pnl if p < 0]
    peak, dd_pct, dd = -math.inf, 0.0, 0.0
    for e in equity:
        peak = max(peak, e)
        dd_pct, dd = max(dd_pct, (peak - e) / peak), max(dd, peak - e)
    r = [equity[i] / equity[i - 1] - 1 for i in range(1, n)]

    def mean(x: list[float]) -> float:
        return sum(x) / len(x)

    def sd(x: list[float]) -> float:
        m = mean(x)
        return math.sqrt(sum((v - m) ** 2 for v in x) / (len(x) - 1))

    m = mean(r)
    m2 = sum((v - m) ** 2 for v in r) / len(r)
    skew = (sum((v - m) ** 3 for v in r) / len(r)) / m2**1.5
    kurt = (sum((v - m) ** 4 for v in r) / len(r)) / m2**2
    sr = m / sd(r)
    den = 1 - skew * sr + (kurt - 1) / 4 * sr * sr
    z = sr * math.sqrt(len(r) - 1) / math.sqrt(den)
    return {
        "trades": len(trades),
        "wins": len(wins),
        "winrate": len(wins) / len(trades),
        "total_pnl": sum(pnl),
        "rr": mean(wins) / abs(mean(losses)),
        "ex_pnl": mean(pnl),
        "ex_ret_pct": mean(ret) * 100,
        "max_dd_pct": dd_pct * 100,
        "max_dd": dd,
        "sharpe": sr * math.sqrt(BARS_PER_YEAR),
        "t_stat": mean(ret) / (sd(ret) / math.sqrt(len(ret))),
        "dsr": 0.5 * math.erfc(-z / math.sqrt(2)),
        "profit_factor": sum(wins) / -sum(losses),
        "final_equity": equity[-1],
    }


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("--fixture", type=Path, default=FIXTURE)
    a.add_argument("--out", type=Path, default=OUT)
    args = a.parse_args()
    candles = json.loads(args.fixture.read_text())
    trades, open_ = simulate(candles)
    out = {
        "strategy": (
            f"SMA {FAST}/{SLOW}, long et short, commission {COMMISSION * 100} %, sans glissement"
        ),
        "capital": CAPITAL,
        "trades": [
            {k: t[k] for k in ("entry_bar", "entry_price", "exit_bar", "exit_price", "size", "pnl")}
            for t in trades
        ],
        "open": [{k: o[k] for k in ("entry_bar", "entry_price", "size")} for o in open_],
        "metrics": metrics(candles, trades, open_),
    }
    args.out.write_text(json.dumps(out, indent=1))
    print(f"{len(trades)} trades, {len(open_)} ouverte(s) -> {args.out.relative_to(ROOT)}")
    print(json.dumps(out["metrics"], indent=1))


if __name__ == "__main__":
    main()
