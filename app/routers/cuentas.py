from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.deps import get_conn
from app.errors import ConflictError, NotFoundError, ValidationDomainError
from app.routers.auth import require_usuario
from app.schemas import (
    CerrarCuentaRequest,
    CuentaCreate,
    CuentaItemCancelar,
    CuentaItemCreate,
    CuentaItemOut,
    CuentaOut,
    PagoCreate,
)
from app.services import inventario
from app.services.caja import verificar_caja_abierta

router = APIRouter(prefix="/cuentas", tags=["cuentas"])


# ---------------------------------------------------------------------
# Helpers de lectura
# ---------------------------------------------------------------------

def _cuenta_o_404(conn: sqlite3.Connection, cuenta_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM cuentas WHERE id = ?", (cuenta_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Cuenta {cuenta_id} no existe")
    return row


def _armar_cuenta_out(conn: sqlite3.Connection, cuenta_id: int) -> CuentaOut:
    cuenta = _cuenta_o_404(conn, cuenta_id)

    items_rows = conn.execute(
        """SELECT ci.*, p.nombre AS producto_nombre
           FROM cuenta_items ci JOIN productos p ON p.id = ci.producto_id
           WHERE ci.cuenta_id = ?
           ORDER BY ci.agregado_at""",
        (cuenta_id,),
    ).fetchall()

    items: list[CuentaItemOut] = []
    total = 0
    for r in items_rows:
        subtotal = r["precio_unitario_aplicado"] * r["cantidad"]
        items.append(
            CuentaItemOut(
                id=r["id"],
                producto_id=r["producto_id"],
                producto_nombre=r["producto_nombre"],
                cantidad=r["cantidad"],
                precio_unitario_aplicado=r["precio_unitario_aplicado"],
                subtotal=subtotal,
                estado=r["estado"],
            )
        )
        if r["estado"] in ("pendiente", "confirmado"):
            total += subtotal

    total_pagado_row = conn.execute(
        "SELECT COALESCE(SUM(monto_cup_equivalente), 0) AS total FROM pagos WHERE cuenta_id = ?",
        (cuenta_id,),
    ).fetchone()
    total_pagado = total_pagado_row["total"]

    return CuentaOut(
        id=cuenta["id"],
        referencia=cuenta["referencia"],
        estado=cuenta["estado"],
        abierta_at=cuenta["abierta_at"],
        cerrada_at=cuenta["cerrada_at"],
        total=total,
        total_pagado=total_pagado,
        saldo_pendiente=max(total - total_pagado, 0),
        items=items,
    )


# ---------------------------------------------------------------------
# Cuentas
# ---------------------------------------------------------------------

@router.get("", response_model=list[CuentaOut])
def listar_cuentas(
    estado: str | None = None, conn: sqlite3.Connection = Depends(get_conn)
) -> list[CuentaOut]:
    query = "SELECT id FROM cuentas"
    params: tuple = ()
    if estado:
        query += " WHERE estado = ?"
        params = (estado,)
    query += " ORDER BY abierta_at DESC"
    ids = [r["id"] for r in conn.execute(query, params).fetchall()]
    return [_armar_cuenta_out(conn, cid) for cid in ids]


