# Control de brazaletes: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoja de Google Sheets con Apps Script para registrar ingresos y salidas de brazaletes, con stock en rollos, alerta (formulario, Resumen y correo), anulación con rastro y Resumen exportable a PDF.

**Architecture:** Un solo `src/Codigo.gs` (como papel bond) con tres bloques: llamadas de Apps Script, lógica pura sin APIs de Google (probada con `node --test` + `vm`) y dibujo del Resumen. `src/Formulario.html` para ingreso/salida; el diálogo de anulación es HTML en línea dentro de `Codigo.gs`, como `abrirEscaneo` en papel bond.

**Tech Stack:** Google Apps Script (V8), Google Sheets, HtmlService, MailApp, DriveApp, UrlFetchApp; Node.js 24 `node:test` para pruebas. Sin dependencias.

**Spec:** `docs/superpowers/specs/2026-11-09-control-brazaletes-design.md`

**Referencia de patrones:** repo `ygallardops/control-papel-bond` (`src/Codigo.gs`, `src/Formulario.html`, `test/codigo.test.js`, `README.md`). Solo lectura: no modificar.

## Global Constraints

- Unidades: `ROLLOS_POR_CAJA = 5`, `BRAZ_POR_ROLLO = 100`. Unidad de trabajo: rollo.
- Destinos fijos: `Admisión de Hospitalización`, `Admisión de Emergencias`, `Módulos`.
- Solicitantes fijos: `Jefe de la Unidad de Registros Médicos`, `Jefe de la Oficina`.
- Origen de ingresos: siempre `Farmacia` (sin campo).
- N° de registro: `S-0001` salidas, `I-0001` ingresos; interno, no se anota en el cuaderno.
- Alerta por defecto: 2 rollos (celda amarilla del Resumen). Correo a `ALERTA_CORREO`.
- En `src/`: `INSTITUCION = 'Nombre de la institución'`, `OFICINA = 'Nombre de la oficina'`, `MANUAL_URL = ''`, `ALERTA_CORREO = ''`. Datos reales solo en `local/` (en `.gitignore`).
- Fórmulas con `setFormula` en inglés y con comas; reportes calculados en el script.
- Fechas de movimiento al mediodía: `new Date(y, m-1, d, 12)`.
- `LockService.getDocumentLock()` al registrar y al anular.
- Protección de Movimientos solo como advertencia.
- PDF por URL de exportación (A4 vertical), nunca Archivo → Imprimir.
- Textos en español, sobrios, sin emojis (tampoco ✔ ni ⚠ del formulario de papel bond).
- Mostrar el diff al usuario y esperar su visto bueno antes de cada commit.

## Review Focus

- Mezcla de movimientos activos y ANULADOS: stock, reportes, sugerencias y N° deben ignorar o respetar los anulados según corresponda → pruebas en Tareas 1 y 2.
- Anular un ingreso cuando ya se entregó parte: debe rechazarse si deja stock negativo → prueba en Tarea 1.
- Registro con fecha pasada (por ejemplo, del mes anterior): cuenta en el mes de su fecha, no en el de registro → prueba en Tarea 2.
- `ALERTA_CORREO` vacío o `MailApp` que falla: el registro igual se guarda y el formulario confirma → Tarea 3, paso de verificación manual.
- Historial menor a 3 meses cerrados: el promedio usa solo los meses cerrados existentes; sin meses cerrados, cobertura "—" → prueba en Tarea 2.

## Estructura de archivos

```text
src/Codigo.gs          Menú, registro, anulación, correo, Resumen, PDF, configuración, lógica pura
src/Formulario.html    Formulario de salida e ingreso
src/appsscript.json    Zona horaria America/Lima, V8
test/codigo.test.js    Pruebas de la lógica pura
docs/manual.md         Texto del manual (genérico) para pegar en el Google Doc
README.md, LICENSE, .gitignore, .gitattributes, .github/workflows/pruebas.yml
local/Codigo.gs        Copia con datos reales (no se sube)
```

Columnas de Movimientos (índices base 0, constante `C`):

```js
const ENCABEZADOS = ['N°', 'Fecha', 'Tipo', 'Cajas', 'Rollos', 'Total rollos', 'Destino', 'Recibe',
  'Entregado por', 'Solicitado por', 'Recogido por', 'Referencia del pedido', 'Estado', 'Motivo de anulación',
  'Anulado por', 'Anulado el', 'Registrado por', 'Registrado el'];
const C = { NUM: 0, FECHA: 1, TIPO: 2, CAJAS: 3, ROLLOS: 4, TOTAL: 5, DESTINO: 6, RECIBE: 7, ENTREGA: 8,
  SOLICITA: 9, RECOGE: 10, REF: 11, ESTADO: 12, MOTIVO: 13, ANULA_POR: 14, ANULA_EL: 15, REG_POR: 16, REG_EL: 17 };
```

