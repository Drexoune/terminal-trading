# Machine Oracle Cloud — microstructure 24 h/24 (T-069)

Le moteur de la microstructure (`web/src/micro/engine.ts`) tourne sur une machine Oracle Cloud « Always Free ». Plan : étapes O0 à O4, consignées dans `docs/todo.md`.

**Règle absolue : ne jamais passer le compte en « Pay As You Go ».** Un compte resté gratuit ne peut pas être facturé (« Your credit card will not be charged unless you upgrade your account »). Ne créer que des ressources marquées *Always Free-eligible*, dans la région de rattachement.

## O0 — Créer la machine (console Oracle, une fois)

Clé SSH : `~/.ssh/oracle_terminal` sur le Mac (créée le 25/11/2026). Elle ne quitte jamais le Mac et n'entre jamais dans le dépôt. La clé **publique** à coller dans la console :

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMlpHtq1oiIxykaNLRiCUP5QEO2DM4qYrzAJiW7RRLi9 terminal-micro-oracle
```

1. **Réseau.** Menu ☰ → *Networking* → *Virtual cloud networks* → *Start VCN Wizard* → *Create VCN with Internet Connectivity*. Nom : `terminal-vcn`. Laisser les valeurs par défaut → *Create*.
2. **Instance.** Menu ☰ → *Compute* → *Instances* → *Create instance*.
   - **Name** : `terminal-micro`.
   - **Image and shape** → *Edit*.
     - *Change image* : **Canonical Ubuntu 24.04** (pas « Minimal »), architecture **aarch64**.
     - *Change shape* : *Ampere* → **VM.Standard.A1.Flex**, **1 OCPU**, **2 GB** de mémoire. L'étiquette *Always Free-eligible* doit apparaître.
   - **Networking** : *Select existing virtual cloud network* → `terminal-vcn`, puis *Select existing subnet* → le sous-réseau **public** (*public subnet-terminal-vcn*), *Automatically assign public IPv4 address* coché. Ne jamais laisser l'option « créer un sous-réseau » : elle propose `10.0.0.0/24`, qui chevauche le sous-réseau créé par l'assistant (erreur « CIDR 10.0.0.0/24 … overlaps », rencontrée le 25/11/2026). Région de rattachement du compte : eu-marseille-1.
   - **Add SSH keys** : *Paste public keys* → coller la clé publique ci-dessus.
   - **Boot volume** : laisser la taille par défaut (≈ 47–50 Go, dans les 200 Go gratuits).
   - → *Create*. Si « Out of host capacity » s'affiche : réessayer plus tard ou changer d'*availability domain*. Ne jamais choisir une forme payante.
3. **Ports 80 et 443.** Page de l'instance → *Primary VNIC* → lien du *Subnet* → *Security Lists* → *Default Security List…* → *Add Ingress Rules*, deux fois :
   - source `0.0.0.0/0`, protocole TCP, port de destination **80** ;
   - source `0.0.0.0/0`, protocole TCP, port de destination **443**.

   Le port 22 (SSH) est déjà ouvert par défaut.
4. **Adresse IP.** Page de l'instance → *Public IP address*. La transmettre pour O1–O2.

Contrôle depuis le Mac :

```
ssh -i ~/.ssh/oracle_terminal ubuntu@<IP>
```

## Surveillance de l'inactivité

Oracle peut récupérer une instance gratuite si, sur 7 jours, le 95e centile du processeur, le réseau **et** la mémoire restent tous sous 20 %. Avec 2 Go, le système et le service dépassent 20 % de mémoire.

Contrôle : page de l'instance → *Metrics* → *Memory utilization*, la première semaine. `/micro/health` donne aussi la mémoire système en %.

## O2 — Installer et déployer (depuis le Mac)

```
deploy/oracle/deployer.sh <IP> installer   # une fois : Node 22, Caddy, service, ports, mises à jour auto
deploy/oracle/deployer.sh <IP>             # ensuite, à chaque changement du moteur
```

Le script construit `server/micro/dist/micro-server.mjs` (`web/scripts/build-micro-server.mjs`), l'envoie, redémarre `terminal-micro` puis lit `https://<ip-avec-tirets>.sslip.io/micro/health`.

