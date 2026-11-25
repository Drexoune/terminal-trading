#!/usr/bin/env bash
# Installation unique de la machine Oracle (T-069), lancée PAR deployer.sh, sur la machine :
#   sudo bash installer.sh <nom-https>
# Node 22 LTS (NodeSource), Caddy (dépôt officiel), utilisateur système « terminal », ports 80/443
# ouverts dans iptables (l'image Ubuntu d'Oracle rejette tout sauf 22), services systemd
# terminal-micro (T-069), terminal-bt (T-070), terminal-alerts (T-071) et terminal-news (T-072) —
# les trois derniers démarrent seulement une fois leurs secrets posés —,
# mises à jour de sécurité automatiques. Rejouable sans risque.
set -euo pipefail
HOST="${1:?usage : sudo bash installer.sh <nom-https>}"
cd "$(dirname "$0")"

export DEBIAN_FRONTEND=noninteractive
# Machine neuve : les mises à jour automatiques tiennent le verrou d'apt quelques minutes.
APT=(apt-get -o DPkg::Lock::Timeout=600)
"${APT[@]}" update -q
"${APT[@]}" install -yq ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades iptables-persistent

# Node 22 LTS (WebSocket et fetch natifs, nécessaires au moteur).
if ! node --version 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  "${APT[@]}" install -yq nodejs
fi

# Caddy (dépôt officiel).
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  "${APT[@]}" update -q
  "${APT[@]}" install -yq caddy
fi

# Utilisateur et dossiers.
id terminal >/dev/null 2>&1 || useradd --system --home /opt/terminal-micro --shell /usr/sbin/nologin terminal
install -d -o terminal -g terminal -m 0755 /opt/terminal-micro /var/lib/terminal-micro /opt/terminal-bt /var/lib/terminal-bt /opt/terminal-alerts /var/lib/terminal-alerts /opt/terminal-news /var/lib/terminal-news
install -d -o root -g terminal -m 0750 /etc/terminal          # secrets de terminal-bt (T-070) et terminal-alerts (T-071)

# Ports 80 et 443 avant la règle REJECT de l'image d'Oracle.
for p in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 5 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
done
netfilter-persistent save

# Service et proxy.
install -m 0644 terminal-micro.service /etc/systemd/system/terminal-micro.service
install -m 0644 terminal-bt.service /etc/systemd/system/terminal-bt.service
install -m 0644 terminal-alerts.service /etc/systemd/system/terminal-alerts.service
install -m 0644 terminal-news.service /etc/systemd/system/terminal-news.service
sed "s/__HOST__/${HOST}/" Caddyfile.template > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable terminal-micro terminal-bt terminal-alerts terminal-news caddy
systemctl reload-or-restart caddy

# Mises à jour de sécurité automatiques.
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "installé : node $(node --version), $(caddy version | cut -d' ' -f1), https://${HOST}/micro/health"
