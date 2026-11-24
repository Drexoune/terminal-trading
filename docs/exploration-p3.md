# Exploration de P3 — macro et heatmap (étape M0)

Relevés du 24/11/2026, en lecture seule, sans clé. Le relevé du Mac passe par `scripts/explore_macro.py` ; les captures sont dans `data/explore/macro/2026-11-24_probe/` et dans l'archive `.zip` (toutes deux ignorées par git). Le même relevé depuis Supabase passe par la tâche `explore` de l'Edge Function `p3-jobs` (section 6). Les 8 économies sont les États-Unis, la zone euro, le Royaume-Uni, le Japon, la Suisse, le Canada, l'Australie et la Nouvelle-Zélande.

## 1. DBnomics : la copie de l'OCDE n'est plus à jour

Le plan prévoyait DBnomics pour l'historique (« agrège OCDE, Eurostat et instituts nationaux »). Relevé du 24/11/2026 :

- **OCDE chez DBnomics** : jeux indexés pour la dernière fois le 16/06/2026 ; le MEI (`OECD/MEI`), le 02/07/2024. Les dernières périodes du jeu `OECD/DSD_KEI@DF_KEI` sont :
  - IPC sur un an des États-Unis : 2026-05 ;
  - Japon : 2021-06 ;
  - Suisse : 2025-12.
