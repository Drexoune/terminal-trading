"""API v1 du BLS : réponse réelle du 23/11/2026 et corpus de 124 communiqués du 20/11/2026.

Le test central : pour la dernière période de chaque indicateur (pas encore
révisée), la valeur recalculée depuis l'API est exactement celle de la première
publication lue par le parseur. Sans ça, une « révision » ne serait qu'un artefact
d'arrondi.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest
from terminal_gateway import bls_api
from terminal_gateway.bls_release import parse_page

FIX = Path(__file__).parent / "fixtures" / "bls"
RAW = gzip.decompress((FIX / "api_v1_2026-11-23.json.gz").read_bytes())
PAGES: dict[str, str] = json.loads(
    gzip.decompress((FIX / "releases_2026-11-20.json.gz").read_bytes()))
DATA = bls_api.parse_response(RAW)


def first_releases() -> dict[str, dict[str, str]]:
    """Indicateur -> période -> première publication, d'après le corpus."""
    out: dict[str, dict[str, str]] = {}
    for name, page in sorted(PAGES.items()):
        key = name.split("_")[0]
        p = parse_page(key, page.encode())
        if p.page != "ok" or not p.period or p.edition == "Revised":
            continue
        for ind, fig in p.figures.items():
            if fig.value is not None:
                out.setdefault(ind, {}).setdefault(p.period, fig.value)
    return out


FIRST = first_releases()


def test_real_response_shape():
    assert DATA.latest["CUSR0000SA0"] == "2026-10"
    assert DATA.latest["PRS85006092"] == "2026-Q3"
    assert DATA.series["CUSR0000SA0"]["2026-10"] == "337.476"
    assert DATA.series["CUUR0000SA0"]["2025-10"] == "-"  # shutdown : mois non publié
    assert len(DATA.series) == 12


@pytest.mark.parametrize("indicator", sorted(bls_api.DERIVATIONS))
def test_latest_period_reproduces_the_first_release_exactly(indicator):
    sid, _ = bls_api.DERIVATIONS[indicator]
    period = DATA.latest[sid]
    published = FIRST[indicator].get(period)
    if published is None:  # IPC sur un an d'octobre 2026 : non publié (« - »)
        assert bls_api.derive(indicator, period, DATA) is None
        return
    d = bls_api.derive(indicator, period, DATA)
    assert d is not None and d.value == published, (period, d)
    assert sid in d.excerpt and "API v1 du BLS" in d.excerpt


def test_older_differences_are_real_revisions():
    # Emploi de septembre 2026 : première publication +29 k, révisé depuis.
    assert FIRST["us-nfp"]["2026-09"] == "29"
    assert bls_api.derive("us-nfp", "2026-09", DATA).value == "60"
    # Coefficients saisonniers de l'IPC révisés en février 2026 : 2024-12 0,4 -> 0,3.
    assert bls_api.derive("us-cpi-mm", "2024-12", DATA).value == "0.3"
    assert FIRST["us-cpi-mm"]["2024-12"] == "0.4"


def test_formats_match_the_published_text():
    assert bls_api.derive("us-cpi-mm", "2024-06", DATA).value == "0.0"  # jamais « -0.0 »
    assert bls_api.derive("us-unemployment", "2026-10", DATA).value == "4.1"
    assert bls_api.derive("us-ulc-qq", "2026-Q3", DATA).value == "-0.7"
    assert bls_api.derive("us-core-ppi-mm", "2026-10", DATA) is None  # série à choisir
    assert bls_api.derive("us-cpi-mm", "2030-01", DATA) is None


def test_shift_and_period_keys():
    assert bls_api.shift("2026-01", -1) == "2025-12"
    assert bls_api.shift("2026-10", -12) == "2025-10"
    assert bls_api.shift("2026-Q1", -1) == "2025-Q4"
    assert bls_api.shift("2026-Q4", 1) == "2027-Q1"
    assert bls_api.period_key("2026", "M13") is None
    assert bls_api.period_key("2025", "Q05") is None
    assert bls_api.period_key("2026", "Q03") == "2026-Q3"


def test_refusals_are_errors_not_data():
    body = json.dumps({"status": "REQUEST_NOT_PROCESSED", "responseTime": 1,
                       "message": ["Database is locked for Series CUSR0000SA0"],
                       "Results": {}}).encode()
    with pytest.raises(bls_api.ApiError, match="locked"):
        bls_api.parse_response(body)
    with pytest.raises(bls_api.ApiError):
        bls_api.parse_response(b"<html>")


def test_request_body_is_capped():
    body = bls_api.request_body(["B", "A", "A"], 2001, 2026)
    assert body == {"seriesid": ["A", "B"], "startyear": "2017", "endyear": "2026"}
