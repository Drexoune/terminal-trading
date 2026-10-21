"""Le fichier doré du parseur OKX est à jour.

parsed_golden.json fige les sorties de parse.py ; web/src/data/okx/parse.test.ts
vérifie que le portage TypeScript (Mode Online) les reproduit à l'identique.
Si ce test échoue, parse.py ou les messages enregistrés ont changé : relancer
scripts/make_okx_golden.py, puis les tests Vitest du portage.
"""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = Path(__file__).parent / "fixtures"


def load_script():
    spec = importlib.util.spec_from_file_location("make_okx_golden",
                                                  ROOT / "scripts" / "make_okx_golden.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_golden_file_is_up_to_date():
    golden = load_script().build()
    on_disk = json.loads((FIX / "parsed_golden.json").read_text(encoding="utf-8"))
    assert on_disk == golden, "fichier doré périmé : relancer scripts/make_okx_golden.py"


def test_golden_covers_every_recorded_message_and_every_kind():
    recorded = json.loads((FIX / "ws_messages.json").read_text(encoding="utf-8"))
    cases = json.loads((FIX / "parsed_golden.json").read_text(encoding="utf-8"))["cases"]
    names = {c["name"] for c in cases}
    for group, items in recorded.items():
        for i in range(len(items)):
            assert f"{group}#{i}" in names
    kinds = {e["kind"] for c in cases for e in c.get("events", [])}
    assert kinds == {"trade", "ticker", "funding", "open_interest", "candle"}
    controls = {c["control"]["event"] for c in cases if "control" in c}
    assert {"subscribe", "error", "notice", "pong", "unknown"} <= controls
