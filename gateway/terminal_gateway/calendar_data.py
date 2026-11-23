"""Agenda économique (étape E2, docs/plan-p1.md § 3 et § 7) : fonctions pures.

- ForexFactory, `ff_calendar_thisweek.xml` : semaine en cours, titre, devise,
  date, heure, impact, prévision, précédent, lien (qui porte l'identifiant de
  série, « 112-us-core-retail-sales-mm »). Relevé réel du 20/11/2026 : les
  heures du XML sont en UTC (les 126 événements concordent avec le JSON, qui
  porte un décalage explicite). Encodage windows-1252.
- BLS, `schedule/news_release/bls.ics` : heures officielles en heure de New
  York (TZID « US-Eastern », traduit en zone IANA America/New_York).

L'heure ForexFactory est « indicative » ; seule celle du calendrier officiel
fait foi pour la capture (§ 3). Aucune heure de session n'est écrite en UTC.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
ICS_ZONES = {"US-Eastern": "America/New_York"}


@dataclass(frozen=True)
class Indicator:
    id: str
    label_fr: str
    currency: str
    ff_title: str  # expression régulière sur le titre ForexFactory
    bls_release: str | None
    official_series: str | None
    unit: str
    capture: bool = True


# Indicateurs captés à la source (§ 1). Séries officielles : révisions par l'API v1
# (bls_api.DERIVATIONS, vérifiées le 23/11/2026). PPI sous-jacent : série à choisir.
INDICATORS: tuple[Indicator, ...] = (
    Indicator(
        "us-cpi-mm", "IPC (m/m)", "USD", r"CPI m/m", "Consumer Price Index", "CUSR0000SA0", "%"
    ),
    Indicator(
        "us-cpi-yy",
        "IPC (sur un an)",
        "USD",
        r"CPI y/y",
        "Consumer Price Index",
        "CUUR0000SA0",
        "%",
    ),
    Indicator(
        "us-core-cpi-mm",
        "IPC sous-jacent (m/m)",
        "USD",
        r"Core CPI m/m",
        "Consumer Price Index",
        "CUSR0000SA0L1E",
        "%",
    ),
    Indicator(
        "us-core-cpi-yy",
        "IPC sous-jacent (sur un an)",
        "USD",
        r"Core CPI y/y",
        "Consumer Price Index",
        "CUUR0000SA0L1E",
        "%",
    ),
    Indicator(
        "us-nfp",
        "Créations d\u2019emplois non agricoles",
        "USD",
        r"Non-Farm Employment Change",
        "Employment Situation",
        "CES0000000001",
        "K",
    ),
    Indicator(
        "us-unemployment",
        "Taux de chômage",
        "USD",
        r"Unemployment Rate",
        "Employment Situation",
        "LNS14000000",
        "%",
    ),
    Indicator(
        "us-ahe-mm",
        "Salaire horaire moyen (m/m)",
        "USD",
        r"Average Hourly Earnings m/m",
        "Employment Situation",
        "CES0500000003",
        "%",
    ),
    Indicator(
        "us-ppi-mm",
        "Prix à la production (m/m)",
        "USD",
        r"PPI m/m",
        "Producer Price Index",
        "WPSFD4",
        "%",
    ),
    Indicator(
        "us-core-ppi-mm",
        "Prix à la production sous-jacents (m/m)",
        "USD",
        r"Core PPI m/m",
        "Producer Price Index",
        None,
        "%",
    ),
    Indicator(
        "us-prod-qq",
        "Productivité non agricole (t/t)",
        "USD",
        r"(?:Prelim |Revised )?Nonfarm Productivity q/q",
        "Productivity and Costs",
        "PRS85006092",
        "%",
    ),
    Indicator(
        "us-ulc-qq",
        "Coûts salariaux unitaires (t/t)",
        "USD",
        r"(?:Prelim |Revised )?Unit Labor Costs q/q",
        "Productivity and Costs",
        "PRS85006112",
        "%",
    ),
)


def indicator_for(title: str, currency: str) -> Indicator | None:
    for ind in INDICATORS:
        if ind.currency == currency and re.fullmatch(ind.ff_title, title.strip()):
            return ind
    return None


# --- valeurs -----------------------------------------------------------------------

_VALUE = re.compile(r"([<>]?)(-?\d+(?:\.\d+)?)\s*([%KMBT]|bp)?")


def parse_value(raw: str | None) -> tuple[str | None, str | None]:
    """« 0.4% » → ("0.4", "%") ; « 198K » → ("198", "K") ; « -0.90T » → ("-0.90", "T") ;
    texte vide ou illisible → (None, None). Le texte décimal n'est jamais arrondi."""
    m = _VALUE.fullmatch((raw or "").strip())
    if not m or m.group(1):
        return None, None
    return m.group(2), m.group(3) or ""


