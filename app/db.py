"""
Capa de acceso a datos. Sin ORM a propósito: menos dependencias,
menos cosas que puedan romperse al instalar en una máquina con
internet limitado. sqlite3 es parte de la librería estándar de Python.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from app.paths import BASE_DIR, BUNDLE_DIR

DB_PATH = BASE_DIR / "data" / "pos.db"
SCHEMA_PATH = BUNDLE_DIR / "schema.sql"


def _configure_connection(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: FastAPI puede ejecutar la parte de "antes" y
    # "después" del yield de una dependencia en distintos hilos del thread
    # pool para una misma request. Esta conexión nunca se comparte ENTRE
    # requests distintas (cada una abre y cierra la suya), así que relajar
    # la restricción de hilo es seguro aquí y evita errores intermitentes.
    conn = sqlite3.connect(DB_PATH, timeout=5.0, check_same_thread=False)
    _configure_connection(conn)
    return conn


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    """
    Da una conexión con manejo de transacción explícito:
    commit si todo sale bien, rollback si algo lanza excepción.
    Úsese en cada request de escritura para no dejar la base
    a medias si algo falla a mitad de camino (ej. corte de luz,
    error de validación tardío).
    """
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _tabla_usuarios_usa_esquema_viejo(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'"
    ).fetchone()
    if row is None:
        return False
    return "'gerente'" not in row["sql"]


def _migrar_roles_usuarios(conn: sqlite3.Connection) -> None:
    """
    Cambia el esquema de roles de admin/cajero/mesero a
    vendedor/administrador/gerente. SQLite no permite modificar un
    CHECK constraint con ALTER TABLE, así que se reconstruye la tabla:
    se crea una nueva con el constraint correcto, se copian los datos
    traduciendo cada rol viejo al nuevo, se borra la vieja y se
    renombra. Los ids se preservan exactos para que las foreign keys
    de las demás tablas (cuentas, productos, pagos...) sigan apuntando
    a la persona correcta sin romperse.
    """
    if not _tabla_usuarios_usa_esquema_viejo(conn):
        return

    mapa_roles = {"admin": "gerente", "cajero": "administrador", "mesero": "vendedor"}

    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.execute(
        """CREATE TABLE usuarios_nuevo (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre      TEXT NOT NULL,
            rol         TEXT NOT NULL CHECK (rol IN ('vendedor', 'administrador', 'gerente')),
            pin_hash    TEXT NOT NULL,
            pin_salt    TEXT NOT NULL,
            activo      INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )"""
    )

    for f in conn.execute("SELECT * FROM usuarios").fetchall():
        rol_nuevo = mapa_roles.get(f["rol"], f["rol"])
        conn.execute(
            """INSERT INTO usuarios_nuevo (id, nombre, rol, pin_hash, pin_salt, activo, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (f["id"], f["nombre"], rol_nuevo, f["pin_hash"], f["pin_salt"], f["activo"], f["created_at"]),
        )

    conn.execute("DROP TABLE usuarios")
    conn.execute("ALTER TABLE usuarios_nuevo RENAME TO usuarios")
    conn.execute(
        "UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM usuarios) WHERE name = 'usuarios'"
    )
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.commit()


def _columnas_existentes(conn: sqlite3.Connection, tabla: str) -> set[str]:
    filas = conn.execute(f"PRAGMA table_info({tabla})").fetchall()
    return {fila["name"] for fila in filas}


