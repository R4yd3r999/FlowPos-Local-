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
"""
from __future__ import annotations

import socket


def ip_lan() -> str | None:
    """
    Mejor esfuerzo para encontrar la IP de esta máquina en la red local.
    Devuelve None si no se pudo determinar (por ejemplo, sin ninguna
    interfaz de red activa) -- quien llama debe manejar ese caso.
    """
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

    # Fallback: resolver el hostname de la máquina y quedarse con la
    # primera IP que no sea loopback.
    try:
        _, _, ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in ips:
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass

    return None
