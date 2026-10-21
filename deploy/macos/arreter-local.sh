#!/usr/bin/env bash
# Mode Local : arrêt PROPRE de la passerelle lancée par l'agent launchd.
#
#   deploy/macos/arreter-local.sh
#
# Dépose le fichier d'arrêt que surveille la passerelle (<GATEWAY_LOG_DIR>/_control/gateway.stop),
# attend qu'elle se termine (code 0 : launchd ne la relance pas), puis décharge
# l'agent (launchctl bootout). Elle redémarrera à la prochaine ouverture de
# session ; pour la relancer tout de suite : installer-local.sh ; pour ne plus
# jamais la lancer : desinstaller-local.sh. Ne jamais utiliser « kill -9 ».

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

if ! agent_loaded; then
  info "Agent $LABEL non chargé : rien à arrêter."
  info "(Une passerelle lancée par scripts/dev.py s'arrête par Ctrl+C dans son terminal.)"
  exit 0
fi
stop_agent
info "Elle redémarrera à la prochaine ouverture de session. Relancer maintenant : installer-local.sh ; ne plus la lancer : desinstaller-local.sh."
