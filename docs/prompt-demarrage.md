# Prompts pour Claude Code

À coller dans Claude Code, lancé à la racine du dossier (`cd ~/Projects/terminal-trading` puis `claude`). Un prompt par phase ; ne lancer le suivant qu'une fois la porte de la phase en cours passée.

## Phase 0 — premier lancement

```text
Lis CLAUDE.md, puis docs/plan.md, docs/ecrans.md, docs/design-system.md et docs/integration-drexbot.md. Regarde les captures design/maquettes/png/Main.png et design/maquettes/png/DesignSystem.png.

Avant d'écrire du code :
1. Pose-moi les 6 questions de la section 5 de CLAUDE.md, une par une, avec ta recommandation. Consigne mes réponses datées dans docs/decisions.md.
2. Propose le plan de la phase P0 : arborescence, dépendances, étapes vérifiables, tests, et la façon dont tu compares chaque écran à sa maquette.

Attends mon accord sur le plan. Ensuite, implémente P0 étape par étape. Après chaque étape d'interface, lance le front, capture l'écran à 1440 px avec Playwright et compare-le à design/maquettes/png/Main.png ; corrige les écarts avant de continuer. Termine en me montrant que la porte de P0 est passée.
```

## Phase 1 — calendrier et actus

```text
Passe à la phase P1. Relis la porte de P1 dans CLAUDE.md, docs/ecrans.md (sections 2 et 3, partie fil), et dans docs/plan.md les sections « Calendrier économique » et « Autres modules » (News Feed, Squawk, alertes).

Propose le plan : sources (agenda + consensus, chiffre réel à la source), schéma de la table releases (première publication et révisions séparées), capture à l'heure H, calcul de la surprise z, fil d'actus traduit titre par titre, alertes. Indique comment tu mesures le délai entre la publication officielle et l'affichage. Attends mon accord, puis implémente et compare les écrans à Calendrier.png et Actus.png.
```

## Phase 2 — taux

```text
Passe à la phase P2. Relis docs/ecrans.md section 4 et la section « Probabilités de taux » de docs/plan.md. Vérifie dans la documentation officielle les API Polymarket et Kalshi (endpoints, limites, conditions d'usage) avant d'écrire quoi que ce soit, avec un script d'exploration. Propose le plan (collecte chaque minute, table probabilities, trajectoire implicite, alerte d'écart entre sources, votes des comités), attends mon accord, puis implémente et compare à Taux.png.
```

## Phase 3 — macro et heatmap

```text
Passe à la phase P3. Relis docs/ecrans.md section 5 et la section « Heatmap fondamentale » de docs/plan.md. Commence par le backfill DBnomics et BIS et par un test du score sur l'historique (le score anticipe-t-il les mouvements des devises à 1 et 3 mois ?). Montre-moi le résultat du test avant de construire l'écran. Ensuite seulement, implémente l'écran et compare-le à Heatmap.png.
```

## Phases suivantes

```text
Passe à la phase P4 (puis P5, P6, P7). Relis la section correspondante de docs/ecrans.md, de docs/plan.md et de docs/integration-drexbot.md. Propose le plan, attends mon accord, implémente, compare à la maquette (Risque.png, Microstructure.png) et montre-moi que la porte est passée.
```
