"""Règles d'alerte (étape E4, plan P1 § 11) : validation, libellés, conditions, messages.
Fonctions pures, sans bus ni réseau.

Six sortes de règles :

- `price` : franchissement d'un prix OKX (dernier trade), à la hausse, à la baisse ou
  les deux. Une fois déclenchée, la règle attend d'être réarmée.
- `funding` : funding OKX au-dessus (ou en dessous) d'un seuil, en %. Se réarme
  d'elle-même quand le funding repasse de l'autre côté.
- `event_soon` : T-n min avant une publication de l'agenda (captée, ou filtrée par
  impact et devise). Une fois par événement.
- `release` : publication d'un chiffre capté à la source (BLS). Une fois par publication.
- `surprise` : |z| ou surprise brute au-delà d'un seuil, sur un chiffre capté.
- `keyword` : mot-clé dans un titre du fil d'actus (E6). Une fois par titre.

Nombres au format français : virgule décimale, espace fine insécable entre milliers,
signe moins U+2212.
"""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

from .bls_release import RELEASES
from .calendar_data import INDICATORS

KINDS = ("price", "funding", "event_soon", "release", "surprise", "keyword",
         "event_watch", "news_category")
# Fil d'actus (E6/O6) : catégories des titres, comme news_rules.ts de Supabase.
NEWS_CATEGORIES = {"banque-centrale": "Banque centrale", "macro": "Macro", "crypto": "Crypto",
                   "matieres-premieres": "Matières premières", "general": "Général"}
# Identifiant d'un événement de l'agenda : « 552-us-flash-manufacturing-pmi|USD|2026-11-23|1 ».
EVENT_ID = re.compile(r"\d+-[a-z]{2}-[a-z0-9-]+\|[A-Z]{3}\|\d{4}-\d{2}-\d{2}\|\d+")
CHANNELS = ("écran", "telegram", "voix")
STATES = ("armée", "déclenchée", "désactivée")
IMPACTS = ("High", "Medium", "Low")
LABELS = {i.id: i for i in INDICATORS}
RELEASE_FR = {"cpi": "IPC", "empsit": "emploi", "ppi": "prix à la production",
              "prod2": "productivité"}
NBSP, THIN, MINUS = "\u00a0", "\u202f", "\u2212"
NEWS_FR = "fil d\u2019actus"


class RuleError(ValueError):
    pass


# --- format français ---------------------------------------------------------------------


def dec(x: object) -> Decimal | None:
    if x is None or isinstance(x, bool):
        return None
    try:
        d = Decimal(str(x).strip().replace(",", ".").replace(MINUS, "-"))
    except InvalidOperation:
        return None
    return d if d.is_finite() else None


def fr_num(x: object, decimals: int | None = None, signed: bool = False) -> str:
    d = dec(x)
    if d is None:
        return "—"
    if decimals is not None:
        d = d.quantize(Decimal(1).scaleb(-decimals))
    if d == 0:
        d = abs(d)
    body = format(abs(d), ",f").replace(",", THIN).replace(".", ",")
    sign = MINUS if d < 0 else ("+" if signed and d > 0 else "")
    return sign + body


def inst_label(inst: str) -> str:
    return inst.replace("-SWAP", " perp")


def value_fr(value: str | None, unit: str | None) -> str:
    if value is None:
        return "—"
    u = {"%": f"{NBSP}%", "K": f"{NBSP}k"}.get(unit or "", "")
    return fr_num(value) + u


# --- validation ----------------------------------------------------------------------------


def _decimal(params: dict, key: str, positive: bool = True, required: bool = True) -> str | None:
    if params.get(key) in (None, ""):
        if required:
            raise RuleError(f"{key} manquant")
        return None
    d = dec(params[key])
    if d is None or (positive and d <= 0):
        raise RuleError(f"{key} invalide : {params[key]!r}")
    return format(d.normalize(), "f")


