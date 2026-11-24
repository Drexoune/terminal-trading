# Exploration de la section Backtest (étape S0)

Relevés du 24/11/2026 depuis le Mac, en lecture seule. Décision de cadrage : T-061. Les essais de PineTS ont tourné dans un dossier isolé du répertoire temporaire de la session (`pinets` installé sans scripts d'installation), sur 799 bougies quotidiennes BTC/USDT d'OKX (16/09/2024 → 23/11/2026).

## 1. PineTS

- **Paquet** : `pinets` 0.13.1, dépôt `github.com/LuxAlgo/PineTS`, licence **AGPL-3.0-only** (licence commerciale proposée à part). Dépendances : `acorn`, `acorn-walk`, `astring`. Builds pour Node (CJS, ESM) et navigateur.
- **Entrée** : un tableau OHLCV (`openTime`, `open`, `high`, `low`, `close`, `volume`, `closeTime`) ; aucun fournisseur réseau n'est nécessaire (Binance, FMP, Alpaca existent mais ne sont pas utilisés).
- **Pine Script natif v5/v6** : `strategy(...)`, `ta.sma`, `ta.crossover`, `strategy.entry` ont tourné tels quels.
- **Émulateur de courtier** (`ctx.strategy`) : transactions ouvertes et closes (prix, barre, heure, taille signée, PnL, commission, excursions), `netprofit`, `equity`, `sharpe_ratio`, `sortino_ratio`, `cagr`, gains et pertes, buy & hold, règles de risque. Sémantique de TradingView :
  - exécution à l'ouverture de la barre suivante ; taille = capital / (prix × (1 + commission)) ;
  - **appels de marge** émulés par défaut (marge de 100 % en v6) : une position à 100 % du capital est liquidée en fragments quand le prix va contre elle (42 « transactions » pour 17 croisements) ;
  - avec `margin_long=0, margin_short=0`, les transactions correspondent exactement aux croisements calculés à la main (16 allers-retours) ; première transaction vérifiée à la main : 0,101612 BTC = 10 000 / (98 363,9 × 1,0005), PnL (98 363,9 − 106 150,1) × 0,101612 − commissions 0,05 % aller et retour = −801,56.
- **Vitesse** (Node 24, Mac) : 799 barres en 26 ms ; **50 000 barres en 235 ms** (2 706 transactions).
- **Deno** (Edge Functions de Supabase) : annoncé par le README ; Deno n'est pas installé sur le Mac, vérification au premier déploiement de `bt-jobs`.

## 2. Données

- **OKX** : BTC/USDT quotidien depuis le 23/03/2018 environ (l'historique s'arrête là) ; horaire au moins depuis 2021 ; 100 bougies par page.
- **Tiingo** : OHLC quotidien ajusté de SPY, QQQ depuis 1999 (un appel par titre, déjà utilisé par P4).
- **FRED** : indices Nasdaq 100 (`NASDAQ100`, depuis 1986) et Nasdaq Composite, clôture seule ; non retenus pour le backtest (pas de haut ni de bas pour les stops).

## 3. Gemini

- **Clé** : `GEMINI_API_KEY` ajoutée par Clément dans `.env` le 24/11/2026 ; valide (`models.list`, 49 modèles en `generateContent`). Elle reste côté serveur : secrets de Supabase et variables de Vercel à l'étape S3, jamais dans le bundle (le contrôle du bundle refuse même son nom).
- **Modèles candidats** (relevé du 24/11/2026, 1 048 576 jetons en entrée, 65 536 en sortie) : `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite` et `gemini-3.5-flash-lite` (les plus petits, pour réparer du code), `gemini-3.1-pro-preview` (préversion). Choix et prix arrêtés au début de S3, sur la page officielle des tarifs.
- **Tarifs relevés par recherche** (à confirmer) : Flash à 0,75 $ / 3,75 $ par million de jetons en entrée / sortie jusqu'au 31/12/2026, puis 1,50 $ / 7,50 $.

## 4. Règles des sociétés de financement

### FTMO (pages officielles lues le 24/11/2026 : `ftmo.com/en/trading-objectives/`, FAQ « Swing »)

| Compte | Objectif | Perte journalière | Perte maximale | Jours minimum | Constance |
| --- | --- | --- | --- | --- | --- |
| 2-Step, phase 1 | 10 % | 5 % du capital initial, sous le solde de 00:00 (Prague) | 10 % du capital initial, fixe | 4 | aucune règle publiée |
| 2-Step, vérification | 5 % | idem | idem | 4 | idem |
| 1-Step | 10 % | 3 %, même méthode | 10 %, suiveuse en fin de journée (plus haut solde de 00:00), ne fait que monter | non publié | meilleur jour ≤ 50 % du profit total (comptes commandés à partir du 12/10/2026) |

- La perte journalière se mesure sur les **fonds propres** (solde + PnL latent) contre une limite fixée par le **solde à 00:00 CE(S)T** : le simulateur doit couper les journées en heure de Prague (fuseau IANA `Europe/Prague`), changements d'heure compris.
- Un objectif est atteint quand le solde le dépasse, toutes positions fermées. Aucune limite de durée publiée.
- Swing (2-Step seulement) : mêmes objectifs non précisés par la page, levier 1:30, positions gardées le week-end.

### Lucid Trading (LucidFlex 25K, évaluation)

**Source** : règles transmises par Clément le 24/11/2026. Le document est lui-même une consolidation non officielle ; le site de Lucid refuse les lectures automatiques (HTTP 403). Chiffres à vérifier sur le tableau de bord du compte ; l'écran le dira.

| Règle | Valeur | Remarque |
| --- | --- | --- |
| Objectif de profit | 1 250 $ | évaluation |
| Perte maximale | 1 000 $, suiveuse en fin de journée | suit le plus haut solde de fin de journée ; se fige à 25 100 $ (départ + 100 $) quand le solde atteint 26 100 $ |
| Perte journalière (DLL) | 600 $ si activée, sinon aucune | atteinte : séance bloquée, pas d'échec |
| Constance | meilleur jour ≤ 40 % du profit net total (50 % en option) | manque : il faut plus de profit, pas un échec |
| Taille maximale | 2 minis ou 20 micros | non vérifiable ici : nos actifs ne sont pas des futures |
| Horaires | séance de 18:00 à 16:45 (heure de New York) ; positions fermées à 16:45 | journée de trading coupée en `America/New_York` |
| Interdits | HFT, microscalping (plus de 50 % du profit sur des trades de 5 s ou moins), couverture entre comptes | hors du champ d'un backtest sur bougies de 1 h et plus |

Seule la taille 25K est décrite : les autres tailles s'afficheront « — » avec la raison.

## 5. Proposition de décision (T-062)

- **Moteur** : PineTS pour l'exécution du Pine et l'émulateur de courtier, plutôt qu'un courtier écrit par nous ; licence AGPL-3.0 acceptable pour un usage strictement personnel, sans redistribution.
- **Appels de marge** : désactivés par défaut dans nos modèles (levier 1, `margin_long=0, margin_short=0`), activables ; affiché à l'écran.
- **Mesures** : celles de l'émulateur servent de contrôle ; les tuiles notées sont calculées par `metrics.ts` à partir des transactions, testées et comparées à un script Python de référence.
