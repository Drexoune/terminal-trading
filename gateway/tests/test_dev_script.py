"""scripts/dev.py : processus et variables lancés pour chaque mode (sans rien lancer)."""

import importlib.util
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("dev_script", ROOT / "scripts" / "dev.py")
dev = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = dev  # les dataclasses résolvent leurs annotations par sys.modules
_spec.loader.exec_module(dev)

PY = "/venv/python"
TOUR = "https://tour.tailnet-exemple.ts.net"


def plan(mode="local", demo=False, environ=None, dotenv=None):
    return dev.build_plan(mode, demo, environ or {}, dotenv or {}, PY)


def test_local_runs_gateway_and_vite_in_local_mode():
    p = plan()
    assert p.gateway == [PY, "-m", "terminal_gateway"]
    assert p.env["VITE_DEFAULT_MODE"] == "local"
    assert p.env["VITE_LOCAL_GATEWAY_URL"] == "http://127.0.0.1:8710"
    assert p.env["GATEWAY_MODE"] == "local"
    assert p.vite_port == 5173 and p.notes == []


def test_local_follows_gateway_port_and_keeps_explicit_values():
    p = plan(dotenv={"GATEWAY_PORT": "8711"})
    assert p.env["VITE_LOCAL_GATEWAY_URL"] == "http://127.0.0.1:8711"
    # Valeur déjà fournie (environnement ou .env) : dev.py n'y touche pas.
    p = plan(environ={"VITE_LOCAL_GATEWAY_URL": "http://localhost:9000", "GATEWAY_MODE": "tour"})
    assert p.env["VITE_LOCAL_GATEWAY_URL"] == "http://localhost:9000"
    assert p.env["GATEWAY_MODE"] == "tour"


def test_local_warns_when_origins_exclude_vite():
    p = plan(dotenv={"GATEWAY_ALLOWED_ORIGINS": "https://terminal.vercel.app"})
    assert any("GATEWAY_ALLOWED_ORIGINS" in n for n in p.notes)
    p = plan(dotenv={"GATEWAY_ALLOWED_ORIGINS": "https://terminal.vercel.app,"
                                                "http://localhost:5173/"})
    assert p.notes == []


def test_demo_uses_fake_gateway_and_playwright_ports():
    p = plan(demo=True)
    assert p.gateway[0] == PY and p.gateway[1].endswith("fake_gateway.py")
    assert p.gateway[-2:] == ["--port", "8790"]
    assert p.env["VITE_LOCAL_GATEWAY_URL"] == "http://127.0.0.1:8790"
    assert p.env["VITE_DEFAULT_MODE"] == "local"
    assert p.vite_port == 5174


def test_demo_outside_local_is_refused():
    with pytest.raises(dev.PlanError, match="--demo"):
        plan("online", demo=True)


def test_online_runs_vite_only_and_sets_proxy_flag_behind_a_proxy():
    p = plan("online")
    assert p.gateway is None and p.env["VITE_DEFAULT_MODE"] == "online"
    assert "NODE_USE_ENV_PROXY" not in p.env
    assert any("SUPABASE" in n for n in p.notes)
    p = plan("online", environ={"HTTPS_PROXY": "http://proxy:3128", "SUPABASE_URL": "https://x",
                                "SUPABASE_SECRET_KEY": "sb_secret_x"})
    assert p.env["NODE_USE_ENV_PROXY"] == "1"
    assert not any("SUPABASE" in n for n in p.notes)
    # Choix explicite de l'utilisateur respecté.
    p = plan("online", environ={"HTTPS_PROXY": "http://proxy:3128", "NODE_USE_ENV_PROXY": "0"})
    assert p.env["NODE_USE_ENV_PROXY"] == "0"


def test_tour_requires_https_gateway_url():
    with pytest.raises(dev.PlanError, match="VITE_TOUR_GATEWAY_URL manque"):
        plan("tour")
    with pytest.raises(dev.PlanError, match="https attendu"):
        plan("tour", dotenv={"VITE_TOUR_GATEWAY_URL": "http://100.101.102.103:8710"})
    p = plan("tour", dotenv={"VITE_TOUR_GATEWAY_URL": TOUR})
    assert p.gateway is None and p.env["VITE_DEFAULT_MODE"] == "tour"
    assert any("GATEWAY_ALLOWED_ORIGINS" in n for n in p.notes)


def test_obsolete_variable_is_reported():
    p = plan(dotenv={"VITE_GATEWAY_URL": "http://127.0.0.1:8710"})
    assert any("VITE_GATEWAY_URL est obsolète" in n for n in p.notes)


def test_dotenv_reader_matches_gateway_rules(tmp_path):
    f = tmp_path / ".env"
    f.write_text("# commentaire\nA=1\nB = 'deux'\nA=3\nsans_egal\nC=\"x=y\"\n", encoding="utf-8")
    assert dev.read_dotenv(f) == {"A": "1", "B": "deux", "C": "x=y"}
    assert dev.read_dotenv(tmp_path / "absent") == {}


@pytest.mark.parametrize(("url", "ok"), [
    (TOUR, True), ("http://127.0.0.1:8710", True), ("http://localhost:8710", True),
    ("http://tour.ts.net", False), ("https://user:pw@tour.ts.net", False),
    ("https://tour.ts.net?x=1", False), ("ftp://tour.ts.net", False), ("", False),
])
def test_gateway_url_rule(url, ok):
    assert (dev.gateway_url_problem(url) is None) == ok


def test_help_runs_without_dependencies():
    out = subprocess.run([sys.executable, str(ROOT / "scripts" / "dev.py"), "--help"],
                         capture_output=True, text=True, check=True).stdout
    assert "--mode {online,local,tour}" in out and "--demo" in out


def test_gateway_answers_detects_a_running_gateway():
    class Health(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200 if self.path == "/api/health" else 404)
            self.end_headers()
            self.wfile.write(b'{"app": "TERMINAL"}')

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Health)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}"
        assert dev.gateway_answers(url) and dev.gateway_answers(url + "/")
    finally:
        server.shutdown()
        server.server_close()
    assert not dev.gateway_answers(url, timeout_s=0.5)  # plus personne
    assert not dev.gateway_answers("pas une adresse")
