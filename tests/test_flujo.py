import requests

BASE = "http://127.0.0.1:8000/api"
PIN_GERENTE_INICIAL = "963400"


def paso(nombre):
    print(f"\n=== {nombre} ===")


def chk(cond, msg):
    status = "OK" if cond else "FALLO"
    print(f"[{status}] {msg}")
    if not cond:
        raise SystemExit(1)


def login(pin):
    r = requests.post(f"{BASE}/auth/login", json={"pin": pin})
    chk(r.status_code == 200, f"login pin {pin} status {r.status_code}: {r.text}")
    return r.json()


# ---------------------------------------------------------------------
# 1. Arranque en limpio: un solo Gerente, sin catálogo
# ---------------------------------------------------------------------
paso("Login con el PIN inicial del Gerente")
gerente = login(PIN_GERENTE_INICIAL)
chk(gerente["rol"] == "gerente" and gerente["nombre"] == "Gerente", "cuenta Gerente creada tal como se espera")
gerente_id = gerente["id"]

paso("El catálogo arranca vacío, salvo el producto de sistema de billar")
productos_iniciales = requests.get(f"{BASE}/productos").json()
chk(len(productos_iniciales) == 1 and productos_iniciales[0]["nombre"] == "Tiempo de billar",
    f"debe haber solo 'Tiempo de billar', hay: {[p['nombre'] for p in productos_iniciales]}")
insumos_iniciales = requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json()
chk(len(insumos_iniciales) == 0, f"insumos debe arrancar vacío, hay {len(insumos_iniciales)}")
mesas_iniciales = requests.get(f"{BASE}/mesas-billar").json()
chk(len(mesas_iniciales) == 0, f"mesas debe arrancar vacío, hay {len(mesas_iniciales)}")

paso("Solo existe la cuenta Gerente, ninguna otra")
usuarios_iniciales = requests.get(f"{BASE}/usuarios", params={"usuario_id": gerente_id}).json()
chk(len(usuarios_iniciales) == 1, f"debe haber solo 1 usuario, hay {len(usuarios_iniciales)}")

# ---------------------------------------------------------------------
# 2. Configuración: alta, edición y baja de cuentas
# ---------------------------------------------------------------------
paso("Gerente crea un Vendedor y un Administrador")
r = requests.post(f"{BASE}/usuarios", json={
    "usuario_id": gerente_id, "nombre": "Yosvani", "rol": "vendedor", "pin": "1111",
})
chk(r.status_code == 201, f"crear vendedor status {r.status_code}: {r.text}")
vendedor_id = r.json()["id"]

r = requests.post(f"{BASE}/usuarios", json={
    "usuario_id": gerente_id, "nombre": "Marlen", "rol": "administrador", "pin": "2222",
})
chk(r.status_code == 201, f"crear administrador status {r.status_code}: {r.text}")
administrador_id = r.json()["id"]

paso("Editar nombre y PIN de una cuenta")
r = requests.put(f"{BASE}/usuarios/{vendedor_id}", json={"usuario_id": gerente_id, "nombre": "Yosvani P."})
chk(r.status_code == 200 and r.json()["nombre"] == "Yosvani P.", f"editar nombre status {r.status_code}: {r.text}")
r = requests.put(f"{BASE}/usuarios/{vendedor_id}", json={"usuario_id": gerente_id, "nueva_pin": "5555"})
chk(r.status_code == 200, f"resetear PIN status {r.status_code}: {r.text}")
r = login("5555")
chk(r["id"] == vendedor_id, "el PIN nuevo funciona para iniciar sesión")

paso("Ascender a Gerente sin PIN nuevo debe rechazarse")
r = requests.put(f"{BASE}/usuarios/{administrador_id}", json={"usuario_id": gerente_id, "rol": "gerente"})
chk(r.status_code == 422, f"debe exigir PIN nuevo de 6+ dígitos, fue {r.status_code}: {r.text}")

paso("Ascender a Gerente con PIN corto debe rechazarse")
r = requests.put(f"{BASE}/usuarios/{administrador_id}", json={"usuario_id": gerente_id, "rol": "gerente", "nueva_pin": "1234"})
chk(r.status_code == 422, f"debe exigir 6+ dígitos, fue {r.status_code}: {r.text}")

