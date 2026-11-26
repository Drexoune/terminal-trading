# Exploration de P7 (étape S0, T-075)

Relevés du 25/11/2026, depuis le Mac, avec `scripts/explore_p7_deribit.py` et `scripts/explore_p7_sources.py` (lecture seule, sans clé, identité honnête « TERMINAL/0.1 »). Réponses brutes dans `data/explore/p7/` (hors dépôt).

## 1. Deribit, options BTC

| Point | Relevé |
| --- | --- |
| Accès | API publique `https://www.deribit.com/api/v2/public/*`, sans clé ; réponses en 75 à 240 ms ; aucun en-tête de limite renvoyé (crédits par compte non authentifié : quelques requêtes toutes les 5 min restent très en dessous) |
| `get_index_price` (`btc_usd`) | 59 886,62 $ |
| `get_volatility_index_data` (DVOL, résolution 3 600 s, 2 jours) | 49 points `[ts, o, h, l, c]` ; dernier 54,92 ; pagination par `continuation` |
| `get_book_summary_by_currency` (BTC, option) | 956 options, 11 échéances (du 26/11/2026 au 24/09/2027) ; par option : `mark_iv`, `open_interest`, `underlying_price` (prix à terme de l'échéance), volumes ; **pas de greeks** ; 508 Kio |
| `ticker` (BTC-26NOV26-60000-C) | `mark_iv` 46,86, delta 0,45966, `underlying_price` 59 881,7 |

Conséquence : deltas recalculés par Black-Scholes sur le prix à terme de chaque échéance, taux nul. Vérifié contre `ticker` : écart inférieur à 0,01 (`web/src/analysis/options.test.ts`). Échéance des options : 08:00 UTC.

## 2. Probabilités de taux via les futures

- CME FedWatch API : payante (25 $/mois en fin de journée) ; Databento : 199 $/mois.
- Pages JSON du site de cmegroup.com (cotations différées, règlements) : non documentées publiquement. Non utilisées, et jamais sondées en se faisant passer pour un navigateur.
- Conditions d'utilisation de CME : page injoignable lors du relevé.
- FRED, Tiingo : aucun prix de futures de taux.

**Décision (T-075)** : module abandonné ; Polymarket et Kalshi restent les sources de l'écran Taux.

## 3. Recherche bancaire

- ING THINK, flux RSS public `https://think.ing.com/rss/` : HTTP 200, 8 Kio, 10 articles ; par article : `title`, `link`, `guid`, `description` (résumé d'ING), `dc:date`, `dc:subject`.
- Conditions d'ING (`/about/terms-of-use/`, `/about/disclaimer/`) : aucune clause sur le RSS ni l'accès automatisé ; l'avertissement interdit d'afficher le contenu du site à d'autres fins que de s'informer sur ING ; pas d'exception explicite pour l'usage personnel.

**Décision (T-075)** : lecture seule pour Clément seul ; titre, lien, résumé d'ING, date et thème ; jamais le texte des articles ; flux lu toutes les 15 min.

## 4. Machine Oracle et données

- Node 22.23 ; 41 Go libres sur le disque système. `node:sqlite` encore expérimental : historique des options en JSONL, un fichier par mois.
- Saisonnalité : `bt_candles` suffit (BTC et ETH quotidiens depuis 2018 et horaires depuis 2021, OKX ; QQQ et SPY quotidiens depuis 1999, Tiingo ajusté). ETF du PEA : suivent QQQ et SPY.
- Heatmap : bougies publiques d'OKX (`/api/v5/market/candles`, 300 bougies, 1H, 4H, 1Dutc, 1Wutc) pour BTC et ETH ; `bt_candles` pour QQQ et SPY (1D et semaine agrégée). Changes et or : « — » (l'offre gratuite de Tiingo sert déjà la watchlist, T-051).
