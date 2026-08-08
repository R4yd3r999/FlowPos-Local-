from __future__ import annotations

import math
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends

from app.deps import get_conn
from app.errors import ConflictError, NotFoundError
from app.roles import SOLO_GERENTE
from app.routers.auth import require_role, require_usuario
from app.schemas import (
    FinalizarSesionBillar,
    IniciarSesionBillar,
    MesaBillarCreate,
    MesaBillarOut,
    MesaBillarUpdate,
)

router = APIRouter(tags=["billar"])


def _row_to_mesa(row: sqlite3.Row) -> MesaBillarOut:
    return MesaBillarOut(
        id=row["id"],
        nombre=row["nombre"],
        tarifa_por_minuto=row["tarifa_por_minuto"],
        estado=row["estado"],
        activo=bool(row["activo"]),
        modo_default=row["modo_default"],
        limite_minutos_default=row["limite_minutos_default"],
        politica_cobro_default=row["politica_cobro_default"],
    )


def _mesa_o_404(conn: sqlite3.Connection, mesa_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM mesas_billar WHERE id = ?", (mesa_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Mesa {mesa_id} no existe")
    return row


@router.get("/mesas-billar", response_model=list[MesaBillarOut])
def listar_mesas(solo_activas: bool = True, conn: sqlite3.Connection = Depends(get_conn)) -> list[MesaBillarOut]:
    query = "SELECT * FROM mesas_billar"
    if solo_activas:
        query += " WHERE activo = 1"
    query += " ORDER BY nombre"
    rows = conn.execute(query).fetchall()
    return [_row_to_mesa(r) for r in rows]


@router.post("/mesas-billar", response_model=MesaBillarOut, status_code=201)
def crear_mesa(payload: MesaBillarCreate, conn: sqlite3.Connection = Depends(get_conn)) -> MesaBillarOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    existe = conn.execute(
        "SELECT 1 FROM mesas_billar WHERE nombre = ? AND activo = 1", (payload.nombre,)
    ).fetchone()
    if existe:
        raise ConflictError(f"Ya existe una mesa activa llamada '{payload.nombre}'")
    if payload.modo_default == "temporizador" and not payload.limite_minutos_default:
        raise ConflictError("El modo Temporizador necesita un límite de minutos por defecto")
    cur = conn.execute(
        """INSERT INTO mesas_billar
           (nombre, tarifa_por_minuto, modo_default, limite_minutos_default, politica_cobro_default)
           VALUES (?, ?, ?, ?, ?)""",
        (
            payload.nombre,
            payload.tarifa_por_minuto,
            payload.modo_default,
            payload.limite_minutos_default,
            payload.politica_cobro_default,
        ),
    )
    conn.commit()
    return _row_to_mesa(_mesa_o_404(conn, cur.lastrowid))


@router.put("/mesas-billar/{mesa_id}", response_model=MesaBillarOut)
def actualizar_mesa(
    mesa_id: int, payload: MesaBillarUpdate, conn: sqlite3.Connection = Depends(get_conn)
) -> MesaBillarOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    mesa = _mesa_o_404(conn, mesa_id)

    campos = payload.model_dump(exclude_unset=True, exclude={"usuario_id"})
    if not campos:
        return _row_to_mesa(mesa)
    if campos.get("activo") is False and mesa["estado"] == "ocupada":
        raise ConflictError(
            f"La mesa '{mesa['nombre']}' tiene una sesión en curso. Finalízala antes de desactivarla."
        )
    if "activo" in campos:
        campos["activo"] = int(campos["activo"])

    # El modo final (ya sea el que viene en el payload o el que ya tenía
    # la mesa) es el que decide si hace falta un límite -- así "Editar
    # mesa" no permite guardar un Temporizador sin límite por accidente.
    modo_final = campos.get("modo_default", mesa["modo_default"])
    limite_final = campos.get("limite_minutos_default", mesa["limite_minutos_default"])
    if modo_final == "temporizador" and not limite_final:
        raise ConflictError("El modo Temporizador necesita un límite de minutos por defecto")

    sets = ", ".join(f"{k} = ?" for k in campos)
    valores = list(campos.values()) + [mesa_id]
    conn.execute(f"UPDATE mesas_billar SET {sets} WHERE id = ?", valores)
    conn.commit()
    return _row_to_mesa(_mesa_o_404(conn, mesa_id))


