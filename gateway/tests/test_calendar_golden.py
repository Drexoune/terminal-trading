"""Le fichier doré de l'agenda suit le code Python (plan « Tout en ligne », O2).

golden.json fige les sorties de calendar_data.py ; supabase/functions/p1-jobs/calendar.test.ts
vérifie que le portage TypeScript les redonne. Si ce test échoue après une modification
voulue du code Python : .venv/bin/python scripts/make_calendar_golden.py, puis les tests Vitest."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_golden_file_is_up_to_date():
    spec = importlib.util.spec_from_file_location("make_calendar_golden",
                                                  ROOT / "scripts" / "make_calendar_golden.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.read_text(encoding="utf-8") == mod.render()
