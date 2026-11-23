"""Suites de la capture (E3) : réaction du BTC, rattrapage (T-040), révisions par l'API v1.

Même horloge fictive et mêmes pages réelles que test_release_service.py : la
publication suivie est le communiqué révisé de la productivité du 08/12/2026.
"""

from __future__ import annotations

import asyncio
import gzip
import json
from pathlib import Path

from terminal_gateway import bls_api
from terminal_gateway.bls_release import RELEASES
from terminal_gateway.bus import Bus
from terminal_gateway.reaction import btc_reaction
from terminal_gateway.release_service import Fetched, ReleaseService, archive_url
from test_release_service import AFTER, BEFORE, PROD_URL, T, World, make

MIN = 60_000
FIX = Path(__file__).parent / "fixtures" / "bls"
API_REAL = gzip.decompress((FIX / "api_v1_2026-11-23.json.gz").read_bytes())
ARCHIVE = archive_url(RELEASES["prod2"], "2026-12-08")
NEWER = (AFTER.decode().replace("Tuesday, December 8, 2026", "Thursday, February 4, 2027", 1)
         .replace("Third Quarter 2026, Revised", "Fourth Quarter 2026, Preliminary")).encode()


def run(coro):
    return asyncio.run(coro)


def candles(start: int, end: int, price=lambda i: 90_000 + i, open_from: int | None = None):
    out = []
    for i, t in enumerate(range(start, end, MIN)):
        out.append({"t": t, "o": price(i), "h": price(i) + 5, "l": price(i) - 5, "c": price(i),
                    "confirmed": open_from is None or t < open_from})
    return out


def api_body(series: dict[str, dict[str, str]]) -> bytes:
    """Réponse de l'API v1 dans la forme réelle (périodes « M10 », « Q03 »)."""
    out = []
    for sid, points in series.items():
        data = []
        for i, (period, value) in enumerate(sorted(points.items(), reverse=True)):
            year, rest = period.split("-")
            code = f"Q0{rest[1]}" if rest.startswith("Q") else f"M{rest}"
            data.append({"year": year, "period": code, "value": value, "footnotes": [{}],
                         **({"latest": "true"} if i == 0 else {})})
        out.append({"seriesID": sid, "data": data})
    return json.dumps({"status": "REQUEST_SUCCEEDED", "responseTime": 5, "message": [],
                       "Results": {"series": out}}).encode()


class Api:
    def __init__(self, world: World, bodies: list[bytes | int]):
        self.world, self.bodies, self.calls = world, bodies, []

    async def post(self, url: str, body: dict) -> Fetched:
        self.calls.append(body)
        send = self.world.t
        self.world.t += 300
        nxt = self.bodies.pop(0) if len(self.bodies) > 1 else self.bodies[0]
        if isinstance(nxt, int):
            return Fetched(nxt, {}, b"", send, send + 100, self.world.t)
        return Fetched(200, {}, nxt, send, send + 100, self.world.t)


class Okx:
    def __init__(self, data: list[dict] | None = None, fail: bool = False):
        self.data, self.fail, self.calls = data or [], fail, []

    async def candles(self, inst: str, since_ms: int) -> list[dict]:
        self.calls.append((inst, since_ms))
        if self.fail:
            raise RuntimeError("OKX injoignable")
        return [c for c in self.data if c["t"] >= since_ms]


async def service(tmp_path, world: World, api: Api | None = None, okx: Okx | None = None,
                  email: str | None = "terminal@example.org"):
    svc, db, bus = await make(tmp_path, world, email=email)
    svc2 = ReleaseService(bus, db, svc.settings, fetch=world.fetch if email else None,
                          clock=world.clock, sleep=world.sleep, keep_awake=world.keep_awake,
                          api_post=api.post if api else None,
                          candles=(okx or Okx()).candles)
    return svc2, db, bus