- **Autres fournisseurs** (date d'indexation du fournisseur, pas de chaque jeu) :
  - à jour : BEA, ONS, Statistics Canada, Statistics Japan, RBA, Banque du Canada et Banque d'Angleterre (24/11), BCE (22/11) ;
  - en retard : BLS (25/03/2026), Eurostat (22/01/2026), SECO (09/06/2026), BIS (10/07/2025) ;
  - absent : aucune source néo-zélandaise.

**Conséquence.** DBnomics n'est pas retenu comme source principale. Les sources officielles se lisent directement (sections 2 à 5).

## 2. OCDE, API SDMX directe (`sdmx.oecd.org/public/rest`)

- **Accès** : sans clé. Réponse en moins d'une seconde ; cache Cloudflare de 2 h (`cache-control: public,max-age=7200`).
- **Limite publiée** : 60 téléchargements par heure (page « API best practices », oecd.org) ; une copie de la même page indique 20 requêtes par minute et 20 téléchargements par heure. Une requête au-delà est bloquée temporairement. Les pages de l'OCDE refusent la lecture automatique (403) : chiffres tirés des résultats de recherche, à confirmer dans un navigateur.
- **Règle retenue** : 10 requêtes par passage au plus, 2 s entre deux requêtes, un passage par jour. Une clé trop large sur un grand jeu (PIB trimestriel avec jokers) renvoie 403 : chaque dimension est fixée.
- **Euro** : la zone euro ne figure plus sous `EA20` en 2026 (Bulgarie, 01/01/2026), et `EA21` n'existe pas dans ces jeux : la zone euro se lit à la BCE (section 3).

Clés relevées (dimensions de chaque structure lues dans l'API) :

| Indicateur | Jeu | Clé (`<zones>` = USA+GBR+JPN+CHE+CAN+AUS+NZL) |
| --- | --- | --- |
| IPC sur un an, global et sans alimentation ni énergie | `OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0` | `<zones>.M+Q.N.CPI.._T+_TXCP01_NRG..GY` |
| idem, ancienne nomenclature (États-Unis, Royaume-Uni, Australie, Nouvelle-Zélande) | `OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0` | `<zones>.M+Q.N.CPI.PA._T+_TXCP01_NRG.N.GY` |
| Chômage (% de la population active) | `OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0` | `<zones>.UNE_LF_M...Y._T.Y_GE15..` |
| PIB en volume, sur un an | `OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA,1.1` | `Q.Y.<zones>.S1.S1.B1GQ._Z._Z._Z.PC.L.GY.T0102` |
| Confiance des consommateurs | `OECD.SDD.STES,DSD_STES@DF_CS,4.0` | `<zones>..CCICP......` |
| Ventes au détail en volume, sur un an | `OECD.SDD.STES,DSD_KEI@DF_KEI,4.0` | `<zones>.M.TOVM.GR.G47.Y.GY` (7 dimensions ; le relevé large fait 21 Mo : clé étroite obligatoire) |

Dernières périodes relevées le 24/11/2026 :

- **IPC**, historique depuis 2005-01 partout. Le jeu dépend de l'économie :
  - Japon, Suisse et Canada : COICOP 2018, mensuel, 2026-10 ; dans l'ancien jeu, le Japon s'arrête en 2021-06, la Suisse en 2025-12 et le sous-jacent canadien en 2025-04 ;
  - Royaume-Uni : ancien jeu, mensuel, 2026-10 ;
  - Australie : ancien jeu, mensuel depuis 2025-04 seulement (2026-09), trimestriel depuis 2005 (2026-T3) ;
  - Nouvelle-Zélande : ancien jeu, trimestriel, 2026-T3, sous-jacent compris ;
  - États-Unis : ancien jeu jusqu'en 2026-09 (sous-jacent 2026-08) ; FRED est plus récent (section 4).
- **Chômage**, historique depuis 2005 : États-Unis, Canada et Australie en 2026-10 ; Japon en 2026-09 ; Royaume-Uni en 2026-08 (moyenne sur trois mois de l'ONS) ; Suisse en 2026-T2 et Nouvelle-Zélande en 2026-T3 (trimestriels).
- **Ventes au détail en volume sur un an** (`TOVM`, `GY`) : zone euro, Royaume-Uni et Suisse en 2026-09 ; Canada et Japon en 2026-08 ; Australie et Royaume-Uni n'ont plus qu'un indice arrêté en 2026-05 (`RS`) ; rien pour la Nouvelle-Zélande. Ce chiffre ne sert qu'au comparateur de paire : « — » avec la raison pour l'Australie et la Nouvelle-Zélande.
- **PIB** : 2026-T3 pour les États-Unis, le Royaume-Uni, le Japon, la Suisse et le Canada ; 2026-T2 pour l'Australie et la Nouvelle-Zélande ; historique depuis 2005-T1 partout.
- **Confiance** : mensuelle en 2026-10 pour les États-Unis, la zone euro, le Royaume-Uni, le Japon et l'Australie ; trimestrielle pour la Suisse (2026-T3) et la Nouvelle-Zélande (2026-T3) ; **rien pour le Canada** (indice du Conference Board of Canada, privé). Les échelles diffèrent d'un pays à l'autre (solde d'opinions ou indice) : seule la variation, rapportée à l'écart-type du pays, est comparable.

## 3. BCE, zone euro (`data-api.ecb.europa.eu`)

- **Inflation** : le jeu `ICP` s'arrête en 2025-12, remplacé en 2026 par le jeu `HICP` (structure `ECB_ICP3`) :
  - `HICP/M.U2.N.000000.4D0.ANR` : global, de 2000-01 à 2026-10 (4,0 %) ;
  - `HICP/M.U2.N.XEF000.4D0.ANR` : hors énergie, alimentation, alcool et tabac (2,6 %).
- **Chômage** : `LFSI/M.I10.S.UNEHRT.TOTAL0.15_74.T`, composition à 21 pays, 2026-09 (6,5 %).
- **PIB** : `MNA/Q.Y.I10.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.GY`, 2026-T3. Le code `I9` (20 pays) s'arrête en 2026-T1.

## 4. FRED (`fredgraph.csv`, sans clé, déjà utilisé par la watchlist)

- **États-Unis**, toutes séries de 2005 à aujourd'hui :
  - `CPIAUCSL` et `CPILFESL` (IPC global et sous-jacent, indices : variation sur un an calculée) jusqu'en 2026-10 ;
  - `UNRATE` et `UMCSENT` (confiance, université du Michigan) jusqu'en 2026-10 ;
  - `RSAFS` (ventes au détail) jusqu'en 2026-10 ;
  - `GDPC1` (PIB en volume) jusqu'en 2026-T3.
- **Changes contre le dollar, quotidiens (H.10 de la Fed)**, de 2005 au 20/11/2026 : `DEXUSEU`, `DEXUSUK`, `DEXJPUS`, `DEXSZUS`, `DEXCAUS`, `DEXUSAL`, `DEXUSNZ`. Ils servent au backtest.

## 5. BIS, taux directeurs mensuels

`WS_CBPOL`, fréquence `M`, pour les 8 banques : de 2005-01 à 2026-10, le Japon à partir de 2006-03. Le quotidien est déjà relevé par P2 (`policy_rates`).

## 6. Depuis Supabase

Tâche `explore` de `p3-jobs`, déployée le 24/11/2026 avec l'accord de Clément. Une requête par source sur une fenêtre courte ; la fonction tourne en eu-central-2 et sort par Amsterdam (`cf-ray` AMS).

| Source | Statut | Délai | Remarque |
| --- | --- | --- | --- |
| OCDE, données (IPC, chômage) | **500** | 340 à 440 ms | « Internal server error », `cf-cache-status: BYPASS` ; une réponse déjà en cache chez Cloudflare (`age: 20`) passe |
| OCDE, structure | 200 | 80 ms | — |
| BCE, IPCH | 200 | 1,5 à 1,7 s | 2026-10 |
| FRED, IPC américain | 200 | 60 à 400 ms | 2026-10 |
| BIS, mensuel | 200 | 70 à 100 ms | 8 banques |
| DBnomics, copie de l'OCDE | 200 | 210 à 390 ms | IPC américain 2026-05, indexé le 16/06/2026 |

Les mêmes requêtes, avec les mêmes en-têtes (compression comprise), répondent 200 depuis le Mac : l'OCDE refuse les adresses de Supabase. Décision T-057 : essai depuis Vercel (`/api/macro/probe`), sinon instituts nationaux.

## 7. Grille proposée (décision T-056)

| Indicateur | États-Unis | Zone euro | Autres économies |
| --- | --- | --- | --- |
| IPC global et sous-jacent | FRED | BCE (`HICP`) | OCDE : COICOP 2018 pour le Japon, la Suisse et le Canada ; ancien jeu pour le Royaume-Uni, l'Australie et la Nouvelle-Zélande (trimestriel) |
| PIB sur un an | FRED (`GDPC1`) | BCE (`MNA`, I10) | OCDE (`DF_QNA`) |
| Chômage | FRED | BCE (`LFSI`, I10) | OCDE (`DF_IALFS_UNE_M`) |
| Confiance des consommateurs | FRED (Michigan) | OCDE (`DF_CS`) | OCDE (`DF_CS`) ; Canada « — » (indice privé) |
| Ventes au détail sur un an (paire seulement) | FRED (`RSAFS`) | OCDE (`DF_KEI`) | OCDE (`DF_KEI`) ; Australie et Nouvelle-Zélande « — » |
| Taux directeur | BIS (mensuel, et quotidien de P2) | idem | idem |
| PMI composite | agenda (réels FinancialJuice, T-048), à partir du 23/11/2026 | idem | idem |
| Changes (backtest) | FRED H.10 | idem | idem |

**Requêtes par jour** : OCDE 6 (IPC deux jeux, chômage, PIB, confiance, ventes), BCE 4, FRED 13, BIS 1. Avec le cache de 2 h de l'OCDE et `updatedAfter`, bien sous la limite publiée.

Le dernier chiffre de chaque indicateur suivi par l'agenda vient de l'agenda dès sa publication : le BLS pour les États-Unis, sinon le réel FinancialJuice rattaché. L'historique vient de la source de la grille.
