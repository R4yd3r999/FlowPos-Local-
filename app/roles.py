"""
Roles del sistema y sus agrupaciones. Un solo lugar para esto, para
que la matriz de permisos no quede repetida (y potencialmente
desincronizada) en cada router.

Matriz de referencia:
                          vendedor  administrador  gerente
venta / billar / menú       si          si           si
ver insumos                 no       solo lectura     si
editar insumos               no          no           si
editar productos/recetas     no          no           si
abrir/cerrar caja            no          si            si
crear/editar mesas           no          no           si
historiales, usuarios        no          no           si
"""
from __future__ import annotations

VENDEDOR = "vendedor"
ADMINISTRADOR = "administrador"
GERENTE = "gerente"

TODOS = (VENDEDOR, ADMINISTRADOR, GERENTE)
PUEDE_VER_INSUMOS = (ADMINISTRADOR, GERENTE)
PUEDE_OPERAR_CAJA = (ADMINISTRADOR, GERENTE)
SOLO_GERENTE = (GERENTE,)
