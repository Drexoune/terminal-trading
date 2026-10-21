// Planche du design system (référence, hors menu) : reproduit DesignSystem.png
// avec les composants réels. Les chiffres sont des exemples de typographie.

import './design-system.css';
import { Icon } from '../../components/Icon';
import { Panel } from '../../components/Panel';
import {
  Button, Cell, Chip, FeedDot, Gauge, IconButton, Pill, PercentileBar, Sparkline,
} from '../../components/ui';
import { APP_NAME } from '../../names';
import '../../palette/palette.css';

const PALETTE_DEMO = [
  ['BTC GP', 'Graphique BTC-USDT perpétuel', 'Graphiques'],
  ['BTC FUND', 'Funding multi-plateformes', 'Dérivés'],
  ['BTC LIQ', 'Flux de liquidations', 'Microstructure'],
  ['BTC OI', 'Open interest agrégé', 'Dérivés'],
  ['BTC CVD', 'Delta cumulé spot / perp', 'Microstructure'],
];

const SWATCHES: [string, [string, string, string][]][] = [
  ['Fonds et filets', [
    ['Fond', '--bg-app', 'Arrière-plan de l’application'], ['Panneau', '--bg-panel', 'Surface des modules'],
    ['Panneau 2', '--bg-panel-2', 'Survol, champs, infobulles'], ['Filet', '--line', 'Bordures et séparateurs'],
    ['Filet fort', '--line-strong', 'Contours de boutons et puces']]],
  ['Or', [
    ['Or', '--gold', 'Accent, éléments actifs, prix'], ['Or vif', '--gold-hi', 'Chiffres clés, survol'],
    ['Or moyen', '--gold-mid', 'Coins HUD, contours actifs'], ['Or profond', '--gold-deep', 'Fonds teintés, sélection']]],
  ['Signal', [
    ['Cyan', '--up', 'Hausse, au-dessus de l’attendu'], ['Cellule cyan', '--cell-z-up-bg', 'Heatmap positive, texte #E3F8FB'],
    ['Corail', '--down', 'Baisse, en dessous de l’attendu'], ['Cellule corail', '--cell-down-2-bg', 'Heatmap négative, texte #FFE3E0'],
    ['Cellule neutre', '--cell-neutral-bg', 'Heatmap neutre, texte #D9D5D0']]],
  ['Texte', [
    ['Texte 1', '--text-1', 'Titres et valeurs'], ['Texte 2', '--text-2', 'Texte secondaire'],
    ['Texte 3', '--text-3', 'Micro-labels, minimum 4,5:1 sur fond']]],
];

function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim().toUpperCase();
}

const SPARK = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i / 4) * 3 + i * 0.15 + Math.cos(i * 1.7));