# --- ForexFactory ------------------------------------------------------------------


@dataclass
class FfEvent:
    title: str
    currency: str
    impact: str  # High, Medium, Low, Holiday
    date_utc: str  # AAAA-MM-JJ tel que publié (jour UTC)
    time_raw: str  # « 1:30pm », « Tentative », « All Day »…
    time_ms: int | None  # instant UTC si l'heure est ordinaire
    forecast_raw: str
    previous_raw: str
    url: str
    series: str | None  # « 112-us-core-retail-sales-mm »
    identity: str = ""
    indicator: Indicator | None = None

    @property
    def ny_date(self) -> str:
        if self.time_ms is None:
            return self.date_utc
        return (
            datetime.fromtimestamp(self.time_ms / 1000, UTC).astimezone(NEW_YORK).date().isoformat()
        )


_TIME = re.compile(r"(\d{1,2}):(\d{2})\s*([ap]m)", re.I)


def parse_ff_xml(body: bytes) -> list[FfEvent]:
    """XML hebdomadaire de ForexFactory → événements, dans l'ordre du fichier."""
    root = ET.fromstring(body)  # l'en-tête XML déclare windows-1252 : ElementTree décode
    out: list[FfEvent] = []
    for e in root.iter("event"):

        def text(tag: str, el: ET.Element = e) -> str:
            node = el.find(tag)
            return (node.text or "").strip() if node is not None else ""

        m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", text("date"))
        if not m:
            continue
        day = date(int(m[3]), int(m[1]), int(m[2]))
        tm = _TIME.fullmatch(text("time"))
        time_ms = None
        if tm:
            hour = int(tm[1]) % 12 + (12 if tm[3].lower() == "pm" else 0)
            time_ms = int(
                datetime(day.year, day.month, day.day, hour, int(tm[2]), tzinfo=UTC).timestamp()
                * 1000
            )
        url = text("url")
        series = url.rstrip("/").rsplit("/", 1)[-1] if "/calendar/" in url else None
        ev = FfEvent(
            title=text("title"),
            currency=text("country"),
            impact=text("impact"),
            date_utc=day.isoformat(),
            time_raw=text("time"),
            time_ms=time_ms,
            forecast_raw=text("forecast"),
            previous_raw=text("previous"),
            url=url,
            series=series,
        )
        ev.indicator = indicator_for(ev.title, ev.currency)
        out.append(ev)
    # Identité stable d'un événement : série, devise, jour à New York, rang du jour.
    seen: dict[str, int] = {}
    for ev in out:
        base = f"{ev.series or _slug(ev.title)}|{ev.currency}|{ev.ny_date}"
        seen[base] = seen.get(base, 0) + 1
        ev.identity = f"{base}|{seen[base]}"
    return out


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# --- BLS ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OfficialRelease:
    title: str  # « Consumer Price Index »
    local_date: str  # AAAA-MM-JJ, jour de la zone officielle
    local_time: str  # « 08:30 »
    tz: str  # « America/New_York »
    utc_ms: int


