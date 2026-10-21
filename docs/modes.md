# Modes de fonctionnement : Online, Local, Tour

Le terminal peut tirer ses données de trois endroits. Le **mode** dit où tourne le moteur de données ; l'écran est le même dans les trois cas. Décisions : T-011 (trois modes), T-012 (Supabase), T-013 (fonctions Vercel), T-014 (Mode Local), dans `docs/decisions.md`. Contrat dans le code : `web/src/config/modes.ts`.

| | Mode Online | Mode Local | Mode Tour |
| --- | --- | --- | --- |
| Moteur | Vercel + Supabase | passerelle Python sur le Mac | passerelle Python sur la tour Windows |
| À lancer chez soi | rien | `scripts/dev.py` ou l'agent `deploy/macos` | la passerelle de la tour (`deploy/windows`) et Tailscale |
| Flux temps réel | le navigateur lit directement les WebSockets publiques d'OKX EEA | WebSocket de la passerelle (`ws://127.0.0.1:8710/ws`) | WebSocket de la passerelle (`wss://<tour>.<tailnet>.ts.net/ws`) |
| Bougies, instruments, heure OKX | fonctions Vercel `api/*.ts`, même origine que le front | `http://127.0.0.1:8710/api/…` | `https://<tour>.<tailnet>.ts.net/api/…` |
| Surveillance, journal | collecteur Supabase planifié chaque minute, lu par `/api/collector-health` | journaux de la passerelle (`logs/`) | journaux de la passerelle sur la tour |
| Latence affichée | OKX → navigateur | OKX → passerelle → écran | OKX → passerelle → écran |
| Disponible | partout, tant qu'un navigateur est ouvert | sur ce Mac, tant qu'il est éveillé | sur les appareils du tailnet, tant que la tour tourne |

Aucun mode ne passe d'ordre, aucun n'utilise de clé d'exchange : toutes les données OKX sont publiques. Aucune clé n'arrive dans le navigateur. drexbot n'est concerné par aucun mode : le terminal ne lit ni n'écrit ses données, et ne touche pas à ses collecteurs.

## Choisir le mode sur un appareil

- **Avatar** en haut à droite → écran **Paramètres** (`/parametres`), ou `Ctrl K` → commande **`SET`**.
- Choisir l'une des trois cartes. Pour les Modes Local et Tour, vérifier l'adresse de la passerelle. **Tester** interroge `/api/health` : la passerelle en Modes Local et Tour, les fonctions Vercel puis l'état du collecteur Supabase en Mode Online. **Appliquer** redémarre le flux sur la nouvelle source et recharge les graphiques.
- Le choix est **propre à chaque appareil**. Il est gardé dans le stockage local du navigateur : le Mac peut être en Mode Local pendant que le téléphone est en Mode Online. En navigation privée, ou si le site ne peut rien stocker, le choix ne vaut que pour la session.
- Le mode actif s'affiche à gauche de la barre de flux (lien vers Paramètres) et dans la puce de source de la Vue d'ensemble, par exemple « Données réelles · OKX EEA · Mode Tour ».
- Sans choix enregistré, le mode par défaut vient de `VITE_DEFAULT_MODE` (variable de build). Sinon, il dépend de l'adresse de la page : « Local » sur `localhost`, « Online » ailleurs, donc sur Vercel.

Adresses acceptées pour une passerelle : `https://…` partout, `http://` seulement vers la machine elle-même (`localhost`, `127.0.0.1`). Une page https ne peut joindre en clair que localhost, et rien d'autre ne doit circuler en clair.

---

## Mode Online

```text
navigateur (Vercel : https://<projet>.vercel.app)
 ├─ worker ── WebSocket ──────────────► wss://wseea.okx.com/ws/v5/public, /business   (OKX EEA)
 │            trades, ticker, funding, open interest, bougies 1 min
 └─ fetch même origine ─► fonctions Vercel api/*.ts (région cdg1, Paris)
                           ├─ /api/chart, /api/instruments, /api/okx-time ─► https://eea.okx.com (REST public)
                           ├─ /api/health
                           └─ /api/collector-health ─► Supabase (clé secrète côté serveur)
                                                         ▲
Supabase (projet dédié, région Europe)                   │ journal
  pg_cron, chaque minute ─► Edge Function okx-collector ─┘ ─► REST public OKX EEA
```

