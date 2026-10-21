"""Analyse des messages OKX, sur les messages réels enregistrés par scripts/explore_okx.py."""

import json
from pathlib import Path

import pytest
from terminal_collectors.okx.parse import Control, candle_from_row, parse

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def recorded() -> dict:
    return json.loads((FIX / "ws_messages.json").read_text())


def first(recorded, key):
    item = recorded[key][0]
    return parse(json.dumps(item["msg"]), item["recv_ms"])


def test_trade_fields_and_units(recorded):
    [t] = first(recorded, "trades:push")
    assert t["kind"] == "trade" and t["inst"] == "BTC-USDT-SWAP"
    assert isinstance(t["trade_id"], int) and t["count"] >= 1
    assert t["side"] in {"buy", "sell"}
    assert t["px"] > 1000            # prix en USDT
    assert t["ts_recv"] >= t["ts_source"] - 5_000


def test_ticker_has_24h_and_utc_day_open(recorded):
    [t] = first(recorded, "tickers:push")
    for key in ("last", "open24h", "high24h", "low24h", "sod_utc0", "vol_base24h"):
        assert t[key] is not None, key
    assert t["low24h"] <= t["last"] <= t["high24h"]


def test_funding_interval_is_eight_hours_on_btc(recorded):
    [f] = first(recorded, "funding-rate:push")
    assert f["interval_ms"] == 8 * 3_600_000
    assert f["funding_time"] > f["ts_source"]  # prochaine échéance, dans le futur


def test_open_interest(recorded):
    [o] = first(recorded, "open-interest:push")
    assert o["oi_base"] > 0 and o["oi_usd"] > o["oi_base"]


def test_candle_vwap_inputs(recorded):
    [c] = first(recorded, "candle1m:push")
    assert c["bar"] == "1m" and c["l"] <= c["c"] <= c["h"]
    # volCcyQuote / volCcy = prix moyen des trades de la bougie, donc dans [l, h]
    if c["vol_base"] > 0:
        assert c["l"] <= c["vol_quote"] / c["vol_base"] <= c["h"]


def test_rest_candles_share_the_ws_layout():
    rows = json.loads((FIX / "rest_candles_1m.json").read_text())["data"]
    c = candle_from_row("BTC-USDT-SWAP", "1m", rows[1])
    assert c["confirmed"] is True and c["t"] % 60_000 == 0


def test_controls():
    assert isinstance(parse("pong", 0), Control)
    ctl = parse('{"event":"error","code":"60012","msg":"x"}', 0)
    assert isinstance(ctl, Control) and ctl.event == "error"
