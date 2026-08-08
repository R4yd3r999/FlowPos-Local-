# FlowPos (Local)

Sistema de Punto de Venta y Gestión Empresarial. Corre 100% en esta
máquina, sin internet. Base de datos, servidor y panel de venta: todo
en un solo lugar, en un solo programa.

---

## 0. Elegí cómo lo vas a correr

Hay tres formas, de más simple a más flexible. Para la laptop del
negocio (sin internet), lo pensado es la **A**.

| Opción | Necesita Python instalado | Necesita internet para arrancar | Cuándo usarla |
|---|---|---|---|
| **A. Ejecutable compilado** (`FlowPos` / `FlowPos.exe`) | No | No | La laptop del negocio, uso diario |
| **B. Código fuente + `python run.py`** | Sí | No (solo la primera vez, para instalar dependencias) | Para probar cambios, o si preferís no compilar |
| **C. Compilar vos mismo el ejecutable** | Sí, solo en la máquina donde compilás | Sí, solo en la máquina donde compilás | Para generar tu propio `.exe`/binario, o actualizar versión |

Los pasos de la **C** son los mismos que usé yo para generar el
ejecutable que te dejo en `dist/` — así que si algo no calza en tu
máquina, podés reproducir exactamente lo que hice.

---

## 1. Opción A — Usar el ejecutable ya compilado

### En Linux (Debian)

Te dejo un binario ya compilado en `dist/FlowPos`, probado en Ubuntu
24.04 (glibc 2.39). **Aviso importante y honesto:** si tu Debian es
más viejo, es posible que ese binario específico no arranque —
glibc no es compatible hacia atrás. Vas a ver un error del tipo
`GLIBC_2.39 not found`. Si pasa eso, no es nada grave: andá directo a
la sección 3 y compilalo vos mismo en tu propia máquina — tarda menos
de dos minutos y queda garantizado que corre ahí.

1. Copiá la carpeta completa del programa a la laptop del negocio (USB, red local, como sea).
2. Dentro de la carpeta:
   ```bash
   chmod +x FlowPos
   ./FlowPos
   ```
3. Se abre solo el navegador en `http://127.0.0.1:8000`.

### En Windows

Como expliqué más abajo (sección 4), **no puedo compilar un `.exe` de
Windows desde este entorno** — PyInstaller no cruza de un sistema
operativo a otro, hay que compilarlo EN Windows. Te dejo todos los
pasos exactos en la sección 4 para que generes `FlowPos.exe` vos
mismo la primera vez (toma unos minutos, una sola vez, con internet).
Una vez generado, copiarlo y usarlo en cualquier otra PC con Windows
no necesita internet ni Python.

---

## 2. Opción B — Correr desde el código fuente

Útil para probar, o si preferís no compilar nada.

