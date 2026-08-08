"""
Arranca el sistema completo. Doble clic (o `python run.py`) y ya:
levanta el servidor local y abre el navegador en la pantalla de venta.
No requiere internet -- todo corre en esta misma máquina.

Escucha en 0.0.0.0 (todas las interfaces), no solo en localhost, para
que los celulares de los meseros en la misma red wifi puedan conectarse
a http://IP-DE-ESTA-PC:8000/mesero. La ventana del navegador de esta
misma máquina se sigue abriendo por 127.0.0.1, que siempre funciona
sin depender de la red.

Importa la app de FastAPI directamente (no como string) a propósito:
así, cuando este archivo se empaqueta con PyInstaller, el análisis
estático encuentra la dependencia sola, sin necesitar adivinar el
nombre del módulo en tiempo de ejecución.
"""
from __future__ import annotations

import socket
import sys
import threading
import time
import webbrowser

import uvicorn

from app.main import app as fastapi_app
from app.services.red import ip_lan

HOST = "0.0.0.0"
HOST_LOCAL = "127.0.0.1"
PORT = 8000


def _puerto_libre(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) != 0


def _abrir_navegador() -> None:
    time.sleep(1.2)
    webbrowser.open(f"http://{HOST_LOCAL}:{PORT}")


if __name__ == "__main__":
    if not _puerto_libre(HOST_LOCAL, PORT):
        print(f"El puerto {PORT} ya está en uso. ¿Ya tienes FlowPos (Local) abierto en otra ventana?")
        print("Cierra esa ventana o espera unos segundos y vuelve a intentar.")
        input("Presiona Enter para salir...")
        sys.exit(1)

    print("FlowPos (Local) -- iniciando...")
    print(f"Se abrirá solo en el navegador: http://{HOST_LOCAL}:{PORT}")
    ip = ip_lan()
    if ip:
        print(f"Para meseros con celular (misma wifi): http://{ip}:{PORT}/mesero")
        print("(También hay un código QR para esto en Configuración, dentro del sistema.)")
    else:
        print("No se detectó una red wifi/LAN activa -- el acceso desde celular no estará disponible")
        print("hasta que esta PC esté conectada a la misma red que los meseros.")
    print("Para apagar el sistema, cierra esta ventana.")
    threading.Thread(target=_abrir_navegador, daemon=True).start()
    uvicorn.run(fastapi_app, host=HOST, port=PORT, log_level="info")
