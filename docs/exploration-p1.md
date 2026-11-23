# Exploration P1 sur le Mac (étape E0, décision T-024)

Depuis l'environnement de développement, ni le BLS, ni Tree of Alpha, ni les banques centrales ne sont joignables. Ces scripts mesurent sur le Mac ce que le plan P1 marque « à mesurer ». Chaque script écrit dans `data/explore/` (ignoré par git) puis produit une archive `.zip` : la renvoyer dans la conversation. Les réponses reçues deviennent les fichiers de référence des tests.

Tout se lance depuis la racine du dépôt, avec le Python de la venv (`.venv/bin/python`, ou `python` une fois la venv activée). Aucune clé n'est nécessaire.

## 0. Préparer le `.env`

Ajouter dans le `.env` du Mac l'adresse e-mail **dédiée** au terminal (T-023) :

```
BLS_CONTACT_EMAIL=adresse-dediee@exemple.org
```

Le BLS bloque les robots qui ne donnent pas de contact : l'adresse part dans le User-Agent (« terminal-trading/0.1 (adresse) »), jamais ailleurs. Sans elle, `explore_bls.py` refuse de démarrer.

## 1. N'importe quel jour : sonde et flux RSS (5 minutes)

```bash
python scripts/explore_bls.py probe
python scripts/explore_news.py rss
```

- `probe` : une requête par adresse du BLS, 3 s d'écart, environ 20 requêtes (pages des communiqués, calendriers, requête conditionnelle).
- `rss` : une lecture de chacun des 15 flux (Fed, BCE, BoE, BoJ, BNS, BoC, RBA, RBNZ, FinancialJuice), 2 s d'écart.

Renvoyer les deux archives.

## 2. Jour de publication : rafale sur le rapport emploi du vendredi 04/12

Publication à 08:30 à New York, soit **14:30 à Paris**. Lancer avant **14:20**, Mac branché, et le laisser allumé jusqu'à 14:40 :

```bash
python scripts/explore_bls.py burst --event empsit --at "2026-12-04 08:30"
```

Dans un deuxième terminal, en même temps :

```bash
python scripts/explore_news.py watch --minutes 30
```

- Le script attend lui-même l'heure et empêche la veille (`caffeinate`) tant qu'il tourne.
- Une requête à T−10 min et à T−60 s, puis **une par seconde** de T−3 s à T+60 s, puis toutes les 10 s jusqu'à T+5 min : une centaine de requêtes en tout. Arrêt immédiat sur 403 ou 429.
- `--at` est l'heure **de New York**, pas celle de Paris.
- Mesure seule : aucun chiffre n'est lu ni affiché.

La rafale prévue sur le PPI du 13/11 n'a pas été lancée, et le BLS ne publie rien d'autre à 08:30 avant le 04/12 (T-035). Ne pas la relancer pendant la répétition du 08/12 ni pendant la porte du 10/12 : la capture du terminal interroge alors déjà le BLS.

## 3. Sur trois jours : Tree of Alpha seul

```bash
python scripts/explore_news.py watch --minutes 4320 --no-fj
```

Mesure le volume et le délai du flux gratuit de Tree of Alpha (T-021) avant tout abonnement. Le Mac peut se mettre en veille : le script se reconnecte et le note. `Ctrl+C` arrête le script plus tôt : l'archive est alors produite avec ce qui a été reçu.

## 4. Une fois : communiqués archivés

```bash
python scripts/explore_bls.py archives --event cpi --count 36
python scripts/explore_bls.py archives --event empsit --count 36
python scripts/explore_bls.py archives --event ppi --count 36
python scripts/explore_bls.py archives --event prod2 --count 12
```

Une page toutes les 5 s, environ 3 minutes par commande. `prod2` (productivité et coûts, trimestriel, 12 publications soit 3 ans) sert à la répétition du 08/12. Lancées le même jour, les quatre commandes remplissent le même dossier : l'archive produite par la dernière contient les quatre. Ces 36 derniers mois de communiqués forment le corpus du parseur (verbes réels, publications irrégulières de 2025-2026).

## 5. Page de test des voix

Avec le front lancé (`npm run dev` dans `web/`, ou le terminal en ligne), ouvrir `/outils/voix.html` dans le navigateur qui affichera le terminal :

1. « Activer voix et son » : un bip, puis « Voix activée ».
2. Pour chaque phrase, « Lire », puis « Juste » ou « Faux » selon ce qui a été entendu (signe moins, « pb », heure).
3. Essayer aussi « Dans 10 s » sur une phrase : c'est la lecture sans geste, celle du squawk.
4. « Copier le rapport » et coller le texte dans la conversation.

