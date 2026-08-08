"""
Dependencias de FastAPI. Una conexión nueva por request.

IMPORTANTE: el código después del `yield` en una dependencia de FastAPI
se ejecuta DESPUÉS de que la respuesta ya fue enviada al cliente (así
lo documenta FastAPI). Por eso el commit real de cada escritura se hace
de forma explícita dentro de cada endpoint, no aquí. Este commit()
de aquí es solo una red de seguridad para no dejar transacciones
colgadas si algún endpoint futuro olvida hacerlo.
"""
from __future__ import annotations

import sqlite3
from typing import Iterator

from app.db import get_connection


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