**Ce qui tourne où.**

- **Navigateur** : `web/src/data/sources/okxSource.ts`, dans le worker. Il s'abonne aux mêmes canaux que la passerelle et produit les mêmes clés : `ticker:`, `trade:`, `funding:`, `oi:`, `candle:1m:`, `feed:`, `clock:okx`, `gaps:okx`. Il gère lui-même le maintien en vie (`ping` après 20 s de silence), la reconnexion (1 à 30 s, avec gigue) et le journal des trous.
- **Vercel** : le front statique (`web/dist`) et cinq fonctions, `api/chart.ts`, `api/instruments.ts`, `api/okx-time.ts`, `api/health.ts` et `api/collector-health.ts`. Elles existent parce que le REST d'OKX refuse le CORS, et parce que Vercel ne garde pas de WebSocket ouverte. Logique et tests dans `api/_lib/` et `api/_tests/`.
- **Supabase** : l'Edge Function `okx-collector`, appelée chaque minute par pg_cron et pg_net (`supabase/cron.sql`). Elle écrit `okx_snapshots`, `okx_candles_1m`, `collector_runs` (journal) et `collector_gaps` (minutes manquantes). Tout est décrit dans `supabase/README.md`.

### Mise en place

1. **Supabase** : suivre `supabase/README.md` de bout en bout. Il faut un projet dédié en région Europe, la migration, le secret d'appel `COLLECTOR_SECRET`, le déploiement de la fonction, puis `cron.sql`. Garder l'URL du projet et la clé secrète `sb_secret_…` pour l'étape suivante.
2. **Projet Vercel** (vercel.com → *Add New → Project*, importer le dépôt `Drexoune/terminal-trading`). Les noms de menus et de réglages ci-dessous viennent de la doc Vercel lue avant ce chantier : vercel.com n'était pas joignable depuis l'environnement de développement, ils sont donc à vérifier au déploiement.
   - *Root Directory* : la racine du dépôt. `vercel.json` y fixe l'installation (`cd web && npm ci`), la construction (`npm run build && npm run check:bundle`), le dossier publié (`web/dist`) et la région des fonctions (`cdg1`). *Framework Preset* : Other.
   - *Node.js Version* : 22.x.
   - Déployer par l'import Git (chaque push). Un `vercel deploy` lancé depuis le Mac marche aussi : `.vercelignore` n'envoie ni `.env`, ni les dossiers inutiles au front et aux fonctions. Ses motifs sont ancrés à la racine (`/scripts/`), sans quoi `web/scripts/check-bundle.mjs`, appelé par la construction, serait retiré.
   - *Environment Variables*, côté serveur uniquement, jamais préfixées `VITE_` :
     - `SUPABASE_URL` = `https://<ref>.supabase.co` ;
     - `SUPABASE_SECRET_KEY` = la clé secrète, à marquer *Sensitive*.

     Sans elles, tout marche sauf l'état du collecteur (« collecteur non configuré »).
   - Variables publiques facultatives : `VITE_DEFAULT_MODE`, inutile sur Vercel puisque le défaut y est déjà « online ». Laisser `VITE_TOUR_GATEWAY_URL` vide : posée au build, l'adresse de la tour serait lisible dans le bundle public. La saisir plutôt dans Paramètres, sur chaque appareil.
   - *Deployment Protection* : l'activer (Vercel Authentication) pour que l'interface et les fonctions ne soient pas publiques. Les déploiements couverts dépendent de l'offre Vercel (à vérifier).
3. **Vérifier** :
   - `https://<projet>.vercel.app/api/health` doit répondre `"mode": "online"`, `"host": "vercel"` et `"fn_region": "cdg1"` ;
   - `/api/collector-health` doit répondre `"configured": true`, avec un `age_ms` inférieur à 3 minutes ;
   - dans le terminal : Paramètres → Mode Online → **Tester**.

