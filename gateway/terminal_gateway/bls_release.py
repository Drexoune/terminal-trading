"""Lecture des communiqués du BLS (étape E3, docs/plan-p1.md § 7) : fonctions pures.

Corpus : les 120 communiqués archivés relevés le 20/11/2026 (36 IPC, 36 emploi,
36 PPI, 12 productivité) et les pages `*.nr0.htm` de la sonde. Ce qu'ils montrent :

- IPC et PPI : la page résumé porte un tableau A en HTML structuré (valeurs en
  texte décimal, en-têtes datés). Le chiffre vient du tableau ; la phrase
  d'ouverture sert de contrôle croisé, et un désaccord bloque la lecture.
- Emploi et productivité : la page résumé n'a aucun tableau. Le chiffre vient
  du texte, par une liste fermée de tournures réelles (« rose by 165,000 »,
  « changed little in July (+73,000) », « Both nonfarm payroll employment
  (-23,000) and… »).
- Le communiqué révisé de la productivité porte la MÊME période que le
  préliminaire (« 2026 Q03 ») : la nouveauté se juge sur la date d'embargo,
  jamais sur la période seule. Le BLS écrit aussi « 2025 Q05 » pour le
  quatrième trimestre : la période se lit dans le texte.
- Publications irrégulières (shutdown 2025) : IPC « over the 2 months from
  September 2025 to November 2025 », glissements sur un an non publiés (« - »).

Règle : échouer fermé. Une forme inconnue donne `value = None` avec la raison,
jamais un chiffre deviné ; une valeur hors bornes est gardée et signalée.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
BLS = "https://www.bls.gov"


@dataclass(frozen=True)
class Release:
    key: str  # « cpi »
    title: str  # titre du calendrier officiel (bls.ics)
    url: str  # page interrogée chaque seconde
    fallback: str  # page complète, si la première est vide ou corrompue
    indicators: tuple[str, ...]
    quarterly: bool = False


RELEASES: dict[str, Release] = {
    r.key: r
    for r in (
        Release("cpi", "Consumer Price Index", f"{BLS}/news.release/cpi.nr0.htm",
                f"{BLS}/news.release/cpi.htm",
                ("us-cpi-mm", "us-cpi-yy", "us-core-cpi-mm", "us-core-cpi-yy")),
        Release("empsit", "Employment Situation", f"{BLS}/news.release/empsit.nr0.htm",
                f"{BLS}/news.release/empsit.htm", ("us-nfp", "us-unemployment", "us-ahe-mm")),
        Release("ppi", "Producer Price Index", f"{BLS}/news.release/ppi.nr0.htm",
                f"{BLS}/news.release/ppi.htm", ("us-ppi-mm", "us-core-ppi-mm")),
        Release("prod2", "Productivity and Costs", f"{BLS}/news.release/prod2.nr0.htm",
                f"{BLS}/news.release/prod2.htm", ("us-prod-qq", "us-ulc-qq"), quarterly=True),
    )
}
BY_TITLE = {r.title: r for r in RELEASES.values()}

# Bornes larges : une valeur dehors est gardée, signalée « hors bornes ».
BOUNDS: dict[str, tuple[Decimal, Decimal]] = {
    "us-cpi-mm": (Decimal("-3"), Decimal("3")),
    "us-core-cpi-mm": (Decimal("-3"), Decimal("3")),
    "us-cpi-yy": (Decimal("-5"), Decimal("20")),
    "us-core-cpi-yy": (Decimal("-5"), Decimal("20")),
    "us-nfp": (Decimal("-25000"), Decimal("10000")),  # milliers d'emplois
    "us-unemployment": (Decimal("0"), Decimal("30")),
    "us-ahe-mm": (Decimal("-3"), Decimal("3")),
    "us-ppi-mm": (Decimal("-5"), Decimal("5")),
    "us-core-ppi-mm": (Decimal("-5"), Decimal("5")),
    "us-prod-qq": (Decimal("-30"), Decimal("40")),
    "us-ulc-qq": (Decimal("-30"), Decimal("40")),
}

UP = r"increased|rose|advanced|moved up|edged up|climbed|jumped|gained|was up"
DOWN = r"decreased|declined|fell|edged down|moved down|dropped|was down"
FLAT = r"was unchanged|were unchanged|was essentially unchanged|remained unchanged"
MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december")
QUARTERS = {"first": 1, "second": 2, "third": 3, "fourth": 4}


@dataclass(frozen=True)
class Figure:
    indicator: str
    value: str | None  # texte décimal tel que publié (milliers pour l'emploi)
    reason: str | None = None  # pourquoi `value` manque
    part: str | None = None  # « tableau A », « texte »
    excerpt: str | None = None  # passage lu, pour citer la source
    flags: tuple[str, ...] = ()


@dataclass
class Parsed:
    release: str
    page: str  # « ok », « vide », « octets nuls », « page d'erreur », « forme inconnue »
    title: str | None = None
    period: str | None = None  # « 2026-10 », « 2026-Q3 »
    edition: str | None = None  # « Preliminary », « Revised » (productivité)
    embargo_text: str | None = None
    embargo_ms: int | None = None
    embargo_date: str | None = None  # AAAA-MM-JJ à New York
    figures: dict[str, Figure] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    @property
    def version(self) -> tuple[str | None, str | None]:
        """Ce qui distingue deux publications : période et date d'embargo."""
        return self.period, self.embargo_date


