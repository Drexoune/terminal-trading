"""Service « release » (E3) : rafale simulée sur une horloge fictive, avec les pages
réelles de la sonde du 20/11/2026. Scénario principal : la répétition du 08/12/2026
(productivité, communiqué révisé, même période que le préliminaire)."""

from __future__ import annotations

import asyncio
import gzip
import itertools
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from terminal_gateway.bus import Bus
from terminal_gateway.calendar_data import INDICATORS
from terminal_gateway.config import Settings
from terminal_gateway.release_service import Fetched, ReleaseService, burst_plan
from terminal_gateway.storage import Storage

FIX = Path(__file__).parent / "fixtures" / "bls"
PAGES: dict[str, str] = json.loads(
    gzip.decompress((FIX / "releases_2026-11-20.json.gz").read_bytes()))
NY = ZoneInfo("America/New_York")
T = int(datetime(2026, 12, 8, 8, 30, tzinfo=NY).timestamp() * 1000)
PROD_URL = "https://www.bls.gov/news.release/prod2.nr0.htm"
FULL_URL = "https://www.bls.gov/news.release/prod2.htm"

BEFORE = PAGES["prod2_nr0_2026-11-20"].encode()
AFTER = (PAGES["prod2_nr0_2026-11-20"]
         .replace("Thursday, November 5, 2026", "Tuesday, December 8, 2026", 1)
         .replace("Third Quarter 2026, Preliminary", "Third Quarter 2026, Revised")
         .replace("labor productivity increased 3.6 percent",
                  "labor productivity increased 4.1 percent", 1)).encode()


def settings(tmp_path: Path, email: str | None = "terminal@example.org") -> Settings:
    return Settings(okx_region="eea", instruments=("BTC-USDT-SWAP",), host="127.0.0.1",
                    port=0, allowed_origins=("http://localhost:5173",),
                    log_dir=tmp_path / "logs", stop_file=tmp_path / "stop", machine="mac-test",
                    services=("calendar", "release"), data_dir=tmp_path / "data",
                    bls_contact_email=email)


class World:
    """Horloge fictive ; le BLS met la page révisée en ligne à T + `publish_after_ms`."""

    def __init__(self, start_ms: int, publish_after_ms: int = 1_800,
                 statuses: dict[int, int] | None = None, null_until_ms: int | None = None):
        self.t = start_ms
        self.publish_at = T + publish_after_ms
        self.statuses = statuses or {}
        self.null_until = null_until_ms
        self.requests: list[tuple[int, str]] = []
        self.awake: list[str] = []

    def clock(self) -> int:
        return self.t

    async def sleep(self, s: float) -> None:
        self.t += round(s * 1000)

    async def fetch(self, url: str) -> Fetched:
        send = self.t
        self.requests.append((send, url))
        n = len(self.requests)
        self.t += 120  # aller-retour
        if n in self.statuses:
            return Fetched(self.statuses[n], {}, b"denied", send, send + 100, self.t)
        if self.null_until and send < self.null_until and url == PROD_URL:
            return Fetched(200, {}, b"\x00" * 1000, send, send + 100, self.t)
        body = AFTER if send >= self.publish_at else BEFORE
        return Fetched(200, {"date": "Tue, 08 Dec 2026 13:30:02 GMT"}, body, send, send + 80,
                       self.t)

    def keep_awake(self):
        self.awake.append("start")
        return lambda: self.awake.append("stop")


async def make(tmp_path: Path, world: World, email: str | None = "terminal@example.org",
               bus: Bus | None = None):
    db = Storage(tmp_path / "t.sqlite3")
    await db.open()
    await db.executemany(
        "insert into indicators (id, label_fr, currency, official_series, unit, capture)"
        " values (?, ?, ?, ?, ?, 1)",
        [(i.id, i.label_fr, i.currency, i.official_series, i.unit) for i in INDICATORS])
    seen = T - 86_400_000
    await db.executemany(
        "insert into official_releases (source, title, local_date, local_time, tz, utc_ms,"
        " first_seen_ms, last_seen_ms) values ('BLS', ?, ?, '08:30', 'America/New_York', ?, ?, ?)",
        [("Productivity and Costs", "2026-12-08", T, seen, seen),
         # Annoncé par un calendrier plus ancien, absent du dernier : date déplacée.
         ("Consumer Price Index", "2026-12-07", T - 86_400_000, seen - 1, seen - 1)])
    # Prévision ForexFactory relevée à hh:45 la veille de T, puis inchangée.
    snap = await db.execute(
        "insert into calendar_snapshots (source, url, status, received_ms) values"
        " ('ForexFactory', 'x', 200, ?)", (T - 45 * 60_000,))
    await db.execute(
        "insert into calendar_events (identity, indicator_id, title, currency, ff_time_ms,"
        " forecast_raw, forecast, previous_raw, first_seen_ms, last_seen_ms, snapshot_id)"
        " values ('prod|USD|2026-12-08|1', 'us-prod-qq', 'Revised Nonfarm Productivity q/q',"
        " 'USD', ?, '4.0%', '4.0', '3.6%', ?, ?, ?)",
        (T, T - 3 * 86_400_000, T - 45 * 60_000, snap))
    bus = bus or Bus()
    bus.publish("clock:okx", {"offset_ms": -12.0, "uncertainty_ms": 5, "ok": True})
    svc = ReleaseService(bus, db, settings(tmp_path, email), fetch=world.fetch,
                         clock=world.clock, sleep=world.sleep, keep_awake=world.keep_awake)
    return svc, db, bus