def validate(kind: str, params: dict, channels: list[str],
             instruments: tuple[str, ...]) -> tuple[dict, list[str]]:
    """Paramètres et canaux nettoyés ; RuleError avec la raison sinon."""
    if kind not in KINDS:
        raise RuleError(f"sorte de règle inconnue : {kind!r}")
    if not isinstance(params, dict):
        raise RuleError("paramètres attendus en objet JSON")
    chans = [c for c in CHANNELS if c in (channels or [])]
    if "écran" not in chans:
        chans.insert(0, "écran")  # une alerte s'affiche toujours
    out: dict
    if kind in ("price", "funding"):
        inst = params.get("inst")
        if inst not in instruments:
            raise RuleError(f"instrument non suivi : {inst!r}")
    if kind == "price":
        direction = params.get("direction", "les deux")
        if direction not in ("hausse", "baisse", "les deux"):
            raise RuleError("direction : hausse, baisse ou les deux")
        out = {"inst": params["inst"], "level": _decimal(params, "level"), "direction": direction}
    elif kind == "funding":
        side = params.get("side", "au-dessus")
        if side not in ("au-dessus", "en dessous"):
            raise RuleError("côté : au-dessus ou en dessous")
        thr = _decimal(params, "threshold_pct", positive=False)
        if abs(Decimal(thr)) > 5:
            raise RuleError("seuil de funding hors bornes (±5 %)")
        out = {"inst": params["inst"], "threshold_pct": thr, "side": side}
    elif kind == "event_soon":
        minutes = params.get("minutes", 5)
        if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= 120:
            raise RuleError("minutes : entier de 1 à 120")
        impacts = [i for i in params.get("impacts") or [] if i in IMPACTS]
        currencies = sorted({str(c).upper() for c in params.get("currencies") or []
                             if re.fullmatch(r"[A-Za-z]{3}", str(c))})
        out = {"minutes": minutes, "captured_only": bool(params.get("captured_only", False)),
               "impacts": impacts, "currencies": currencies}
    elif kind == "release":
        releases = [r for r in params.get("releases") or [] if r in RELEASES]
        out = {"releases": releases}
    elif kind == "surprise":
        ind = params.get("indicator") or None
        if ind is not None and ind not in LABELS:
            raise RuleError(f"indicateur inconnu : {ind!r}")
        z_min = _decimal(params, "z_min", required=False)
        raw_min = _decimal(params, "raw_min", required=False)
        if z_min is None and raw_min is None:
            raise RuleError("seuil manquant : z_min ou raw_min")
        out = {"indicator": ind, "z_min": z_min, "raw_min": raw_min}
    elif kind == "event_watch":
        # Cloche d'un événement du calendrier : le réel part dès qu'il est connu
        # (BLS ou fil d'actus).
        eid = str(params.get("event_id") or "")
        if not EVENT_ID.fullmatch(eid):
            raise RuleError("event_id : identifiant d'événement de l'agenda attendu")
        title = str(params.get("title") or "").strip()
        if not 1 <= len(title) <= 120:
            raise RuleError("title : 1 à 120 caractères")
        t = params.get("time_ms")
        if t is not None and (not isinstance(t, int) or isinstance(t, bool) or t <= 0):
            raise RuleError("time_ms : entier positif ou absent")
        out = {"event_id": eid, "title": title, "currency": eid.split("|")[1], "time_ms": t}
    elif kind == "news_category":
        cat = params.get("category")
        if cat not in NEWS_CATEGORIES:
            raise RuleError(f"catégorie inconnue : {cat!r}")
        out = {"category": cat, "urgent_only": bool(params.get("urgent_only", False))}
    else:  # keyword
        words = [str(w).strip() for w in params.get("words") or [] if str(w).strip()]
        if not 1 <= len(words) <= 20 or any(len(w) > 60 for w in words):
            raise RuleError("mots-clés : de 1 à 20, 60 caractères au plus")
        out = {"words": words}
    return out, chans


# --- libellés ------------------------------------------------------------------------------