def parse_bls_ics(text: str) -> tuple[list[OfficialRelease], list[str]]:
    """Calendrier iCalendar du BLS → publications ; problèmes (zone inconnue…) à part."""
    unfolded = re.sub(r"\r?\n[ \t]", "", text).replace("\r\n", "\n")
    out: list[OfficialRelease] = []
    problems: list[str] = []
    for block in re.findall(r"BEGIN:VEVENT\n(.*?)END:VEVENT", unfolded, re.S):
        summary = re.search(r"^SUMMARY:(.*)$", block, re.M)
        start = re.search(r"^DTSTART;TZID=([^:]+):(\d{8})T(\d{4})\d{2}$", block, re.M)
        if not summary or not start:
            problems.append(f"publication illisible : {block[:60]!r}")
            continue
        zone = ICS_ZONES.get(start[1])
        if zone is None:
            problems.append(f"zone inconnue : {start[1]}")
            continue
        d, hm = start[2], start[3]
        local = datetime(
            int(d[:4]), int(d[4:6]), int(d[6:]), int(hm[:2]), int(hm[2:]), tzinfo=ZoneInfo(zone)
        )
        out.append(
            OfficialRelease(
                title=summary[1].replace("\\,", ",").strip(),
                local_date=local.date().isoformat(),
                local_time=local.strftime("%H:%M"),
                tz=zone,
                utc_ms=int(local.timestamp() * 1000),
            )
        )
    return out, problems


def attach_official(
    events: list[FfEvent], releases: list[OfficialRelease]
) -> dict[str, OfficialRelease]:
    """Heure officielle des indicateurs captés : la publication du BLS du même jour."""
    by_key = {(r.title, r.local_date): r for r in releases}
    out: dict[str, OfficialRelease] = {}
    for ev in events:
        ind = ev.indicator
        if ind and ind.bls_release and (rel := by_key.get((ind.bls_release, ev.ny_date))):
            out[ev.identity] = rel
    return out


# --- semaine -----------------------------------------------------------------------


def week_id(ny_day: str) -> str:
    """Semaine ForexFactory (dimanche → samedi, New York) nommée par la semaine ISO de son lundi."""
    d = date.fromisoformat(ny_day)
    monday = d + timedelta(days=1) if d.weekday() == 6 else d - timedelta(days=d.weekday())
    y, w, _ = monday.isocalendar()
    return f"{y}-W{w:02d}"


def week_bounds(week: str) -> tuple[str, str]:
    """« 2026-W47 » → (dimanche, samedi) à New York."""
    m = re.fullmatch(r"(\d{4})-W(\d{2})", week)
    if not m:
        raise ValueError(f"semaine attendue sous la forme AAAA-Wnn : {week}")
    monday = date.fromisocalendar(int(m[1]), int(m[2]), 1)
    return (monday - timedelta(days=1)).isoformat(), (monday + timedelta(days=5)).isoformat()


def event_dict(ev: FfEvent, official: OfficialRelease | None) -> dict:
    forecast, unit = parse_value(ev.forecast_raw)
    previous, _ = parse_value(ev.previous_raw)
    ind = ev.indicator
    t_official = official.utc_ms if official else None
    return {
        "id": ev.identity,
        "title": ev.title,
        "title_fr": ind.label_fr if ind else None,
        "indicator": ind.id if ind else None,
        "capture": bool(ind and ind.capture),
        "currency": ev.currency,
        "impact": ev.impact,
        "ny_date": ev.ny_date,
        "time_ms": t_official if t_official is not None else ev.time_ms,
        "time_source": "BLS" if t_official is not None else "ForexFactory",
        "time_kind": "officielle"
        if t_official is not None
        else ("indicative" if ev.time_ms is not None else ev.time_raw),
        "ff_time_ms": ev.time_ms,
        "time_mismatch": t_official is not None
        and ev.time_ms is not None
        and ev.time_ms != t_official,
        "official": {
            "local_date": official.local_date,
            "local_time": official.local_time,
            "tz": official.tz,
            "release": official.title,
        }
        if official
        else None,
        "forecast_raw": ev.forecast_raw or None,
        "forecast": forecast,
        "previous_raw": ev.previous_raw or None,
        "previous": previous,
        "unit": unit,
        "actual": None,  # chiffre capté à la source : étape E3
        "series": ev.series,
    }
