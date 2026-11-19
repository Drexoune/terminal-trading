# Plan « Bourse et patrimoine » — actions, analyse et portefeuille

> **Version du 19/11/2026, décisions de Clément intégrées (T-027 à T-034, § 10), validée le 19/11/2026 (T-036).** Chaque étape a son plan détaillé, validé avant d'écrire : B0 dans `docs/plan-b0.md`.

Demande de Clément (18/11/2026) : screener mondial, données financières historiques, analyse business, transactions d'initiés, synthèses IA des rapports, calculateur DCF, rétrospectives de valorisation, avis communautaire sur X (Grok), suivi de portefeuille complet (TWR, MWR, TRI), import .xlsx puis actualisation quotidienne, multi-enveloppes (PEA, CTO, assurance-vie, comptes d'espèces), allocation et risques, dividendes, benchmarks, super-investisseurs, calendrier boursier, transcripts, watchlists. LLM : Gemini (clé gratuite, dans Vercel) ; avis X : API Grok (clé dans Vercel). Reprendre des morceaux du Trading Desk pour le portefeuille.

Sources de ce plan : six recherches documentaires du 18 au 19/11/2026 (docs officielles lues par la recherche web, code et réponses réelles de projets publics, registre npm). **Aucune de ces sources n'est joignable depuis l'environnement de développement** : les formats et limites marqués « à mesurer » le seront en E0 (§ 9). Les règles de `CLAUDE.md` s'appliquent sans exception : pas de Yahoo ni de Finnhub, « — » avec la raison quand une donnée manque, source et heure sur chaque chiffre, clés côté serveur seulement, l'IA ne calcule rien et cite ses sources, aucun ordre.

## 1. Ce qui est faisable gratuitement, et ce qui ne l'est pas

| Demande | Gratuit et légal | Limite honnête |
| --- | --- | --- |
| Screener « 50 000+ actions » | **~8 000 sociétés américaines** (SEC) et les sociétés européennes cotées sur un marché réglementé qui déposent leurs comptes au format ESEF (sauf l'Allemagne et l'Irlande, absentes de la base) | 50 000 actions mondiales demandent un fournisseur payant (§ 8). Pas de cours gratuits en masse pour l'Europe : le screener européen filtre sur les fondamentaux, les cours ne sont suivis que pour les lignes et la watchlist |
| « 40 ans » d'historique financier | US : comptes structurés depuis 2009-2011, soit **16 à 17 exercices** ; jusqu'à 20 ans par titre via Alpha Vantage (à la demande, 25 requêtes/jour). Europe : **depuis l'exercice 2020** | 40 ans n'existe que chez des fournisseurs payants. Avant 2009, la SEC n'a que des documents texte |
| Analyse business, gouvernance, concurrents | rapport annuel 10-K et circulaire DEF 14A (US), rapports financiers annuels sur info-financière (France), résumés par Gemini avec citations vérifiées | qualitatif seulement ; chaque affirmation renvoie au passage du document |
| Initiés « en temps réel » | **US** : formulaires 4 de la SEC, quelques minutes après dépôt (délai légal : 2 jours ouvrés). **France** : déclarations des dirigeants de l'AMF (flux RSS officiel, détail dans le PDF) | autres pays européens non couverts ; seuil français de 50 000 €/an sous lequel rien n'est déclaré |
| Synthèses IA de rapports (10-K) | 10-K complets sur la SEC, Gemini au palier gratuit (T-029) | quotas faibles : chaque synthèse est faite une fois puis gardée ; documents publics seulement |
| Calculateur DCF | calcul dans notre code, à partir des flux de trésorerie publiés | — |
| Rétrospectives de valorisation (médianes 10 ans) | US : cours depuis 10 ans et plus (Tiingo) × comptes SEC | Europe : 5 ans au plus (comptes ESEF depuis 2020) |
| Avis sur X | **aucune source gratuite** : Grok et l'API de X sont payants | **retiré** (T-030) |
| Portefeuille complet (TWR, MWR, TRI) | calcul dans notre code, sur l'historique des opérations | les UC d'assurance-vie et les fonds euros n'ont pas de source de valeur liquidative gratuite : saisie à partir des relevés |
| Import .xlsx puis actualisation quotidienne | import dans le navigateur, cours relevés chaque nuit par Supabase | — |
| Multi-enveloppes | PEA, PEA-PME, CTO, assurance-vie, livrets, comptes courants | — |
| Allocation et risques | par ligne, secteur, pays, devise ; volatilité, perte maximale, bêta, corrélations | la ventilation **à l'intérieur** des ETF (pays, secteurs) n'a pas de source gratuite fiable : saisie depuis la fiche de l'émetteur, sinon case « Non ventilé » |
| Dividendes | **US** : historique et dividendes déclarés (Alpha Vantage) ; tous pays : dividendes reçus d'après les opérations | **aucun calendrier gratuit et légal des détachements européens** (Euronext le vend) : saisie manuelle des dates annoncées |
| Benchmarks | S&P 500, MSCI World et CAC 40 via des ETF de référence (SPY, CW8, ETF CAC 40), dividendes réinvestis | les indices MSCI et Euronext eux-mêmes interdisent la collecte automatique |
| Super-investisseurs | déclarations 13F de la SEC, depuis 2013, chaque trimestre | 45 jours de retard légal ; positions longues américaines seulement |
| Calendrier boursier | **US** : résultats à venir (tout le marché en un appel), IPO, dividendes, divisions | Europe : saisie manuelle et communiqués réglementés |
| Transcripts | **US** : conférences de résultats depuis 2010 (Alpha Vantage, gratuit, un appel par trimestre et par société) | Europe : aucune source gratuite trouvée |
| Watchlists | listes multiples, critères du screener enregistrés | — |

