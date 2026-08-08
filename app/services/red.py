"""
Detección de la IP en la red local (LAN) de esta máquina -- para que el
Gerente pueda mostrarle a un mesero la dirección a la que apuntar su
celular (http://IP:PUERTO/mesero), sin tener que abrir una terminal ni
saber nada de redes.

El truco del socket UDP es el estándar de facto en Python para esto:
"conectar" un socket UDP no manda ningún paquete por la red (UDP no
tiene handshake), así que funciona incluso sin internet -- el sistema
operativo igual resuelve qué interfaz de red usaría para llegar a esa
IP, y esa es la IP local que buscamos. Por eso funciona bien en una
LAN sin salida a internet, que es exactamente el caso de este negocio.

Se listan VARIAS IPs candidatas, no solo una -- si el dispositivo tiene
más de una interfaz activa a la vez (por ejemplo, un celular con wifi
Y datos móviles prendidos, o una PC con wifi y una VPN), el truco de
arriba puede sugerir la que NO es la de la red del negocio. Mostrando
todas las candidatas, el Gerente puede probar cuál responde.
"""
from __future__ import annotations

import socket


def _ip_sugerida() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # 10.255.255.255 nunca recibe el paquete (UDP no confirma
            # entrega) -- solo se usa para que el SO elija la interfaz.
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return None


def ips_lan_candidatas() -> list[str]:
    """
    Todas las IPs no-loopback que este dispositivo tiene asignadas
    ahora mismo, con la más probable primero. Puede devolver una lista
    vacía si no hay ninguna interfaz de red activa.
    """
    candidatas: list[str] = []

    sugerida = _ip_sugerida()
    if sugerida:
        candidatas.append(sugerida)

    try:
        _, _, ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in ips:
            if not ip.startswith("127.") and ip not in candidatas:
                candidatas.append(ip)
    except OSError:
        pass

    return candidatas


def ip_lan() -> str | None:
    """Mejor esfuerzo: una sola IP, para quien no necesita la lista
    completa. Ver ips_lan_candidatas() si el resultado no conecta."""
    candidatas = ips_lan_candidatas()
    return candidatas[0] if candidatas else None
