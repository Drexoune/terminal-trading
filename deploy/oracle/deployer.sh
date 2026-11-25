#!/usr/bin/env bash
# Déploiement du service de la microstructure sur la machine Oracle (T-069), depuis le Mac.
#
#   deploy/oracle/deployer.sh <ip> installer   # une fois : installe Node, Caddy, les services
#   deploy/oracle/deployer.sh <ip> secrets     # pose les secrets de terminal-bt (T-070), lus dans .env du Mac
#   deploy/oracle/deployer.sh <ip>             # ensuite : envoie les paquets et redémarre
#
# Clé SSH : ~/.ssh/oracle_terminal (jamais dans le dépôt). Nom https : <ip-avec-tirets>.sslip.io.
# Secrets : ORACLE_SUPABASE_SECRET_KEY (clé dédiée « oracle », sinon SUPABASE_SECRET_KEY),
# SUPABASE_URL et GEMINI_API_KEY, envoyés par l'entrée standard de SSH : jamais en argument,
# jamais affichés, jamais dans le dépôt.
set -euo pipefail
IP="${1:?usage : deployer.sh <ip> [installer]}"
MODE="${2:-deployer}"
KEY="$HOME/.ssh/oracle_terminal"
HOST="${IP//./-}.sslip.io"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$IP")
SCP=(scp -i "$KEY" -o StrictHostKeyChecking=accept-new)

envval() {   # valeur d'une variable du .env du Mac, guillemets retirés ; jamais affichée
  grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

if [ "$MODE" = installer ]; then
  "${SCP[@]}" "$ROOT"/deploy/oracle/{installer.sh,terminal-micro.service,terminal-bt.service,Caddyfile.template} "ubuntu@$IP:/tmp/"
  "${SSH[@]}" "sudo bash /tmp/installer.sh $HOST"
fi

if [ "$MODE" = secrets ]; then
  url="$(envval SUPABASE_URL)"; key="$(envval ORACLE_SUPABASE_SECRET_KEY)"; [ -n "$key" ] || key="$(envval SUPABASE_SECRET_KEY)"; gem="$(envval GEMINI_API_KEY)"
  [ -n "$url" ] && [ -n "$key" ] && [ -n "$gem" ] || { echo "SUPABASE_URL, clé secrète ou GEMINI_API_KEY absente du .env du Mac" >&2; exit 1; }
  printf 'SUPABASE_URL=%s\nSUPABASE_SECRET_KEY=%s\nGEMINI_API_KEY=%s\n' "$url" "$key" "$gem" \
    | "${SSH[@]}" "sudo sh -c 'umask 027; cat > /etc/terminal/bt.env.tmp && chown root:terminal /etc/terminal/bt.env.tmp && chmod 0640 /etc/terminal/bt.env.tmp && mv /etc/terminal/bt.env.tmp /etc/terminal/bt.env'"
  echo "secrets posés dans /etc/terminal/bt.env (root:terminal, 0640)"
fi

(cd "$ROOT/web" && node scripts/build-micro-server.mjs && node scripts/build-bt-runner.mjs)
"${SCP[@]}" "$ROOT/server/micro/dist/micro-server.mjs" "$ROOT/server/bt/dist/bt-runner.mjs" "ubuntu@$IP:/tmp/"
"${SSH[@]}" "sudo install -o terminal -g terminal -m 0644 /tmp/micro-server.mjs /opt/terminal-micro/micro-server.mjs \
  && sudo install -o terminal -g terminal -m 0644 /tmp/bt-runner.mjs /opt/terminal-bt/bt-runner.mjs \
  && sudo systemctl restart terminal-micro && sudo systemctl restart terminal-bt"

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
