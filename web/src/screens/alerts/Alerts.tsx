// Écran Alertes (`ALRT`, E4, plan P1 § 11) : règles du moteur d'alertes de la passerelle,
// création, réarmement, canaux, essai Telegram et historique des déclenchements.
// Pas de maquette : composants du design system, captures à 1 440 et 390 px.

import '../settings/settings.css';
import './alerts.css';
import { useMemo, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Button, Chip, Missing } from '../../components/ui';
import {
  ackAlerts, createRule, deleteRule, draftToBody, EMPTY_DRAFT, FORM_KINDS, KIND_LABEL, ruleChip, setRuleChannels, setRuleState,
  sortEvents, sortRules, telegramText, testTelegram, unacked,
  type AlertEvent, type AlertKind, type AlertRule, type AlertSummary, type Channel, type RuleDraft,
} from '../../alerts/alerts';
import type { ReleaseFigure } from '../../calendar/releases';
import { useSettings } from '../../config/settings';
import { ALERTS_STATUS_KEY, type AlertsOnlineStatus } from '../../data/online/alerts';
import { useKeys, useValue } from '../../data/store';
import type { Ticker } from '../../data/protocol';
import { fmtNumber } from '../../lib/format';
import { fmtHm } from '../../lib/time';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

const RELEASES: { key: string; label: string }[] = [
  { key: '', label: 'Toutes les publications suivies' }, { key: 'cpi', label: 'IPC' },
  { key: 'empsit', label: 'Rapport sur l’emploi' }, { key: 'ppi', label: 'Prix à la production' },
  { key: 'prod2', label: 'Productivité et coûts' },
];

