"""Lance le terminal en local, en une commande, dans le mode choisi.

    python scripts/dev.py                  # Mode Local : passerelle :8710 (OKX réel) et Vite :5173
    python scripts/dev.py --mode online    # Mode Online : Vite seul, /api/* servies par Vite
    python scripts/dev.py --mode tour      # Mode Tour : Vite seul, passerelle de la tour
    python scripts/dev.py --demo           # Mode Local, passerelle de démonstration, Vite :5174

Le mode passé ici n'est qu'un défaut (VITE_DEFAULT_MODE) : un mode déjà choisi
dans Paramètres sur ce navigateur prime. Ctrl+C arrête tout proprement.
Fonctionne sous macOS et Windows. Les trois modes : docs/modes.md.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
VITE_BIN = WEB / "node_modules" / "vite" / "bin" / "vite.js"
VITE_PORT = 5173
# Démonstration : mêmes ports que les tests Playwright (web/playwright.config.ts),
# les seuls que la passerelle de démonstration autorise.
DEMO_PORT = 8790
DEMO_VITE_PORT = 5174
DEFAULT_GATEWAY_PORT = "8710"
MODES = {"online": "Mode Online", "local": "Mode Local", "tour": "Mode Tour"}
PROXY_VARS = ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class PlanError(Exception):
    """Combinaison d'options ou configuration incomplète : message pour l'utilisateur."""


@dataclass
class Plan:
    gateway: list[str] | None      # commande de la passerelle, None si Vite seul
    env: dict[str, str]            # environnement de la passerelle et de Vite
    vite_port: int = VITE_PORT
    notes: list[str] = field(default_factory=list)


def venv_python() -> str:
    for rel in (".venv/bin/python", ".venv/Scripts/python.exe"):
        p = ROOT / rel
        if p.exists():
            return str(p)
    return sys.executable


def read_dotenv(path: Path) -> dict[str, str]:
    """Lit un .env simple (CLE=valeur), comme la passerelle, sans toucher à os.environ."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return out


def gateway_url_problem(raw: str) -> str | None:
    """Règle de validateGatewayUrl (web/src/config/modes.ts) : https, ou http vers localhost."""
    try:
        u = urlsplit(raw.strip())
        host = u.hostname or ""
    except ValueError:
        return "adresse invalide"
    if u.username or u.password or u.query or u.fragment or not host:
        return "adresse invalide (https://<tour>.<tailnet>.ts.net attendu)"
    if u.scheme == "https" or (u.scheme == "http" and host in LOCAL_HOSTS):
        return None
    return "https attendu (tailscale serve) ; http n'est accepté que vers cette machine"


def gateway_answers(base_url: str, timeout_s: float = 1.0) -> bool:
    """Une passerelle répond déjà à cette adresse (agent launchd du Mac, autre terminal)."""
    # Sans proxy : l'adresse est locale, un proxy d'entreprise ne la joindrait pas.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"{base_url.rstrip('/')}/api/health", timeout=timeout_s) as r:
            return r.status == 200
    except (OSError, ValueError):
        return False