---

### Task 1: Repo y lógica pura de stock, numeración y anulación

**Files:**
- Create: `src/Codigo.gs`, `src/appsscript.json`, `test/codigo.test.js`, `.gitignore`, `.gitattributes`, `LICENSE`, `.github/workflows/pruebas.yml`

**Interfaces:**
- Produces (en `Codigo.gs`, globales):
  - constantes `ROLLOS_POR_CAJA`, `BRAZ_POR_ROLLO`, `DESTINOS`, `SOLICITANTES`, `INSTITUCION`, `OFICINA`, `MANUAL_URL`, `ALERTA_CORREO`, `ENCABEZADOS`, `C`
  - `activas(filas: any[][]) -> any[][]` filas con `ESTADO !== 'ANULADO'`
  - `calcularStock(filas) -> number` ingresos − salidas activas, en rollos
  - `siguienteNumero(filas, tipo: 'INGRESO'|'SALIDA') -> string` máximo numérico del prefijo (incluye anulados) + 1, 4 dígitos
  - `validarAnulacion(filas, num: string) -> number` índice en `filas`; lanza `Error` si no existe, ya está anulado, o si es ingreso y `calcularStock(filas) - total < 0`
  - `cruzaMinimo(antes: number, despues: number, min: number) -> boolean` `antes > min && despues <= min`
  - `cantidadTexto(cajas: number, rollos: number) -> string`
  - `stockTexto(rollos: number) -> string`

- [ ] **Step 1: Setup.** `git init`; `.gitignore` = `.clasp.json`, `node_modules/`, `local/`; copiar `.gitattributes`, `LICENSE` (MIT, titular igual que papel bond) y `.github/workflows/pruebas.yml` de papel bond; `appsscript.json` igual al de papel bond (verificar `timeZone: America/Lima`, `runtimeVersion: V8`).

- [ ] **Step 2: Write the failing tests** en `test/codigo.test.js` (cargar `src/Codigo.gs` con `vm` como papel bond; helper `fila(num, tipo, total, estado = '')` que arma un arreglo de 18 columnas):

```js
test('stock ignora anulados', () => {
  const f = [fila('I-0001', 'INGRESO', 10), fila('S-0001', 'SALIDA', 3), fila('S-0002', 'SALIDA', 4, 'ANULADO')];
  assert.strictEqual(g.calcularStock(f), 7);
  assert.strictEqual(g.calcularStock([]), 0);
});
test('siguiente número por tipo, contando anulados', () => {
  const f = [fila('I-0001', 'INGRESO', 5), fila('S-0001', 'SALIDA', 1), fila('S-0009', 'SALIDA', 1, 'ANULADO')];
  assert.strictEqual(g.siguienteNumero(f, 'SALIDA'), 'S-0010');
  assert.strictEqual(g.siguienteNumero(f, 'INGRESO'), 'I-0002');
  assert.strictEqual(g.siguienteNumero([], 'SALIDA'), 'S-0001');
});
test('anulación: válida, inexistente, repetida y stock negativo', () => {
  const f = [fila('I-0001', 'INGRESO', 5), fila('I-0002', 'INGRESO', 5), fila('S-0001', 'SALIDA', 7),
    fila('S-0002', 'SALIDA', 1, 'ANULADO')];
  assert.strictEqual(g.validarAnulacion(f, 'S-0001'), 2);
  assert.throws(() => g.validarAnulacion(f, 'S-0099'), /no existe/);
  assert.throws(() => g.validarAnulacion(f, 'S-0002'), /ya está anulado/);
  assert.throws(() => g.validarAnulacion(f, 'I-0001'), /stock negativo/);
});
test('cruce del mínimo solo al pasar de arriba a abajo', () => {
  assert.strictEqual(g.cruzaMinimo(3, 2, 2), true);
  assert.strictEqual(g.cruzaMinimo(2, 1, 2), false);
  assert.strictEqual(g.cruzaMinimo(5, 4, 2), false);
});
test('textos de cantidad y stock', () => {
  assert.strictEqual(g.cantidadTexto(1, 0), '1 caja');
  assert.strictEqual(g.cantidadTexto(2, 1), '2 cajas + 1 rollo');
  assert.strictEqual(g.cantidadTexto(0, 3), '3 rollos');
  assert.strictEqual(g.stockTexto(12), '12 rollos (2 cajas + 2 rollos, 1200 brazaletes)');
});
```

