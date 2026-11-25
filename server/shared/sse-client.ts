// Lecture d'un flux SSE (server/micro) par les autres services de la machine Oracle (alertes,
// récaps). Module à part : importer un service entier ferait aussi tourner son lancement une fois
// regroupé dans un seul fichier.

/** Découpe un flux SSE en événements { event, data }. */
export class SseParser {
  private buf = '';
  push(chunk: string): { event: string; data: string }[] {
    this.buf += chunk;
    const out: { event: string; data: string }[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    }
    return out;
  }
}
