"""
Dashboard: ventas por día, productos más vendidos y margen, en un
rango de fechas elegible. Mismo nivel de acceso que el historial de
Cierre de caja (Administrador + Gerente) -- ver rentabilidad por
producto es información financiera, no una pantalla operativa que
necesite un Vendedor.
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.deps import get_conn
from app.roles import PUEDE_OPERAR_CAJA
from app.routers.auth import require_role
from app.services import dashboard as dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/resumen")
def resumen(
    usuario_id: int,
    desde: str | None = None,
    hasta: str | None = None,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    require_role(conn, usuario_id, *PUEDE_OPERAR_CAJA)
    return dashboard_service.resumen(conn, desde, hasta)
