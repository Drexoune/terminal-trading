"""Le fichier doré des calculs de P1 (API v1, surprise, z) suit le code Python (O3).
Si ce test échoue après une modification voulue : .venv/bin/python scripts/make_p1_math_golden.py,
puis les tests Vitest (supabase/functions/p1-jobs/p1_math.test.ts)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_math_golden_file_is_up_to_date():
    spec = importlib.util.spec_from_file_location("make_p1_math_golden",
                                                  ROOT / "scripts" / "make_p1_math_golden.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.read_text(encoding="utf-8") == mod.render()