paso("No se puede desactivar al único Gerente")
r = requests.put(f"{BASE}/usuarios/{gerente_id}", json={"usuario_id": gerente_id, "activo": False})
chk(r.status_code == 409, f"debe rechazar, fue {r.status_code}: {r.text}")

paso("Vendedor no puede acceder a Configuración (listar usuarios)")
r = requests.get(f"{BASE}/usuarios", params={"usuario_id": vendedor_id})
chk(r.status_code == 401, f"debe rechazar con 401, fue {r.status_code}: {r.text}")

# ---------------------------------------------------------------------
# 3. Cargar catálogo real (lo que antes hacía el seed, ahora lo hace el Gerente)
# ---------------------------------------------------------------------
paso("Gerente crea insumos y productos del negocio")
def crear_insumo(nombre, unidad, cantidad, minima, costo):
    r = requests.post(f"{BASE}/insumos", json={
        "usuario_id": gerente_id, "nombre": nombre, "unidad_medida": unidad,
        "cantidad_actual": cantidad, "cantidad_minima": minima, "costo_promedio": costo,
    })
    chk(r.status_code == 201, f"crear insumo {nombre} status {r.status_code}: {r.text}")
    return r.json()["id"]

pan_id = crear_insumo("Pan de hamburguesa", "unidad", 50, 10, 1500)
carne_id = crear_insumo("Carne de hamburguesa", "g", 5000, 1000, 40)
queso_id = crear_insumo("Queso amarillo", "g", 2000, 500, 60)
cerveza_insumo_id = crear_insumo("Cerveza Bucanero lata", "unidad", 100, 24, 9000)

r = requests.post(f"{BASE}/productos", json={
    "usuario_id": gerente_id, "nombre": "Hamburguesa Clásica", "categoria": "comida", "tipo": "compuesto",
    "precio_venta": 25000, "requiere_preparacion": True,
    "receta": [
        {"insumo_id": pan_id, "cantidad_requerida": 1},
        {"insumo_id": carne_id, "cantidad_requerida": 150},
        {"insumo_id": queso_id, "cantidad_requerida": 30},
    ],
})
chk(r.status_code == 201, f"crear hamburguesa status {r.status_code}: {r.text}")
hamburguesa = r.json()

r = requests.post(f"{BASE}/productos", json={
    "usuario_id": gerente_id, "nombre": "Cerveza Bucanero", "categoria": "bebida", "tipo": "directo",
    "precio_venta": 15000,
    "receta": [{"insumo_id": cerveza_insumo_id, "cantidad_requerida": 1}],
})
chk(r.status_code == 201, f"crear cerveza status {r.status_code}: {r.text}")
cerveza = r.json()

r = requests.post(f"{BASE}/mesas-billar", json={"usuario_id": gerente_id, "nombre": "Mesa 1", "tarifa_por_minuto": 200})
chk(r.status_code == 201, f"crear mesa status {r.status_code}: {r.text}")
mesa_id = r.json()["id"]

# ---------------------------------------------------------------------
# 4. Caja: conteo obligatorio, venta, receta, cancelación, pagos
# ---------------------------------------------------------------------
paso("No se puede abrir cuenta sin caja abierta")
r = requests.post(f"{BASE}/cuentas", json={"referencia": "Mesa fantasma", "operador_apertura_id": vendedor_id})
chk(r.status_code == 409, f"debe rechazar con 409, fue {r.status_code}: {r.text}")

paso("Abrir caja con conteo completo")
insumos_actuales = requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json()
conteo_apertura = [{"insumo_id": i["id"], "cantidad_contada": i["cantidad_actual"]} for i in insumos_actuales]
r = requests.post(f"{BASE}/cierre-caja/abrir", json={"usuario_id": administrador_id, "conteos": conteo_apertura})
chk(r.status_code == 201, f"abrir caja status {r.status_code}: {r.text}")
cierre_id = r.json()["cierre"]["id"]

paso("Abrir cuenta y vender 7 cervezas en un paso")
r = requests.post(f"{BASE}/cuentas", json={"referencia": "Mesa 5", "operador_apertura_id": vendedor_id})
chk(r.status_code == 201, f"abrir cuenta status {r.status_code}: {r.text}")
cuenta_id = r.json()["id"]
r = requests.post(f"{BASE}/cuentas/{cuenta_id}/items",
                   json={"producto_id": cerveza["id"], "cantidad": 7, "usuario_id": vendedor_id})