def run(coro):
    return asyncio.run(coro)


def test_burst_plan_is_about_a_hundred_requests_one_per_second_around_t():
    plan = burst_plan(T)
    assert len(plan) == 2 + 64 + 24
    times = [t for t, _ in plan]
    assert times == sorted(times)
    burst = [t for t, label in plan if label == "rafale"]
    assert burst[0] == T - 3000 + 50 and burst[-1] == T + 60_000 + 50
    assert all(b - a == 1000 for a, b in itertools.pairwise(burst))
    assert plan[-1] == (T + 300_000, "fin")


def test_next_scheduled_skips_releases_no_longer_announced(tmp_path):
    async def go():
        svc, db, _ = await make(tmp_path, World(T - 2 * 86_400_000))
        s = await svc.next_scheduled()
        await db.close()
        return s

    s = run(go())
    assert s is not None and s.release.key == "prod2" and s.utc_ms == T


def test_rehearsal_capture_of_revised_productivity(tmp_path):
    async def go():
        world = World(T - 15 * 60_000, publish_after_ms=1_800)
        svc, db, bus = await make(tmp_path, world)
        s = await svc.next_scheduled()
        from terminal_gateway.release_service import Capture
        cap = Capture(s)
        parsed = await svc.run_capture(cap)
        rows = await db.query("select * from releases order by indicator_id")
        timings = await db.query("select * from release_timings")
        polls = await db.query("select label, verdict from release_polls order by id")
        ok = await svc.record_display("release:us-prod-qq:2026-Q3:Revised", world.t + 40)
        again = await svc.record_display("release:us-prod-qq:2026-Q3:Revised", world.t + 900)
        disp = await db.query("select display_ms from release_timings")
        await db.close()
        return world, cap, parsed, rows, timings, polls, bus, ok, again, disp

    world, cap, parsed, rows, timings, polls, bus, ok, again, disp = run(go())
    assert parsed is not None and cap.phase == "capté"
    assert world.awake == ["start", "stop"]
    # T-10min, T-60s, puis T-3s … T+2s : la page révisée apparaît à T+1,8 s.
    assert [u for _, u in world.requests] == [PROD_URL] * 8
    assert polls[0] == {"label": "T-10min", "verdict": "référence"}
    assert polls[-1] == {"label": "rafale", "verdict": "attendue"}
    assert cap.baseline == ("2026-Q3", "2026-11-05")
    assert cap.baseline_read == "2/2 chiffres lus sur la publication précédente (2026-Q3)"

    prod = next(r for r in rows if r["indicator_id"] == "us-prod-qq")
    assert (prod["value"], prod["period"], prod["edition"], prod["timing"]) == (
        "4.1", "2026-Q3", "Revised", "attendue")
    assert (prod["forecast"], prod["surprise"], prod["z"], prod["z_reason"]) == (
        "4.0", "0.1", None, "historique insuffisant (0/8)")
    assert prod["forecast_seen_ms"] == T - 45 * 60_000
    assert prod["machine"] == "mac-test" and prod["url"] == PROD_URL
    ulc = next(r for r in rows if r["indicator_id"] == "us-ulc-qq")
    assert ulc["value"] == "-0.7" and ulc["surprise"] is None

    t = timings[0]
    assert t["last_without_ms"] == T + 1000 + 50 - 0  # requête de T+1 s, sans le chiffre
    assert t["first_send_ms"] == T + 2000 + 50
    assert t["okx_offset_ms"] == -12.0 and t["date_header"].startswith("Tue, 08 Dec 2026")

    p = bus.get("release:us-prod-qq:2026-Q3:Revised")
    assert p["value"] == "4.1" and p["forecast_age_ms"] == 45 * 60_000
    assert p["capture_delay_ms"] == 2050 + 80 - 12  # premier octet - T, horloge OKX
    assert p["label_fr"] == "Productivité non agricole (t/t)" and p["unit"] == "%"
    assert bus.get("release:last")["keys"] == [
        "release:us-prod-qq:2026-Q3:Revised", "release:us-ulc-qq:2026-Q3:Revised"]
    assert ok and not again
    assert disp[0]["display_ms"] == bus.get("release:us-prod-qq:2026-Q3:Revised")["display_ms"]


