from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.db import db_exists, init_db
from app.errors import DomainError
from app.routers import auth, billar, cierre, cuentas, dashboard, insumos, productos, red, reportes
from app.paths import BASE_DIR, FRONTEND_DIR, FRONTEND_MESERO_DIR


def _avisar_pin_inicial() -> None:
    from app.seed import PIN_INICIAL_GERENTE

    mensaje = (
        "\n"
        "==================================================================\n"
        "  Primer arranque: se creó la cuenta Gerente.\n"
        f"  PIN inicial: {PIN_INICIAL_GERENTE}\n"
        "  Cámbialo desde el engranaje de Configuración en cuanto entres.\n"
        "==================================================================\n"
    )
    print(mensaje)
    try:
        respaldo = BASE_DIR / "data" / "PIN_INICIAL_GERENTE.txt"
        respaldo.write_text(
            f"PIN inicial del Gerente: {PIN_INICIAL_GERENTE}\n"
            "Cámbialo desde Configuración (el engranaje) apenas entres.\n"
            "Podés borrar este archivo después de anotarlo en un lugar seguro.\n",
            encoding="utf-8",
        )
    except OSError:
        pass  # el aviso en consola ya alcanza si por algo no se puede escribir el archivo


@asynccontextmanager
async def lifespan(app: FastAPI):
    primera_vez = not db_exists()
    init_db()
    if primera_vez:
        from app.seed import poblar_datos_iniciales

        poblar_datos_iniciales()
        _avisar_pin_inicial()
    yield


app = FastAPI(title="FlowPos (Local)", version="1.0", lifespan=lifespan)

app.include_router(auth.router, prefix="/api")
app.include_router(insumos.router, prefix="/api")
app.include_router(productos.router, prefix="/api")
app.include_router(cuentas.router, prefix="/api")
app.include_router(billar.router, prefix="/api")
app.include_router(cierre.router, prefix="/api")
app.include_router(reportes.router, prefix="/api")
app.include_router(red.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")


@app.exception_handler(DomainError)
def manejar_error_dominio(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
app.mount("/static-mesero", StaticFiles(directory=str(FRONTEND_MESERO_DIR)), name="static-mesero")


@app.get("/")
def servir_index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/mesero")
def servir_index_mesero() -> FileResponse:
    """
    Punto de entrada mobile-first pensado para el celular de un mesero
    en la red local -- mismo backend y misma base de datos que la
    pantalla principal, pero una interfaz aparte, más simple y táctil,
    en vez de la de escritorio apretada a la fuerza en una pantalla
    chica.
    """
    return FileResponse(str(FRONTEND_MESERO_DIR / "index.html"))

