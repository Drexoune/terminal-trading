"""Lancement de la passerelle : python -m terminal_gateway

Arrêt propre par Ctrl+C, par signal, ou en créant le fichier d'arrêt
(<GATEWAY_LOG_DIR>/_control/gateway.stop), seul chemin qui fonctionne pour
un service lancé par une tâche planifiée Windows (même patron que drexbot).

    python -m terminal_gateway --print-config
        affiche l'adresse de santé et le fichier d'arrêt réels (environnement
        puis .env) en JSON, sans rien lancer : les scripts de deploy/windows
        s'en servent pour respecter GATEWAY_LOG_DIR et GATEWAY_PORT.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from logging.handlers import TimedRotatingFileHandler

import uvicorn

from . import STARTED_AT
from .app import create_app
from .config import Settings

STOP_POLL_S = 1.0


def setup_logging(settings: Settings) -> None:
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s : %(message)s")
    fmt.converter = __import__("time").gmtime  # journaux en UTC
    file_h = TimedRotatingFileHandler(settings.log_dir / "gateway.log", when="midnight",
                                      utc=True, backupCount=14, encoding="utf-8")
    file_h.setFormatter(fmt)
    handlers: list[logging.Handler] = [file_h]
    # Console seulement dans un terminal : sous launchd ou une tâche planifiée,
    # elle serait recopiée dans un fichier qui ne tourne jamais, en double.
    if sys.stderr.isatty():
        console = logging.StreamHandler(sys.stderr)
        console.setFormatter(fmt)
        handlers.append(console)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers[:] = handlers
    # httpx journalise chaque appel REST en INFO (≈ 7 200 lignes par jour pour
    # l'horloge et les graphiques) : seuls ses avertissements nous intéressent.
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def watch_stop_file(settings: Settings, server: uvicorn.Server) -> None:
    while not server.should_exit:
        if settings.stop_file.exists():
            logging.getLogger(__name__).info("fichier d'arrêt détecté : arrêt propre")
            server.should_exit = True
            return
        await asyncio.sleep(STOP_POLL_S)


def clear_stale_stop(settings: Settings, started_at: float = STARTED_AT) -> None:
    """Efface la demande d'arrêt laissée par un arrêt précédent, pas une demande
    déposée pendant ce démarrage (elle sera honorée dès la première seconde)."""
    try:
        if settings.stop_file.stat().st_mtime < started_at:
            settings.stop_file.unlink(missing_ok=True)
    except FileNotFoundError:
        pass


async def serve(settings: Settings) -> None:
    clear_stale_stop(settings)
    app = create_app(settings)
    config = uvicorn.Config(app, host=settings.host, port=settings.port, log_config=None,
                            ws_ping_interval=20, ws_ping_timeout=20)
    server = uvicorn.Server(config)
    watcher = asyncio.create_task(watch_stop_file(settings, server))
    try:
        await server.serve()
    finally:
        watcher.cancel()


def local_health_url(settings: Settings) -> str:
    """Adresse de /api/health depuis la machine elle-même (0.0.0.0 -> 127.0.0.1)."""
    host = "127.0.0.1" if settings.host in ("", "0.0.0.0", "::") else settings.host
    if ":" in host:
        host = f"[{host}]"
    return f"http://{host}:{settings.port}/api/health"


def print_config(settings: Settings) -> None:
    # JSON en ASCII (\u00e9 pour « é ») : lisible par PowerShell quel que soit
    # l'encodage de la console, même avec un chemin comme C:\Users\Clément.
    print(json.dumps({"health_url": local_health_url(settings),
                      "stop_file": str(settings.stop_file)}))


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else argv
    if args not in ([], ["--print-config"]):
        raise SystemExit(f"option inconnue : {' '.join(args)} (seule option : --print-config)")
    settings = Settings.from_env()
    if args:
        print_config(settings)
        return
    setup_logging(settings)
    logging.getLogger(__name__).info(
        "passerelle sur %s:%d, machine %s, mode annoncé %s, OKX %s, instruments %s",
        settings.host, settings.port, settings.machine, settings.mode_hint or "aucun",
        settings.okx_region, ", ".join(settings.instruments))
    asyncio.run(serve(settings))


if __name__ == "__main__":
    main()