### En développement

```bash
python scripts/dev.py --mode online          # Vite seul ; /api/* servies par Vite (web/vite-plugins/api-dev.ts)
```

- Les fonctions tournent dans le serveur de Vite, avec le même code que sur Vercel. `SUPABASE_URL` et `SUPABASE_SECRET_KEY` se lisent dans le `.env` de la racine et restent côté serveur. Elles sont facultatives.
- **Derrière un proxy**, `fetch` de Node ne suit le proxy que si `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21). `dev.py` la pose seul quand `HTTPS_PROXY` est défini. Un proxy qui réécrit le TLS demande aussi `NODE_EXTRA_CA_CERTS=<certificat.pem>` dans l'environnement du shell.
- `--mode online` n'est qu'un défaut. Si ce navigateur a déjà enregistré un autre mode, choisir Mode Online dans Paramètres.

### Limites

- **Pas de passerelle.** La latence affichée va d'OKX au navigateur : heure de réception corrigée sur l'horloge d'OKX (`/api/okx-time`, plus court aller-retour), moins l'heure OKX du trade. Dans le détail de la latence, les étapes « OKX → passerelle » et « Passerelle → navigateur » affichent « — », avec la raison « pas de passerelle en Mode Online ».
- **Le temps réel vit dans l'onglet.** Onglet fermé, plus de flux. Chaque appareil ouvre ses deux connexions OKX. En arrière-plan, le navigateur peut ralentir les minuteries : un ping en retard coûte au pire une reconnexion.
- **Le collecteur Supabase est à la minute.** Il relève un instantané et les bougies closes. Il surveille et garde une trace, mais n'alimente pas l'écran en temps réel. À partir de deux passages manqués, les minutes perdues apparaissent dans `collector_gaps`.
- Les bougies passent par un cache CDN de 15 s. L'adresse IP de sortie des fonctions est partagée, et les limites de débit d'OKX par IP s'y appliquent.
- L'offre gratuite de Supabase peut mettre en pause un projet inactif, et limite le nombre de projets actifs (voir `supabase/README.md`, « Coût »).
- Cela dépend d'un comportement observé le 20/10/2026 : OKX accepte les WebSockets ouvertes depuis une page web (`docs/okx.md`).

---

## Mode Local

```text
Mac
 ├─ passerelle Python  http://127.0.0.1:8710    scripts/dev.py, ou agent launchd deploy/macos
 │    └─ collecteur OKX (dans le même process) ──► OKX EEA (WebSocket + REST)
 └─ navigateur : http://localhost:5173 (Vite) ou https://<projet>.vercel.app
       └─ WebSocket ws://127.0.0.1:8710/ws, REST http://127.0.0.1:8710/api/…
```

La passerelle est celle de la tour, avec le même code. Elle annonce `"mode_hint": "local"` et le nom du Mac dans `/api/health` et `gateway:meta`.

### Mise en place

1. Une fois : `python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`, puis, facultatif, `cp .env.example .env`.
2. Au choix :
   - **pendant le développement** : `python scripts/dev.py` (`--mode local` par défaut) lance la passerelle et Vite, puis ouvrir http://localhost:5173. Si une passerelle répond déjà sur le port, par exemple celle de l'agent, `dev.py` ne lance que Vite. `python scripts/dev.py --demo` lance la passerelle de démonstration (données de la maquette, ports 8790 et 5174) ;
   - **en permanence** : `deploy/macos/installer-local.sh` installe un agent launchd utilisateur. Il lance la passerelle à chaque ouverture de session et la relance après un plantage. Arrêt propre : `deploy/macos/arreter-local.sh`. Détails : `deploy/macos/README.md`.
3. **Avec le front de Vercel** : ajouter son domaine aux origines autorisées du Mac, dans `.env`, puis relancer la passerelle :

   ```bash
   GATEWAY_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://<projet>.vercel.app
   ```

   La page Vercel est en https et joint `http://127.0.0.1`, ce que les navigateurs admettent pour localhost. Chrome peut demander l'autorisation d'accéder au réseau local : l'accorder. Safari reste à vérifier.