async def add_release(db, indicator: str, period: str, value: str, scheduled_ms: int,
                      edition: str = "", release: str = "prod2") -> None:
    await db.execute(
        "insert into releases (indicator_id, release, period, edition, ny_date, value, timing,"
        " scheduled_ms, received_ms, url, machine) values (?, ?, ?, ?, '2026-01-01', ?,"
        " 'attendue', ?, ?, 'u', 'mac-test')",
        (indicator, release, period, edition, value, scheduled_ms, scheduled_ms + 2000))


# --- réaction du BTC ------------------------------------------------------------------


def test_reaction_reference_is_the_last_price_before_t():
    data = candles(T - 10 * MIN, T + 31 * MIN, price=lambda i: 100_000 + 100 * i)
    r = btc_reaction(data, T)
    assert len(r["candles"]) == 35 and r["missing"] == []
    assert r["ref_price"] == "100900.0"  # bougie T-1 min (i = 9 depuis T-10)
    assert r["end_price"] == "103900.0"  # bougie T+29 min (i = 39)
    assert r["change_pct"] == "2.97"  # 3 000 / 100 900


def test_reaction_with_gaps_keeps_the_reason():
    data = [c for c in candles(T - 10 * MIN, T + 31 * MIN) if c["t"] != T - MIN]
    r = btc_reaction(data, T)
    assert r["change_pct"] is None and "T-1 min" in r["reason"] and r["missing"] == [T - MIN]
    late = btc_reaction(candles(T - 10 * MIN, T + 31 * MIN, open_from=T + 29 * MIN), T)
    assert late["change_pct"] is None and "non clôturée" in late["reason"]


def test_reaction_recorded_at_t_plus_31_and_republished_at_start(tmp_path):
    okx = Okx(candles(T - 10 * MIN, T + 32 * MIN, price=lambda i: 90_000 - 10 * i))

    async def go():
        world = World(T + 31 * MIN)
        svc, db, bus = await service(tmp_path, world, okx=okx, email=None)
        await svc.followups()
        await svc.followups()  # déjà enregistrée : aucun nouvel appel
        rows = await db.query("select * from release_reactions")
        bus2 = Bus()
        svc2 = ReleaseService(bus2, db, svc.settings, clock=world.clock, candles=okx.candles)
        await svc2._publish_recent()
        await db.close()
        return rows, bus, bus2

    rows, bus, bus2 = run(go())
    assert len(okx.calls) == 1 and okx.calls[0] == ("BTC-USDT-SWAP", T - 5 * MIN)
    assert len(rows) == 1 and rows[0]["source"] == "OKX EEA REST"
    p = bus.get("reaction:prod2:2026-12-08")
    assert p["change_pct"] == "-0.33"  # 89 910 -> 89 610
    assert p["indicators"] == ["us-prod-qq", "us-ulc-qq"] and p["title"] == "Productivity and Costs"
    assert len(p["candles"]) == 35 and bus2.get("reaction:prod2:2026-12-08") == p


def test_unclosed_candle_retries_then_records_the_gap(tmp_path):
    okx = Okx(candles(T - 10 * MIN, T + 31 * MIN, open_from=T + 29 * MIN))

    async def go():
        world = World(T + 31 * MIN)
        svc, db, _ = await service(tmp_path, world, okx=okx, email=None)
        await svc.followups()
        first = await db.query("select * from release_reactions")
        world.t = T + 36 * MIN
        await svc.followups()
        world.t = T + 46 * MIN
        await svc.followups()
        rows = await db.query("select * from release_reactions")
        await db.close()
        return first, rows

    first, rows = run(go())
    assert first == [] and len(okx.calls) == 3
    assert rows[0]["change_pct"] is None and "non clôturée" in rows[0]["reason"]


def test_okx_keeps_only_24_hours(tmp_path):
    okx = Okx(candles(T - 10 * MIN, T + 31 * MIN))

    async def go():
        world = World(T + 24 * 3_600_000)
        svc, db, _ = await service(tmp_path, world, okx=okx, email=None)
        await svc.followups()
        await db.close()

    run(go())
    assert okx.calls == []


