"""
Lógica de inventario. Reglas que no se negocian:

1. cantidad_actual de un insumo NUNCA se modifica desde fuera de este
   módulo, y siempre junto con una fila en movimientos_inventario.
2. Antes de descontar, se valida que TODOS los insumos de la receta
   alcancen (todo o nada -- no se descuenta la mitad de una receta).
3. Cancelar un item confirmado no borra el descuento original: inserta
   un movimiento de reversa. El historial nunca se reescribe.
"""
from __future__ import annotations

import sqlite3

from app.errors import InsufficientStockError, NotFoundError, ValidationDomainError


def _insumo_o_404(conn: sqlite3.Connection, insumo_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM insumos WHERE id = ?", (insumo_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Insumo {insumo_id} no existe")
    return row


def _registrar_movimiento(
    conn: sqlite3.Connection,
    *,
    insumo_id: int,
    tipo: str,
    delta: int,
    referencia_tipo: str | None,
    referencia_id: int | None,
    usuario_id: int,
    nota: str | None = None,
) -> int:
    """Aplica el delta a cantidad_actual y deja rastro en el ledger. Devuelve la cantidad resultante."""
    conn.execute(
        "UPDATE insumos SET cantidad_actual = cantidad_actual + ?, updated_at = datetime('now') WHERE id = ?",
        (delta, insumo_id),
    )
    nueva_cantidad = conn.execute(
        "SELECT cantidad_actual FROM insumos WHERE id = ?", (insumo_id,)
    ).fetchone()[0]
    conn.execute(
        """INSERT INTO movimientos_inventario
           (insumo_id, tipo, cantidad, cantidad_resultante, referencia_tipo, referencia_id, usuario_id, nota)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (insumo_id, tipo, delta, nueva_cantidad, referencia_tipo, referencia_id, usuario_id, nota),
    )
    return nueva_cantidad


def descontar_por_receta(
    conn: sqlite3.Connection,
    *,
    producto_id: int,
    cantidad_vendida: int,
    referencia_id: int,
    usuario_id: int,
) -> None:
    """Descuenta del inventario todos los insumos de la receta de un producto. Todo o nada."""
    recetas = conn.execute(
        "SELECT insumo_id, cantidad_requerida FROM recetas WHERE producto_id = ?", (producto_id,)
    ).fetchall()

    if not recetas:
        # Producto sin receta configurada (ej. un servicio que no consume insumos).
        return

    faltantes: list[str] = []
    for r in recetas:
        insumo = _insumo_o_404(conn, r["insumo_id"])
        necesario = r["cantidad_requerida"] * cantidad_vendida
        if insumo["cantidad_actual"] < necesario:
            faltantes.append(
                f"{insumo['nombre']} (disponible: {insumo['cantidad_actual']}{insumo['unidad_medida']}, "
                f"necesario: {necesario}{insumo['unidad_medida']})"
            )

    if faltantes:
        raise InsufficientStockError("Stock insuficiente: " + "; ".join(faltantes))

    for r in recetas:
        necesario = r["cantidad_requerida"] * cantidad_vendida
        _registrar_movimiento(
            conn,
            insumo_id=r["insumo_id"],
            tipo="salida_venta",
            delta=-necesario,
            referencia_tipo="cuenta_item",
            referencia_id=referencia_id,
            usuario_id=usuario_id,
        )


def revertir_por_receta(
    conn: sqlite3.Connection,
    *,
    producto_id: int,
    cantidad_a_revertir: int,
    referencia_id: int,
    usuario_id: int,
    nota: str,
) -> None:
    """Devuelve al inventario lo descontado por un item que se cancela después de confirmado."""
    recetas = conn.execute(
        "SELECT insumo_id, cantidad_requerida FROM recetas WHERE producto_id = ?", (producto_id,)
    ).fetchall()
    for r in recetas:
        cantidad = r["cantidad_requerida"] * cantidad_a_revertir
        _registrar_movimiento(
            conn,
            insumo_id=r["insumo_id"],
            tipo="reversa_cancelacion",
            delta=cantidad,
            referencia_tipo="cuenta_item",
            referencia_id=referencia_id,
            usuario_id=usuario_id,
            nota=nota,
        )


def registrar_entrada_compra(
    conn: sqlite3.Connection,
    *,
    insumo_id: int,
    cantidad: int,
    costo_unitario: int,
    usuario_id: int,
    compra_id: int,
) -> None:
    insumo = _insumo_o_404(conn, insumo_id)

    # costo promedio ponderado: (stock actual * costo actual + entrada * costo entrada) / total
    stock_actual = insumo["cantidad_actual"]
    costo_actual = insumo["costo_promedio"]
    total_nuevo = stock_actual + cantidad
    if total_nuevo > 0:
        nuevo_costo_promedio = round(
            (stock_actual * costo_actual + cantidad * costo_unitario) / total_nuevo
        )
        conn.execute(
            "UPDATE insumos SET costo_promedio = ? WHERE id = ?", (nuevo_costo_promedio, insumo_id)
        )

    _registrar_movimiento(
        conn,
        insumo_id=insumo_id,
        tipo="entrada_compra",
        delta=cantidad,
        referencia_tipo="compra",
        referencia_id=compra_id,
        usuario_id=usuario_id,
    )


def ajuste_por_conteo(
    conn: sqlite3.Connection,
    *,
    insumo_id: int,
    nueva_cantidad: int,
    usuario_id: int,
    nota: str,
    referencia_id: int | None = None,
) -> None:
    """
    Corrige el stock cuando un conteo físico (apertura o cierre de caja)
    no coincide con lo que decía el sistema. Se usa EXCLUSIVAMENTE desde
    el mecanismo de conteo -- para sacar inventario en el momento por una
    razón conocida (consumo interno, rotura), usar registrar_salida_manual,
    que categoriza la razón en vez de mezclarla con "no sabemos qué pasó".
    """
    insumo = _insumo_o_404(conn, insumo_id)
    delta = nueva_cantidad - insumo["cantidad_actual"]
    if delta == 0:
        return
    _registrar_movimiento(
        conn,
        insumo_id=insumo_id,
        tipo="ajuste_conteo",
        delta=delta,
        referencia_tipo="conteo",
        referencia_id=referencia_id,
        usuario_id=usuario_id,
        nota=nota,
    )


_CATEGORIAS_SALIDA = {
    "consumo_interno": "salida_consumo_interno",
    "merma": "salida_merma",
    "otro": "salida_otro",
}


def registrar_salida_manual(
    conn: sqlite3.Connection,
    *,
    insumo_id: int,
    cantidad: int,
    categoria: str,
    nota: str,
    usuario_id: int,
) -> int:
    """
    Saca inventario en el momento con una razón declarada (consumo
    interno / merma / otro) -- para que lo que se sabe no tenga que
    esperar al conteo del cierre y mezclarse con lo que no se sabe.
    Devuelve la cantidad resultante.
    """
    tipo = _CATEGORIAS_SALIDA.get(categoria)
    if tipo is None:
        raise ValidationDomainError(f"Categoría de salida inválida: {categoria}")

    insumo = _insumo_o_404(conn, insumo_id)
    if insumo["cantidad_actual"] < cantidad:
        raise InsufficientStockError(
            f"No hay suficiente {insumo['nombre']} (disponible: {insumo['cantidad_actual']}"
            f"{insumo['unidad_medida']}, se pidió sacar: {cantidad}{insumo['unidad_medida']})"
        )

    return _registrar_movimiento(
        conn,
        insumo_id=insumo_id,
        tipo=tipo,
        delta=-cantidad,
        referencia_tipo="salida_manual",
        referencia_id=None,
        usuario_id=usuario_id,
        nota=nota,
    )


def listar_movimientos(
    conn: sqlite3.Connection,
    *,
    insumo_id: int | None = None,
    tipo: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[sqlite3.Row]:
    """
    Lee el ledger completo (movimientos_inventario), sin importar si hubo
    caja abierta o no en el momento del movimiento -- el ledger nunca
    dependió de eso, solo faltaba una manera de consultarlo. Trae el
    nombre del insumo y del usuario ya resueltos para no forzar al
    frontend a cruzar tablas.
    """
    query = """
        SELECT m.id, m.insumo_id, i.nombre AS insumo_nombre, i.unidad_medida,
               m.tipo, m.cantidad, m.cantidad_resultante,
               m.referencia_tipo, m.referencia_id,
               m.usuario_id, u.nombre AS usuario_nombre,
               m.nota, m.created_at
        FROM movimientos_inventario m
        JOIN insumos i ON i.id = m.insumo_id
        JOIN usuarios u ON u.id = m.usuario_id
        WHERE 1 = 1
    """
    params: list = []
    if insumo_id is not None:
        query += " AND m.insumo_id = ?"
        params.append(insumo_id)
    if tipo:
        query += " AND m.tipo = ?"
        params.append(tipo)
    if desde:
        query += " AND m.created_at >= ?"
        params.append(desde)
    if hasta:
        query += " AND m.created_at <= ?"
        params.append(hasta)
    query += " ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    return conn.execute(query, params).fetchall()
