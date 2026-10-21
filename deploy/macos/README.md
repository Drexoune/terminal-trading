# Mode Local sur le Mac : passerelle au démarrage de session

Ce dossier fait tourner la passerelle Python du terminal sur le Mac, sans terminal ouvert, comme **agent launchd utilisateur** (décision T-014). Le Mode Local est alors disponible dès l'ouverture de session, avec le front de Vercel comme avec `scripts/dev.py`. Les trois modes sont décrits dans [`docs/modes.md`](../../docs/modes.md).

| Fichier | Rôle |
| --- | --- |
| `com.terminal-trading.gateway.plist.template` | modèle de la plist de l'agent ; les chemins réels y sont écrits à l'installation |
| `installer-local.sh` | génère la plist, la charge (`launchctl bootstrap`), vérifie `/api/health` ; rejouable |
| `arreter-local.sh` | arrêt **propre** : fichier d'arrêt, attente, puis `launchctl bootout` |
| `desinstaller-local.sh` | arrêt propre, puis suppression de la plist : plus de démarrage à l'ouverture de session |
| `_commun.sh` | fonctions partagées par les trois scripts (sourcé, jamais lancé seul) |

## Ce que fait l'agent

- **Label** `com.terminal-trading.gateway`, installé dans `~/Library/LaunchAgents/`.
- Lance `<dépôt>/.venv/bin/python -m terminal_gateway` depuis la racine du dépôt, avec `GATEWAY_MODE=local`. `/api/health` et l'écran Paramètres disent alors « Mode Local » et le nom du Mac.
- **Démarre** à l'installation et à chaque ouverture de session (`RunAtLoad`).
- **Relance** la passerelle après un plantage (code de sortie non nul), au plus une fois toutes les 30 s (`ThrottleInterval`). Ne la relance **jamais après un arrêt propre** : code 0, obtenu par le fichier d'arrêt (`KeepAlive` → `SuccessfulExit = false`).
- Priorité basse (`ProcessType = Background`) : l'usage du Mac passe devant.
- Même fichier d'arrêt que sur la tour : `<GATEWAY_LOG_DIR>/_control/gateway.stop` (par défaut `logs/_control/gateway.stop`). La passerelle le surveille chaque seconde et l'efface à son démarrage.

Le reste de la configuration vient du `.env` de la racine, comme pour `scripts/dev.py` : port, origines autorisées, instruments. Le `GATEWAY_MODE=local` de l'agent prime sur celui du `.env`.

## Prérequis

1. Python ≥ 3.11 et l'environnement du dépôt :

   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -e '.[dev]'
   ```

2. Le dépôt **hors des dossiers protégés** par macOS : Documents, Bureau, Téléchargements et iCloud Drive. Un agent launchd n'y a pas accès sans autorisation dans *Réglages Système → Confidentialité et sécurité* (à vérifier sur le Mac). Conseillé : `~/Projects/terminal-trading`. L'installation prévient si le dépôt est dans l'un de ces dossiers.
3. Pour ouvrir le front de **Vercel** en Mode Local, ajouter son domaine aux origines autorisées, dans le `.env` du Mac :

   ```bash
   GATEWAY_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://<projet>.vercel.app
   ```

## Installer et démarrer

Depuis le Terminal de la session ouverte, pas en SSH (l'agent vit dans la session graphique) :

```bash
deploy/macos/installer-local.sh
```

Le script :

1. vérifie `.venv` et la configuration ;
2. refuse de continuer si une autre passerelle occupe déjà le port, par exemple `scripts/dev.py` ;
3. écrit la plist et la contrôle avec `plutil -lint` ;
4. charge l'agent ;
5. attend `/api/health`, 45 s au plus, et affiche la machine, le mode annoncé et l'état des flux OKX.

Ensuite, dans le terminal : avatar → **Paramètres** → **Mode Local** → **Tester**, puis **Appliquer**.

Voir la plist sans rien installer, sur n'importe quel système :

```bash
deploy/macos/installer-local.sh --afficher
```

## Vérifier

```bash
curl -s http://127.0.0.1:8710/api/health          # "mode_hint": "local", "host": nom du Mac
launchctl print gui/$(id -u)/com.terminal-trading.gateway | grep -E 'state|pid|last exit'
tail -f logs/gateway.log
```

## Arrêter, relancer, mettre à jour, retirer

| But | Commande |
| --- | --- |
| Arrêter maintenant (redémarre à la prochaine ouverture de session) | `deploy/macos/arreter-local.sh` |
| Relancer | `deploy/macos/installer-local.sh` |
| Prendre en compte un `git pull` ou un `.env` modifié | `deploy/macos/installer-local.sh` (arrêt propre puis rechargement) |
| Ne plus lancer la passerelle du tout | `deploy/macos/desinstaller-local.sh` |

Ne jamais arrêter la passerelle par `kill -9`, ni par l'Activity Monitor : un arrêt brutal coupe les flux sans les fermer. Une passerelle tuée par un signal est d'ailleurs relancée par launchd.

`scripts/dev.py` (Mode Local) détecte une passerelle déjà en service sur le port. Dans ce cas, il ne lance que Vite.

## Journaux

- `logs/gateway.log` : journal de la passerelle. Il tourne à minuit UTC et garde 14 jours.
- `logs/gateway-launchd.log` : sorties brutes du process, écrites par launchd. On y trouve surtout ce qui précède le journal : python introuvable, module manquant, configuration refusée. Ce fichier ne tourne pas, mais il reste petit : hors d'un terminal, la passerelle n'écrit son journal que dans `logs/gateway.log`, pas sur sa console. S'il grossit quand même (plantages répétés), le vider avec `: > logs/gateway-launchd.log` : launchd écrit en ajout, ce qui permet de le vider pendant que la passerelle tourne (à vérifier sur le Mac).
- `logs/okx-gaps.jsonl` : trous de séquence des trades OKX.

## Limites

- **La passerelle s'arrête quand le Mac dort.** Au réveil, les flux OKX se reconnectent seuls, avec un délai croissant. Les trous apparaissent dans `logs/okx-gaps.jsonl` et dans la barre de flux. Pour un suivi 24 h/24 : Mode Tour ou Mode Online.
- Le Mode Local ne sert que ce Mac. Le téléphone et les autres appareils utilisent le Mode Online ou le Mode Tour.
- `ProcessType = Background` peut ralentir légèrement la passerelle quand le Mac est chargé. Si la latence affichée se dégrade, passer la clé à `Standard` dans le modèle, puis réinstaller (à mesurer sur le Mac).

## Dépannage

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| `Bootstrap failed: 5: Input/output error` | agent déjà chargé, ou script lancé hors de la session graphique (SSH) | relancer `installer-local.sh` depuis le Terminal de la session |
| `/api/health` ne répond pas après 45 s | python, module ou configuration en erreur | lire `logs/gateway-launchd.log` (le script en affiche la fin) |
| `Operation not permitted` dans `gateway-launchd.log` | dépôt dans un dossier protégé (Documents, Bureau, iCloud) | déplacer le dépôt, puis réinstaller |
| Le terminal de Vercel reste « Passerelle déconnectée » | domaine Vercel absent de `GATEWAY_ALLOWED_ORIGINS`, ou accès au réseau local refusé par le navigateur | ajouter le domaine dans `.env`, réinstaller ; autoriser l'accès au réseau local si Chrome le demande |
| La passerelle redémarre en boucle | plantage au démarrage (port pris, configuration) | `launchctl print gui/$(id -u)/com.terminal-trading.gateway` (dernier code de sortie), puis le journal |