# --- rattrapage (T-040) -----------------------------------------------------------------


def test_catch_up_rereads_the_page_after_a_missed_capture(tmp_path):
    async def go():
        world = World(T + 40 * MIN)  # Mac en veille pendant la rafale
        svc, db, bus = await service(tmp_path, world, okx=Okx(fail=True))
        s = (await svc.past_scheduled(T - 1, T + 1))[0]
        verdict = await svc.catch_up(s)
        rows = await db.query("select * from releases where indicator_id = 'us-prod-qq'")
        timings = await db.query("select * from release_timings")
        polls = await db.query("select label, url, verdict from release_polls")
        await db.close()
        return world, verdict, rows, timings, polls, bus

    world, verdict, rows, timings, polls, bus = run(go())
    assert verdict == "attendue" and [u for _, u in world.requests] == [PROD_URL]
    assert rows[0]["value"] == "4.1" and rows[0]["nature"] == "rattrapage"
    assert timings == []  # un rattrapage ne mesure aucun délai
    assert polls == [{"label": "rattrapage", "url": PROD_URL, "verdict": "attendue"}]
    p = bus.get("release:us-prod-qq:2026-Q3:Revised")
    assert p["nature"] == "rattrapage" and p["capture_delay_ms"] is None
    assert bus.get("release:last")["nature"] == "rattrapage"


def test_catch_up_waits_for_a_late_release(tmp_path):
    async def go():
        world = World(T + 40 * MIN, publish_after_ms=10 * 3_600_000)
        svc, db, _ = await service(tmp_path, world, okx=Okx(fail=True))
        await svc.followups()
        await svc.followups()  # nouvel essai 30 min plus tard, pas avant
        n = await db.query("select count(*) as n from releases")
        await db.close()
        return world, svc, n[0]["n"]

    world, svc, n = run(go())
    assert n == 0 and len([u for _, u in world.requests if u == PROD_URL]) == 1
    assert "pas encore en ligne" in svc.catchup_notes["prod2"]


def test_catch_up_uses_the_archived_copy_when_a_newer_release_is_online(tmp_path):
    async def go():
        world = World(T + 40 * MIN)
        pages = {PROD_URL: NEWER, ARCHIVE: AFTER}

        async def fetch(url: str) -> Fetched:
            world.requests.append((world.t, url))
            world.t += 100
            return Fetched(200, {}, pages.get(url, b""), world.t - 100, world.t - 50, world.t)

        svc, db, _ = await service(tmp_path, world, okx=Okx(fail=True))
        svc._fetch = fetch
        s = (await svc.past_scheduled(T - 1, T + 1))[0]
        verdict = await svc.catch_up(s)
        rows = await db.query("select url from releases where indicator_id = 'us-prod-qq'")
        await db.close()
        return world, verdict, rows

    world, verdict, rows = run(go())
    assert ARCHIVE == "https://www.bls.gov/news.release/archives/prod2_12082026.htm"
    assert [u for _, u in world.requests] == [PROD_URL, ARCHIVE]
    assert verdict == "attendue" and rows[0]["url"] == ARCHIVE


def unreadable_world() -> World:
    return World(T + 2 * 3_600_000, null_until_ms=T + 10 * 86_400_000)


