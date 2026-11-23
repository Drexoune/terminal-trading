"""Lecture des communiqués du BLS (E3) sur le corpus réel relevé le 20/11/2026 :
120 communiqués archivés (36 IPC, 36 emploi, 36 PPI, 12 productivité) et les
4 pages résumé de la sonde, réduits au titre, au texte et au tableau A
(fixtures/bls/releases_2026-11-20.json.gz ; résultats identiques aux pages entières).

`expected.json` fige la lecture de tout le corpus ; les valeurs vérifiées à la
main contre le texte des communiqués sont reprises une à une plus bas."""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest
from terminal_gateway.bls_release import RELEASES, classify, parse_page

FIX = Path(__file__).parent / "fixtures" / "bls"
PAGES: dict[str, str] = json.loads(
    gzip.decompress((FIX / "releases_2026-11-20.json.gz").read_bytes()))
EXPECTED: dict[str, dict] = json.loads((FIX / "expected.json").read_text(encoding="utf-8"))


def parse(name: str, html: str | None = None):
    return parse_page(name.split("_")[0], (html or PAGES[name]).encode())


def test_corpus_has_every_release():
    kinds = [n.split("_")[0] for n in PAGES]
    assert {k: kinds.count(k) for k in RELEASES} == {"cpi": 37, "empsit": 37, "ppi": 37,
                                                     "prod2": 13}


@pytest.mark.parametrize("name", sorted(PAGES))
def test_corpus_reads_as_expected(name):
    p = parse(name)
    got = {"page": p.page, "period": p.period, "edition": p.edition,
           "embargo_date": p.embargo_date,
           "values": {k: v.value for k, v in p.figures.items()},
           "reasons": {k: v.reason for k, v in p.figures.items() if v.value is None}}
    assert got == EXPECTED[name]


def test_corpus_coverage():
    """Ce qui manque l'est pour une raison connue, jamais par une tournure non lue."""
    missing = {}
    for name, exp in EXPECTED.items():
        for ind, why in exp["reasons"].items():
            if ind != "us-core-ppi-mm":
                missing[f"{name}:{ind}"] = why
    assert missing == {
        "cpi_12182025:us-cpi-mm": "publication irrégulière : variation sur plusieurs mois "
                                  "(shutdown)",
        "cpi_12182025:us-core-cpi-mm": "publication irrégulière : variation sur plusieurs mois "
                                       "(shutdown)",
        "cpi_11102026:us-cpi-yy": "non publié par le BLS (« - »)",
        "cpi_11102026:us-core-cpi-yy": "non publié par le BLS (« - »)",
        "cpi_nr0_2026-11-20:us-cpi-yy": "non publié par le BLS (« - »)",
        "cpi_nr0_2026-11-20:us-core-cpi-yy": "non publié par le BLS (« - »)",
        "empsit_03082024:us-ahe-mm": "variation publiée en cents seulement, sans pourcentage",
        "empsit_08072026:us-ahe-mm": "phrase du salaire horaire non reconnue",
    }


# --- valeurs vérifiées à la main sur le texte des communiqués -------------------------

@pytest.mark.parametrize("name, values", [
    # « increased 0.4 percent … in October » ; sous-jacent « rose 0.3 percent ».
    ("cpi_11102026", {"us-cpi-mm": "0.4", "us-core-cpi-mm": "0.3"}),
    # « was unchanged in October » ; « Over the last 12 months … increased 3.2 percent ».
    ("cpi_11142023", {"us-cpi-mm": "0.0", "us-cpi-yy": "3.2", "us-core-cpi-yy": "4.0"}),
    ("cpi_07142026", {"us-cpi-mm": "-0.4", "us-core-cpi-mm": "0.0"}),
    # « rose by 165,000 … changed little at 4.1 percent … 14 cents, or 0.4 percent ».
    ("empsit_11062026", {"us-nfp": "165", "us-unemployment": "4.1", "us-ahe-mm": "0.4"}),
    ("empsit_03062026", {"us-nfp": "-92", "us-unemployment": "4.4"}),
    # « Both nonfarm payroll employment (-23,000) and the unemployment rate (4.1 percent) ».
    ("empsit_08072026", {"us-nfp": "-23", "us-unemployment": "4.1"}),
    # « was essentially unchanged in October (+12,000) ».
    ("empsit_11012024", {"us-nfp": "12"}),
    # « The unemployment rate rose to 4.3 percent …, and nonfarm payroll employment edged up
    # by 114,000 ».
    ("empsit_08022024", {"us-nfp": "114", "us-unemployment": "4.3"}),
    ("ppi_11132026", {"us-ppi-mm": "0.3"}),
    ("ppi_09102025", {"us-ppi-mm": "-0.1"}),
    ("prod2_11052026", {"us-prod-qq": "3.6", "us-ulc-qq": "-0.7"}),
    ("prod2_03242026", {"us-prod-qq": "1.8", "us-ulc-qq": "4.4"}),
])
def test_hand_checked_values(name, values):
    p = parse(name)
    assert {k: p.figures[k].value for k in values} == values


