import { useEffect, useState } from 'react';
import { gatewayNow } from '../data/store';

/** Heure courante (horloge de la passerelle si connue), rafraîchie à chaque seconde pleine. */
export function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(gatewayNow);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = gatewayNow();
      setNow(t);
      timer = setTimeout(tick, stepMs - (t % stepMs) + 5);
    };
    timer = setTimeout(tick, stepMs - (gatewayNow() % stepMs) + 5);
    return () => clearTimeout(timer);
  }, [stepMs]);
  return now;
}