def test_unreadable_page_falls_back_to_the_api_marked_recalculated(tmp_path):
    q3 = api_body({"PRS85006092": {"2026-Q3": "3.6", "2026-Q2": "1.4"},
                   "PRS85006112": {"2026-Q3": "-0.7", "2026-Q2": "1.2"}})

    async def go():
        world = unreadable_world()
        api = Api(world, [q3])
        svc, db, bus = await service(tmp_path, world, api=api, okx=Okx(fail=True))
        await add_release(db, "us-prod-qq", "2026-Q2", "1.4", T - 60 * 86_400_000, "Revised")

        async def nulls(url: str) -> Fetched:
            world.requests.append((world.t, url))
            return Fetched(200, {}, b"\x00" * 500, world.t, world.t, world.t)

        svc._fetch = nulls
        s = (await svc.past_scheduled(T - 1, T + 1))[0]
        verdict = await svc.catch_up(s)
        rows = await db.query("select * from releases where period = '2026-Q3' order by"
                              " indicator_id")
        await db.close()
        return world, api, verdict, rows, bus

    world, api, verdict, rows, bus = run(go())
    assert len(world.requests) == 3 and len(api.calls) == 1  # .nr0, page complète, archive
    assert verdict == "inconnue"
    prod = next(r for r in rows if r["indicator_id"] == "us-prod-qq")
    assert (prod["value"], prod["nature"], prod["edition"], prod["regular"]) == (
        "3.6", "rattrapage API", "Preliminary", 0)
    assert prod["part"] == "API v1 (recalculé)" and "PRS85006092" in prod["excerpt"]
    assert bus.get("release:us-prod-qq:2026-Q3:Preliminary")["nature"] == "rattrapage API"


def test_api_fallback_refused_when_the_period_cannot_be_checked(tmp_path):
    async def go():
        world = unreadable_world()
        api = Api(world, [b"{}"])
        svc, db, _ = await service(tmp_path, world, api=api, okx=Okx(fail=True))
        await add_release(db, "us-prod-qq", "2026-Q3", "3.6", T - 33 * 86_400_000, "Preliminary")

        async def nulls(url: str) -> Fetched:
            return Fetched(200, {}, b"\x00" * 500, world.t, world.t, world.t)

        svc._fetch = nulls
        s = (await svc.past_scheduled(T - 1, T + 1))[0]
        verdict = await svc.catch_up(s)
        await db.close()
        return api, verdict, svc

    api, verdict, svc = run(go())
    assert verdict is None and api.calls == []
    assert "l'API ne dit pas si la valeur publiée est déjà la révisée" in svc.catchup_notes["prod2"]


# --- révisions ------------------------------------------------------------------------------


def test_revision_of_an_old_first_release_is_a_separate_line(tmp_path):
    async def go():
        world = World(T + 15 * MIN)
        api = Api(world, [API_REAL])
        svc, db, bus = await service(tmp_path, world, api=api, okx=Okx(fail=True))
        # Emploi de septembre 2026 publié le 09/10 à +29 k ; l'API dit +60 k aujourd'hui.
        await add_release(db, "us-nfp", "2026-09", "29", T - 60 * 86_400_000, release="empsit")
        await add_release(db, "us-cpi-mm", "2026-10", "0.4", T - 26 * 86_400_000,
                          release="cpi")
        n = await svc.check_revisions("révisions T+15min", T)
        again = await svc.check_revisions("révisions T+60min", T)
        revs = await db.query("select * from release_revisions")
        first = await db.query("select value from releases where indicator_id = 'us-nfp'")
        poll = await db.query("select verdict from release_polls where release = 'api-v1'")
        await db.close()
        return api, n, again, revs, first, poll, bus

    api, n, again, revs, first, poll, bus = run(go())
    assert n == 1 and again == 0 and len(api.calls) == 2
    assert api.calls[0]["startyear"] == "2025"
    r = revs[0]
    assert (r["indicator_id"], r["period"], r["kind"], r["previous"], r["value"]) == (
        "us-nfp", "2026-09", "révision", "29", "60")
    assert r["series"] == "CES0000000001" and r["poll_id"] is not None
    assert first[0]["value"] == "29"  # la première publication reste intacte
    assert "1 révision(s)" in poll[0]["verdict"]
    p = bus.get("release:us-nfp:2026-09")
    assert p["value"] == "29" and p["revisions"][0]["value"] == "60"