La page ne fait aucune requête réseau.

## Ce qui est renvoyé

| Étape | Archive | Sert à |
| --- | --- | --- |
| 1 | `data/explore/bls/<date>_probe.zip`, `data/explore/news/<date>_rss.zip` | en-têtes, cache, formats réels des flux |
| 2 | `data/explore/bls/<date>_burst_empsit.zip`, `data/explore/news/<date>_watch.zip` | délai réel de publication, comportement du cache, délai des fils d'actus |
| 3 | `data/explore/news/<date>_watch.zip` | volume et délai de Tree of Alpha |
| 4 | `data/explore/bls/<date>_archives.zip` | corpus du parseur |
| 5 | rapport JSON copié | choix des voix et normalisation des nombres pour le squawk |

## Résultats

### 20/11/2026 : lancés par Claude Code sur le Mac

- **Flux RSS** : les 15 flux répondent en HTTP 200. FinancialJuice renvoie 100 articles. RBA n'en renvoie qu'un seul, à revoir en E6. Archive : `data/explore/news/2026-11-20_rss.zip`.
- **Sonde du BLS** : toutes les adresses répondent en 200, en 50 à 600 ms, depuis le Mac avec l'adresse de contact dans le User-Agent. Les pages des communiqués (`*.nr0.htm`, `*.htm`) ne portent ni `Last-Modified` ni `ETag`, donc aucune requête conditionnelle n'est possible : la capture d'E3 relit la page entière (90 ko pour `cpi.nr0.htm`). L'API v1 répond `no-cache, no-store`.
- **Calendrier du BLS** : les dates relevées sur les pages `schedule/news_release/*.htm` sont rapport emploi le 04/12, productivité (révisée) le 08/12, CPI le 10/12 et PPI le 15/12, toutes à 08:30 à New York.
- **Communiqués archivés** : 36 pour le CPI, le rapport emploi et le PPI, et 12 pour la productivité, soit 120 pages. Archive : `data/explore/bls/2026-11-20_archives.zip`.
  - L'index de la productivité s'appelle `bls/news-release/prod.htm`, et non `prod2.htm` (404). Le script est corrigé.
  - L'index du rapport emploi publie déjà le lien du 04/12 (`empsit_12042026.htm`), qui répond 404 avant la publication.
- **Tree of Alpha** : écoute lancée le 20/11 à 16:01 pour 3 jours. Le Python de python.org n'a pas de magasin de certificats : sans `SSL_CERT_FILE` pointant vers `certifi`, la connexion `wss://` échoue (`CERTIFICATE_VERIFY_FAILED`). Le script s'en chargera lui-même en E1.
- **Encore à faire** : la rafale du 04/12 et la page de test des voix (§ 5).
- **ForexFactory, relevé du 20/11/2026** : les heures du XML (`ff_calendar_thisweek.xml`) sont en **UTC**, et non en heure de New York. Les 126 événements concordent avec le JSON, qui porte un décalage explicite (« 2026-11-15T16:30:00-05:00 » = « 9:30pm » dans le XML). L'identifiant de série est la fin du lien (« 112-us-core-retail-sales-mm »). `ETag` et `Last-Modified` sont présents ; le fichier est régénéré vers hh:42. Le XML suffit : une seule requête conditionnelle par heure.
- **Calendrier du BLS (`bls.ics`)** : 313 publications, toutes en `TZID=US-Eastern`, traduit en `America/New_York`.


### 22/11/2026 : analyse de l'écoute Tree of Alpha (résultats provisoires, 46 h sur 72)

Écoute lancée le 20/11 à 16:01 (`explore_news.py watch --minutes 4320 --no-fj`), toujours en cours jusqu'au lundi 23/11 vers 16:01. Relevé du 22/11 à 14:20, sur 46 h :

