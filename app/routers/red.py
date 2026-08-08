"""
Endpoints para que el Gerente conecte los celulares de los meseros a
este sistema por wifi local. No requieren usuario_id -- la URL y el QR
no son secretos (son literalmente la dirección para conectarse), y
pedir login acá complicaría la pantalla de Configuración sin ganar
nada: quien ya está dentro del sistema como Gerente es quien accede a
esta pantalla.
"""
from __future__ import annotations

import io

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.services.red import ip_lan

router = APIRouter(prefix="/red", tags=["red"])


@router.get("/info")
def info_red(request: Request) -> dict:
    puerto = request.url.port or 8000
    ip = ip_lan()
    return {
        "ip_lan": ip,
        "puerto": puerto,
        "url_mesero": f"http://{ip}:{puerto}/mesero" if ip else None,
    }


@router.get("/qr.svg")
def qr_svg(texto: str) -> Response:
    """
    QR de cualquier texto (en la práctica, la URL de /mesero) como SVG
    -- se eligió SVG en vez de PNG para no depender de Pillow, que
    infla bastante el ejecutable compilado sin aportar nada más acá.
    """
    img = qrcode.make(texto, image_factory=qrcode.image.svg.SvgPathImage)
    buffer = io.BytesIO()
    img.save(buffer)
    return Response(content=buffer.getvalue(), media_type="image/svg+xml")
