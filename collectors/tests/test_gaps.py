"""Continuité des identifiants de trades : tout trou est signalé, jamais masqué."""

import json
from pathlib import Path

from terminal_collectors.okx.gaps import TradeSequence
from terminal_collectors.okx.parse import parse

FIX = Path(__file__).parent / "fixtures"


def trade(tid, count=1, inst="BTC-USDT-SWAP"):
    return {"inst": inst, "trade_id": tid, "count": count, "ts_source": 0}


def test_recorded_stream_has_no_gap():
    items = json.loads((FIX / "ws_messages.json").read_text())["trades:push"]
    seq = TradeSequence()
    trades = [t for it in items for t in parse(json.dumps(it["msg"]), it["recv_ms"])]
    assert len(trades) >= 20
    assert [g for t in trades if (g := seq.check(t))] == []


def test_aggregated_message_is_continuous():
    seq = TradeSequence()
    assert seq.check(trade(100)) is None
    assert seq.check(trade(103, count=3)) is None   # agrège 101, 102, 103


def test_missing_trades_are_counted():
    seq = TradeSequence()
    seq.check(trade(100))
    gap = seq.check(trade(110))
    assert gap is not None and gap.missing == 9
    assert "9 trade(s) manquant(s)" in gap.describe()


def test_gap_across_reconnection_is_reported():
    # La séquence n'est pas remise à zéro à la reconnexion : les trades perdus
    # pendant la coupure apparaissent dans le journal des trous.
    seq = TradeSequence()
    seq.check(trade(500))
    assert seq.check(trade(742)).missing == 241


def test_duplicate_is_flagged_and_does_not_rewind():
    seq = TradeSequence()
    seq.check(trade(100))
    gap = seq.check(trade(100))
    assert gap is not None and gap.missing <= 0
    assert "doublon" in gap.describe()
    assert seq.check(trade(101)) is None


def test_instruments_are_independent():
    seq = TradeSequence()
    seq.check(trade(10, inst="A"))
    seq.check(trade(900, inst="B"))
    assert seq.check(trade(11, inst="A")) is None
