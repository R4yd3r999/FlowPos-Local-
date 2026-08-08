"""
Cálculo de cuánto tiempo cobrar en una sesión de billar, separado del
router para poder testearlo aislado y para que quede en un solo lugar
la regla de negocio (que es la parte que más dudas generó).
"""
from __future__ import annotations


def horas_a_cobrar(minutos_reales: int) -> int:
    """
    Traduce minutos realmente jugados a horas a cobrar, con margen de
    gracia -- para que un par de minutos de más no disparen una hora
    entera, pero tampoco se pierdan centavos cobrando al minuto exacto.

    - Menos de 30 minutos jugados: todavía no se cobra nada (cortesía
      para sesiones muy cortas).
    - Desde los 30 minutos: se cobra la primera hora completa.
    - Cada hora siguiente se activa a los 10 minutos de haber entrado
      en ella -- pasando el minuto 70 (1h10) ya se cobran 2 horas,
      pasando el minuto 130 (2h10) ya se cobran 3 horas, y así.

    Ejemplos: 29 min -> 0h. 30 min -> 1h. 69 min -> 1h. 70 min -> 2h.
    129 min -> 2h. 130 min -> 3h.
    """
    if minutos_reales < 30:
        return 0
    return max(1, (minutos_reales - 10) // 60 + 1)


def minutos_a_cobrar_por_hora(minutos_reales: int) -> int:
    """Lo mismo que horas_a_cobrar, pero ya expresado en minutos (para
    multiplicar directo por la tarifa_por_minuto sin tener que volver
    a convertir horas a minutos en cada lugar que lo usa)."""
    return horas_a_cobrar(minutos_reales) * 60
