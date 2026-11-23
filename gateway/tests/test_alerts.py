"""Alertes (E4) : règles pures, envoi Telegram simulé (jamais de vrai jeton), service sur le bus,
routes REST. Plan P1 § 11 et § 14 : « franchissement sans perte ; envoi Telegram simulé »."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from terminal_gateway import alert_rules as ar
from terminal_gateway.alert_service import AlertService
from terminal_gateway.app import create_app
from terminal_gateway.bus import Bus
from terminal_gateway.config import Settings
from terminal_gateway.storage import Storage
from terminal_gateway.telegram import SendResult, TelegramNotifier

INST = ("BTC-USDT-SWAP", "ETH-USDT-SWAP")
FAKE_TOKEN = "123456:TEST-not-a-real-token-ABCDEFGHIJKLMNOPQRS"
T0 = 1_796_000_000_000


def run(coro):
    return asyncio.run(coro)


def settings(tmp_path: Path) -> Settings:
    return Settings(okx_region="eea", instruments=INST, host="127.0.0.1", port=0,
                    allowed_origins=("http://localhost:5173",), log_dir=tmp_path / "logs",
                    stop_file=tmp_path / "stop", machine="mac-test", services=("alert",),
                    data_dir=tmp_path / "data")


# --- règles pures -----------------------------------------------------------------------


def test_validate_cleans_and_refuses():
    p, ch = ar.validate("price", {"inst": "BTC-USDT-SWAP", "level": "110000.0",
                                  "direction": "hausse"}, ["telegram", "inconnu"], INST)
    assert p == {"inst": "BTC-USDT-SWAP", "level": "110000", "direction": "hausse"}
    assert ch == ["écran", "telegram"]  # l'écran est toujours servi
    for kind, params, why in [
        ("price", {"inst": "SOL-USDT-SWAP", "level": "1"}, "non suivi"),
        ("price", {"inst": "BTC-USDT-SWAP", "level": "-5"}, "invalide"),
        ("funding", {"inst": "BTC-USDT-SWAP", "threshold_pct": "9"}, "hors bornes"),
        ("event_soon", {"minutes": 0}, "minutes"),
        ("surprise", {}, "seuil manquant"),
        ("keyword", {"words": []}, "mots-clés"),
        ("liquidation", {}, "inconnue"),
    ]:
        with pytest.raises(ar.RuleError, match=why):
            ar.validate(kind, params, [], INST)


def test_labels_match_the_mockup_style():
    assert ar.describe("price", {"inst": "BTC-USDT-SWAP", "level": "110000",
                                 "direction": "les deux"}) == ("BTC franchit 110\u202f000",
                                                               "Prix · OKX")
    label, cat = ar.describe("funding", {"inst": "BTC-USDT-SWAP", "threshold_pct": "0.02",
                                         "side": "au-dessus"})
    assert label == "Funding OKX au-dessus de 0,02\u00a0%" and cat == "Dérivés · BTC-USDT perp"
    soon = ar.describe("event_soon", {"minutes": 5, "captured_only": True, "impacts": [],
                                      "currencies": []})[0]
    assert soon == "T\u22125\u00a0min avant une publication captée"


def test_price_cross_needs_a_previous_price_and_both_sides():
    up = {"level": "100", "direction": "hausse"}
    assert not ar.price_crossed(up, None, 101)
    assert ar.price_crossed(up, 99.5, 100) and not ar.price_crossed(up, 100.5, 99)
    both = {"level": "100", "direction": "les deux"}
    assert ar.price_crossed(both, 100.5, 99) and ar.price_crossed(both, 99, 101)
    assert not ar.price_crossed(both, 101, 102)


def test_keyword_ignores_case_accents_and_partial_words():
    p = {"words": ["Réserve fédérale", "ETF"]}
    assert ar.keyword_hit(p, "La reserve FEDERALE maintient ses taux") == "Réserve fédérale"
    assert ar.keyword_hit(p, "Spot ETF inflows") == "ETF"
    assert ar.keyword_hit(p, "Netflix earnings") is None  # « etf » dans un mot : non


def test_surprise_threshold_on_z_or_raw():
    fig = {"indicator": "us-cpi-mm", "value": "0.4", "surprise": "0.2", "z": "-1.9"}
    assert ar.surprise_hit({"indicator": None, "z_min": "1.5", "raw_min": None}, fig)
    assert not ar.surprise_hit({"indicator": "us-nfp", "z_min": "1.5", "raw_min": None}, fig)
    assert ar.surprise_hit({"indicator": None, "z_min": None, "raw_min": "0.2"}, fig)
    assert not ar.surprise_hit({"indicator": None, "z_min": "1.5", "raw_min": None},
                               {**fig, "value": None})


def test_french_numbers():
    assert ar.fr_num("-1234.5") == "\u22121\u202f234,5"
    assert ar.fr_num("0.0312", 4, signed=True) == "+0,0312"
    assert ar.fr_num("-0.00", 2) == "0,00"
    line = ar.figure_line({"label_fr": "IPC (m/m)", "unit": "%", "value": "0.4",
                           "forecast": "0.3", "surprise": "0.1", "z": None})
    assert line == "IPC (m/m) : 0,4\u00a0% (prév. 0,3\u00a0%, surprise +0,1)"


# --- Telegram simulé ------------------------------------------------------------------------


class FakeApi:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    async def post(self, url, body):
        self.calls.append((url, body))
        return self.replies.pop(0)


def test_telegram_waits_retry_after_and_masks_the_token():
    sleeps: list[float] = []

    async def sleep(s):
        sleeps.append(s)

    api = FakeApi([(429, {"ok": False, "error_code": 429, "description": "Too Many Requests",
                          "parameters": {"retry_after": 3}}, None),
                   (200, {"ok": True, "result": {}}, None),
                   (401, {"ok": False, "description": f"Unauthorized {FAKE_TOKEN}"}, None)])
    tg = TelegramNotifier(FAKE_TOKEN, "42", post=api.post, sleep=sleep, clock=lambda: 1e9)
    ok = run(tg.send("bonjour"))
    bad = run(tg.send("encore"))
    assert ok.ok and 3 in sleeps
    url, body = api.calls[0]
    assert url.endswith("/sendMessage") and body["chat_id"] == "42"
    assert body["link_preview_options"] == {"is_disabled": True}
    assert not bad.ok and FAKE_TOKEN not in bad.error and "<jeton>" in bad.error
    assert tg.health()["last_ok"] is False


def test_telegram_not_configured_never_calls():
    api = FakeApi([])
    r = run(TelegramNotifier(None, "42", post=api.post).send("x"))
    assert not r.ok and "TELEGRAM_BOT_TOKEN" in r.error and api.calls == []


# --- service ----------------------------------------------------------------------------------


class FakeNotifier:
    name, configured = "telegram", True

    def __init__(self, ok=True):
        self.sent, self.ok = [], ok

    async def send(self, text, silent=False):
        self.sent.append(text)
        return SendResult(self.ok, T0, None if self.ok else "refus simulé")

    def health(self):
        return {"configured": True}

    async def aclose(self):
        pass


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


async def make(tmp_path, notifier=None, clock=None):
    db = Storage(tmp_path / "a.sqlite3")
    await db.open()
    bus = Bus()
    clock = clock or Clock()
    svc = AlertService(bus, db, settings(tmp_path), notifier=notifier or FakeNotifier(),
                       clock=clock)
    await svc.start()
    return svc, db, bus, clock


def trade(bus, px, tid):
    bus.publish("trade:BTC-USDT-SWAP", {"kind": "trade", "inst": "BTC-USDT-SWAP", "px": px,
                                        "trade_id": tid, "ts_source": T0})


def test_default_rules_are_seeded_and_armed(tmp_path):
    async def go():
        svc, db, bus, _ = await make(tmp_path)
        rules = [bus.get(k) for k in bus.keys("alert:rule:")]
        await svc.stop()
        await db.close()
        return rules

    rules = run(go())
    assert [(r["kind"], r["state"]) for r in rules] == [("release", "armée"),
                                                        ("event_soon", "armée")]
    assert rules[0]["label"] == "Chiffre publié : tous les indicateurs suivis"


def test_every_trade_is_seen_and_a_price_rule_fires_once(tmp_path):
    async def go():
        notif = FakeNotifier()
        svc, db, bus, _ = await make(tmp_path, notif)
        rule = await svc.create_rule("price", {"inst": "BTC-USDT-SWAP", "level": "110000",
                                               "direction": "hausse"}, ["telegram"])
        # Rafale dans la même milliseconde : le bus conflate pour l'écran, pas pour l'écouteur.
        for i, px in enumerate([109_990, 109_999.9, 110_000.5, 109_000, 110_500]):
            trade(bus, px, i)
        await svc.drain()
        events = await db.query("select * from alert_events")
        stored = await db.query("select state, last_fired_ms from alert_rules where id = ?",
                                (rule["id"],))
        await svc.update_rule(rule["id"], state="armée")  # réarmée à la main
        trade(bus, 109_000, 10)
        trade(bus, 111_000, 11)
        await svc.drain()
        n = len(await db.query("select 1 from alert_events"))
        await svc.stop()
        await db.close()
        return notif, events, stored, bus, n

    notif, events, stored, bus, n = run(go())
    assert len(events) == 1 and events[0]["telegram"] == "envoyé"
    assert events[0]["title"] == "BTC-USDT perp franchit 110\u202f000 à la hausse"
    assert stored == [{"state": "déclenchée", "last_fired_ms": T0}]
    assert len(notif.sent) == 2 and "Dernier 110\u202f000,5" in notif.sent[0]
    assert n == 2
    assert bus.get("alert:summary")["unacked"] == 2


def test_funding_rule_rearms_itself(tmp_path):
    async def go():
        svc, db, bus, _ = await make(tmp_path)
        rule = await svc.create_rule("funding", {"inst": "BTC-USDT-SWAP",
                                                 "threshold_pct": "0.02"}, [])
        states = []
        for i, rate in enumerate([0.0001, 0.00025, 0.0003, 0.0001, 0.00021]):
            bus.publish("funding:BTC-USDT-SWAP", {"inst": "BTC-USDT-SWAP", "rate": rate,
                                                  "funding_time": i})
            states.append(svc.rules[rule["id"]]["state"])
        await svc.drain()
        n = len(await db.query("select 1 from alert_events"))
        await svc.stop()
        await db.close()
        return states, n

    states, n = run(go())
    assert states == ["armée", "déclenchée", "déclenchée", "armée", "déclenchée"]
    assert n == 2


def fig(bus_ms):
    return {"indicator": "us-cpi-mm", "label_fr": "IPC (m/m)", "unit": "%", "value": "0.6",
            "forecast": "0.3", "surprise": "0.3", "z": "2.1", "bus_ms": bus_ms,
            "scheduled_ms": bus_ms - 900}


def test_release_alerts_only_for_fresh_captures(tmp_path):
    async def go():
        notif = FakeNotifier()
        clock = Clock()
        bus = Bus()
        # Republication d'avant le démarrage (passerelle relancée) : aucune alerte.
        bus.publish("release:us-cpi-mm:2026-10", fig(T0 - 3_600_000))
        db = Storage(tmp_path / "a.sqlite3")
        await db.open()
        svc = AlertService(bus, db, settings(tmp_path), notifier=notif, clock=clock)
        await svc.start()
        await svc.create_rule("surprise", {"z_min": "1.5"}, ["telegram"])
        clock.t = T0 + 5_000
        bus.publish("release:us-cpi-mm:2026-11", fig(clock.t))
        bus.publish("release:last", {"release": "cpi", "title": "Consumer Price Index",
                                     "period": "2026-11", "ny_date": "2026-12-10",
                                     "keys": ["release:us-cpi-mm:2026-11"],
                                     "scheduled_ms": clock.t - 900, "bus_ms": clock.t,
                                     "nature": "officielle"})
        # Révision : la clé est republiée avec son heure d'origine -> rien de nouveau.
        clock.t += 3_600_000
        bus.publish("release:us-cpi-mm:2026-11", {**fig(T0 + 5_000), "revisions": [{}]})
        await svc.drain()
        events = await db.query("select title, body, telegram from alert_events order by title")
        await svc.stop()
        await db.close()
        return events, notif

    events, notif = run(go())
    assert [e["title"] for e in events] == ["Consumer Price Index · 2026-11",
                                            "Surprise : IPC (m/m)"]
    assert "IPC (m/m) : 0,6\u00a0% (prév. 0,3\u00a0%, surprise +0,3, z +2,1)" in events[0]["body"]
    assert len(notif.sent) == 2


def test_event_soon_fires_once_per_event(tmp_path):
    async def go():
        svc, db, bus, clock = await make(tmp_path)
        ev = {"id": "cpi|USD|2026-12-10|1", "title": "CPI m/m", "title_fr": "IPC (m/m)",
              "capture": True, "currency": "USD", "impact": "High", "time_ms": T0 + 6 * 60_000,
              "time_source": "BLS", "forecast_raw": "0.3%"}
        other = {**ev, "id": "x", "capture": False, "title_fr": None}
        bus.publish("calendar:week:2026-W50", {"events": [ev, other]})
        first = svc.check_calendar()  # T-6 min : trop tôt
        clock.t = T0 + 60_000 + 1
        second = svc.check_calendar()
        third = svc.check_calendar()
        await svc.drain()
        rows = await db.query("select title, body from alert_events")
        await svc.stop()
        await db.close()
        return first, second, third, rows

    first, second, third, rows = run(go())
    assert (first, second, third) == (0, 1, 0)
    assert rows[0]["title"] == "Dans 5\u00a0min : IPC (m/m) (USD)"
    assert "consensus 0.3%" in rows[0]["body"] and "Paris" in rows[0]["body"]


def test_keyword_on_news_items(tmp_path):
    async def go():
        svc, db, bus, clock = await make(tmp_path)
        await svc.create_rule("keyword", {"words": ["powell"]}, [])
        bus.publish("news:item:1", {"title": "Powell speaks at 14:00", "source": "Fed",
                                    "ts_recv": clock.t})
        bus.publish("news:item:2", {"title": "Powell again", "source": "Fed",
                                    "ts_recv": clock.t - 600_000})  # ancien : rejoué
        await svc.drain()
        rows = await db.query("select title from alert_events")
        await svc.stop()
        await db.close()
        return rows

    assert run(go()) == [{"title": "« powell » : Powell speaks at 14:00"}]


def test_ack_and_restart_keep_state(tmp_path):
    async def go():
        svc, db, bus, clock = await make(tmp_path)
        await svc.create_rule("price", {"inst": "BTC-USDT-SWAP", "level": "100"}, [])
        trade(bus, 99, 1)
        trade(bus, 101, 2)
        await svc.drain()
        acked = await svc.ack()
        await svc.stop()
        bus2 = Bus()
        svc2 = AlertService(bus2, db, settings(tmp_path), notifier=FakeNotifier(), clock=clock)
        await svc2.start()
        trade(bus2, 99, 3)  # règle déclenchée, non réarmée : rien
        trade(bus2, 101, 4)
        await svc2.drain()
        summary = bus2.get("alert:summary")
        fired = [bus2.get(k) for k in bus2.keys("alert:fired:")]
        await svc2.stop()
        await db.close()
        return acked, summary, fired

    acked, summary, fired = run(go())
    assert acked == 1 and summary["unacked"] == 0 and len(fired) == 1
    assert fired[0]["acked_ms"] == T0 and fired[0]["rule_label"] == "BTC franchit 100"


# --- REST ------------------------------------------------------------------------------------


def test_rest_routes_and_origin_guard(tmp_path):
    st = settings(tmp_path)
    app = create_app(st, bus=Bus())
    svc = next(s for s in app.state.services if s.name == "alert")
    svc.notifier = FakeNotifier()
    with TestClient(app) as client:
        ok = {"origin": "http://localhost:5173"}
        r = client.post("/api/alerts/rules", headers=ok, json={
            "kind": "price", "params": {"inst": "BTC-USDT-SWAP", "level": "120000"},
            "channels": ["telegram"]})
        assert r.status_code == 200 and r.json()["label"] == "BTC franchit 120\u202f000"
        rid = r.json()["id"]
        assert client.post("/api/alerts/rules", headers={"origin": "https://evil.example"},
                           json={"kind": "price", "params": {}}).status_code == 403
        assert client.post("/api/alerts/test-telegram", headers={**ok, "content-type":
                                                                 "text/plain"},
                           content="{}").status_code == 415
        assert client.post("/api/alerts/rules", headers=ok,
                           json={"kind": "price", "params": {"inst": "X", "level": "1"}}
                           ).status_code == 400
        assert client.patch(f"/api/alerts/rules/{rid}", headers=ok,
                            json={"state": "désactivée"}).json()["state"] == "désactivée"
        assert client.patch("/api/alerts/rules/999", headers=ok, json={}).status_code == 404
        t = client.post("/api/alerts/test-telegram", headers=ok, json={}).json()
        assert t["ok"] is True
        state = client.get("/api/alerts").json()
        assert len(state["rules"]) == 3
        assert client.delete(f"/api/alerts/rules/{rid}", headers=ok).json() == {"ok": True}
        assert client.post("/api/alerts/ack", headers=ok, json={"ids": "x"}).status_code == 400
        assert "alert" in client.get("/api/health").json()["services"]