## 2. Sources retenues

| Besoin | Source | Coût | Limites et parades |
| --- | --- | --- | --- |
| Comptes, documents, initiés, 13F (US) | SEC EDGAR (API JSON, flux des dépôts, jeux de données trimestriels) | gratuit, domaine public, sans clé | 10 requêtes/s partagées, User-Agent avec adresse de contact, blocage de 10 min au dépassement → limiteur global à 5/s ; appels côté serveur seulement |
| Univers et fondamentaux pour le screener (US) | SEC « frames » : une notion comptable pour toutes les sociétés en un appel | gratuit | concepts standards seulement ; Q4 à reconstituer ; doublons et retraitements à filtrer |
| Comptes européens | filings.xbrl.org (ESEF) + info-financière (DILA, rapports annuels de l'OAM) | gratuit, licence Etalab | base « best efforts », en retard de plusieurs mois ; extensions propres aux sociétés non comparables |
| Initiés France | BDIF de l'AMF : flux RSS « Déclaration des dirigeants » + PDF | gratuit | détail à lire dans le PDF ; API JSON non documentée évitée |
| Référentiel et éligibilité PEA | ESMA FIRDS (ISIN → émetteur), GLEIF (pays du siège), OpenFIGI (ISIN → mnémonique) | gratuit ; clé OpenFIGI gratuite | le préfixe de l'ISIN ne dit pas le pays du siège : la règle passe par l'émetteur |
| Cours US | Massive (ex-Polygon) : tous les titres US en un appel par jour ; Tiingo : séries longues ajustées par titre | gratuit avec clé | Tiingo : 1 000 requêtes/jour, 500 titres différents par mois |
| Cours européens et ETF PEA | Alpha Vantage (CW8.PAR, ESE.PAR, PUST.PAR…) | gratuit avec clé, **25 requêtes/jour** | une clé **dédiée** au terminal (celle du Trading Desk est déjà prise) ; quota peut-être compté par IP, et l'IP de Supabase est partagée : à mesurer |
| Calendrier, dividendes, divisions, transcripts, IPO (US) | Alpha Vantage | gratuit, même quota | budget quotidien réparti (§ 5) |
| Devises | BCE (cours de référence, une requête par jour pour toutes les devises) | gratuit, sans clé | publication vers 16:00 Paris |
| Résumés et analyses | Gemini (`gemini-4-hydrogen`, `gemini-3.5-flash-lite`) | gratuit (T-029) | limites du palier gratuit lues dans AI Studio ; quota atteint → « — · quota atteint » |

Exclus : Yahoo, Finnhub (refusés), Grok (payant, T-030), Stooq (clé obtenue par CAPTCHA depuis 2026, inutilisable côté serveur), Nasdaq (conditions interdisant la collecte), API Ninjas gratuit (stockage interdit), sites MSCI et Euronext automatisés (robots interdits).

## 3. Architecture

- **Tout tourne sur la pile en ligne** (Vercel + Supabase), quel que soit le mode des données de marché (Online, Local, Tour) : le front appelle `/api/bourse/*` sur sa propre origine. Sur le Mac en développement, Vite sert ces mêmes fonctions avec le `.env` local.
- **Fonctions Vercel** (`api/bourse/*.ts`, région `cdg1`) : lecture des tables, calculs à la demande (DCF, performances), appels à Gemini. Les clés restent côté serveur.
- **Tâches planifiées Supabase** (pg_cron + Edge Functions, comme `okx-collector`) : cours et devises chaque nuit, fondamentaux du screener chaque trimestre, initiés pendant la séance américaine, calendrier chaque jour, 13F chaque trimestre. Vercel Hobby ne permet qu'une tâche par jour.
- **Supabase** : tables privées (RLS sans aucune politique), lues et écrites seulement par les fonctions avec la clé secrète. Le navigateur n'appelle jamais Supabase (T-012, étendue par T-031).
- **Protection** : la protection de déploiement Vercel (« All Deployments ») reste obligatoire. Le portefeuille étant une donnée personnelle, les routes du module exigent en plus un mot de passe d'application (T-031) : seule son empreinte est dans les variables de Vercel, la session tient dans un cookie signé `HttpOnly`, `Secure`, `SameSite=Strict`.
- **Volumes** : le screener garde les dernières valeurs de ~30 notions pour tout l'univers (~1 million de lignes). L'historique complet d'une société n'est chargé qu'à l'ouverture de sa fiche ou si elle est en portefeuille ou en watchlist. Cela tient dans les 500 Mo de l'offre gratuite.

## 4. IA : règles et coûts

- **Gemini ne reçoit que des documents publics** : rapports, transcripts, communiqués. **Jamais une position, un montant ou une performance du portefeuille.** Sur le palier gratuit, Google utilise les échanges pour améliorer ses produits, et des relecteurs humains peuvent les lire.
- Chaque chiffre produit par l'IA porte une **citation exacte**. Le serveur vérifie que la citation figure mot pour mot dans le document source ; sinon, le chiffre est remplacé par « — » avec la raison. Les ratios et calculs sont faits par notre code, jamais par le modèle (`CLAUDE.md`).
- Chaque résultat est calculé une fois, par document et par version du prompt, puis gardé : pas de nouvel appel à l'affichage. Les synthèses des titres suivis se font la nuit, par petits lots ; une fiche ouverte pour la première fois lance la sienne à la demande.
- **Quotas** : les limites du palier gratuit (requêtes par minute et par jour) se lisent dans AI Studio et peuvent changer. Quota atteint : l'écran affiche « — · quota atteint » et la tâche reprend plus tard ; aucune valeur de remplacement.
- **Gemini et l'Europe** : les conditions de Google exigent le palier payant pour une application utilisée depuis l'Espace économique européen, et décrivent l'API comme réservée à un usage professionnel. Clément retient le palier gratuit en connaissance de ce risque (T-029). Passer au payant (prépaiement de 5 $, puis environ 0,23 $ par 10-K et 0,04 $ par transcript, moins de 10 $/mois à l'usage prévu) ne demanderait que de changer la clé.
- **Avis sur X** : retiré (T-030).

