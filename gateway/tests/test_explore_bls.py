"""scripts/explore_bls.py : rafale simulée de bout en bout (faux serveur, fausse horloge).

La mesure du PPI du 13/11/2026 n'a qu'une seule chance : on vérifie ici le
calendrier des requêtes, la détection de la nouvelle publication, l'arrêt sur
403 et l'archive produite, sans rien envoyer au BLS.
"""

import asyncio
import importlib.util
import itertools
import json
import sys
import zipfile
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("explore_bls", ROOT / "scripts" / "explore_bls.py")
bls = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = bls
_spec.loader.exec_module(bls)

T = bls.parse_release_time("2026-11-13 08:30")   # 13:30:00 UTC

PAGE = ("<html><head><title>Producer Price Index News Release summary - {y} M{m} Results"
        "</title></head><body><pre>Transmission of material in this release is embargoed until "
        "8:30 a.m. (ET) {day}</pre><p>The Producer Price Index for final demand {verb}.</p>"
        "</body></html>")
OLD = PAGE.format(y=2026, m="09", day="Thursday, October 15, 2026", verb="rose 1.3 percent")
NEW = PAGE.format(y=2026, m=10, day="Friday, November 13, 2026", verb="increased 0.2 percent")


class FakeClock:
    """Horloge simulée : sleep() avance le temps sans attendre."""

    def __init__(self, start: float) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    async def sleep(self, delay: float) -> None:
        self.t += max(0.0, delay)
        await asyncio.sleep(0)


