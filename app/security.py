"""
Hash de PIN con PBKDF2-HMAC-SHA256 (stdlib, sin dependencias extra).
No se guarda el PIN en texto plano en ningún caso.
"""
from __future__ import annotations

import hashlib
import os

ITERATIONS = 260_000


def hash_pin(pin: str) -> tuple[str, str]:
    """Devuelve (hash_hex, salt_hex)."""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, ITERATIONS)
    return digest.hex(), salt.hex()


def verify_pin(pin: str, hash_hex: str, salt_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, ITERATIONS)
    return digest.hex() == hash_hex