# --- page --------------------------------------------------------------------------

_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
_PRE = re.compile(r"<pre[^>]*>(.*?)</pre>", re.S | re.I)
_PERIOD_M = re.compile(r"(\d{4}) M(\d{2}) Results")
_EMBARGO = re.compile(
    r"embargoed until (?:USDL[- ]?\d{2}-\d+ )?(\d{1,2}):(\d{2}) ([ap])\.m\. \(ET\) "
    r"([A-Z][a-z]+),? ([A-Z][a-z]+)\.? (\d{1,2}), (\d{4})")
# Période dans l'en-tête du texte : le titre HTML dit « M13 » en décembre (moyenne
# annuelle), parfois « 2024 Q01 » pour un communiqué mensuel, « Q05 » pour le T4.
_HEADING_M = re.compile(
    r"(?:CONSUMER PRICE INDEX|PRODUCER PRICE INDEXES|THE EMPLOYMENT SITUATION) ?-+ ?"
    r"((?i:january|february|march|april|may|june|july|august|september|october|november|"
    r"december)) (\d{4})")
_HEADING_Q = re.compile(
    r"(First|Second|Third|Fourth) Quarter(?: and Annual Averages)? (\d{4}),? (Preliminary|Revised)")


def normalize(fragment: str) -> str:
    """HTML → texte sur une ligne : balises retirées, entités décodées, espaces fusionnés."""
    t = re.sub(r"<br\s*/?>", " ", fragment, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    t = t.replace("\u00a0", " ").replace("\u2212", "-").replace("\u2013", "-")
    t = t.replace("\u2019", "'").replace("\ufffd", " ")
    return " ".join(t.split())


def page_text(body: str) -> str:
    """Premier bloc <pre> : le texte du communiqué (en-tête d'embargo compris)."""
    m = _PRE.search(body)
    return normalize(m.group(1)) if m else ""


def _embargo(text: str) -> tuple[str | None, int | None, str | None, str | None]:
    """(texte, ms UTC, AAAA-MM-JJ New York, problème). Le jour de semaine est vérifié."""
    m = _EMBARGO.search(text[:600])
    if not m:
        return None, None, None, None
    hour, minute, ampm, weekday, month, day, year = m.groups()
    try:
        mon = next(i for i, name in enumerate(MONTHS, 1) if name.startswith(month.lower()[:3]))
        h = int(hour) % 12 + (12 if ampm == "p" else 0)
        local = datetime(int(year), mon, int(day), h, int(minute), tzinfo=NEW_YORK)
    except (StopIteration, ValueError):
        return m.group(0), None, None, f"date d'embargo illisible : {m.group(0)!r}"
    problem = None
    if local.strftime("%A") != weekday:
        problem = f"jour de semaine incohérent dans l'embargo : {weekday} ≠ {local:%A}"
    return m.group(0), int(local.timestamp() * 1000), local.date().isoformat(), problem


def parse_page(release: str, raw: bytes) -> Parsed:
    """Page du BLS → métadonnées et chiffres. Ne lève jamais : tout problème est noté."""
    rel = RELEASES[release]
    if not raw.strip():
        return Parsed(release, "vide")
    if raw.count(0):
        return Parsed(release, "octets nuls", problems=[f"{raw.count(0)} octets nuls"])
    body = raw.decode("utf-8", "replace")
    out = Parsed(release, "ok")
    tm = _TITLE.search(body[:20_000])
    out.title = " ".join(html.unescape(tm.group(1)).split()) if tm else None
    if out.title and ("cannot be found" in out.title or out.title.startswith("Sorry")):
        out.page = "page d'erreur"
        return out
    text = page_text(body)
    if not text:
        out.page = "forme inconnue"
        out.problems.append("aucun bloc <pre> : forme du communiqué inconnue")
        return out
    out.embargo_text, out.embargo_ms, out.embargo_date, problem = _embargo(text)
    if problem:
        out.problems.append(problem)
    if out.embargo_ms is None:
        out.problems.append("ligne d'embargo absente ou illisible")
    if rel.quarterly:
        q = _HEADING_Q.search(text[:1500])
        if q:
            out.period = f"{q.group(2)}-Q{QUARTERS[q.group(1).lower()]}"
            out.edition = q.group(3)
    elif h := _HEADING_M.search(text[:1500]):
        out.period = f"{h.group(2)}-{MONTHS.index(h.group(1).lower()) + 1:02d}"
        # Contrôle : un titre « AAAA Mnn » (n ≤ 12) doit dire le même mois.
        p = _PERIOD_M.search(out.title or "")
        if p and int(p.group(2)) <= 12 and f"{p.group(1)}-{p.group(2)}" != out.period:
            out.problems.append(f"période du titre ({p.group(0)}) ≠ en-tête ({out.period})")
            out.page = "forme inconnue"
            return out
    if out.period is None:
        out.problems.append("période introuvable (titre ou en-tête)")
        out.page = "forme inconnue"
        return out
    reader = {"cpi": _read_cpi, "empsit": _read_empsit, "ppi": _read_ppi, "prod2": _read_prod2}
    out.figures = reader[release](body, text, out.period)
    for f in out.figures.values():
        if f.value is not None:
            lo, hi = BOUNDS[f.indicator]
            if not lo <= Decimal(f.value) <= hi:
                out.figures[f.indicator] = Figure(**{**f.__dict__,
                                                     "flags": (*f.flags, "hors bornes")})
    return out


# --- outils ------------------------------------------------------------------------

def _dec(s: str) -> str | None:
    """« 0.4 », « -0.4 » → texte décimal ; « - » et le reste → None."""
    s = s.strip()
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", s):
        return None
    try:
        Decimal(s)
    except InvalidOperation:
        return None
    return s


def _signed(verb: str, number: str | None) -> str | None:
    """Verbe + nombre → texte décimal signé ; « unchanged » → « 0.0 »."""
    v = verb.lower()
    if re.fullmatch(FLAT, v):
        return "0.0" if number is None else None
    if number is None:
        return None
    if re.fullmatch(UP, v):
        return number
    if re.fullmatch(DOWN, v):
        return number if number == "0.0" else f"-{number}"
    return None


def _thousands(raw: str) -> str:
    """« +165,000 » → « 165 » ; « -23,000 » → « -23 » (milliers, exact)."""
    sign = "-" if raw.startswith(("-", "\u2212")) else ""
    n = Decimal(re.sub(r"[^\d]", "", raw)) / 1000
    s = format(n.normalize(), "f")
    return f"{sign}{s}" if s != "0" else "0"


def _excerpt(text: str, m: re.Match, width: int = 200) -> str:
    return text[m.start(): min(len(text), m.start() + width)]


def _month_abbr(period: str) -> tuple[str, str]:
    """« 2026-10 » → (« oct », « 2026 »)."""
    y, m = period.split("-")
    return MONTHS[int(m) - 1][:3], y


# --- tableaux HTML du BLS ----------------------------------------------------------

@dataclass
class Table:
    columns: list[str]  # libellés des colonnes de données, dans l'ordre
    rows: list[tuple[str, list[str]]]  # (libellé de ligne, cellules)


def read_table(body: str, table_id: str) -> Table | None:
    m = re.search(rf'<table[^>]*id="{re.escape(table_id)}"[^>]*>(.*?)</table>', body, re.S)
    if not m:
        return None
    inner = m.group(1)
    head = re.search(r"<thead>(.*?)</thead>", inner, re.S)
    head_rows = re.findall(r"<tr[^>]*>(.*?)</tr>", head.group(1) if head else "", re.S)
    # Colonnes de données : les <th> sans « rowspan » de la 2e ligne d'en-tête,
    # insérés à la place de leur groupe ; les <th rowspan="2"> de la 1re ligne restent.
    cols: list[str] = []
    if head_rows:
        first = re.findall(r"<th([^>]*)>(.*?)</th>", head_rows[0], re.S)
        second = [normalize(c) for _, c in re.findall(r"<th([^>]*)>(.*?)</th>",
                                                      head_rows[1] if len(head_rows) > 1 else "",
                                                      re.S)]
        for attrs, cell in first[1:]:
            span = re.search(r'colspan="(\d+)"', attrs)
            if span:
                n = int(span.group(1))
                cols.extend(second[:n])
                second = second[n:]
            else:
                cols.append(normalize(cell))
    body_html = inner[head.end():] if head else inner
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body_html, re.S):
        th = re.search(r"<th[^>]*>(.*?)</th>", tr, re.S)
        cells = [normalize(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if th is None:
            continue
        rows.append((normalize(th.group(1)), cells))
    # Sans <thead> (tableau A du PPI) : la première ligne de <th> est l'en-tête.
    return Table(cols, rows)


def _label(s: str) -> str:
    """Libellé sans renvoi de note : « Food away from home(1) » → « food away from home »."""
    return re.sub(r"\(\d+\)", "", s).strip().lower()


# --- IPC ---------------------------------------------------------------------------

_CPI_LEAD = re.compile(
    rf"The Consumer Price Index for All Urban Consumers \(CPI-U\) ({UP}|{DOWN}|{FLAT})"
    r"(?: (\d+\.\d) percent)?([^.]*)")


def _read_cpi(body: str, text: str, period: str) -> dict[str, Figure]:
    out: dict[str, Figure] = {}
    lead = _CPI_LEAD.search(text)
    irregular = bool(lead and re.search(r"over the \d+ months|from \w+ \d{4} to \w+ \d{4}",
                                        lead.group(3)))
    table = read_table(body, "cpi_pressa")
    month, year = _month_abbr(period)
    if table is None or len(table.columns) < 2:
        why = "tableau A absent : forme du communiqué inconnue"
        return {i: Figure(i, None, why) for i in RELEASES["cpi"].indicators}
    # Dernière colonne mensuelle = mois publié ; dernière colonne = 12 mois.
    monthly = table.columns[-2].lower().replace(".", "")
    yearly = table.columns[-1].lower().replace(".", "")
    monthly_ok = monthly.startswith(month) and monthly.endswith(year)
    yearly_ok = "12" in yearly and month in yearly and year in yearly
    rows = {_label(lbl): cells for lbl, cells in table.rows}

    def cell(row: str, col: int, ok: bool, ind: str, what: str) -> Figure:
        cells = rows.get(row)
        if not ok:
            return Figure(ind, None, f"colonne {what} du tableau A ≠ période {period}",
                          "tableau A")
        if cells is None or len(cells) != len(table.columns):
            return Figure(ind, None, f"ligne « {row} » absente du tableau A", "tableau A")
        v = _dec(cells[col])
        if v is None:
            return Figure(ind, None, f"non publié par le BLS (« {cells[col]} »)", "tableau A")
        return Figure(ind, v, None, "tableau A", f"Table A · {row} · {table.columns[col]}")

    if irregular:
        why = "publication irrégulière : variation sur plusieurs mois (shutdown)"
        out["us-cpi-mm"] = Figure("us-cpi-mm", None, why, "texte", _excerpt(text, lead))
        out["us-core-cpi-mm"] = Figure("us-core-cpi-mm", None, why, "texte")
    else:
        out["us-cpi-mm"] = cell("all items", -2, monthly_ok, "us-cpi-mm", "du mois")
        out["us-core-cpi-mm"] = cell("all items less food and energy", -2, monthly_ok,
                                     "us-core-cpi-mm", "du mois")
    out["us-cpi-yy"] = cell("all items", -1, yearly_ok, "us-cpi-yy", "sur 12 mois")
    out["us-core-cpi-yy"] = cell("all items less food and energy", -1, yearly_ok,
                                 "us-core-cpi-yy", "sur 12 mois")
    # Contrôle croisé : quand le texte énonce le même chiffre, il doit dire la même chose
    # que le tableau ; un désaccord bloque la lecture. Phrase absente : chiffre gardé, noté.
    checks = {
        "us-cpi-mm": lead,
        "us-core-cpi-mm": _first(_CPI_CORE_MM, text, lambda m: "12 months" not in
                                 text[m.end(): m.end() + 40]),
        "us-cpi-yy": _CPI_YY.search(text),
        "us-core-cpi-yy": _CPI_CORE_YY.search(text),
    }
    for ind, m in checks.items():
        out[ind] = cross_check(out[ind], m, text)
    return out


_CPI_CORE_MM = re.compile(
    rf"index for all items less food and energy ({UP}|{DOWN}|{FLAT})(?: (\d+\.\d) percent)?")
_CPI_YY = re.compile(rf"Over the last 12 months, the all items index ({UP}|{DOWN}|{FLAT})"
                     r"(?: (\d+\.\d) percent)?")
_CPI_CORE_YY = re.compile(rf"all items less food and energy index ({UP}|{DOWN}|{FLAT})"
                          r"(?: (\d+\.\d) percent)? over the last 12 months")


def _first(pat: re.Pattern, text: str, keep) -> re.Match | None:
    return next((m for m in pat.finditer(text) if keep(m)), None)


def cross_check(fig: Figure, m: re.Match | None, text: str) -> Figure:
    """Chiffre du tableau contre la phrase du texte (groupes : verbe, nombre)."""
    if fig.value is None:
        return fig
    if m is None:
        return Figure(**{**fig.__dict__, "flags": (*fig.flags, "texte non trouvé")})
    said = _signed(m.group(1), m.group(2))
    if said is None:
        return Figure(**{**fig.__dict__, "flags": (*fig.flags, "texte illisible")})
    if Decimal(said) != Decimal(fig.value):
        return Figure(fig.indicator, None, f"désaccord texte ({said}) / tableau A ({fig.value})",
                      fig.part, _excerpt(text, m))
    # Citation : la phrase du communiqué, plus lisible que la référence de cellule.
    return Figure(**{**fig.__dict__, "excerpt": _excerpt(text, m),
                     "flags": (*fig.flags, "texte concordant")})


# --- PPI ---------------------------------------------------------------------------

_PPI_LEAD = re.compile(
    rf"The Producer Price Index for final demand ({UP}|{DOWN}|{FLAT})(?: (\d+\.\d) percent)?")


def _read_ppi(body: str, text: str, period: str) -> dict[str, Figure]:
    # Publié dans le tableau 1 du communiqué complet seulement ; la valeur arrive par l'API v1
    # (release_service.check_revisions, série WPSFD49104, vérifiée le 23/11/2026).
    core_why = ("indice « final demand less foods and energy » absent du résumé du BLS : "
                "complété par l'API v1 (série WPSFD49104) dès sa mise à jour")
    out = {"us-core-ppi-mm": Figure("us-core-ppi-mm", None, core_why)}
    table = read_table(body, "ppi_nrtablea")
    lead = _PPI_LEAD.search(text)
    if table is None:
        out["us-ppi-mm"] = Figure("us-ppi-mm", None, "tableau A absent : forme inconnue")
        return out
    month, year = _month_abbr(period)
    # Lignes : un libellé d'année (« 2026 ») puis les mois (« Oct. ») ; la dernière est la période.
    cur_year, last = None, None
    for lbl, cells in table.rows:
        if re.fullmatch(r"\d{4}", lbl):
            cur_year = lbl
        elif cells:
            last = (cur_year, lbl, cells)
    if last is None or last[0] != year or not last[1].lower().startswith(month):
        got = f"{last[1]} {last[0]}" if last else "aucune"
        out["us-ppi-mm"] = Figure("us-ppi-mm", None,
                                  f"dernière ligne du tableau A ({got}) ≠ période {period}",
                                  "tableau A")
        return out
    total = (table.columns or [""])[0].lower().replace(" ", "")
    if "totalfinaldemand" not in total:
        out["us-ppi-mm"] = Figure("us-ppi-mm", None,
                                  "1re colonne du tableau A ≠ « Total final demand »", "tableau A")
        return out
    v = _dec(last[2][0])
    if v is None:
        out["us-ppi-mm"] = Figure("us-ppi-mm", None, f"non publié (« {last[2][0]} »)",
                                  "tableau A")
        return out
    fig = Figure("us-ppi-mm", v, None, "tableau A",
                 f"Table A · {last[1]} {last[0]} · Total final demand")
    fig = cross_check(fig, lead, text)
    out["us-ppi-mm"] = fig
    return out


# --- emploi ------------------------------------------------------------------------

_NFP = [
    # « Total nonfarm payroll employment rose by 165,000 in October »
    # « … and nonfarm payroll employment edged up by 114,000 » (juillet 2024)
    re.compile(rf"(?:[Tt]otal )?nonfarm payroll employment ({UP}|{DOWN}) by "
               rf"(\d{{1,3}}(?:,\d{{3}})+)"),
    # « … changed little in July (+73,000) », « was essentially unchanged in October (+12,000) »
    re.compile(r"[Tt]otal nonfarm payroll employment (?:changed little|was little changed|"
               r"was essentially unchanged|was unchanged|edged (?:up|down))[^()]{0,40}"
               r"\(([+-]\d{1,3}(?:,\d{3})*)\)"),
    # « Both nonfarm payroll employment (-23,000) and the unemployment rate (4.1 percent)… »
    re.compile(r"(?:[Tt]otal )?nonfarm payroll employment \(([+-]\d{1,3}(?:,\d{3})*)\)"),
]
_UR = re.compile(r"[Uu]nemployment rate[^.()]{0,45}?\(?(\d{1,2}\.\d) percent")
_AHE = re.compile(
    rf"[Aa]verage hourly earnings for all employees on private nonfarm payrolls "
    rf"({UP}|{DOWN}|{FLAT}|were little changed)((?:[^.]|\.\d){{0,90}})")


def _read_empsit(body: str, text: str, period: str) -> dict[str, Figure]:
    out: dict[str, Figure] = {}
    # Le résumé s'arrête à « Household Survey Data » : au-delà, d'autres taux et effectifs.
    start = text.find("THE EMPLOYMENT SITUATION")
    end = text.find("Household Survey Data", start)
    lead = text[start: end if end > 0 else start + 1500] if start >= 0 else ""
    if not lead:
        why = "titre « THE EMPLOYMENT SITUATION » absent : forme inconnue"
        return {i: Figure(i, None, why) for i in RELEASES["empsit"].indicators}

    nfp = None
    for k, pat in enumerate(_NFP):
        m = pat.search(lead)
        if m and (nfp is None or m.start() < nfp[1].start()):
            nfp = (k, m)
    if nfp is None:
        out["us-nfp"] = Figure("us-nfp", None, "tournure de l'emploi salarié non reconnue",
                               "texte")
    else:
        k, m = nfp
        if k == 0:
            raw = ("-" if re.fullmatch(DOWN, m.group(1).lower()) else "+") + m.group(2)
        else:
            raw = m.group(1)
        out["us-nfp"] = Figure("us-nfp", _thousands(raw), None, "texte", _excerpt(lead, m))

    m = _UR.search(lead)
    out["us-unemployment"] = (Figure("us-unemployment", m.group(1), None, "texte",
                                     _excerpt(lead, m))
                              if m else Figure("us-unemployment", None,
                                               "taux de chômage absent du résumé", "texte"))

    m = _AHE.search(text)
    if m is None:
        out["us-ahe-mm"] = Figure("us-ahe-mm", None, "phrase du salaire horaire non reconnue",
                                  "texte")
    else:
        pct = re.search(r"or (\d+\.\d) percent", m.group(2))
        if re.fullmatch(FLAT, m.group(1).lower()) and not pct:
            out["us-ahe-mm"] = Figure("us-ahe-mm", "0.0", None, "texte", _excerpt(text, m))
        elif pct:
            v = _signed(m.group(1), pct.group(1))
            out["us-ahe-mm"] = (Figure("us-ahe-mm", v, None, "texte", _excerpt(text, m)) if v
                                else Figure("us-ahe-mm", None, "verbe non reconnu", "texte",
                                            _excerpt(text, m)))
        else:
            out["us-ahe-mm"] = Figure("us-ahe-mm", None,
                                      "variation publiée en cents seulement, sans pourcentage",
                                      "texte", _excerpt(text, m))
    return out


# --- productivité ------------------------------------------------------------------

def _read_prod2(body: str, text: str, period: str) -> dict[str, Figure]:
    year, q = period.split("-Q")
    quarter = next(name for name, n in QUARTERS.items() if n == int(q))
    out: dict[str, Figure] = {}
    for ind, subject in (("us-prod-qq", r"Nonfarm business sector labor productivity"),
                         ("us-ulc-qq", r"Unit labor costs in the nonfarm business sector")):
        m = re.search(rf"{subject} ({UP}|{DOWN}|{FLAT})(?: (\d+\.\d) percent)? "
                      rf"(?:in|during) the (\w+) quarter of (\d{{4}})", text)
        if m is None:
            out[ind] = Figure(ind, None, "phrase d'ouverture non reconnue", "texte")
        elif m.group(3).lower() != quarter or m.group(4) != year:
            out[ind] = Figure(ind, None, f"trimestre du texte ≠ période {period}", "texte",
                              _excerpt(text, m))
        else:
            v = _signed(m.group(1), m.group(2))
            out[ind] = (Figure(ind, v, None, "texte", _excerpt(text, m)) if v is not None
                        else Figure(ind, None, "verbe non reconnu", "texte", _excerpt(text, m)))
    return out


# --- nouveauté ---------------------------------------------------------------------

def classify(parsed: Parsed, expected_date: str,
             baseline: tuple[str | None, str | None] | None) -> str | None:
    """La page montre-t-elle la publication attendue ?

    - « attendue » : embargo à la date prévue (New York), version ≠ celle d'avant ;
    - « en avance » / « en retard » : nouvelle version, embargo à une autre date
      (le CPI de mai 2024 est sorti 31 min en avance) : signalée, jamais ignorée ;
    - None : rien de nouveau (ou page inexploitable).
    """
    if parsed.page != "ok" or parsed.period is None or parsed.embargo_date is None:
        return None
    if baseline is not None and parsed.version == baseline:
        return None
    if parsed.embargo_date == expected_date:
        return "attendue"
    if baseline is None:
        return None  # première page lue : c'est la référence, pas une nouveauté
    return "en avance" if parsed.embargo_date < expected_date else "en retard"
