"""Passerelle du terminal : une WebSocket multiplexée et quelques routes REST."""

import time as _time

# Heure de lancement, relevée le plus tôt possible : une demande d'arrêt plus
# récente que ce lancement ne doit pas être effacée au démarrage (__main__.py).
STARTED_AT = _time.time()

APP_NAME = "TERMINAL"
VERSION = "0.0.1"