export function AlertsScreen() {
  const { mode } = useSettings();
  const now = useNow();
  const summary = useValue<AlertSummary>('alert:summary');
  const rules = sortRules(useKeys<AlertRule>('alert:rule:').map(([, r]) => r));
  const events = sortEvents(useKeys<AlertEvent>('alert:fired:').map(([, e]) => e));
  const open = unacked(events, now);
  const online = useValue<AlertsOnlineStatus>(ALERTS_STATUS_KEY);
  const unavailable = mode === 'online'
    ? (online && !online.ok ? `Alertes en ligne : ${online.reason}.` : summary === undefined ? 'Alertes en ligne : chargement…' : null)
    : summary === undefined ? 'Service alert non reçu : ajouter « alert » à GATEWAY_SERVICES dans le .env de la passerelle, puis la relancer.' : null;
  const tg = summary?.telegram;

  return (
    <>
      <SubHeader icon="bell" title="Alertes"
        chips={<>
          <Chip variant={summary?.armed ? 'hot' : 'neutral'}>{summary ? `${summary.armed} armée${summary.armed > 1 ? 's' : ''}` : 'Moteur · —'}</Chip>
          <Chip variant={tg?.configured ? (tg.last_ok === false ? 'down' : 'live') : 'neutral'}
            title={tg?.last_error ?? undefined}>
            {!tg ? 'Telegram · —' : !tg.configured ? 'Telegram · non configuré'
              : tg.last_ok === false ? 'Telegram · dernier envoi en échec'
                : tg.last_ms ? `Telegram · envoyé ${fmtHm(tg.last_ms, 'Europe/Paris')}` : 'Telegram · prêt'}
          </Chip>
        </>} />
      <div className="content alerts" data-screen="alerts">
        {unavailable ? (
          <Panel title="Alertes" controls="none">
            <div className="placeholder"><span className="placeholder__dash" aria-hidden="true">—</span><span>{unavailable}</span></div>
          </Panel>
        ) : (
          <div className="alerts-grid">
            <div className="alerts-main">
              <RulesPanel rules={rules} now={now} />
              <EventsPanel events={events} open={open.length} />
            </div>
            <div className="alerts-side">
              <NewRulePanel />
              <TelegramPanel summary={summary!} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function useAction(): [string | null, (p: Promise<unknown>, ok?: string) => void, string | null] {
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = (p: Promise<unknown>, ok?: string) => {
    setErr(null);
    setDone(null);
    p.then(() => setDone(ok ?? null), (e: Error) => setErr(e.message));
  };
  return [err, run, done];
}

function RulesPanel({ rules, now }: { rules: AlertRule[]; now: number }) {
  const [err, run] = useAction();
  return (
    <Panel title="Règles" testId="alert-rules" controls="none" chips={<Chip>{`${rules.length} règle${rules.length > 1 ? 's' : ''}`}</Chip>}>
      {err && <p className="alerts-error" role="alert">Refusé par la passerelle : {err}</p>}
      {rules.length === 0 ? (
        <div className="placeholder"><span className="placeholder__dash">—</span><span>Aucune règle. En créer une avec le formulaire.</span></div>
      ) : (
        <ul className="rule-list">
          {rules.map((r) => {
            const chip = ruleChip(r, now);
            const toggle = (c: Channel) => run(setRuleChannels(r.id, r.channels.includes(c) ? r.channels.filter((x) => x !== c) : [...r.channels, c]));
            return (
              <li key={r.id} className="rule-list__row" data-testid="alert-rule">
                <span className="rule-list__text">
                  <span className="rule-list__title">{r.label}</span>
                  <span className="lbl lbl--s">{r.category}</span>
                </span>
                <span className="rule-list__channels" role="group" aria-label={`Canaux de « ${r.label} »`}>
                  {(['telegram', 'voix'] as const).map((c) => (
                    <button key={c} type="button" className="cal-toggle rule-list__chan" aria-pressed={r.channels.includes(c)}
                      onClick={() => toggle(c)}>{c === 'telegram' ? 'Telegram' : 'Voix'}</button>
                  ))}
                </span>
                <span className={`chip chip--s${chip.variant === 'fired' ? ' chip--hot' : chip.variant === 'off' ? ' chip--pending' : ''}`}>{chip.text}</span>
                <span className="rule-list__actions">
                  {r.state === 'armée'
                    ? <Button variant="ghost" onClick={() => run(setRuleState(r.id, 'désactivée'))}>Désactiver</Button>
                    : <Button variant="ghost" onClick={() => run(setRuleState(r.id, 'armée'))}>{r.state === 'déclenchée' ? 'Réarmer' : 'Armer'}</Button>}
                  <Button variant="ghost" aria-label={`Supprimer « ${r.label} »`}
                    onClick={() => { if (window.confirm(`Supprimer la règle « ${r.label} » et son historique ?`)) run(deleteRule(r.id)); }}>Supprimer</Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function EventsPanel({ events, open }: { events: AlertEvent[]; open: number }) {
  const [err, run] = useAction();
  return (
    <Panel title="Déclenchements" testId="alert-events" controls="none"
      chips={open > 0 ? <button type="button" className="chip chip--hot" onClick={() => run(ackAlerts())}>Tout acquitter ({open})</button> : <Chip>Rien à acquitter</Chip>}>
      {err && <p className="alerts-error" role="alert">Refusé par la passerelle : {err}</p>}
      {events.length === 0 ? (
        <div className="placeholder"><span className="placeholder__dash">—</span><span>Aucune alerte déclenchée ces trois derniers jours.</span></div>
      ) : (
        <ul className="event-list">
          {events.map((e) => (
            <li key={e.id} className={e.acked_ms ? 'is-acked' : undefined} data-testid="alert-event">
              <span className="num event-list__time">{fmtHm(e.fired_ms, 'Europe/Paris')}</span>
              <span className="event-list__text">
                <span className="event-list__title">{e.title}</span>
                {e.body && <span className="event-list__body">{e.body}</span>}
                <span className="lbl lbl--s">
                  {[e.rule_label, e.source ? `source ${e.source}` : null,
                    e.source_ms ? `donnée de ${fmtHm(e.source_ms, 'Europe/Paris')}` : null, telegramText(e),
                    e.acked_ms ? `acquittée ${fmtHm(e.acked_ms, 'Europe/Paris')}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {!e.acked_ms && <Button variant="ghost" onClick={() => run(ackAlerts([e.id]))}>Acquitter</Button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function NewRulePanel() {
  const [d, setD] = useState<RuleDraft>(EMPTY_DRAFT);
  const [err, run, done] = useAction();
  const insts = useKeys<unknown>('instrument:').map(([k]) => k.slice('instrument:'.length));
  const instruments = insts.length ? insts : ['BTC-USDT-SWAP'];
  const ticker = useValue<Ticker>(`ticker:${d.inst}`);
  const figs = useKeys<ReleaseFigure>('release:').map(([, f]) => f).filter((f) => f && 'indicator' in f);
  const indicators = useMemo(() => [...new Map(figs.map((f) => [f.indicator, f.label_fr ?? f.indicator])).entries()], [figs]);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const b = draftToBody(d);
    if ('error' in b) { run(Promise.reject(new Error(b.error))); return; }
    run(createRule(b.body).then(() => setD((x) => ({ ...EMPTY_DRAFT, kind: x.kind, inst: x.inst }))), 'Règle créée et armée.');
  };
  return (
    <Panel title="Nouvelle règle" testId="alert-new" controls="none">
      <form className="rule-form" onSubmit={submit}>
        <label className="field"><span className="lbl lbl--s">Sorte</span>
          <select className="input" value={d.kind} onChange={(e) => set('kind', e.target.value as AlertKind)}>
            {FORM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {(d.kind === 'price' || d.kind === 'funding') && (
          <label className="field"><span className="lbl lbl--s">Instrument OKX</span>
            <select className="input" value={d.inst} onChange={(e) => set('inst', e.target.value)}>
              {instruments.map((i) => <option key={i} value={i}>{i.replace('-SWAP', ' perp')}</option>)}
            </select>
          </label>
        )}
        {d.kind === 'price' && (<>
          <label className="field"><span className="lbl lbl--s">Niveau{ticker ? ` · dernier ${fmtNumber(ticker.last, 1)}` : ''}</span>
            <input className="input num" inputMode="decimal" placeholder="110 000" value={d.level} onChange={(e) => set('level', e.target.value)} />
          </label>
          <label className="field"><span className="lbl lbl--s">Sens</span>
            <select className="input" value={d.direction} onChange={(e) => set('direction', e.target.value as RuleDraft['direction'])}>
              <option value="les deux">À la hausse ou à la baisse</option><option value="hausse">À la hausse</option><option value="baisse">À la baisse</option>
            </select>
          </label>
        </>)}
        {d.kind === 'funding' && (<>
          <label className="field"><span className="lbl lbl--s">Seuil (% par période de funding)</span>
            <input className="input num" inputMode="decimal" placeholder="0,02" value={d.threshold} onChange={(e) => set('threshold', e.target.value)} />
          </label>
          <label className="field"><span className="lbl lbl--s">Côté</span>
            <select className="input" value={d.side} onChange={(e) => set('side', e.target.value as RuleDraft['side'])}>
              <option value="au-dessus">Au-dessus</option><option value="en dessous">En dessous</option>
            </select>
          </label>
        </>)}
        {d.kind === 'event_soon' && (<>
          <label className="field"><span className="lbl lbl--s">Minutes avant</span>
            <input className="input num" inputMode="numeric" value={d.minutes} onChange={(e) => set('minutes', e.target.value)} />
          </label>
          <label className="rule-form__check"><input type="checkbox" checked={d.capturedOnly} onChange={(e) => set('capturedOnly', e.target.checked)} />
            Seulement les publications captées à la source</label>
          <div className="cal-toggles" role="group" aria-label="Impact">
            {([['High', 'Fort'], ['Medium', 'Moyen'], ['Low', 'Faible']] as const).map(([k, l]) => (
              <button key={k} type="button" className="cal-toggle" aria-pressed={d.impacts.includes(k)}
                onClick={() => set('impacts', d.impacts.includes(k) ? d.impacts.filter((x) => x !== k) : [...d.impacts, k])}>{l}</button>
            ))}
          </div>
          <label className="field"><span className="lbl lbl--s">Devises (vide : toutes)</span>
            <input className="input" placeholder="USD, EUR" value={d.currencies} onChange={(e) => set('currencies', e.target.value)} />
          </label>
        </>)}
        {d.kind === 'release' && (
          <label className="field"><span className="lbl lbl--s">Publication</span>
            <select className="input" value={d.release} onChange={(e) => set('release', e.target.value)}>
              {RELEASES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
        )}
        {d.kind === 'surprise' && (<>
          <label className="field"><span className="lbl lbl--s">Indicateur</span>
            <select className="input" value={d.indicator} onChange={(e) => set('indicator', e.target.value)}>
              <option value="">Tous les chiffres captés</option>
              {indicators.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="field"><span className="lbl lbl--s">|z| au moins</span>
            <input className="input num" inputMode="decimal" placeholder="1,5" value={d.zMin} onChange={(e) => set('zMin', e.target.value)} />
          </label>
          <label className="field"><span className="lbl lbl--s">ou |surprise brute| au moins</span>
            <input className="input num" inputMode="decimal" placeholder="0,2" value={d.rawMin} onChange={(e) => set('rawMin', e.target.value)} />
          </label>
        </>)}
        {d.kind === 'keyword' && (
          <label className="field"><span className="lbl lbl--s">Mots-clés, séparés par des virgules (titres du fil d’actus, E6)</span>
            <input className="input" placeholder="Powell, ETF, hack" value={d.words} onChange={(e) => set('words', e.target.value)} />
          </label>
        )}
        <div className="rule-form__channels" role="group" aria-label="Canaux">
          <span className="lbl lbl--s">Canaux : écran, et</span>
          <label className="rule-form__check"><input type="checkbox" checked={d.telegram} onChange={(e) => set('telegram', e.target.checked)} />Telegram</label>
          <label className="rule-form__check"><input type="checkbox" checked={d.voice} onChange={(e) => set('voice', e.target.checked)} />Voix</label>
        </div>
        {err && <p className="field__error" role="alert">{err}</p>}
        {done && <p className="rule-form__ok" role="status">{done}</p>}
        <Button variant="primary" type="submit">Créer la règle</Button>
      </form>
    </Panel>
  );
}

function TelegramPanel({ summary }: { summary: AlertSummary }) {
  const tg = summary.telegram;
  const [err, run, done] = useAction();
  return (
    <Panel title="Telegram" testId="alert-telegram" controls="none">
      <div className="tg">
        <p className="tg__line">
          {!tg ? <Missing reason="état de Telegram non reçu" /> : !tg.configured
            ? 'Non configuré : TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans le .env de la passerelle (jamais dans le navigateur).'
            : tg.last_ms ? `Dernier envoi ${tg.last_ok ? 'réussi' : 'en échec'} à ${fmtHm(tg.last_ms, 'Europe/Paris')}${tg.last_error ? ` : ${tg.last_error}` : ''}.`
              : 'Configuré sur la passerelle ; aucun envoi depuis son démarrage.'}
        </p>
        <p className="lbl lbl--s">Envoyé par la passerelle du Mac (T-020), un message par seconde au plus.</p>
        <Button disabled={!tg?.configured} onClick={() => run(testTelegram().then((r) => { if (!r.ok) throw new Error(r.error ?? 'échec'); }), 'Message d’essai envoyé.')}>
          Envoyer un message d’essai
        </Button>
        {err && <p className="field__error" role="alert">Échec : {err}</p>}
        {done && <p className="rule-form__ok" role="status">{done}</p>}
      </div>
    </Panel>
  );
}