- [ ] **Step 3: Run** `node --test` → FAIL (funciones no definidas).
- [ ] **Step 4: Implement** las funciones de *Produces* en `src/Codigo.gs`, sección `// ---------- Lógica pura ----------`.
- [ ] **Step 5: Run** `node --test` → PASS.
- [ ] **Step 6: Mostrar diff al usuario; con su visto bueno, commit** `feat: lógica de stock, numeración y anulación`.

### Task 2: Lógica pura de reportes

**Files:** Modify `src/Codigo.gs`, `test/codigo.test.js`

**Interfaces:**
- Consumes: `activas`, `C`, `DESTINOS` (Task 1)
- Produces:
  - `MESES` (`['ene', …, 'dic']`)
  - `agrupar(filas, tipo, col, desde: Date, hasta: Date) -> [string, number][]` solo activas, fechas inclusive por día, orden desc por total y luego por nombre
  - `conBarras(lista) -> [nombre, total, pct, barra][]` igual que papel bond
  - `mesAMes(filas, hoy: Date, n) -> [mes, ingresos, salidas, saldoAlCierre][]` desde el primer mes con movimientos activos
  - `destinosPorMes(filas, hoy, n) -> { meses: string[], filas: [destino, ...n números][] }`
  - `promedioMensual(filas, hoy) -> number|null` salidas activas de los últimos 3 meses **cerrados** (sin el mes de `hoy`) divididas entre los meses cerrados desde el primer movimiento (máximo 3); `null` si no hay ninguno cerrado
  - `cobertura(stock, promedio) -> number|null` `stock / promedio` redondeado a 1 decimal; `null` si `promedio` es `null` o 0

- [ ] **Step 1: Write the failing tests** (fechas con el `Date` del contexto `vm`, helper `D` como papel bond; `mov(num, fecha, tipo, total, destino, recibe, estado = '')`). Datos:

```js
const datos = [
  mov('I-0001', D(2026, 7, 20, 12), 'INGRESO', 20, ''),
  mov('S-0001', D(2026, 8, 5, 12), 'SALIDA', 4, 'Módulos', 'Ana'),
  mov('S-0002', D(2026, 9, 1, 12), 'SALIDA', 2, 'Admisión de Emergencias', 'Luis'),
  mov('S-0003', D(2026, 9, 3, 12), 'SALIDA', 5, 'Módulos', 'Ana'),
  mov('S-0004', D(2026, 9, 3, 12), 'SALIDA', 9, 'Módulos', 'Ana', 'ANULADO'),
  mov('S-0005', D(2026, 8, 30, 12), 'SALIDA', 1, 'Módulos', 'Ana'), // registrado tarde, fecha pasada
];
```

Asserts:
- `agrupar(datos, 'SALIDA', C.DESTINO, D(2026,9,1), D(2026,9,4))` → `[['Módulos', 5], ['Admisión de Emergencias', 2]]` (excluye anulado).
- `mesAMes(datos, D(2026,9,4), 12)` → `[['ago 2026', 20, 0, 20], ['sep 2026', 0, 5, 15], ['oct 2026', 0, 7, 8]]` (S-0005 cuenta en septiembre).
- `destinosPorMes(datos, D(2026,9,4), 3).filas` → `[['Módulos', 0, 5, 5], ['Admisión de Emergencias', 0, 0, 2]]`.
- `promedioMensual(datos, D(2026,9,4))` → `2.5` (ago 0 + sep 5, 2 meses cerrados); `promedioMensual(datos, D(2026,7,25))` → `null`; `promedioMensual(datos, D(2027,0,10))` → `(7+0+0)/3`.
- `cobertura(8, 2.5)` → `3.2`; `cobertura(8, null)` → `null`; `cobertura(8, 0)` → `null`.
- `conBarras` igual que la prueba de papel bond.

- [ ] **Step 2: Run** `node --test` → FAIL.
- [ ] **Step 3: Implement** adaptando `agrupar`, `conBarras`, `mesAMes`, `areasPorMes` (renombrada `destinosPorMes`) de papel bond, filtrando con `activas`; agregar `promedioMensual` y `cobertura`.
- [ ] **Step 4: Run** `node --test` → PASS.
- [ ] **Step 5: Diff al usuario → commit** `feat: cálculos de reportes`.

### Task 3: Formulario, registro, correo de alerta y configuración inicial

**Files:** Modify `src/Codigo.gs`; Create `src/Formulario.html`

