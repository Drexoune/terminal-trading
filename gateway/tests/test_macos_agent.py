"""deploy/macos : agent launchd du Mode Local (plist générée, scripts d'installation et d'arrêt).

launchd n'existe que sous macOS : ici, la plist est relue avec plistlib et les
scripts tournent contre un launchctl simulé (fixtures/macos_stubs), qui lance
la vraie passerelle. Le comportement du vrai launchd reste à vérifier sur le Mac.
"""

import os
import plistlib
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
MACOS = ROOT / "deploy" / "macos"
STUBS = Path(__file__).parent / "fixtures" / "macos_stubs"
SCRIPTS = sorted(MACOS.glob("*.sh"))
BASH = shutil.which("bash")

pytestmark = pytest.mark.skipif(BASH is None or sys.platform == "win32",
                                reason="scripts bash (macOS) : pas de bash ici")


def render(macos_dir: Path = MACOS) -> dict:
    out = subprocess.run([BASH, str(macos_dir / "installer-local.sh"), "--afficher"],
                         capture_output=True, check=True)
    return plistlib.loads(out.stdout)


def test_scripts_parse():
    assert {p.name for p in SCRIPTS} >= {"installer-local.sh", "arreter-local.sh",
                                         "desinstaller-local.sh", "_commun.sh"}
    for script in SCRIPTS:
        subprocess.run([BASH, "-n", str(script)], check=True)


def test_rendered_plist():
    d = render()
    assert d["Label"] == "com.terminal-trading.gateway"
    assert d["ProgramArguments"] == [str(ROOT / ".venv" / "bin" / "python"), "-m",
                                     "terminal_gateway"]
    assert d["WorkingDirectory"] == str(ROOT)
    assert d["EnvironmentVariables"]["GATEWAY_MODE"] == "local"
    assert d["RunAtLoad"] is True
    # Relancée après un plantage, jamais après un arrêt propre (code 0).
    assert d["KeepAlive"] == {"SuccessfulExit": False}
    assert d["ThrottleInterval"] >= 10
    assert d["ProcessType"] == "Background"
    assert d["StandardErrorPath"] == str(ROOT / "logs" / "gateway-launchd.log")


def test_plist_survives_awkward_paths(tmp_path: Path):
    # Espace et « & » dans le chemin du dépôt : la plist reste du XML valide.
    root = tmp_path / "Mes projets & essais" / "terminal-trading"
    shutil.copytree(MACOS, root / "deploy" / "macos")
    d = render(root / "deploy" / "macos")
    assert d["WorkingDirectory"] == str(root)
    assert d["ProgramArguments"][0] == str(root / ".venv" / "bin" / "python")


@pytest.mark.skipif(sys.platform == "darwin", reason="vrai macOS : refus non testable")
@pytest.mark.parametrize("name", ["installer-local.sh", "arreter-local.sh",
                                  "desinstaller-local.sh"])
def test_scripts_refuse_other_systems(name):
    r = subprocess.run([BASH, str(MACOS / name)], capture_output=True, text=True)
    assert r.returncode == 1 and "macOS" in r.stderr


def test_help_and_unknown_option():
    r = subprocess.run([BASH, str(MACOS / "arreter-local.sh"), "--help"],
                       capture_output=True, text=True, check=True)
    assert "fichier d'arrêt" in r.stdout and not r.stdout.startswith("!")
    r = subprocess.run([BASH, str(MACOS / "installer-local.sh"), "--nimporte"],
                       capture_output=True, text=True)
    assert r.returncode == 1 and "option inconnue" in r.stderr


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def mac(tmp_path: Path):
    """Environnement « macOS simulé » : HOME isolé, launchctl simulé, port libre."""
    python = ROOT / ".venv" / "bin" / "python"
    if not python.exists():
        pytest.skip("pas de .venv à la racine du dépôt (la plist pointe sur .venv/bin/python)")
    bin_dir = tmp_path / "bin"
    shutil.copytree(STUBS, bin_dir)
    for stub in bin_dir.iterdir():
        stub.chmod(0o755)
    state = tmp_path / "state"
    state.mkdir()
    (tmp_path / "home").mkdir()
    env = {**os.environ, "HOME": str(tmp_path / "home"),
           "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "SIM_STATE": str(state),
           "GATEWAY_PORT": str(free_port()), "GATEWAY_LOG_DIR": str(tmp_path / "logs")}
    env.pop("GATEWAY_MODE", None)
    launchd_log = ROOT / "logs" / "gateway-launchd.log"
    had_log = launchd_log.exists()
    yield env, tmp_path
    # Filet de sécurité : aucune passerelle ne survit au test.
    for pid_file in state.glob("*.pid"):
        try:
            os.kill(int(pid_file.read_text()), signal.SIGKILL)
        except (ProcessLookupError, ValueError):
            pass
    if not had_log:
        launchd_log.unlink(missing_ok=True)


def run(script: str, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run([BASH, str(MACOS / script)], env=env, capture_output=True, text=True,
                          timeout=120)


def test_install_stop_uninstall_cycle(mac):
    env, tmp = mac
    plist = tmp / "home" / "Library" / "LaunchAgents" / "com.terminal-trading.gateway.plist"

    r = run("installer-local.sh", env)
    assert r.returncode == 0, r.stdout + r.stderr
    assert plist.exists()
    assert "mode annoncé : local" in r.stdout

    # Réinstallation : arrêt propre de l'agent chargé, puis rechargement.
    r = run("installer-local.sh", env)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "Passerelle arrêtée proprement" in r.stdout

    r = run("arreter-local.sh", env)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "Passerelle arrêtée proprement" in r.stdout
    # Arrêt par le fichier d'arrêt : bootout n'a pas eu besoin d'envoyer SIGTERM.
    calls = (tmp / "state" / "calls.log").read_text()
    assert "SIGTERM" not in calls
    assert "fichier d'arrêt détecté" in (tmp / "logs" / "gateway.log").read_text()
    assert not (tmp / "logs" / "_control" / "gateway.stop").exists()

    r = run("arreter-local.sh", env)
    assert r.returncode == 0 and "rien à arrêter" in r.stdout

    r = run("desinstaller-local.sh", env)
    assert r.returncode == 0 and not plist.exists()


def test_install_refuses_when_port_is_taken(mac):
    env, _ = mac
    port = int(env["GATEWAY_PORT"])
    other = subprocess.Popen([sys.executable, str(ROOT / "web" / "e2e" / "fake_gateway.py"),
                              "--port", str(port)], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    break
            time.sleep(0.1)
        r = run("installer-local.sh", env)
        assert r.returncode == 1 and "répond déjà" in r.stderr
    finally:
        other.terminate()
        other.wait(timeout=10)
