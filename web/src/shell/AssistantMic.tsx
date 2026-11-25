// Micro de l'assistant (P6, S3) dans la barre du haut : appui pour parler (dictée du navigateur en
// français), puis la question part à l'assistant de l'écran Actus (clé assistant:voice du store).
// Sans dictée dans ce navigateur : le bouton le dit, le champ texte de l'assistant reste.

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { setValue } from '../data/store';
import { dictate, recognitionCtor } from '../assistant/voice';

export const VOICE_KEY = 'assistant:voice';

export function AssistantMic() {
  const [state, setState] = useState<'idle' | 'listening' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const navigate = useNavigate();
  const supported = !!recognitionCtor();

  const click = () => {
    if (state === 'listening') { stop.current?.(); return; }
    setState('listening'); setMsg(null);
    stop.current = dictate(recognitionCtor(), (r) => {
      stop.current = null;
      if ('text' in r) {
        setState('idle');
        setValue(VOICE_KEY, { text: r.text, at: Date.now() });
        navigate('/actus');
      } else { setState('error'); setMsg(r.error); }
    });
  };

  const label = !supported ? 'Dictée indisponible dans ce navigateur (champ texte de l’assistant)'
    : state === 'listening' ? 'J’écoute… appuyer pour arrêter' : msg ? `Micro de l’assistant : ${msg}` : 'Poser une question à voix haute (assistant)';
  return (
    <button type="button" className={`ib ib--boxed${state === 'listening' ? ' ib--live' : ''}`} aria-label={label} title={label}
      aria-pressed={state === 'listening'} onClick={click} disabled={!supported} data-testid="assistant-mic">
      <Icon name={state === 'listening' ? 'mic' : 'micOff'} />
    </button>
  );
}