chk(r.status_code == 201, f"vender 7 cervezas status {r.status_code}: {r.text}")
chk(r.json()["items"][0]["cantidad"] == 7, "la línea quedó con cantidad 7")

paso("Vender una hamburguesa y verificar descuento de receta")
pan_antes = next(i for i in insumos_actuales if i["nombre"] == "Pan de hamburguesa")["cantidad_actual"]
r = requests.post(f"{BASE}/cuentas/{cuenta_id}/items",
                   json={"producto_id": hamburguesa["id"], "cantidad": 1, "usuario_id": vendedor_id})
chk(r.status_code == 201, f"vender hamburguesa status {r.status_code}: {r.text}")
item_hamburguesa_id = [i for i in r.json()["items"] if i["producto_id"] == hamburguesa["id"]][0]["id"]
insumos_tras_venta = {i["nombre"]: i["cantidad_actual"] for i in requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json()}
chk(insumos_tras_venta["Pan de hamburguesa"] == pan_antes - 1, "pan descontado en 1 por la receta")

paso("Bloqueo por stock insuficiente")
r = requests.post(f"{BASE}/cuentas/{cuenta_id}/items",
                   json={"producto_id": hamburguesa["id"], "cantidad": 999, "usuario_id": vendedor_id})
chk(r.status_code == 409, f"debe rechazar con 409, fue {r.status_code}: {r.text}")

paso("Cancelar item con motivo revierte inventario")
r = requests.post(f"{BASE}/cuentas/{cuenta_id}/items/{item_hamburguesa_id}/cancelar",
                   json={"usuario_id": vendedor_id, "motivo": "prueba automática"})
chk(r.status_code == 200, f"cancelar status {r.status_code}: {r.text}")
insumos_revertidos = {i["nombre"]: i["cantidad_actual"] for i in requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json()}
chk(insumos_revertidos["Pan de hamburguesa"] == pan_antes, "pan revertido correctamente")

paso("Pagar y cerrar cuenta")
cuenta_actual = requests.get(f"{BASE}/cuentas/{cuenta_id}").json()
r = requests.post(f"{BASE}/cuentas/{cuenta_id}/pagos",
                   json={"metodo": "efectivo", "moneda": "CUP", "monto": cuenta_actual["saldo_pendiente"], "usuario_id": vendedor_id})
chk(r.status_code == 201, f"pago status {r.status_code}: {r.text}")
r = requests.post(f"{BASE}/cuentas/{cuenta_id}/cerrar", json={"usuario_id": vendedor_id})
chk(r.status_code == 200, f"cerrar cuenta status {r.status_code}: {r.text}")

# ---------------------------------------------------------------------
# 5. Billar con la mesa recién creada
# ---------------------------------------------------------------------
paso("Billar: iniciar y finalizar sesión")
r = requests.post(f"{BASE}/cuentas", json={"referencia": "Billar prueba", "operador_apertura_id": vendedor_id})
cuenta_billar_id = r.json()["id"]
r = requests.post(f"{BASE}/mesas-billar/{mesa_id}/iniciar", json={"cuenta_id": cuenta_billar_id})
chk(r.status_code == 201, f"iniciar billar status {r.status_code}: {r.text}")
r = requests.post(f"{BASE}/mesas-billar/{mesa_id}/finalizar", json={"usuario_id": vendedor_id})
chk(r.status_code == 200, f"finalizar billar status {r.status_code}: {r.text}")
resultado_billar = r.json()
r = requests.post(f"{BASE}/cuentas/{cuenta_billar_id}/pagos",
                   json={"metodo": "transferencia", "moneda": "CUP", "subtipo": "fiscal",
                         "monto": resultado_billar["monto_calculado"], "usuario_id": vendedor_id})
chk(r.status_code == 201, f"pago billar status {r.status_code}: {r.text}")
requests.post(f"{BASE}/cuentas/{cuenta_billar_id}/cerrar", json={"usuario_id": vendedor_id})

