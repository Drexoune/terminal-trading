#!/usr/bin/env bash
# Mode Local : retire l'agent launchd de la passerelle.
#
#   deploy/macos/desinstaller-local.sh
#
# Arrête proprement la passerelle si elle tourne (comme arreter-local.sh), puis
# supprime ~/Library/LaunchAgents/com.terminal-trading.gateway.plist : elle ne
# démarrera plus à l'ouverture de session. Les journaux (logs/) et le dépôt
# restent en place. Réinstaller : installer-local.sh.

set -euo pipefail
# shellcheck source=_commun.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_commun.sh"

case "${1:-}" in
  "") ;;
  -h | --help)
    usage "${BASH_SOURCE[0]}"
    exit 0
    ;;
  *) die "option inconnue : $1" ;;
esac

require_macos
load_gateway_config souple

if agent_loaded; then
  stop_agent
fi
if [[ -f "$PLIST_DEST" ]]; then
  rm -f "$PLIST_DEST"
  info "Plist supprimée : $PLIST_DEST"
else
  info "Aucune plist à supprimer ($PLIST_DEST absente)."
fi
info "Agent désinstallé. Journaux conservés dans $ROOT/logs/."