**Interfaces:**
- Consumes: Task 1 completa.
- Produces:
  - `onOpen()` menú `Brazaletes`: Registrar movimiento · Anular registro · Actualizar resumen · Exportar reporte a PDF · Manual de uso · separador · Configuración inicial (solo una vez). Igual que papel bond, aplica la protección si falta y llama `renderResumen()`.
  - `onEdit(e)` redibuja si se edita Movimientos o una celda de `R` del Resumen.
  - `R = { MIN: 'E6', DESDE: 'B10', HASTA: 'D10' }` (celdas amarillas; las usa la Tarea 5).
  - `datosFormulario() -> { rollosCaja, brazRollo, stock, minimo, destinos, solicitantes, personas, custodio, proximoSalida, proximoIngreso }`; `personas` = nombres únicos de Recibe, Entregado por y Recogido por en filas activas.
  - `registrar(f) -> { tipo, num, cantidad, stock }`; `f = { tipo, fecha:'yyyy-mm-dd', cajas, rollos, destino, recibe, entrega, solicita, recoge, ref }`.
  - `minimo_() -> number` lee `R.MIN` (por defecto 2).
  - `avisarSiCruza_(antes, despues)` llama `cruzaMinimo`; si es true y `ALERTA_CORREO` no está vacío, `MailApp.sendEmail` dentro de `try/catch` (el error se ignora con `console.error`).
  - `configurar()` pide stock inicial en rollos; si es > 0, crea `I-0001` con Recogido por = `Stock inicial`.
  - Funciones stub `renderResumen()` (vacía hasta la Tarea 5) si hace falta para ejecutar.

Validaciones de `registrar` (mensajes en español):
- SALIDA: `rollos` entero > 0, `cajas` se ignora (0); `destino` ∈ `DESTINOS`; `recibe` y `entrega` obligatorios; `total <= stock`, si no, `Stock insuficiente: solo hay N rollo(s).`
- INGRESO: `cajas`, `rollos` enteros ≥ 0, suma > 0; `solicita` ∈ `SOLICITANTES`; `recoge` obligatorio; `ref` opcional; `total = cajas * ROLLOS_POR_CAJA + rollos`.
- Texto libre recortado y con `'` delante si empieza con `= + - @` (como papel bond).
- Dentro del lock: recalcular stock y número, `appendRow`, `avisarSiCruza_(stock, stockNuevo)`, guardar custodio en `UserProperties` (salida: `entrega`; ingreso: `recoge`), `renderResumen()`.

Correo: asunto `Stock bajo de brazaletes: N rollo(s)`; cuerpo de 3–4 líneas sobrias con stock (`stockTexto`), mínimo, fecha y "Se recomienda solicitar brazaletes a Farmacia." Firma: `INSTITUCION · OFICINA`.

Formulario (`Formulario.html`): misma estructura y estilos que papel bond. Salida: Fecha, Rollos, Destino (`<select>` desde `destinos`), Recibe, Entregado por. Ingreso: Fecha, Cajas (5 rollos c/u), Rollos, Solicitado por (`<select>`), Recogido por, Referencia del pedido (opcional). Arriba: `Stock: ` + texto equivalente a `stockTexto`, clase `bajo` si `stock <= minimo`. Confirmación: `Salida registrada: N rollo(s). N° interno S-0001. Stock restante: …` y, si queda en alerta, `STOCK BAJO: corresponde solicitar brazaletes a Farmacia.` Sin emojis. No mostrar el N° como algo a anotar en el cuaderno.

- [ ] **Step 1: Implement** lo anterior.
- [ ] **Step 2: Run** `node --test` → PASS (el `.gs` debe seguir cargando en `vm` sin APIs de Google en el nivel superior).
- [ ] **Step 3: Verificación manual** (en una hoja de prueba, con `clasp push` o copiando): configuración inicial con 0; ingreso de 1 caja (stock 5); salida de 6 → error de stock; salida de 3 → stock 2, correo enviado a una dirección de prueba; salida de 1 → sin correo nuevo; con `ALERTA_CORREO = ''` la salida se registra sin error.
- [ ] **Step 4: Diff al usuario → commit** `feat: formulario de registro y alerta por correo`.

### Task 4: Anular registro

**Files:** Modify `src/Codigo.gs`, `test/codigo.test.js`

