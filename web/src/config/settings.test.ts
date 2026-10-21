import { describe, expect, it, vi } from 'vitest';
import {
  defaultSettings, DEFAULT_LOCAL_URL, loadSettings, ONLINE_INSTRUMENTS, OKX_EEA_WS, restBase,
  saveSettings, sourceFor, STORAGE_KEY, validateGatewayUrl, type Settings,
} from './modes';
import {
  activeUrl, createSettingsStore, getSettings, sanitizeSettings, setSettings, subscribeSettings,
} from './settings';
import { CONN_KEY, feedKey, getValue, setValue, startFeed, type FeedConn } from '../data/store';
import { NOT_CONFIGURED } from '../data/gateway';

/** Stockage en mémoire, avec possibilité de refuser l'écriture ou la lecture. */
function memoryStorage(opts: { failWrite?: boolean; failRead?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    getItem(k: string) {
      if (opts.failRead) throw new Error('SecurityError');
      return data.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (opts.failWrite) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
  };
}

const LOCAL: Settings = { mode: 'local', localUrl: DEFAULT_LOCAL_URL, tourUrl: '' };
const TOUR_URL = 'https://tour.tailnet.ts.net';

describe('réglages par défaut', () => {
  it('Mode Local sur la machine elle-même, Mode Online ailleurs', () => {
    expect(defaultSettings({}, 'localhost').mode).toBe('local');
    expect(defaultSettings({}, '127.0.0.1').mode).toBe('local');
    expect(defaultSettings({}, 'terminal.vercel.app').mode).toBe('online');
    expect(defaultSettings({}, 'mac.tailnet.ts.net').mode).toBe('online');
  });

  it('les variables de build priment, adresses normalisées', () => {
    const s = defaultSettings({
      VITE_DEFAULT_MODE: 'tour', VITE_LOCAL_GATEWAY_URL: 'http://127.0.0.1:8790/',
      VITE_TOUR_GATEWAY_URL: `${TOUR_URL}//`,
    }, 'terminal.vercel.app');
    expect(s).toEqual({ mode: 'tour', localUrl: 'http://127.0.0.1:8790', tourUrl: TOUR_URL });
  });

  it('un mode de build inconnu est ignoré ; tour vide tant que non configurée', () => {
    const s = defaultSettings({ VITE_DEFAULT_MODE: 'cloud' }, 'localhost');
    expect(s).toEqual({ mode: 'local', localUrl: DEFAULT_LOCAL_URL, tourUrl: '' });
  });
});

describe('persistance sur l’appareil', () => {
  it('appliquer enregistre et prévient les abonnés ; un rechargement retrouve le mode', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage, LOCAL);
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.get().mode));
    expect(store.set({ ...LOCAL, mode: 'tour', tourUrl: `${TOUR_URL}/` })).toBe(true);
    expect(seen).toEqual(['tour']);
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!)).toEqual({ ...LOCAL, mode: 'tour', tourUrl: TOUR_URL });
    // « Rechargement » : un nouveau store relit le même stockage.
    expect(createSettingsStore(storage, LOCAL).get()).toEqual({ ...LOCAL, mode: 'tour', tourUrl: TOUR_URL });
  });

  it('les mêmes réglages ne déclenchent aucune notification', () => {
    const store = createSettingsStore(memoryStorage(), LOCAL);
    const l = vi.fn();
    store.subscribe(l);
    store.set({ ...LOCAL, localUrl: `${DEFAULT_LOCAL_URL}/` });
    expect(l).not.toHaveBeenCalled();
  });

  it('un abonné en erreur n’empêche pas les autres de suivre', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createSettingsStore(memoryStorage(), LOCAL);
    const l = vi.fn();
    store.subscribe(() => { throw new Error('boom'); });
    store.subscribe(l);
    store.set({ ...LOCAL, mode: 'online' });
    expect(l).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('se désabonner coupe les notifications', () => {
    const store = createSettingsStore(memoryStorage(), LOCAL);
    const l = vi.fn();
    const off = store.subscribe(l);
    off();
    store.set({ ...LOCAL, mode: 'online' });
    expect(l).not.toHaveBeenCalled();
  });

  it('reload suit un changement fait dans un autre onglet', () => {
    const storage = memoryStorage();
    const a = createSettingsStore(storage, LOCAL);
    const b = createSettingsStore(storage, LOCAL);
    const l = vi.fn();
    b.subscribe(l);
    a.set({ ...LOCAL, mode: 'online' });
    b.reload();
    expect(b.get().mode).toBe('online');
    expect(l).toHaveBeenCalledOnce();
  });
});

