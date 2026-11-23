import { describe, expect, it } from 'vitest';
import type { ReleaseFigure, ReleaseLast } from '../calendar/releases';
import { MAX_AGE_MS, SquawkQueue, WATCHDOG_MS, type Speaker, type Utterance } from './queue';
import { alertPhrase, figurePhrase, normalizeSpeech, releasePhrase } from './speech';

describe('normaliseur du texte parlé', () => {
  it('signes, unités et milliers en français', () => {
    expect(normalizeSpeech('IPC (m/m) : −0,2 %, prévision +0,3 %')).toBe('IPC (m/m) : moins 0,2 pour cent, prévision plus 0,3 pour cent');
    expect(normalizeSpeech('Fed : baisse de 25 pb')).toBe('Fed : baisse de 25 points de base');
    expect(normalizeSpeech('BTC-USDT perp franchit 110 000 à la hausse')).toBe('Bitcoin perpétuel franchit 110000 à la hausse');
    expect(normalizeSpeech('Emploi : +165 k · BLS')).toBe('Emploi : plus 165 mille, BLS');
    expect(normalizeSpeech('Dans 5 min : IPC')).toBe('Dans 5 minutes : IPC');
  });

  it('en anglais, pour les titres en VO', () => {
    expect(normalizeSpeech('CPI -0.2% vs 0.1%', 'en')).toBe('CPI minus 0.2 percent vs 0.1 percent');
  });

  it('idempotent', () => {
    const once = normalizeSpeech('+0,3 % · 25 pb');
    expect(normalizeSpeech(once)).toBe(once);
  });
});

const fig = (over: Partial<ReleaseFigure>): ReleaseFigure => ({
  indicator: 'us-cpi-mm', label_fr: 'IPC (m/m)', unit: '%', release: 'cpi', period: '2026-11', edition: '',
  ny_date: '2026-12-10', value: '0.3', reason: null, part: 'tableau A', excerpt: null, flags: [], timing: 'attendue',
  nature: 'officielle', source: 'BLS', url: '', machine: 'mac', scheduled_ms: 0, embargo_ms: 0, first_byte_ms: 0,
  received_ms: 0, capture_delay_ms: 0, clock_corrected: true, bus_ms: 0, forecast: '0.2', forecast_raw: '0.2%',
  forecast_age_ms: 0, surprise: '0.1', z: null, z_n: 0, z_provisional: false, z_reason: null, regular: true,
  display_ms: null, ...over,
});

describe('phrases', () => {
  it('modèle du plan : « IPC sur un mois : plus 0,3 pour cent, prévision plus 0,2 »', () => {
    expect(figurePhrase(fig({}))).toBe('IPC sur un mois : plus 0,3 pour cent, prévision plus 0,2.');
    expect(figurePhrase(fig({ indicator: 'us-unemployment', label_fr: 'Taux de chômage', value: '4.1', forecast: '4.2' })))
      .toBe('Taux de chômage : 4,1 pour cent, prévision 4,2.');
    expect(figurePhrase(fig({ indicator: 'us-nfp', label_fr: 'Créations d’emplois non agricoles', unit: 'K', value: '-23', forecast: null })))
      .toBe('Créations d’emplois non agricoles : moins 23 mille.');
    expect(figurePhrase(fig({ value: null }))).toBe('IPC sur un mois : chiffre non lu.');
  });

  it('une publication : un chiffre par phrase, rattrapage annoncé comme tel', () => {
    const last = { release: 'cpi', title: 'Consumer Price Index', period: '2026-11', edition: null, ny_date: '2026-12-10',
      keys: [], timing: 'attendue', scheduled_ms: 0, bus_ms: 0 } as ReleaseLast;
    expect(releasePhrase(last, [fig({}), fig({ label_fr: 'IPC (sur un an)', value: '2.9', forecast: '2.8' })]))
      .toBe('Chiffres américains. IPC sur un mois : plus 0,3 pour cent, prévision plus 0,2. IPC sur un an : plus 2,9 pour cent, prévision plus 2,8.');
    expect(releasePhrase({ ...last, nature: 'rattrapage' } as ReleaseLast, [])).toBe('Rattrapage, chiffres américains.');
  });

  it('alerte', () => {
    expect(alertPhrase({ title: 'Funding BTC-USDT perp à +0,0312 %' } as never)).toBe('Alerte. Funding Bitcoin perpétuel à plus 0,0312 pour cent.');
  });
});

class FakeSpeaker implements Speaker {
  said: string[] = [];
  cancels = 0;
  private done: (() => void) | null = null;
  speak(u: Utterance, done: () => void) { this.said.push(u.id); this.done = done; }
  cancel() { this.cancels += 1; const d = this.done; this.done = null; d?.(); }   // le navigateur appelle onend/onerror
  end() { const d = this.done; this.done = null; d?.(); }
}

const u = (id: string, kind: Utterance['kind'], created_ms = 0): Utterance => ({ id, kind, text: id, lang: 'fr', created_ms });

describe('file du squawk', () => {
  it('ordre par priorité, une annonce à la fois, sans doublon', () => {
    let t = 0;
    const sp = new FakeSpeaker();
    const q = new SquawkQueue(sp, () => t);
    q.push(u('titre1', 'titre'));
    q.push(u('titre2', 'titre'));
    q.push(u('alerte1', 'alerte'));
    q.push(u('alerte1', 'alerte'));
    expect(sp.said).toEqual(['titre1']);
    sp.end();
    sp.end();
    sp.end();
    expect(sp.said).toEqual(['titre1', 'alerte1', 'titre2']);
    expect(q.history.map((h) => h.outcome)).toEqual(['dit', 'dit', 'dit']);
  });

  it('un chiffre capté interrompt le reste', () => {
    const sp = new FakeSpeaker();
    const q = new SquawkQueue(sp, () => 0);
    q.push(u('alerte1', 'alerte'));
    q.push(u('chiffre', 'chiffre'));
    expect(sp.said).toEqual(['alerte1', 'chiffre']);
    expect(q.history[0]).toMatchObject({ id: 'alerte1', outcome: 'interrompu' });
    expect(q.speaking?.id).toBe('chiffre');
  });

  it('titres de plus de 60 s abandonnés ; chien de garde', () => {
    let t = 0;
    const sp = new FakeSpeaker();
    const q = new SquawkQueue(sp, () => t);
    q.push(u('long', 'alerte'));
    q.push(u('vieux-titre', 'titre', 0));
    t = MAX_AGE_MS.titre + 1;
    sp.end();
    expect(q.history[0]).toMatchObject({ id: 'vieux-titre', outcome: 'abandonné' });
    q.push(u('bloquée', 'alerte', t));
    t += WATCHDOG_MS + 1;
    q.tick();
    expect(q.history[0]).toMatchObject({ id: 'bloquée', outcome: 'bloqué' });
    expect(sp.cancels).toBe(1);
  });
});
