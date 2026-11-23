// Écran Squawk (`SQK`, E4, plan P1 § 10) : activation de la voix et du son sur cet appareil,
// choix des voix (gardé localement), annonces à faire, essai, et dernières annonces dites.
// Les chiffres captés se disent en français, par modèles de phrase remplis avec nos données ;
// les titres urgents (E6) dans leur langue d'origine.

import '../settings/settings.css';
import '../alerts/alerts.css';
import { Panel } from '../../components/Panel';
import { Button, Chip } from '../../components/ui';
import { fmtHms } from '../../lib/time';
import { SubHeader } from '../../shell/SubHeader';
import { squawk, useSquawk, voicesFor, type SquawkPrefs } from '../../squawk/engine';
import { normalizeSpeech, type Lang } from '../../squawk/speech';

const SAMPLE: Record<Lang, string> = {
  fr: 'IPC (m/m) : +0,3 %, prévision +0,2 · Fed : baisse de 25 pb.',
  en: 'US CPI rose 0.3% in November, above the 0.2% forecast.',
};

const TOGGLES: { key: keyof SquawkPrefs; label: string }[] = [
  { key: 'figures', label: 'Chiffres captés à la source (BLS)' },
  { key: 'alerts', label: 'Alertes dont la règle demande la voix' },
  { key: 'headlines', label: 'Titres urgents du fil d’actus, en VO' },
  { key: 'sound', label: 'Bip des alertes et des chiffres' },
  { key: 'notifications', label: 'Notification du système quand l’onglet est caché' },
];

export function SquawkScreen() {
  const s = useSquawk();
  const voices = (lang: Lang) => voicesFor(lang, s.voices as SpeechSynthesisVoice[]);
  const state = !s.supported.speech ? 'Synthèse vocale indisponible dans ce navigateur'
    : !s.enabled ? 'Non activée sur cette page' : s.leader ? 'Active : cet onglet parle' : 'Activée, en attente : un autre onglet parle';
  return (
    <>
      <SubHeader icon="squawk" title="Squawk"
        chips={<Chip variant={s.enabled && s.leader ? 'live' : 'neutral'} dot={s.enabled && s.leader ? 'up' : undefined}>{state}</Chip>} />
      <div className="content alerts" data-screen="squawk">
        <div className="alerts-grid">
          <div className="alerts-main">
            <Panel title="Voix et son" testId="squawk-state" controls="none">
              <div className="tg">
                <p className="tg__line">
                  Chrome et iOS n’acceptent la voix et le son qu’après un clic : « Activer voix et son » (barre du haut ou ci-dessous)
                  à chaque chargement de la page. Un seul onglet parle pour tout le navigateur.
                </p>
                <div className="squawk-actions">
                  <Button variant={s.enabled ? 'secondary' : 'primary'} onClick={() => { if (s.enabled) squawk.disable(); else void squawk.enable(); }}>
                    {s.enabled ? 'Couper voix et son' : 'Activer voix et son'}
                  </Button>
                  <Button disabled={!s.enabled || !s.leader} onClick={() => squawk.say({ id: `essai:${Date.now()}`, kind: 'essai', text: normalizeSpeech(SAMPLE.fr, 'fr'), lang: 'fr', created_ms: Date.now() })}>
                    Essayer en français
                  </Button>
                  <Button disabled={!s.enabled || !s.leader} onClick={() => squawk.say({ id: `essai-en:${Date.now()}`, kind: 'essai', text: normalizeSpeech(SAMPLE.en, 'en'), lang: 'en', created_ms: Date.now() })}>
                    Essayer en anglais
                  </Button>
                </div>
                <p className="lbl lbl--s">
                  {`Voix ${s.supported.speech ? 'disponible' : 'absente'} · son ${s.supported.audio ? 'disponible' : 'absent'} · notifications : ${s.notificationPermission === 'granted' ? 'autorisées' : s.notificationPermission === 'denied' ? 'refusées' : s.notificationPermission === 'default' ? 'à autoriser (au clic d’activation)' : 'indisponibles'} · onglet unique ${s.supported.locks ? 'garanti (Web Locks)' : 'non garanti'}`}
                </p>
              </div>
            </Panel>
            <Panel title="Dernières annonces" testId="squawk-history" controls="none"
              chips={<Chip>{s.speaking ? 'En cours' : s.pending ? `${s.pending} en attente` : 'File vide'}</Chip>}>
              {s.history.length === 0 ? (
                <div className="placeholder"><span className="placeholder__dash">—</span><span>Rien d’annoncé depuis le chargement de la page.</span></div>
              ) : (
                <ul className="event-list">
                  {s.history.map((h, i) => (
                    <li key={`${h.id}-${i}`}>
                      <span className="num event-list__time">{fmtHms(h.at_ms, 'Europe/Paris').slice(0, 5)}</span>
                      <span className="event-list__text">
                        <span className="event-list__title">{h.text}</span>
                        <span className="lbl lbl--s">{h.kind} · {h.outcome}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <div className="alerts-side">
            <Panel title="Réglages de cet appareil" testId="squawk-prefs" controls="none">
              <div className="rule-form">
                {(['fr', 'en'] as const).map((lang) => (
                  <label key={lang} className="field">
                    <span className="lbl lbl--s">{lang === 'fr' ? 'Voix française (chiffres, alertes)' : 'Voix anglaise (titres en VO)'}</span>
                    <select className="input" value={(lang === 'fr' ? s.prefs.voiceFr : s.prefs.voiceEn) ?? ''}
                      onChange={(e) => squawk.setPrefs(lang === 'fr' ? { voiceFr: e.target.value || null } : { voiceEn: e.target.value || null })}>
                      <option value="">Par défaut du système</option>
                      {voices(lang).map((v) => <option key={v.name} value={v.name}>{`${v.name} (${v.lang})`}</option>)}
                    </select>
                  </label>
                ))}
                {TOGGLES.map((t) => (
                  <label key={t.key} className="rule-form__check">
                    <input type="checkbox" checked={s.prefs[t.key] as boolean} onChange={(e) => squawk.setPrefs({ [t.key]: e.target.checked })} />
                    {t.label}
                  </label>
                ))}
                <p className="lbl lbl--s">Gardés dans ce navigateur seulement. La qualité des voix sera validée avec la page de test (/outils/voix.html).</p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
