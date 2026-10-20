# TERMINAL — terminal de trading personnel

Kit de démarrage pour Claude Code : brief, plan, spécifications d'écrans, design system et maquettes. Le dossier ne contient pas encore de code ; Claude Code le construit phase par phase à partir de `CLAUDE.md`.

## Démarrer

1. Ouvrir un terminal dans ce dossier : `cd ~/Projects/terminal-trading`
2. Conseillé : `git init` pour suivre les changements dès le premier fichier.
3. Lancer Claude Code : `claude`
4. Coller le prompt « Phase 0 » de `docs/prompt-demarrage.md`. Claude Code commence par poser les 6 décisions ouvertes (section 5 de `CLAUDE.md`), puis propose le plan de P0 avant d'écrire du code.

## Contenu

```text
terminal-trading/
├── CLAUDE.md                     brief pour Claude Code (règles, stack, décisions, phases)
├── README.md
├── docs/
│   ├── plan.md                   plan complet (export du doc du 19/10/2026)
│   ├── ecrans.md                 spécification des 8 écrans
│   ├── design-system.md          DA, tokens, composants, accessibilité
│   ├── integration-drexbot.md    ce qui existe dans le bot et comment s'y brancher
│   └── prompt-demarrage.md       prompts à coller, phase par phase
└── design/
    ├── tokens.css, tokens.json   tokens du design system
    ├── assets/fonts/             Rajdhani, Barlow, JetBrains Mono (SIL OFL) + fonts.css
    ├── assets/flags/             drapeaux des 9 devises (SVG simplifiés)
    └── maquettes/
        ├── png/                  captures pleine page à 1440 px
        ├── html/                 pages statiques ouvrables dans un navigateur
        └── source/               sources .dc.html du canvas Design
```

## Liens

- [Canvas des maquettes](https://claude.ai/artifact/9EN2hxGmBrmbEBgaN9mjWy) (interactif, mode Play)
- [Plan d'origine](https://claude.ai/code/artifact/5f934f1b-a55d-47a8-abbc-7bcbde7db10b) (Claude Docs)
- [Bot BTC drexbot](https://github.com/Drexoune/drexbot)

Toutes les données des maquettes sont fictives.
