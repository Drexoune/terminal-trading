# Exploration de P4 — sentiment et liquidité (étape S0)

Relevés du 24/11/2026, en lecture seule. Le relevé du Mac passe par `scripts/explore_sentiment.py` ; les captures sont dans `data/explore/sentiment/2026-11-24_probe/` et dans l'archive `.zip` (toutes deux ignorées par git). Le même relevé depuis Supabase passe par la tâche `explore` de l'Edge Function `p4-jobs` (section 7), déployée le 24/11/2026 avec l'accord de Clément. Une partie des réponses sert de fixtures aux tests (`supabase/functions/p4-jobs/fixtures/`).

## 1. Synthèse

| Source | Mac | Supabase | Dernière donnée au 24/11 vers 13:30 Paris | Usage dans P4 |
| --- | --- | --- | --- | --- |
| FRED, VIX `VIXCLS` | 200 | 200 | 20/11 | repli du VIX |
| Cboe, historique du VIX (CSV officiel) | 200 | 200 | **23/11** | VIX (proposé, section 2) |
| FRED, S&P 500 `SP500` | 200 | — | 20/11 (10 ans d'historique) | graphique sur un an |
| FRED, écart haut rendement `BAMLH0A0HYM2` | 200 | — | 20/11 (3 ans d'historique seulement) | composante crédit |
| FRED, bilan de la Fed, Trésor, reverse repo | 200 | 200 | 18/11 (hebdo), 23/11 (quotidien) | liquidité nette |
| Tiingo, clôtures SPY, TLT, CPER, GLD | clé absente du Mac | 200 | **23/11** | composantes actions/refuge, cuivre/or (T-059) |
| Tiingo, change AUD/JPY quotidien | clé absente du Mac | 200 | 24/11 (bougie en cours) | composante AUD/JPY |
| OKX, bougies quotidiennes BTC et ETH | 200 | 200 | 24/11 (400 jours en 4 pages) | composante crypto |
| CFTC, API Socrata (TFF, legacy) | 200 | 200 | positions au 17/11, publiées le 20/11 à 20:30 UTC | COT |
| CFTC, Bank Participation Report (page cftc.gov) | 200 | **403** | positions au 03/11 | positions des banques (section 5) |
| Binance, ratios long/short et financement | 200 | 200 | heure en cours | sentiment retail |
| OKX, ratios long/short et financement | 200 | 200 | heure en cours | sentiment retail |
| Bybit, ratio long/short et financement | 200 | 200 | heure en cours | sentiment retail |

Aucun blocage géographique depuis Supabase (eu-central-2, sortie par Amsterdam) pour Binance et Bybit. Le seul refus est la page du Bank Participation Report.

## 2. Indice de risque : fraîcheur des sept composantes

La porte de P4 demande un indice « recalculé à la clôture ». Au relevé du mardi 24/11 :

- **VIX** : FRED s'arrête au vendredi 20/11 ; le fichier officiel de Cboe (`cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv`, sans clé, redirigé vers `cdn-api.cboe.com`) a déjà la clôture du lundi 23/11 (26,62). Historique depuis le 02/01/1990, colonnes `DATE,OPEN,HIGH,LOW,CLOSE`, dates au format américain `MM/DD/YYYY`.
- **S&P 500** : FRED s'arrête au 20/11 ; la clôture de SPY chez Tiingo est au 23/11 (722,29). SPY est déjà relevé pour la composante actions/refuge.
- **Écart haut rendement** : seule source libre, FRED (indice ICE BofA), un jour ouvré de retard ; historique limité à 3 ans (licence ICE), assez pour un percentile sur 252 séances.
- **AUD/JPY** : Tiingo rend aussi une bougie le dimanche (marché des changes ouvert) : la collecte ne garde que les jours de semaine.
- **CPER/GLD, SPY/TLT** : Tiingo, au 23/11. Champs `date` (minuit UTC du jour de séance), `close`, `adjClose` (ajusté des dividendes).
- **BTC et ETH** : OKX, bougies `1Dutc` (minuit UTC). 100 bougies par page, la plus récente en tête ; la bougie du jour est en cours (dernier champ `confirm` à 0) et doit être exclue.

## 3. Liquidité nette de la Fed

- **Unités**, déduites des ordres de grandeur (les pages descriptives de FRED ne répondaient pas le 24/11 ; à confirmer en S1) :
  - `WALCL` (actif total, niveau du mercredi) : 6 741 452 au 18/11, en **millions** de dollars (6 741 Md$) ;
  - `WTREGEN` (compte du Trésor, **moyenne de la semaine**) : 916 613, en millions ;
  - `WDTGAL` (compte du Trésor, **niveau du mercredi**) : 892 310 au 18/11, en millions ;
  - `RRPONTSYD` (reverse repo, quotidien) : 0,350 au 23/11, en **milliards**.
- **Proposition** : `WALCL − WDTGAL − RRPONTSYD × 1 000`, les trois au mercredi. `WDTGAL` est au même jour que `WALCL` ; `WTREGEN`, prévu au plan, est une moyenne de la semaine.

## 4. COT (CFTC)

- **API Socrata** `publicreporting.cftc.gov`, sans clé. Le catalogue Socrata ne liste pas ce domaine ; identifiants confirmés par leurs métadonnées (`/api/views/<id>.json`) :
  - `gpe5-46if` : TFF - Futures Only ; `yw9f-hn96` : TFF - Combined ;
  - `6dca-aqww` : Legacy - Futures Only ; `jun7-fc8e` : Legacy - Combined ;
  - `72hh-3qpy`, `kh3c-gbw2` : Disaggregated (matières premières, hors périmètre).
- **Calendrier** : positions du mardi, publiées le vendredi à 15:30 New York (`rowsUpdatedAt` 20/11 20:30 UTC).
- **Marchés** : devises (EURO FX, JAPANESE YEN, BRITISH POUND, SWISS FRANC, CANADIAN DOLLAR, AUSTRALIAN DOLLAR, NZ DOLLAR), E-MINI S&P 500, BITCOIN du CME. Le nom inclut la Bourse (« EURO FX - CHICAGO MERCANTILE EXCHANGE ») ; la clé stable est `cftc_contract_market_code`.
- **Catégories TFF** : dealer (`dealer_positions_*`), asset manager, leveraged money, other reportables, non reportables. Historique complet : le percentile sur 3 ans est faisable dès la première collecte.

## 5. Positions des banques (Bank Participation Report)

- **Format** : une page HTML par mois et par type (`/MarketReports/BankParticipation/dea<mois><aa>f` pour les futures, `…o` pour les options), tableau « COMMODITY, BANK TYPE (U.S. / NON U.S.), BANK COUNT, LONG FUTURES, %, SHORT FUTURES, %, OPEN INTEREST ». Date du premier mardi du mois (rapport de novembre : 03/11/2026).
- **Contenu utile** : les 7 devises du CME, E-MINI S&P 500 et BITCOIN du CME. Le nombre de banques est masqué sous 4 (confidentialité) ; une ligne totale suit chaque marché.
- **Accès** : 200 depuis le Mac, **403 depuis Supabase** (page de vérification Cloudflare « Just a moment… », adresses de centre de données refusées). Le relevé automatique depuis Supabase est donc impossible.
- **Ce qui marche depuis Supabase** : la catégorie « dealer » du rapport TFF (API Socrata), hebdomadaire. Elle regroupe surtout les grandes banques, mais ce n'est pas le même périmètre que le BPR.
- **Depuis Vercel** (sonde `/api/sentiment/probe`, 24/11/2026, région cdg1) : index et page de novembre en 200, sans vérification Cloudflare, 116 marchés lus. Comme le prévoit T-060, le BPR est donc relevé : Vercel lit et découpe la page (`/api/sentiment/bpr?month=`, secret exigé, aucune écriture) et la tâche `banks` de `p4-jobs` l'écrit dans `bank_positions`. Tous les mois de l'index au premier passage, les deux derniers ensuite, chaque soir à 21:15 UTC (le rapport est mensuel ; le relevé quotidien le prend dès sa parution).

## 6. Sentiment retail (ratios long/short)

| Plateforme | Point d'accès | Historique | Champs |
| --- | --- | --- | --- |
| Binance USDⓈ-M | `/futures/data/globalLongShortAccountRatio`, `topLongShortAccountRatio`, `topLongShortPositionRatio` | 500 points horaires (≈ 21 jours) ; 30 jours au plus | `longShortRatio`, `longAccount`, `shortAccount`, `timestamp` |
| Binance | `/fapi/v1/premiumIndex` | instantané | `lastFundingRate`, `nextFundingTime` |
| OKX | `/api/v5/rubik/stat/contracts/long-short-account-ratio` (par monnaie) | 720 points horaires (30 jours) | `[ts, ratio]` |
| OKX | `…-contract`, `…-contract-top-trader`, `long-short-position-ratio-contract-top-trader` | 100 points par page | `[ts, ratio]` |
| OKX | `/api/v5/public/funding-rate` | instantané | `fundingRate`, `fundingTime`, `nextFundingTime` |
| Bybit v5 | `/v5/market/account-ratio` | 500 points horaires | `buyRatio`, `sellRatio`, `timestamp` |
| Bybit v5 | `/v5/market/tickers` | instantané | `fundingRate`, `nextFundingTime`, `openInterest` |

L'écart à la moyenne sur 30 jours se calcule dès le rattrapage initial, puis sur notre propre historique.

**Limite d'OKX** : les points d'accès « rubik » refusent au-delà de 5 requêtes par 2 secondes (HTTP 429 au premier rattrapage depuis Supabase, le 24/11/2026). La collecte attend 500 ms entre deux requêtes ; pagination par `end` (horodatage exclu), 33 jours relus au rattrapage.

## 7. Depuis Supabase

Tâche `explore` de `p4-jobs`, deux passages le 24/11/2026 (9 s chacun). La fonction tourne en eu-central-2 et sort par Amsterdam (`cf-ray` AMS). 16 requêtes, dont 5 vers Tiingo (budget de 50 par heure partagé avec la watchlist, qui en prend 40 au plus).

| Ligne | Statut | Délai | Remarque |
| --- | --- | --- | --- |
| `fred-vix`, `fred-rrp` | 200 | 10 à 280 ms | 20/11, 23/11 |
| `cboe-vix` | 200 | 330 ms | 23/11 |
| `tiingo-eod-spy`, `-tlt`, `-cper`, `-gld` | 200 | 130 à 270 ms | 23/11 |
| `tiingo-fx-audjpy` | 200 | 140 à 160 ms | 24/11 (en cours) ; bougie du dimanche 15/11 présente |
| `okx-candles-btc`, `okx-ratio-btc`, `okx-funding-btc` | 200 | 270 à 390 ms | — |
| `cftc-tff` | 200 | 0,8 à 1,2 s | 17/11 |
| `cftc-bpr` | **403** | 115 à 150 ms | vérification Cloudflare |
| `binance-ratio-btc`, `binance-funding-btc` | 200 | 220 à 250 ms | pas de blocage géographique |
| `bybit-ratio-btc` | 200 | 170 à 190 ms | `retCode` 0 |

## 8. Mise en service (24/11/2026)

- **Supabase** : tables `sentiment_series`, `cot_positions`, `crowding`, `bank_positions`, `p4_state` ; Edge Function `p4-jobs` (tâches `closes`, `liquidity`, `cot`, `crowding`, `banks`, `publish`, `explore`) ; 7 tâches planifiées (`supabase/cron-p4.sql`).
- **Vercel** : `api/sentiment.ts` (routes `risk`, `cot`, `banks`, `crowding`, `liquidity`, `probe`, `bpr`).
- **Écrans** : Sentiment de risque (maquette Risque, géométrie ±2 px), COT, Positions des banques, Sentiment retail, Liquidité, et le panneau de la Vue d'ensemble.
- **Porte de P4** : chaque panneau affiche sa source et sa fraîcheur (puce du sous-en-tête et ligne de source marquée `data-fresh`, vérifiées par `web/e2e/sentiment.spec.ts`) ; l'indice est recalculé à chaque relevé des clôtures (22:30 et 06:00 UTC).
