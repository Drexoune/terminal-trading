# Exploration de P2 — écran Taux (étape R0)

Relevé du 23/11/2026 depuis le Mac par `scripts/explore_rates.py` (lecture seule, une requête par seconde au plus par service, aucune clé). Captures : `data/explore/rates/2026-11-23_probe/` et l'archive `.zip` (ignorées par git). Le même relevé depuis Supabase passe par la tâche `explore` de l'Edge Function `p2-jobs` (section 6).

## 1. Polymarket

- **Gamma** (`https://gamma-api.polymarket.com`), sans clé.
  - Recherche : `/public-search?q=…&events_status=active`.
  - Détail : `/events?slug=…`.
- **Couverture : les 8 banques**, trois prochaines réunions chacune. Titres stables par banque, base de la découverte :
  - Fed : « Fed Decision in … » ;
  - BCE : « ECB Interest Rates: … » ;
  - autres : « Bank of England / Bank of Japan / Swiss National Bank / Bank of Canada / Reserve Bank of Australia / Reserve Bank of New Zealand Decision in … ».
- **Événement** : `negRisk: true`, cinq marchés exclusifs.
  - Libellés dans `groupItemTitle` : « 50+ bps decrease », « 25 bps decrease », « No change » ou « No Change » (la casse varie), « 25 bps increase », « 50+ bps increase ».
  - Champs utiles : `bestBid`, `bestAsk` (nombres ; `bestBid` peut manquer), `lastTradePrice`, `volume24hr`, `clobTokenIds` (chaîne JSON, premier jeton = « Yes »).
  - L'ordre des marchés n'est pas fixe : BNS et BoC listent les hausses d'abord.
- **Liquidité** : Fed de décembre de 0,19 à 0,87 M$ par marché sur 24 h. Hors Fed, de 0 à 26 k$, et des fourchettes jusqu'à 6 points (BoJ de mars 0,009/0,08) → afficher le volume et marquer une fourchette large.
- **Fin d'événement** (`endDate`, UTC) = jour de l'annonce, à un jour près selon le fuseau.
- **Historique** : `https://clob.polymarket.com/prices-history?market=<jeton>`.
  - Fenêtre `startTs`–`endTs` limitée à environ 15 jours, quel que soit le pas (21 jours : « interval is too long »).
  - `interval=max` : 30 derniers jours au pas d'une heure (`fidelity=60`), ou tout l'historique au pas d'un jour (`fidelity=1440`, depuis le 31/07 pour la Fed de décembre).
  - Pour 60 jours au pas horaire : fenêtres de 14 jours enchaînées, 5 requêtes par marché.

## 2. Kalshi

- **API** : `https://api.elections.kalshi.com/trade-api/v2`, sans clé pour les données de marché.
  - Prix en chaînes `*_dollars` (`yes_bid_dollars`, `yes_ask_dollars`, `last_price_dollars`), volumes en `*_fp`.
  - En-têtes `x-ratelimit-limit: 600`, `x-ratelimit-cost: 50` → quelques appels par minute, sans risque.
- **Couverture : 5 banques sur 8.**

  | Banque | Série | Remarque |
  | --- | --- | --- |
  | Fed | `KXFEDDECISION` | 5 issues par réunion, jusqu'à janvier 2028 |
  | Fed | `KXFED` | distribution « Above X % » de la borne haute de la fourchette (règle officielle de Kalshi) : trajectoire implicite |
  | BoJ | `KXCBDECISIONJAPAN` | réunion du 17/12 (date de début de réunion ; annonce le 18) |
  | BoC | `KXCBDECISIONCANADA` | décembre 2026 |
  | BNS | `KXCBDSWISS` | 10/12/2026 |
  | RBNZ | `KXCBDECISIONNZ` | « Dec 8 » : date américaine de l'annonce du 9 à Auckland |

  BCE (`KXECB`), BoE (`KXBOE`, `BOE`) et RBA (`KXRBADECISION`) n'ont que des séries expirées : Kalshi affiche « — · marché non coté ».
- **Historique** : `/series/<série>/markets/<marché>/candlesticks?start_ts&end_ts&period_interval=60`. 60 jours au pas horaire en une requête, champs `price.{open,high,low,close,mean}_dollars`, `yes_bid`, `yes_ask`, `volume_fp`.

## 3. BIS (taux directeurs)

