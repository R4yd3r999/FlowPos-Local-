from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.deps import get_conn
from app.errors import NotFoundError
from app.roles import PUEDE_VER_INSUMOS, SOLO_GERENTE
from app.routers.auth import require_role
from app.schemas import (
    CompraCreate,
    InsumoCreate,
    InsumoOut,
    InsumoUpdate,
    MovimientoInventarioOut,
    SalidaInsumoCreate,
)
from app.services import inventario

router = APIRouter(prefix="/insumos", tags=["insumos"])

_SELECT_CON_AUTORES = """
    SELECT i.*, creador.nombre AS creado_por_nombre, editor.nombre AS actualizado_por_nombre
    FROM insumos i
    LEFT JOIN usuarios creador ON creador.id = i.creado_por_id
    LEFT JOIN usuarios editor ON editor.id = i.actualizado_por_id
"""


def _row_to_insumo(row: sqlite3.Row) -> InsumoOut:
    return InsumoOut(
        id=row["id"],
        nombre=row["nombre"],
        unidad_medida=row["unidad_medida"],
        cantidad_actual=row["cantidad_actual"],
        cantidad_minima=row["cantidad_minima"],
        costo_promedio=row["costo_promedio"],
        activo=bool(row["activo"]),
        bajo_minimo=row["cantidad_actual"] <= row["cantidad_minima"],
        creado_por_nombre=row["creado_por_nombre"],
        actualizado_por_nombre=row["actualizado_por_nombre"],
        updated_at=row["updated_at"],
    )