## 5. Budget quotidien des API gratuites

| Source | Usage | Requêtes par jour |
| --- | --- | --- |
| Alpha Vantage | cours des lignes européennes (une par ligne), calendrier des résultats US (1), IPO (1), dividendes et divisions en rotation (~6), transcripts nouveaux (≤ 8), réserve | 25 au plus ; au-delà de ~12 lignes européennes, le plan payant (49,99 $/mois) ou un autre choix devient nécessaire |
| Massive | clôtures de tous les titres US | 1 |
| Gemini | synthèses de documents publics des titres suivis, puis à la demande | selon le quota du palier gratuit |
| Tiingo | séries longues et ETF de référence, à la demande | < 50 |
| SEC | fondamentaux, documents, initiés, 13F | quelques centaines, à moins de 5/s |
| BCE, OpenFIGI, GLEIF, ESMA, info-financière, AMF | référentiel et devises | < 50 |

## 6. Modèle de données (Supabase)

| Table | Contenu clé |
| --- | --- |
| `instruments`, `instrument_listings` | ISIN, CIK, LEI, nom, type (action, ETF, UC, fonds euros, livret), pays du siège, éligibilité PEA et sa raison ; place, mnémonique, devise |
| `prices`, `fx_rates` | clôture par instrument et par jour, source, heure de réception ; cours BCE |
| `fundamentals` | société, notion (liste blanche), période (début, fin), valeur, unité, dépôt source, date de dépôt |
| `filings`, `ai_summaries` | documents (10-K, 10-Q, 8-K, rapport annuel, transcript) ; résumés avec citations, modèle, version du prompt |
| `insider_trades` | émetteur, dirigeant, fonction, code (P/S…), date, quantité, prix, détention après, source (SEC ou AMF), document |
| `holdings_13f` | gérant, trimestre, CUSIP et ISIN, quantité, valeur, variation par rapport au trimestre précédent |
| `corporate_events` | résultats, détachements, paiements, divisions, IPO ; date, source (API, SEC, saisie) |
| `envelopes`, `transactions`, `holdings_snapshots` | enveloppes (PEA, PEA-PME, CTO, AV, livret, compte), opérations typées (achat, vente, dividende, versement, retrait, frais, taxe, arbitrage, division…), relevés de positions pour contrôle |
| `rate_schedules`, `tax_rates` | taux des livrets et fonds euros ; prélèvements sociaux datés (18,6 % en 2026, 17,2 % pour l'assurance-vie) |
| `instrument_exposures` | ventilation des ETF par pays, secteur et devise, avec sa source et sa date |
| `daily_valuations` | valeur, flux externes, rendement du jour et indice TWR, par ligne, enveloppe et total |
| `watchlists`, `screener_views`, `import_batches` | listes, vues enregistrées, lots d'import |

Montants en `numeric`, jamais en flottant. Dates d'opération en heure de Paris, heures de réception en UTC.

## 7. Écrans

Nouvelle section du menu, « Bourse », sous les sections existantes. Pas de maquette préalable : écrans conçus directement avec le design system, capturés à 1 440 px et à 390 px (aucun défilement horizontal) et relus avant la suite (T-033).

| Écran | Commande | Contenu |
| --- | --- | --- |
| Portefeuille | `PTF` | valorisation totale et par enveloppe, lignes, performance (TWR, MWR, TRI) contre benchmarks, allocation (ligne, secteur, pays, devise), risques, dividendes reçus et à venir, import .xlsx |
| Fiche action | `AAPL EQ` | cours, comptes sur 16 ans, ratios, médianes de valorisation sur 10 ans, DCF, initiés, analyse business et résumés IA cités, transcripts, calendrier de la société |
| Screener | `EQS` | filtres multicritères, filtre PEA, note (ci-dessous), vues enregistrées |
| Watchlists | `WL` | listes, colonnes au choix, alertes (moteur d'alertes de P1) |
| Calendrier boursier | `EVTS` | résultats, détachements, divisions, IPO des titres suivis et du marché US |
| Super-investisseurs | `13F` | gérants suivis, positions, entrées et sorties du trimestre |

Repris du Trading Desk :
- la table des ISIN d'ETF éligibles au PEA et la reconnaissance des saisies (ISIN, mnémonique, suffixe de place) ;
- la lecture et le formatage des nombres à la française ;
- le donut de répartition et la table des lignes (poids, plus-value latente, cours périmé) ;
- la saisie manuelle des cours.

Ces morceaux sont réécrits avec les composants et les tokens du terminal. Les lignes du PEA et les liquidités du Trading Desk sont importées une fois ; l'artefact reste en lecture, rien n'y est écrit (T-032).

**Note de l'action (T-034).** Quatre axes : qualité (rentabilité des capitaux, marges), croissance (chiffre d'affaires et résultat sur 3 et 5 ans), valorisation (multiples rapportés à leur médiane sur 10 ans), solidité (endettement, couverture des intérêts). Chaque axe est un percentile dans l'univers couvert, avec le détail des mesures affiché. Aucune pondération cachée ; une mesure manquante s'affiche « — » avec sa raison et ne compte pas comme une note basse. La note est marquée « non testée » : elle n'a été validée sur aucun historique et ne prédit rien.

## 8. Option payante, si le gratuit ne suffit pas

Prix relevés par la recherche, à confirmer au moment de choisir :

- **Alpha Vantage Premium** (49,99 $/mois) : lève la limite de 25 requêtes par jour.
- **Financial Modeling Prep Ultimate** (environ 99 à 139 $/mois) : marchés mondiaux, 30 ans d'historique, transcripts, 13F.
- **EODHD** (environ 60 à 80 $/mois) : fondamentaux et calendriers mondiaux, cours européens en masse.

Le plan commence entièrement gratuit et indique, module par module, ce qu'un abonnement débloquerait.

## 9. Étapes

Une étape à la fois, chacune vérifiée avant la suivante, avec son propre plan détaillé avant d'écrire. B0 et B1 avancent en parallèle de P1, qui passe avant tout autour du 04/12 et du 10/12 ; B2 à B4 attendent la porte du 10/12 (T-027).

| Étape | Contenu | Porte |
| --- | --- | --- |
| B0 Fondations | clés (§ 9 bis), ouverture réseau de l'environnement de développement vers les sources (je te la proposerai), scripts d'exploration et fichiers de référence réels, tables Supabase, référentiel (SEC, ETF PEA, OpenFIGI, GLEIF), cours et devises de la nuit | un titre US, un ETF PEA et un taux BCE relevés automatiquement, avec source et heure |
| B1 Portefeuille | enveloppes, opérations, import .xlsx (et du Trading Desk), valorisation quotidienne, TWR, MWR, TRI, allocation, risques, dividendes, benchmarks | ton portefeuille réel importé et valorisé chaque nuit ; calculs justes sur les cas de test (XIRR d'Excel, Dietz, TWR, volatilité, bêta) |
| B2 Fiche action | comptes, ratios, médianes 10 ans, DCF, initiés US et France, résumés IA, transcripts | une fiche US et une fiche française complètes, chaque chiffre sourcé et daté |
| B3 Screener et watchlists | univers US et européen, filtres, éligibilité PEA, note, vues | filtrage de l'univers en moins de 2 s ; éligibilité PEA contrôlée sur une liste témoin |
| B4 Calendrier et super-investisseurs | événements US, saisie européenne, 13F et variations trimestrielles | les 30 prochains jours des titres suivis ; positions de 5 gérants |

## 9 bis. Clés gratuites à créer

Toutes gratuites. Chaque valeur va dans les variables d'environnement (type Secret) là où elle sert, jamais dans le dépôt ni dans le front ; `.env.example` sera complété en B0.

| Variable | Où la créer | Où la mettre | Sert à |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Google AI Studio | Vercel et secrets des Edge Functions Supabase | synthèses (T-029) |
| `ALPHA_VANTAGE_API_KEY` | alphavantage.co, une clé **dédiée** au terminal (celle du Trading Desk reste au Trading Desk) | secrets des Edge Functions Supabase | cours européens, calendrier, dividendes, transcripts |
| `TIINGO_API_KEY` | tiingo.com | Vercel et Supabase | séries longues US, ETF de référence |
| `MASSIVE_API_KEY` | massive.com (ex-Polygon) | Supabase | clôtures de tous les titres US |
| `OPENFIGI_API_KEY` | openfigi.com | Supabase | ISIN → mnémonique |
| `SEC_CONTACT_EMAIL` | adresse dédiée (celle de `BLS_CONTACT_EMAIL` convient) | Vercel et Supabase | User-Agent exigé par la SEC |
| `BOURSE_PASSWORD_HASH`, `BOURSE_SESSION_SECRET` | produits en local par un script fourni en B0 ; le mot de passe lui-même n'est stocké nulle part | Vercel | mot de passe d'application (T-031) |

Sans clé : SEC, BCE, GLEIF, ESMA FIRDS, filings.xbrl.org, info-financière, AMF.

## 10. Décisions de Clément (19/11/2026)

| | Question | Réponse | Décision |
| --- | --- | --- | --- |
| Q1 | Priorité face à la porte P1 (rapport emploi du 04/12, CPI du 10/12) | B0 et B1 maintenant, P1 prioritaire sur ses dates ; B2 à B4 après le 10/12 | T-027 |
| Q2 | Couverture des données | gratuit d'abord (US + Europe partielle), abonnement plus tard si besoin | T-028 |
| Q3 | Palier de Gemini | **gratuit**, risque des conditions de Google assumé ; documents publics seulement | T-029 |
| Q4 | Usage de Grok | **pas de Grok** : avis sur X retiré | T-030 |
| Q5 | Stockage du portefeuille | Supabase (tables privées), protection Vercel et mot de passe d'application | T-031 |
| Q6 | Données du Trading Desk | import unique des lignes du PEA et des liquidités | T-032 |
| Q7 | Maquettes des nouveaux écrans | conception directe avec le design system, captures à 1 440 et 390 px | T-033 |
| Q8 | Note de l'action | percentiles descriptifs sur quatre axes, détail affiché, « non testée » | T-034 |
