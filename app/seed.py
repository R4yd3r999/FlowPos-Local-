"""
Se ejecuta una sola vez, la primera vez que arranca la aplicación
(cuando data/pos.db todavía no existe).

A propósito NO crea productos, insumos ni mesas de ejemplo: el negocio
real carga su propio catálogo desde cero, para no tener que borrar
datos de prueba antes de empezar a usarlo en serio.

Sí crea dos cosas imprescindibles:
1. La cuenta Gerente real (única -- el sistema no ofrece crear una
   segunda desde la interfaz a propósito).
2. El producto de sistema "Tiempo de billar", que usa internamente el
   cobro de las mesas de billar. No es catálogo de negocio, es un
   requisito técnico -- por eso se crea igual aunque todo lo demás
   quede vacío.
"""
from __future__ import annotations

from app.db import get_connection
from app.security import hash_pin

# Ver el mensaje que imprime app/main.py al arrancar por primera vez:
# este PIN se muestra una sola vez en la consola como respaldo.
PIN_INICIAL_GERENTE = "963400"


def poblar_datos_iniciales() -> None:
    conn = get_connection()
    try:
        _crear_usuario_gerente(conn)
        _crear_producto_billar(conn)
        conn.commit()
    finally:
        conn.close()


def _crear_usuario_gerente(conn) -> None:
    pin_hash, pin_salt = hash_pin(PIN_INICIAL_GERENTE)
    conn.execute(
        "INSERT INTO usuarios (nombre, rol, pin_hash, pin_salt) VALUES (?, ?, ?, ?)",
        ("Gerente", "gerente", pin_hash, pin_salt),
    )


def _crear_producto_billar(conn) -> None:
    conn.execute(
        """INSERT INTO productos (nombre, categoria, tipo, precio_venta)
           VALUES ('Tiempo de billar', 'servicio', 'servicio', 0)"""
    )
