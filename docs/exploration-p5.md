# Exploration de P5 — microstructure BTC (étape S0)

Relevés du 24/11/2026 (≈ 19:43–19:55 UTC) depuis le Mac, en lecture seule, sans clé : `scripts/explore_micro.py` (WebSockets 40 à 240 s par plateforme, REST avec en-tête `Origin` de la page Vercel). Messages bruts : `data/explore/micro/<date>_probe/` ; extraits retenus comme fixtures de test à l'étape S1. Cadre : T-065 (flux lus par le navigateur, historique = direct + rattrapage REST, aucun stockage serveur).

## 1. Accès depuis le navigateur (CORS)

| Domaine | CORS | Remarque |
| --- | --- | --- |
| `fapi.binance.com`, `api.binance.com` | `*` | |
| `api.bybit.com` | origine renvoyée | |
| `api.hyperliquid.xyz` (`POST /info`) | `*` | |
| `api.exchange.coinbase.com` | `*` | |
| `www.okx.com` | `*` | sert aussi l'historique public absent d'EEA (§ 4) |
| `eea.okx.com` | **aucun** | REST relayé par Vercel (fonctions existantes) ; renvoie des listes **vides** pour `taker-volume-contract`, `contracts/open-interest-history` et l'historique des liquidations |

## 2. WebSockets (débits observés, marché calme, BTC ≈ 59 700 $)

| Plateforme | URL | Canaux | Débit | Constat |
| --- | --- | --- | --- | --- |
| OKX EEA | `wss://wseea.okx.com/ws/v5/public` | `books` (400 niveaux, instantané puis mises à jour, somme de contrôle), `trades` swap et spot, `liquidation-orders` (instType SWAP), `funding-rate`, `open-interest`, `mark-price`, `index-tickers` | carnet 8/s, trades swap 3/s, spot 1/s | tailles du swap en **contrats** (`ctVal` 0,01 BTC) ; liquidations : tous les swaps, à filtrer sur `BTC-USDT-SWAP` ; la doc d'OKX précise que ce flux **ne représente pas toutes les liquidations** (au plus un envoi par seconde) |
| Binance USDⓈ-M | `wss://fstream.binance.com/public/stream?streams=btcusdt@depth@100ms` et `…/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder/btcusdt@markPrice@1s` | diff de carnet 100 ms, aggTrade, liquidations, prix de marque et funding | carnet 8/s, aggTrade 13/s, marque 1/s | **chemins routés obligatoires** depuis 2026 (« Important WebSocket Change Notice ») : l'ancienne URL sans chemin ne reçoit plus que `/public` (carnet seul, vérifié) ; liquidations : une par symbole et par seconde au plus, donc un **plancher** ; `!forceOrder@arr` (tous symboles) : 33 en 90 s, aucune sur BTC dans la fenêtre |
| Binance spot | `wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade` | aggTrade | 3 à 8/s | |
| Bybit linéaire | `wss://stream.bybit.com/v5/public/linear` | `orderbook.1000.BTCUSDT` (instantané puis deltas), `publicTrade`, `tickers` (funding, OI, prochaine échéance), `allLiquidation.BTCUSDT` | carnet 4/s, trades 3 à 8/s, tickers 7/s | ping `{"op":"ping"}` toutes les 20 s ; liquidations : voir § 5 |
| Hyperliquid | `wss://api.hyperliquid.xyz/ws` | `l2Book` (20 niveaux par côté, regroupement `nSigFigs`), `trades`, `activeAssetCtx` (funding, OI, marque) | carnet 0,2/s, trades 1,3/s, contexte 0,8/s | ping `{"method":"ping"}` ; **aucun flux public de liquidations** : les trades portent les deux adresses (`users`) mais aucun marqueur de liquidation |
| Coinbase Exchange | `wss://ws-feed.exchange.coinbase.com` | `matches`, `heartbeat` (sans clé) | 6/s | `side` = côté du **teneur de marché** (un `sell` est un achat agressif) ; `sequence` contrôlable |

## 3. Profondeur couverte par chaque carnet (milieu ≈ 59 717 $)

| Source | Niveaux | Couvert sous / au-dessus du milieu |
| --- | --- | --- |
| OKX WS `books` | 400 | −56 $ / +53 $ (±0,09 %) |
| OKX REST `books-full` (`sz=5000`) | 5 000 | −809 $ / +907 $ (±1,4 %) |
| Binance REST `depth?limit=1000` (point de départ du carnet local) | 1 000 | −133 $ / +141 $ (±0,23 %) |
| Bybit WS / REST 1000 | 1 000 | −220 $ / +343 $ (±0,4 à 0,6 %) |
| Hyperliquid `l2Book`, prix exacts | 20 | ±19,5 $ |
| Hyperliquid `nSigFigs: 4` (pas de 10 $) | 20 | ±195 $ (±0,33 %) |
| Hyperliquid `nSigFigs: 3` (pas de 100 $) | 20 | ±1 950 $ (±3,3 %) |

