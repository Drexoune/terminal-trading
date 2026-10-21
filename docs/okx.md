# OKX — ce que la doc et l'observation ont confirmé

Relevé du 20/10/2026. Sources : doc officielle v5 (`https://www.okx.com/docs-v5/en/` et sa version EEA `https://my.okx.com/docs-v5/en/`), puis messages réels enregistrés par `scripts/explore_okx.py --region eea --save` (fixtures dans `collectors/tests/fixtures/`).

## Domaines

| Usage | Compte européen (`my.okx.com`) — utilisé | Compte mondial |
| --- | --- | --- |
| REST | `https://eea.okx.com` | `https://openapi.okx.com` |
| WebSocket publique | `wss://wseea.okx.com/ws/v5/public` | `wss://ws.okx.com/ws/v5/public` |
| WebSocket business (bougies) | `wss://wseea.okx.com/ws/v5/business` | `wss://ws.okx.com/ws/v5/business` |

La doc l'impose (« Regional API Domain Requirement ») : un compte ouvert sur `my.okx.com` doit passer par `eea.okx.com`. La région se choisit par `OKX_REGION` (`eea` par défaut).

## Instruments

`/api/v5/public/instruments?instType=SWAP` sur `eea.okx.com` liste `BTC-USDT-SWAP` (linéaire, `ctVal` 0,01 BTC, `lotSz` 0,01, `tickSz` 0,1) et `ETH-USDT-SWAP` (`ctVal` 0,1 ETH). Les mêmes paramètres apparaissent sur le domaine mondial. La passerelle les lit au démarrage et ne les code jamais en dur.

## Canaux utilisés en P0

| Canal | URL | Champs retenus | Constat |
| --- | --- | --- | --- |
| `trades` | public | `tradeId`, `count`, `px`, `sz` (contrats), `side`, `ts` | `tradeId` est le **dernier** identifiant d'un agrégat de `count` trades. Règle de continuité vérifiée : `tradeId − count = tradeId précédent` (254 trades consécutifs, 0 rupture). |
| `tickers` | public | `last`, `open24h`, `high24h`, `low24h`, `sodUtc0`, `volCcy24h` (BTC), `ts` | au plus une mise à jour par 100 ms ; écart maximal observé entre deux tickers : 346 ms |
| `funding-rate` | public | `fundingRate`, `fundingTime` (prochaine échéance), `prevFundingTime`, `ts` | poussé toutes les 30 à 90 s ; période = `fundingTime − prevFundingTime` = 8 h sur BTC-USDT-SWAP |
| `open-interest` | public | `oiCcy` (BTC), `oiUsd`, `ts` | environ toutes les 10 s |
| `candle1m` | business | `[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]` | au plus une mise à jour par seconde ; `volCcyQuote / volCcy` = prix moyen exact des trades de la bougie, d'où un VWAP sans approximation |

## Connexion et limites

- Maintien en vie : la connexion tombe sans donnée pendant 30 s. Après N < 30 s de silence, envoyer `ping` et attendre `pong` dans les N secondes, sinon reconnecter. N = 20 s.
- 3 connexions par seconde et par IP. Au plus 480 abonnements, désabonnements ou connexions par heure et par connexion. D'où une reconnexion en délai exponentiel de 1 à 30 s, avec gigue.
- REST `/api/v5/market/candles` : 40 requêtes / 2 s par IP, 300 bougies par requête au plus. Seules les **1 440 dernières** bougies de chaque taille sont disponibles, d'où les tailles choisies pour le graphique : 1 J en 1 min, 5 J en 5 min, 1 M en 1 h. La passerelle met le résultat en cache 15 s.
- Les réponses REST observées ne portent aucun en-tête de limite de débit : on espace les appels de 50 ms côté client.

## Latence observée (conteneur de développement, pas la tour)

- Écart entre la réception et `ts` du trade : 116 ms en médiane (113 à 184 ms). Ce chiffre dépend de l'horloge locale.
- L'horloge locale est estimée contre `/api/v5/public/time` en gardant l'échantillon au plus court aller-retour (méthode NTP). Résultat : +23,5 ms ± 69 ms.
- Au-delà de 5 s d'écart, la passerelle juge l'horloge fausse. Elle le publie (`clock:okx`) et l'écran le signale. Seuil identique à drexbot.

## Mode Online : le navigateur lit OKX directement

Relevé du 20/10/2026, voir `docs/modes.md` pour le fonctionnement des trois modes.

- **WebSockets** : OKX accepte une connexion ouverte depuis une page web, quelle que soit son origine. Testé avec les origines `https://….vercel.app` et `http://localhost:5173` sur `wseea.okx.com`. Le worker du navigateur s'abonne donc aux mêmes canaux que la passerelle, via `web/src/data/sources/okxSource.ts`.
- **REST** : il refuse le CORS. Le préflight `OPTIONS` répond 403, et aucune réponse ne porte `Access-Control-Allow-Origin`. Les bougies, les paramètres d'instrument et l'heure d'OKX passent donc par les fonctions Vercel `api/*.ts`, qui tournent sur la même origine que le front.
- **Parité des parseurs** : `web/src/data/okx/parse.ts` reproduit `parse.py`. Leur concordance est vérifiée sur `collectors/tests/fixtures/parsed_golden.json` : 132 messages réels et 13 cas limites. Après toute modification de `parse.py` ou de `ws_messages.json`, relancer `python scripts/make_okx_golden.py`. `pytest` échoue tant que le fichier doré n'est pas à jour.
- **Mesure réelle**, 20 s de flux BTC et ETH reçus directement :
  - latence trade OKX → navigateur : 142 ms en médiane (de 137 à 162 ms) ;
  - écart d'horloge avec OKX : +21 ms ± 72 ;
  - aucun trou de séquence, aucune reconnexion.
