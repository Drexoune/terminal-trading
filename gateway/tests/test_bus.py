"""Bus en mémoire : dernier état, conflation, client lent."""

import asyncio

from terminal_gateway.bus import Bus


async def test_snapshot_returns_last_state_by_prefix():
    bus = Bus()
    bus.publish("ticker:BTC", {"last": 1})
    bus.publish("ticker:BTC", {"last": 2})
    bus.publish("oi:BTC", {"oi": 3})
    assert bus.snapshot(["ticker:"]) == {"ticker:BTC": {"last": 2}}


async def test_slow_consumer_gets_latest_value_and_bounded_queue():
    bus = Bus()
    sub = bus.subscribe(["ticker:"])
    for i in range(10_000):
        bus.publish("ticker:BTC", {"last": i})
    batch = await asyncio.wait_for(sub.next_batch(), 1)
    assert batch == [("ticker:BTC", {"last": 9_999})]
    assert sub.dropped == 9_999


async def test_conflate_key_keeps_closed_candle_and_new_candle():
    bus = Bus()
    sub = bus.subscribe(["candle:"])
    bus.publish("candle:1m:BTC", {"t": 0, "c": 1}, conflate_key="candle:1m:BTC:0")
    bus.publish("candle:1m:BTC", {"t": 0, "c": 2}, conflate_key="candle:1m:BTC:0")
    bus.publish("candle:1m:BTC", {"t": 60, "c": 3}, conflate_key="candle:1m:BTC:60")
    batch = await asyncio.wait_for(sub.next_batch(), 1)
    assert [m for _, m in batch] == [{"t": 0, "c": 2}, {"t": 60, "c": 3}]
    assert bus.get("candle:1m:BTC") == {"t": 60, "c": 3}


async def test_unsubscribed_topics_are_not_delivered():
    bus = Bus()
    sub = bus.subscribe(["trade:"])
    bus.publish("ticker:BTC", {"x": 1})
    bus.publish("trade:BTC", {"x": 2})
    batch = await asyncio.wait_for(sub.next_batch(), 1)
    assert batch == [("trade:BTC", {"x": 2})]
    bus.unsubscribe(sub)
    assert bus.subscriber_count == 0
