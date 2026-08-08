"""Esquemas Pydantic: validación de entrada/salida de la API."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------
# Usuarios / login
# ---------------------------------------------------------------------

class LoginRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=8)


class UsuarioOut(BaseModel):
    id: int
    nombre: str
    rol: Literal["vendedor", "administrador", "gerente"]
    activo: bool
    timeout_inactividad_minutos: int


class UsuarioCreate(BaseModel):
    usuario_id: int
    nombre: str = Field(min_length=1)
    rol: Literal["vendedor", "administrador", "gerente"]
    pin: str = Field(min_length=4, max_length=8)
    # Si no se especifica, se aplica un default sensato según el rol
    # (ver DEFAULT_TIMEOUT_POR_ROL en app/routers/auth.py).
    timeout_inactividad_minutos: Optional[int] = Field(default=None, ge=1, le=480)


class UsuarioUpdate(BaseModel):
    usuario_id: int
    nombre: Optional[str] = Field(default=None, min_length=1)
    rol: Optional[Literal["vendedor", "administrador", "gerente"]] = None
    nueva_pin: Optional[str] = Field(default=None, min_length=4, max_length=8)
    activo: Optional[bool] = None
    timeout_inactividad_minutos: Optional[int] = Field(default=None, ge=1, le=480)


# ---------------------------------------------------------------------
# Insumos
# ---------------------------------------------------------------------

class InsumoCreate(BaseModel):
    nombre: str = Field(min_length=1)
    unidad_medida: Literal["g", "kg", "ml", "l", "unidad"]
    cantidad_actual: int = Field(ge=0, default=0)
    cantidad_minima: int = Field(ge=0, default=0)
    costo_promedio: int = Field(ge=0, default=0)
    usuario_id: int


class InsumoUpdate(BaseModel):
    usuario_id: int
    nombre: Optional[str] = None
    cantidad_minima: Optional[int] = Field(default=None, ge=0)
    costo_promedio: Optional[int] = Field(default=None, ge=0)
    activo: Optional[bool] = None


class InsumoOut(BaseModel):
    id: int
    nombre: str
    unidad_medida: str
    cantidad_actual: int
    cantidad_minima: int
    costo_promedio: int
    activo: bool
    bajo_minimo: bool
    creado_por_nombre: Optional[str] = None
    actualizado_por_nombre: Optional[str] = None
    updated_at: Optional[str] = None


class MovimientoInventarioOut(BaseModel):
    id: int
    insumo_id: int
    insumo_nombre: str
    unidad_medida: str
    tipo: str
    cantidad: int
    cantidad_resultante: int
    referencia_tipo: Optional[str] = None
    referencia_id: Optional[int] = None
    usuario_id: int
    usuario_nombre: str
    nota: Optional[str] = None
    created_at: str


class CompraCreate(BaseModel):
    insumo_id: int
    cantidad: int = Field(gt=0)
    costo_unitario: int = Field(ge=0)
    proveedor: Optional[str] = None
    usuario_id: int


# ---------------------------------------------------------------------
# Productos y recetas
# ---------------------------------------------------------------------

class RecetaLinea(BaseModel):
    insumo_id: int
    cantidad_requerida: int = Field(gt=0)


class ProductoCreate(BaseModel):
    nombre: str = Field(min_length=1)
    categoria: Literal["bebida", "comida", "servicio"]
    tipo: Literal["compuesto", "directo", "servicio"]
    precio_venta: int = Field(ge=0)
    unidad_venta: str = "unidad"
    requiere_preparacion: bool = False
    receta: list[RecetaLinea] = Field(default_factory=list)
    usuario_id: int


class ProductoUpdate(BaseModel):
    usuario_id: int
    nombre: Optional[str] = None
    precio_venta: Optional[int] = Field(default=None, ge=0)
    requiere_preparacion: Optional[bool] = None
    activo: Optional[bool] = None


class ProductoOut(BaseModel):
    id: int
    nombre: str
    categoria: str
    tipo: str
    precio_venta: int
    unidad_venta: str
    requiere_preparacion: bool
    activo: bool
    creado_por_nombre: Optional[str] = None
    actualizado_por_nombre: Optional[str] = None
    updated_at: Optional[str] = None


class HistorialPrecioOut(BaseModel):
    precio_anterior: int
    precio_nuevo: int
    usuario_nombre: str
    cambiado_at: str


# ---------------------------------------------------------------------
# Mesas de billar
# ---------------------------------------------------------------------

class MesaBillarCreate(BaseModel):
    usuario_id: int
    nombre: str = Field(min_length=1)
    tarifa_por_minuto: int = Field(ge=0)
    modo_default: Literal["cronometro", "temporizador"] = "cronometro"
    limite_minutos_default: Optional[int] = Field(default=None, gt=0)
    politica_cobro_default: Literal["exacto", "hora_completa"] = "exacto"


class MesaBillarUpdate(BaseModel):
    usuario_id: int
    nombre: Optional[str] = None
    tarifa_por_minuto: Optional[int] = Field(default=None, ge=0)
    activo: Optional[bool] = None
    modo_default: Optional[Literal["cronometro", "temporizador"]] = None
    limite_minutos_default: Optional[int] = Field(default=None, gt=0)
    politica_cobro_default: Optional[Literal["exacto", "hora_completa"]] = None


class MesaBillarOut(BaseModel):
    id: int
    nombre: str
    tarifa_por_minuto: int
    estado: str
    activo: bool
    modo_default: str
    limite_minutos_default: Optional[int]
    politica_cobro_default: str


# ---------------------------------------------------------------------
# Cuentas / venta
# ---------------------------------------------------------------------

class CuentaCreate(BaseModel):
    referencia: str = Field(min_length=1)
    operador_apertura_id: int


class CuentaItemCreate(BaseModel):
    producto_id: int
    cantidad: int = Field(gt=0)
    usuario_id: int


class CuentaItemCancelar(BaseModel):
    usuario_id: int
    motivo: str = Field(min_length=1)


class CuentaItemOut(BaseModel):
    id: int
    producto_id: int
    producto_nombre: str
    cantidad: int
    precio_unitario_aplicado: int
    subtotal: int
    estado: str


class CuentaOut(BaseModel):
    id: int
    referencia: str
    estado: str
    abierta_at: str
    cerrada_at: Optional[str]
    total: int
    total_pagado: int
    saldo_pendiente: int
    items: list[CuentaItemOut]


class PagoCreate(BaseModel):
    metodo: Literal["efectivo", "transferencia"]
    moneda: Literal["CUP", "USD", "MLC"]
    subtipo: Optional[Literal["fiscal", "libre"]] = None
    monto: int = Field(gt=0)
    tasa_cambio_aplicada: Optional[int] = Field(
        default=None, description="Centavos CUP por unidad de la moneda. Requerido si moneda != CUP."
    )
    usuario_id: int


class CerrarCuentaRequest(BaseModel):
    usuario_id: int


# ---------------------------------------------------------------------
# Billar
# ---------------------------------------------------------------------

class IniciarSesionBillar(BaseModel):
    cuenta_id: int
    # Si no se especifican, se usan los valores por defecto de la mesa.
    # Se pueden pisar acá para una partida puntual sin tener que editar
    # la configuración general de la mesa.
    modo: Optional[Literal["cronometro", "temporizador"]] = None
    limite_minutos: Optional[int] = Field(default=None, gt=0)
    politica_cobro: Optional[Literal["exacto", "hora_completa"]] = None


class FinalizarSesionBillar(BaseModel):
    usuario_id: int


# ---------------------------------------------------------------------
# Cierre de caja
# ---------------------------------------------------------------------

class ConteoInsumoIn(BaseModel):
    insumo_id: int
    cantidad_contada: int = Field(ge=0)
    nota: Optional[str] = None


class SalidaInsumoCreate(BaseModel):
    usuario_id: int
    cantidad: int = Field(gt=0)
    categoria: Literal["consumo_interno", "merma", "otro"]
    nota: str = Field(min_length=1)


class AbrirCierreRequest(BaseModel):
    usuario_id: int
    conteos: list[ConteoInsumoIn]


class CerrarCierreRequest(BaseModel):
    usuario_id: int
    efectivo_contado_cup: int = Field(ge=0)
    notas: Optional[str] = None
    conteos: list[ConteoInsumoIn]