4. Dans le terminal : Paramètres → Mode Local → **Tester** → **Appliquer**.

### Limites

- **S'arrête quand le Mac dort.** Au réveil, les flux se reconnectent seuls ; les trous restent visibles dans la barre de flux et dans `logs/okx-gaps.jsonl`. Aucune inhibition de la veille n'est prévue : le suivi 24 h/24 passe par le Mode Tour ou le Mode Online.
- Ne sert que ce Mac : les autres appareils ne joignent pas `127.0.0.1`.
- L'agent tourne en priorité basse (`ProcessType = Background`) : à mesurer si la latence se dégrade quand le Mac est chargé.

---

## Mode Tour

```text
tour Windows (24 h/24)
 ├─ passerelle Python  http://127.0.0.1:8710    deploy/windows/superviser-passerelle.ps1 (tâche planifiée)
 │    └─ collecteur OKX ──► OKX EEA
 └─ tailscale serve : https://<tour>.<tailnet>.ts.net ──► http://127.0.0.1:8710   (HTTPS et WSS, certificat *.ts.net)

appareil du tailnet (Mac, téléphone) avec Tailscale connecté
 └─ navigateur : https://<projet>.vercel.app, ou http://localhost:5173
       └─ wss://<tour>.<tailnet>.ts.net/ws, https://<tour>.<tailnet>.ts.net/api/…
```

### Mise en place sur la tour

1. Dépôt et environnement : `python -m venv .venv`, puis `.venv\Scripts\pip install -e .` (Windows natif, décision T-001).
2. `.env` de la tour :

   ```bash
   GATEWAY_MODE=tour
   GATEWAY_HOST=127.0.0.1
   GATEWAY_ALLOWED_ORIGINS=https://<projet>.vercel.app,http://localhost:5173,http://127.0.0.1:5173
   ```

   Le domaine Vercel est indispensable pour le front en ligne. Les origines `localhost:5173` servent au Mac en développement (`dev.py --mode tour`). Les origines sont comparées exactement, sans « / » final. Un déploiement de prévisualisation Vercel, qui a son propre domaine, n'est accepté que s'il est listé.
3. Supervision : une tâche planifiée lance `deploy/windows/superviser-passerelle.ps1`. Le superviseur relance la passerelle après une erreur et lui donne une priorité basse, pour laisser passer les collecteurs de drexbot. Il lit d'abord la configuration avec `python -m terminal_gateway --print-config` : une configuration refusée l'arrête tout de suite avec son message, et le fichier d'arrêt suit `GATEWAY_LOG_DIR`. Arrêt propre : `deploy/windows/arreter-passerelle.ps1`, qui attend ensuite que la passerelle ne réponde plus (20 s au plus). Ces deux scripts n'ont pas pu être exécutés dans l'environnement de développement : à vérifier sur la tour.
4. Publication sur le tailnet, en HTTPS. Activer MagicDNS et les certificats HTTPS dans la console d'administration Tailscale, puis, sur la tour :

   ```powershell
   tailscale serve --bg 8710      # https://<tour>.<tailnet>.ts.net -> http://127.0.0.1:8710
   tailscale serve status
   ```

   La syntaxe de `tailscale serve` a changé selon les versions : à vérifier dans la doc Tailscale au moment de l'installation. Le port 8710 n'est jamais ouvert sur le réseau local ni sur Internet.
5. Vérifier depuis un appareil du tailnet : `https://<tour>.<tailnet>.ts.net/api/health` doit répondre `"mode_hint": "tour"` et le nom de la tour.

### Sur chaque appareil

Installer Tailscale et se connecter au tailnet. Dans le terminal : Paramètres → Mode Tour → saisir `https://<tour>.<tailnet>.ts.net` → **Tester** → **Appliquer**. Sur le Mac en développement : `VITE_TOUR_GATEWAY_URL` dans `.env`, puis `python scripts/dev.py --mode tour`.

### Limites

