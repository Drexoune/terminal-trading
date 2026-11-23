"""Services de la passerelle (docs/plan-p1.md § 5).

Chaque service a un nom, `start()`, `stop()` et `health()`. La passerelle
démarre ceux que GATEWAY_SERVICES active, dans l'ordre, et les arrête dans
l'ordre inverse. Un service qui a besoin de la base SQLite le déclare
(`needs_storage = True`) : la base n'est ouverte que si l'un d'eux l'exige.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .bus import Bus
from .config import Settings
from .storage import Storage


@runtime_checkable
class Service(Protocol):
    name: str

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    def health(self) -> dict: ...


# Étape de P1 où chaque service arrive (docs/plan-p1.md § 13).
PLANNED = {"news": "E6", "alert": "E4"}


def build_services(settings: Settings, bus: Bus, storage: Storage | None) -> list[Service]:
    """Instancie les services activés ; un service prévu mais pas encore livré est refusé."""
    out: list[Service] = []
    for name in settings.services:
        if name == "okx":
            from .okx_service import OkxService
            out.append(OkxService(bus, settings.okx_region, settings.instruments, settings.log_dir))
        elif name == "calendar":
            from .calendar_service import CalendarService
            if storage is None:
                raise ValueError("service calendar : base SQLite requise")
            out.append(CalendarService(bus, storage, settings))
        elif name == "release":
            from .release_service import ReleaseService
            if storage is None:
                raise ValueError("service release : base SQLite requise")
            out.append(ReleaseService(bus, storage, settings))
        else:
            raise ValueError(f"GATEWAY_SERVICES : le service « {name} » arrive en {PLANNED[name]}")
    return out


def needs_storage(services: list[Service]) -> bool:
    return any(getattr(s, "needs_storage", False) for s in services)
