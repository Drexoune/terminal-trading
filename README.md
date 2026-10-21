# TERMINAL — terminal de trading personnel

Terminal personnel (BTC d'abord, macro des 8 devises ensuite), construit phase par phase à partir de `CLAUDE.md`. Usage strictement personnel. Le terminal ne passe jamais d'ordre et n'a besoin d'aucune clé d'exchange : toutes les données OKX utilisées sont publiques.

État : **P0 — socle temps réel** (BTC en direct, latence affichée, horloges, palette de commandes), utilisable dans trois modes de fonctionnement. Décisions dans `docs/decisions.md`.

## Modes de fonctionnement

Le mode dit où tourne le moteur de données. Il se choisit **sur chaque appareil**, dans le terminal : avatar en haut à droite → **Paramètres**, ou `Ctrl K` → `SET`. Guide complet, mise en place et dépannage : [`docs/modes.md`](docs/modes.md).

| Mode | Moteur | À lancer chez soi | Pour |
| --- | --- | --- | --- |
| **Online** | navigateur ↔ WebSockets OKX ; fonctions Vercel (`api/`) pour le REST ; collecteur planifié dans Supabase (`supabase/`) | rien | le téléphone, tout appareil, la tour éteinte |
| **Local** | passerelle Python sur le Mac, `http://127.0.0.1:8710` | `scripts/dev.py` ou l'agent launchd `deploy/macos/` | le développement, le Mac seul |
| **Tour** | passerelle Python sur la tour Windows, jointe par Tailscale en https | `deploy/windows/` et `tailscale serve` sur la tour | le suivi 24 h/24 sur les appareils du tailnet |

## Lancer en local

Prérequis : Python ≥ 3.11 et Node.js ≥ 22.

```bash
python -m venv .venv
.venv/bin/pip install -e '.[dev]'          # Windows : .venv\Scripts\pip install -e .[dev]
cp .env.example .env                       # facultatif : valeurs par défaut correctes pour un compte EEA
python scripts/dev.py                      # Mode Local : passerelle :8710 + front :5173
```

Ouvrir http://localhost:5173. `Ctrl K` (ou `/`) ouvre la palette : `BTC GP`, `USD ECO`, `FED WIRP`, `SET`…

| Commande | Ce qui est lancé |
| --- | --- |
| `python scripts/dev.py` (ou `--mode local`) | passerelle (OKX réel) et Vite ; si une passerelle répond déjà sur le port (agent launchd), Vite seul |
| `python scripts/dev.py --mode online` | Vite seul ; les fonctions `api/*.ts` sont servies par Vite (`web/vite-plugins/api-dev.ts`). Derrière un proxy, `dev.py` pose `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) |
| `python scripts/dev.py --mode tour` | Vite seul, branché sur la tour ; exige `VITE_TOUR_GATEWAY_URL` (`https://<tour>.<tailnet>.ts.net`) |
| `python scripts/dev.py --demo` | passerelle de démonstration (données fictives de la maquette, ports 8790 et 5174), pour les tests |

`--mode` ne fixe que le mode par défaut (`VITE_DEFAULT_MODE`) : un mode déjà choisi dans Paramètres sur ce navigateur prime.

Pour avoir la passerelle du Mac dès l'ouverture de session : `deploy/macos/installer-local.sh`. Arrêt propre : `deploy/macos/arreter-local.sh`. Voir [`deploy/macos/README.md`](deploy/macos/README.md).

## Variables d'environnement

Toutes documentées dans `.env.example`. Aucune n'est obligatoire en Mode Local.

| Composant | Variables |
| --- | --- |
| Passerelle (`.env` de la machine) | `OKX_REGION`, `OKX_INSTRUMENTS`, `GATEWAY_HOST`, `GATEWAY_PORT`, `GATEWAY_ALLOWED_ORIGINS` (y ajouter le domaine Vercel), `GATEWAY_LOG_DIR`, `GATEWAY_MODE` (`local` ou `tour`) |
| Front, public : tout `VITE_` entre dans le bundle | `VITE_DEFAULT_MODE`, `VITE_LOCAL_GATEWAY_URL`, `VITE_TOUR_GATEWAY_URL` |
| Fonctions Vercel, côté serveur seulement | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` |
| Edge Function Supabase, via `supabase secrets set` | `COLLECTOR_SECRET`, `OKX_INSTRUMENTS` (facultatif) |

L'ancienne `VITE_GATEWAY_URL` est remplacée par `VITE_LOCAL_GATEWAY_URL` et `VITE_TOUR_GATEWAY_URL`.

## Architecture

Modes Local et Tour :

```text
OKX EEA (WebSocket publique + REST)                         navigateur
  └─ collectors/terminal_collectors/okx    ─┐               web/ (React + Vite)
       ws.py : maintien en vie, reconnexion  │  bus mémoire   └─ worker : décodage, latence,
       gaps.py : trous de séquence           ├─ gateway/  ───── WebSocket /ws ── lots à 15 i/s
       rest.py : instruments, bougies        │  FastAPI        └─ écrans, palette, horloges
                                             ┘  /api/chart, /api/health
```

Mode Online :

```text
OKX EEA ── WebSocket publique ───────────────────────────► navigateur : worker (okxSource.ts)
        ── REST public ──► fonctions Vercel api/*.ts (cdg1) ──► même origine que le front
        ── REST public ──► Edge Function Supabase okx-collector (chaque minute, pg_cron)
                              └─ Postgres : instantanés, bougies, journal ──► /api/collector-health
```

- Un seul process Python par machine en Modes Local et Tour : la passerelle héberge le collecteur et garde le dernier état en mémoire (décision T-002). Elle annonce sa machine et son mode dans `/api/health`.
- En Mode Online, le navigateur fait lui-même le travail du collecteur, avec les mêmes clés de données. Le front n'appelle jamais Supabase.
- Chaque donnée porte `ts_source` (heure OKX) et `ts_recv` (réception). La latence affichée suit le trajet trade OKX → écran ; le détail apparaît au survol de la puce `OKX … ms`.
- L'horloge est contrôlée contre OKX : par la passerelle en Modes Local et Tour, par le navigateur via `/api/okx-time` en Mode Online.

## Tests

```bash
.venv/bin/pytest -q                        # collecteur, passerelle, scripts/dev.py, agent launchd (simulé)
for f in deploy/macos/*.sh; do bash -n "$f"; done   # syntaxe des scripts du Mac
cd web
npm test                                   # front, fonctions Vercel (api/) et collecteur Supabase (supabase/functions/)
npm run build && npm run check:bundle      # aucun secret dans le bundle public
npx playwright test                        # comparaison aux maquettes, 390 px, palette, Paramètres, accessibilité
```

Playwright compare chaque écran à sa maquette :
- **géométrie** des repères, mesurée sur `design/maquettes/html/*.html` et sur l'application ; elle doit coller à ±2 px, sinon le test échoue ;
- **pixels** contre `design/maquettes/png/*.png`, à titre indicatif.

Les images côte à côte et d'écart sont écrites dans `web/e2e/__artifacts__/`. Dans le conteneur cloud, préfixer avec `PW_CHROMIUM=/opt/pw-browsers/chromium`.

Test en direct de la porte P0, passerelle et front lancés :

```bash
cd web && E2E_LIVE=1 E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/live.spec.ts
```

## Déploiement

- **Front et fonctions sur Vercel** (décisions T-004 et T-013) : `vercel.json` à la racine. Il fixe la construction de `web/`, les fonctions `api/` et la région `cdg1`. Variables du projet : `SUPABASE_URL` et `SUPABASE_SECRET_KEY`, côté serveur. Activer la protection de déploiement pour que l'interface ne soit pas publique. Pas à pas : `docs/modes.md`, « Mode Online ».
- **Collecteur du Mode Online sur Supabase** (T-012) : projet dédié en région Europe. Pas à pas : `supabase/README.md`.
- **Passerelle sur la tour** (Windows natif, T-001) : `deploy/windows/superviser-passerelle.ps1`, lancé par une tâche planifiée. Il relance la passerelle en cas d'erreur et lui donne une priorité basse, pour laisser passer les collecteurs du bot. Arrêt propre : `deploy/windows/arreter-passerelle.ps1`. La passerelle se publie sur le tailnet par `tailscale serve`. Le `.env` de la tour contient `GATEWAY_MODE=tour`, ainsi que le domaine Vercel dans `GATEWAY_ALLOWED_ORIGINS`.
- **Passerelle sur le Mac** (T-014) : agent launchd, `deploy/macos/installer-local.sh`.

## Contenu

```text
CLAUDE.md                 brief (règles, stack, décisions, phases)
docs/                     plan, écrans, design system, intégration drexbot, décisions, notes OKX, modes
design/                   tokens, polices, drapeaux, maquettes (png, html, source)
collectors/               collecteurs Python (OKX en P0) et leurs tests
gateway/                  passerelle FastAPI et ses tests (dont scripts/dev.py et l'agent launchd)
web/                      front React + Vite + TypeScript, tests Vitest et Playwright
api/                      fonctions Vercel du Mode Online (_lib/ : logique, _tests/ : tests Vitest)
supabase/                 collecteur du Mode Online : migration, Edge Function okx-collector, cron.sql
scripts/                  dev.py (tout lancer, --mode online|local|tour), explore_okx.py (exploration de l'API)
deploy/windows/           supervision de la passerelle sur la tour
deploy/macos/             agent launchd de la passerelle sur le Mac (Mode Local)
vercel.json, package.json configuration Vercel ; modules ES des fonctions api/
```

Les chiffres des maquettes sont fictifs : ils ne servent qu'aux tests de comparaison, jamais de valeurs par défaut.
