"""
Rutas centralizadas del proyecto.

Distingue dos tipos de ruta, a propósito, porque mezclarlas es lo que
rompe una app empaquetada al actualizarla:

- BUNDLE_DIR: recursos de solo lectura que vienen EMPAQUETADOS con el
  programa (frontend/, schema.sql). Cuando corre como ejecutable
  (PyInstaller), viven dentro del paquete y se extraen a una carpeta
  temporal en cada arranque -- por eso nunca se debe guardar nada
  persistente ahí.

- BASE_DIR: datos que tienen que SOBREVIVIR entre ejecuciones y entre
  actualizaciones del programa (la base de datos). Cuando corre como
  ejecutable, es la carpeta donde está el .exe/binario, NO la carpeta
  temporal del paquete -- así, al reemplazar el ejecutable por una
  versión nueva, `data/` queda intacta al lado, sin tocarse.
"""
import sys
from pathlib import Path


def _es_ejecutable_empaquetado() -> bool:
    return getattr(sys, "frozen", False)


def _bundle_dir() -> Path:
    if _es_ejecutable_empaquetado():
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


def _base_dir() -> Path:
    if _es_ejecutable_empaquetado():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


BUNDLE_DIR = _bundle_dir()
BASE_DIR = _base_dir()
FRONTEND_DIR = BUNDLE_DIR / "frontend"
FRONTEND_MESERO_DIR = BUNDLE_DIR / "frontend_mesero"