- **Volume** : 161 messages, soit 3,5 par heure en moyenne, très inégal : 116 le vendredi après-midi (heures de marché américaines), 33 le samedi, 12 le dimanche. Écart médian entre deux messages : 2,3 min ; plus long silence : 17 min.
- **Contenu** : 83 messages « direct » (comptes X : Elon Musk, The Block, CoinDesk, Lookonchain, Wu Blockchain…), 56 « Blogs » (CNBC, Forbes, Cointelegraph, Decrypt…), 12 « usGov » (Maison-Blanche, SEC, FTC, Fed), 9 « Proposals » (votes de DAO), 1 Telegram. **Aucun chiffre macro** (ni BLS, ni banque centrale en direct) : Tree of Alpha ne remplace ni la capture du BLS, ni les flux RSS des banques centrales.
- **Délai du flux gratuit** : les messages « direct » et « Proposals » arrivent sans délai (médiane −20 ms : notre horloge et la leur diffèrent de quelques dizaines de ms). Les messages « Blogs » et « usGov » portent un champ `delay: 5000` et arrivent 5 s après leur heure source (médiane 4 985 ms, maximum 15,5 s). Le flux gratuit retarde donc de 5 s les actualités, pas les tweets.
- **Connexion instable** : 225 ouvertures en 46 h. Durée médiane d'une connexion : 70 s. Fermetures : 144 sans trame de fermeture, 80 « keepalive ping timeout » (code 1011), 3 délais d'ouverture dépassés. La reconnexion immédiate (2 s) a suffi : les reprises de plus de 15 min correspondent aux veilles du Mac la nuit.
- **Format** : JSON sans clé, champs `title`, `body`, `time` (ms), `_id`, `link` ou `url`, `suggestions` (cryptos et paires reconnues), `info` (identifiants X, retweet, réponse). `_id` sert d'identifiant natif pour le dédoublonnage.

