// Porte du module Bourse : vérifie la session (cookie HttpOnly, T-031) et
// affiche l'écran de connexion tant qu'elle n'est pas ouverte.

import './bourse.css';
import '../settings/settings.css';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Panel } from '../../components/Panel';
import { Button, Chip, Missing } from '../../components/ui';
import { getSession, login, type Failure } from '../../bourse/api';
import { fmtParis } from '../../bourse/format';

type State =
  | { phase: 'checking' }
  | { phase: 'open'; expiresAt: string | null }
  | { phase: 'closed' }
  | { phase: 'unavailable'; reason: string };

export function BourseGate({ children }: { children: (onLogout: () => void) => ReactNode }) {
  const [state, setState] = useState<State>({ phase: 'checking' });

  const check = useCallback(async () => {
    const r = await getSession();
    if (!r.ok) setState({ phase: 'unavailable', reason: r.detail });
    else if (r.data.configured === false) setState({ phase: 'unavailable', reason: `module Bourse non configuré : ${r.data.reason ?? 'variables absentes'}` });
    else setState(r.data.authenticated ? { phase: 'open', expiresAt: r.data.expires_at ?? null } : { phase: 'closed' });
  }, []);

  useEffect(() => { void check(); }, [check]);

  if (state.phase === 'checking') return <div className="bourse"><span className="lbl">Vérification de la session…</span></div>;
  if (state.phase === 'unavailable') {
    return (
      <div className="bourse">
        <Panel title="Module Bourse" controls="none"><div style={{ padding: 14 }}><Missing reason={state.reason} /></div></Panel>
      </div>
    );
  }
  if (state.phase === 'closed') return <LoginPanel onOpen={() => void check()} />;
  return <>{children(() => setState({ phase: 'closed' }))}</>;
}

function LoginPanel({ onOpen }: { onOpen: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const r = await login(password);
    setBusy(false);
    setPassword('');
    if (r.ok) { onOpen(); return; }
    setError(messageOf(r));
  };

  return (
    <div className="bourse-login">
      <Panel title="Module Bourse" controls="none" chips={<Chip small>Accès protégé</Chip>} style={{ width: 'min(100%, 420px)' }}>
        <form onSubmit={submit} aria-label="Connexion au module Bourse">
          <p>Portefeuille et données personnelles : le module demande le mot de passe d’application. La session dure 30 jours sur ce navigateur.</p>
          <label className="field">
            <span className="lbl">Mot de passe</span>
            <input className="input" type="password" autoComplete="current-password" value={password}
              aria-invalid={error ? true : undefined} aria-describedby={error ? 'bourse-login-error' : undefined}
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p id="bourse-login-error" className="field__error" role="alert">{error}</p>}
          <Button variant="primary" type="submit" disabled={busy || !password}>{busy ? 'Vérification…' : 'Ouvrir'}</Button>
        </form>
      </Panel>
    </div>
  );
}

function messageOf(f: Failure): string {
  if (f.status === 401) return 'Mot de passe refusé.';
  if (f.status === 429) return `Trop d’essais : réessayer après ${fmtParis(f.retryAt)}.`;
  return f.detail;
}
