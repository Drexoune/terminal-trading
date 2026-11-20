"""Agenda (étape E2) sur les réponses réelles du 20/11/2026 : XML ForexFactory
(extrait de 11 événements, heures en UTC) et calendrier iCalendar du BLS."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from terminal_gateway.app import create_app
from terminal_gateway.bus import Bus
from terminal_gateway.calendar_data import (
    attach_official,
    event_dict,
    parse_bls_ics,
    parse_ff_xml,
    parse_value,
    week_bounds,
    week_id,
)
from terminal_gateway.calendar_service import (
    BLS_ICS_URL,
    FF_URL,
    CalendarService,
    _seconds_to_minute,
)
from terminal_gateway.config import Settings
from terminal_gateway.storage import Storage

FIX = Path(__file__).parent / "fixtures" / "calendar"
FF = (FIX / "ff_calendar_thisweek_2026-11-20.xml").read_bytes()
ICS = (FIX / "bls_2026-11-20.ics").read_text(encoding="utf-8")


def ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp() * 1000)


def with_cpi(xml: bytes) -> bytes:
    """Extrait réel où « Retail Sales m/m » devient le CPI du 10/12 (aucun CPI cette semaine)."""
    s = xml.decode("cp1252")
    s = s.replace("<title>Retail Sales m/m</title>", "<title>CPI m/m</title>", 1)
    s = s.replace(
        "<![CDATA[11-17-2026]]></date>\n\t\t<time><![CDATA[1:30pm]]></time>\n\t\t<impact><![CDATA[High]]>"
        "</impact>\n\t\t<forecast><![CDATA[0.1%]]>",
        "<![CDATA[12-10-2026]]></date>\n\t\t<time><![CDATA[1:30pm]]></time>\n\t\t<impact><![CDATA[High]]>"
        "</impact>\n\t\t<forecast><![CDATA[0.1%]]>",
        1,
    )
    return s.encode("cp1252")


# --- analyse ------------------------------------------------------------------------


def test_ff_xml_times_are_utc_and_series_come_from_url():
    evs = parse_ff_xml(FF)
    assert len(evs) == 11
    core = next(e for e in evs if e.title == "Core Retail Sales m/m")
    # 1:30pm UTC le 17/11 = 08:30 à New York (heure d'hiver).
    assert core.time_ms == ms("2026-11-17T13:30:00+00:00")
    assert core.ny_date == "2026-11-17"
    assert core.series == "112-us-core-retail-sales-mm"
    assert core.identity == "112-us-core-retail-sales-mm|USD|2026-11-17|1"
    assert (core.impact, core.forecast_raw, core.previous_raw) == ("High", "0.4%", "0.9%")
    nz = evs[0]
    # 9:30pm UTC le 15/11 = 16:30 à New York le même jour (JSON : 2026-11-15T16:30:00-05:00).
    assert nz.time_ms == ms("2026-11-15T16:30:00-05:00") and nz.ny_date == "2026-11-15"
    assert all(e.indicator is None for e in evs)


def test_special_times_and_rank_of_repeated_events():
    s = FF.decode("cp1252").replace("<![CDATA[7:00pm]]>", "<![CDATA[Tentative]]>")
    fomc = next(e for e in parse_ff_xml(s.encode("cp1252")) if e.title == "FOMC Meeting Minutes")
    assert fomc.time_ms is None and fomc.time_raw == "Tentative" and fomc.ny_date == "2026-11-18"
    d = event_dict(fomc, None)
    assert (d["time_ms"], d["time_kind"]) == (None, "Tentative")
    # Même série deux fois le même jour (discours répétés…) : rang 1 puis 2.
    txt = FF.decode("cp1252")
    block = txt[txt.index("\t<event>\n\t\t<title>Prelim GDP Price Index y/y") :]
    block = block[: block.index("</event>") + len("</event>\n")]
    twice = txt.replace(block, block + block).encode("cp1252")
    ids = [e.identity for e in parse_ff_xml(twice) if e.title == "Prelim GDP Price Index y/y"]
    assert [i[-2:] for i in ids] == ["|1", "|2"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0.4%", ("0.4", "%")),
        ("198K", ("198", "K")),
        ("-0.90T", ("-0.90", "T")),
        ("1.25M", ("1.25", "M")),
        ("14.85B", ("14.85", "B")),
        ("-18", ("-18", "")),
        ("", (None, None)),
        ("<0.1%", (None, None)),
    ],
)
def test_parse_value(raw, expected):
    assert parse_value(raw) == expected


def test_bls_ics_new_york_times_across_us_dst_change():
    releases, problems = parse_bls_ics(ICS)
    assert problems == []
    by = {(r.title, r.local_date): r for r in releases}
    cpi = by[("Consumer Price Index", "2026-12-10")]
    assert (cpi.local_time, cpi.tz) == ("08:30", "America/New_York")
    assert cpi.utc_ms == ms("2026-12-10T13:30:00+00:00")  # heure d'hiver : UTC-5
    oct_ = next(r for r in releases if r.local_date < "2026-11-01" and r.local_time == "08:30")
    assert datetime.fromtimestamp(oct_.utc_ms / 1000, UTC).hour == 12  # heure d'été : UTC-4
    # Le 10/12, deux publications (IPC, Real Earnings) : deux problèmes signalés.
    probs = parse_bls_ics(ICS.replace("TZID=US-Eastern:20261210", "TZID=Mars:20261210"))[1]
    assert probs == ["zone inconnue : Mars", "zone inconnue : Mars"]


def test_official_time_attached_to_captured_indicator():
    evs = parse_ff_xml(with_cpi(FF))
    releases, _ = parse_bls_ics(ICS)
    cpi = next(e for e in evs if e.title == "CPI m/m")
    assert cpi.indicator.id == "us-cpi-mm" and cpi.ny_date == "2026-12-10"
    official = attach_official(evs, releases)
    d = event_dict(cpi, official[cpi.identity])
    assert d["time_ms"] == ms("2026-12-10T13:30:00+00:00")
    assert (d["time_source"], d["time_kind"], d["time_mismatch"]) == ("BLS", "officielle", False)
    assert d["official"] == {
        "local_date": "2026-12-10",
        "local_time": "08:30",
        "tz": "America/New_York",
        "release": "Consumer Price Index",
    }
    assert (d["forecast"], d["unit"], d["title_fr"], d["capture"]) == (
        "0.1",
        "%",
        "IPC (m/m)",
        True,
    )
    other = event_dict(next(e for e in evs if e.title == "Core Retail Sales m/m"), None)
    assert (other["time_source"], other["time_kind"], other["capture"]) == (
        "ForexFactory",
        "indicative",
        False,
    )


def test_weeks_run_sunday_to_saturday_in_new_york():
    assert week_id("2026-11-15") == "2026-W47"  # dimanche
    assert week_id("2026-11-21") == "2026-W47"  # samedi
    assert week_id("2026-11-22") == "2026-W48"
    assert week_bounds("2026-W47") == ("2026-11-15", "2026-11-21")
    with pytest.raises(ValueError):
        week_bounds("47")


def test_seconds_to_next_hh45():
    assert _seconds_to_minute(ms("2026-11-20T16:03:00+00:00"), 45) == 42 * 60
    assert _seconds_to_minute(ms("2026-11-20T16:45:00+00:00"), 45) == 3600


# --- service ------------------------------------------------------------------------

NOW = ms("2026-11-17T10:00:00+00:00")


class FakeHttp:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.ff: list[tuple[int, dict, bytes]] = []
        self.bls: list[tuple[int, dict, bytes]] = []

    async def __call__(self, url, headers):
        self.calls.append((url, headers))
        queue = self.ff if url == FF_URL else self.bls
        return queue.pop(0) if len(queue) > 1 else queue[0]


def settings(tmp_path, email="terminal@exemple.org") -> Settings:
    return Settings(
        okx_region="eea",
        instruments=(),
        host="127.0.0.1",
        port=0,
        allowed_origins=(),
        log_dir=tmp_path / "logs",
        stop_file=tmp_path / "stop",
        data_dir=tmp_path / "data",
        services=("calendar",),
        bls_contact_email=email,
    )


H_FF = {"etag": 'W/"6b006a5a-a99b"', "last-modified": "Fri, 20 Nov 2026 15:42:18 GMT"}


async def service(tmp_path, http, email="terminal@exemple.org"):
    db = Storage(tmp_path / "data" / "t.sqlite3")
    await db.open()
    bus = Bus()
    svc = CalendarService(bus, db, settings(tmp_path, email), http_get=http, clock=lambda: NOW)
    await svc._seed_indicators()
    return svc, bus, db


async def test_fetch_publishes_week_next_and_feeds_then_conditional_304(tmp_path):
    http = FakeHttp()
    http.ff = [(200, H_FF, FF), (304, {}, b"")]
    svc, bus, db = await service(tmp_path, http)
    await svc.fetch_ff()
    week = bus.get("calendar:week:2026-W47")
    assert week["from"] == "2026-11-15" and len(week["events"]) == 11
    assert week["forexfactory"] == {
        "source_ts_ms": ms("2026-11-20T15:42:18+00:00"),
        "received_ms": NOW,
    }
    assert [e["time_ms"] for e in week["events"]] == sorted(e["time_ms"] for e in week["events"])
    nxt = bus.get("calendar:next")["events"]
    # Le 17/11 à 10:00 UTC : le discours du 16/11 est passé ; Fort ou Moyen seulement, dans l'ordre.
    assert all(e["time_ms"] > NOW and e["impact"] in ("High", "Medium") for e in nxt)
    assert [e["title"] for e in nxt][:3] == [
        "Core Retail Sales m/m",
        "Retail Sales m/m",
        "FOMC Meeting Minutes",
    ]
    assert len(nxt) == 5
    feed = bus.get("feed:calendar")
    assert (
        feed["status"] == "connected"
        and feed["last_message_ms"] == NOW
        and feed["label"] == "Agenda"
    )
    assert feed["stale_after_ms"] == 3 * 3_600_000

    await svc.fetch_ff()
    assert http.calls[-1][1]["If-None-Match"] == 'W/"6b006a5a-a99b"'
    assert http.calls[-1][1]["If-Modified-Since"] == "Fri, 20 Nov 2026 15:42:18 GMT"
    snaps = await db.query(
        "select status, body is null as empty from calendar_snapshots order by id"
    )
    assert snaps == [{"status": 200, "empty": 0}, {"status": 304, "empty": 1}]
    assert (await db.query("select count(*) as n from calendar_events"))[0]["n"] == 11
    await db.close()


async def test_revised_forecast_is_a_new_version_first_kept(tmp_path):
    http = FakeHttp()
    revised = FF.replace(
        b"<forecast><![CDATA[0.4%]]></forecast>", b"<forecast><![CDATA[0.5%]]></forecast>", 1
    )
    http.ff = [(200, H_FF, FF), (200, {**H_FF, "etag": 'W/"x"'}, revised)]
    svc, _bus, db = await service(tmp_path, http)
    await svc.fetch_ff()
    await svc.fetch_ff()
    rows = await db.query(
        "select forecast_raw from calendar_events where identity like '112-%' order by id"
    )
    assert [r["forecast_raw"] for r in rows] == ["0.4%", "0.5%"]
    week = await svc.week("2026-W47")
    assert (
        next(e for e in week["events"] if e["series"] == "112-us-core-retail-sales-mm")["forecast"]
        == "0.5"
    )
    await db.close()


async def test_http_error_is_raised_for_retry(tmp_path):
    http = FakeHttp()
    http.ff = [(503, {}, b"")]
    svc, _bus, db = await service(tmp_path, http)
    with pytest.raises(RuntimeError, match="HTTP 503"):
        await svc.fetch_ff()
    await db.close()


async def test_bls_needs_contact_then_detects_moved_releases(tmp_path):
    http = FakeHttp()
    svc, bus, db = await service(tmp_path, http, email=None)
    await svc.fetch_bls()
    assert http.calls == []
    assert bus.get("feed:bls-calendar")["status"] == "stopped"
    assert "BLS_CONTACT_EMAIL" in bus.get("feed:bls-calendar")["last_error"]

    svc.settings = replace(svc.settings, bls_contact_email="terminal@exemple.org")
    ticks = iter(range(NOW, NOW + 10**9, 60_000))  # chaque relevé une minute après le précédent
    svc.clock = lambda: next(ticks)
    moved = ICS.replace(
        "DTSTART;TZID=US-Eastern:20261210T083000\nDURATION:PT0M\nSUMMARY:Consumer Price Index",
        "DTSTART;TZID=US-Eastern:20261211T083000\nDURATION:PT0M\nSUMMARY:Consumer Price Index",
    )
    assert moved != ICS
    http.bls = [(200, {"etag": '"a"'}, ICS.encode()), (200, {"etag": '"b"'}, moved.encode())]
    await svc.fetch_bls()
    assert http.calls[0][0] == BLS_ICS_URL
    assert http.calls[0][1]["User-Agent"] == "terminal-trading/0.1 (terminal@exemple.org)"
    off = bus.get("calendar:official")
    assert off["releases"][0]["title"] in (
        "Employment Situation",
        "Productivity and Costs",
        "Consumer Price Index",
        "Producer Price Index",
    )
    assert off["moved"] == []
    await svc.fetch_bls()
    assert http.calls[1][1]["If-None-Match"] == '"a"'
    assert [(m["title"], m["local_date"]) for m in bus.get("calendar:official")["moved"]] == [
        ("Consumer Price Index", "2026-12-10")
    ]
    await db.close()


async def test_restart_shows_last_archived_week_without_network(tmp_path):
    http = FakeHttp()
    http.ff = [(200, H_FF, FF)]
    svc, _bus, db = await service(tmp_path, http)
    await svc.fetch_ff()
    await db.close()
    db2 = Storage(tmp_path / "data" / "t.sqlite3")
    await db2.open()
    bus2 = Bus()
    svc2 = CalendarService(bus2, db2, settings(tmp_path), http_get=FakeHttp(), clock=lambda: NOW)
    await svc2._load_last()
    svc2._publish_all()
    assert len(bus2.get("calendar:week:2026-W47")["events"]) == 11
    assert svc2.ff_meta["etag"] == 'W/"6b006a5a-a99b"'
    await db2.close()


def test_rest_calendar_and_health(tmp_path):
    http = FakeHttp()
    http.ff = [(200, H_FF, FF)]
    http.bls = [(200, {}, ICS.encode())]
    db = Storage(tmp_path / "data" / "t.sqlite3")
    bus = Bus()
    svc = CalendarService(bus, db, settings(tmp_path), http_get=http, clock=lambda: NOW)
    app = create_app(settings(tmp_path), bus=bus, services=[svc], storage=db)
    with TestClient(app) as client:
        for _ in range(50):
            if bus.get("calendar:week:2026-W47"):
                break
            import time

            time.sleep(0.02)
        r = client.get("/api/calendar")
        assert (
            r.status_code == 200 and r.json()["week"] == "2026-W47" and r.json()["archive"] is False
        )
        old = client.get("/api/calendar?week=2026-W40").json()
        assert old == {**old, "archive": True, "events": []}
        assert client.get("/api/calendar?week=47").status_code == 400
        h = client.get("/api/health").json()["services"]["calendar"]
        assert h["forexfactory"]["status"] == "connected" and h["events"] == 11
