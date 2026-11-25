// Diffusion SSE de l'état de la microstructure (machine Oracle, T-069) : à la connexion, le dernier
// état complet (une valeur par clé `micro:*`), puis les changements par lots. Sens unique, module
// `http` de Node, sans dépendance. CORS limité aux origines du terminal ; plafond de clients ;
// un client trop lent (tampon > 2 Mo) est coupé plutôt que de faire grossir la mémoire.

import type { IncomingMessage, ServerResponse } from 'node:http';

export type Item = [key: string, value: unknown];

export const MAX_CLIENTS = 10;
export const MAX_BUFFER = 2 * 1024 * 1024;
export const PING_MS = 15_000;

/** Origine autorisée (ou requête sans origine : curl, santé). */
export function allowedOrigin(origin: string | undefined, origins: readonly string[]): boolean {
  return origin === undefined || origins.includes(origin);
}

export class SseHub {
  private clients = new Set<ServerResponse>();
  readonly latest = new Map<string, unknown>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly origins: readonly string[], private readonly max = MAX_CLIENTS) {}

  get size(): number { return this.clients.size; }

  /** Retient les valeurs et les envoie aux clients connectés. */
  broadcast(items: Item[]): void {
    if (!items.length) return;
    for (const [k, v] of items) {
      if (v === null || v === undefined) this.latest.delete(k); else this.latest.set(k, v);
    }
    this.write(`event: items\ndata: ${JSON.stringify(items)}\n\n`);
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (!allowedOrigin(origin, this.origins)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('origine refusée'); return; }
    const cors: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (this.clients.size >= this.max) { res.writeHead(503, { ...cors, 'Retry-After': '30', 'Content-Type': 'text/plain; charset=utf-8' }).end('trop de clients'); return; }
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 5000\nevent: state\ndata: ${JSON.stringify([...this.latest])}\n\n`);
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    req.on('close', drop);
    res.on('error', drop);
    this.timer ??= setInterval(() => this.write(': ping\n\n'), PING_MS);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  private write(chunk: string): void {
    for (const c of this.clients) {
      if (c.writableLength > MAX_BUFFER) { c.destroy(); this.clients.delete(c); continue; }
      c.write(chunk);
    }
  }
}
