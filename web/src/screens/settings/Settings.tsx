// Écran Paramètres (/parametres) : choix du mode de fonctionnement.
// Hors du menu latéral (qui reste celui de la maquette) : on l'ouvre par
// l'avatar de la barre du haut ou par la commande SET de la palette.
//
// Le choix se fait sur un brouillon ; « Appliquer » (seul bouton or de
// l'écran) l'enregistre sur cet appareil, ce qui redémarre le flux et
// recharge les graphiques sur la nouvelle source.

import './settings.css';
import { useEffect, useRef, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Button, Chip } from '../../components/ui';
import {
  DEFAULT_LOCAL_URL, MODES, modeDef, normalizeUrl, validateGatewayUrl, type Mode, type Settings,
} from '../../config/modes';
import { sameSettings, setSettings, useSettings } from '../../config/settings';
import { SubHeader } from '../../shell/SubHeader';
import { SourceChip } from '../overview/Overview';
import { probe, type ProbeResult } from './health';

type ProbeState = { running: true } | { running: false; result: ProbeResult };

const URL_FIELD: Record<'local' | 'tour', { label: string; placeholder: string }> = {
  local: { label: 'Adresse de la passerelle du Mac', placeholder: DEFAULT_LOCAL_URL },
  tour: { label: 'Adresse de la passerelle de la tour', placeholder: 'https://tour.tailnet.ts.net' },
};

/** Erreur d'adresse du brouillon : l'adresse de la tour peut rester vide tant qu'on ne choisit pas ce mode. */
export function draftErrors(d: Settings): Record<'local' | 'tour', string | null> {
  const tourEmpty = d.tourUrl.trim() === '';
  return {
    local: validateGatewayUrl(d.localUrl),
    tour: tourEmpty
      ? (d.mode === 'tour' ? 'adresse vide : indiquer l’adresse https de la tour (tailscale serve)' : null)
      : validateGatewayUrl(d.tourUrl),
  };
}

function normalized(d: Settings): Settings {
  return { mode: d.mode, localUrl: normalizeUrl(d.localUrl), tourUrl: normalizeUrl(d.tourUrl) };
}

function ProbeLine({ state }: { state: ProbeState | undefined }) {
  // Zone annoncée aux lecteurs d'écran : le résultat du test y apparaît.
  return (
    <div className="probe" role="status" aria-live="polite">
      {state?.running && <span className="probe__line"><span className="dot dot--gold" />Test en cours…</span>}
      {state && !state.running && <>
        <span className={`num probe__line ${state.result.ok ? 'probe__line--ok' : 'probe__line--ko'}`}>
          <span className={`dot ${state.result.ok ? 'dot--up' : 'dot--down'}`} />{state.result.text}
        </span>
        {state.result.detail && <span className="probe__detail">{state.result.detail}</span>}
      </>}
    </div>
  );
}

const COMPARISON: { label: string; cells: Record<Mode, string> }[] = [
  { label: 'Flux temps réel', cells: {
    online: 'Le navigateur lit en direct les WebSockets publiques d’OKX EEA.',
    local: 'WebSocket de la passerelle du Mac, elle-même abonnée à OKX EEA.',
    tour: 'WebSocket de la passerelle de la tour, par Tailscale (wss).',
  } },
  { label: 'Graphiques', cells: {
    online: 'Fonctions Vercel (même origine) qui relaient le REST d’OKX EEA.',
    local: 'REST de la passerelle du Mac (/api/chart).',
    tour: 'REST de la passerelle de la tour (/api/chart).',
  } },
  { label: 'Collecte en continu', cells: {
    online: 'Collecteur Supabase planifié chaque minute, journal en base.',
    local: 'Tant que le Mac est allumé et la passerelle lancée.',
    tour: '24 h/24 sur la tour, journal de la passerelle.',
  } },
  { label: 'Prérequis', cells: {
    online: 'Rien sur l’appareil ; projet Vercel et Supabase configurés.',
    local: 'Passerelle lancée sur ce Mac (python scripts/dev.py ou deploy/macos).',
    tour: 'Tour allumée, passerelle lancée, appareil sur le tailnet, tailscale serve en https.',
  } },
];

