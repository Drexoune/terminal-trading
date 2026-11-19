"""Produit les deux variables du mot de passe du module Bourse (décision T-031).

    python scripts/bourse_password.py

Demande le mot de passe deux fois sans l'afficher, puis imprime :

    BOURSE_PASSWORD_HASH=pbkdf2-sha256$600000$<sel>$<empreinte>
    BOURSE_SESSION_SECRET=<48 caractères aléatoires>

À coller dans les variables d'environnement de Vercel (type Secret, toutes les
cibles) et, pour le développement, dans le .env du Mac. Le mot de passe
lui-même n'est écrit nulle part. Changer BOURSE_SESSION_SECRET ferme toutes les
sessions ouvertes. Vérification côté serveur : api/_lib/bourse/auth.ts.
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import secrets
import sys

ITERATIONS = 600_000
MIN_LENGTH = 12


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def make_hash(password: str, salt: bytes | None = None, iterations: int = ITERATIONS) -> str:
    salt = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
    return f"pbkdf2-sha256${iterations}${b64url(salt)}${b64url(digest)}"


def main() -> int:
    password = getpass.getpass("Mot de passe du module Bourse : ")
    if len(password) < MIN_LENGTH:
        print(f"Trop court : {MIN_LENGTH} caractères au moins.", file=sys.stderr)
        return 1
    if getpass.getpass("Le retaper : ") != password:
        print("Les deux saisies diffèrent.", file=sys.stderr)
        return 1
    print("\nÀ coller dans Vercel (Settings > Environment Variables, type Secret) :\n")
    print(f"BOURSE_PASSWORD_HASH={make_hash(password)}")
    print(f"BOURSE_SESSION_SECRET={secrets.token_urlsafe(36)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