@router.get("/mesas-billar/{mesa_id}/sesion-activa")
def sesion_activa(mesa_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict | None:
    sesion = conn.execute(
        "SELECT * FROM sesiones_billar WHERE mesa_id = ? AND hora_fin IS NULL ORDER BY hora_inicio DESC LIMIT 1",
        (mesa_id,),
    ).fetchone()
    return dict(sesion) if sesion else None


@router.post("/mesas-billar/{mesa_id}/iniciar", status_code=201)
def iniciar_sesion(
    mesa_id: int, payload: IniciarSesionBillar, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    mesa = _mesa_o_404(conn, mesa_id)
    if mesa["estado"] != "libre":
        raise ConflictError(f"La mesa '{mesa['nombre']}' ya está ocupada")

    cuenta = conn.execute("SELECT * FROM cuentas WHERE id = ?", (payload.cuenta_id,)).fetchone()
    if cuenta is None:
        raise NotFoundError(f"Cuenta {payload.cuenta_id} no existe")
    if cuenta["estado"] != "abierta":
        raise ConflictError("La cuenta indicada está cerrada")

    # Lo que venga en el payload pisa el default de la mesa -- así se
    # puede cambiar la config para una partida puntual sin tocar la
    # configuración general de la mesa.
    modo = payload.modo or mesa["modo_default"]
    limite_minutos = payload.limite_minutos if payload.limite_minutos is not None else mesa["limite_minutos_default"]
    politica_cobro = payload.politica_cobro or mesa["politica_cobro_default"]
    if modo == "temporizador" and not limite_minutos:
        raise ConflictError("El modo Temporizador necesita un límite de minutos")

    cur = conn.execute(
        """INSERT INTO sesiones_billar (mesa_id, cuenta_id, modo, limite_minutos, politica_cobro)
           VALUES (?, ?, ?, ?, ?)""",
        (mesa_id, payload.cuenta_id, modo, limite_minutos, politica_cobro),
    )
    conn.execute("UPDATE mesas_billar SET estado = 'ocupada' WHERE id = ?", (mesa_id,))
    conn.commit()
    sesion = conn.execute("SELECT * FROM sesiones_billar WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(sesion)


@router.post("/mesas-billar/{mesa_id}/finalizar")
def finalizar_sesion(
    mesa_id: int, payload: FinalizarSesionBillar, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    require_usuario(conn, payload.usuario_id)
    mesa = _mesa_o_404(conn, mesa_id)

    sesion = conn.execute(
        "SELECT * FROM sesiones_billar WHERE mesa_id = ? AND hora_fin IS NULL ORDER BY hora_inicio DESC LIMIT 1",
        (mesa_id,),
    ).fetchone()
    if sesion is None:
        raise ConflictError(f"La mesa '{mesa['nombre']}' no tiene una sesión activa")

    inicio = datetime.fromisoformat(sesion["hora_inicio"])
    ahora = datetime.utcnow()
    minutos_reales = max(1, math.ceil((ahora - inicio).total_seconds() / 60))

    # Política de cobro: "exacto" cobra los minutos reales jugados (ya
    # redondeados al minuto de arriba); "hora_completa" redondea eso
    # hacia arriba a la hora entera -- si empezaron a jugar la segunda
    # hora, esa hora se cobra completa, se haya usado entera o no.
    if sesion["politica_cobro"] == "hora_completa":
        minutos_facturados = math.ceil(minutos_reales / 60) * 60
    else:
        minutos_facturados = minutos_reales
    monto = minutos_facturados * mesa["tarifa_por_minuto"]

    producto_billar = conn.execute(
        "SELECT id FROM productos WHERE tipo = 'servicio' AND nombre = 'Tiempo de billar' AND activo = 1 LIMIT 1"
    ).fetchone()
    if producto_billar is None:
        raise ConflictError(
            "No existe un producto de tipo 'servicio' llamado 'Tiempo de billar'. "
            "Créalo una vez en el panel de Productos (categoría servicio, tipo servicio, sin receta)."
        )

    cur = conn.execute(
        """INSERT INTO cuenta_items
           (cuenta_id, producto_id, cantidad, precio_unitario_aplicado, estado, agregado_por_id, confirmado_at)
           VALUES (?, ?, 1, ?, 'confirmado', ?, datetime('now'))""",
        (sesion["cuenta_id"], producto_billar["id"], monto, payload.usuario_id),
    )
    cuenta_item_id = cur.lastrowid

    conn.execute(
        """UPDATE sesiones_billar
           SET hora_fin = datetime('now'), minutos_calculados = ?, minutos_facturados = ?,
               monto_calculado = ?, cuenta_item_id = ?
           WHERE id = ?""",
        (minutos_reales, minutos_facturados, monto, cuenta_item_id, sesion["id"]),
    )
    conn.execute("UPDATE mesas_billar SET estado = 'libre' WHERE id = ?", (mesa_id,))
    conn.commit()

    return {
        "sesion_id": sesion["id"],
        "minutos_calculados": minutos_reales,
        "minutos_facturados": minutos_facturados,
        "monto_calculado": monto,
        "cuenta_item_id": cuenta_item_id,
    }