# ---------------------------------------------------------------------
# 6. Cierre de caja: conteo con nota obligatoria, detalle agrupado
# ---------------------------------------------------------------------
paso("Cerrar caja sin nota en una diferencia debe rechazarse")
insumos_para_cierre = requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json()
resumen_final = requests.get(f"{BASE}/cierre-caja/{cierre_id}/resumen", params={"usuario_id": administrador_id}).json()
conteo_sin_nota = [{"insumo_id": i["id"], "cantidad_contada": i["cantidad_actual"] - (1 if i["nombre"] == "Queso amarillo" else 0)} for i in insumos_para_cierre]
r = requests.post(f"{BASE}/cierre-caja/{cierre_id}/cerrar", json={
    "usuario_id": administrador_id, "efectivo_contado_cup": resumen_final["efectivo_cup"], "conteos": conteo_sin_nota,
})
chk(r.status_code == 422, f"debe rechazar sin nota, fue {r.status_code}: {r.text}")

paso("Cerrar caja con nota -- ajusta inventario y cuadra efectivo")
conteo_con_nota = []
for i in insumos_para_cierre:
    linea = {"insumo_id": i["id"], "cantidad_contada": i["cantidad_actual"]}
    if i["nombre"] == "Queso amarillo":
        linea["cantidad_contada"] -= 1
        linea["nota"] = "Falta 1g, probablemente error de conteo -- revisar"
    conteo_con_nota.append(linea)
r = requests.post(f"{BASE}/cierre-caja/{cierre_id}/cerrar", json={
    "usuario_id": administrador_id, "efectivo_contado_cup": resumen_final["efectivo_cup"], "conteos": conteo_con_nota,
})
chk(r.status_code == 200, f"cerrar caja status {r.status_code}: {r.text}")
chk(r.json()["cierre"]["diferencia_cup"] == 0, "caja cuadrada")

paso("El detalle histórico agrupa ventas por cuenta y trae el detalle de cada pago")
r = requests.get(f"{BASE}/cierre-caja/{cierre_id}/detalle", params={"usuario_id": gerente_id})
chk(r.status_code == 200, f"detalle status {r.status_code}: {r.text}")
detalle = r.json()
referencias_ventas = {v["referencia"] for v in detalle["ventas"]}
chk("Mesa 5" in referencias_ventas and "Billar prueba" in referencias_ventas,
    f"debe traer ventas de ambas cuentas, trajo: {referencias_ventas}")
chk(len(detalle["pagos_detalle"]) == 2, f"debe traer los 2 pagos individuales, trajo {len(detalle['pagos_detalle'])}")
chk(all("registrado_at" in p for p in detalle["pagos_detalle"]), "cada pago individual trae su hora")
chk(any(v["producto"] == "Cerveza Bucanero" and "agregado_at" in v for v in detalle["ventas"]),
    "cada venta trae la hora en que se pidió")

paso("El historial de cierres lista el día recién cerrado")
r = requests.get(f"{BASE}/cierre-caja", params={"usuario_id": gerente_id})
chk(r.status_code == 200 and len(r.json()) == 1, f"listar cierres status {r.status_code}: {r.text}")

# ---------------------------------------------------------------------
# 7. Salida manual de insumo
# ---------------------------------------------------------------------
paso("Administrador registra una salida manual (consumo interno)")
insumo_prueba = requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json()[0]
r = requests.post(f"{BASE}/insumos/{insumo_prueba['id']}/salida", json={
    "usuario_id": administrador_id, "cantidad": 1, "categoria": "consumo_interno", "nota": "prueba",
})
chk(r.status_code == 201, f"salida status {r.status_code}: {r.text}")

paso("Vendedor no puede registrar salida")
r = requests.post(f"{BASE}/insumos/{insumo_prueba['id']}/salida", json={
    "usuario_id": vendedor_id, "cantidad": 1, "categoria": "merma", "nota": "prueba",
})
chk(r.status_code == 401, f"debe rechazar con 401, fue {r.status_code}: {r.text}")

# ---------------------------------------------------------------------
# 8. Reportes
# ---------------------------------------------------------------------
paso("Exportar reportes")
r = requests.get(f"{BASE}/reportes/inventario.xlsx", params={"usuario_id": gerente_id})
chk(r.status_code == 200, f"exportar inventario status {r.status_code}")
r = requests.get(f"{BASE}/reportes/ventas.xlsx", params={"usuario_id": gerente_id})
chk(r.status_code == 200, f"exportar ventas status {r.status_code}")

print("\n\n✅ TODAS LAS PRUEBAS PASARON")
