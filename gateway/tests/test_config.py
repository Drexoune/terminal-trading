"""Configuration de la passerelle : mode annoncé, origines autorisées, nom de la machine."""

import socket

import pytest
from terminal_gateway import config
from terminal_gateway.config import Settings, parse_mode_hint, parse_origins, parse_region

VERCEL = "https://terminal-clement.vercel.app"


@pytest.mark.parametrize(("raw", "expected"), [
    (None, None), ("", None), ("  ", None),
    ("local", "local"), ("tour", "tour"), (" Tour ", "tour"),
])
def test_mode_hint(raw, expected):
    assert parse_mode_hint(raw) == expected


@pytest.mark.parametrize("raw", ["online", "mac", "locale"])
def test_unknown_mode_hint_is_refused(raw):
    # Le Mode Online n'a pas de passerelle : l'annoncer serait une erreur.
    with pytest.raises(ValueError, match="GATEWAY_MODE"):
        parse_mode_hint(raw)


def test_origins_accept_vercel_domain_and_strip_trailing_slash():
    raw = f"http://localhost:5173, {VERCEL}/ ,http://127.0.0.1:5173,{VERCEL}"
    assert parse_origins(raw) == ("http://localhost:5173", VERCEL, "http://127.0.0.1:5173")


@pytest.mark.parametrize("raw", ["*", "terminal.vercel.app", f"{VERCEL}/parametres",
                                 "ftp://example.org", f"{VERCEL}?x=1"])
def test_bad_origins_are_refused(raw):
    with pytest.raises(ValueError, match="GATEWAY_ALLOWED_ORIGINS"):
        parse_origins(raw)


@pytest.fixture
def clean_env(monkeypatch, tmp_path):
    """Environnement vide de toute variable de la passerelle, sans .env du dépôt."""
    for name in ("OKX_REGION", "OKX_INSTRUMENTS", "GATEWAY_HOST", "GATEWAY_PORT",
                 "GATEWAY_ALLOWED_ORIGINS", "GATEWAY_LOG_DIR", "GATEWAY_MODE"):
        # setenv puis delenv : la valeur d'origine est mémorisée, donc ce que
        # load_dotenv écrit dans os.environ pendant le test est retiré après.
        monkeypatch.setenv(name, "")
        monkeypatch.delenv(name)
    monkeypatch.setattr(config, "ROOT", tmp_path)  # .env absent
    return monkeypatch


def test_from_env_defaults(clean_env, tmp_path):
    s = Settings.from_env()
    assert s.mode_hint is None
    assert s.machine == socket.gethostname()
    assert s.allowed_origins == ("http://localhost:5173", "http://127.0.0.1:5173")
    assert s.stop_file == tmp_path / "logs" / "_control" / "gateway.stop"
    assert (s.host, s.port) == ("127.0.0.1", 8710)


def test_from_env_reads_mode_and_vercel_origin(clean_env):
    clean_env.setenv("GATEWAY_MODE", "tour")
    clean_env.setenv("GATEWAY_ALLOWED_ORIGINS", f"http://localhost:5173,{VERCEL}/")
    s = Settings.from_env()
    assert s.mode_hint == "tour"
    assert s.allowed_origins == ("http://localhost:5173", VERCEL)


def test_environment_wins_over_dotenv(clean_env, tmp_path):
    # L'agent launchd pose GATEWAY_MODE=local : un .env recopié de la tour ne l'écrase pas.
    (tmp_path / ".env").write_text("GATEWAY_MODE=tour\nGATEWAY_PORT=8711\n", encoding="utf-8")
    clean_env.setenv("GATEWAY_MODE", "local")
    s = Settings.from_env()
    assert s.mode_hint == "local" and s.port == 8711


@pytest.mark.parametrize(("raw", "expected"), [
    (None, "eea"), ("", "eea"), ("eea", "eea"), (" EEA ", "eea"), ("global", "global")])
def test_region(raw, expected):
    assert parse_region(raw) == expected


@pytest.mark.parametrize("raw", ["eu", "europe", "us"])
def test_unknown_region_is_refused_at_load(clean_env, raw):
    # Refusée dès la configuration : installer-local.sh la valide avant de lancer l'agent.
    clean_env.setenv("OKX_REGION", raw)
    with pytest.raises(ValueError, match="OKX_REGION"):
        Settings.from_env()
