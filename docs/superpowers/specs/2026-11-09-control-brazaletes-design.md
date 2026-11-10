# Control de brazaletes de identificación: diseño

Fecha: 2026-11-09. Estado: borrador para aprobación.

## Para qué

La oficina recibe brazaletes de identificación de pacientes (solo adultos) desde Farmacia y los reparte a tres
destinos. Hoy no hay control de stock: se necesita saber cuántos rollos quedan, avisar a tiempo para pedir más y
ver cuánto consume cada destino mes a mes. Quien recibe ya firma en un cuaderno físico de cargo, guiado por
fecha; el sistema **no** duplica ese cargo ni le pide nada adicional a quien firma.

Es hermano del proyecto `control-papel-bond` (repo `ygallardops/control-papel-bond`, no se modifica): mismo
stack, mismos patrones, más simple.

## Objetivos

- Registrar ingresos y salidas desde un formulario en la hoja, rápido y con validación de stock.
- Stock siempre al día en rollos (con equivalente en cajas y brazaletes) y alerta de stock bajo.
- Resumen legible, exportable a PDF A4 vertical, con consumo por destino y mes a mes.
- Anular registros dejando rastro, de forma sencilla.
- Manual de uso para las demás personas.

## No objetivos

- Planilla imprimible de cargos, escaneo de planillas firmadas, casilla "Firmado" (el cuaderno ya cumple ese rol).
- Autorización por salida (está preaprobada).
- Varios tipos de brazalete (hoy solo adulto; si cambia, se rediseña).
- Brazaletes sueltos.

## Anti-objetivos (sería un fracaso aunque funcione)

- Que quien recibe tenga que anotar algo extra en el cuaderno (por ejemplo, el N° de registro).
- Que el repositorio público contenga datos reales: nombres, correos, institución u oficina reales.
- Reportes con fórmulas frágiles que se rompen (`#VALUE!`, errores de locale).

## Restricciones y contexto

- Google Sheets + Apps Script, sin dependencias. Propietaria: una cuenta de Google de trabajo del usuario.
- Registran 2 o 3 personas de la Unidad, todas con cuenta de Google (editoras de la hoja).
- Unidades: 1 caja = 5 rollos; 1 rollo = 100 brazaletes. La unidad de trabajo es el **rollo**.
- Ingresos: siempre desde Farmacia. Los pide por correo el Jefe de la Unidad de Registros Médicos o el Jefe de
  la Oficina; luego avisan para recogerlos. Hoy llegan cajas completas, pero podrían llegar rollos sueltos.
- Salidas: siempre en rollos enteros, a uno de tres destinos fijos: Admisión de Hospitalización, Admisión de
  Emergencias, Módulos. "Módulos" es un solo destino: una persona recibe y reparte a los módulos.
- Stock inicial actual: 0 rollos.

## Decisiones tomadas por el usuario

- Salidas solo en rollos; ingresos en cajas y/o rollos.
- En cada salida se registra el nombre de quien recibe y quien entrega.
- En cada ingreso se registra quién lo solicitó (lista fija de dos cargos) y quién lo recogió en Farmacia.
- Alerta en rollos, valor inicial 2, editable. Se muestra en el formulario y en el Resumen, y además se envía por
  correo a la Jefatura de la Unidad de Registros Médicos.
- Resumen con consumo por destino, mes a mes, promedio mensual y meses de cobertura; unidad: rollos.
- PDF sin pie de firmas.
- Se pueden registrar movimientos con fecha pasada.
- Anular con rastro y fácil. El N° de registro es **interno**: no se anota en el cuaderno.
- N° con prefijo por tipo: `S-0001` salidas, `I-0001` ingresos.
- Manual en un Google Doc enlazado desde el menú (`MANUAL_URL`).
- Repo público `ygallardops/control-brazaletes`, MIT, con GitHub Actions para las pruebas. Valores genéricos en
  `src/`; versión con datos reales en `local/` (en `.gitignore`).

## Cómo funciona

### Hojas

| Hoja | Contenido | Se edita a mano |
| --- | --- | --- |
| Resumen | Stock, alerta, período y reportes; el script la redibuja | Solo celdas amarillas (alerta, desde, hasta) |
| Movimientos | Un registro por ingreso o salida | Solo para corregir; protección solo de advertencia |

### Columnas de Movimientos (propuesta del constructor; puede ajustarlas)

N°, Fecha, Tipo (INGRESO/SALIDA), Cajas, Rollos, Total rollos, Destino, Recibe, Entregado por, Solicitado por,
Recogido por, Referencia del pedido, Estado (vacío o ANULADO), Motivo de anulación, Anulado por, Anulado el,
Registrado por, Registrado el.

### Menú "Brazaletes"

Registrar movimiento · Anular registro · Actualizar resumen · Exportar reporte a PDF · Manual de uso ·
Configuración inicial (solo una vez).

### Formulario (modal, pestañas Salida / Ingreso, como papel bond)

- Arriba: stock actual en rollos (= cajas + rollos, y brazaletes), resaltado si está en alerta.
- **Salida:** fecha (por defecto hoy, se permite pasada), rollos (entero > 0, ≤ stock), destino (lista fija),
  recibe (obligatorio, sugiere nombres usados), entregado por (obligatorio, sugiere al último custodio de esa
  cuenta).
