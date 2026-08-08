-- =====================================================================
-- Esquema Fase 1 -- POS local para negocio de barra / cafetería / billar
-- SQLite. Todos los montos van en centavos (INTEGER) para evitar
-- errores de redondeo con punto flotante. Todas las cantidades de
-- insumos van en la unidad mínima (gramos, mililitros o unidades).
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Usuarios / operadores. Login por PIN (hash + salt), no contraseña.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre                      TEXT NOT NULL,
    rol                         TEXT NOT NULL CHECK (rol IN ('vendedor', 'administrador', 'gerente')),
    pin_hash                    TEXT NOT NULL,
    pin_salt                    TEXT NOT NULL,
    activo                      INTEGER NOT NULL DEFAULT 1,
    -- Minutos de inactividad antes de cerrar sesión sola en el
    -- dispositivo. Por usuario, no global -- el Gerente la define para
    -- cada cuenta desde Configuración. Los defaults de abajo (20 general)
    -- solo aplican al crear una cuenta nueva; el Gerente puede cambiarlo
    -- para cualquiera, incluida su propia cuenta, en cualquier momento.
    timeout_inactividad_minutos INTEGER NOT NULL DEFAULT 20,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Insumos: todo lo que existe físicamente en el almacén/barra.
-- Incluye tanto materia prima (queso, pan) como productos de reventa
-- directa (cerveza enlatada) -- ambos se manejan igual.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insumos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre            TEXT NOT NULL UNIQUE,
    unidad_medida     TEXT NOT NULL CHECK (unidad_medida IN ('g', 'kg', 'ml', 'l', 'unidad')),
    cantidad_actual   INTEGER NOT NULL DEFAULT 0,
    cantidad_minima   INTEGER NOT NULL DEFAULT 0,
    costo_promedio    INTEGER NOT NULL DEFAULT 0,
    activo            INTEGER NOT NULL DEFAULT 1,
    creado_por_id     INTEGER REFERENCES usuarios(id),
    actualizado_por_id INTEGER REFERENCES usuarios(id),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Productos: lo que aparece en el menú y se vende. La cantidad NUNCA
-- vive aquí -- vive en insumos, conectada vía recetas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre                 TEXT NOT NULL,
    categoria              TEXT NOT NULL CHECK (categoria IN ('bebida', 'comida', 'servicio')),
    tipo                   TEXT NOT NULL CHECK (tipo IN ('compuesto', 'directo', 'servicio')),
    precio_venta           INTEGER NOT NULL CHECK (precio_venta >= 0),
    unidad_venta           TEXT NOT NULL DEFAULT 'unidad',
    requiere_preparacion   INTEGER NOT NULL DEFAULT 0,
    activo                 INTEGER NOT NULL DEFAULT 1,
    creado_por_id          INTEGER REFERENCES usuarios(id),
    actualizado_por_id     INTEGER REFERENCES usuarios(id),
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Recetas: puente producto -> insumo(s). Un producto "directo"
-- (ej. cerveza) tiene una sola fila con cantidad_requerida = 1
-- apuntando al insumo que es él mismo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recetas (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id         INTEGER NOT NULL REFERENCES productos(id),
    insumo_id           INTEGER NOT NULL REFERENCES insumos(id),
    cantidad_requerida  INTEGER NOT NULL CHECK (cantidad_requerida > 0),
    UNIQUE (producto_id, insumo_id)
);