def test_api_lag_after_a_revised_release_is_not_a_revision(tmp_path):
    lag = api_body({"PRS85006092": {"2026-Q3": "3.6"}, "PRS85006112": {"2026-Q3": "-0.7"}})
    odd = api_body({"PRS85006092": {"2026-Q3": "4.3"}, "PRS85006112": {"2026-Q3": "-0.7"}})

    async def go():
        world = World(T + 15 * MIN)
        api = Api(world, [lag, odd])
        svc, db, _ = await service(tmp_path, world, api=api, okx=Okx(fail=True))
        await add_release(db, "us-prod-qq", "2026-Q3", "3.6", T - 33 * 86_400_000, "Preliminary")
        await add_release(db, "us-prod-qq", "2026-Q3", "4.1", T, "Revised")
        first = await svc.check_revisions()
        second = await svc.check_revisions()
        revs = await db.query("select kind, previous, value, edition from release_revisions")
        await db.close()
        return first, second, revs

    first, second, revs = run(go())
    assert first == 0  # l'API montre encore le préliminaire : retard, pas révision
    assert second == 1 and revs == [
        {"kind": "écart", "previous": "4.1", "value": "4.3", "edition": "Revised"}]


def test_api_checks_at_t15_t60_and_noon_new_york_one_per_pass(tmp_path):
    async def go():
        world = World(T + 15 * MIN)  # 08:45 New York
        api = Api(world, [API_REAL])
        svc, db, _ = await service(tmp_path, world, api=api, okx=Okx(fail=True))
        await add_release(db, "us-nfp", "2026-09", "29", T - 60 * 86_400_000, release="empsit")
        labels = []
        for t in (T + 15 * MIN, T + 16 * MIN, T + 61 * MIN, T + 62 * MIN,
                  T + 3 * 3_600_000 + 30 * MIN, T + 3 * 3_600_000 + 31 * MIN):
            world.t = t
            await svc._api_checks(t)
            labels.append(len(api.calls))
        polls = await db.query("select label from release_polls where release = 'api-v1'")
        await db.close()
        return labels, [p["label"] for p in polls]

    counts, labels = run(go())
    assert counts == [1, 1, 2, 2, 3, 3]
    assert labels == ["révisions T+15min", "révisions T+60min", "révisions quotidiennes"]


def test_daily_quota_and_429_stop_the_api(tmp_path):
    async def go():
        world = World(T + 15 * MIN)
        api = Api(world, [429])
        svc, db, _ = await service(tmp_path, world, api=api, okx=Okx(fail=True))
        await add_release(db, "us-nfp", "2026-09", "29", T - 60 * 86_400_000, release="empsit")
        await svc.check_revisions()
        await svc.check_revisions()  # bloquée jusqu'au lendemain (UTC) : aucun appel
        blocked = len(api.calls)
        svc._api_blocked_until = 0
        await db.executemany(
            "insert into release_polls (release, scheduled_ms, label, url, send_ms) values"
            " ('api-v1', 0, 'x', ?, ?)", [(bls_api.API_V1, world.t)] * 20)
        await svc.check_revisions()
        await db.close()
        return blocked, len(api.calls), svc.api_note

    blocked, total, note = run(go())
    assert blocked == 1 and total == 1
    assert note.startswith("quota du jour atteint (21/20")


def test_followups_without_email_never_touch_the_bls(tmp_path):
    async def go():
        world = World(T + 40 * MIN)
        api = Api(world, [API_REAL])
        svc, db, _ = await service(tmp_path, world, api=api, okx=Okx(fail=True), email=None)
        await svc.followups()
        await db.close()
        return world, api

    world, api = run(go())
    assert world.requests == [] and api.calls == []


def test_before_page_is_still_the_previous_release():
    # Garde-fou des scénarios ci-dessus : la page « avant » est bien le préliminaire du 05/11.
    assert b"November 5, 2026" in BEFORE and b"December 8, 2026" in AFTER
