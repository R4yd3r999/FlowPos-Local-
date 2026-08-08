"""
Regla de negocio: no se puede vender sin caja abierta. Ver punto 0.1
del roadmap -- antes de esta corrección, las cuentas podían crearse
sin caja abierta y esas ventas quedaban huérfanas de cualquier cierre.
"""
from __future__ import annotations

import sqlite3

from app.errors import ConflictError
from app.services import inventario


def verificar_caja_abierta(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT id FROM cierres_caja WHERE estado = 'abierto' LIMIT 1").fetchone()
    if row is None:
        raise ConflictError(
            "La caja no está abierta. Ve a 'Cierre de caja' y ábrela antes de registrar ventas."
        )


# ---------------------------------------------------------------------
# Cálculos de un período de caja (desde apertura hasta cierre, o hasta
# ahora si sigue abierta). Vivían duplicados/privados dentro del router
# de cierre; se centralizan acá para que reportes.py (exportación
# xlsx/pdf de un día) pueda reusar exactamente la misma fuente de
# verdad que ya se muestra en pantalla -- nunca dos cálculos distintos
# del mismo número.
# ---------------------------------------------------------------------

def resumen_periodo(conn: sqlite3.Connection, desde: str, hasta: str | None) -> dict:
    """Desglose de pagos por método/moneda/subtipo dentro de un rango de tiempo. Se calcula
    siempre desde `pagos`, nunca desde un campo cacheado -- así nunca puede desincronizarse."""
    query = """SELECT metodo, moneda, subtipo, COUNT(*) AS cantidad,
                      SUM(monto) AS monto_total, SUM(monto_cup_equivalente) AS monto_cup_total
               FROM pagos WHERE registrado_at >= ?"""
    params: list = [desde]
    if hasta:
        query += " AND registrado_at <= ?"
        params.append(hasta)
    query += " GROUP BY metodo, moneda, subtipo ORDER BY metodo, moneda"
    filas = [dict(r) for r in conn.execute(query, params).fetchall()]

    total_cup = sum(f["monto_cup_total"] for f in filas)
    efectivo_cup = sum(
        f["monto_cup_total"] for f in filas if f["metodo"] == "efectivo" and f["moneda"] == "CUP"
    )
    return {"desglose": filas, "total_cup_equivalente": total_cup, "efectivo_cup": efectivo_cup}


def ventas_periodo(conn: sqlite3.Connection, desde: str, hasta: str | None) -> list[dict]:
    query = """
        SELECT ci.id, c.referencia, p.nombre AS producto, ci.cantidad,
               ci.precio_unitario_aplicado, ci.estado, ci.agregado_at, ci.motivo_cancelacion
        FROM cuenta_items ci
        JOIN cuentas c ON c.id = ci.cuenta_id
        JOIN productos p ON p.id = ci.producto_id
        WHERE ci.agregado_at >= ?
    """
    params: list = [desde]
    if hasta:
        query += " AND ci.agregado_at <= ?"
        params.append(hasta)
    query += " ORDER BY ci.agregado_at"
    filas = []
    for r in conn.execute(query, params).fetchall():
        d = dict(r)
        d["subtotal"] = d["precio_unitario_aplicado"] * d["cantidad"]
        filas.append(d)
    return filas


def pagos_detalle_periodo(conn: sqlite3.Connection, desde: str, hasta: str | None) -> list[dict]:
    """Pagos uno por uno (no agregados) -- el sub-detalle que se muestra debajo de cada
    fila agregada de /resumen, para poder ver cuándo y de cuánto fue cada pago puntual."""
    query = """
        SELECT p.id, c.referencia, p.metodo, p.moneda, p.subtipo, p.monto, p.monto_cup_equivalente, p.registrado_at
        FROM pagos p
        JOIN cuentas c ON c.id = p.cuenta_id
        WHERE p.registrado_at >= ?
    """
    params: list = [desde]
    if hasta:
        query += " AND p.registrado_at <= ?"
        params.append(hasta)
    query += " ORDER BY p.registrado_at"
    return [dict(r) for r in conn.execute(query, params).fetchall()]


def movimientos_periodo(conn: sqlite3.Connection, desde: str, hasta: str | None) -> list[dict]:
    """Movimientos de inventario (entradas, salidas de cualquier tipo, ajustes) dentro de un
    período de caja -- usa la misma fuente que la pestaña general de Movimientos, filtrada
    por fecha, para que el detalle de un día de caja incluya también lo que salió del
    almacén ese día, esté o no ligado a una venta."""
    rows = inventario.listar_movimientos(conn, desde=desde, hasta=hasta, limit=100000, offset=0)
    return [dict(r) for r in rows]