describe('stockage indisponible', () => {
  it('écriture refusée : le réglage vaut pour la session, sans exception', () => {
    const store = createSettingsStore(memoryStorage({ failWrite: true }), LOCAL);
    expect(store.set({ ...LOCAL, mode: 'online' })).toBe(false);
    expect(store.get().mode).toBe('online');
  });

  it('lecture refusée ou absence de stockage : réglages par défaut', () => {
    expect(createSettingsStore(memoryStorage({ failRead: true }), LOCAL).get()).toEqual(LOCAL);
    const none = createSettingsStore(null, LOCAL);
    expect(none.get()).toEqual(LOCAL);
    expect(none.set({ ...LOCAL, mode: 'online' })).toBe(false);
    expect(none.get().mode).toBe('online');
  });

  it('contenu corrompu ou adresses refusées : défauts à leur place', () => {
    const storage = memoryStorage();
    storage.data.set(STORAGE_KEY, '{pas du json');
    expect(loadSettings(storage, LOCAL)).toEqual(LOCAL);
    storage.data.set(STORAGE_KEY, JSON.stringify({ mode: 'cloud', localUrl: 'http://10.0.0.5:8710', tourUrl: 'ftp://x' }));
    expect(loadSettings(storage, LOCAL)).toEqual(LOCAL);
    expect(saveSettings(memoryStorage({ failWrite: true }), LOCAL)).toBe(false);
  });

  it('adresse de la tour vide enregistrée : celle du build reprend la main', () => {
    const storage = memoryStorage();
    const built: Settings = { ...LOCAL, tourUrl: TOUR_URL };
    storage.data.set(STORAGE_KEY, JSON.stringify({ mode: 'tour', localUrl: DEFAULT_LOCAL_URL, tourUrl: '' }));
    expect(loadSettings(storage, built)).toEqual({ ...built, mode: 'tour' });
    storage.data.set(STORAGE_KEY, JSON.stringify({ mode: 'tour', localUrl: DEFAULT_LOCAL_URL, tourUrl: '  ' }));
    expect(loadSettings(storage, built).tourUrl).toBe(TOUR_URL);
    // Sans adresse de build, la tour reste non configurée.
    expect(loadSettings(storage, LOCAL).tourUrl).toBe('');
  });
});

describe('validation des adresses', () => {
  it('https partout, http seulement vers cette machine', () => {
    expect(validateGatewayUrl(TOUR_URL)).toBeNull();
    expect(validateGatewayUrl('http://127.0.0.1:8710')).toBeNull();
    expect(validateGatewayUrl('http://localhost:8710')).toBeNull();
    // « ? » ou « # » final : URL les efface mais la WebSocket les refuse.
    expect(validateGatewayUrl('https://tour.tailnet.ts.net#')).toBe('pas de paramètres dans l’adresse');
    expect(validateGatewayUrl('https://tour.tailnet.ts.net?')).toBe('pas de paramètres dans l’adresse');
    expect(validateGatewayUrl('http://tour.tailnet.ts.net')).toMatch(/http n’est accepté que/);
    expect(validateGatewayUrl('ws://127.0.0.1:8710')).toMatch(/protocole/);
  });

  it('refuse vide, illisible, identifiants et paramètres', () => {
    expect(validateGatewayUrl('  ')).toBe('adresse vide');
    expect(validateGatewayUrl('tour')).toBe('adresse invalide');
    expect(validateGatewayUrl('https://user:pw@tour.ts.net')).toMatch(/identifiants/);
    expect(validateGatewayUrl('https://tour.ts.net/?k=1')).toMatch(/paramètres/);
  });

  it('sanitizeSettings garde l’adresse précédente quand la nouvelle est refusée', () => {
    const prev: Settings = { mode: 'local', localUrl: DEFAULT_LOCAL_URL, tourUrl: TOUR_URL };
    expect(sanitizeSettings({ mode: 'tour', localUrl: 'http://10.1.1.1', tourUrl: 'http://x.ts.net' }, prev))
      .toEqual({ mode: 'tour', localUrl: DEFAULT_LOCAL_URL, tourUrl: TOUR_URL });
    // Vider l'adresse de la tour reste permis (tour non configurée).
    expect(sanitizeSettings({ ...prev, tourUrl: '' }, prev).tourUrl).toBe('');
  });
});

