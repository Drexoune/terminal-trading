// Interrupteurs d'alertes Telegram posés sur les écrans (Mode Online) :
// - cloche d'un événement du calendrier (règle event_watch) ;
// - catégorie du fil d'actus (règle news_category : non, fort impact, tout).
// Écritures par /api/alerts (session du mot de passe d'application, T-031) ; l'état vient des
// clés alert:rule:<id> relues par src/data/online/alerts.ts.

import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useSettings } from '../config/settings';
import type { CalendarEvent } from '../calendar/calendar';
import { useKeys } from '../data/store';
import { createRule, deleteRule, type AlertRule } from './alerts';

export function useRules(): AlertRule[] {
  return useKeys<AlertRule>('alert:rule:').map(([, r]) => r).filter((r) => r && typeof r.id === 'number');
}

/** Message lisible d'un refus d'écriture (session, validation, réseau). */
export function writeError(e: Error): string {
  if (/^HTTP 401/.test(e.message)) return 'session requise : saisir le mot de passe d’application dans Bourse';
  const m = /^HTTP \d+\s*(.*)$/s.exec(e.message);
  if (!m) return e.message;
  try { return String((JSON.parse(m[1]) as { detail?: unknown }).detail ?? m[1]); } catch { return m[1] || e.message; }
}

/** Cloche d'un événement : un message Telegram quand son réel sort (BLS ou fil d'actus). */
export function EventBell({ ev, rules, onError, done }: {
  ev: CalendarEvent; rules: AlertRule[]; onError: (msg: string | null) => void; done: boolean;
}) {
  const { mode } = useSettings();
  const [busy, setBusy] = useState(false);
  if (mode !== 'online') return null;
  const rule = rules.find((r) => r.kind === 'event_watch' && r.params.event_id === ev.id);
  const armed = rule?.state === 'armée';
  const sent = rule?.state === 'déclenchée';
  if (done && !rule) return null;                         // réel déjà connu : rien à attendre
  const label = sent ? `Réel envoyé sur Telegram (${ev.title})` : armed ? `Ne plus prévenir pour ${ev.title}` : `Prévenir sur Telegram quand ${ev.title} sort`;
  return (
    <button type="button" className={`cal-bell${armed ? ' is-armed' : ''}${sent ? ' is-sent' : ''}`} aria-pressed={armed} aria-label={label} title={label}
      disabled={busy} data-testid="cal-bell"
      onClick={(e) => {
        e.stopPropagation();
        setBusy(true);
        onError(null);
        const p = rule
          ? deleteRule(rule.id)
          : createRule({ kind: 'event_watch', params: { event_id: ev.id, title: ev.title_fr ?? ev.title, time_ms: ev.time_ms ?? undefined }, channels: ['telegram'] });
        p.catch((err: Error) => onError(`Cloche : ${writeError(err)}`)).finally(() => setBusy(false));
      }}>
      <Icon name="bell" />
    </button>
  );
}

const LEVELS = [
  { value: 'off', label: 'Non' }, { value: 'urgent', label: 'Fort impact' }, { value: 'all', label: 'Tout' },
] as const;
type Level = (typeof LEVELS)[number]['value'];

/** Alertes Telegram par catégorie du fil d'actus. */
export function NewsCategoryAlerts({ categories }: { categories: { value: string; label: string }[] }) {
  const { mode } = useSettings();
  const rules = useRules().filter((r) => r.kind === 'news_category');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const levelOf = (cat: string): Level => {
    const r = rules.find((x) => x.params.category === cat && x.state === 'armée');
    return !r ? 'off' : r.params.urgent_only ? 'urgent' : 'all';
  };
  const set = async (cat: string, level: Level) => {
    setBusy(true);
    setMsg(null);
    try {
      for (const r of rules.filter((x) => x.params.category === cat)) await deleteRule(r.id);
      if (level !== 'off') await createRule({ kind: 'news_category', params: { category: cat, urgent_only: level === 'urgent' }, channels: ['telegram'] });
    } catch (e) {
      setMsg(writeError(e as Error));
    } finally {
      setBusy(false);
    }
  };
  const active = categories.filter((c) => levelOf(c.value) !== 'off').length;
  return (
    <details className="news-hl-edit" data-testid="news-telegram">
      <summary className="lbl lbl--s">{`Alertes Telegram · ${active ? `${active} catégorie${active > 1 ? 's' : ''}` : 'aucune'}`}</summary>
      {mode !== 'online' ? <p className="lbl lbl--s">Alertes du fil en Mode Online seulement (moteur d’alertes dans Supabase).</p> : (
        <ul className="news-tg" aria-label="Alertes Telegram par catégorie">
          {categories.map((c) => (
            <li key={c.value}>
              <span>{c.label}</span>
              <span role="group" aria-label={`Telegram : ${c.label}`} className="news-tg__seg">
                {LEVELS.map((l) => (
                  <button key={l.value} type="button" className="seg" aria-pressed={levelOf(c.value) === l.value} disabled={busy}
                    onClick={() => { if (levelOf(c.value) !== l.value) void set(c.value, l.value); }}>{l.label}</button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {msg && <span className="lbl lbl--s" role="status">{msg}</span>}
    </details>
  );
}
