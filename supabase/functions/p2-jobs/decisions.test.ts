// @vitest-environment node
// Tâche decisions (R4) : votes du FOMC et de la BoE lus sur les pages officielles relevées en R0,
// variation déduite du BIS pour les autres banques, URL tirée du fil d'actus.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { changeFromBis, parseBoe, parseFed, runDecisions } from './decisions.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('pages officielles (réelles)', () => {
  it('FOMC du 28/10/2026 : 10–2, statu quo, deux dissidents pour une hausse', () => {
    const p = parseFed(fx('fed-statement-2026-10-28.html'));
    expect(p).toMatchObject({ change_bp: 0, rate_text: '3-3/4 to 4 percent' });
    expect(p.vote).toEqual({ kind: 'nominatif', for: 10, against: 2, dissents: [
      { name: 'Lisa D. Cook', preferred: 'hausse' }, { name: 'Beth M. Hammack', preferred: 'hausse' }] });
    expect(p.quote).toMatch(/by a 10 – 2 vote/);
  });
  it('BoE de novembre 2026 : 8–1, +25 pb à 4 %, un membre pour +50 pb', () => {
    const p = parseBoe(fx('boe-mps-2026-11-05.html'));
    expect(p).toMatchObject({ change_bp: 25, rate_text: '4%' });
    expect(p.vote).toEqual({ kind: 'nominatif', for: 8, against: 1, dissents: [{ name: 'membre du MPC', preferred: 'hausse' }] });
    expect(p.quote).toMatch(/^the Monetary Policy Committee \(MPC\) voted by a majority of 8–1/);
  });
  it('formes synthétiques : hausse de 1/4 point, unanimité de la BoE, page sans décision', () => {
    const fed = parseFed('<p>The Federal Open Market Committee approved the following statement for release by a 12 - 0 vote:</p><p>The Committee decided to lower the target range for the federal funds rate by 1/4 percentage point to 3-1/2 to 3-3/4 percent.</p>');
    expect(fed).toMatchObject({ change_bp: -25, rate_text: '3-1/2 to 3-3/4 percent', vote: { for: 12, against: 0 } });
    const boe = parseBoe('At its meeting, the Monetary Policy Committee (MPC) voted unanimously to maintain Bank Rate at 4%.');
    expect(boe).toMatchObject({ change_bp: 0, vote: { unanimous: true } });
    expect(parseFed('<p>rien</p>')).toMatchObject({ vote: null, problem: 'décision introuvable sur la page du FOMC' });
  });
});

describe('variation déduite du BIS', () => {
  const rows = [{ obs_date: '2026-10-27', rate: 2.5 }, { obs_date: '2026-10-29', rate: 2.5 }, { obs_date: '2026-11-04', rate: 2.25 }];
  it('premier écart dans les 10 jours (la BCE applique ses décisions la semaine suivante)', () => {
    expect(changeFromBis(rows, '2026-10-29')).toBe(-25);
  });
  it('statu quo seulement quand la série couvre 8 jours ; sinon « en attente »', () => {
    expect(changeFromBis([{ obs_date: '2026-10-27', rate: 2.5 }, { obs_date: '2026-10-30', rate: 2.5 }], '2026-10-29')).toBeNull();
    expect(changeFromBis([{ obs_date: '2026-10-27', rate: 2.5 }, { obs_date: '2026-11-06', rate: 2.5 }], '2026-10-29')).toBe(0);
    expect(changeFromBis([], '2026-10-29')).toBeNull();
  });
});

describe('tâche decisions', () => {
  it('URL du fil d’actus, page lue une fois, minutes de la Fed ignorées', async () => {
    const rest = new MemRest();
    const pub = (iso: string) => Date.parse(iso);
    rest.rows('news_items').push(
      { url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261118a.htm', title: 'Minutes of the Federal Open Market Committee, October 27-28, 2026',
        rule: 'decision:FED', published_ms: pub('2026-11-18T19:00:00Z'), received_ms: pub('2026-11-18T19:01:00Z') },
      { url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm', title: 'Federal Reserve issues FOMC statement',
        rule: 'decision:FED', published_ms: pub('2026-10-28T18:00:00Z'), received_ms: pub('2026-10-28T18:00:30Z') },
      { url: 'https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp261029.en.html', title: 'Monetary policy decisions',
        rule: 'decision:BCE', published_ms: pub('2026-10-29T13:15:00Z'), received_ms: pub('2026-10-29T13:16:00Z') },
    );
    rest.rows('policy_rates').push({ bank: 'BCE', obs_date: '2026-10-28', rate: 2.5 }, { bank: 'BCE', obs_date: '2026-11-06', rate: 2.5 });
    const fetched: string[] = [];
    const now = Date.UTC(2026, 10, 23, 21);
    const deps = { now: () => now, rest, fetch: async (url: string) => { fetched.push(url); return { status: 200, text: async () => fx('fed-statement-2026-10-28.html') }; } };
    const r = await runDecisions(deps);
    expect(r).toMatchObject({ ok: true, done: ['FED 2026-10-28', 'BCE 2026-10-29'] });
    expect(fetched).toEqual(['https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm']);
    const rows = rest.rows('rate_decisions');
    expect(rows.find((x) => x.bank === 'BCE')).toMatchObject({ change_bp: 0, vote: { kind: 'non publié' } });
    expect(rows.find((x) => x.bank === 'FED')).toMatchObject({ change_bp: 0, vote: { for: 10, against: 2 } });
    // Deuxième passage : décisions complètes, aucune page relue.
    await runDecisions(deps);
    expect(fetched).toHaveLength(1);
  });
});