export function DesignSystem() {
  return (
    <div className="ds">
      <header className="ds__head">
        <Icon name="logo" size={36} className="gold" />
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="ds__title">{APP_NAME}</h1>
          <div className="lbl" style={{ marginTop: 8 }}>Design system · DA noir et or · HUD · v1</div>
        </div>
        <Chip variant="hot">Nom provisoire</Chip>
        <Chip>Interface FR · jargon marché EN</Chip>
      </header>
      <div className="ds__body">
        <section aria-labelledby="ds-col">
          <h2 id="ds-col" className="ds__sec"><span className="dia" />Couleurs</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {SWATCHES.map(([group, items]) => (
              <div key={group}>
                <div className="lbl" style={{ marginBottom: 10 }}>{group}</div>
                <div className="ds__grid">
                  {items.map(([name, token, note]) => (
                    <div key={token} className="pn" style={{ overflow: 'hidden' }}>
                      <div className="ds__swatch" style={{ background: `var(${token})` }} />
                      <div style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600 }}>{name}</div>
                        <div className="num gold" style={{ marginTop: 4, fontSize: 12 }}>{tokenValue(token)}</div>
                        <div className="ds__note">{note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="ds-typo">
          <h2 id="ds-typo" className="ds__sec"><span className="dia" />Typographie</h2>
          <div className="pn">
            {[
              ['Chiffre clé', 'Rajdhani 600 · 64 px', <div className="kpi-xl">1,25 %</div>],
              ['Titre d’écran', 'Rajdhani 700 · 28 px · +0,12 em', <div className="screen-title">Heatmap fondamentale</div>],
              ['Titre d’article', 'Barlow 600 · 22 px', <div className="article-title">Les fondamentaux favorisent l’USD face au JPY</div>],
              ['Texte courant', 'Barlow 400 · 15 px · 1,55', <p className="reading">L’écart de taux reste le moteur principal de la paire. Une surprise à la hausse sur l’inflation sous-jacente japonaise rapprocherait la prochaine hausse de la BoJ.</p>],
              ['Micro-label', 'JetBrains Mono 500 · 11 px · +0,16 em', <div className="lbl t1">Prochaine réunion · 30/10/2026 · J-11</div>],
              ['Données', 'JetBrains Mono 500 · 13 px · chiffres tabulaires', <div className="num" style={{ fontSize: 13, display: 'flex', gap: 18 }}><span>108 420,5</span><span className="up">▲ +1,84 %</span><span className="dn">▼ −0,42 %</span><span className="t2">4,31 %</span></div>],
            ].map(([label, spec, sample], i) => (
              <div key={i} className="ds__typo">
                <div style={{ width: 220 }}><div className="lbl">{label}</div><div className="ds__spec">{spec}</div></div>
                {sample}
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="ds-comp">
          <h2 id="ds-comp" className="ds__sec"><span className="dia" />Composants</h2>
          <div className="ds__cards">
            <div className="pn ds__card">
              <div className="lbl">Boutons</div>
              <div className="ds__row">
                <Button variant="primary">Créer une alerte</Button>
                <Button>Personnaliser</Button>
                <Button variant="ghost">Voir tout</Button>
                <IconButton icon="maximize" boxed label="Agrandir le panneau" />
                <Button disabled>Indisponible</Button>
              </div>
              <div className="ds__cardnote">Or plein : une seule action principale par écran. Contour : actions courantes. Hauteur 34 px, rayon 3 px.</div>
            </div>
            <div className="pn ds__card">
              <div className="lbl">Puces et biais</div>
              <div className="ds__row">
                <Chip>Neutre</Chip><Chip variant="hot">Actif</Chip><Chip variant="live" dot="up">Temps réel</Chip>
                <Chip variant="new">Nouveau</Chip><Chip variant="pending">En attente · 00:23:56</Chip>
              </div>
              <div className="ds__row"><Pill bias="BULLISH" /><Pill bias="NEUTRAL" /><Pill bias="BEARISH" /><Pill bias="RISK-OFF" /></div>
            </div>
            <div className="pn ds__card">
              <div className="lbl">Cellules d’état · heatmap</div>
              <div className="ds__row" style={{ gap: 6 }}>
                <Cell level="z-up">+0,8</Cell><Cell level="neutral">0,0</Cell>
                <Cell level="down-2">−1,9</Cell><Cell level="z-up" selected>+1,4</Cell>
              </div>
              <div className="ds__cardnote">Cyan = au-dessus de l’attendu ou haussier, corail = en dessous ou baissier. Le contour or marque la sélection.</div>
            </div>
            <div className="pn ds__card">
              <div className="lbl">Sous-en-tête de module</div>
              <div className="subheader" style={{ border: '1px solid var(--line)', padding: '6px 12px' }}>
                <Icon name="calendar" size={14} className="gold" /><span className="dot dot--gold" />
                <span className="lbl t1">Calendrier · semaine 43</span><span className="cursor" />
                <span className="spacer" /><Chip variant="hot" round>USD · EUR · JPY</Chip>
              </div>
            </div>
            <Panel title="Panneau type">
              <div style={{ padding: 16, fontSize: 13, lineHeight: 1.5 }} className="t2">
                Fond #0A0A09, filet 1 px #22201E, coins HUD or en haut à gauche et en bas à droite. En-tête 40 px : poignée, losange or, titre en micro-label, contrôles réglages, épingler, verrouiller, agrandir, fermer.
              </div>
            </Panel>
            <div className="pn ds__card">
              <div className="lbl">Jauge</div>
              <div className="ds__row" style={{ gap: '14px 22px' }}>
                <Gauge value={30} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="gauge-value">30</span><Pill bias="RISK-OFF" />
                  </div>
                  <div className="num t2" style={{ marginTop: 10, fontSize: 11 }}>5 zones · 0 à 100</div>
                </div>
              </div>
            </div>
            <div className="pn ds__card">
              <div className="lbl">Barre de composante · percentile</div>
              {([['VIX', '20,0 · P18', 18], ['Cuivre / or', '+4,49 % · P59', 59]] as const).map(([n, v, p]) => (
                <div key={n}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{n}</span><span className="num t2">{v}</span>
                  </div>
                  <div style={{ marginTop: 8 }}><PercentileBar pct={p} /></div>
                </div>
              ))}
            </div>
            <div className="pn ds__card">
              <div className="lbl">Infobulle de graphique</div>
              <div className="ds__tooltip">
                <div className="lbl gold">IPC 1 an · 15/10/2026</div>
                <div className="num tip__grid"><span>Réel</span><span>3,7 %</span><span>Consensus</span><span>3,6 %</span><span>Surprise z</span><span className="up">+0,8</span></div>
              </div>
            </div>
            <div className="pn ds__card">
              <div className="lbl">Sparkline et statuts de flux</div>
              <Sparkline values={SPARK} width="100%" height={40} strokeWidth={1.6} />
              <div className="ds__row" style={{ gap: '8px 18px' }}>
                <FeedDot state="live">Connecté</FeedDot><FeedDot state="late">Retard &gt; 2 s</FeedDot><FeedDot state="down">Déconnecté</FeedDot>
              </div>
            </div>
            <div className="pn ds__palette-demo">
              <div className="lbl" style={{ marginBottom: 14 }}>Palette de commandes · Ctrl K</div>
              <div className="palette">
                <label className="palette__input">
                  <Icon name="search" size={18} />
                  <span className="sr">Commande</span>
                  <input type="text" value="BTC GP" readOnly />
                  <kbd className="chip">Échap</kbd>
                </label>
                <div role="listbox" aria-label="Suggestions" style={{ padding: '6px 0' }}>
                  {PALETTE_DEMO.map(([cmd, desc, cat], i) => (
                    <div key={cmd} role="option" aria-selected={i === 0} data-selected={i === 0}
                      className="palette__item">
                      <span className="num palette__cmd">{cmd}</span>
                      <span className="palette__desc">{desc}</span>
                      <span className="lbl lbl--s">{cat}</span>
                    </div>
                  ))}
                </div>
                <div className="lbl lbl--s palette__foot">
                  <span>↑ ↓ naviguer</span><span>Entrée ouvrir</span><span>Maj + Entrée nouveau panneau</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
