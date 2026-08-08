import concurrent.futures
import requests

BASE = "http://127.0.0.1:8000/api"

gerente_id = requests.post(f"{BASE}/auth/login", json={"pin": "963400"}).json()["id"]

# Catálogo arranca vacío -- se crea el insumo/producto que hace falta para la prueba
r = requests.post(f"{BASE}/insumos", json={
    "usuario_id": gerente_id, "nombre": "Cerveza de prueba", "unidad_medida": "unidad",
    "cantidad_actual": 100, "cantidad_minima": 10, "costo_promedio": 9000,
})
insumo_id = r.json()["id"]
r = requests.post(f"{BASE}/productos", json={
    "usuario_id": gerente_id, "nombre": "Cerveza de prueba", "categoria": "bebida", "tipo": "directo",
    "precio_venta": 15000, "receta": [{"insumo_id": insumo_id, "cantidad_requerida": 1}],
})
cerveza = r.json()

cierre_actual = requests.get(f"{BASE}/cierre-caja/actual").json()
if cierre_actual is None:
    insumos_conteo = requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json()
    conteos = [{"insumo_id": i["id"], "cantidad_contada": i["cantidad_actual"]} for i in insumos_conteo]
    r = requests.post(f"{BASE}/cierre-caja/abrir", json={"usuario_id": gerente_id, "conteos": conteos})
    assert r.status_code == 201, f"no se pudo abrir caja para la prueba: {r.text}"

stock_antes = next(i for i in requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json() if i["nombre"] == "Cerveza de prueba")["cantidad_actual"]

N = 25
print(f"Stock inicial de cerveza: {stock_antes}. Lanzando {N} ventas concurrentes de 1 cerveza cada una...")

def vender_una_cerveza(i):
    r = requests.post(f"{BASE}/cuentas", json={"referencia": f"Concurrente {i}", "operador_apertura_id": gerente_id})
    if r.status_code != 201:
        return ("error_abrir", r.status_code, r.text)
    cuenta_id = r.json()["id"]
    r = requests.post(f"{BASE}/cuentas/{cuenta_id}/items",
                       json={"producto_id": cerveza["id"], "cantidad": 1, "usuario_id": gerente_id})
    return ("ok" if r.status_code == 201 else "error_item", r.status_code, r.text[:200])

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    resultados = list(ex.map(vender_una_cerveza, range(N)))

exitosos = [r for r in resultados if r[0] == "ok"]
fallidos = [r for r in resultados if r[0] != "ok"]

print(f"Exitosos: {len(exitosos)}/{N}")
if fallidos:
    print("FALLOS INESPERADOS:")
    for f in fallidos:
        print(" ", f)

stock_despues = next(i for i in requests.get(f"{BASE}/insumos", params={"usuario_id": gerente_id}).json() if i["nombre"] == "Cerveza de prueba")["cantidad_actual"]
esperado = stock_antes - len(exitosos)
print(f"Stock esperado: {esperado}, stock real: {stock_despues}")

if len(fallidos) == 0 and stock_despues == esperado:
    print("\n✅ CONCURRENCIA OK: sin pérdidas de datos ni bloqueos bajo carga simultánea")
else:
    print("\n❌ FALLO DE CONCURRENCIA")
    raise SystemExit(1)
