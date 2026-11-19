"""scripts/bourse_password.py : format de l'empreinte lue par api/_lib/bourse/auth.ts.

Le même vecteur (sel 00..0f, 100 000 itérations) est vérifié côté TypeScript
dans api/_tests/bourse-routes.test.ts : les deux côtés doivent concorder.
"""

import base64
import hashlib
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "bourse_password", ROOT / "scripts" / "bourse_password.py")
bp = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = bp
_spec.loader.exec_module(bp)

VECTOR = "pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E"


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def test_vector_shared_with_typescript():
    got = bp.make_hash("cheval correct agrafe", salt=bytes(range(16)), iterations=100_000)
    assert got == VECTOR


def test_default_hash_format_and_check():
    h = bp.make_hash("un mot de passe assez long")
    algo, iterations, salt, digest = h.split("$")
    assert algo == "pbkdf2-sha256" and int(iterations) == bp.ITERATIONS == 600_000
    assert len(unb64(salt)) == 16 and len(unb64(digest)) == 32
    again = hashlib.pbkdf2_hmac(
        "sha256", b"un mot de passe assez long", unb64(salt), int(iterations), dklen=32)
    assert again == unb64(digest)
    assert "=" not in h   # base64url sans remplissage, comme b64url() côté TypeScript


def test_two_hashes_never_equal():
    assert bp.make_hash("même mot de passe") != bp.make_hash("même mot de passe")


def test_main_refuses_short_or_mismatched(monkeypatch, capsys):
    answers = iter(["court"])
    monkeypatch.setattr(bp.getpass, "getpass", lambda _p: next(answers))
    assert bp.main() == 1
    answers = iter(["un mot de passe assez long", "un autre mot de passe"])
    monkeypatch.setattr(bp.getpass, "getpass", lambda _p: next(answers))
    assert bp.main() == 1
    assert "BOURSE_PASSWORD_HASH" not in capsys.readouterr().out
