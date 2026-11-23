"""Le fichier doré des règles d'alerte suit le code Python (O4). Si ce test échoue après une
modification voulue : .venv/bin/python scripts/make_alerts_golden.py, puis les tests Vitest."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_alerts_golden_file_is_up_to_date():
    spec = importlib.util.spec_from_file_location("make_alerts_golden",
                                                  ROOT / "scripts" / "make_alerts_golden.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.read_text(encoding="utf-8") == mod.render()