@router.get("/{cuenta_id}", response_model=CuentaOut)
def obtener_cuenta(cuenta_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> CuentaOut:
    return _armar_cuenta_out(conn, cuenta_id)


@router.post("", response_model=CuentaOut, status_code=201)
def abrir_cuenta(payload: CuentaCreate, conn: sqlite3.Connection = Depends(get_conn)) -> CuentaOut:
    require_usuario(conn, payload.operador_apertura_id)
    verificar_caja_abierta(conn)
    cur = conn.execute(
        "INSERT INTO cuentas (referencia, operador_apertura_id) VALUES (?, ?)",
        (payload.referencia, payload.operador_apertura_id),
    )
    conn.commit()
    return _armar_cuenta_out(conn, cur.lastrowid)


# ---------------------------------------------------------------------
# Items de la cuenta
# ---------------------------------------------------------------------

@router.post("/{cuenta_id}/items", response_model=CuentaOut, status_code=201)
def agregar_item(
    cuenta_id: int,
    payload: CuentaItemCreate,
    confirmar: bool = True,
    conn: sqlite3.Connection = Depends(get_conn),
) -> CuentaOut:
    """
    Agrega un producto a la cuenta. Por defecto lo confirma de inmediato
    (descuenta inventario en el mismo paso) porque en Fase 1 el mismo
    operador que toma el pedido es quien lo sirve. Con `confirmar=false`
    queda en estado 'pendiente' para un flujo de cocina/barra separado
    más adelante, sin tocar el inventario todavía.
    """
    cuenta = _cuenta_o_404(conn, cuenta_id)
    if cuenta["estado"] != "abierta":
        raise ConflictError("No se pueden agregar items a una cuenta cerrada")
    require_usuario(conn, payload.usuario_id)

    producto = conn.execute(
        "SELECT * FROM productos WHERE id = ? AND activo = 1", (payload.producto_id,)
    ).fetchone()
    if producto is None:
        raise NotFoundError(f"Producto {payload.producto_id} no existe o está inactivo")

    cur = conn.execute(
        """INSERT INTO cuenta_items
           (cuenta_id, producto_id, cantidad, precio_unitario_aplicado, agregado_por_id)
           VALUES (?, ?, ?, ?, ?)""",
        (cuenta_id, payload.producto_id, payload.cantidad, producto["precio_venta"], payload.usuario_id),
    )
    item_id = cur.lastrowid

    if confirmar:
        inventario.descontar_por_receta(
            conn,
            producto_id=payload.producto_id,
            cantidad_vendida=payload.cantidad,
            referencia_id=item_id,
            usuario_id=payload.usuario_id,
        )
        conn.execute(
            "UPDATE cuenta_items SET estado = 'confirmado', confirmado_at = datetime('now') WHERE id = ?",
            (item_id,),
        )

    conn.commit()
    return _armar_cuenta_out(conn, cuenta_id)


@router.post("/{cuenta_id}/items/{item_id}/confirmar", response_model=CuentaOut)
def confirmar_item(
    cuenta_id: int, item_id: int, usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> CuentaOut:
    item = conn.execute(
        "SELECT * FROM cuenta_items WHERE id = ? AND cuenta_id = ?", (item_id, cuenta_id)
    ).fetchone()
    if item is None:
        raise NotFoundError(f"Item {item_id} no existe en la cuenta {cuenta_id}")
    if item["estado"] != "pendiente":
        raise ConflictError(f"El item está en estado '{item['estado']}', no se puede confirmar")

    inventario.descontar_por_receta(
        conn,
        producto_id=item["producto_id"],
        cantidad_vendida=item["cantidad"],
        referencia_id=item_id,
        usuario_id=usuario_id,
    )
    conn.execute(
        "UPDATE cuenta_items SET estado = 'confirmado', confirmado_at = datetime('now') WHERE id = ?",
        (item_id,),
    )
    conn.commit()
    return _armar_cuenta_out(conn, cuenta_id)


@router.post("/{cuenta_id}/items/{item_id}/cancelar", response_model=CuentaOut)
def cancelar_item(
    cuenta_id: int,
    item_id: int,
    payload: CuentaItemCancelar,
    conn: sqlite3.Connection = Depends(get_conn),
) -> CuentaOut:
    item = conn.execute(
        "SELECT * FROM cuenta_items WHERE id = ? AND cuenta_id = ?", (item_id, cuenta_id)
    ).fetchone()
    if item is None:
        raise NotFoundError(f"Item {item_id} no existe en la cuenta {cuenta_id}")
    if item["estado"] == "cancelado":
        raise ConflictError("El item ya estaba cancelado")
    require_usuario(conn, payload.usuario_id)

    if item["estado"] == "confirmado":
        inventario.revertir_por_receta(
            conn,
            producto_id=item["producto_id"],
            cantidad_a_revertir=item["cantidad"],
            referencia_id=item_id,
            usuario_id=payload.usuario_id,
            nota=payload.motivo,
        )

    conn.execute(
        """UPDATE cuenta_items
           SET estado = 'cancelado', cancelado_at = datetime('now'),
               cancelado_por_id = ?, motivo_cancelacion = ?
           WHERE id = ?""",
        (payload.usuario_id, payload.motivo, item_id),
    )
    conn.commit()
    return _armar_cuenta_out(conn, cuenta_id)


# ---------------------------------------------------------------------
# Pagos
# ---------------------------------------------------------------------

@router.post("/{cuenta_id}/pagos", response_model=CuentaOut, status_code=201)
def registrar_pago(
    cuenta_id: int, payload: PagoCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> CuentaOut:
    cuenta = _cuenta_o_404(conn, cuenta_id)
    if cuenta["estado"] != "abierta":
        raise ConflictError("No se pueden registrar pagos en una cuenta cerrada")
    require_usuario(conn, payload.usuario_id)

    if payload.moneda == "CUP":
        monto_cup = payload.monto
        tasa = None
    else:
        if not payload.tasa_cambio_aplicada:
            raise ValidationDomainError(
                f"Se requiere tasa_cambio_aplicada para pagos en {payload.moneda}"
            )
        tasa = payload.tasa_cambio_aplicada
        monto_cup = round(payload.monto * tasa / 100)

    conn.execute(
        """INSERT INTO pagos
           (cuenta_id, metodo, moneda, subtipo, monto, monto_cup_equivalente,
            tasa_cambio_aplicada, registrado_por_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            cuenta_id,
            payload.metodo,
            payload.moneda,
            payload.subtipo,
            payload.monto,
            monto_cup,
            tasa,
            payload.usuario_id,
        ),
    )
    conn.commit()
    return _armar_cuenta_out(conn, cuenta_id)


@router.post("/{cuenta_id}/cerrar", response_model=CuentaOut)
def cerrar_cuenta(
    cuenta_id: int, payload: CerrarCuentaRequest, conn: sqlite3.Connection = Depends(get_conn)
) -> CuentaOut:
    cuenta = _cuenta_o_404(conn, cuenta_id)
    if cuenta["estado"] != "abierta":
        raise ConflictError("La cuenta ya está cerrada")
    require_usuario(conn, payload.usuario_id)

    pendientes = conn.execute(
        "SELECT COUNT(*) AS n FROM cuenta_items WHERE cuenta_id = ? AND estado = 'pendiente'",
        (cuenta_id,),
    ).fetchone()["n"]
    if pendientes > 0:
        raise ConflictError(
            f"Hay {pendientes} item(s) sin confirmar. Confirma o cancela antes de cerrar la cuenta."
        )

    sesiones_abiertas = conn.execute(
        "SELECT COUNT(*) AS n FROM sesiones_billar WHERE cuenta_id = ? AND hora_fin IS NULL",
        (cuenta_id,),
    ).fetchone()["n"]
    if sesiones_abiertas > 0:
        raise ConflictError("Hay una sesión de billar abierta en esta cuenta. Finalízala antes de cerrar.")

    actual = _armar_cuenta_out(conn, cuenta_id)
    if actual.saldo_pendiente > 0:
        raise ConflictError(
            f"Saldo pendiente de {actual.saldo_pendiente / 100:.2f} CUP. "
            "Registra el pago completo antes de cerrar la cuenta."
        )

    conn.execute(
        "UPDATE cuentas SET estado = 'cerrada', cerrada_at = datetime('now'), operador_cierre_id = ? WHERE id = ?",
        (payload.usuario_id, cuenta_id),
    )
    conn.commit()
    return _armar_cuenta_out(conn, cuenta_id)