**Conséquences pour E6** : le flux gratuit suffit pour les titres crypto (pas d'abonnement à 500 $/mois à ce stade, T-021) ; le collecteur doit se reconnecter en continu sans alerter à chaque fermeture (une coupure par minute est normale), et marquer « +5 s » les actualités retardées. Ces conclusions sont à confirmer sur les 72 h complètes.

### 23/11/2026 : écoute Tree of Alpha complète (58,6 h sur 72)

L'écoute s'est arrêtée le 23/11 à 02:35, sans trace de fermeture (Mac redémarré) : 58,6 h au lieu de 72, du vendredi 16:01 au lundi 02:35. Assez pour conclure, sans relancer : un vendredi de séance américaine et un week-end complet.

- **Volume** : 168 messages, 2,9 par heure, très inégal : 116 le vendredi, 33 le samedi, 19 le dimanche. Écart médian entre deux messages : 2,3 min.
- **Silences** : jusqu'à **17 h sans aucun message** (samedi 21/11 19:01 → dimanche 22/11 12:00), alors que la connexion était ouverte 922 min sur 1 019. Autres silences : 9 h 43 la nuit de vendredi à samedi, 2 h 36 le samedi après-midi. Le « plus long silence : 17 min » du relevé provisoire désignait en fait la plus longue coupure de connexion.
- **Contenu** : 86 « direct » (comptes X), 59 « Blogs », 12 « usGov », 10 « Proposals », 1 Telegram. Aucun chiffre macro, aucune banque centrale en direct.
- **Délais** : messages « direct » et « Proposals » sans délai (médiane −20 ms et −44 ms : écart d'horloge), quelques tweets jusqu'à 12,8 s ; « Blogs » et « usGov » portent `delay: 5000` et arrivent 5 s après leur heure source (médiane 4 983 ms, maximum 15,5 s).
- **Connexion** : 294 ouvertures, durée médiane 70 s, maximum 250 min. Fermetures : 189 sans trame de fermeture, 104 « keepalive ping timeout » (1011), 3 délais d'ouverture. Coupures de plus de 15 min : 7, de 15 à 17 min chacune, la nuit ; la reconnexion immédiate a toujours suffi.

**Conclusions pour E6** (relevé provisoire confirmé, un point corrigé) :

1. Le flux gratuit suffit pour les titres crypto : pas d'abonnement (T-021 maintenue).
2. Reconnexion continue et silencieuse : une fermeture par minute est normale, seule une coupure longue (plus de 5 min sans connexion) se journalise comme trou et passe la source en « périmé ».
3. **Fraîcheur jugée sur la connexion, pas sur le dernier message** : un flux ouvert mais muet 17 h est normal le week-end. Écran : « connecté · dernier titre il y a 17 h » plutôt que « périmé ».
4. Les actualités « Blogs » et « usGov » s'affichent avec « +5 s » (champ `delay`).
5. Tree of Alpha ne remplace ni la capture du BLS ni les flux RSS des banques centrales.

### 22/11/2026 : corpus du parseur BLS (étape E3)

Les 120 communiqués archivés et les 4 pages résumé de la sonde ont été lus par le parseur d'E3 (`gateway/terminal_gateway/bls_release.py`). Constats qui ont guidé son écriture :

- **IPC et PPI** : la page résumé (`*.nr0.htm`) porte un tableau A en HTML structuré. Le chiffre est lu dans le tableau et recoupé avec la phrase du texte ; un désaccord bloque la lecture.
- **Emploi et productivité** : la page résumé n'a aucun tableau. Les chiffres viennent du texte, par une liste fermée de tournures réelles (« rose by 165,000 », « changed little in July (+73,000) », « Both nonfarm payroll employment (-23,000) and… », « edged up by 114,000 »).
- **Le communiqué révisé de la productivité porte la même période que le préliminaire** (« 2026 Q03 » pour le 05/11 comme pour le 08/12). La nouveauté se juge donc sur la date d'embargo, jamais sur la période seule. C'est ce qui sera testé à la répétition du 08/12.
- **Le titre HTML n'est pas fiable pour la période** : « M13 » pour décembre (rapport emploi), « Q01 » pour un rapport mensuel (avril 2024), « Q05 » pour le 4e trimestre. La période se lit dans l'en-tête du texte (« THE EMPLOYMENT SITUATION -- MARCH 2024 », « Fourth Quarter and Annual Averages 2025, Preliminary »), qui varie aussi en casse.
- **Embargo** : la virgule après le jour manque parfois (« Friday October 11, 2024 ») ; le jour de semaine est vérifié.
- **Publications irrégulières** : IPC de novembre 2025 « over the 2 months from September 2025 to November 2025 » (refusé, exclu du calcul de z) ; glissements sur un an d'octobre 2026 non publiés (« - »).
- **Résultat** : sur 36 publications, IPC 35 (la 36e est l'irrégulière), emploi 35 sur 35 pour l'emploi salarié et le chômage, 33 pour le salaire horaire (2 communiqués ne donnent la variation qu'en cents), PPI 36, productivité 12 sur 12. Chaque valeur manquante a sa raison.
- **PPI sous-jacent** : l'indice « final demand less foods and energy » n'est pas dans la page résumé (le tableau A ne donne que l'indice hors alimentation, énergie et commerce). Il reste « — » avec sa raison en E3 ; à décider avant le PPI du 15/12.
- La page `empsit_12042026.htm` (publication à venir, déjà liée dans l'index) répond 404 : le parseur la reconnaît comme page d'erreur.

### 23/11/2026 : API v1 du BLS (révisions et rattrapage, T-040)

- **Documentation relue** (bls.gov/developers : api_signature.htm, api_faqs.htm) : sans clé, 25 requêtes par jour, 25 séries et 10 ans par requête, 50 requêtes par 10 s ; POST JSON `{"seriesid": [...], "startyear", "endyear"}` ; aucune variation calculée en v1 ; dépassement : HTTP 429. La page dit qu'une requête compte par appel, sans préciser ; nous comptons chaque appel.
- **Une requête réelle** (12 séries, 2023-2026), réponse en 3,9 s, `no-cache, no-store`. Niveaux d'indice en texte décimal, « - » pour un mois non publié (IPC d'octobre 2025), note « P » sur les chiffres provisoires, drapeau `latest`. Fichier de référence : `gateway/tests/fixtures/bls/api_v1_2026-11-23.json.gz`.
- **Recalcul contre le corpus** : sur la dernière période de chaque indicateur, le chiffre recalculé égale la première publication pour les 10 indicateurs lisibles (IPC et sous-jacent sur un mois et sur un an, emploi, chômage, salaire horaire, PPI, productivité, coûts salariaux unitaires). IPC sur un mois : 2026-01 à 2026-10 tous égaux ; les écarts de 2024-2025 viennent de la révision des coefficients saisonniers de février 2026.
- **PPI sous-jacent** : la série `WPSFD49104` (demande finale hors alimentation et énergie) a les mêmes niveaux que le tableau 1 du communiqué complet (`ppi.htm`, ligne FD 49104 : 156.740 en octobre 2026), et le recalcul redonne ses cinq variations publiées (juin à octobre 2026 : 0,4 ; 0,3 ; 0,2 ; 0,8 ; 0,3). Retenue pour compléter le « — » d'E3 (T-041) ; délai de mise à jour de l'API à mesurer le 15/12.
- **Essai de bout en bout** depuis le Mac, avec le client de la passerelle : révision de l'emploi de septembre 2026 détectée (29 k → 60 k) ; réaction du BTC calculée sur 35 bougies réelles d'OKX EEA, sans trou.

