from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.deps import get_conn
from app.errors import AuthError, ConflictError, NotFoundError, ValidationDomainError
from app.roles import GERENTE, SOLO_GERENTE
from app.schemas import LoginRequest, UsuarioCreate, UsuarioOut, UsuarioUpdate
from app.security import hash_pin, verify_pin

router = APIRouter(tags=["auth"])

# Default al crear una cuenta nueva, si el Gerente no especifica uno
# puntual. El Vendedor suele andar en celular entre mesas (conviene
# corto); el Gerente maneja lo más sensible del sistema (más corto
# todavía); el Administrador queda en el medio.
DEFAULT_TIMEOUT_POR_ROL = {"vendedor": 20, "administrador": 30, "gerente": 15}


def _row_to_usuario(row: sqlite3.Row) -> UsuarioOut:
    return UsuarioOut(
        id=row["id"],
        nombre=row["nombre"],
        rol=row["rol"],
        activo=bool(row["activo"]),
        timeout_inactividad_minutos=row["timeout_inactividad_minutos"],
    )


def require_usuario(conn: sqlite3.Connection, usuario_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM usuarios WHERE id = ? AND activo = 1", (usuario_id,)
    ).fetchone()
    if row is None:
        raise NotFoundError(f"Usuario {usuario_id} no existe o está inactivo")
    return row


def require_role(conn: sqlite3.Connection, usuario_id: int, *roles: str) -> sqlite3.Row:
    row = require_usuario(conn, usuario_id)
    if row["rol"] not in roles:
        raise AuthError(f"Esta acción requiere rol: {', '.join(roles)}")
    return row


@router.post("/auth/login", response_model=UsuarioOut)
def login(payload: LoginRequest, conn: sqlite3.Connection = Depends(get_conn)) -> UsuarioOut:
    candidatos = conn.execute("SELECT * FROM usuarios WHERE activo = 1").fetchall()
    for row in candidatos:
        if verify_pin(payload.pin, row["pin_hash"], row["pin_salt"]):
            return _row_to_usuario(row)
    raise AuthError("PIN incorrecto")