Ensuite, dans Vercel : *Settings → Environment Variables* → `VITE_MICRO_SERVER_URL=https://<ip-avec-tirets>.sslip.io`, puis redéployer. Cette adresse est publique, ce n'est pas un secret. Sans elle, l'écran garde le moteur du navigateur.

## Exploitation

| Besoin | Commande (sur la machine : `ssh -i ~/.ssh/oracle_terminal ubuntu@<IP>`) |
| --- | --- |
| état du service | `systemctl status terminal-micro` |
| journal | `journalctl -u terminal-micro -n 100` (proxy : `-u caddy`) |
| redémarrer | `sudo systemctl restart terminal-micro` (état relu s'il a moins d'une heure) |
| santé | `curl -s https://<hôte>/micro/health` : flux, mémoire système en %, sauvegarde |

Fonctionnement :
- Le service écoute sur `127.0.0.1:8720`. Caddy seul est exposé (80/443).
- Origines autorisées : `MICRO_ORIGINS`, par défaut le site Vercel et `127.0.0.1:5173`.
- L'état est sauvegardé toutes les 60 s dans `/var/lib/terminal-micro/state.json`.

## Recherche autonome du backtest (T-070)

Le service `terminal-bt` fait tourner la boucle de `bt-jobs` sans la limite de calcul de Supabase. Supabase prend le relais s'il s'arrête : le bail expire en 6 min au plus.

Ses secrets se posent une fois, puis à chaque changement de clé :

1. Supabase → *Project Settings → API Keys → Secret keys → New secret key*, nom **oracle**. Cette clé dédiée se révoque seule, sans toucher aux autres.
2. Dans le `.env` du Mac (jamais commis), ajouter `ORACLE_SUPABASE_SECRET_KEY=` suivi de la valeur. `SUPABASE_URL` et `GEMINI_API_KEY` y sont déjà.
3. Lancer `deploy/oracle/deployer.sh <IP> secrets`. Les valeurs partent par l'entrée standard de SSH vers `/etc/terminal/bt.env` (root:terminal, 0640), sans être affichées.

Exploitation :
- `systemctl status terminal-bt` ;
- `journalctl -u terminal-bt -n 50` : un passage par ligne ;
- `/micro/health` → champ `bt.last_pass`.

Révoquer la clé « oracle » dans Supabase coupe le service ; Supabase continue seul.

## Alertes à la seconde (T-071)

Le service `terminal-alerts` juge les alertes de prix (BTC et ETH perp OKX) sur chaque trade. Il juge aussi les alertes de liquidations et de mur retiré, à partir du flux local de la microstructure. Supabase reste le repli des prix, à la minute, avec la même clé de minute, si bien qu'une alerte n'est jamais envoyée deux fois.

Secrets : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` et la clé « oracle », dans `/etc/terminal/alerts.env`. Ils sont posés par le même `deployer.sh <IP> secrets`, qui écrit un fichier par service.

Exploitation :
- `journalctl -u terminal-alerts` ;
- `/micro/health` → champ `alerts` ;
- l'écran `/alertes` affiche « Prix · Oracle à la seconde » tant que le battement de cœur (clé `alert:oracle`, toutes les 30 s) est frais.

## Tree of Alpha en temps réel (T-072)

Le service `terminal-news` tient la WebSocket gratuite de Tree of Alpha (`wss://news.treeofalpha.com/ws`). Chaque message suit le même parcours que les flux RSS :
- doublons (fonction `isDuplicate`) ;
- table `news_items` ;
- `news:item:<id>`, diffusé par Realtime ;
- alertes par mot-clé et par catégorie.

L'état du flux est publié sous `feed:toa`, toutes les 30 s ; la barre de flux l'affiche une fois la migration `20261125200000_feed_toa.sql` appliquée.

Secrets : les mêmes que `terminal-alerts` (`/etc/terminal/alerts.env`).

Exploitation :
- `journalctl -u terminal-news` ;
- `/micro/health` → champ `news` (messages, titres gardés, doublons, alertes).
