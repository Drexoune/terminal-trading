#!/usr/bin/env bash
# Déploiement du service de la microstructure sur la machine Oracle (T-069), depuis le Mac.
#
#   deploy/oracle/deployer.sh <ip> installer   # une fois : installe Node, Caddy, le service
#   deploy/oracle/deployer.sh <ip>             # ensuite : envoie le paquet et redémarre
#
# Clé SSH : ~/.ssh/oracle_terminal (jamais dans le dépôt). Nom https : <ip-avec-tirets>.sslip.io.
set -euo pipefail
IP="${1:?usage : deployer.sh <ip> [installer]}"
MODE="${2:-deployer}"
KEY="$HOME/.ssh/oracle_terminal"
HOST="${IP//./-}.sslip.io"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$IP")
SCP=(scp -i "$KEY" -o StrictHostKeyChecking=accept-new)

if [ "$MODE" = installer ]; then
  "${SCP[@]}" "$ROOT"/deploy/oracle/{installer.sh,terminal-micro.service,Caddyfile.template} "ubuntu@$IP:/tmp/"
  "${SSH[@]}" "sudo bash /tmp/installer.sh $HOST"
fi

(cd "$ROOT/web" && node scripts/build-micro-server.mjs)
"${SCP[@]}" "$ROOT/server/micro/dist/micro-server.mjs" "ubuntu@$IP:/tmp/micro-server.mjs"
"${SSH[@]}" "sudo install -o terminal -g terminal -m 0644 /tmp/micro-server.mjs /opt/terminal-micro/micro-server.mjs && sudo systemctl restart terminal-micro"

for _ in $(seq 1 30); do
  if curl -fsS "https://$HOST/micro/health" >/dev/null 2>&1; then
    curl -fsS "https://$HOST/micro/health"; echo
    echo "déployé : https://$HOST  (VITE_MICRO_SERVER_URL=https://$HOST)"
    exit 0
  fi
  sleep 2
done
echo "santé injoignable sur https://$HOST/micro/health : voir « sudo journalctl -u terminal-micro -u caddy »" >&2
exit 1
