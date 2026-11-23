"""Fichier doré de l'agenda (plan « Tout en ligne », étape O2).

Fige les sorties de gateway/terminal_gateway/calendar_data.py sur les relevés réels du
20/11/2026 (gateway/tests/fixtures/calendar/) : indicateurs suivis, lecture des valeurs
ForexFactory, événements de la semaine avec leur heure officielle, calendrier du BLS,
semaines. Le portage TypeScript (supabase/functions/p1-jobs/calendar.ts) doit redonner
exactement ce fichier (calendar.test.ts) ; gateway/tests/test_calendar_golden.py vérifie
que le fichier suit le code Python. Après une modification voulue du code Python :

    .venv/bin/python scripts/make_calendar_golden.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "gateway"))

from terminal_gateway.calendar_data import (  # noqa: E402
    INDICATORS,
    attach_official,
    event_dict,
    parse_bls_ics,
    parse_ff_xml,
    parse_value,
    week_bounds,
    week_id,
)

FIX = ROOT / "gateway" / "tests" / "fixtures" / "calendar"
OUT = FIX / "golden.json"
VALUES = ["0.4%", "198K", "-0.90T", "4.18|2.6", "<1.25%", "", "1.2M", "-12.5B", "25bp", "50.9",
          "abc", " 3.1% ", "0.0%", "-0.1%"]
# Événements ajoutés à l'extrait réel, pour couvrir les chemins que les 11 événements du
# 20/11 ne prennent pas : indicateur capté avec heure officielle du BLS (IPC du 10/12),
# heure ForexFactory en désaccord avec l'officielle (PPI sous-jacent du 15/12), entité XML,
# même titre deux fois le même jour (rang), heure « Tentative ».
EXTRA_XML = """\t<event>
\t\t<title>CPI m/m</title>
\t\t<country>USD</country>
\t\t<date><![CDATA[12-10-2026]]></date>
\t\t<time><![CDATA[1:30pm]]></time>
\t\t<impact><![CDATA[High]]></impact>
\t\t<forecast><![CDATA[0.3%]]></forecast>
\t\t<previous><![CDATA[0.4%]]></previous>
\t\t<url><![CDATA[https://www.forexfactory.com/calendar/78-us-cpi-mm]]></url>
\t</event>
\t<event>
\t\t<title>Core PPI m/m</title>
\t\t<country>USD</country>
\t\t<date><![CDATA[12-15-2026]]></date>
\t\t<time><![CDATA[1:00pm]]></time>
\t\t<impact><![CDATA[Medium]]></impact>
\t\t<forecast><![CDATA[0.2%]]></forecast>
\t\t<previous />
\t\t<url><![CDATA[https://www.forexfactory.com/calendar/88-us-core-ppi-mm]]></url>
\t</event>
\t<event>
\t\t<title>S&amp;P Global Services PMI</title>
\t\t<country>USD</country>
\t\t<date><![CDATA[12-15-2026]]></date>
\t\t<time><![CDATA[2:45pm]]></time>
\t\t<impact><![CDATA[Medium]]></impact>
\t\t<forecast><![CDATA[54.1]]></forecast>
\t\t<previous><![CDATA[54.8]]></previous>
\t\t<url><![CDATA[https://www.forexfactory.com/calendar/1-us-sp-global-services-pmi]]></url>
\t</event>
\t<event>
\t\t<title>FOMC Member Speaks</title>
\t\t<country>USD</country>
\t\t<date><![CDATA[12-15-2026]]></date>
\t\t<time><![CDATA[Tentative]]></time>
\t\t<impact><![CDATA[Low]]></impact>
\t\t<forecast />
\t\t<previous />
\t\t<url><![CDATA[https://www.forexfactory.com/calendar/9-us-fomc-member-speaks]]></url>
\t</event>
\t<event>
\t\t<title>FOMC Member Speaks</title>
\t\t<country>USD</country>
\t\t<date><![CDATA[12-15-2026]]></date>
\t\t<time><![CDATA[6:00pm]]></time>
\t\t<impact><![CDATA[Low]]></impact>
\t\t<forecast />
\t\t<previous />
\t\t<url><![CDATA[https://www.forexfactory.com/calendar/9-us-fomc-member-speaks]]></url>
\t</event>
"""
DAYS = ["2026-11-15", "2026-11-16", "2026-11-21", "2026-11-22", "2026-12-31", "2027-01-03",
        "2026-03-08", "2026-10-25"]


def build() -> dict:
    raw = (FIX / "ff_calendar_thisweek_2026-11-20.xml").read_bytes()
    xml = raw.replace(b"</weeklyevents>", EXTRA_XML.encode("cp1252") + b"</weeklyevents>")
    ff = parse_ff_xml(xml)
    releases, problems = parse_bls_ics((FIX / "bls_2026-11-20.ics").read_text(encoding="utf-8"))
    official = attach_official(ff, releases)
    return {
        "_comment": "Généré par scripts/make_calendar_golden.py ; ne pas modifier à la main.",
        "ff_extra_xml": EXTRA_XML,
        "indicators": [{"id": i.id, "label_fr": i.label_fr, "currency": i.currency,
                        "ff_title": i.ff_title, "bls_release": i.bls_release,
                        "official_series": i.official_series, "unit": i.unit,
                        "capture": i.capture} for i in INDICATORS],
        "parse_value": [[raw, *parse_value(raw)] for raw in VALUES],
        "ff_events": [{**event_dict(e, official.get(e.identity)), "date_utc": e.date_utc,
                       "time_raw": e.time_raw} for e in ff],
        "ics": {"releases": [r.__dict__ for r in releases], "problems": problems},
        "weeks": [[d, week_id(d), *week_bounds(week_id(d))] for d in DAYS],
    }


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, indent=1) + "\n"


if __name__ == "__main__":
    OUT.write_text(render(), encoding="utf-8")
    print(f"écrit : {OUT.relative_to(ROOT)}")