def test_first_release_is_never_overwritten(tmp_path):
    async def go():
        world = World(T - 15 * 60_000)
        svc, db, _ = await make(tmp_path, world)
        from terminal_gateway.release_service import Capture
        s = await svc.next_scheduled()
        await svc.run_capture(Capture(s))
        world2 = World(T - 15 * 60_000)  # même publication relue (redémarrage)
        svc2 = ReleaseService(svc.bus, db, svc.settings, fetch=world2.fetch,
                              clock=world2.clock, sleep=world2.sleep,
                              keep_awake=world2.keep_awake)
        await svc2.run_capture(Capture(s))
        rows = await db.query("select count(*) as n from releases where indicator_id ="
                              " 'us-prod-qq'")
        nxt = await svc.next_scheduled()
        await db.close()
        return rows[0]["n"], nxt

    n, nxt = run(go())
    assert n == 1
    assert nxt is None  # déjà capté : plus rien à planifier


def test_403_stops_the_burst_without_workaround(tmp_path):
    async def go():
        world = World(T - 15 * 60_000, statuses={3: 403})
        svc, db, bus = await make(tmp_path, world)
        from terminal_gateway.release_service import Capture
        cap = Capture(await svc.next_scheduled())
        parsed = await svc.run_capture(cap)
        await db.close()
        return world, cap, parsed, bus

    world, cap, parsed, bus = run(go())
    assert parsed is None and cap.phase == "bloqué" and len(world.requests) == 3
    assert bus.get("feed:bls-release")["status"] == "stopped"
    assert bus.get("release:state")["phase"] == "bloqué"
    assert world.awake == ["start", "stop"]


def test_null_bytes_switch_to_the_full_page(tmp_path):
    async def go():
        world = World(T - 15 * 60_000, publish_after_ms=1_800, null_until_ms=T + 5_000)
        svc, db, _ = await make(tmp_path, world)
        from terminal_gateway.release_service import Capture
        cap = Capture(await svc.next_scheduled())
        parsed = await svc.run_capture(cap)
        await db.close()
        return world, cap, parsed

    world, cap, parsed = run(go())
    urls = [u for _, u in world.requests]
    assert urls[0] == PROD_URL and urls[1] == FULL_URL  # page vide -> page complète
    assert parsed is not None and parsed.figures["us-prod-qq"].value == "4.1"
    assert any("octets nuls" in p for p in cap.problems)


def test_late_requests_are_skipped_not_caught_up(tmp_path):
    async def go():
        world = World(T + 30_000)  # passerelle lancée à T+30 s (Mac sorti de veille)
        svc, db, _ = await make(tmp_path, world)
        from terminal_gateway.release_service import Capture
        cap = Capture(await svc.next_scheduled())
        await svc.run_capture(cap)
        await db.close()
        return world

    world = run(go())
    assert world.requests[0][0] >= T + 30_000
    assert len(world.requests) == 1  # la page lue est déjà la nouvelle : capturée d'emblée


def test_without_contact_email_the_service_stays_stopped(tmp_path):
    async def go():
        world = World(T - 3_600_000)
        svc, db, bus = await make(tmp_path, world, email=None)
        await svc.start()
        await svc.stop()
        await db.close()
        return bus

    bus = run(go())
    feed = bus.get("feed:bls-release")
    assert feed["status"] == "stopped" and "BLS_CONTACT_EMAIL" in feed["last_error"]


def test_recent_releases_are_republished_at_start(tmp_path):
    async def go():
        world = World(T - 15 * 60_000)
        svc, db, _ = await make(tmp_path, world)
        from terminal_gateway.release_service import Capture
        await svc.run_capture(Capture(await svc.next_scheduled()))
        bus2 = Bus()
        svc2 = ReleaseService(bus2, db, svc.settings, fetch=world.fetch, clock=world.clock,
                              sleep=world.sleep, keep_awake=world.keep_awake)
        await svc2._publish_recent()
        await db.close()
        return bus2

    bus2 = run(go())
    p = bus2.get("release:us-prod-qq:2026-Q3:Revised")
    assert p["value"] == "4.1" and p["surprise"] == "0.1"


@pytest.mark.parametrize("bad", [None, "x", 10**15])
def test_display_ack_rejects_nonsense(tmp_path, bad):
    async def go():
        world = World(T - 15 * 60_000)
        svc, db, _ = await make(tmp_path, world)
        from terminal_gateway.release_service import Capture
        await svc.run_capture(Capture(await svc.next_scheduled()))
        ok = await svc.record_display("release:us-prod-qq:2026-Q3:Revised", bad)
        await db.close()
        return ok

    assert run(go()) is False
