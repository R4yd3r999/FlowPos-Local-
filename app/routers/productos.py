from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.deps import get_conn
from app.errors import NotFoundError, ValidationDomainError
from app.roles import PUEDE_VER_INSUMOS, SOLO_GERENTE
from app.routers.auth import require_role
from app.schemas import HistorialPrecioOut, ProductoCreate, ProductoOut, ProductoUpdate, RecetaLinea

router = APIRouter(prefix="/productos", tags=["productos"])

_SELECT_CON_AUTORES = """
    SELECT p.*, creador.nombre AS creado_por_nombre, editor.nombre AS actualizado_por_nombre
    FROM productos p
    LEFT JOIN usuarios creador ON creador.id = p.creado_por_id
    LEFT JOIN usuarios editor ON editor.id = p.actualizado_por_id
"""


def _row_to_producto(row: sqlite3.Row) -> ProductoOut:
    return ProductoOut(
        id=row["id"],
        nombre=row["nombre"],
        categoria=row["categoria"],
        tipo=row["tipo"],
        precio_venta=row["precio_venta"],
        unidad_venta=row["unidad_venta"],
        requiere_preparacion=bool(row["requiere_preparacion"]),
        activo=bool(row["activo"]),
        creado_por_nombre=row["creado_por_nombre"],
        actualizado_por_nombre=row["actualizado_por_nombre"],
        updated_at=row["updated_at"],
    )


def _producto_con_autores_o_404(conn: sqlite3.Connection, producto_id: int) -> sqlite3.Row:
    row = conn.execute(_SELECT_CON_AUTORES + " WHERE p.id = ?", (producto_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Producto {producto_id} no existe")
    return row


@router.get("", response_model=list[ProductoOut])
def listar_productos(
    solo_activos: bool = True, conn: sqlite3.Connection = Depends(get_conn)
) -> list[ProductoOut]:
    query = _SELECT_CON_AUTORES
    if solo_activos:
        query += " WHERE p.activo = 1"
    query += " ORDER BY p.categoria, p.nombre"
    rows = conn.execute(query).fetchall()
    return [_row_to_producto(r) for r in rows]


def _obtener_receta_filas(conn: sqlite3.Connection, producto_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT r.insumo_id, i.nombre AS insumo_nombre, i.unidad_medida, r.cantidad_requerida
           FROM recetas r JOIN insumos i ON i.id = r.insumo_id
           WHERE r.producto_id = ?""",
        (producto_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/{producto_id}/receta")
def obtener_receta(
    producto_id: int, usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> list[dict]:
    require_role(conn, usuario_id, *PUEDE_VER_INSUMOS)
    return _obtener_receta_filas(conn, producto_id)


@router.get("/{producto_id}/historial-precios", response_model=list[HistorialPrecioOut])
def historial_precios(
    producto_id: int, usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> list[HistorialPrecioOut]:
    require_role(conn, usuario_id, *SOLO_GERENTE)
    rows = conn.execute(
        """SELECT hp.precio_anterior, hp.precio_nuevo, hp.cambiado_at, u.nombre AS usuario_nombre
           FROM historial_precios hp JOIN usuarios u ON u.id = hp.usuario_id
           WHERE hp.producto_id = ?
           ORDER BY hp.cambiado_at DESC""",
        (producto_id,),
    ).fetchall()
    return [HistorialPrecioOut(**dict(r)) for r in rows]


@router.post("", response_model=ProductoOut, status_code=201)
def crear_producto(payload: ProductoCreate, conn: sqlite3.Connection = Depends(get_conn)) -> ProductoOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    if payload.tipo in ("compuesto", "directo") and not payload.receta:
        raise ValidationDomainError(
            "Un producto de tipo 'compuesto' o 'directo' necesita al menos una línea de receta "
            "(para 'directo', apunta al insumo que representa al propio producto, cantidad 1)."
        )

    cur = conn.execute(
        """INSERT INTO productos
           (nombre, categoria, tipo, precio_venta, unidad_venta, requiere_preparacion,
            creado_por_id, actualizado_por_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            payload.nombre,
            payload.categoria,
            payload.tipo,
            payload.precio_venta,
            payload.unidad_venta,
            int(payload.requiere_preparacion),
            payload.usuario_id,
            payload.usuario_id,
        ),
    )
    producto_id = cur.lastrowid

    for linea in payload.receta:
        insumo = conn.execute("SELECT id FROM insumos WHERE id = ?", (linea.insumo_id,)).fetchone()
        if insumo is None:
            raise NotFoundError(f"Insumo {linea.insumo_id} no existe")
        conn.execute(
            "INSERT INTO recetas (producto_id, insumo_id, cantidad_requerida) VALUES (?, ?, ?)",
            (producto_id, linea.insumo_id, linea.cantidad_requerida),
        )

    conn.commit()
    return _row_to_producto(_producto_con_autores_o_404(conn, producto_id))


@router.put("/{producto_id}", response_model=ProductoOut)
def actualizar_producto(
    producto_id: int, payload: ProductoUpdate, conn: sqlite3.Connection = Depends(get_conn)
) -> ProductoOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    actual = conn.execute("SELECT * FROM productos WHERE id = ?", (producto_id,)).fetchone()
    if actual is None:
        raise NotFoundError(f"Producto {producto_id} no existe")

    campos = payload.model_dump(exclude_unset=True, exclude={"usuario_id"})
    if not campos:
        return _row_to_producto(_producto_con_autores_o_404(conn, producto_id))
    if "requiere_preparacion" in campos:
        campos["requiere_preparacion"] = int(campos["requiere_preparacion"])
    if "activo" in campos:
        campos["activo"] = int(campos["activo"])

    if "precio_venta" in campos and campos["precio_venta"] != actual["precio_venta"]:
        conn.execute(
            """INSERT INTO historial_precios (producto_id, precio_anterior, precio_nuevo, usuario_id)
               VALUES (?, ?, ?, ?)""",
            (producto_id, actual["precio_venta"], campos["precio_venta"], payload.usuario_id),
        )

    campos["actualizado_por_id"] = payload.usuario_id
    sets = ", ".join(f"{k} = ?" for k in campos)
    valores = list(campos.values()) + [producto_id]
    conn.execute(f"UPDATE productos SET {sets}, updated_at = datetime('now') WHERE id = ?", valores)
    conn.commit()
    return _row_to_producto(_producto_con_autores_o_404(conn, producto_id))


@router.put("/{producto_id}/receta")
def reemplazar_receta(
    producto_id: int, usuario_id: int, lineas: list[RecetaLinea], conn: sqlite3.Connection = Depends(get_conn)
) -> list[dict]:
    require_role(conn, usuario_id, *SOLO_GERENTE)
    producto = conn.execute("SELECT id FROM productos WHERE id = ?", (producto_id,)).fetchone()
    if producto is None:
        raise NotFoundError(f"Producto {producto_id} no existe")

    conn.execute("DELETE FROM recetas WHERE producto_id = ?", (producto_id,))
    for linea in lineas:
        insumo = conn.execute("SELECT id FROM insumos WHERE id = ?", (linea.insumo_id,)).fetchone()
        if insumo is None:
            raise NotFoundError(f"Insumo {linea.insumo_id} no existe")
        conn.execute(
            "INSERT INTO recetas (producto_id, insumo_id, cantidad_requerida) VALUES (?, ?, ?)",
            (producto_id, linea.insumo_id, linea.cantidad_requerida),
        )
    conn.commit()
    return _obtener_receta_filas(conn, producto_id)
