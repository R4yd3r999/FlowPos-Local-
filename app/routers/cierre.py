from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.deps import get_conn
from app.errors import ConflictError, NotFoundError
from app.roles import PUEDE_OPERAR_CAJA
from app.routers.auth import require_role
from app.schemas import AbrirCierreRequest, CerrarCierreRequest
from app.services import caja as caja_service
from app.services import conteo as conteo_service

router = APIRouter(prefix="/cierre-caja", tags=["cierre-caja"])

# Los cálculos de un período (resumen de pagos, ventas, pagos uno por uno,
# movimientos de inventario) viven en app/services/caja.py -- reportes.py
# los reusa tal cual para exportar exactamente lo mismo que se ve en pantalla.
_resumen_periodo = caja_service.resumen_periodo
_ventas_periodo = caja_service.ventas_periodo
_pagos_detalle_periodo = caja_service.pagos_detalle_periodo


@router.get("/actual")
def cierre_actual(conn: sqlite3.Connection = Depends(get_conn)) -> dict | None:
    # Sin restricción de rol a propósito: todos los roles necesitan saber
    # si la caja está abierta para poder vender (es un semáforo operativo,
    # no un reporte financiero). El detalle financiero sí está protegido
    # más abajo, en /resumen, /detalle y en el listado histórico.
    row = conn.execute("SELECT * FROM cierres_caja WHERE estado = 'abierto' LIMIT 1").fetchone()
    return dict(row) if row else None


