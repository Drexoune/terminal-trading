#!/usr/bin/env bash
# Déploiement du service de la microstructure sur la machine Oracle (T-069), depuis le Mac.
#
#   deploy/oracle/deployer.sh <ip> installer   # une fois : installe Node, Caddy, les services
#   deploy/oracle/deployer.sh <ip> secrets     # pose les secrets de terminal-bt (T-070) et terminal-alerts (T-071), lus dans .env du Mac
#   deploy/oracle/deployer.sh <ip>             # ensuite : envoie les paquets et redémarre
#
# Clé SSH : ~/.ssh/oracle_terminal (jamais dans le dépôt). Nom https : <ip-avec-tirets>.sslip.io.
# Secrets : ORACLE_SUPABASE_SECRET_KEY (clé dédiée « oracle », sinon SUPABASE_SECRET_KEY),
# SUPABASE_URL, GEMINI_API_KEY (bt), TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID (alertes), envoyés par
# l'entrée standard de SSH, un fichier par service (chacun ne lit que le sien) : jamais en argument,
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
  "${SCP[@]}" "$ROOT"/deploy/oracle/{installer.sh,terminal-micro.service,terminal-bt.service,terminal-alerts.service,terminal-news.service,Caddyfile.template} "ubuntu@$IP:/tmp/"
  "${SSH[@]}" "sudo bash /tmp/installer.sh $HOST"
fi

put_secret() {   # $1 : fichier distant ; contenu lu sur l'entrée standard
  "${SSH[@]}" "sudo sh -c 'umask 027; cat > $1.tmp && chown root:terminal $1.tmp && chmod 0640 $1.tmp && mv $1.tmp $1'"
}

if [ "$MODE" = secrets ]; then
  url="$(envval SUPABASE_URL)"; key="$(envval ORACLE_SUPABASE_SECRET_KEY)"; [ -n "$key" ] || key="$(envval SUPABASE_SECRET_KEY)"
  gem="$(envval GEMINI_API_KEY)"; tgt="$(envval TELEGRAM_BOT_TOKEN)"; tgc="$(envval TELEGRAM_CHAT_ID)"
  [ -n "$url" ] && [ -n "$key" ] || { echo "SUPABASE_URL ou clé secrète absente du .env du Mac" >&2; exit 1; }
  if [ -n "$gem" ]; then
    printf 'SUPABASE_URL=%s\nSUPABASE_SECRET_KEY=%s\nGEMINI_API_KEY=%s\n' "$url" "$key" "$gem" | put_secret /etc/terminal/bt.env
    echo "secrets de terminal-bt posés (/etc/terminal/bt.env, 0640)"
  else echo "GEMINI_API_KEY absente : terminal-bt laissé sans secrets" >&2; fi
  if [ -n "$tgt" ] && [ -n "$tgc" ]; then
    printf 'SUPABASE_URL=%s\nSUPABASE_SECRET_KEY=%s\nTELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "$url" "$key" "$tgt" "$tgc" | put_secret /etc/terminal/alerts.env
    echo "secrets de terminal-alerts posés (/etc/terminal/alerts.env, 0640)"
  else echo "TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent : terminal-alerts laissé sans secrets" >&2; fi
fi

(cd "$ROOT/web" && node scripts/build-micro-server.mjs && node scripts/build-bt-runner.mjs && node scripts/build-alerts.mjs && node scripts/build-news.mjs)
"${SCP[@]}" "$ROOT/server/micro/dist/micro-server.mjs" "$ROOT/server/bt/dist/bt-runner.mjs" "$ROOT/server/alerts/dist/alerts.mjs" "$ROOT/server/news/dist/news.mjs" "ubuntu@$IP:/tmp/"
"${SSH[@]}" "sudo install -o terminal -g terminal -m 0644 /tmp/micro-server.mjs /opt/terminal-micro/micro-server.mjs \
  && sudo install -o terminal -g terminal -m 0644 /tmp/bt-runner.mjs /opt/terminal-bt/bt-runner.mjs \
  && sudo install -o terminal -g terminal -m 0644 /tmp/alerts.mjs /opt/terminal-alerts/alerts.mjs \
  && sudo install -o terminal -g terminal -m 0644 /tmp/news.mjs /opt/terminal-news/news.mjs \
  && sudo systemctl restart terminal-micro && sudo systemctl restart terminal-bt && sudo systemctl restart terminal-alerts && sudo systemctl restart terminal-news"

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
