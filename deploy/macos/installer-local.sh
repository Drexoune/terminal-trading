#!/usr/bin/env bash
# Mode Local : installe et démarre la passerelle du terminal sur ce Mac, comme
# agent launchd utilisateur (com.terminal-trading.gateway, décision T-014).
# L'agent la lance à chaque ouverture de session et la relance après un
# plantage, jamais après un arrêt propre.
#
#   deploy/macos/installer-local.sh             installer (ou réinstaller) et démarrer
#   deploy/macos/installer-local.sh --afficher  afficher la plist générée, sans rien installer
#
# Rejouable : un agent déjà chargé est d'abord arrêté proprement, puis rechargé
# avec une plist régénérée (utile après avoir déplacé le dépôt ou recréé .venv).
# Arrêt : arreter-local.sh. Retrait complet : desinstaller-local.sh.

set -euo pipefail
# shellcheck source=_commun.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_commun.sh"

case "${1:-}" in
  "") ;;
  --afficher)
    render_plist "$(any_python)"
    exit 0
    ;;
  -h | --help)
    usage "${BASH_SOURCE[0]}"
    exit 0
    ;;
  *) die "option inconnue : $1 (seule option : --afficher)" ;;
esac

require_macos
require_venv
load_gateway_config strict

# Les dossiers protégés (Documents, Bureau, Téléchargements, iCloud Drive) ne
# sont pas lisibles par un agent launchd sans autorisation explicite dans
# Réglages Système > Confidentialité et sécurité (à vérifier sur le Mac).
case "$ROOT" in
  "$HOME/Documents"* | "$HOME/Desktop"* | "$HOME/Downloads"* | "$HOME/Library/Mobile Documents"*)
    warn "le dépôt est dans un dossier protégé par macOS ($ROOT) : l'agent risque de ne pas
pouvoir le lire. Conseillé : le déplacer, par exemple dans ~/Projects, puis relancer ce script."
    ;;
esac

if agent_loaded; then
  info "Agent déjà chargé : arrêt propre avant réinstallation."
  stop_agent
elif gateway_answers; then
  die "une passerelle répond déjà sur $GW_URL (scripts/dev.py ?). L'arrêter (Ctrl+C), puis relancer ce script."
fi

mkdir -p "$ROOT/logs" "$(dirname "$PLIST_DEST")"
tmp="$(mktemp "${TMPDIR:-/tmp}/terminal-gateway-plist.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
render_plist "$PYTHON" >"$tmp"
plutil -lint "$tmp" >/dev/null || die "plist générée invalide (plutil -lint $tmp)."
cp "$tmp" "$PLIST_DEST"
chmod 644 "$PLIST_DEST"
info "Plist écrite : $PLIST_DEST"

# Demande d'arrêt résiduelle : la passerelle l'efface à son démarrage, on le fait avant.
rm -f "$STOP_FILE"
# Un agent désactivé (launchctl disable) refuserait de se charger.
launchctl enable "$(service)" || true
launchctl bootstrap "$(domain)" "$PLIST_DEST" || die "launchctl bootstrap $(domain) a échoué.
Lancer ce script depuis le Terminal de la session ouverte (pas en SSH), puis voir : launchctl print $(service)"
info "Agent chargé : $(service). Attente de la passerelle sur $GW_URL…"

if ! wait_health; then
  show_logs
  # Sinon launchd relancerait en boucle une passerelle qui plante au démarrage.
  launchctl bootout "$(service)" 2>/dev/null || true
  die "la passerelle ne répond pas après ${HEALTH_TIMEOUT_S} s (journaux ci-dessus). L'agent a été déchargé
pour ne pas la relancer en boucle : corriger la cause, puis relancer ce script."
fi
show_health
info "Mode Local prêt. Dans le terminal : avatar > Paramètres > Mode Local > Tester, puis Appliquer."