def _insumo_con_autores_o_404(conn: sqlite3.Connection, insumo_id: int) -> sqlite3.Row:
    row = conn.execute(_SELECT_CON_AUTORES + " WHERE i.id = ?", (insumo_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Insumo {insumo_id} no existe")
    return row


@router.get("", response_model=list[InsumoOut])
def listar_insumos(
    usuario_id: int, solo_activos: bool = True, conn: sqlite3.Connection = Depends(get_conn)
) -> list[InsumoOut]:
    require_role(conn, usuario_id, *PUEDE_VER_INSUMOS)
    query = _SELECT_CON_AUTORES
    if solo_activos:
        query += " WHERE i.activo = 1"
    query += " ORDER BY i.nombre"
    rows = conn.execute(query).fetchall()
    return [_row_to_insumo(r) for r in rows]


def _row_to_movimiento(row: sqlite3.Row) -> MovimientoInventarioOut:
    return MovimientoInventarioOut(
        id=row["id"],
        insumo_id=row["insumo_id"],
        insumo_nombre=row["insumo_nombre"],
        unidad_medida=row["unidad_medida"],
        tipo=row["tipo"],
        cantidad=row["cantidad"],
        cantidad_resultante=row["cantidad_resultante"],
        referencia_tipo=row["referencia_tipo"],
        referencia_id=row["referencia_id"],
        usuario_id=row["usuario_id"],
        usuario_nombre=row["usuario_nombre"],
        nota=row["nota"],
        created_at=row["created_at"],
    )


# NOTA: esta ruta literal debe declararse antes de "/{insumo_id}" -- si no,
# FastAPI intenta convertir "movimientos" a int para insumo_id y devuelve 422.
@router.get("/movimientos", response_model=list[MovimientoInventarioOut])
def listar_movimientos_inventario(
    usuario_id: int,
    insumo_id: int | None = None,
    tipo: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    limit: int = 200,
    offset: int = 0,
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[MovimientoInventarioOut]:
    """
    Ledger completo de entradas/salidas de insumos: venta, compra, salida
    manual (consumo interno / merma / otro), reversa y ajuste de conteo.
    No depende de que haya o haya habido caja abierta -- registra todo,
    siempre. Esta es la vista general; ver también /{insumo_id}/movimientos
    para el historial de un insumo puntual.
    """
    require_role(conn, usuario_id, *PUEDE_VER_INSUMOS)
    rows = inventario.listar_movimientos(
        conn, insumo_id=insumo_id, tipo=tipo, desde=desde, hasta=hasta, limit=limit, offset=offset
    )
    return [_row_to_movimiento(r) for r in rows]


@router.get("/{insumo_id}", response_model=InsumoOut)
def obtener_insumo(insumo_id: int, usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> InsumoOut:
    require_role(conn, usuario_id, *PUEDE_VER_INSUMOS)
    return _row_to_insumo(_insumo_con_autores_o_404(conn, insumo_id))


@router.get("/{insumo_id}/movimientos", response_model=list[MovimientoInventarioOut])
def listar_movimientos_de_insumo(
    insumo_id: int,
    usuario_id: int,
    limit: int = 100,
    offset: int = 0,
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[MovimientoInventarioOut]:
    """Historial de un insumo puntual -- acceso rápido desde su fila en la tabla de Insumos."""
    require_role(conn, usuario_id, *PUEDE_VER_INSUMOS)
    _insumo_con_autores_o_404(conn, insumo_id)
    rows = inventario.listar_movimientos(conn, insumo_id=insumo_id, limit=limit, offset=offset)
    return [_row_to_movimiento(r) for r in rows]


@router.post("", response_model=InsumoOut, status_code=201)
def crear_insumo(payload: InsumoCreate, conn: sqlite3.Connection = Depends(get_conn)) -> InsumoOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    cur = conn.execute(
        """INSERT INTO insumos
           (nombre, unidad_medida, cantidad_actual, cantidad_minima, costo_promedio,
            creado_por_id, actualizado_por_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            payload.nombre,
            payload.unidad_medida,
            payload.cantidad_actual,
            payload.cantidad_minima,
            payload.costo_promedio,
            payload.usuario_id,
            payload.usuario_id,
        ),
    )
    conn.commit()
    return _row_to_insumo(_insumo_con_autores_o_404(conn, cur.lastrowid))


@router.put("/{insumo_id}", response_model=InsumoOut)
def actualizar_insumo(
    insumo_id: int, payload: InsumoUpdate, conn: sqlite3.Connection = Depends(get_conn)
) -> InsumoOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    row = conn.execute("SELECT * FROM insumos WHERE id = ?", (insumo_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Insumo {insumo_id} no existe")

    campos = payload.model_dump(exclude_unset=True, exclude={"usuario_id"})
    if not campos:
        return _row_to_insumo(_insumo_con_autores_o_404(conn, insumo_id))

    campos["actualizado_por_id"] = payload.usuario_id
    sets = ", ".join(f"{k} = ?" for k in campos)
    valores = list(campos.values()) + [insumo_id]
    conn.execute(f"UPDATE insumos SET {sets}, updated_at = datetime('now') WHERE id = ?", valores)
    conn.commit()
    return _row_to_insumo(_insumo_con_autores_o_404(conn, insumo_id))


@router.post("/compras", status_code=201)
def registrar_compra(payload: CompraCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)

    cur = conn.execute(
        """INSERT INTO compras (insumo_id, cantidad, costo_unitario, proveedor, usuario_id)
           VALUES (?, ?, ?, ?, ?)""",
        (payload.insumo_id, payload.cantidad, payload.costo_unitario, payload.proveedor, payload.usuario_id),
    )
    inventario.registrar_entrada_compra(
        conn,
        insumo_id=payload.insumo_id,
        cantidad=payload.cantidad,
        costo_unitario=payload.costo_unitario,
        usuario_id=payload.usuario_id,
        compra_id=cur.lastrowid,
    )
    conn.commit()
    row = _insumo_con_autores_o_404(conn, payload.insumo_id)
    return {"compra_id": cur.lastrowid, "insumo": _row_to_insumo(row).model_dump()}


@router.post("/{insumo_id}/salida", status_code=201)
def registrar_salida(
    insumo_id: int, payload: SalidaInsumoCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    """
    Saca inventario en el momento con una razón declarada (consumo
    interno, merma, u otro) -- para que lo que ya se sabe no tenga que
    esperar al conteo del cierre y mezclarse ahí con lo que no se sabe.
    Disponible para Administrador y Gerente, aunque Administrador sea
    de solo lectura para el resto de la edición de insumos: declarar
    una salida conocida es una acción distinta de editar el catálogo.
    """
    require_role(conn, payload.usuario_id, *PUEDE_VER_INSUMOS)
    inventario.registrar_salida_manual(
        conn,
        insumo_id=insumo_id,
        cantidad=payload.cantidad,
        categoria=payload.categoria,
        nota=payload.nota,
        usuario_id=payload.usuario_id,
    )
    conn.commit()
    row = _insumo_con_autores_o_404(conn, insumo_id)
    return {"insumo": _row_to_insumo(row).model_dump()}