@router.get("/usuarios", response_model=list[UsuarioOut])
def listar_usuarios(usuario_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> list[UsuarioOut]:
    require_role(conn, usuario_id, *SOLO_GERENTE)
    rows = conn.execute("SELECT * FROM usuarios ORDER BY nombre").fetchall()
    return [_row_to_usuario(r) for r in rows]


@router.post("/usuarios", response_model=UsuarioOut, status_code=201)
def crear_usuario(payload: UsuarioCreate, conn: sqlite3.Connection = Depends(get_conn)) -> UsuarioOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    if payload.rol == GERENTE and len(payload.pin) < 6:
        raise ValidationDomainError(
            "El rol Gerente maneja los privilegios más sensibles del sistema: su PIN debe tener al menos 6 dígitos."
        )
    existe = conn.execute(
        "SELECT 1 FROM usuarios WHERE nombre = ? AND activo = 1", (payload.nombre,)
    ).fetchone()
    if existe:
        raise ConflictError(f"Ya existe un usuario activo llamado '{payload.nombre}'")

    pin_hash, pin_salt = hash_pin(payload.pin)
    timeout = payload.timeout_inactividad_minutos or DEFAULT_TIMEOUT_POR_ROL[payload.rol]
    cur = conn.execute(
        "INSERT INTO usuarios (nombre, rol, pin_hash, pin_salt, timeout_inactividad_minutos) VALUES (?, ?, ?, ?, ?)",
        (payload.nombre, payload.rol, pin_hash, pin_salt, timeout),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM usuarios WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _row_to_usuario(row)


@router.put("/usuarios/{usuario_id}", response_model=UsuarioOut)
def actualizar_usuario(
    usuario_id: int, payload: UsuarioUpdate, conn: sqlite3.Connection = Depends(get_conn)
) -> UsuarioOut:
    require_role(conn, payload.usuario_id, *SOLO_GERENTE)
    objetivo = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    if objetivo is None:
        raise NotFoundError(f"Usuario {usuario_id} no existe")

    rol_final = payload.rol if payload.rol is not None else objetivo["rol"]
    cambia_a_gerente = rol_final == GERENTE and objetivo["rol"] != GERENTE
    deja_de_ser_gerente = objetivo["rol"] == GERENTE and rol_final != GERENTE
    se_desactiva = payload.activo is False

    if usuario_id == payload.usuario_id and (se_desactiva or deja_de_ser_gerente):
        raise ConflictError("No puedes quitarte a ti mismo el rol de Gerente ni desactivar tu propia cuenta")

    if objetivo["rol"] == GERENTE and (se_desactiva or deja_de_ser_gerente):
        otros_gerentes = conn.execute(
            "SELECT COUNT(*) AS n FROM usuarios WHERE rol = ? AND activo = 1 AND id != ?",
            (GERENTE, usuario_id),
        ).fetchone()["n"]
        if otros_gerentes == 0:
            raise ConflictError(
                "No puedes dejar al sistema sin ningún Gerente activo. Crea otro Gerente primero."
            )

    if cambia_a_gerente and not payload.nueva_pin:
        raise ValidationDomainError(
            "Para ascender a Gerente, define también un PIN nuevo de al menos 6 dígitos en el mismo cambio."
        )
    if payload.nueva_pin and rol_final == GERENTE and len(payload.nueva_pin) < 6:
        raise ValidationDomainError(
            "El rol Gerente maneja los privilegios más sensibles del sistema: su PIN debe tener al menos 6 dígitos."
        )

    if payload.nombre and payload.nombre != objetivo["nombre"]:
        existe = conn.execute(
            "SELECT 1 FROM usuarios WHERE nombre = ? AND activo = 1 AND id != ?", (payload.nombre, usuario_id)
        ).fetchone()
        if existe:
            raise ConflictError(f"Ya existe un usuario activo llamado '{payload.nombre}'")

    campos: dict = {}
    if payload.nombre is not None:
        campos["nombre"] = payload.nombre
    if payload.rol is not None:
        campos["rol"] = payload.rol
    if payload.activo is not None:
        campos["activo"] = int(payload.activo)
    if payload.nueva_pin is not None:
        pin_hash, pin_salt = hash_pin(payload.nueva_pin)
        campos["pin_hash"] = pin_hash
        campos["pin_salt"] = pin_salt
    if payload.timeout_inactividad_minutos is not None:
        campos["timeout_inactividad_minutos"] = payload.timeout_inactividad_minutos

    if campos:
        sets = ", ".join(f"{k} = ?" for k in campos)
        valores = list(campos.values()) + [usuario_id]
        conn.execute(f"UPDATE usuarios SET {sets} WHERE id = ?", valores)
        conn.commit()

    row = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    return _row_to_usuario(row)


@router.delete("/usuarios/{usuario_id}", status_code=204)
def desactivar_usuario(
    usuario_id: int, actor_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> None:
    require_role(conn, actor_id, *SOLO_GERENTE)
    row = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"Usuario {usuario_id} no existe")
    if usuario_id == actor_id:
        raise ConflictError("No puedes desactivar tu propio usuario mientras tienes la sesión abierta")
    if row["rol"] == GERENTE:
        otros_gerentes = conn.execute(
            "SELECT COUNT(*) AS n FROM usuarios WHERE rol = ? AND activo = 1 AND id != ?",
            (GERENTE, usuario_id),
        ).fetchone()["n"]
        if otros_gerentes == 0:
            raise ConflictError(
                "No puedes desactivar al único Gerente activo del sistema: nadie podría "
                "volver a gestionar usuarios ni el catálogo. Crea otro Gerente primero."
            )
    conn.execute("UPDATE usuarios SET activo = 0 WHERE id = ?", (usuario_id,))
    conn.commit()
