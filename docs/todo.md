# À faire

Liste tenue à jour à chaque étape. Une ligne cochée renvoie au commit ou à la décision qui l'a close. Les décisions se consignent dans `docs/decisions.md`.

## En cours — P5, microstructure BTC

- [x] S1–S3 : worker, agrégations, écran `/microstructure` (`096e047`)
- [x] Relais des statistiques d'OKX par la fonction de l'heure OKX (T-068, `e649b7f`)
- [ ] Microstructure en continu sur Oracle Cloud Always Free (T-069) : plan validé (O0 machine, O1 service, O2 déploiement, O3 bascule du front, O4 une semaine d’observation)
- [ ] Machine en service le 25/11/2026 (`https://82-70-238-221.sslip.io`, eu-marseille-1) ; reste : `VITE_MICRO_SERVER_URL` dans Vercel, O4 (une semaine d'observation)
- [ ] **Avant le 02/12/2026** : mémoire système de la machine au-dessus de 20 % (aujourd'hui ≈ 10 % sur 6 Go), sinon Oracle peut la récupérer au bout de 7 jours d'« inactivité » : ramener la forme à 2 Go, ou ajouter les tâches Oracle ci-dessous qui la font travailler
- [ ] S4, porte de P5 : une séance entière (15:30–22:00, Paris) suivie depuis le seul écran ; revue du journal des coupures ; processeur et mémoire mesurés

## P6 — Assistant et compte (T-073, T-074), en cours

- [x] S0 vérifications et décisions (`fb9030b`) (quota Gemini à lire dans AI Studio par Clément)
- [x] S1 cœur de l'assistant (`fb9030b`) (faits, contrôleur des nombres, route)
- [x] S2 colonne Assistant (`30bb7ae`) de l'écran Actus, traduction à la demande
- [x] S3 voix (`3c8e662`) (appui pour parler)
- [x] S4 récap de session (service Oracle terminal-recap ; tourne une fois les secrets posés)
- [x] S5 track record (journal manuel) et calculateur de risque ; migration `20261203120000_journal.sql` à appliquer
- [ ] S6 porte de P6 : une semaine d'usage réel (assistant et récaps sourcés, réponses écartées relues), après pose des secrets sur la machine

## Sur la machine Oracle (T-069), après la microstructure

Compte jamais passé en paiement à l'usage. Taille de départ : 1 OCPU, 2 Go ; jusqu'à 2 OCPU et 12 Go gratuits si les tâches ci-dessous l'exigent (l'activité du processeur suffit alors à ne pas être « inactif »).

- [ ] **Recherche autonome du backtest** (T-070, `0d6b2c1`) : code et service installés ; reste les secrets (`deployer.sh <ip> secrets`) et l'essai réel — déplacer la boucle de `bt-jobs` (Supabase, découpée par la limite de 2 s de calcul) sur la machine, d'un seul tenant
- [ ] **Alertes à la seconde** (T-071) : code, écran et service installés ; reste les secrets, le redéploiement de `p1-jobs` (nouvelles sortes) et l'essai réel — prix contrôlé sur chaque trade (au lieu du haut et du bas de la bougie 1 min, T-046) ; nouvelles alertes de liquidations (ex. > 10 M$ en 1 min) et de mur retiré ; envoi Telegram — révision de T-046 à décider
- [ ] **Fil d'actus en temps réel** (T-072) : code et service installés ; reste les secrets, le push et l'essai réel — WebSocket de Tree of Alpha tenue par la machine
- [ ] **P6 — Positions OKX en lecture** (reporté par T-074 : pas de clé pour l'instant ; le track record démarre en saisie manuelle) : clé en lecture seule côté serveur, positions et exécutions suivies en continu, journal tenu fenêtre fermée
- [ ] **P6 — Récap de session IA** (Asie, Londres, New York) à partir des données complètes de la séance (CVD, liquidations, volume, carnet)
- [ ] **P7 — Saisonnalité et heatmap technique** : calculs de nuit (rôle prévu pour la tour dans le plan), historique en Parquet + DuckDB (T-003) sur les 200 Go gratuits
- [ ] **P7 — Options BTC Deribit** : volatilité implicite, skew et DVOL enregistrés 24 h/24

## Plus tard, pas prioritaire

- [ ] Rejeu de séance : enregistrer trades et carnet (toutes les 5 s) pour revoir une séance passée
- [ ] Passerelle Python complète sur Oracle (« Mode Tour » sans la tour) — révision importante de T-042, à décider à part
