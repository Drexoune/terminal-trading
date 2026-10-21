"""Configuration par variables d'environnement (fichier .env facultatif, jamais versionné)."""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from terminal_collectors.okx.endpoints import REGIONS

ROOT = Path(__file__).resolve().parents[2]

# Modes où une passerelle tourne (docs/modes.md) ; le Mode Online n'en a pas.
GATEWAY_MODES = ("local", "tour")


def load_dotenv(path: Path) -> None:
    """Charge un .env simple (CLE=valeur) sans écraser l'environnement existant."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def parse_mode_hint(raw: str | None) -> str | None:
    """GATEWAY_MODE : « local » (Mac) ou « tour » (tour Windows), sinon absent.

    Simple indication publiée dans /api/health et gateway:meta : le mode reste
    choisi dans le navigateur (écran Paramètres) ; la passerelle dit seulement
    où elle tourne. Une valeur inconnue est une erreur de configuration : on
    refuse de démarrer plutôt que d'afficher une indication fausse.
    """
    value = (raw or "").strip().lower()
    if not value:
        return None
    if value not in GATEWAY_MODES:
        raise ValueError(f"GATEWAY_MODE invalide : {raw!r} (attendu : local, tour, ou absent)")
    return value


def parse_region(raw: str | None) -> str:
    """OKX_REGION : « eea » (compte européen, défaut) ou « global ».

    Vérifiée au chargement : une faute de frappe arrête la passerelle avec un
    message clair, au lieu d'une erreur plus tard au démarrage du service.
    """
    value = (raw or "eea").strip().lower() or "eea"
    if value not in REGIONS:
        raise ValueError(f"OKX_REGION invalide : {raw!r} (attendu : {', '.join(REGIONS)})")
    return value


def parse_origins(raw: str) -> tuple[str, ...]:
    """GATEWAY_ALLOWED_ORIGINS : origines exactes, séparées par des virgules.

    Le navigateur envoie une origine sans chemin ni « / » final
    (« https://terminal.vercel.app ») : un « / » final recopié depuis la barre
    d'adresse est retiré, sinon l'origine ne correspondrait jamais. « * » et
    les adresses avec chemin sont refusés : la WebSocket compare l'origine
    exacte, un joker ouvrirait le CORS à n'importe quel site.
    """
    out: list[str] = []
    for item in raw.split(","):
        origin = item.strip().rstrip("/")
        if not origin:
            continue
        parts = urlsplit(origin)
        if (origin == "*" or parts.scheme not in ("http", "https") or not parts.netloc
                or parts.path or parts.query or parts.fragment):
            raise ValueError(f"GATEWAY_ALLOWED_ORIGINS : origine invalide {item.strip()!r} "
                             "(attendu : https://hote[:port], sans chemin)")
        if origin not in out:
            out.append(origin)
    return tuple(out)


@dataclass(frozen=True)
class Settings:
    okx_region: str
    instruments: tuple[str, ...]
    host: str
    port: int
    allowed_origins: tuple[str, ...]
    log_dir: Path
    stop_file: Path
    # Machine qui sert la passerelle (nom d'hôte du Mac ou de la tour), affichée
    # par /api/health et gateway:meta.
    machine: str = field(default_factory=socket.gethostname)
    # Mode annoncé par GATEWAY_MODE (« local », « tour ») ; None si absent.
    mode_hint: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        load_dotenv(ROOT / ".env")
        env = os.environ.get
        log_dir = Path(env("GATEWAY_LOG_DIR", "logs"))
        if not log_dir.is_absolute():
            log_dir = ROOT / log_dir
        return cls(
            okx_region=parse_region(env("OKX_REGION")),
            instruments=tuple(i.strip() for i in
                              env("OKX_INSTRUMENTS", "BTC-USDT-SWAP,ETH-USDT-SWAP").split(",")
                              if i.strip()),
            host=env("GATEWAY_HOST", "127.0.0.1"),
            port=int(env("GATEWAY_PORT", "8710")),
            allowed_origins=parse_origins(env("GATEWAY_ALLOWED_ORIGINS",
                                              "http://localhost:5173,http://127.0.0.1:5173")),
            log_dir=log_dir,
            stop_file=log_dir / "_control" / "gateway.stop",
            mode_hint=parse_mode_hint(env("GATEWAY_MODE")),
        )
