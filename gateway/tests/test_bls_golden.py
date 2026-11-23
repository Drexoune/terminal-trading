"""Le fichier doré du parseur BLS suit le code Python (plan « Tout en ligne », O3).

golden_parser.json fige toute la lecture de bls_release.py sur le corpus réel ;
supabase/functions/p1-jobs/bls_release.test.ts vérifie que le portage TypeScript la redonne.
Si ce test échoue après une modification voulue du parseur Python :
.venv/bin/python scripts/make_bls_golden.py, puis les tests Vitest."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_parser_golden_file_is_up_to_date():
    spec = importlib.util.spec_from_file_location("make_bls_golden",
                                                  ROOT / "scripts" / "make_bls_golden.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.read_text(encoding="utf-8") == mod.render()
