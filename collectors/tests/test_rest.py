import itertools

import httpx
from terminal_collectors.okx.rest import ClockSample, OkxRest, best_sample


def test_best_clock_sample_is_shortest_round_trip():
    s = [ClockSample(300, 600), ClockSample(20, 80), ClockSample(-50, 400)]
    assert best_sample(s).offset_ms == 20
    assert best_sample([]) is None


async def test_candles_paginate_backwards_until_since():
    minute = 60_000
    newest = 1_000 * minute

    def rows(after):
        top = newest if after is None else after - minute
        return [[str(top - i * minute), "1", "2", "0.5", "1.5", "10", "1", "1.5", "1"]
                for i in range(300)]

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        after = request.url.params.get("after")
        calls.append(after)
        return httpx.Response(200, json={"code": "0", "msg": "",
                                         "data": rows(int(after) if after else None)})

    client = httpx.AsyncClient(base_url="https://x", transport=httpx.MockTransport(handler))
    rest = OkxRest("https://x", client)
    since = newest - 500 * minute
    out = await rest.candles("BTC-USDT-SWAP", "1m", since_ms=since)
    assert calls[0] is None and len(calls) == 2
    assert out[0]["t"] == since and out[-1]["t"] == newest
    assert all(b["t"] - a["t"] == minute for a, b in itertools.pairwise(out))
    await rest.aclose()


async def test_instrument_contract_value_is_read_not_assumed():
    def handler(request):
        return httpx.Response(200, json={"code": "0", "data": [{
            "instId": "BTC-USDT-SWAP", "ctVal": "0.01", "ctValCcy": "BTC", "ctType": "linear",
            "lotSz": "0.01", "minSz": "0.01", "tickSz": "0.1", "settleCcy": "USDT",
            "state": "live"}]})
    client = httpx.AsyncClient(base_url="https://x", transport=httpx.MockTransport(handler))
    meta = await OkxRest("https://x", client).instrument("BTC-USDT-SWAP")
    assert meta["ct_val"] == 0.01 and meta["tick_sz"] == 0.1
