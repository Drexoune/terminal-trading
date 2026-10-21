// Continuité des trades OKX : portage de collectors/terminal_collectors/okx/gaps.py.
//
// Règle vérifiée sur flux réel (docs/okx.md) : un message du canal `trades`
// agrège `count` trades et porte le dernier identifiant, donc
// `tradeId − count` doit égaler le `tradeId` du message précédent. Tout écart
// est un trou : trades manqués pendant une reconnexion, ou message perdu.
//
// Un trou n'est jamais comblé ni masqué : il est rendu à l'appelant, qui le
// journalise et le signale à l'écran (gaps:okx). Les champs gardent les noms
// du journal Python, pour qu'une entrée se lise de la même façon partout.

export class TradeGap {
  constructor(
    readonly inst: string,
    readonly last_seen: number,
    readonly next_seen: number,
    readonly missing: number,
    readonly ts_source: number,
  ) {}

  describe(): string {
    // missing vaut 0 pour un doublon exact (même identifiant reçu deux fois) :
    // c'est un doublon, pas « 0 trade manquant ». gaps.py teste encore `< 0`.
    if (this.missing <= 0) {
      return `${this.inst} : trade ${this.next_seen} reçu après ${this.last_seen} (doublon ou désordre)`;
    }
    return `${this.inst} : ${this.missing} trade(s) manquant(s) entre ${this.last_seen} et ${this.next_seen}`;
  }
}

export interface SequencedTrade { inst: string; trade_id: number; count: number; ts_source: number }

/** Suit le dernier identifiant de trade par instrument. */
export class TradeSequence {
  private last = new Map<string, number>();

  check(trade: SequencedTrade): TradeGap | null {
    const { inst, trade_id: tid, count } = trade;
    const prev = this.last.get(inst);
    if (prev !== undefined && tid <= prev) {
      // Doublon ou désordre : on garde le plus grand identifiant vu.
      return new TradeGap(inst, prev, tid, tid - prev, trade.ts_source);
    }
    this.last.set(inst, tid);
    if (prev === undefined) return null;
    const first = tid - count + 1;
    if (first !== prev + 1) return new TradeGap(inst, prev, tid, first - prev - 1, trade.ts_source);
    return null;
  }

  reset(inst?: string): void {
    if (inst === undefined) this.last.clear();
    else this.last.delete(inst);
  }
}