def _migrar_columnas_faltantes(conn: sqlite3.Connection) -> None:
    """
    Agrega columnas nuevas a bases de datos creadas con un esquema
    anterior. Seguro de correr en cada arranque: si la columna ya
    existe, no hace nada. SQLite no soporta "ADD COLUMN IF NOT EXISTS"
    directo, por eso se verifica a mano con PRAGMA table_info.
    """
    migraciones = {
        "productos": [
            ("creado_por_id", "INTEGER REFERENCES usuarios(id)"),
            ("actualizado_por_id", "INTEGER REFERENCES usuarios(id)"),
        ],
        "insumos": [
            ("creado_por_id", "INTEGER REFERENCES usuarios(id)"),
            ("actualizado_por_id", "INTEGER REFERENCES usuarios(id)"),
        ],
        "conteos_inventario": [
            ("nota", "TEXT"),
        ],
        "usuarios": [
            ("timeout_inactividad_minutos", "INTEGER NOT NULL DEFAULT 20"),
        ],
        "mesas_billar": [
            ("modo_default", "TEXT NOT NULL DEFAULT 'cronometro'"),
            ("limite_minutos_default", "INTEGER"),
            ("politica_cobro_default", "TEXT NOT NULL DEFAULT 'exacto'"),
        ],
        "sesiones_billar": [
            ("modo", "TEXT NOT NULL DEFAULT 'cronometro'"),
            ("limite_minutos", "INTEGER"),
            ("politica_cobro", "TEXT NOT NULL DEFAULT 'exacto'"),
            ("minutos_facturados", "INTEGER"),
        ],
    }
    for tabla, columnas in migraciones.items():
        existentes = _columnas_existentes(conn, tabla)
        for nombre, definicion in columnas:
            if nombre not in existentes:
                conn.execute(f"ALTER TABLE {tabla} ADD COLUMN {nombre} {definicion}")
    conn.commit()


def _tabla_movimientos_usa_esquema_viejo(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='movimientos_inventario'"
    ).fetchone()
    if row is None:
        return False
    return "'ajuste_conteo'" not in row["sql"]


def _migrar_categorias_movimientos(conn: sqlite3.Connection) -> None:
    """
    Reemplaza las categorías genéricas 'ajuste_manual'/'ajuste_merma' por
    categorías declaradas (salida_consumo_interno, salida_merma,
    salida_otro, ajuste_conteo) -- mismo motivo que la migración de
    roles: el CHECK constraint viejo no permite los valores nuevos,
    así que hay que reconstruir la tabla. Los movimientos viejos, que
    solo pudieron haber salido del mecanismo de conteo, se traducen a
    'ajuste_conteo' sin perder cantidad, fecha ni usuario.
    """
    if not _tabla_movimientos_usa_esquema_viejo(conn):
        return

    mapa_tipos = {"ajuste_manual": "ajuste_conteo", "ajuste_merma": "ajuste_conteo"}

    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.execute(
        """CREATE TABLE movimientos_inventario_nuevo (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            insumo_id             INTEGER NOT NULL REFERENCES insumos(id),
            tipo                  TEXT NOT NULL CHECK (
                                      tipo IN ('entrada_compra', 'salida_venta', 'reversa_cancelacion',
                                               'salida_consumo_interno', 'salida_merma', 'salida_otro',
                                               'ajuste_conteo')
                                  ),
            cantidad              INTEGER NOT NULL,
            cantidad_resultante   INTEGER NOT NULL,
            referencia_tipo       TEXT,
            referencia_id         INTEGER,
            usuario_id            INTEGER NOT NULL REFERENCES usuarios(id),
            nota                  TEXT,
            created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        )"""
    )
    for m in conn.execute("SELECT * FROM movimientos_inventario").fetchall():
        tipo_nuevo = mapa_tipos.get(m["tipo"], m["tipo"])
        conn.execute(
            """INSERT INTO movimientos_inventario_nuevo
               (id, insumo_id, tipo, cantidad, cantidad_resultante, referencia_tipo,
                referencia_id, usuario_id, nota, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                m["id"], m["insumo_id"], tipo_nuevo, m["cantidad"], m["cantidad_resultante"],
                m["referencia_tipo"], m["referencia_id"], m["usuario_id"], m["nota"], m["created_at"],
            ),
        )
    conn.execute("DROP TABLE movimientos_inventario")
    conn.execute("ALTER TABLE movimientos_inventario_nuevo RENAME TO movimientos_inventario")
    conn.execute(
        "UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM movimientos_inventario) "
        "WHERE name = 'movimientos_inventario'"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_movimientos_insumo ON movimientos_inventario(insumo_id)")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.commit()


def init_db() -> None:
    """Crea el esquema si no existe, y migra roles/columnas/categorías si la base ya existía."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())
        conn.commit()
        _migrar_roles_usuarios(conn)
        _migrar_columnas_faltantes(conn)
        _migrar_categorias_movimientos(conn)
    finally:
        conn.close()


def db_exists() -> bool:
    return DB_PATH.exists()