def server(clock: FakeClock, publish_at: float, blocked_after: float | None = None):
    calls: list[tuple[float, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        calls.append((clock(), url))
        if "okx.com" in url:
            ts = str(int(clock() * 1000))
            return httpx.Response(200, json={"code": "0", "data": [{"ts": ts}]})
        if "api.bls.gov" in url:
            return httpx.Response(200, json={"status": "REQUEST_SUCCEEDED", "Results": {}})
        if blocked_after is not None and clock() >= blocked_after:
            return httpx.Response(403, text="Access Denied")
        if url.endswith("ppi.nr0.htm"):
            body = NEW if clock() >= publish_at else OLD
            return httpx.Response(200, text=body, headers={"Last-Modified": "x", "Age": "0"})
        return httpx.Response(200, text="<html><title>autre</title></html>")

    return calls, httpx.MockTransport(handler)


def run(tmp_path: Path, clock: FakeClock, transport: httpx.MockTransport) -> tuple[dict, Path]:
    rec = bls.Recorder(tmp_path, "burst_ppi")

    async def go() -> dict:
        async with bls.make_client("terminal-trading/0.1 (test@example.org)", transport) as client:
            return await bls.run_burst(client, rec, "ppi", T, clock=clock, sleep=clock.sleep)

    summary = asyncio.run(go())
    return summary, rec.close_and_zip()


def lines(archive: Path) -> list[dict]:
    with zipfile.ZipFile(archive) as z:
        name = next(n for n in z.namelist() if n.endswith("requests.jsonl"))
        return [json.loads(x) for x in z.read(name).decode().splitlines()]


def test_plan_respects_one_request_per_second():
    plan = bls.burst_plan(T)
    times = [t for t, _ in plan]
    assert times == sorted(times)
    burst = [t for t, label in plan if label == "burst"]
    api = [t for t, label in plan if label.startswith("api-v1")]
    assert len(api) == 4 and min(api) > T + 60   # jamais pendant la seconde par seconde
    assert len(burst) == 64 and burst[0] == pytest.approx(T - 3 + 0.05)
    assert min(b - a for a, b in itertools.pairwise(burst)) >= 1.0
    assert plan[0] == (T - 600, "T-10min")
    assert len(plan) < 110        # environ 100 requêtes par publication, pas plus


def test_burst_detects_new_release_between_two_polls(tmp_path):
    clock = FakeClock(T - 700)
    calls, transport = server(clock, publish_at=T + 1.4)
    summary, archive = run(tmp_path, clock, transport)

    assert summary["blocked"] is False
    assert summary["baseline"] == "2026-09"
    assert summary["first_new"]["period"] == "2026-10"
    assert summary["first_new"]["embargo"] == "8:30 a.m. (ET) Friday, November 13, 2026"
    assert summary["last_before"]["period"] == "2026-09"
    # Une seule requête en vol, jamais deux sur la page principale dans la même seconde.
    primary = [t for t, u in calls if u.endswith("ppi.nr0.htm")]
    assert min(b - a for a, b in itertools.pairwise(primary)) >= 1.0
    # API v1 : quatre requêtes au plus (25 par jour sans clé), après la rafale.
    api = [t for t, u in calls if "api.bls.gov" in u]
    assert len(api) == 4 and min(api) > T + 60
    # Pages relues une fois après la détection : communiqué complet et table 1.
    assert sum(u.endswith(("ppi.htm", "ppi.t01.htm")) for _, u in calls) == 2
    recorded = lines(archive)
    assert recorded[0]["label"] == "plan" and recorded[-1]["label"] == "summary"
    assert any(x["label"] == "okx-clock" for x in recorded)
    with zipfile.ZipFile(archive) as z:   # deux versions distinctes de la page gardées
        assert sum("ppi.nr0.htm." in n for n in z.namelist()) == 2


def test_burst_stops_at_once_on_403(tmp_path):
    clock = FakeClock(T - 700)
    calls, transport = server(clock, publish_at=T + 5, blocked_after=T + 2)
    summary, archive = run(tmp_path, clock, transport)
    assert summary["blocked"] is True
    after_block = [t for t, u in calls if u.endswith("ppi.nr0.htm") and t >= T + 2]
    assert len(after_block) == 1, "aucune requête après le premier refus"
    assert any(x["label"] == "blocked" and x["status"] == 403 for x in lines(archive))


def test_null_byte_page_is_not_a_new_release(tmp_path):
    clock = FakeClock(T - 700)
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "okx.com" in url:
            return httpx.Response(200, json={"code": "0", "data": [{"ts": "0"}]})
        if "api.bls.gov" in url:
            return httpx.Response(200, json={})
        seen.append(clock())
        if T <= clock() < T + 3:         # pool d'origine défaillant : 200 plein d'octets nuls
            return httpx.Response(200, content=b"\x00" * 4096)
        return httpx.Response(200, text=NEW if clock() >= T + 3 else OLD)

    summary, _ = run(tmp_path, clock, httpx.MockTransport(handler))
    assert summary["first_new"]["period"] == "2026-10"
    assert summary["first_new"]["t_send_ms"] is not None


def test_late_start_skips_past_slots(tmp_path):
    clock = FakeClock(T + 30)            # lancé en retard : pas de rattrapage des secondes passées
    calls, transport = server(clock, publish_at=T)
    run(tmp_path, clock, transport)
    primary = [t for t, u in calls if u.endswith("ppi.nr0.htm")]
    assert min(primary) >= T + 30


@pytest.mark.parametrize("email", [None, "", "pas-une-adresse", "https://x.org", "a b@c.org"])
def test_contact_is_required(email):
    with pytest.raises(SystemExit, match="BLS_CONTACT_EMAIL"):
        bls.contact_user_agent(email)


def test_user_agent_format():
    ua = bls.contact_user_agent(" terminal@exemple.org ")
    assert ua == "terminal-trading/0.1 (terminal@exemple.org)"


def test_describe_reads_title_period_and_embargo():
    d = bls.describe(NEW.encode())
    assert d == {"null_bytes": 0,
                 "title": "Producer Price Index News Release summary - 2026 M10 Results",
                 "period": "2026-10", "embargo": "8:30 a.m. (ET) Friday, November 13, 2026"}


def test_release_time_is_new_york_time_across_dst():
    assert bls.parse_release_time("2026-11-13 08:30") == 1794576600       # 13:30 UTC (EST)
    assert bls.parse_release_time("2026-10-15 08:30") == 1792067400       # 12:30 UTC (EDT)


def test_describe_reads_quarterly_period():
    page = PAGE.replace("Producer Price Index News Release summary - {y} M{m} Results",
                        "Productivity and Costs summary - {y} Q{m} Results")
    d = bls.describe(page.format(y=2026, m="03", day="Tuesday, December 8, 2026",
                                 verb="increased").encode())
    assert d["period"] == "2026-Q3"
    assert d["embargo"] == "8:30 a.m. (ET) Tuesday, December 8, 2026"


def test_prod2_is_known_for_burst_and_archives():
    assert "prod2" in bls.EVENTS and "prod2" in bls.ARCHIVE_INDEX
    assert bls.EVENTS["prod2"]["primary"].endswith("/news.release/prod2.nr0.htm")
