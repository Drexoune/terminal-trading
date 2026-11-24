// @vitest-environment node
// Tâches scores et backtest (M2, M3) sur la base simulée : historique lu série par série, état
// publié, thèmes retirés quand moins de 6 économies sont connues (cas d'aujourd'hui sans l'OCDE).
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { ECONOMIES } from './catalog.ts';
import { runBacktestJob, runScores } from './jobs.ts';
import { periodEnd, shiftPeriod } from './parse.ts';

const NOW = Date.UTC(2026, 10, 24, 6);

function seed(rest: MemRest, economies: readonly string[]) {
  for (const e of economies) {
    for (let p = '2005-01', i = 0; p <= '2026-10'; p = shiftPeriod(p, 1), i++) {
      rest.rows('macro_observations').push({ series_id: `${e}:cpi`, period: p, period_end: periodEnd(p), value: 2 + ((i * 7 + e.charCodeAt(0)) % 5) / 2 });
      if (e !== 'US') rest.rows('macro_observations').push({ series_id: `FX:${e}`, period: p, period_end: periodEnd(p), value: 1 + ((i + e.charCodeAt(1)) % 9) / 50 });
    }
  }
}

describe('tâche scores', () => {
  it('deux économies seulement (FRED et BCE, OCDE absente) : thèmes retirés avec la raison, scores à 0', async () => {
    const rest = new MemRest();
    seed(rest, ['US', 'EA']);
    const r = await runScores({ now: () => NOW, rest });
    expect(r.themes).toEqual([]);
    expect(r.excluded).toContainEqual({ theme: 'inflation', reason: '2 économies sur 8 seulement' });
    const st = rest.rows('p3_state').find((x) => x.key === 'scores')!.value as { rows: { score: number }[]; date: string };
    expect(st.date).toBe('2026-11-24');
    expect(st.rows.every((x) => x.score === 0)).toBe(true);
  });
  it('8 économies : l’inflation compte, scores bornés', async () => {
    const rest = new MemRest();
    seed(rest, ECONOMIES);
    const r = await runScores({ now: () => NOW, rest });
    expect(r.themes).toEqual(['inflation']);
    const st = rest.rows('p3_state').find((x) => x.key === 'scores')!.value as { rows: { score: number }[] };
    expect(st.rows.every((x) => Math.abs(x.score) <= 100)).toBe(true);
    const sh = rest.rows('p3_state').find((x) => x.key === 'sheets')!.value as { economies: Record<string, { values: { indicator: string; period: string | null;
      previous: { period: string } | null; reason: string | null }[] }> };
    const us = sh.economies.US.values.find((v) => v.indicator === 'cpi')!;
    expect(us).toMatchObject({ period: '2026-10', previous: { period: '2026-09' }, reason: null });   // en base = publié
    expect(sh.economies.NZ.values.find((v) => v.indicator === 'cpi')!.reason).toMatch(/Stats NZ/);
    expect(sh.economies.US.values.find((v) => v.indicator === 'gdp')!.reason).toBe('pas encore relevée');
  });
});

describe('tâche backtest', () => {
  it('résultat écrit, avec le verdict et les réserves', async () => {
    const rest = new MemRest();
    seed(rest, ECONOMIES);
    const r = await runBacktestJob({ now: () => NOW, rest });
    expect(r.months).toBeGreaterThan(200);
    const st = rest.rows('p3_state').find((x) => x.key === 'backtest')!.value as { verdict: string; caveats: string[]; to: string };
    expect(st.to).toBe('2026-07');
    expect(st.caveats.length).toBe(3);
  });
});