**Interfaces:**
- Consumes: `validarAnulacion`, `calcularStock`, `avisarSiCruza_`, `stockTexto`.
- Produces:
  - `opcionesAnulacion(filas, n) -> { num: string, texto: string }[]` últimas `n` filas activas, la más reciente primero; `texto` = `S-0003 · 03/10/2026 · Salida · 5 rollos · Módulos · Ana` (ingreso: `Farmacia · <recogido por>`). Fecha con `dd/mm/yyyy` armada a mano (sin `Utilities`) para poder probarla.
  - `abrirAnulacion()` diálogo HTML en línea: `<select>` con `opcionesAnulacion(filas, 50)`, motivo (obligatorio), botón Anular, mensaje de resultado.
  - `anular(num, motivo) -> { num, stock }` dentro del lock: `validarAnulacion`, motivo no vacío (saneado), escribe Estado `ANULADO`, motivo, correo de quien anula, `new Date()`; `avisarSiCruza_`; `renderResumen()`.

- [ ] **Step 1: Failing test** `opcionesAnulacion`: con 3 filas activas y 1 anulada, `n = 2` → 2 opciones, la primera es la última activa, el texto coincide exactamente con el formato de arriba para una salida y para un ingreso.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Verificación manual:** anular una salida (stock sube, fila marcada, deja de figurar en la lista); intentar anular un ingreso ya consumido → mensaje de stock negativo.
- [ ] **Step 6: Diff al usuario → commit** `feat: anulación de registros con rastro`.

### Task 5: Resumen y exportación a PDF

**Files:** Modify `src/Codigo.gs`

**Interfaces:**
- Consumes: Task 2 completa, `R`, `minimo_`, `calcularStock`, `stockTexto`.
- Produces: `renderResumen()`, `exportarReportePdf()`, `abrirManual()`, `dialogoEnlace_`, `carpeta_`, `tarjeta_`, `seccion_`, `tabla_` (adaptados de papel bond).

Contenido (6 columnas, como papel bond):
- Título `Control de Brazaletes de Identificación`; subtítulo `INSTITUCION · OFICINA`; "Actualizado".
- Tarjetas: `STOCK ACTUAL` (rollos; nota `N cajas + N rollos · N brazaletes`, y ` · STOCK BAJO` en rojo si corresponde); `COBERTURA` (`cobertura` con formato `0.0 "meses"` o `—`; nota `promedio N rollos/mes`); `ALERTA DE STOCK` en `R.MIN` (editable, `0 "rollos"`).
- Período en `R.DESDE`/`R.HASTA` (por defecto mes en curso) con totales de ingresos y salidas en rollos.
- Tablas: Consumo por destino (período) · Consumo por persona que recibe (período) · Mes a mes (últimos 12 meses, rollos) · Consumo por destino (últimos 5 meses, rollos).
- Sin tarjeta de pendientes de firma ni tabla de ingresos por origen.
- PDF: igual que `exportarReportePdf` de papel bond; carpeta `Reportes - Brazaletes`; nombre `Reporte brazaletes dd-MM-yyyy al dd-MM-yyyy.pdf`.

- [ ] **Step 1: Implement.** **Step 2: Run** `node --test` → PASS.
- [ ] **Step 3: Verificación manual:** con datos de prueba (incluida una fecha pasada y un anulado), el Resumen cuadra con lo calculado a mano; cambiar alerta y fechas redibuja; el PDF sale en una sola hoja A4 vertical, sin cuadrícula.
- [ ] **Step 4: Diff al usuario → commit** `feat: resumen y reporte PDF`.

### Task 6: README, manual y versión local

**Files:** Create `README.md`, `docs/manual.md`, `local/Codigo.gs`

- [ ] **Step 1: README** con la estructura del de papel bond (insignias, qué hace, hojas, instalación con tabla de constantes incluida `ALERTA_CORREO`, permisos — agrega envío de correo —, uso del menú, estructura, pruebas, datos). Sin planilla ni escaneos. Capturas solo con datos ficticios (pueden añadirse después).
- [ ] **Step 2: `docs/manual.md`** para quienes registran, genérico: abrir la hoja, registrar una salida (el cuaderno se firma como siempre; no anotar el N°), registrar un ingreso, qué hacer con la alerta, anular un error, ver y exportar el Resumen, no editar Movimientos a mano.
- [ ] **Step 3: `local/Codigo.gs`** = `src/Codigo.gs` con los valores reales de `INSTITUCION` y `OFICINA`, y `ALERTA_CORREO` y `MANUAL_URL` pendientes de que el usuario los proporcione. Confirmar con `git status` que `local/` no aparece.
- [ ] **Step 4: Run** `node --test` → PASS. búsqueda del nombre real de la institución y de correos con `git grep` → sin resultados.
- [ ] **Step 5: Diff al usuario → commit** `docs: README y manual de uso`. Crear el repo público `ygallardops/control-brazaletes` y hacer push solo con autorización explícita del usuario.
