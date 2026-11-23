# Exploration de la watchlist hors crypto (décision T-005)

Relevé du 23/11/2026 vers 21:30 Paris, **depuis Supabase**, tâche `explore-watch` de l'Edge Function `p2-jobs` (`supabase/functions/p2-jobs/explore_watch.ts`) : 22 requêtes en 18 s, lecture seule. Les clés viennent des secrets de Supabase (déjà utilisés par le module Bourse) et sont retirées du rapport.

**Actifs** : Nasdaq 100 et S&P 500, DXY, rendement US 10 ans, or, EUR/USD, USD/JPY, ETF PEA Nasdaq 100 (PUST, Paris) et S&P 500 (ESE, Paris).

## Résultats

| Source | Actif | Statut | Constat |
| --- | --- | --- | --- |
| Stooq (sans clé) | les 11 symboles | **404** | point d'accès CSV hors service depuis Supabase : écarté |
| FRED (sans clé, CSV) | US 10 ans `DGS10` | 200 | **quotidien**, dernier point au 19/11 : 2 à 4 jours de retard |
| FRED | dollar large `DTWEXBGS` | 200 | quotidien, plus d'une semaine de retard ; ce n'est **pas** le DXY |
| FRED | EUR/USD `DEXUSEU` | 200 | quotidien, dernier point au 13/11 |
| Tiingo FX (`/tiingo/fx/top`, une requête pour plusieurs paires) | EUR/USD, USD/JPY, XAU/USD | 200 | **temps réel** : achat, vente, milieu, `quoteTimestamp` à la microseconde (20:32 UTC) |
| Tiingo IEX (`/iex/?tickers=qqq,spy`) | QQQ, SPY | 200 | prix de référence dérivé (`tngoLast`) et clôture de la veille ; achat, vente et dernier échange nuls sans accord IEX |
| Massive | indices `I:NDX`, `I:SPX` ; EUR/USD ; instantané QQQ | **403** | « not entitled » : l'abonnement en place ne couvre ni indices, ni changes, ni instantanés |
| Massive | or, veille (`C:XAUUSD/prev`) | 200 | agrégat de la veille seulement |
| Alpha Vantage | ETF PUST.PAR (`GLOBAL_QUOTE`) | 200 | **clôture de vendredi 20/11** (relevé un lundi soir) : pas d'intraday ; 25 requêtes par jour partagées avec Bourse |
| Alpha Vantage | EUR/USD | 200 | refusé (limite d'une requête par seconde atteinte) |

## Conditions de Tiingo (pages officielles lues le 23/11/2026)

- **Offre gratuite « Starter »** : 50 requêtes par heure, 1 000 par jour, 500 symboles par mois, 1 Go par mois. Pas de limite par minute.
- **Offre « Power »** : 30 $ par mois, 10 000 requêtes par heure.
- **Licence** : usage interne et personnel, sans redistribution. C'est le cas du terminal (T-012).
- **Change** : point d'accès en bêta. Plusieurs paires en une requête (`tickers=eurusd,usdjpy,…`). Marché ouvert du dimanche 20:00 au vendredi 17:00 (heure de New York).
- **IEX** : achat, vente et dernier échange exigent un accord avec IEX. Sans lui, prix de référence dérivé (« not a substitute for the TOPS feed »).
- **Usage actuel par Bourse** : historique des cotations américaines nouvellement suivies seulement (quelques appels à 06:20). Le budget horaire est libre.

## Conséquences

- **Aucune source gratuite** ne donne les futures Nasdaq 100 et S&P 500, ni le DXY de l'ICE, ni le 10 ans en intraday, ni les ETF de Paris en intraday.
- **Seule source temps réel gratuite et fiable depuis Supabase** : Tiingo, pour le change et l'or. QQQ et SPY peuvent servir de substituts aux deux indices pendant la séance américaine.
- **Le DXY** se recalcule avec la formule publiée par l'ICE à partir de six paires (EUR, JPY, GBP, CAD, SEK, CHF), toutes dans la même requête Tiingo. Il doit être affiché « recalculé », jamais comme le DXY coté.
- **Clôtures quotidiennes** :
  - le 10 ans vient de FRED, daté ;
  - les ETF du PEA viennent du module Bourse (Alpha Vantage, déjà collectés chaque soir), sans nouvelle requête.
