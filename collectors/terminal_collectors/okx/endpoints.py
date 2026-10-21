"""Domaines OKX par région.

Doc OKX v5, « Regional API Domain Requirement » : un compte ouvert sur
my.okx.com (entité européenne) doit utiliser eea.okx.com pour le REST et
wseea.okx.com pour les WebSockets ; openapi.okx.com ne fonctionne pas pour lui.
Les deux domaines publient les mêmes perpétuels BTC et ETH (vérifié le
20/10/2026 avec /api/v5/public/instruments).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Endpoints:
    rest: str
    ws_public: str
    ws_business: str


REGIONS: dict[str, Endpoints] = {
    "eea": Endpoints(
        rest="https://eea.okx.com",
        ws_public="wss://wseea.okx.com/ws/v5/public",
        ws_business="wss://wseea.okx.com/ws/v5/business",
    ),
    "global": Endpoints(
        rest="https://openapi.okx.com",
        ws_public="wss://ws.okx.com/ws/v5/public",
        ws_business="wss://ws.okx.com/ws/v5/business",
    ),
}


def endpoints(region: str) -> Endpoints:
    try:
        return REGIONS[region]
    except KeyError:
        raise ValueError(f"région OKX inconnue : {region!r} "
                         f"(attendu : {', '.join(REGIONS)})") from None