-- ---------------------------------------------------------------------
-- Historial de precios: una fila cada vez que cambia precio_venta de
-- un producto. Nunca se edita ni se borra -- es el rastro que permite
-- responder "cuánto costaba esto hace un mes y quién lo cambió".
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_precios (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id       INTEGER NOT NULL REFERENCES productos(id),
    precio_anterior   INTEGER NOT NULL,
    precio_nuevo      INTEGER NOT NULL,
    usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
    cambiado_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Compras / entradas de mercancía. Cada compra genera un movimiento
-- de inventario de tipo 'entrada_compra'.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compras (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    insumo_id       INTEGER NOT NULL REFERENCES insumos(id),
    cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
    costo_unitario  INTEGER NOT NULL CHECK (costo_unitario >= 0),
    proveedor       TEXT,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    fecha           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Ledger inmutable de inventario. Fuente de verdad para auditoría.
-- Nunca se hace UPDATE/DELETE sobre filas existentes de esta tabla.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    insumo_id             INTEGER NOT NULL REFERENCES insumos(id),
    tipo                  TEXT NOT NULL CHECK (
                              tipo IN ('entrada_compra', 'salida_venta', 'reversa_cancelacion',
                                       'salida_consumo_interno', 'salida_merma', 'salida_otro',
                                       'ajuste_conteo')
                          ),
    cantidad              INTEGER NOT NULL,   -- positivo entra, negativo sale
    cantidad_resultante   INTEGER NOT NULL,
    referencia_tipo       TEXT,               -- 'compra' | 'cuenta_item' | 'conteo' | 'salida_manual'
    referencia_id         INTEGER,
    usuario_id            INTEGER NOT NULL REFERENCES usuarios(id),
    nota                  TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Cuentas (comandas / tabs abiertas) y sus líneas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cuentas (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    referencia              TEXT NOT NULL,
    estado                  TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
    operador_apertura_id    INTEGER NOT NULL REFERENCES usuarios(id),
    operador_cierre_id      INTEGER REFERENCES usuarios(id),
    abierta_at              TEXT NOT NULL DEFAULT (datetime('now')),
    cerrada_at              TEXT
);

CREATE TABLE IF NOT EXISTS cuenta_items (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    cuenta_id                 INTEGER NOT NULL REFERENCES cuentas(id),
    producto_id                INTEGER NOT NULL REFERENCES productos(id),
    cantidad                  INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario_aplicado  INTEGER NOT NULL,
    estado                    TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmado', 'cancelado')),
    agregado_por_id           INTEGER NOT NULL REFERENCES usuarios(id),
    agregado_at               TEXT NOT NULL DEFAULT (datetime('now')),
    confirmado_at             TEXT,
    cancelado_at              TEXT,
    cancelado_por_id          INTEGER REFERENCES usuarios(id),
    motivo_cancelacion        TEXT
);

-- ---------------------------------------------------------------------
-- Mesas de billar y sus sesiones cronometradas. Cada mesa tiene un modo
-- y política de cobro por defecto; cada sesión guarda los suyos propios
-- (copiados del default de la mesa al iniciar, o elegidos puntualmente),
-- así una sesión vieja no cambia de significado si luego se edita la
-- mesa.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mesas_billar (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre                   TEXT NOT NULL UNIQUE,
    tarifa_por_minuto        INTEGER NOT NULL CHECK (tarifa_por_minuto >= 0),
    estado                   TEXT NOT NULL DEFAULT 'libre' CHECK (estado IN ('libre', 'ocupada')),
    activo                   INTEGER NOT NULL DEFAULT 1,
    modo_default             TEXT NOT NULL DEFAULT 'cronometro' CHECK (modo_default IN ('cronometro', 'temporizador')),
    limite_minutos_default   INTEGER,
    politica_cobro_default   TEXT NOT NULL DEFAULT 'exacto' CHECK (politica_cobro_default IN ('exacto', 'hora_completa'))
);

CREATE TABLE IF NOT EXISTS sesiones_billar (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_id               INTEGER NOT NULL REFERENCES mesas_billar(id),
    cuenta_id             INTEGER NOT NULL REFERENCES cuentas(id),
    hora_inicio           TEXT NOT NULL DEFAULT (datetime('now')),
    hora_fin              TEXT,
    modo                  TEXT NOT NULL DEFAULT 'cronometro' CHECK (modo IN ('cronometro', 'temporizador')),
    limite_minutos        INTEGER,
    politica_cobro        TEXT NOT NULL DEFAULT 'exacto' CHECK (politica_cobro IN ('exacto', 'hora_completa')),
    minutos_calculados    INTEGER,
    minutos_facturados    INTEGER,
    monto_calculado       INTEGER,
    cuenta_item_id        INTEGER REFERENCES cuenta_items(id)
);

-- ---------------------------------------------------------------------
-- Pagos (soporta pago dividido / multi-moneda) y cierre de caja diario.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    cuenta_id                INTEGER NOT NULL REFERENCES cuentas(id),
    metodo                   TEXT NOT NULL CHECK (metodo IN ('efectivo', 'transferencia')),
    moneda                   TEXT NOT NULL CHECK (moneda IN ('CUP', 'USD', 'MLC')),
    subtipo                  TEXT CHECK (subtipo IN ('fiscal', 'libre') OR subtipo IS NULL),
    monto                    INTEGER NOT NULL CHECK (monto > 0),
    monto_cup_equivalente    INTEGER NOT NULL,
    tasa_cambio_aplicada     INTEGER,
    registrado_por_id        INTEGER NOT NULL REFERENCES usuarios(id),
    registrado_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cierres_caja (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha                   TEXT NOT NULL,
    abierto_por_id          INTEGER NOT NULL REFERENCES usuarios(id),
    cerrado_por_id          INTEGER REFERENCES usuarios(id),
    hora_apertura           TEXT NOT NULL DEFAULT (datetime('now')),
    hora_cierre             TEXT,
    efectivo_contado_cup    INTEGER,
    efectivo_esperado_cup   INTEGER,
    diferencia_cup          INTEGER,
    estado                  TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
    notas                   TEXT
);

-- ---------------------------------------------------------------------
-- Conteo físico de inventario, obligatorio en la apertura y en el
-- cierre de cada caja -- igual que el efectivo, pero para insumos.
-- Cada fila es un insumo contado en un momento puntual: lo que decía
-- el sistema vs. lo que había en realidad. Es inmutable (nunca se
-- edita ni se borra) porque es el registro histórico de ese momento;
-- si hay diferencia, se corrige el stock actual vía un ajuste en
-- movimientos_inventario, pero esta fila sigue mostrando lo que pasó.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conteos_inventario (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cierre_id           INTEGER NOT NULL REFERENCES cierres_caja(id),
    momento             TEXT NOT NULL CHECK (momento IN ('apertura', 'cierre')),
    insumo_id           INTEGER NOT NULL REFERENCES insumos(id),
    cantidad_sistema    INTEGER NOT NULL,
    cantidad_contada    INTEGER NOT NULL,
    diferencia          INTEGER NOT NULL,
    nota                TEXT,               -- obligatoria en la app cuando diferencia != 0
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
    contado_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (cierre_id, momento, insumo_id)
);

-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cuenta_items_cuenta   ON cuenta_items(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_cuenta_items_estado   ON cuenta_items(estado);
CREATE INDEX IF NOT EXISTS idx_movimientos_insumo    ON movimientos_inventario(insumo_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cuenta          ON pagos(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_estado        ON cuentas(estado);
CREATE INDEX IF NOT EXISTS idx_recetas_producto      ON recetas(producto_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_mesa         ON sesiones_billar(mesa_id);
CREATE INDEX IF NOT EXISTS idx_cierres_fecha         ON cierres_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_historial_precios_producto ON historial_precios(producto_id);
CREATE INDEX IF NOT EXISTS idx_conteos_cierre ON conteos_inventario(cierre_id);