def describe(kind: str, p: dict) -> tuple[str, str]:
    """(libellé, catégorie) de la règle, comme dans le panneau « Alertes actives »."""
    if kind == "price":
        way = {"hausse": " à la hausse", "baisse": " à la baisse"}.get(p["direction"], "")
        return f"{inst_label(p['inst']).split('-')[0]} franchit {fr_num(p['level'])}{way}", \
            "Prix · OKX"
    if kind == "funding":
        return (f"Funding OKX {p['side']} de {fr_num(p['threshold_pct'])}{NBSP}%",
                f"Dérivés · {inst_label(p['inst'])}")
    if kind == "event_soon":
        what = "une publication captée" if p["captured_only"] else "un événement"
        filt = []
        if p["impacts"]:
            filt.append("impact " + "/".join({"High": "fort", "Medium": "moyen",
                                              "Low": "faible"}[i] for i in p["impacts"]))
        if p["currencies"]:
            filt.append(", ".join(p["currencies"]))
        return f"T{MINUS}{p['minutes']}{NBSP}min avant {what}" + (
            f" ({' · '.join(filt)})" if filt else ""), "Calendrier"
    if kind == "release":
        names = ", ".join(RELEASE_FR[r] for r in p["releases"]) or "tous les indicateurs suivis"
        return f"Chiffre publié : {names}", "Calendrier · BLS"
    if kind == "surprise":
        ind = LABELS[p["indicator"]].label_fr if p["indicator"] else "chiffre capté"
        seuils = []
        if p["z_min"]:
            seuils.append(f"|z| ≥ {fr_num(p['z_min'])}")
        if p["raw_min"]:
            seuils.append(f"|surprise| ≥ {fr_num(p['raw_min'])}")
        return f"Surprise {ind} : {' ou '.join(seuils)}", "Calendrier · surprise"
    if kind == "event_watch":
        return f"Réel publié : {p['title']} ({p['currency']})", "Calendrier · événement"
    if kind == "news_category":
        return (f"Fil d\u2019actus : {NEWS_CATEGORIES[p['category']]}"
                + (" · fort impact" if p["urgent_only"] else ""), "Fil d\u2019actus · catégorie")
    return f"Mot-clé : {', '.join(p['words'])}", "Fil d\u2019actus"


# --- conditions ----------------------------------------------------------------------------


def price_crossed(p: dict, prev: float | None, px: float) -> bool:
    if prev is None:
        return False
    level = float(p["level"])
    up = prev < level <= px
    down = prev > level >= px
    return {"hausse": up, "baisse": down}.get(p["direction"], up or down)


def funding_hit(p: dict, rate: float) -> bool:
    pct = Decimal(repr(float(rate))) * 100
    thr = Decimal(p["threshold_pct"])
    return pct >= thr if p["side"] == "au-dessus" else pct <= thr


def event_matches(p: dict, ev: dict) -> bool:
    if p["captured_only"] and not ev.get("capture"):
        return False
    if p["impacts"] and ev.get("impact") not in p["impacts"]:
        return False
    return not p["currencies"] or ev.get("currency") in p["currencies"]


def release_matches(p: dict, last: dict) -> bool:
    return not p["releases"] or last.get("release") in p["releases"]


def surprise_hit(p: dict, fig: dict) -> bool:
    if fig.get("value") is None or (p["indicator"] and fig.get("indicator") != p["indicator"]):
        return False
    z, raw = dec(fig.get("z")), dec(fig.get("surprise"))
    return bool((p["z_min"] and z is not None and abs(z) >= Decimal(p["z_min"]))
                or (p["raw_min"] and raw is not None and abs(raw) >= Decimal(p["raw_min"])))


def news_category_hit(p: dict, item: dict) -> bool:
    return (item.get("category") == p["category"]
            and (not p["urgent_only"] or bool(item.get("urgent"))))


def fold(text: str) -> str:
    """Minuscules sans accents : « Réserve fédérale » -> « reserve federale »."""
    norm = unicodedata.normalize("NFKD", text)
    return "".join(c for c in norm if not unicodedata.combining(c)).casefold()


def keyword_hit(p: dict, text: str) -> str | None:
    hay = fold(text)
    for w in p["words"]:
        if re.search(rf"(?<!\w){re.escape(fold(w))}(?!\w)", hay):
            return w
    return None


