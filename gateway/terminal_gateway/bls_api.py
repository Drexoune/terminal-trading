"""API v1 du BLS (étape E3) : révisions, et rattrapage de secours (décision T-040). Fonctions pures.

Faits vérifiés le 23/11/2026 :

- Documentation (bls.gov/developers, api_signature.htm et api_faqs.htm) : sans clé,
  25 requêtes par jour, 25 séries et 10 ans par requête ; POST JSON
  {"seriesid": [...], "startyear": "AAAA", "endyear": "AAAA"} sur
  `/publicAPI/v1/timeseries/data/` ; aucune variation calculée par le BLS en v1 ;
  dépassement : HTTP 429.
- Réponse réelle (`gateway/tests/fixtures/bls/api_v1_2026-11-23.json.gz`) : niveaux
  d'indice en texte décimal (« 337.476 »), « - » quand le mois n'est pas publié
  (IPC d'octobre 2025, shutdown), périodes « M10 » et « Q03 », note « P » sur les
  chiffres provisoires.
- La variation recalculée depuis les indices publiés à trois décimales, arrondie
  au dixième (demi vers le haut), redonne exactement le chiffre de la première
  publication pour la dernière période des 10 indicateurs lisibles (corpus de
  124 communiqués). Les écarts sur les périodes plus anciennes sont de vraies
  révisions (emploi révisé deux mois, PPI quatre mois, coefficients saisonniers
  de l'IPC chaque février).

Le chiffre recalculé n'est jamais une citation du BLS : il porte la série, les
niveaux utilisés et la mention « recalculé ».
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

API_V1 = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
QUOTA_PER_DAY = 25
DAILY_MAX = 20  # réserve de 5 requêtes pour les scripts d'exploration
MAX_YEARS = 10

# Indicateur -> (série, calcul). « m/m » : variation sur un mois en % au dixième ;
# « y/y » : sur douze mois ; « diff » : écart de niveau (milliers d'emplois) ;
# « level » : valeur publiée telle quelle.
DERIVATIONS: dict[str, tuple[str, str]] = {
    "us-cpi-mm": ("CUSR0000SA0", "m/m"),
    "us-cpi-yy": ("CUUR0000SA0", "y/y"),
    "us-core-cpi-mm": ("CUSR0000SA0L1E", "m/m"),
    "us-core-cpi-yy": ("CUUR0000SA0L1E", "y/y"),
    "us-nfp": ("CES0000000001", "diff"),
    "us-unemployment": ("LNS14000000", "level"),
    "us-ahe-mm": ("CES0500000003", "m/m"),
    "us-ppi-mm": ("WPSFD4", "m/m"),
    "us-prod-qq": ("PRS85006092", "level"),
    "us-ulc-qq": ("PRS85006112", "level"),
}
KIND_FR = {"m/m": "variation sur un mois recalculée, arrondie au dixième",
           "y/y": "variation sur un an recalculée, arrondie au dixième",
           "diff": "écart de niveau recalculé", "level": "valeur de la série"}


class ApiError(RuntimeError):
    pass


@dataclass(frozen=True)
class ApiData:
    series: dict[str, dict[str, str]]  # série -> période (« 2026-10 », « 2026-Q3 ») -> texte
    latest: dict[str, str]  # série -> période marquée « latest »
    messages: tuple[str, ...] = ()


@dataclass(frozen=True)
class Derived:
    indicator: str
    period: str
    value: str  # texte décimal, même forme que la première publication
    series: str
    excerpt: str


def request_body(series: list[str], start_year: int, end_year: int) -> dict:
    start_year = max(start_year, end_year - MAX_YEARS + 1)
    return {"seriesid": sorted(set(series))[:25], "startyear": str(start_year),
            "endyear": str(end_year)}


def period_key(year: str, period: str) -> str | None:
    """« 2026 » + « M10 » -> « 2026-10 » ; « Q03 » -> « 2026-Q3 » ; M13, Q05, A01 -> None."""
    if len(period) != 3 or not period[1:].isdigit():
        return None
    n = int(period[1:])
    if period[0] == "M" and 1 <= n <= 12:
        return f"{year}-{n:02d}"
    if period[0] == "Q" and 1 <= n <= 4:
        return f"{year}-Q{n}"
    return None


def parse_response(raw: bytes) -> ApiData:
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ApiError(f"réponse illisible : {exc}") from exc
    messages = tuple(str(m) for m in doc.get("message") or [])
    if doc.get("status") != "REQUEST_SUCCEEDED":
        raise ApiError(f"{doc.get('status')} : {' ; '.join(messages) or 'sans message'}")
    series: dict[str, dict[str, str]] = {}
    latest: dict[str, str] = {}
    for s in (doc.get("Results") or {}).get("series") or []:
        sid = s.get("seriesID")
        points: dict[str, str] = {}
        for row in s.get("data") or []:
            key = period_key(str(row.get("year")), str(row.get("period")))
            if key is None:
                continue
            points[key] = str(row.get("value", "")).strip()
            if row.get("latest") == "true":
                latest[sid] = key
        series[sid] = points
    return ApiData(series, latest, messages)


def shift(period: str, months: int) -> str:
    """Période décalée de `months` mois (mensuelle) ou trimestres (« 2026-Q3 »)."""
    year, rest = period.split("-")
    if rest.startswith("Q"):
        n = int(year) * 4 + int(rest[1:]) - 1 + months
        return f"{n // 4}-Q{n % 4 + 1}"
    n = int(year) * 12 + int(rest) - 1 + months
    return f"{n // 12}-{n % 12 + 1:02d}"


def _num(text: str | None) -> Decimal | None:
    if not text or text == "-":
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _text(v: Decimal) -> str:
    if v == 0:
        v = abs(v)  # « -0.0 » -> « 0.0 »
    return format(v, "f")


def derive(indicator: str, period: str, data: ApiData) -> Derived | None:
    """Chiffre de `indicator` pour `period` d'après l'API ; None si la série ne le permet pas."""
    if indicator not in DERIVATIONS:
        return None
    sid, kind = DERIVATIONS[indicator]
    points = data.series.get(sid) or {}
    cur = _num(points.get(period))
    if cur is None:
        return None
    if kind == "level":
        value, used = cur, [(period, points[period])]
    else:
        back = shift(period, -12 if kind == "y/y" else -1)
        prev = _num(points.get(back))
        if prev is None or (kind != "diff" and prev == 0):
            return None
        used = [(period, points[period]), (back, points[back])]
        if kind == "diff":
            value = cur - prev
        else:
            value = ((cur / prev - 1) * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)
    levels = ", ".join(f"{p} = {v}" for p, v in used)
    return Derived(indicator, period, _text(value), sid,
                   f"API v1 du BLS · {sid} : {levels} · {KIND_FR[kind]}")


def same_value(a: str | None, b: str | None) -> bool:
    x, y = _num(a), _num(b)
    return x is not None and y is not None and x == y
