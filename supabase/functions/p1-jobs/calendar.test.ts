// @vitest-environment node
// Portage TypeScript de l'agenda (O2) contre le fichier doré de Python : mêmes entrées
// (relevés réels du 20/11/2026 + événements ajoutés), mêmes sorties, au caractère près.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  attachOfficial, eventDict, INDICATORS, parseBlsIcs, parseFfXml, parseValue, TRACKED_RELEASES, weekBounds, weekId, zonedToUtc,
} from './calendar.ts';

const FIX = fileURLToPath(new URL('../../../gateway/tests/fixtures/calendar/', import.meta.url));
const GOLDEN = JSON.parse(readFileSync(`${FIX}golden.json`, 'utf8')) as {
  ff_extra_xml: string; indicators: unknown[]; parse_value: [string, string | null, string | null][];
  ff_events: Record<string, unknown>[]; ics: { releases: unknown[]; problems: string[] }; weeks: string[][];
};
const RAW = readFileSync(`${FIX}ff_calendar_thisweek_2026-11-20.xml`);
const ICS = readFileSync(`${FIX}bls_2026-11-20.ics`, 'utf8');

function augmented(): Uint8Array {
  const xml = new TextDecoder('windows-1252').decode(RAW).replace('</weeklyevents>', `${GOLDEN.ff_extra_xml}</weeklyevents>`);
  // L'ajout est en ASCII : l'encoder tel quel garde le fichier en windows-1252.
  return Uint8Array.from(xml, (c) => c.charCodeAt(0) <= 0xff ? c.charCodeAt(0) : 0x3f);
}

describe('agenda en ligne : portage de calendar_data.py', () => {
  it('mêmes indicateurs suivis que la passerelle', () => {
    expect(INDICATORS).toEqual(GOLDEN.indicators);
    expect(TRACKED_RELEASES).toEqual(['Consumer Price Index', 'Employment Situation', 'Producer Price Index', 'Productivity and Costs']);
  });

  it('lecture des valeurs ForexFactory', () => {
    for (const [raw, value, unit] of GOLDEN.parse_value) expect([raw, ...parseValue(raw)]).toEqual([raw, value, unit]);
  });

  it('calendrier du BLS : publications, heures à New York converties en UTC', () => {
    const [releases, problems] = parseBlsIcs(ICS);
    expect(releases).toEqual(GOLDEN.ics.releases);
    expect(problems).toEqual(GOLDEN.ics.problems);
  });

  it('événements de la semaine, avec l’heure officielle des indicateurs captés', () => {
    const events = parseFfXml(augmented());
    const official = attachOfficial(events, parseBlsIcs(ICS)[0]);
    const got: Record<string, unknown>[] = events.map((e) => ({ ...eventDict(e, official.get(e.identity)), date_utc: e.date_utc, time_raw: e.time_raw }));
    expect(got).toEqual(GOLDEN.ff_events);
    expect(got.find((e) => e.indicator === 'us-cpi-mm')).toMatchObject({ time_source: 'BLS', time_mismatch: false });
    expect(got.find((e) => e.indicator === 'us-core-ppi-mm')).toMatchObject({ time_mismatch: true });
    expect(got.some((e) => e.title === 'S&P Global Services PMI')).toBe(true);
  });

  it('semaines (dimanche -> samedi) et changements d’heure', () => {
    for (const [day, week, from, to] of GOLDEN.weeks) {
      expect(weekId(day)).toBe(week);
      expect(weekBounds(week)).toEqual([from, to]);
    }
    // 08:30 New York : 13:30 UTC en hiver, 12:30 UTC en été (01/11/2026 : fin de l'heure d'été).
    expect(zonedToUtc(2026, 12, 10, 8, 30, 'America/New_York')).toBe(Date.UTC(2026, 11, 10, 13, 30));
    expect(zonedToUtc(2026, 10, 30, 8, 30, 'America/New_York')).toBe(Date.UTC(2026, 9, 30, 12, 30));
    expect(zonedToUtc(2026, 11, 1, 8, 30, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 13, 30));
  });
});