describe('source du flux et routes REST selon le mode', () => {
  it('Mode Online : OKX EEA en direct, REST sur la même origine', () => {
    const s: Settings = { ...LOCAL, mode: 'online' };
    expect(sourceFor(s)).toEqual({
      kind: 'okx-direct', mode: 'online', apiBase: '',
      publicWs: OKX_EEA_WS.public, businessWs: OKX_EEA_WS.business, instruments: ONLINE_INSTRUMENTS,
    });
    expect(restBase(s)).toBe('');
    expect(activeUrl(s)).toBe('');
  });

  it('Mode Local : passerelle du Mac, ws dérivé de http', () => {
    expect(sourceFor(LOCAL)).toEqual({
      kind: 'gateway', mode: 'local', baseUrl: DEFAULT_LOCAL_URL, wsUrl: 'ws://127.0.0.1:8710/ws',
    });
    expect(restBase(LOCAL)).toBe(DEFAULT_LOCAL_URL);
  });

  it('Mode Tour : wss vers la tour ; sans adresse, aucune source', () => {
    const tour: Settings = { ...LOCAL, mode: 'tour', tourUrl: TOUR_URL };
    expect(sourceFor(tour)).toEqual({
      kind: 'gateway', mode: 'tour', baseUrl: TOUR_URL, wsUrl: 'wss://tour.tailnet.ts.net/ws',
    });
    expect(restBase(tour)).toBe(TOUR_URL);
    expect(sourceFor({ ...tour, tourUrl: '' })).toBeNull();
    expect(restBase({ ...tour, tourUrl: '' })).toBeNull();
  });

  it('feedKey ne change qu’avec le mode ou l’adresse qu’il utilise', () => {
    const tour: Settings = { ...LOCAL, mode: 'tour', tourUrl: TOUR_URL };
    expect(feedKey(LOCAL)).toBe(feedKey({ ...LOCAL, tourUrl: TOUR_URL }));
    expect(feedKey(tour)).not.toBe(feedKey({ ...tour, tourUrl: 'https://autre.ts.net' }));
    expect(feedKey({ ...LOCAL, mode: 'online' })).toBe(feedKey({ ...LOCAL, mode: 'online', localUrl: 'http://localhost:1' }));
  });
});

describe('bascule de mode (réglages → flux)', () => {
  it('changer de mode vide le store et publie la raison quand la tour n’a pas d’adresse', () => {
    const before = getSettings();
    startFeed(); // sans Worker (jsdom) : seul l'état de connexion est publié
    setValue('ticker:BTC-USDT-SWAP', { last: 1 });
    const notified = vi.fn();
    const off = subscribeSettings(notified);
    setSettings({ ...before, mode: 'tour', tourUrl: '' });
    expect(notified).toHaveBeenCalledOnce();
    expect(getValue('ticker:BTC-USDT-SWAP')).toBeUndefined();
    expect(getValue<FeedConn>(CONN_KEY)).toMatchObject({ status: 'closed', reason: NOT_CONFIGURED });

    setValue('ticker:BTC-USDT-SWAP', { last: 2 });
    setSettings({ ...before, mode: 'local' });
    expect(getValue('ticker:BTC-USDT-SWAP')).toBeUndefined();
    expect(getValue<FeedConn>(CONN_KEY)).toMatchObject({ status: 'connecting' });

    // Changer l'adresse d'un mode inactif ne redémarre rien.
    setValue('ticker:BTC-USDT-SWAP', { last: 3 });
    setSettings({ ...getSettings(), tourUrl: TOUR_URL });
    expect(getValue('ticker:BTC-USDT-SWAP')).toEqual({ last: 3 });
    off();
    setSettings(before);
  });
});