def test_december_title_says_m13_but_period_comes_from_heading():
    p = parse("empsit_01052024")  # titre « 2023 M13 Results »
    assert p.period == "2023-12"


def test_fourth_quarter_title_says_q05_but_period_comes_from_heading():
    p = parse("prod2_03052026")  # « Fourth Quarter and Annual Averages 2025, Preliminary »
    assert (p.period, p.edition) == ("2025-Q4", "Preliminary")


def test_embargo_without_comma_after_weekday():
    assert parse("ppi_10112024").embargo_date == "2024-10-11"


def test_404_page_is_an_error_page():
    p = parse("empsit_12042026")
    assert p.page == "page d'erreur" and p.figures == {}


def test_values_are_decimal_text_with_source_and_excerpt():
    f = parse("cpi_nr0_2026-11-20").figures["us-cpi-mm"]
    assert f.value == "0.4" and f.part == "tableau A" and "texte concordant" in f.flags
    assert f.excerpt.startswith("The Consumer Price Index for All Urban Consumers (CPI-U) "
                                "increased 0.4 percent")


# --- échouer fermé -----------------------------------------------------------------

def test_text_and_table_disagreement_blocks_the_figure():
    html = PAGES["cpi_nr0_2026-11-20"].replace("(CPI-U) increased 0.4 percent",
                                               "(CPI-U) increased 0.5 percent", 1)
    f = parse("cpi_nr0_2026-11-20", html).figures["us-cpi-mm"]
    assert f.value is None and f.reason == "désaccord texte (0.5) / tableau A (0.4)"


def test_table_column_for_another_month_blocks_the_figures():
    html = PAGES["cpi_nr0_2026-11-20"].replace("CONSUMER PRICE INDEX - OCTOBER 2026",
                                               "CONSUMER PRICE INDEX - NOVEMBER 2026", 1)
    p = parse("cpi_nr0_2026-11-20", html)
    assert p.page == "forme inconnue"  # le titre dit « 2026 M10 » : incohérence


def test_unknown_form_gives_no_figure():
    p = parse("cpi_nr0_2026-11-20", "<html><title>CPI - 2026 M11 Results</title>"
                                    "<ul><li>New bullet format</li></ul></html>")
    assert p.page == "forme inconnue" and p.figures == {}


def test_empty_and_null_bytes_pages():
    assert parse_page("cpi", b"  \n").page == "vide"
    assert parse_page("cpi", b"\x00" * 500).page == "octets nuls"


def test_out_of_bounds_value_is_kept_and_flagged():
    html = PAGES["prod2_nr0_2026-11-20"].replace("labor productivity increased 3.6 percent",
                                                 "labor productivity increased 63.6 percent", 1)
    f = parse("prod2_nr0_2026-11-20", html).figures["us-prod-qq"]
    assert f.value == "63.6" and "hors bornes" in f.flags


# --- nouveauté -----------------------------------------------------------------------

def revised_prod2() -> str:
    """Le communiqué révisé du 08/12/2026 : même période (T3 2026), autre embargo."""
    return (PAGES["prod2_nr0_2026-11-20"]
            .replace("Thursday, November 5, 2026", "Tuesday, December 8, 2026", 1)
            .replace("Third Quarter 2026, Preliminary", "Third Quarter 2026, Revised")
            .replace("labor productivity increased 3.6 percent",
                     "labor productivity increased 4.1 percent", 1))


def test_revised_release_with_same_period_is_new():
    before = parse("prod2_nr0_2026-11-20")
    after = parse("prod2_nr0_2026-11-20", revised_prod2())
    assert before.period == after.period == "2026-Q3"
    assert classify(before, "2026-12-08", None) is None  # référence
    assert classify(before, "2026-12-08", before.version) is None
    assert classify(after, "2026-12-08", before.version) == "attendue"
    assert after.edition == "Revised" and after.figures["us-prod-qq"].value == "4.1"


def test_release_on_another_date_is_flagged_not_ignored():
    base = parse("cpi_10142026")
    new = parse("cpi_11102026")
    assert classify(new, "2026-11-11", base.version) == "en avance"
    assert classify(new, "2026-11-09", base.version) == "en retard"
    assert classify(new, "2026-11-10", base.version) == "attendue"