- **Dépend de Tailscale** : un appareil sans Tailscale, ou déconnecté du tailnet, affiche « — » et « Passerelle déconnectée ». Il peut passer en Mode Online.
- La tour doit être allumée. Ses services sont plafonnés pour laisser la priorité à drexbot (règle d'intégration 5).
- Chrome peut demander l'accès au réseau local quand une page publique joint une adresse Tailscale (100.64.0.0/10). Point à vérifier, déjà noté en T-004.

---

## Variables d'environnement

Liste complète et commentée : `.env.example`.

| Composant | Variables | Où les poser |
| --- | --- | --- |
| Passerelle (Local, Tour) | `OKX_REGION`, `OKX_INSTRUMENTS`, `GATEWAY_HOST`, `GATEWAY_PORT`, `GATEWAY_ALLOWED_ORIGINS`, `GATEWAY_LOG_DIR`, `GATEWAY_MODE` | `.env` de la machine qui la fait tourner |
| Front (public, dans le bundle) | `VITE_DEFAULT_MODE`, `VITE_LOCAL_GATEWAY_URL`, `VITE_TOUR_GATEWAY_URL` | `.env` en local ; variables du projet Vercel au build |
| Fonctions Vercel (serveur) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | variables du projet Vercel ; `.env` en développement |
| Edge Function Supabase | `COLLECTOR_SECRET`, `OKX_INSTRUMENTS` (facultatif) | `supabase secrets set` ; jamais dans `.env` |

`VITE_GATEWAY_URL` n'existe plus. Elle est remplacée par `VITE_LOCAL_GATEWAY_URL` et `VITE_TOUR_GATEWAY_URL`, et `scripts/dev.py` signale sa présence.

## Dépannage

| Symptôme | Mode | Cause probable | Action |
| --- | --- | --- | --- |
| « Passerelle déconnectée » | Local | passerelle arrêtée, ou Mac sorti de veille depuis peu | `curl -s http://127.0.0.1:8710/api/health` ; relancer `dev.py` ou `deploy/macos/installer-local.sh` |
| « Passerelle déconnectée » sur la page Vercel, mais `/api/health` répond | Local, Tour | origine Vercel absente de `GATEWAY_ALLOWED_ORIGINS` (la WebSocket est refusée, code 1008) | ajouter le domaine exact, sans « / » final, puis relancer la passerelle |
| « Tester » : injoignable | Tour | Tailscale déconnecté, tour éteinte, `tailscale serve` inactif | `tailscale status` sur l'appareil, `tailscale serve status` sur la tour |
| « adresse refusée » dans Paramètres | Local, Tour | adresse en `http://` vers une autre machine | utiliser l'adresse `https://…ts.net` de `tailscale serve` |
| « OKX déconnecté » | Online | réseau, ou WebSocket OKX coupée | se reconnecte seul (1 à 30 s) ; état détaillé au survol de « OKX WS » |
| Graphique vide, `/api/chart` en 502 | Online | REST OKX injoignable depuis la fonction, ou limite de débit | réessayer ; journal de la fonction dans Vercel |
| « collecteur non configuré » | Online | `SUPABASE_URL` ou `SUPABASE_SECRET_KEY` absente sur Vercel | les poser, puis redéployer |
| Collecteur « périmé » (plus de 3 min) | Online | tâche pg_cron suspendue, secret d'appel différent, projet en pause | requêtes de vérification de `supabase/README.md`, étape 8 |
| `dev.py --mode online` : `/api/*` en 502 derrière un proxy | Online | Node ne suit pas le proxy | `NODE_USE_ENV_PROXY=1`, et `NODE_EXTRA_CA_CERTS` si le proxy réécrit le TLS |
| Le mode ne change pas après `dev.py --mode …` | tous | ce navigateur a déjà un mode enregistré, qui prime | choisir le mode dans Paramètres |
| `GATEWAY_MODE invalide` ou `origine invalide` au démarrage | Local, Tour | valeur refusée dans `.env` | `GATEWAY_MODE` = `local`, `tour` ou vide ; origines `https://hote[:port]` |