export function SettingsScreen() {
  const current = useSettings();
  const [draft, setDraft] = useState<Settings>(current);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [probes, setProbes] = useState<Partial<Record<Mode, ProbeState>>>({});
  const probeCtl = useRef<Partial<Record<Mode, AbortController>>>({});

  // Réglages changés ailleurs (autre onglet) : le brouillon repart de l'état appliqué.
  useEffect(() => { setDraft(current); }, [current]);
  useEffect(() => () => Object.values(probeCtl.current).forEach((c) => c?.abort()), []);

  const errors = draftErrors(draft);
  const next = normalized(draft);
  const dirty = !sameSettings(next, current);
  const invalid = !!errors.local || !!errors.tour;
  const activeLabel = modeDef(current.mode).label;

  const edit = (patch: Partial<Settings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setNotice(null);
  };

  const apply = () => {
    if (!dirty || invalid) return;
    const saved = setSettings(next);
    const label = modeDef(next.mode).label;
    setNotice(saved
      ? { ok: true, text: `${label} appliqué et enregistré sur cet appareil : flux redémarré, graphiques rechargés.` }
      : { ok: false, text: `${label} appliqué pour cette session seulement : le stockage de ce navigateur est indisponible (navigation privée ou données bloquées).` });
  };

  const runProbe = (mode: Mode) => {
    probeCtl.current[mode]?.abort();
    const ctl = new AbortController();
    probeCtl.current[mode] = ctl;
    const url = mode === 'local' ? next.localUrl : mode === 'tour' ? next.tourUrl : '';
    setProbes((p) => ({ ...p, [mode]: { running: true } }));
    probe(mode, url, ctl.signal)
      .catch((e: unknown): ProbeResult => ({ ok: false, text: `Injoignable : ${String((e as Error)?.message ?? e)}` }))
      .then((result) => {
        if (!ctl.signal.aborted) setProbes((p) => ({ ...p, [mode]: { running: false, result } }));
      });
  };

  const hint = notice?.text
    ?? (invalid ? 'Corriger l’adresse avant d’appliquer.'
      : dirty ? `Appliquer passe en ${modeDef(next.mode).label} : le flux redémarre sur la nouvelle source.`
        : `Aucun changement : ${activeLabel} actif.`);

  return (
    <>
      <SubHeader icon="sliders" title="Paramètres · Mode de fonctionnement" chips={<>
        <Chip variant="hot" round title="Mode actif sur cet appareil">{activeLabel}</Chip>
        <SourceChip />
      </>} />
      <div className="content">
        {/* Une seule colonne : les panneaux s'empilent sans s'étirer sur la hauteur de l'écran. */}
        <div className="col" style={{ flex: '1 1 100%' }}>
          <Panel title="Mode de fonctionnement" controls="none"
            chips={<Chip variant="hot" dot="gold" title="Mode actif sur cet appareil">{`Actif · ${activeLabel}`}</Chip>}>
            <div className="settings">
              <fieldset className="modes">
                <legend className="sr">Mode de fonctionnement</legend>
                {MODES.map((m) => {
                  const selected = draft.mode === m.id;
                  const active = current.mode === m.id;
                  const field = m.id === 'online' ? null : URL_FIELD[m.id];
                  const err = m.id === 'online' ? null : errors[m.id];
                  const value = m.id === 'local' ? draft.localUrl : m.id === 'tour' ? draft.tourUrl : '';
                  const probeState = probes[m.id];
                  return (
                    <div key={m.id} className={`mode-card${selected ? ' mode-card--selected' : ''}`}
                      data-mode={m.id}
                      // Confort à la souris : un clic dans la carte la choisit (le clavier passe par le bouton radio).
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest('input, button, a, label')) edit({ mode: m.id });
                      }}>
                      <div className="mode-card__head">
                        <label className="mode-card__choice">
                          <input type="radio" name="mode" value={m.id} checked={selected}
                            aria-describedby={`mode-${m.id}-desc`}
                            onChange={() => edit({ mode: m.id })} />
                          <span className="mode-card__title">{m.label}</span>
                        </label>
                        <span className="spacer" />
                        {active && <Chip variant="live" dot="up" small>Actif</Chip>}
                        {selected && !active && <Chip variant="pending" small>À appliquer</Chip>}
                      </div>
                      <div className="lbl lbl--s">Moteur · {m.where}</div>
                      <p className="mode-card__desc" id={`mode-${m.id}-desc`}>{m.description}</p>
                      {field && (
                        <div className="field">
                          <label className="lbl lbl--s" htmlFor={`gateway-${m.id}`}>{field.label}</label>
                          <input id={`gateway-${m.id}`} className="input num" type="url" inputMode="url"
                            spellCheck={false} autoComplete="off" autoCapitalize="off"
                            placeholder={field.placeholder} value={value}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? `gateway-${m.id}-error` : undefined}
                            onChange={(e) => edit(m.id === 'local' ? { localUrl: e.target.value } : { tourUrl: e.target.value })} />
                          {err && <p className="field__error" id={`gateway-${m.id}-error`}>Adresse refusée : {err}</p>}
                        </div>
                      )}
                      <div className="mode-card__test">
                        <Button aria-label={`Tester le ${m.label}`}
                          disabled={probeState?.running || (m.id !== 'online' && (!value.trim() || !!err))}
                          onClick={() => runProbe(m.id)}>
                          Tester
                        </Button>
                        <ProbeLine state={probeState} />
                      </div>
                    </div>
                  );
                })}
              </fieldset>
              <div className="settings__actions">
                <Button variant="primary" disabled={!dirty || invalid} onClick={apply}>Appliquer</Button>
                {dirty && <Button onClick={() => edit(current)}>Annuler les modifications</Button>}
                <p className={`settings__hint${notice && !notice.ok ? ' settings__hint--warn' : ''}`}
                  role="status" aria-live="polite">{hint}</p>
              </div>
              <p className="settings__note">
                Le choix est enregistré sur cet appareil (stockage local du navigateur) : le Mac peut rester
                en Mode Local pendant que le téléphone est en Mode Online. Aucune clé n’est enregistrée ici :
                le front ne parle jamais à Supabase, seules les fonctions Vercel le font.
              </p>
            </div>
          </Panel>
          <Panel title="Ce que fait chaque mode" controls="none">
            <div className="modes-table">
              <table>
                <caption className="sr">Comparaison des trois modes de fonctionnement</caption>
                <thead>
                  <tr>
                    <td />
                    {MODES.map((m) => (
                      <th key={m.id} scope="col" className={`lbl lbl--s${m.id === current.mode ? ' gold' : ''}`}>
                        {m.label}{m.id === current.mode && <span className="sr"> (actif)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="lbl lbl--s">{row.label}</th>
                      {MODES.map((m) => <td key={m.id}>{row.cells[m.id]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
