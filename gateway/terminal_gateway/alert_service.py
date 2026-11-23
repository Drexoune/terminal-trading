"""Service « alert » (étape E4, docs/plan-p1.md § 11) : moteur d'alertes de la passerelle.

- Les règles vivent dans SQLite (`alert_rules`) ; leur état est publié sur
  `alert:rule:<id>`, le résumé sur `alert:summary`, chaque déclenchement sur
  `alert:fired:<id>` (50 derniers gardés sur le bus).
- Écouteurs SYNCHRONES du bus (décision E1) : chaque trade OKX est vu, sans
  conflation ; un franchissement de prix ne peut pas passer entre deux images.
  La décision de déclencher et la publication à l'écran se font dans l'écouteur ;
  l'écriture en base et l'envoi Telegram suivent dans une file, sans bloquer le flux.
- Un déclenchement par règle et par objet (`unique (rule_id, dedupe)`) : une
  publication republiée au démarrage, ou après une révision, ne redéclenche rien,
  et un chiffre n'alerte que s'il vient d'être capté (moins de 2 min).
- Canaux : écran (toujours), Telegram (T-020, envoyé ici), voix (le navigateur lit
  `voice` dans l'alerte). Telegram absent : l'alerte porte « non configuré ».
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from zoneinfo import ZoneInfo

from . import alert_rules as ar
from .bus import Bus
from .config import Settings
from .storage import Storage
from .telegram import Notifier, TelegramNotifier

log = logging.getLogger(__name__)

PARIS = ZoneInfo("Europe/Paris")
TIMER_S = 10
FRESH_MS = 120_000  # un chiffre plus ancien n'alerte plus (republication, révision)
KEEP_EVENTS = 200
SEEN_DAYS_MS = 3 * 86_400_000
UNACKED_WINDOW_MS = 86_400_000
TEST_TEXT = "Essai : les alertes du terminal arrivent bien sur ce téléphone."


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def hm_paris(ms: int, seconds: bool = False) -> str:
    return datetime.fromtimestamp(ms / 1000, PARIS).strftime("%H:%M:%S" if seconds else "%H:%M")


def day_paris(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, PARIS).strftime("%d/%m/%Y")


class AlertService:
    name = "alert"
    needs_storage = True

    def __init__(self, bus: Bus, storage: Storage, settings: Settings,
                 notifier: Notifier | None = None, clock: Callable[[], int] = now_ms,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> None:
        self.bus, self.db, self.settings = bus, storage, settings
        self.clock, self.sleep = clock, sleep
        self.notifier = notifier or TelegramNotifier(settings.telegram_bot_token,
                                                     settings.telegram_chat_id)
        self.rules: dict[int, dict] = {}
        self.events: dict[str, dict] = {}  # déclenchements récents, par identifiant
        self._seen: set[tuple[int, str]] = set()
        self._prev_px: dict[str, float] = {}
        self._queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()
        self._unlisten: list[Callable[[], None]] = []
        self._tasks: list[asyncio.Task] = []
        self.started_ms = 0
        bus.set_retention("alert:fired:", 50)

    # --- cycle de vie ---------------------------------------------------------------------

    async def start(self) -> None:
        self.started_ms = self.clock()
        await self._load()
        for prefix, fn in (("trade:", self._on_trade), ("funding:", self._on_funding),
                           ("release:", self._on_release), ("news:item:", self._on_news)):
            self._unlisten.append(self.bus.listen(prefix, fn))
        self._tasks = [asyncio.create_task(self._worker(), name="alert-worker"),
                       asyncio.create_task(self._timer_loop(), name="alert-timer")]

    async def stop(self) -> None:
        for off in self._unlisten:
            off()
        self._unlisten = []
        await self.drain()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []
        await self.notifier.aclose()

    async def drain(self) -> None:
        """Attend que la file (écritures, envois) soit vide : arrêt propre, tests."""
        if self._tasks:
            await self._queue.join()

    def health(self) -> dict:
        tg = self.notifier.health() if hasattr(self.notifier, "health") else {}
        return {"rules": len(self.rules),
                "armed": sum(r["state"] == "armée" for r in self.rules.values()),
                "unacked": self._unacked(), "telegram": tg, "queue": self._queue.qsize()}

    async def _load(self) -> None:
        for r in await self.db.query("select * from alert_rules order by id"):
            self._set_rule(r, publish=False)
        since = self.clock() - SEEN_DAYS_MS
        for e in await self.db.query(
                "select * from alert_events where fired_ms > ? order by fired_ms", (since,)):
            self._seen.add((e["rule_id"], e["dedupe"]))
            ev = self._event_payload(e)
            self.events[ev["id"]] = ev
        for ev in list(self.events.values())[-50:]:
            self.bus.publish(f"alert:fired:{ev['id']}", ev)
        for rule in self.rules.values():
            self._publish_rule(rule)
        self._publish_summary()

    # --- règles ---------------------------------------------------------------------------

    def _set_rule(self, row: dict, publish: bool = True) -> dict:
        params = json.loads(row["params"]) if isinstance(row["params"], str) else row["params"]
        channels = (json.loads(row["channels"]) if isinstance(row["channels"], str)
                    else row["channels"])
        label, category = ar.describe(row["kind"], params)
        rule = {"id": row["id"], "kind": row["kind"], "params": params, "channels": channels,
                "state": row["state"], "label": label, "category": category,
                "created_ms": row["created_ms"], "updated_ms": row["updated_ms"],
                "last_fired_ms": row.get("last_fired_ms")}
        self.rules[rule["id"]] = rule
        if publish:
            self._publish_rule(rule)
            self._publish_summary()
        return rule

    def _publish_rule(self, rule: dict) -> None:
        self.bus.publish(f"alert:rule:{rule['id']}", dict(rule))

    def _unacked(self) -> int:
        since = self.clock() - UNACKED_WINDOW_MS
        return sum(1 for e in self.events.values() if not e["acked_ms"] and e["fired_ms"] > since)

    def _publish_summary(self) -> None:
        last = max((e["fired_ms"] for e in self.events.values()), default=None)
        self.bus.publish("alert:summary", {
            "rules": len(self.rules),
            "armed": sum(r["state"] == "armée" for r in self.rules.values()),
            "unacked": self._unacked(), "last_fired_ms": last,
            "telegram": self.notifier.health() if hasattr(self.notifier, "health") else None,
            "computed_ms": self.clock()})

    async def create_rule(self, kind: str, params: dict, channels: list[str]) -> dict:
        p, chans = ar.validate(kind, params, channels, self.settings.instruments)
        now = self.clock()
        rid = await self.db.execute(
            "insert into alert_rules (kind, params, channels, state, created_ms, updated_ms)"
            " values (?, ?, ?, 'armée', ?, ?)",
            (kind, json.dumps(p, ensure_ascii=False), json.dumps(chans, ensure_ascii=False),
             now, now))
        return self._set_rule({"id": rid, "kind": kind, "params": p, "channels": chans,
                               "state": "armée", "created_ms": now, "updated_ms": now})

    async def update_rule(self, rid: int, state: str | None = None,
                          channels: list[str] | None = None, params: dict | None = None) -> dict:
        rule = self.rules.get(rid)
        if rule is None:
            raise KeyError(f"règle {rid} inconnue")
        if state is not None and state not in ("armée", "désactivée"):
            raise ar.RuleError("état : armée ou désactivée (« déclenchée » vient du moteur)")
        p, chans = ar.validate(rule["kind"], params if params is not None else rule["params"],
                               channels if channels is not None else rule["channels"],
                               self.settings.instruments)
        new_state = state or rule["state"]
        now = self.clock()
        await self.db.execute(
            "update alert_rules set params = ?, channels = ?, state = ?, updated_ms = ?"
            " where id = ?", (json.dumps(p, ensure_ascii=False),
                              json.dumps(chans, ensure_ascii=False), new_state, now, rid))
        return self._set_rule({**rule, "params": p, "channels": chans, "state": new_state,
                               "updated_ms": now})

    async def delete_rule(self, rid: int) -> None:
        if self.rules.pop(rid, None) is None:
            raise KeyError(f"règle {rid} inconnue")
        await self.db.execute("delete from alert_events where rule_id = ?", (rid,))
        await self.db.execute("delete from alert_rules where id = ?", (rid,))
        for eid in [e for e, ev in self.events.items() if ev["rule_id"] == rid]:
            del self.events[eid]
            self.bus.delete(f"alert:fired:{eid}")
        self.bus.delete(f"alert:rule:{rid}")
        self._publish_summary()

    async def ack(self, ids: list[str] | None = None) -> int:
        """Acquitte les alertes données, ou toutes celles qui ne le sont pas."""
        now, n = self.clock(), 0
        for ev in self.events.values():
            if ev["acked_ms"] or (ids is not None and ev["id"] not in ids):
                continue
            ev["acked_ms"] = now
            n += 1
            await self.db.execute("update alert_events set acked_ms = ? where id = ?",
                                  (now, ev["id"]))
            self.bus.publish(f"alert:fired:{ev['id']}", dict(ev))
        self._publish_summary()
        return n

    async def test_telegram(self) -> dict:
        r = await self.notifier.send(f"{TEST_TEXT}\n{day_paris(self.clock())} "
                                     f"{hm_paris(self.clock(), True)} (Paris)")
        self._publish_summary()
        return {"ok": r.ok, "error": r.error, "sent_ms": r.sent_ms}

    async def state(self, limit: int = 100) -> dict:
        rows = await self.db.query(
            "select * from alert_events order by fired_ms desc limit ?", (max(1, min(limit, 500)),))
        return {"rules": [dict(r) for r in self.rules.values()],
                "events": [self._event_payload(r) for r in rows],
                "telegram": self.notifier.health() if hasattr(self.notifier, "health") else None}

    # --- déclenchement --------------------------------------------------------------------

    def _armed(self, kind: str) -> list[dict]:
        return [r for r in self.rules.values() if r["kind"] == kind and r["state"] == "armée"]

    def _fire(self, rule: dict, dedupe: str, title: str, body: str, source: str,
              source_ms: int | None, data: dict | None = None,
              new_state: str | None = None) -> dict | None:
        key = (rule["id"], dedupe)
        if key in self._seen:
            return None
        self._seen.add(key)
        now = self.clock()
        wants_tg = "telegram" in rule["channels"]
        ev = {"id": secrets.token_hex(6), "rule_id": rule["id"], "kind": rule["kind"],
              "rule_label": rule["label"], "category": rule["category"], "dedupe": dedupe,
              "fired_ms": now, "title": title, "body": body, "source": source,
              "source_ms": source_ms, "data": data or {},
              "telegram": (("en attente" if self.notifier.configured else "non configuré")
                           if wants_tg else None),
              "telegram_ms": None, "telegram_error": None, "acked_ms": None,
              "voice": "voix" in rule["channels"]}
        rule["last_fired_ms"] = now
        if new_state:
            rule["state"] = new_state
        self.events[ev["id"]] = ev
        while len(self.events) > KEEP_EVENTS:
            self.events.pop(next(iter(self.events)))
        self.bus.publish(f"alert:fired:{ev['id']}", dict(ev))
        self._publish_rule(rule)
        self._publish_summary()
        self._queue.put_nowait(("event", ev))
        log.info("alerte « %s » : %s", rule["label"], title)
        return ev

    def _rule_changed(self, rule: dict) -> None:
        rule["updated_ms"] = self.clock()
        self._publish_rule(rule)
        self._publish_summary()
        self._queue.put_nowait(("rule", rule))

    # Écouteurs synchrones

    def _on_trade(self, key: str, ev: dict | None) -> None:
        if not ev or "px" not in ev:
            return
        inst, px = ev["inst"], float(ev["px"])
        prev = self._prev_px.get(inst)
        self._prev_px[inst] = px
        for rule in self._armed("price"):
            p = rule["params"]
            if p["inst"] == inst and ar.price_crossed(p, prev, px):
                title, body = ar.price_message(p, prev, px)
                self._fire(rule, f"{ev.get('trade_id', '')}|{self.clock()}", title, body,
                           f"OKX · trade {hm_paris(ev.get('ts_source') or self.clock(), True)}",
                           ev.get("ts_source"), {"px": px, "prev": prev},
                           new_state="déclenchée")

    def _on_funding(self, key: str, ev: dict | None) -> None:
        if not ev or ev.get("rate") is None:
            return
        for rule in [r for r in self.rules.values() if r["kind"] == "funding"]:
            p = rule["params"]
            if p["inst"] != ev["inst"]:
                continue
            hit = ar.funding_hit(p, ev["rate"])
            if rule["state"] == "armée" and hit:
                title, body = ar.funding_message(p, ev["rate"])
                self._fire(rule, f"{ev.get('funding_time')}|{self.clock()}", title, body,
                           "OKX · funding", ev.get("ts_source"), {"rate": ev["rate"]},
                           new_state="déclenchée")
            elif rule["state"] == "déclenchée" and not hit:
                rule["state"] = "armée"  # le funding est revenu sous le seuil : réarmée
                self._rule_changed(rule)

    def _fresh(self, msg: dict) -> bool:
        t = msg.get("bus_ms")
        now = self.clock()
        return isinstance(t, int) and t >= self.started_ms - 5_000 and now - t <= FRESH_MS

    def _on_release(self, key: str, msg: dict | None) -> None:
        if not msg or not self._fresh(msg):
            return
        if key == "release:last":
            figs = [f for f in (self.bus.get(k) for k in msg.get("keys") or []) if f]
            for rule in self._armed("release"):
                if ar.release_matches(rule["params"], msg):
                    title, body = ar.release_message(msg, figs)
                    self._fire(rule, f"{msg.get('release')}|{msg.get('ny_date')}|"
                               f"{msg.get('period')}|{msg.get('edition') or ''}", title, body,
                               "BLS", msg.get("scheduled_ms"),
                               {"keys": msg.get("keys"), "nature": msg.get("nature")})
        elif "indicator" in msg:
            for rule in self._armed("surprise"):
                if ar.surprise_hit(rule["params"], msg):
                    title, body = ar.surprise_message(msg)
                    self._fire(rule, key, title, body, "BLS", msg.get("scheduled_ms"),
                               {"key": key, "z": msg.get("z"), "surprise": msg.get("surprise")})

    def _on_news(self, key: str, item: dict | None) -> None:
        if not item:
            return
        recv = item.get("ts_recv") or item.get("received_ms")
        if not isinstance(recv, int) or self.clock() - recv > FRESH_MS:
            return
        text = f"{item.get('title') or ''} {item.get('body') or ''}"
        for rule in self._armed("keyword"):
            word = ar.keyword_hit(rule["params"], text)
            if word:
                title, body = ar.keyword_message(word, item)
                self._fire(rule, key, title, body, item.get("source") or "fil d\u2019actus",
                           item.get("ts_source"), {"key": key, "url": item.get("url")})

    # Minuteur : T-n min avant les événements de l'agenda

    async def _timer_loop(self) -> None:
        while True:
            try:
                self.check_calendar()
            except Exception:
                log.exception("alertes : agenda illisible")
            await self.sleep(TIMER_S)

    def check_calendar(self) -> int:
        rules = self._armed("event_soon")
        if not rules:
            return 0
        now, n = self.clock(), 0
        events = [e for k in self.bus.keys("calendar:week:")
                  for e in (self.bus.get(k) or {}).get("events") or []]
        for rule in rules:
            p = rule["params"]
            for e in events:
                t = e.get("time_ms")
                if not isinstance(t, int) or not now < t <= now + p["minutes"] * 60_000:
                    continue
                if ar.event_matches(p, e):
                    title, body = ar.event_message(p, e, hm_paris(t))
                    if self._fire(rule, f"{e.get('id')}|{t}", title, body,
                                  e.get("time_source") or "ForexFactory", t,
                                  {"event_id": e.get("id"), "time_ms": t}):
                        n += 1
        return n

    # --- file : base et Telegram --------------------------------------------------------------

    async def _worker(self) -> None:
        while True:
            kind, obj = await self._queue.get()
            try:
                if kind == "rule":
                    await self.db.execute(
                        "update alert_rules set state = ?, updated_ms = ? where id = ?",
                        (obj["state"], obj["updated_ms"], obj["id"]))
                else:
                    await self._persist_and_send(obj)
            except Exception:
                log.exception("alertes : écriture ou envoi en erreur")
            finally:
                self._queue.task_done()

    async def _persist_and_send(self, ev: dict) -> None:
        rule = self.rules.get(ev["rule_id"])
        await self.db.execute(
            "insert into alert_events (id, rule_id, dedupe, fired_ms, title, body, source,"
            " source_ms, data, telegram, acked_ms) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " on conflict do nothing",
            (ev["id"], ev["rule_id"], ev["dedupe"], ev["fired_ms"], ev["title"], ev["body"],
             ev["source"], ev["source_ms"], json.dumps(ev["data"], ensure_ascii=False),
             ev["telegram"], ev["acked_ms"]))
        if rule is not None:
            await self.db.execute(
                "update alert_rules set state = ?, last_fired_ms = ?, updated_ms = ?"
                " where id = ?", (rule["state"], rule["last_fired_ms"], self.clock(), rule["id"]))
        if ev["telegram"] != "en attente":
            return
        text = (f"{ev['title']}\n{ev['body']}\n"
                f"{day_paris(ev['fired_ms'])} {hm_paris(ev['fired_ms'], True)} (Paris)"
                f" · source : {ev['source']}")
        r = await self.notifier.send(text)
        ev.update(telegram="envoyé" if r.ok else "échec", telegram_ms=r.sent_ms,
                  telegram_error=r.error)
        await self.db.execute(
            "update alert_events set telegram = ?, telegram_ms = ?, telegram_error = ?"
            " where id = ?", (ev["telegram"], ev["telegram_ms"], ev["telegram_error"], ev["id"]))
        if ev["id"] in self.events:
            self.bus.publish(f"alert:fired:{ev['id']}", dict(ev))
        self._publish_summary()

    def _event_payload(self, row: dict) -> dict:
        rule = self.rules.get(row["rule_id"]) or {}
        data = row["data"]
        return {"id": row["id"], "rule_id": row["rule_id"], "kind": rule.get("kind"),
                "rule_label": rule.get("label"), "category": rule.get("category"),
                "dedupe": row["dedupe"], "fired_ms": row["fired_ms"], "title": row["title"],
                "body": row["body"], "source": row["source"], "source_ms": row["source_ms"],
                "data": json.loads(data) if isinstance(data, str) else data,
                "telegram": row["telegram"], "telegram_ms": row["telegram_ms"],
                "telegram_error": row["telegram_error"], "acked_ms": row["acked_ms"],
                "voice": "voix" in (rule.get("channels") or [])}