def build_plan(mode: str, demo: bool, environ: Mapping[str, str], dotenv: Mapping[str, str],
               python: str) -> Plan:
    """Processus et variables à lancer pour ce mode. L'environnement prime sur .env,
    comme pour Vite et la passerelle."""

    def lookup(name: str) -> str:
        return (environ.get(name) or dotenv.get(name) or "").strip()

    env = dict(environ)
    notes: list[str] = []
    if lookup("VITE_GATEWAY_URL"):
        notes.append("VITE_GATEWAY_URL est obsolète et ignorée : la remplacer par "
                     "VITE_LOCAL_GATEWAY_URL ou VITE_TOUR_GATEWAY_URL (voir .env.example).")
    if demo and mode != "local":
        raise PlanError("--demo ne vaut qu'en Mode Local (passerelle de démonstration).")
    env["VITE_DEFAULT_MODE"] = mode
    gateway: list[str] | None = None

    if demo:
        gateway = [python, str(WEB / "e2e" / "fake_gateway.py"), "--port", str(DEMO_PORT)]
        env["VITE_LOCAL_GATEWAY_URL"] = f"http://127.0.0.1:{DEMO_PORT}"
    elif mode == "local":
        gateway = [python, "-m", "terminal_gateway"]
        if not lookup("GATEWAY_MODE"):
            env["GATEWAY_MODE"] = "local"
        if not lookup("VITE_LOCAL_GATEWAY_URL"):
            port = lookup("GATEWAY_PORT") or DEFAULT_GATEWAY_PORT
            env["VITE_LOCAL_GATEWAY_URL"] = f"http://127.0.0.1:{port}"
        origins = [o.strip().rstrip("/") for o in lookup("GATEWAY_ALLOWED_ORIGINS").split(",")]
        mine = (f"http://localhost:{VITE_PORT}", f"http://127.0.0.1:{VITE_PORT}")
        if any(origins) and not any(o in origins for o in mine):
            notes.append(f"GATEWAY_ALLOWED_ORIGINS n'autorise pas {mine[0]} : la passerelle "
                         "refusera ce front. L'ajouter dans .env.")
    elif mode == "online":
        # Les fonctions /api/* tournent dans Node (serveur de Vite) : derrière un
        # proxy, fetch ne le suit que si NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
        if any(environ.get(k) for k in PROXY_VARS) and "NODE_USE_ENV_PROXY" not in environ:
            env["NODE_USE_ENV_PROXY"] = "1"
            notes.append("proxy détecté : NODE_USE_ENV_PROXY=1 pour que /api/* joigne OKX "
                         "(Node ≥ 22.21 ; certificat d'un proxy d'entreprise : "
                         "NODE_EXTRA_CA_CERTS).")
        if not (lookup("SUPABASE_URL") and lookup("SUPABASE_SECRET_KEY")):
            notes.append("SUPABASE_URL ou SUPABASE_SECRET_KEY absente : /api/collector-health "
                         "répondra « collecteur non configuré » (facultatif en développement).")
    elif mode == "tour":
        url = lookup("VITE_TOUR_GATEWAY_URL")
        if not url:
            raise PlanError("Mode Tour : VITE_TOUR_GATEWAY_URL manque. L'indiquer dans .env "
                            "(https://<tour>.<tailnet>.ts.net, publiée par « tailscale serve » "
                            "sur la tour). Voir docs/modes.md.")
        problem = gateway_url_problem(url)
        if problem:
            raise PlanError(f"Mode Tour : VITE_TOUR_GATEWAY_URL refusée ({problem}).")
        notes.append(f"la tour doit autoriser l'origine http://localhost:{VITE_PORT} "
                     "(GATEWAY_ALLOWED_ORIGINS dans le .env de la tour).")
    else:
        raise PlanError(f"mode inconnu : {mode}")
    return Plan(gateway=gateway, env=env, vite_port=DEMO_VITE_PORT if demo else VITE_PORT,
                notes=notes)


def _stop_on_sigterm(signum, frame) -> None:
    raise KeyboardInterrupt  # même arrêt propre que Ctrl+C


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=list(MODES), default="local",
                    help="mode par défaut du front (défaut : local)")
    ap.add_argument("--demo", action="store_true",
                    help="passerelle de démonstration (données de la maquette, tests)")
    args = ap.parse_args(argv)

    try:
        plan = build_plan(args.mode, args.demo, os.environ, read_dotenv(ROOT / ".env"),
                          venv_python())
    except PlanError as exc:
        print(f"dev.py : {exc}", file=sys.stderr)
        return 2

    node = shutil.which("node")
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not node or not npm:
        print("node ou npm introuvable : installer Node.js 22 ou plus récent.", file=sys.stderr)
        return 1
    if not VITE_BIN.exists():
        subprocess.run([npm, "ci"], cwd=WEB, check=True)

    # Mode Local avec l'agent launchd déjà en service (deploy/macos) : une
    # seconde passerelle ne pourrait pas prendre le port ; Vite seul suffit.
    if plan.gateway and not args.demo and gateway_answers(plan.env["VITE_LOCAL_GATEWAY_URL"]):
        plan.gateway = None
        plan.notes.append(f"une passerelle répond déjà sur {plan.env['VITE_LOCAL_GATEWAY_URL']} "
                          "(agent launchd ?) : Vite seul est lancé.")
    for note in plan.notes:
        print(f"Note : {note}")
    procs = []
    if plan.gateway:
        procs.append(subprocess.Popen(plan.gateway, cwd=ROOT, env=plan.env))
    # Vite lancé directement par node, sans « npm run » : arrêter le process
    # arrête bien Vite (npm ne transmet pas toujours l'arrêt à son enfant).
    # --strictPort : un port déjà pris fait échouer Vite au lieu de changer
    # d'origine (la passerelle n'autorise que les origines de GATEWAY_ALLOWED_ORIGINS).
    procs.append(subprocess.Popen([node, str(VITE_BIN), "--port", str(plan.vite_port),
                                   "--strictPort"], cwd=WEB, env=plan.env))
    label = MODES[args.mode] + (" · démonstration" if args.demo else "")
    print(f"\nTERMINAL : http://localhost:{plan.vite_port}  ({label} ; Ctrl+C pour arrêter)\n")
    signal.signal(signal.SIGTERM, _stop_on_sigterm)
    stopped = False
    try:
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        stopped = True
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
    if stopped:
        return 0
    # Un process s'est arrêté seul (port pris, plantage) : sortie en erreur.
    failed = [p for p in procs if p.returncode]
    return failed[0].returncode if failed and failed[0].returncode > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
