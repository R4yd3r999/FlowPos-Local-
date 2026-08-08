"""
Agregaciones para el Dashboard (ventas por día, productos más vendidos,
margen por producto). Todo se calcula al vuelo desde las mismas tablas
que ya alimentan Ventas y Cierre de caja -- no hay una tabla resumen
aparte que se pueda desincronizar del resto del sistema.

El margen usa el costo promedio de cada insumo en el momento de la
consulta (no el costo histórico de cuando se vendió) -- es una
aproximación a propósito: llevar costo histórico exacto por venta
requeriría congelar el costo de cada insumo en cada cuenta_item al
venderse, lo cual no se pidió y complicaría el modelo. Para un negocio
con costos relativamente estables día a día, esta aproximación es
razonable; si los costos cambian mucho, el margen de días viejos se
recalcula con el costo de hoy.
"""
from __future__ import annotations

import datetime
import sqlite3


def _rango_por_defecto(desde: str | None, hasta: str | None) -> tuple[str, str]:
    if hasta is None:
        hasta = datetime.date.today().isoformat()
    if desde is None:
        desde = (datetime.date.fromisoformat(hasta) - datetime.timedelta(days=29)).isoformat()
    return desde, hasta


def serie_ingresos_diarios(conn: sqlite3.Connection, desde: str, hasta: str) -> list[dict]:
    """Ingresos reales (pagos recibidos) por día, en CUP equivalente.
    Se basa en pagos -- dinero que efectivamente entró -- no en ventas
    facturadas, para que coincida con lo que ya se ve en Cierre de caja."""
    filas = conn.execute(
        """
        SELECT date(registrado_at) AS fecha,
               SUM(monto_cup_equivalente) AS ingresos_cup,
               COUNT(*) AS cantidad_pagos
        FROM pagos
        WHERE date(registrado_at) BETWEEN ? AND ?
        GROUP BY date(registrado_at)
        """,
        (desde, hasta),
    ).fetchall()
    por_fecha = {f["fecha"]: dict(f) for f in filas}

    # Rellenar días sin ventas con 0 -- así el gráfico no salta fechas,
    # que es fácil de malinterpretar como "faltan datos".
    serie = []
    d = datetime.date.fromisoformat(desde)
    fin = datetime.date.fromisoformat(hasta)
    while d <= fin:
        clave = d.isoformat()
        fila = por_fecha.get(clave, {"ingresos_cup": 0, "cantidad_pagos": 0})
        serie.append({"fecha": clave, "ingresos_cup": fila["ingresos_cup"] or 0, "cantidad_pagos": fila["cantidad_pagos"] or 0})
        d += datetime.timedelta(days=1)
    return serie


def productos_del_periodo(conn: sqlite3.Connection, desde: str, hasta: str) -> list[dict]:
    """Por producto: cantidad vendida, ingresos, costo unitario (según
    receta y costo promedio actual de cada insumo) y margen. Solo
    cuenta ítems confirmados -- lo cancelado no fue una venta real."""
    filas = conn.execute(
        """
        SELECT
            p.id AS producto_id,
            p.nombre AS producto_nombre,
            p.categoria,
            SUM(ci.cantidad) AS cantidad_vendida,
            SUM(ci.precio_unitario_aplicado * ci.cantidad) AS ingresos_cup,
            COALESCE(costo.costo_unitario, 0) AS costo_unitario_cup
        FROM cuenta_items ci
        JOIN productos p ON p.id = ci.producto_id
        LEFT JOIN (
            SELECT r.producto_id, SUM(r.cantidad_requerida * i.costo_promedio) AS costo_unitario
            FROM recetas r
            JOIN insumos i ON i.id = r.insumo_id
            GROUP BY r.producto_id
        ) costo ON costo.producto_id = p.id
        WHERE ci.estado = 'confirmado'
          AND date(ci.agregado_at) BETWEEN ? AND ?
        GROUP BY p.id
        ORDER BY ingresos_cup DESC
        """,
        (desde, hasta),
    ).fetchall()

    resultado = []
    for f in filas:
        d = dict(f)
        costo_total = d["costo_unitario_cup"] * d["cantidad_vendida"]
        margen_total = d["ingresos_cup"] - costo_total
        margen_pct = (margen_total / d["ingresos_cup"] * 100) if d["ingresos_cup"] else None
        d["costo_total_cup"] = costo_total
        d["margen_total_cup"] = margen_total
        d["margen_pct"] = round(margen_pct, 1) if margen_pct is not None else None
        resultado.append(d)
    return resultado


def resumen(conn: sqlite3.Connection, desde: str | None, hasta: str | None) -> dict:
    desde, hasta = _rango_por_defecto(desde, hasta)
    serie = serie_ingresos_diarios(conn, desde, hasta)
    productos = productos_del_periodo(conn, desde, hasta)

    ingresos_total = sum(d["ingresos_cup"] for d in serie)
    dias_con_ventas = sum(1 for d in serie if d["ingresos_cup"] > 0)
    # No existe una columna "total" cacheada en cuentas -- se computa
    # igual que en /cuentas/{id} (dinámicamente desde cuenta_items),
    # para no arriesgarse a que este número diverja del real.
    cuentas_cerradas = conn.execute(
        """
        SELECT COUNT(DISTINCT c.id) AS n, COALESCE(SUM(ci.precio_unitario_aplicado * ci.cantidad), 0) AS total
        FROM cuentas c
        JOIN cuenta_items ci ON ci.cuenta_id = c.id AND ci.estado = 'confirmado'
        WHERE c.estado = 'cerrada' AND date(c.cerrada_at) BETWEEN ? AND ?
        """,
        (desde, hasta),
    ).fetchone()

    return {
        "desde": desde,
        "hasta": hasta,
        "serie_diaria": serie,
        "productos": productos,
        "totales": {
            "ingresos_cup": ingresos_total,
            "dias_con_ventas": dias_con_ventas,
            "cuentas_cerradas": cuentas_cerradas["n"],
            "ticket_promedio_cup": (cuentas_cerradas["total"] // cuentas_cerradas["n"]) if cuentas_cerradas["n"] else 0,
            "margen_total_cup": sum(p["margen_total_cup"] for p in productos),
        },
    }
