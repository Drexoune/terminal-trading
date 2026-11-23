// Base simulée pour les tests de p1-jobs : tables en mémoire qui comprennent les filtres
// PostgREST utilisés par le code (eq, gt, gte, lt, in, order, limit, select), l'insertion
// avec identifiant automatique et l'upsert sur une ou plusieurs colonnes. Jamais déployé :
// aucune fonction ne l'importe hors des tests.

import type { Json, Rest, Row } from './rest.ts';

export class MemRest implements Rest {
  tables = new Map<string, Row[]>();
  private ids = new Map<string, number>();
  calls: string[] = [];

  rows(t: string): Row[] {
    if (!this.tables.has(t)) this.tables.set(t, []);
    return this.tables.get(t)!;
  }

  private match(r: Row, col: string, cond: string): boolean {
    const [op, ...rest] = cond.split('.');
    const raw = rest.join('.');
    const v = r[col];
    const num = (x: string) => (typeof v === 'number' ? Number(x) : x);
    if (cond === 'is.null') return v === null || v === undefined;
    if (cond === 'not.is.null') return v !== null && v !== undefined;
    switch (op) {
      case 'eq': return v === num(raw);
      case 'lte': return v !== null && v <= num(raw);
      case 'like': return typeof v === 'string' && new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(v);
      case 'gt': return v !== null && v > num(raw);
      case 'gte': return v !== null && v >= num(raw);
      case 'lt': return v !== null && v < num(raw);
      case 'in': return raw.replace(/^\(|\)$/g, '').split(',').map((x) => num(x.replace(/^"|"$/g, ''))).includes(v as never);
      default: throw new Error(`filtre non simulé : ${cond}`);
    }
  }

  async select<T>(t: string, query: Record<string, string>): Promise<T[]> {
    this.calls.push(`select ${t}`);
    let out = this.rows(t).filter((r) => Object.entries(query)
      .every(([k, c]) => ['select', 'order', 'limit'].includes(k) || this.match(r, k, c)));
    if (query.order) {
      const [col, dir] = query.order.split('.');
      out = [...out].sort((a, b) => ((a[col] as number) > (b[col] as number) ? 1 : (a[col] as number) < (b[col] as number) ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (query.limit) out = out.slice(0, Number(query.limit));
    if (query.select && query.select !== '*') {
      const cols = query.select.split(',');
      out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    }
    return structuredClone(out) as T[];
  }

  async insert<T>(t: string, rows: Row[], returning?: string): Promise<T[]> {
    this.calls.push(`insert ${t} ${rows.length}`);
    const made = rows.map((r) => {
      const row: Row = { ...r };
      if (!('id' in row) && t !== 'p1_state' && t !== 'indicators') {
        const id = (this.ids.get(t) ?? 0) + 1;
        this.ids.set(t, id);
        row.id = id;
      }
      this.rows(t).push(row);
      return row;
    });
    return returning ? structuredClone(made) as T[] : [];
  }

  async update(t: string, filters: Record<string, string>, patch: Row): Promise<void> {
    this.calls.push(`update ${t}`);
    if (!Object.keys(filters).length) throw new Error('update sans filtre refusé');
    for (const r of this.rows(t)) if (Object.entries(filters).every(([k, c]) => this.match(r, k, c))) Object.assign(r, structuredClone(patch));
  }

  async remove(t: string, filters: Record<string, string>): Promise<void> {
    this.calls.push(`remove ${t}`);
    if (!Object.keys(filters).length) throw new Error('suppression sans filtre refusée');
    this.tables.set(t, this.rows(t).filter((r) => !Object.entries(filters).every(([k, c]) => this.match(r, k, c))));
  }

  async upsert(t: string, rows: Row[], onConflict: string): Promise<void> {
    this.calls.push(`upsert ${t} ${rows.length}`);
    const cols = onConflict.split(',');
    for (const r of rows) {
      const hit = this.rows(t).find((x) => cols.every((c) => x[c] === r[c]));
      if (hit) Object.assign(hit, structuredClone(r) as Record<string, Json>);
      else await this.insert(t, [r]);
    }
  }

  async insertIgnore<T>(t: string, rows: Row[], onConflict: string): Promise<T[]> {
    this.calls.push(`insertIgnore ${t} ${rows.length}`);
    const cols = onConflict.split(',');
    const made: Row[] = [];
    for (const r of rows) {
      if (this.rows(t).some((x) => cols.every((c) => x[c] === r[c]))) continue;
      made.push(...await this.insert<Row>(t, [r], 'id'));
    }
    return made as T[];
  }

  async rpc<T>(): Promise<T> {
    throw new Error('rpc non simulé');
  }

  state(key: string): Json | undefined {
    return this.rows('p1_state').find((r) => r.key === key)?.value;
  }
}