- **Ingreso:** fecha, cajas y rollos (enteros ≥ 0, suma > 0), solicitado por (lista fija: Jefe de la Unidad de
  Registros Médicos, Jefe de la Oficina), recogido por (obligatorio, sugiere nombres usados), referencia del
  pedido (opcional, texto libre).
- Al registrar: confirmación con cantidad, N° asignado y stock restante; aviso si quedó en alerta.

### N° de registro

Correlativo independiente por tipo: `S-0001`, `S-0002`… e `I-0001`… Se calcula como máximo existente + 1 dentro
del lock. Los anulados conservan su número (no se reutiliza). Es interno: sirve para identificar filas al anular
o revisar; no se muestra como algo que deba anotarse en el cuaderno.

### Anular registro

- Diálogo con una lista desplegable de los registros recientes **no anulados** (cada opción muestra N°, fecha,
  tipo, rollos, destino o "Farmacia", y nombre), más un campo de motivo obligatorio. Así no hay que conocer el N°.
- La fila no se borra: Estado = ANULADO, motivo, correo de quien anula y fecha-hora.
- Los anulados no cuentan para stock, reportes ni sugerencias.
- Se rechaza si la fila ya está anulada, o si anular un ingreso dejaría el stock en negativo.
- Se ejecuta dentro del mismo lock que el registro.
- Corregir un error = anular y volver a registrar (decisión del diseñador). La edición manual de Movimientos
  sigue posible, con la advertencia de la protección.

### Stock y alerta

- Stock = suma de ingresos no anulados − suma de salidas no anuladas, en rollos.
- El mínimo se edita en una celda amarilla del Resumen (por defecto 2 rollos). Alerta si stock ≤ mínimo.
- **Correo:** se envía cuando una operación (salida o anulación de ingreso) hace que el stock pase de "por encima
  del mínimo" a "en o por debajo del mínimo"; no se repite en cada salida posterior mientras siga bajo.
  Destinatario: constante `ALERTA_CORREO` (vacía en `src/`, con el correo real en `local/`; si está vacía, no se
  envía). Sale con la cuenta de quien registra (`MailApp`). Contenido sobrio: stock actual, mínimo, fecha, y
  recordatorio de solicitar a Farmacia. Un fallo al enviar no debe impedir el registro.

### Resumen (se dibuja desde el script, como `renderResumen` de papel bond)

- Encabezado con institución y oficina; "Actualizado: fecha hora".
- Tarjetas: stock actual (rollos, con cajas + rollos y brazaletes), alerta (editable), cobertura en meses.
- Período editable (desde / hasta, por defecto el mes en curso) con ingresos y salidas del período.
- Tablas:
  - Consumo por destino en el período (rollos, %, barra de texto).
  - Consumo por persona que recibe en el período.
  - Mes a mes, últimos 12 meses: ingresos, salidas, saldo al cierre.
  - Consumo por destino en los últimos 5 meses.
- Promedio mensual de consumo: **mi propuesta**, promedio de salidas de los últimos 3 meses cerrados (sin el mes
  en curso); cobertura = stock / promedio, con un decimal; "—" si no hay consumo.
- Exportar a PDF: A4 vertical, solo el área dibujada, mediante la URL de exportación (no Archivo → Imprimir),
  guardado en una carpeta de Drive "Reportes - Brazaletes".

### Configuración inicial

Pide el stock inicial en rollos (hoy 0; si es 0 no crea fila), crea Movimientos y Resumen, protege Movimientos
como advertencia, borra hojas vacías y dibuja el Resumen.

## Lecciones del proyecto anterior que se respetan

- Fórmulas con `setFormula` en inglés y con comas; los reportes se calculan en el script, no con QUERY.
- Fechas guardadas al mediodía.
- `LockService` al registrar y al anular.
- Protección de Movimientos solo como advertencia (el formulario escribe con la cuenta de quien lo usa).
- Texto libre recortado y protegido contra interpretación como fórmula.
- Lógica pura separada y probada con `node --test`, cargando el `.gs` con `vm`; fechas de prueba creadas con el
  `Date` del contexto vm.
- PDF por URL de exportación.

## Estructura del repo

```text
src/Codigo.gs, src/Formulario.html, src/appsscript.json
test/codigo.test.js
docs/ (capturas con datos ficticios, este documento)
local/ (en .gitignore: Codigo.gs con datos reales)
README.md, LICENSE (MIT), .github/workflows/pruebas.yml, .gitignore (.clasp.json, node_modules/, local/)
```

Lógica pura a probar como mínimo: stock (con anulados), siguiente N° por tipo, validación de anulación (stock
negativo), cruce del mínimo para el correo, agrupaciones por destino y persona, mes a mes, por destino en meses,
promedio y cobertura, texto de cantidades.

## Queda a criterio del constructor

- Orden exacto de columnas, anchos, colores (seguir la paleta sobria de papel bond).
- Cuántos registros recientes listar en el diálogo de anulación (sugerido: 50).
- Redacción del manual: se entrega el texto (Markdown en `docs/manual.md`, genérico) para pegarlo en el Google
  Doc; el enlace real va en `local/`.
- Manifiesto `appsscript.json` (zona horaria America/Lima, V8) y scopes necesarios (hoja, Drive, UrlFetch, envío
  de correo).

## Proceso

Mostrar los cambios al usuario antes de cada commit. Respuestas y textos en español, sobrios, sin emojis.
