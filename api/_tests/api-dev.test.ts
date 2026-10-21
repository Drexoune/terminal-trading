/** @vitest-environment node */
// Middleware de développement (web/vite-plugins/api-dev.ts) : /api/<nom> sert
// le GET de api/<nom>.ts ; conversion requête Node -> Request et Response ->
// réponse Node ; routes inconnues, méthodes, erreurs.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiMiddleware, toHeaders } from '../../web/vite-plugins/api-dev.ts';

const API_DIR = fileURLToPath(new URL('../', import.meta.url));

let server: Server;
let base = '';
const logError = vi.fn();
const loaded: string[] = [];

// Modules simulés pour certaines routes ; les autres sont les vrais fichiers d'api/.
const fakes: Record<string, Record<string, unknown>> = {
  'chart.ts': {
    GET: (r: Request) => Response.json(
      { url: r.url, accept: r.headers.get('accept'), method: r.method },
      { status: 201, headers: { 'Cache-Control': 'public, s-maxage=15', 'X-Test': 'oui' } }),
  },
  'instruments.ts': { GET: () => { throw new Error('boum'); } },
  'okx-time.ts': {},
};

beforeAll(async () => {
  const mw = createApiMiddleware({
    apiDir: API_DIR,
    load: async (file) => {
      loaded.push(file);
      const name = file.split('/').pop()!;
      return fakes[name] ?? (await import(/* @vite-ignore */ file));
    },
    logError,
  });
  server = createServer((req, res) => {
    void mw(req, res, () => {
      res.statusCode = 299;
      res.end('suivant');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('middleware /api/* de Vite', () => {
  it('appelle le GET de api/<nom>.ts avec l’URL complète et les en-têtes', async () => {
    const r = await fetch(`${base}/api/chart?inst=BTC-USDT-SWAP&range=1D`, { headers: { Accept: 'application/json' } });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=15');
    expect(r.headers.get('x-test')).toBe('oui');
    expect(await r.json()).toEqual({
      url: `${base}/api/chart?inst=BTC-USDT-SWAP&range=1D`, accept: 'application/json', method: 'GET',
    });
    expect(loaded.at(-1)).toBe(`${API_DIR}chart.ts`);
  });

  it('vraie fonction : /api/health', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ app: 'TERMINAL', mode: 'online', region: 'eea' });
  });

  it('HEAD : en-têtes sans corps', async () => {
    const r = await fetch(`${base}/api/health`, { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.text()).toBe('');
  });

  it('routes inconnues ou protégées : 404 JSON, aucun module chargé', async () => {
    const before = loaded.length;
    for (const path of ['/api/nope', '/api/_lib/http', '/api/_tests/fakes', '/api/..%2Fpackage', '/api', '/api/chart/x']) {
      const r = await fetch(`${base}${path}`);
      expect(r.status, path).toBe(404);
      expect((await r.json()).detail).toMatch(/^route inconnue/);
    }
    expect(loaded.length).toBe(before);
  });

  it('méthode autre que GET : 405', async () => {
    const r = await fetch(`${base}/api/health`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('GET, HEAD');
  });

  it('module sans GET : 405', async () => {
    expect((await fetch(`${base}/api/okx-time`)).status).toBe(405);
  });

  it('exception dans la fonction : 500 générique, détail au terminal', async () => {
    const r = await fetch(`${base}/api/instruments?inst=BTC-USDT-SWAP`);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ detail: 'erreur interne de la fonction (voir le terminal de Vite)' });
    expect(logError.mock.calls.at(-1)?.[0]).toContain('boum');
  });

  it('hors /api : la main passe au middleware suivant (front, repli SPA)', async () => {
    for (const path of ['/', '/apix', '/parametres', '/src/main.tsx']) {
      const r = await fetch(`${base}${path}`);
      expect(r.status, path).toBe(299);
    }
  });

  it('en-têtes Node multiples et pseudo-en-têtes HTTP/2', () => {
    const h = toHeaders({ ':authority': 'x', 'x-a': ['1', '2'], host: 'h', 'x-u': undefined });
    expect(h.get('x-a')).toBe('1, 2');
    expect(h.get('host')).toBe('h');
    expect([...h.keys()]).toEqual(['host', 'x-a']);
  });
});