@router.get("")
def listar_cierres(usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    require_role(conn, usuario_id, *PUEDE_OPERAR_CAJA)
    rows = conn.execute("SELECT * FROM cierres_caja ORDER BY fecha DESC, id DESC").fetchall()
    return [dict(r) for r in rows]


@router.post("/abrir", status_code=201)
def abrir_cierre(payload: AbrirCierreRequest, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    require_role(conn, payload.usuario_id, *PUEDE_OPERAR_CAJA)
    ya_abierto = conn.execute("SELECT id FROM cierres_caja WHERE estado = 'abierto'").fetchone()
    if ya_abierto:
        raise ConflictError(
            f"Ya hay un cierre de caja abierto (id {ya_abierto['id']}). Ciérralo antes de abrir otro."
        )

    fecha = conn.execute("SELECT date('now') AS f").fetchone()["f"]
    cur = conn.execute(
        "INSERT INTO cierres_caja (fecha, abierto_por_id) VALUES (?, ?)", (fecha, payload.usuario_id)
    )
    cierre_id = cur.lastrowid

    conteos_guardados = conteo_service.procesar_conteo(
        conn,
        cierre_id=cierre_id,
        momento="apertura",
        conteos=[c.model_dump() for c in payload.conteos],
        usuario_id=payload.usuario_id,
    )
    conn.commit()

    row = conn.execute("SELECT * FROM cierres_caja WHERE id = ?", (cierre_id,)).fetchone()
    return {"cierre": dict(row), "conteo_apertura": conteos_guardados}


@router.get("/{cierre_id}/resumen")
def resumen_cierre(cierre_id: int, usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    require_role(conn, usuario_id, *PUEDE_OPERAR_CAJA)
    cierre = conn.execute("SELECT * FROM cierres_caja WHERE id = ?", (cierre_id,)).fetchone()
    if cierre is None:
        raise NotFoundError(f"Cierre {cierre_id} no existe")
    hasta = cierre["hora_cierre"]  # None si sigue abierto -> usa hasta ahora mismo
    return _resumen_periodo(conn, cierre["hora_apertura"], hasta)


@router.get("/{cierre_id}/detalle")
def detalle_cierre(cierre_id: int, usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Vista completa de un día: apertura, todo lo vendido, cierre, y los dos conteos. Pensado
    para pantalla, no para descarga -- el Excel sigue estando aparte para portabilidad."""
    require_role(conn, usuario_id, *PUEDE_OPERAR_CAJA)
    cierre = conn.execute("SELECT * FROM cierres_caja WHERE id = ?", (cierre_id,)).fetchone()
    if cierre is None:
        raise NotFoundError(f"Cierre {cierre_id} no existe")

    hasta = cierre["hora_cierre"]
    resumen = _resumen_periodo(conn, cierre["hora_apertura"], hasta)
    pagos_detalle = _pagos_detalle_periodo(conn, cierre["hora_apertura"], hasta)
    ventas = _ventas_periodo(conn, cierre["hora_apertura"], hasta)
    conteos = conteo_service.obtener_conteos(conn, cierre_id)
    # Movimientos de inventario del período: incluye TODA salida/entrada del
    # día (venta, salida manual declarada, ajuste de conteo, compra), no solo
    # lo que pasó por una cuenta. Antes esto no tenía dónde verse.
    movimientos = caja_service.movimientos_periodo(conn, cierre["hora_apertura"], hasta)

    abierto_por = conn.execute("SELECT nombre FROM usuarios WHERE id = ?", (cierre["abierto_por_id"],)).fetchone()
    cerrado_por = None
    if cierre["cerrado_por_id"]:
        cerrado_por = conn.execute("SELECT nombre FROM usuarios WHERE id = ?", (cierre["cerrado_por_id"],)).fetchone()

    return {
        "cierre": dict(cierre),
        "abierto_por_nombre": abierto_por["nombre"] if abierto_por else None,
        "cerrado_por_nombre": cerrado_por["nombre"] if cerrado_por else None,
        "resumen_pagos": resumen,
        "pagos_detalle": pagos_detalle,
        "ventas": ventas,
        "movimientos_inventario": movimientos,
        "conteo_apertura": [c for c in conteos if c["momento"] == "apertura"],
        "conteo_cierre": [c for c in conteos if c["momento"] == "cierre"],
    }


@router.post("/{cierre_id}/cerrar")
def cerrar_cierre(
    cierre_id: int, payload: CerrarCierreRequest, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    require_role(conn, payload.usuario_id, *PUEDE_OPERAR_CAJA)
    cierre = conn.execute("SELECT * FROM cierres_caja WHERE id = ?", (cierre_id,)).fetchone()
    if cierre is None:
        raise NotFoundError(f"Cierre {cierre_id} no existe")
    if cierre["estado"] != "abierto":
        raise ConflictError("Este cierre ya está cerrado")

    cuentas_abiertas = conn.execute(
        "SELECT COUNT(*) AS n FROM cuentas WHERE estado = 'abierta'"
    ).fetchone()["n"]
    if cuentas_abiertas > 0:
        raise ConflictError(
            f"Hay {cuentas_abiertas} cuenta(s) todavía abierta(s). "
            "Cóbralas y ciérralas antes de cerrar la caja del día."
        )

    conteos_guardados = conteo_service.procesar_conteo(
        conn,
        cierre_id=cierre_id,
        momento="cierre",
        conteos=[c.model_dump() for c in payload.conteos],
        usuario_id=payload.usuario_id,
    )

    resumen = _resumen_periodo(conn, cierre["hora_apertura"], None)
    efectivo_esperado = resumen["efectivo_cup"]
    diferencia = payload.efectivo_contado_cup - efectivo_esperado

    conn.execute(
        """UPDATE cierres_caja
           SET estado = 'cerrado', hora_cierre = datetime('now'), cerrado_por_id = ?,
               efectivo_contado_cup = ?, efectivo_esperado_cup = ?, diferencia_cup = ?, notas = ?
           WHERE id = ?""",
        (
            payload.usuario_id,
            payload.efectivo_contado_cup,
            efectivo_esperado,
            diferencia,
            payload.notas,
            cierre_id,
        ),
    )
    conn.commit()

    row = conn.execute("SELECT * FROM cierres_caja WHERE id = ?", (cierre_id,)).fetchone()
    return {"cierre": dict(row), "resumen": resumen, "conteo_cierre": conteos_guardados}
