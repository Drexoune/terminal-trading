# Intégration avec le bot `drexbot`

Le terminal et le bot BTC tournent sur les mêmes machines. Le bot est le projet le plus avancé et le plus sensible : **le terminal lit le bot, jamais l'inverse**, et rien dans le terminal ne doit pouvoir gêner sa collecte.

État relevé le 19/10/2026 sur `github.com/Drexoune/drexbot` (privé, branche par défaut, commit `796c152`). Relire le dépôt avant de s'appuyer sur un détail : il évolue.

## Ce qui existe dans drexbot

| Sujet | État |
| --- | --- |
| Avancement | phase 1 terminée (lac de trades agrégés, fenêtre de trading décidée), phase 2 en cours (états de compensation Hyperliquid). Pas de stratégie testée, pas d'exécution. |
| Langage et stockage | Python ≥ 3.11 (3.14 sur la tour), process persistants, **DuckDB + Parquet**, pas de base serveur (choix assumé dans son `CLAUDE.md`). |
| Machines | tour Windows = `DREXBOT_ROLE=collector`, seule source de vérité, **Python natif sans WSL** d'après `docs/deploiement.md` (tâches planifiées sous SYSTEM + `superviser-service.ps1`). Mac = `analyst`, lit une copie tirée de la tour par SFTP + rclone (`deploy/bin/copier-depuis-la-tour.sh`, lancé par launchd). Le code refuse d'écrire ailleurs que sur le collecteur. |
| Lac de trades | `<DREXBOT_DATA_DIR>/agg_trades/market=um/symbol=BTCUSDT/dt=YYYY-MM-DD/*.parquet`, trades agrégés Binance USDⓈ-M depuis le 31/12/2019 (~24 Go, ~3,4 milliards de lignes). Colonnes : `agg_trade_id`, `ts_ms`, `price`, `qty` (BTC), `first_trade_id`, `last_trade_id`, `is_buyer_maker`, `ingest_ts_ms`, `src`. |
| Hyperliquid | `hl-watch` (registre d'adresses, permanent), `hl-snapshot` (cliché horaire, ~155 Mo/jour), `hl-map` (carte du « carburant » : notionnel liquidable par palier de prix, CSV + PNG + JSON daté du cliché, avec l'open interest du moment). |
| Analyses | `drexbot profile`, `session-checks`, `candles` (bougies 1 min en CSV), `status`, `check-gaps`, `hl-coverage`, `hl-status`. |
| Tableau de bord | publieur `python -m drexbot.publish` → Supabase → page statique Vite sur Vercel (drexbot.vercel.app), lecture seule, statut de fraîcheur par bloc. |
| Fenêtre de trading | D-001 : **09:30 → 13:30 America/New_York**, figée le 20/09/2026, encodée dans `src/drexbot/session.py`. |

Incohérence à signaler : `drexbot/CLAUDE.md` parle encore d'un hébergement macOS et `dashboard/README.md` d'une tour sous WSL2, alors que `docs/deploiement.md` décrit une tour Windows native. Faire confirmer par Clément avant de figer l'architecture du terminal.

## Règles d'intégration

1. **Dépôt séparé.** Le terminal vit dans `terminal-trading`, pas dans drexbot. Aucune modification de drexbot depuis ce projet ; une évolution nécessaire côté bot se propose à Clément et se fait dans son dépôt.
2. **Lecture seule.** Le terminal lit le lac et les sorties de drexbot (Parquet via DuckDB, JSON de `hl-map`, journaux de décision plus tard). Il n'écrit jamais dans le répertoire de données du bot et ne définit jamais `DREXBOT_ROLE=collector`.
3. **Pas de collecteur en double.** Un jeu de données que drexbot collecte déjà (trades agrégés Binance, clichés Hyperliquid) ne se collecte pas une seconde fois pour être stocké. Les flux d'**affichage** temps réel du terminal (OKX, Binance, Bybit, Hyperliquid) sont autorisés : ils alimentent l'écran, pas un second historique concurrent.
4. **Le bot ne lit pas le bus du terminal.** Le plan initial l'envisageait ; on y renonce. Le bot garde ses propres collecteurs et sa propre vérité, ce qui respecte sa règle : deux process séparés, et un crash ne doit jamais trouer l'historique.
5. **Ressources de la tour.** Les services du terminal tournent comme process séparés, journalisés à part, avec des plafonds mémoire et CPU qui garantissent la priorité aux collecteurs du bot. Ils s'arrêtent proprement et redémarrent seuls (reprendre les patrons de drexbot : superviseur, fichier d'arrêt, contrôle d'horloge).
6. **Données interdites, mêmes règles.** Pas de niveaux de liquidation estimés (Coinglass et équivalents) ni de cartes de stops inférées : seulement des données observées. Le flux de liquidations Binance est un plancher, jamais un total.

## Ce que le terminal peut réutiliser

- **Microstructure (P5)** : la carte Hyperliquid de `hl-map` (JSON) peut devenir un panneau « Liquidations réelles par palier » à côté de la carte de profondeur ; l'historique du lac permet un profil de volume et un CVD long terme.
- **Graphiques** : afficher la fenêtre de trading du bot (D-001) comme bande sur les graphiques BTC, lue depuis drexbot plutôt que recopiée en dur.
- **Compte (P6)** : le journal de décision et les digests de session du bot (format JSONL décrit dans `drexbot/CLAUDE.md` §7), quand ils existeront, alimentent le Track record en lecture seule.
- **Code** : contrôle d'horloge (`runtime/clock.py`), TLS et proxy (`net.py`), arrêt par fichier (`runtime/shutdown.py`), scripts de supervision Windows (`deploy/windows/`). S'en inspirer ; ne pas importer drexbot comme dépendance tant que Clément ne l'a pas décidé.
