# Fonctions communes aux scripts du Mode Local sur le Mac (décision T-014).
# Fichier SOURCÉ par installer-local.sh, arreter-local.sh et desinstaller-local.sh,
# jamais exécuté seul. Même patron que deploy/windows : fichier d'arrêt surveillé
# par la passerelle, puis seulement l'arrêt par le gestionnaire de services.
#
# Chemins déduits de l'emplacement de ce fichier : les scripts marchent quel que
# soit le dossier courant et quel que soit l'endroit où le dépôt est cloné.
#
# Commandes launchctl (man launchctl, macOS 10.11 et suivants, à vérifier sur le
# Mac) : bootstrap / bootout / enable / print sur le domaine gui/<uid>, celui de
# la session graphique de l'utilisateur. La sortie de « launchctl print » n'est
# pas une interface stable : on n'y lit que la ligne « pid = … ».

LABEL="com.terminal-trading.gateway"
MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$MACOS_DIR/../.." && pwd)"
TEMPLATE="$MACOS_DIR/$LABEL.plist.template"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
PYTHON="$ROOT/.venv/bin/python"
LAUNCHD_LOG="$ROOT/logs/gateway-launchd.log"
STOP_TIMEOUT_S=30      # attente de l'arrêt propre (la passerelle lit le fichier chaque seconde)
HEALTH_TIMEOUT_S=45    # démarrage : lecture des instruments OKX, puis écoute

info() { printf '%s\n' "$*"; }
# Aide d'un script : son bloc de commentaires d'en-tête, sans les « # ».
usage() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$1"; }
warn() { printf 'Attention : %s\n' "$*" >&2; }
die() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }

domain() { printf 'gui/%s' "$(id -u)"; }
service() { printf '%s/%s' "$(domain)" "$LABEL"; }

require_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || die "ce script ne fonctionne que sous macOS (launchd)."
}

require_venv() {
  [[ -x "$PYTHON" ]] || die "python introuvable : $PYTHON
Créer l'environnement depuis la racine du dépôt :
  python3 -m venv .venv && .venv/bin/pip install -e ."
  "$PYTHON" -c 'import terminal_gateway' 2>/dev/null \
    || die "terminal_gateway n'est pas installé dans .venv : .venv/bin/pip install -e ."
}

# Python pour générer la plist : celui du dépôt s'il existe, sinon python3.
any_python() {
  if [[ -x "$PYTHON" ]]; then
    printf '%s' "$PYTHON"
  elif command -v python3 >/dev/null 2>&1; then
    command -v python3
  else
    die "python3 introuvable."
  fi
}

# Plist de l'agent sur la sortie standard : marqueurs du modèle remplacés par les
# chemins réels, échappés pour XML (un « & » dans un chemin reste valide).
render_plist() {
  "$1" - "$TEMPLATE" "$ROOT" "$PYTHON" <<'PY'
import re
import sys
from xml.sax.saxutils import escape

template, root, python = sys.argv[1:4]
with open(template, encoding="utf-8") as f:
    text = f.read()
for marker, value in (("@ROOT@", root), ("@PYTHON@", python)):
    text = text.replace(marker, escape(value))
left = sorted(set(re.findall(r"@[A-Z_]+@", text)))
if left:
    sys.exit(f"modèle de plist : marqueurs non remplacés {left}")
sys.stdout.write(text)
PY
}