# --- messages ------------------------------------------------------------------------------


def price_message(p: dict, prev: float, px: float) -> tuple[str, str]:
    way = "à la hausse" if px >= prev else "à la baisse"
    return (f"{inst_label(p['inst'])} franchit {fr_num(p['level'])} {way}",
            f"Dernier {fr_num(px)} (précédent {fr_num(prev)}) · OKX")


def funding_message(p: dict, rate: float) -> tuple[str, str]:
    pct = Decimal(repr(float(rate))) * 100
    return (f"Funding {inst_label(p['inst'])} à {fr_num(pct, 4, signed=True)}{NBSP}%",
            f"Seuil {p['side']} de {fr_num(p['threshold_pct'])}{NBSP}% · OKX")


def event_message(p: dict, ev: dict, hm_paris: str) -> tuple[str, str]:
    title = ev.get("title_fr") or ev.get("title") or "événement"
    fc = ev.get("forecast_raw")
    return (f"Dans {p['minutes']}{NBSP}min : {title} ({ev.get('currency')})",
            f"{hm_paris} Paris" + (f" · consensus {fc}" if fc else " · aucun consensus publié")
            + (" · capté à la source" if ev.get("capture") else ""))


def figure_line(fig: dict) -> str:
    unit = fig.get("unit")
    line = f"{fig.get('label_fr') or fig.get('indicator')} : {value_fr(fig.get('value'), unit)}"
    if fig.get("value") is None:
        return line + f" ({fig.get('reason') or 'non lu'})"
    if fig.get("forecast") is not None:
        line += f" (prév. {value_fr(fig['forecast'], unit)}"
        if fig.get("surprise") is not None:
            line += f", surprise {fr_num(fig['surprise'], signed=True)}"
        if fig.get("z") is not None:
            line += f", z {fr_num(fig['z'], signed=True)}"
        line += ")"
    return line


def release_message(last: dict, figs: list[dict]) -> tuple[str, str]:
    title = last.get("title") or last.get("release")
    period = last.get("period") or ""
    nature = last.get("nature") or "officielle"
    head = f"{title} · {period}" + (" (révisé)" if last.get("edition") == "Revised" else "")
    tail = "BLS" + ("" if nature == "officielle" else f" · {nature}")
    return head, "\n".join([*(figure_line(f) for f in figs), tail])


def surprise_message(fig: dict) -> tuple[str, str]:
    label = fig.get("label_fr") or fig.get("indicator")
    return f"Surprise : {label}", figure_line(fig) + " · BLS"


def keyword_message(word: str, item: dict) -> tuple[str, str]:
    source = item.get("source") or NEWS_FR
    return f"« {word} » : {item.get('title') or ''}"[:200], f"{source} · VO"


def event_watch_message(p: dict, ev: dict, actual: str, source: str) -> tuple[str, str]:
    """Réel d'un événement suivi par sa cloche : valeur, consensus, précédent, source."""
    title = ev.get("title_fr") or ev.get("title") or p["title"]
    return (f"{title} ({p['currency']}) : {actual}",
            f"Consensus {ev.get('forecast_raw') or '—'} · précédent "
            f"{ev.get('previous_raw') or '—'} · source : {source}")


def event_missing_message(p: dict, ev: dict, hm_paris: str) -> tuple[str, str]:
    """Aucun réel 30 min après l'heure prévue : on le dit, sans valeur inventée."""
    title = ev.get("title_fr") or ev.get("title") or p["title"]
    return (f"{title} ({p['currency']}) : réel non capté",
            f"Publication prévue à {hm_paris} (Paris). ForexFactory ne publie pas le réel "
            "et aucun titre FinancialJuice n\u2019a été rattaché dans les 30 min.")


def news_category_message(p: dict, item: dict) -> tuple[str, str]:
    label = NEWS_CATEGORIES[p["category"]]
    return (f"{label} : {item.get('title') or ''}"[:200],
            f"{item.get('source') or NEWS_FR}{' · fort impact' if item.get('urgent') else ''} · VO")