- **API** : `https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.US+XM+GB+JP+CH+CA+AU+NZ?format=csv`, sans clé ; quotidien, publié avec quelques jours de décalage.
- **Valeurs** au 17/11/2026 :

  | Fed | BCE | BoE | BoJ | BNS | BoC | RBA | RBNZ |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 3,875 (milieu de 3,75–4,00) | 2,5 (facilité de dépôt) | 4 | 1,25 | 0 | 2,5 | 4,85 | 2,75 |

- **Format** : le CSV contient des champs entre guillemets avec des virgules, donc lecture par la fin de ligne. Le BIS donne le milieu de la fourchette pour la Fed ; la fourchette vient du communiqué.

## 4. Calendriers officiels des réunions

Relevés dans `supabase/functions/p2-jobs/meetings.ts` (date de l'annonce, fuseau, heure habituelle, URL, date du relevé, dernière date publiée).

| Banque | Page | Particularité |
| --- | --- | --- |
| Fed | `fomccalendars.htm` | 2027 : 8 réunions, la dernière les 16–17/11 ; **Kalshi liste le 08/12/2027 : écart signalé, la page officielle fait foi** |
| BCE | calendrier du Conseil des gouverneurs | jusqu'en décembre 2028 |
| BoE | `upcoming-mpc-dates` | 2026 et 2027 confirmées |
| BoJ | `mpmsche_minu` | réunion sur deux jours, annonce le second jour, sans heure fixe |
| BNS | calendrier des événements | jusqu'en 2028 |
| BoC | événements « interest rate announcements » | ne liste que les mois à venir (jusqu'au 21/07/2027) |
| RBA | `board-meeting-schedules` | 2026 et 2027 |
| RBNZ | page des dates de l'OCR | **HTTP 403 pour un serveur** (comme son RSS l'était pour le plan) : dates tirées de Polymarket, marquées « marchés », aucun contournement |

## 5. Votes

- **Fed**, page du communiqué :
  - « approved the following statement for release by a 10 – 2 vote » ;
  - « Voting against the monetary policy action were Lisa D. Cook and Beth M. Hammack, who preferred to raise the target range … » ;
  - fourchette : « maintain the target range for the federal funds rate at 3-3/4 to 4 percent ».
- **BoE**, page « Monetary Policy Summary » : « voted by a majority of 8–1 to increase Bank Rate by 0.25 percentage points, to 4%. One member voted to increase Bank Rate by 0.5 percentage points ».
- **BoJ** : communiqué en PDF (lien seulement en P2).
- **BCE, BNS, BoC, RBNZ** : pas de vote nominatif publié. **RBA** : vote non nominatif quand il est indiqué.

## 6. Depuis Supabase

Tâche `explore` de `p2-jobs` (une requête par source), lancée le 23/11/2026 après le déploiement. La fonction a tourné en **eu-central-2** (Zurich, d'après `SB_REGION` et le `cf-ray` « ZRH ») ; 2,5 s en tout.

| Source | Statut | Délai | Remarque |
| --- | --- | --- | --- |
| Polymarket Gamma | 200 | 28 ms | événement de la Fed de décembre, 5 marchés, mêmes prix que depuis le Mac |
| Polymarket CLOB (historique, 24 h) | 200 | 119 ms | 25 points horaires |
| Kalshi (`KXFEDDECISION`, ouverts) | 200 | 124 ms | aucun blocage géographique |
| BIS (CSV, dernier point) | 200 | 1 870 ms | le plus lent : relevé quotidien seulement, jamais dans la tâche de chaque minute |
| Calendrier du FOMC | 200 | 181 ms | — |
| Calendrier de la RBNZ | **403** | 132 ms | même refus que depuis le Mac (Cloudflare) : dates « marchés » confirmées |

Aucune source n'est bloquée depuis Supabase : la collecte de chaque minute (Polymarket et Kalshi, une dizaine de requêtes) tient largement dans la limite de 150 s et le budget de 2 s de CPU.

## 7. Conséquences pour R1

- **Découverte des marchés** : recherche Gamma par titre de banque, puis rattachement à `meetings.ts` par la date (±1 jour). Une réunion officielle sans marché affiche « — · marché non coté ».
- **Issues normalisées** par le texte (`decrease`/`increase`, `25`, `50+`, `no change` sans casse), jamais par l'ordre.
- **Probabilité** = milieu de la fourchette achat/vente si l'écart est d'au plus 10 points, sinon dernier échange, marqué « fourchette large ». Volume affiché.
- **Sources par banque** : Polymarket pour les 8, Kalshi pour Fed, BoJ, BoC, BNS et RBNZ. Futures : « — » partout (aucun flux gratuit).