**Requisitos:** Python 3.11 o más nuevo ([python.org](https://www.python.org/downloads/)).

1. Abrí una terminal dentro de esta carpeta.
2. Instalá las dependencias (una sola vez, necesita internet solo esta vez):
   ```bash
   pip install -r requirements.txt
   ```
3. Arrancá el sistema:
   ```bash
   python run.py
   ```
4. Se abre solo el navegador en `http://127.0.0.1:8000`.

Las próximas veces, solo el paso 3.

---

## 3. Compilar el ejecutable en Linux (Debian) — paso a paso

Esto es exactamente lo que corrí yo para generar `dist/FlowPos`.
Necesitás internet solo para este paso (instalar herramientas); el
resultado final no.

```bash
# 1. Parado en la carpeta del proyecto (donde está run.py)
cd pos_local

# 2. Crear un entorno virtual limpio (recomendado, evita mezclar con otros proyectos Python)
python3 -m venv venv
source venv/bin/activate

# 3. Instalar las dependencias del programa + la herramienta de empaquetado
pip install -r requirements.txt
pip install pyinstaller

# 4. Compilar usando el archivo de configuración incluido (pos_local.spec)
pyinstaller pos_local.spec

# 5. El ejecutable queda en dist/FlowPos
cd dist
chmod +x FlowPos
./FlowPos
```

Si en el paso 4 ves errores de `ModuleNotFoundError` al arrancar el
ejecutable (poco probable, ya lo dejé configurado, pero puede pasar
con versiones distintas de las librerías), el archivo `pos_local.spec`
tiene una lista de `hiddenimports` — agregá ahí el módulo que falte y
volvé a correr `pyinstaller pos_local.spec`.

**Para llevarlo a la laptop del negocio:** copiá únicamente el archivo
`dist/FlowPos` (es un solo archivo, ~44 MB, con todo adentro — Python,
las librerías, el frontend). No hace falta copiar el código fuente ni
la carpeta `venv/`.

---

## 4. Compilar el ejecutable en Windows — paso a paso

Esto necesita hacerse **en una PC con Windows**, una sola vez, con
internet. Yo no puedo ejecutar Windows desde donde estoy corriendo,
así que estos son los pasos estándar de PyInstaller aplicados a este
proyecto — el mismo mecanismo que ya verifiqué funciona en Linux.

1. Instalá Python 3.11+ desde [python.org](https://www.python.org/downloads/windows/).
   **Importante:** en el instalador, marcá la casilla *"Add python.exe to PATH"*.
2. Abrí PowerShell (o cmd) dentro de la carpeta del proyecto (`pos_local`).
3. Creá un entorno virtual e instalá dependencias:
   ```powershell
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   pip install pyinstaller
   ```
4. Compilá con el mismo archivo de configuración:
   ```powershell
   pyinstaller pos_local.spec
   ```
5. El ejecutable queda en `dist\FlowPos.exe`. Doble clic y arranca —
   Windows puede mostrar una advertencia de "Windows protegió tu PC"
   la primera vez porque el ejecutable no está firmado digitalmente
   (firma que cuesta dinero y no es necesaria para uso interno);
   click en "Más información" → "Ejecutar de todas formas".

**Antivirus:** los ejecutables generados por PyInstaller a veces
disparan falsos positivos en algunos antivirus (es un problema conocido
de la herramienta, no de este programa). Si pasa, agregá una excepción
para `FlowPos.exe`, o probá compilar en modo carpeta en vez de archivo
único (cambiá en `pos_local.spec` para que `a.binaries` y `a.datas` no
vayan directo en `EXE(...)`, sino en un `COLLECT(...)` aparte — si
llegás a necesitar esto y no te sale, decime y lo ajustamos).

### Instalador de Windows (opcional)

Si además de un `.exe` portable querés un instalador de verdad (el
típico "Siguiente, Siguiente, Instalar", con acceso directo en el
Menú Inicio y desinstalador), te dejo `instalador_windows.iss` en la
carpeta del proyecto. Usa [Inno Setup](https://jrsoftware.org/isinfo.php)
(gratis):

1. Instalá Inno Setup en la PC con Windows donde compilaste el `.exe`.
2. Abrí `instalador_windows.iss` con Inno Setup.
3. Verificá que la ruta de `FlowPos.exe` apunte a `dist\FlowPos.exe`.
4. Click en **Compilar** (Build → Compile, o F9).
5. Genera un `FlowPos_Setup.exe` en la carpeta `Output\` — ese es el
   instalador para repartir.

**Aviso:** no tengo forma de correr Inno Setup ni Windows desde acá,
así que este script lo armé siguiendo la documentación oficial de Inno
Setup pero no pude probarlo end-to-end como sí hice con el resto. Si
algo no compila, mandame el error exacto y lo corregimos.

---

## 5. Actualizar el programa sin perder la base de datos

Esta es la garantía que pediste, y la diseñé a propósito para esto:

**La base de datos (`data/pos.db`) vive JUNTO al ejecutable, nunca
adentro de él.** Cuando actualizás a una versión nueva, solo
reemplazás el archivo `FlowPos` / `FlowPos.exe` — la carpeta `data/`
al lado se queda intacta, tal cual estaba.

Pasos para actualizar:

1. Copiá el `FlowPos` / `FlowPos.exe` nuevo a la carpeta del programa,
   **reemplazando** al viejo (mismo nombre, misma carpeta).
2. **No toques la carpeta `data/`.**
3. Arrancá el programa nuevo normalmente. Si la versión nueva agregó
   tablas o columnas a la base de datos, se agregan solas al arrancar,
   sin perder nada de lo que ya había — así están armadas las
   migraciones desde el principio de este proyecto, y las probé cada
   vez contra una base de datos real, no solo contra una vacía.

Lo probé de verdad: compilé el ejecutable, lo corrí, cargué datos,
"actualicé" (reemplacé el archivo por una copia nueva) y confirmé que
el negocio seguía ahí — mismo PIN, mismo inventario, sin re-sembrar
nada.

**Respaldo de todas formas:** aunque esto te protege de perder datos
al *actualizar*, no te protege de perder el disco entero. Copiá
`data/pos.db` a un USB al final del día — sigue siendo tu única
verdadera copia de seguridad.

---

## 6. Primer arranque: tu cuenta Gerente

La primera vez que el programa corre (cuando `data/` todavía no
existe), crea automáticamente **una única cuenta Gerente**, sin
catálogo de productos ni insumos de ejemplo — el negocio real carga
el suyo desde cero.

El PIN inicial se muestra en la consola la primera vez que arranca, y
además queda guardado en `data/PIN_INICIAL_GERENTE.txt` como respaldo
(podés borrar ese archivo después de anotarlo en un lugar seguro).

Cambialo apenas entres, desde el engranaje (⚙) arriba a la derecha —
ahí también gestionás las cuentas de Vendedor y Administrador: crear,
editar nombre/PIN/rol, y desactivar. El Gerente es uno solo a
propósito — el sistema no ofrece crear un segundo desde esa pantalla.

---

## 7. Acceso desde celular (meseros)

El sistema escucha en toda la red local, no solo en esta PC — cualquier
celular conectado a la **misma wifi** puede tomar pedidos desde
`http://IP-DE-ESTA-PC:8000/mesero`, una pantalla aparte, pensada desde
cero para el teléfono (botones grandes, sin tablas apretadas).

**Cómo conectar un celular:**
1. Abrí el sistema en esta PC y entrá con tu cuenta de Gerente.
2. Tocá el engranaje (⚙) → vas a ver un código QR y la dirección exacta.
3. Desde el celular del mesero (conectado a la misma wifi), escaneá el
   QR o escribí esa dirección en el navegador.
4. El mesero entra con su propio PIN, igual que en la PC principal.

**Qué puede hacer un mesero desde el celular:** todo lo que ya podía
hacer un Vendedor desde la pantalla principal — abrir mesas, tomar
pedidos, cobrar, cerrar cuentas, e iniciar/finalizar sesiones de
billar. Los permisos son los mismos de siempre (ver sección 8):
cambiar eso desde el celular no abre ninguna puerta que no estuviera
ya abierta desde la PC.

**Varios meseros a la vez:** la pantalla se actualiza sola cada pocos
segundos, así que si dos meseros comparten una mesa, ambos ven los
cambios del otro sin tener que recargar.

**Si Windows pregunta por el firewall** la primera vez que arrancás el
programa ("¿Permitir que FlowPos se comunique en redes públicas y
privadas?"), aceptá — si no, los celulares no van a poder conectarse
aunque estén en la misma wifi.

**Por ahora esto asume que la wifi es exclusiva del personal.** Si en
algún momento vas a compartir la misma red con clientes, avisame antes
de eso: hoy cualquiera en la red alcanza el sistema con solo saber la
dirección (no hay nada "secreto" en la URL), lo cual es razonable en
una red cerrada del negocio pero no en una wifi pública.

---

## 8. Roles y permisos

Verificados en el servidor, no solo ocultos en la pantalla — llamar la
API directo sin pasar por la interfaz se rechaza igual.

| Acción | Vendedor | Administrador | Gerente |
|---|---|---|---|
| Vender, billar, ver menú | ✅ | ✅ | ✅ |
| Ver insumos/stock | ❌ | ✅ solo lectura | ✅ completo |
| Crear/editar insumos, productos, recetas, mesas | ❌ | ❌ | ✅ |
| Registrar salida manual de insumo (merma, consumo interno) | ❌ | ✅ | ✅ |
| Abrir/cerrar caja | ❌ | ✅ | ✅ |
| Historial de precios, historial de cierres, Configuración | ❌ | ❌ | ✅ |

---

## 9. Qué incluye esta versión

- Venta con cuentas abiertas (mesas o clientes), pago dividido en varias monedas.
- Cantidad al vender en un solo paso (7 cervezas no son 7 taps).
- Inventario real por receta: vender una hamburguesa descuenta pan, carne y queso.
- Receta editable desde Productos (solo Gerente), visible en la tabla.
- Tres roles con permisos reales verificados en el servidor.
- Mesas de billar gestionables (crear, editar tarifa por hora, desactivar).
- La caja debe abrirse antes de vender.
- **Conteo físico de inventario obligatorio, al abrir y al cerrar caja**, con nota
  obligatoria si hay diferencia — no pasa nada en silencio.
- **Salida manual de insumo** en cualquier momento (consumo interno / merma / otro),
  con nota obligatoria, para no mezclar lo declarado con lo desconocido.
- **Historial de días navegable**, agrupado por cuenta de cliente, con hora de cada
  producto vendido y el detalle de cada pago individual debajo de su total agregado.
- **Historial completo de movimientos de inventario** (entradas, salidas de venta,
  salida manual, reversas, ajustes de conteo), con o sin caja abierta, filtrable por
  insumo/tipo/fecha, y con acceso rápido desde cada insumo.
- **Exportación a Excel y PDF** de movimientos de inventario y de cada día de caja
  completo (pagos, ventas, movimientos, ambos conteos).
- Trazabilidad de quién creó y editó cada producto e insumo, con historial de precios.
- **Acceso desde celular para meseros** por la red local (wifi del negocio), con
  pantalla táctil propia y actualización automática entre dispositivos (ver sección 7).
- **Panel de Configuración (⚙, solo Gerente)** para gestionar cuentas de Vendedor y
  Administrador, y mostrar el QR de acceso para celulares.
- Empaquetable como ejecutable único para Linux y Windows, sin depender de tener Python instalado.

---

## 10. Cosas que tenés que saber para que no se rompa nada

- **Copia de seguridad:** `data/pos.db` es todo tu negocio. Copialo a
  un USB al final de cada día.
- **Unidades de insumos:** si comprás queso por kilos pero la receta
  lo usa en gramos, registrá el insumo en gramos (1 kg = 1000). El
  sistema no convierte unidades por vos.
- **Producto "Tiempo de billar":** se crea solo al primer arranque, no
  lo borres — es lo que usa internamente el cobro de las mesas.
- **Cancelar con motivo:** siempre pide una razón, a propósito — es tu
  rastro de auditoría.

---

## 11. Pruebas automáticas (opcional)

```bash
pip install requests
python run.py                      # en una terminal, déjalo corriendo
python tests/test_flujo.py         # en otra terminal
python tests/test_concurrencia.py  # opcional, prueba bajo carga
```

Ambas deben terminar con "✅ TODAS LAS PRUEBAS PASARON" / "✅ CONCURRENCIA OK".

---

## Estructura del proyecto

```
app/                  backend (FastAPI + SQLite, sin ORM)
frontend/              interfaz de escritorio (HTML/CSS/JS puro, sin frameworks ni CDN)
frontend_mesero/        interfaz mobile para meseros (misma idea, pantalla aparte)
schema.sql             esquema completo de la base de datos, comentado
tests/                 pruebas end-to-end y de concurrencia
run.py                 arranca todo con un comando (o compilado)
pos_local.spec         configuración de PyInstaller (Linux y Windows usan la misma)
instalador_windows.iss configuración de Inno Setup (instalador Windows, opcional)
dist/FlowPos          ejecutable Linux ya compilado (ver sección 1)
```
