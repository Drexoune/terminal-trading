// Stratégies connues (section Backtest, mode « Stratégies connues ») : Pine Script v6 natif, avec
// leurs paramètres en input.*() ; ouvertes telles quelles dans l'éditeur. Chacune a un sens
// (long, short, les deux) et un stop et un objectif optionnels en % du prix moyen d'entrée. Les
// réglages de l'écran (capital, frais, glissement, taille, marge) s'appliquent par-dessus (T-062).

export interface KnownStrategy { id: string; name: string; family: string; description: string; source: string }

const HEAD = (title: string) => `//@version=6
strategy("${title}", overlay=true)
dir = input.string("Les deux", "Sens", options=["Long", "Short", "Les deux"])
sl = input.float(0.0, "Stop (%)", minval=0.0, step=0.5)
tp = input.float(0.0, "Objectif (%)", minval=0.0, step=0.5)
longOk = dir != "Short"
shortOk = dir != "Long"
`;

/** Signaux longSig / shortSig (entrée), longExit / shortExit (sortie sans retournement). */
const BODY = `
if longSig
    if longOk
        strategy.entry("L", strategy.long)
    else
        strategy.close("S")
if shortSig
    if shortOk
        strategy.entry("S", strategy.short)
    else
        strategy.close("L")
if longExit
    strategy.close("L")
if shortExit
    strategy.close("S")
avg = strategy.position_avg_price
if strategy.position_size > 0 and (sl > 0 or tp > 0)
    strategy.exit("XL", "L", stop = sl > 0 ? avg * (1 - sl / 100) : na, limit = tp > 0 ? avg * (1 + tp / 100) : na)
if strategy.position_size < 0 and (sl > 0 or tp > 0)
    strategy.exit("XS", "S", stop = sl > 0 ? avg * (1 + sl / 100) : na, limit = tp > 0 ? avg * (1 - tp / 100) : na)
`;

export const KNOWN: KnownStrategy[] = [
  {
    id: 'sma_cross', name: 'Croisement de moyennes', family: 'Tendance',
    description: 'Long quand la moyenne rapide passe au-dessus de la lente, short dans l’autre sens ; toujours en position.',
    source: `${HEAD('Croisement de moyennes')}fastLen = input.int(20, "Moyenne rapide", minval=2)
slowLen = input.int(50, "Moyenne lente", minval=3)
fast = ta.sma(close, fastLen)
slow = ta.sma(close, slowLen)
longSig = ta.crossover(fast, slow)
shortSig = ta.crossunder(fast, slow)
longExit = false
shortExit = false
${BODY}`,
  },
  {
    id: 'rsi_reversion', name: 'Retour à la moyenne RSI', family: 'Retour à la moyenne',
    description: 'Long quand le RSI repasse au-dessus du seuil bas, sortie au-dessus du niveau médian ; short symétrique.',
    source: `${HEAD('Retour à la moyenne RSI')}len = input.int(14, "RSI", minval=2)
lo = input.float(30.0, "Seuil bas")
hi = input.float(70.0, "Seuil haut")
mid = input.float(50.0, "Sortie")
r = ta.rsi(close, len)
longSig = ta.crossover(r, lo)
shortSig = ta.crossunder(r, hi)
longExit = ta.crossover(r, mid)
shortExit = ta.crossunder(r, mid)
${BODY}`,
  },
  {
    id: 'donchian', name: 'Cassure de Donchian', family: 'Tendance',
    description: 'Long sur un plus haut de n barres, sortie sur un plus bas de m barres ; short symétrique (façon « Turtle »).',
    source: `${HEAD('Cassure de Donchian')}entryLen = input.int(20, "Canal d’entrée", minval=2)
exitLen = input.int(10, "Canal de sortie", minval=2)
longSig = close > ta.highest(high, entryLen)[1]
shortSig = close < ta.lowest(low, entryLen)[1]
longExit = close < ta.lowest(low, exitLen)[1]
shortExit = close > ta.highest(high, exitLen)[1]
${BODY}`,
  },
  {
    id: 'bollinger', name: 'Retour Bollinger', family: 'Retour à la moyenne',
    description: 'Long quand la clôture repasse au-dessus de la bande basse, sortie à la moyenne ; short symétrique.',
    source: `${HEAD('Retour Bollinger')}len = input.int(20, "Période", minval=2)
mult = input.float(2.0, "Écarts types", minval=0.5, step=0.1)
[basis, upper, lower] = ta.bb(close, len, mult)
longSig = ta.crossover(close, lower)
shortSig = ta.crossunder(close, upper)
longExit = ta.crossover(close, basis)
shortExit = ta.crossunder(close, basis)
${BODY}`,
  },
  {
    id: 'macd', name: 'Croisement MACD', family: 'Momentum',
    description: 'Long quand la MACD passe au-dessus de son signal, short dans l’autre sens.',
    source: `${HEAD('Croisement MACD')}fastLen = input.int(12, "Rapide", minval=2)
slowLen = input.int(26, "Lente", minval=3)
sigLen = input.int(9, "Signal", minval=2)
[m, s, h] = ta.macd(close, fastLen, slowLen, sigLen)
longSig = ta.crossover(m, s)
shortSig = ta.crossunder(m, s)
longExit = false
shortExit = false
${BODY}`,
  },
  {
    id: 'buy_hold', name: 'Achat et conservation', family: 'Référence',
    description: 'Achat à la première barre, conservé jusqu’au bout : la référence de toute stratégie.',
    source: `//@version=6
strategy("Achat et conservation", overlay=true)
if bar_index == 0
    strategy.entry("L", strategy.long)
`,
  },
];

export const knownById = (id: string) => KNOWN.find((k) => k.id === id);