# Configuration réelle de la passerelle (environnement, puis .env), lue par son
# propre code : adresse à interroger et fichier d'arrêt. Définit GW_URL et
# STOP_FILE. « strict » : une configuration illisible arrête le script ;
# « souple » : valeurs par défaut (arrêt ou désinstallation sans .venv).
load_gateway_config() {
  local mode="${1:-strict}" cfg
  if cfg="$(GATEWAY_MODE=local "$PYTHON" - 2>/dev/null <<'PY'
from terminal_gateway.config import Settings

s = Settings.from_env()
host = "127.0.0.1" if s.host in ("", "0.0.0.0", "::") else s.host
if ":" in host:
    host = f"[{host}]"
print(f"http://{host}:{s.port}\t{s.stop_file}")
PY
)"; then
    IFS=$'\t' read -r GW_URL STOP_FILE <<<"$cfg"
  elif [[ "$mode" == "strict" ]]; then
    # Dernière ligne de la trace : le message de la configuration refusée.
    { GATEWAY_MODE=local "$PYTHON" -c \
        'from terminal_gateway.config import Settings; Settings.from_env()' 2>&1 || true; } \
      | tail -n 1 >&2
    die "configuration de la passerelle illisible (voir le message ci-dessus, et .env)."
  else
    GW_URL="http://127.0.0.1:8710"
    STOP_FILE="$ROOT/logs/_control/gateway.stop"
  fi
}

agent_loaded() { launchctl print "$(service)" >/dev/null 2>&1; }

# pid de la passerelle lancée par l'agent, vide si elle ne tourne pas.
agent_pid() {
  local out
  out="$(launchctl print "$(service)" 2>/dev/null)" || return 0
  awk '$1 == "pid" && $2 == "=" { print $3; exit }' <<<"$out"
}

gateway_answers() { curl -fsS --max-time 2 -o /dev/null "$GW_URL/api/health" 2>/dev/null; }

wait_health() {
  local waited=0
  until gateway_answers; do
    if (( waited >= HEALTH_TIMEOUT_S )); then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# Résumé de /api/health : machine, mode annoncé, état des flux OKX.
show_health() {
  local body
  body="$(curl -fsS --max-time 3 "$GW_URL/api/health")" || return 1
  "$(any_python)" - "$body" <<'PY'
import json
import sys

h = json.loads(sys.argv[1])
feeds = ", ".join(f"{f.get('name')} {f.get('status')}" for f in h.get("feeds", [])) or "aucun"
print(f"Passerelle joignable : {h.get('app')} {h.get('version')} sur {h.get('host')}, "
      f"mode annoncé : {h.get('mode_hint')}, flux : {feeds}")
if h.get("mode_hint") != "local":
    print("Attention : cette passerelle n'annonce pas le Mode Local : ce n'est peut-être "
          "pas celle de l'agent.", file=sys.stderr)
PY
}

show_logs() {
  local f
  for f in "$LAUNCHD_LOG" "$ROOT/logs/gateway.log"; do
    [[ -f "$f" ]] || continue
    info "--- dernières lignes de $f"
    tail -n 20 "$f"
  done
}

# Arrêt propre : fichier d'arrêt, attente de la fin du process, puis bootout
# pour que launchd ne le relance pas avant la prochaine ouverture de session.
stop_agent() {
  local pid waited=0
  pid="$(agent_pid)"
  if [[ -n "$pid" ]]; then
    mkdir -p "$(dirname "$STOP_FILE")"
    printf 'arret demande\n' >"$STOP_FILE"
    info "Demande d'arrêt déposée : $STOP_FILE (passerelle pid $pid)."
    while kill -0 "$pid" 2>/dev/null && (( waited < STOP_TIMEOUT_S )); do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      warn "pas d'arrêt propre en ${STOP_TIMEOUT_S} s : launchd l'arrête (SIGTERM, puis SIGKILL)."
    else
      info "Passerelle arrêtée proprement en ${waited} s."
    fi
  else
    info "La passerelle ne tourne pas (agent chargé, pas de process)."
  fi
  if agent_loaded; then
    launchctl bootout "$(service)" || die "launchctl bootout $(service) a échoué."
  fi
  waited=0
  while agent_loaded && (( waited < 10 )); do
    sleep 1
    waited=$((waited + 1))
  done
  agent_loaded && die "l'agent $(service) est toujours chargé."
  rm -f "$STOP_FILE"
  info "Agent déchargé : $(service)."
}