Conséquences :
- **Carnet agrégé** (10 niveaux au pas de 10 $, soit ±100 $) : couvert par les quatre perpétuels ; OKX au-delà de ±55 $ seulement par `books-full`.
- **Carte de profondeur** :
  - au-delà de ±0,25 %, seuls Bybit, Hyperliquid (pas de 10 $) et OKX `books-full` couvrent ;
  - un relevé `books-full` toutes les 40 s (une colonne de la carte) étend OKX à ±1,4 % ;
  - la carte affiche la plage effectivement couverte par chaque plateforme.

## 4. Rattrapage REST (historique à l'ouverture)

| Besoin | Source | Constat |
| --- | --- | --- |
| CVD perpétuel 4 h | Binance `fapi/v1/klines` 1 min (champ 9 : volume preneur acheteur) | 240 bougies, une requête |
| | OKX `rubik/stat/taker-volume-contract` (`unit=0`, BTC) | 5 min seulement (`1m` refusé : code 51000) ; **vide sur EEA**, servi par `www.okx.com` |
| | Bybit `v5/market/kline` | **pas de volume preneur** : rattrapage impossible, direct seulement |
| | Hyperliquid | aucun historique de trades par l'API publique : direct seulement |
| CVD spot 4 h | Binance `api/v3/klines` 1 min (champ 9) | une requête |
| | OKX `rubik/stat/taker-volume` (`instType=SPOT`, 5 min, en BTC, tous marchés spot BTC confondus) | servi par EEA et `www` |
| | Coinbase `candles` | **pas de volume preneur** : direct seulement |
| Liquidations 1 h | OKX `public/liquidation-orders` (`instFamily=BTC-USDT`, `state=filled`) | **vide sur EEA** ; `www.okx.com` : 100 dernières, ≈ 2 h 15 |
| | Binance, Bybit | aucun historique public : depuis l'ouverture |
| OI et variation 24 h | Binance `futures/data/openInterestHist` (5 min, 300 points) | |
| | Bybit `v5/market/open-interest` (`intervalTime=1h`) | |
| | OKX `rubik/stat/contracts/open-interest-history` (`1H`) | **vide sur EEA**, servi par `www.okx.com` |
| | Hyperliquid | OI instantané seulement (`metaAndAssetCtxs`) : variation 24 h « — » |
| Funding | Binance `premiumIndex` + `fundingInfo` (8 h) ; OKX `funding-rate` (8 h) ; Bybit `tickers` ; Hyperliquid `metaAndAssetCtxs` (taux **horaire**, ×8 pour l'équivalent 8 h) | |
| Prime perp / spot | marque contre indice : Binance `markPrice`/`indexPrice`, Bybit `markPrice`/`indexPrice`, OKX `mark-price` / `index-tickers`, Hyperliquid `markPx`/`oraclePx` | |

## 5. Liquidations de Bybit

- Topic `allLiquidation.{symbol}` (doc v5, ajouté le 20/02/2025) : envoi toutes les 500 ms, présenté par Bybit comme **toutes** les liquidations (l'ancien flux était limité à une par symbole et par seconde). `side` = `Buy` pour une position **longue** liquidée.
- Abonnement accepté (`success: true`) sur BTC, ETH, SOL, XRP, DOGE ; aucune liquidation en 90 s puis en 240 s (soirée calme : 33 liquidations sur **tous** les symboles de Binance en 90 s). Capture de 20 min lancée pour les fixtures ; à défaut, la séance de S4 confirme le format.

## 6. Décision et règles d'affichage

- **T-067** : `www.okx.com` pour l'historique public d'OKX (sans compte ni clé) ; tout le temps réel d'OKX reste sur `wseea`.
- **CVD** : les deux courbes de 4 h ne comptent que les plateformes rattrapables (spot : Binance + OKX ; perp : Binance + OKX), pour que la composition ne change pas en cours de courbe. Bybit, Hyperliquid (perp) et Coinbase (spot) s'affichent à part, en delta « depuis l'ouverture » ; la légende le dit.
- **Liquidations** : chaque ligne porte sa plateforme ; les totaux précisent « Binance et OKX : planchers ; Hyperliquid : aucun flux public ».
- **Carte de profondeur** : plage verticale = ±0,5 % autour du milieu ; chaque plateforme ne compte que dans la plage qu'elle couvre (bornes tracées).

## 7. Bilan par plateforme et par flux

| | OKX | Binance | Bybit | Hyperliquid | Coinbase |
| --- | --- | --- | --- | --- | --- |
| Carnet | retenu (WS 400 + `books-full` / 40 s) | retenu (REST 1000 + diff 100 ms) | retenu (WS 1000) | retenu (`nSigFigs` 4 et 3) | — hors périmètre (spot) |
| Trades / CVD | retenu, rattrapage 5 min | retenu, rattrapage 1 min | direct seulement | direct seulement | direct seulement (spot) |
| Liquidations | retenu, plancher, rattrapage 1 h (`www`) | retenu, plancher | retenu, complet | — aucun flux public | — (spot) |
| Funding | retenu (8 h) | retenu (8 h) | retenu | retenu (horaire ×8) | — |
| OI, 24 h | retenu (`www`) | retenu | retenu | instantané ; 24 h « — » | — |
| Prime perp / spot | marque / indice | marque / indice | marque / indice | marque / oracle | — |
