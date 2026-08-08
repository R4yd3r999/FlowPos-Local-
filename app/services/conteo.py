"""
Conteo físico de inventario, obligatorio en apertura y cierre de caja.
Reutiliza el ledger de movimientos_inventario que ya existía -- una
diferencia de conteo es, en el fondo, la misma operación que un
ajuste manual por merma, solo que con un origen distinto (conteo
físico programado, no un hallazgo suelto).
"""
from __future__ import annotations

import sqlite3

from app.errors import ValidationDomainError
from app.services import inventario


def procesar_conteo(
    conn: sqlite3.Connection,
    *,
    cierre_id: int,
    momento: str,
    conteos: list[dict],
    usuario_id: int,
) -> list[dict]:
    """
    conteos: [{"insumo_id": int, "cantidad_contada": int, "nota": str | None}, ...]

    Exige que TODOS los insumos activos estén cubiertos -- ni de más
    ni de menos, para que el conteo sea una foto completa y no parcial.
    Si algún insumo tiene diferencia contra el sistema, la nota para
    ESE insumo es obligatoria: la diferencia no pasa en silencio, tiene
    que quedar quién la encontró y qué dice que pasó, en el momento.
    Devuelve las filas guardadas (con la diferencia ya calculada).
    """
    insumos_activos = conn.execute(
        "SELECT id, nombre, cantidad_actual FROM insumos WHERE activo = 1"
    ).fetchall()
    por_id = {i["id"]: i for i in insumos_activos}

    ids_activos = set(por_id.keys())
    ids_contados = {c["insumo_id"] for c in conteos}

    faltantes = ids_activos - ids_contados
    if faltantes:
        nombres = sorted(por_id[i]["nombre"] for i in faltantes)
        raise ValidationDomainError(
            f"Faltan por contar: {', '.join(nombres)}. El conteo debe cubrir todos los insumos activos."
        )
    sobrantes = ids_contados - ids_activos
    if sobrantes:
        raise ValidationDomainError(
            f"Se contaron insumos que no existen o están inactivos: {sorted(sobrantes)}"
        )

    sin_nota = []
    for c in conteos:
        insumo = por_id[c["insumo_id"]]
        diferencia = c["cantidad_contada"] - insumo["cantidad_actual"]
        if diferencia != 0 and not (c.get("nota") or "").strip():
            sin_nota.append(insumo["nombre"])
    if sin_nota:
        raise ValidationDomainError(
            f"Hay diferencia de conteo sin explicar en: {', '.join(sorted(sin_nota))}. "
            "Escribe qué pasó antes de continuar."
        )

    filas_guardadas = []
    cierre_actual_conteo_id = None
    for c in conteos:
        insumo = por_id[c["insumo_id"]]
        cantidad_sistema = insumo["cantidad_actual"]
        cantidad_contada = c["cantidad_contada"]
        diferencia = cantidad_contada - cantidad_sistema
        nota = (c.get("nota") or "").strip() or None

        cur = conn.execute(
            """INSERT INTO conteos_inventario
               (cierre_id, momento, insumo_id, cantidad_sistema, cantidad_contada, diferencia, nota, usuario_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (cierre_id, momento, c["insumo_id"], cantidad_sistema, cantidad_contada, diferencia, nota, usuario_id),
        )
        conteo_id = cur.lastrowid

        if diferencia != 0:
            inventario.ajuste_por_conteo(
                conn,
                insumo_id=c["insumo_id"],
                nueva_cantidad=cantidad_contada,
                usuario_id=usuario_id,
                nota=f"Conteo físico de {momento} — cierre de caja #{cierre_id}: {nota}",
                referencia_id=conteo_id,
            )

        filas_guardadas.append(
            {
                "insumo_id": c["insumo_id"],
                "insumo_nombre": insumo["nombre"],
                "cantidad_sistema": cantidad_sistema,
                "cantidad_contada": cantidad_contada,
                "diferencia": diferencia,
                "nota": nota,
            }
        )

    return filas_guardadas


def obtener_conteos(conn: sqlite3.Connection, cierre_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT ci.momento, ci.insumo_id, i.nombre AS insumo_nombre, i.unidad_medida,
                  ci.cantidad_sistema, ci.cantidad_contada, ci.diferencia, ci.nota, ci.contado_at,
                  u.nombre AS usuario_nombre
           FROM conteos_inventario ci
           JOIN insumos i ON i.id = ci.insumo_id
           JOIN usuarios u ON u.id = ci.usuario_id
           WHERE ci.cierre_id = ?
           ORDER BY ci.momento, i.nombre""",
        (cierre_id,),
    ).fetchall()
    return [dict(r) for r in rows]
