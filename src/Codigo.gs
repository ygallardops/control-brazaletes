/** Control de Brazaletes de Identificación — Google Sheets + Apps Script */

const ROLLOS_POR_CAJA = 5;
const BRAZ_POR_ROLLO = 100;
const DESTINOS = ['Admisión de Hospitalización', 'Admisión de Emergencias', 'Módulos'];
const SOLICITANTES = ['Jefe de la Unidad de Registros Médicos', 'Jefe de la Oficina'];
// Configura estos valores antes de la "Configuración inicial"
const INSTITUCION = 'Nombre de la institución';
const OFICINA = 'Nombre de la oficina';
const MANUAL_URL = '';    // enlace al manual de uso (por ejemplo, un Google Doc compartido)
const ALERTA_CORREO = ''; // a quién avisar cuando el stock llega al mínimo; vacío = no se envía correo

const ENCABEZADOS = ['N°', 'Fecha', 'Tipo', 'Cajas', 'Rollos', 'Total rollos', 'Destino', 'Recibe',
  'Entregado por', 'Solicitado por', 'Recogido por', 'Referencia del pedido', 'Estado', 'Motivo de anulación',
  'Anulado por', 'Anulado el', 'Registrado por', 'Registrado el'];
// Índices (base 0) de columnas en la hoja Movimientos
const C = { NUM: 0, FECHA: 1, TIPO: 2, CAJAS: 3, ROLLOS: 4, TOTAL: 5, DESTINO: 6, RECIBE: 7, ENTREGA: 8,
  SOLICITA: 9, RECOGE: 10, REF: 11, ESTADO: 12, MOTIVO: 13, ANULA_POR: 14, ANULA_EL: 15, REG_POR: 16, REG_EL: 17 };

// ---------- Lógica pura (probada en test/codigo.test.js) ----------

function activas(filas) {
  return filas.filter(r => r[C.ESTADO] !== 'ANULADO');
}

function calcularStock(filas) {
  return activas(filas).reduce((s, r) =>
    s + (r[C.TIPO] === 'INGRESO' ? 1 : r[C.TIPO] === 'SALIDA' ? -1 : 0) * (Number(r[C.TOTAL]) || 0), 0);
}

// S-0001 para salidas, I-0001 para ingresos; los anulados conservan su número
function siguienteNumero(filas, tipo) {
  const pre = tipo === 'SALIDA' ? 'S-' : 'I-';
  const n = Math.max(0, ...filas.map(r => String(r[C.NUM])).filter(s => s.startsWith(pre))
    .map(s => Number(s.slice(2)) || 0));
  return pre + String(n + 1).padStart(4, '0');
}

// Índice en `filas` del registro a anular; lanza un error si no se puede
function validarAnulacion(filas, num) {
  const i = filas.findIndex(r => String(r[C.NUM]) === num);
  if (i < 0) throw new Error(`El registro ${num} no existe.`);
  if (filas[i][C.ESTADO] === 'ANULADO') throw new Error(`El registro ${num} ya está anulado.`);
  if (filas[i][C.TIPO] === 'INGRESO' && calcularStock(filas) - Number(filas[i][C.TOTAL]) < 0)
    throw new Error(`No se puede anular ${num}: dejaría el stock negativo (esos rollos ya se entregaron).`);
  return i;
}

function cruzaMinimo(antes, despues, min) {
  return antes > min && despues <= min;
}

const plural_ = (x, s, p) => `${x} ${x === 1 ? s : p}`;

function cantidadTexto(cajas, rollos) {
  return [cajas && plural_(cajas, 'caja', 'cajas'), rollos && plural_(rollos, 'rollo', 'rollos')]
    .filter(Boolean).join(' + ');
}

function stockTexto(rollos) {
  const cajas = Math.floor(rollos / ROLLOS_POR_CAJA), sueltos = rollos % ROLLOS_POR_CAJA;
  return `${plural_(rollos, 'rollo', 'rollos')} (${plural_(cajas, 'caja', 'cajas')} + ` +
    `${plural_(sueltos, 'rollo', 'rollos')}, ${rollos * BRAZ_POR_ROLLO} brazaletes)`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesTexto_ = d => `${MESES[d.getMonth()]} ${d.getFullYear()}`;

// Suma de rollos de un tipo con fecha en [desde, fin)
function sumar_(filas, tipo, desde, fin) {
  return activas(filas).filter(r => r[C.TIPO] === tipo && r[C.FECHA] instanceof Date && r[C.FECHA] >= desde &&
    r[C.FECHA] < fin).reduce((s, r) => s + (Number(r[C.TOTAL]) || 0), 0);
}

// Movimientos activos de un tipo entre dos fechas (inclusive, por día), agrupados por columna, de mayor a menor
function agrupar(filas, tipo, col, desde, hasta) {
  const fin = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate() + 1);
  const totales = {};
  activas(filas).filter(r => r[C.TIPO] === tipo && r[C.FECHA] instanceof Date && r[C.FECHA] >= desde && r[C.FECHA] < fin)
    .forEach(r => { const k = String(r[col]).trim() || '(sin dato)'; totales[k] = (totales[k] || 0) + Number(r[C.TOTAL]); });
  return Object.entries(totales).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// [nombre, total] → [nombre, total, % del total, barra de texto]
function conBarras(lista) {
  const total = lista.reduce((s, [, n]) => s + n, 0), max = lista.length ? lista[0][1] : 0;
  return lista.map(([k, n]) => [k, n, total ? n / total : 0, '█'.repeat(Math.max(1, Math.round(n / max * 14)))]);
}

// Primer día del mes del movimiento activo más antiguo, o null
function primerMes_(filas) {
  const fechas = activas(filas).filter(r => r[C.FECHA] instanceof Date).map(r => r[C.FECHA].getTime());
  if (!fechas.length) return null;
  const p = new Date(Math.min(...fechas));
  return new Date(p.getFullYear(), p.getMonth(), 1);
}

// Últimos n meses hasta `hoy` (desde el primer mes con movimientos): [mes, ingresos, salidas, saldo al cierre]
function mesAMes(filas, hoy, n) {
  const primero = primerMes_(filas);
  if (!primero) return [];
  const salida = [];
  for (let i = n - 1; i >= 0; i--) {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1), fin = new Date(ini.getFullYear(), ini.getMonth() + 1, 1);
    if (ini < primero) continue;
    salida.push([mesTexto_(ini), sumar_(filas, 'INGRESO', ini, fin), sumar_(filas, 'SALIDA', ini, fin),
      sumar_(filas, 'INGRESO', new Date(0), fin) - sumar_(filas, 'SALIDA', new Date(0), fin)]);
  }
  return salida;
}

// Consumo por destino en los últimos n meses: { meses: [etiquetas], filas: [[destino, ...n valores]] } por total desc
function destinosPorMes(filas, hoy, n) {
  const meses = [...Array(n)].map((_, i) => new Date(hoy.getFullYear(), hoy.getMonth() - (n - 1 - i), 1));
  const porDestino = {};
  meses.forEach((ini, i) => agrupar(filas, 'SALIDA', C.DESTINO, ini, new Date(ini.getFullYear(), ini.getMonth() + 1, 0))
    .forEach(([d, total]) => { (porDestino[d] = porDestino[d] || Array(n).fill(0))[i] = total; }));
  const suma = v => v.reduce((a, b) => a + b, 0);
  return {
    meses: meses.map(mesTexto_),
    filas: Object.entries(porDestino).sort((a, b) => suma(b[1]) - suma(a[1])).map(([d, v]) => [d, ...v]),
  };
}

// Salidas promedio por mes en los últimos 3 meses cerrados (sin el mes de `hoy`). El mes del primer
// movimiento es parcial y no cuenta; null si aún no hay ningún mes completo cerrado
function promedioMensual(filas, hoy) {
  const primero = primerMes_(filas);
  if (!primero) return null;
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const completo = new Date(primero.getFullYear(), primero.getMonth() + 1, 1);
  let ini = new Date(fin.getFullYear(), fin.getMonth() - 3, 1);
  if (ini < completo) ini = completo;
  const meses = (fin.getFullYear() - ini.getFullYear()) * 12 + fin.getMonth() - ini.getMonth();
  return meses > 0 ? sumar_(filas, 'SALIDA', ini, fin) / meses : null;
}

function cobertura(stock, promedio) {
  return promedio ? Math.round(stock / promedio * 10) / 10 : null;
}

const dosDig_ = n => String(n).padStart(2, '0');

// Últimos n registros activos, el más reciente primero, con un texto para reconocerlos al anular
function opcionesAnulacion(filas, n) {
  return activas(filas).slice(-n).reverse().map(r => {
    const f = r[C.FECHA] instanceof Date
      ? `${dosDig_(r[C.FECHA].getDate())}/${dosDig_(r[C.FECHA].getMonth() + 1)}/${r[C.FECHA].getFullYear()}` : '';
    const salida = r[C.TIPO] === 'SALIDA', total = Number(r[C.TOTAL]) || 0;
    const partes = [r[C.NUM], f, salida ? 'Salida' : 'Ingreso', plural_(total, 'rollo', 'rollos'),
      salida ? r[C.DESTINO] : 'Farmacia', salida ? r[C.RECIBE] : r[C.RECOGE]];
    return { num: String(r[C.NUM]), texto: partes.filter(x => x !== '').join(' · ') };
  });
}

// ---------- Menú y formulario ----------

// Celdas editables (amarillas) del Resumen: se conservan cada vez que se redibuja
const R = { MIN: 'E6', DESDE: 'B10', HASTA: 'D10' };
const MINIMO_POR_DEFECTO = 2;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Brazaletes')
    .addItem('Registrar movimiento', 'abrirFormulario')
    .addItem('Anular registro', 'abrirAnulacion')
    .addItem('Actualizar resumen', 'renderResumen')
    .addItem('Exportar reporte a PDF', 'exportarReportePdf')
    .addItem('Manual de uso', 'abrirManual')
    .addSeparator()
    .addItem('Configuración inicial (solo una vez)', 'configurar')
    .addToUi();
  const mov = SpreadsheetApp.getActive().getSheetByName('Movimientos');
  if (mov && !mov.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) protegerMovimientos_(mov);
  renderResumen(); // "Actualizado" y el período por defecto quedan al día
}

// Redibuja el Resumen al editar sus celdas amarillas o la hoja Movimientos.
// El mínimo se guarda en las propiedades del documento: el Resumen se borra al redibujarse y,
// si otra persona registra en ese instante, la celda podría leerse vacía.
function onEdit(e) {
  const nombre = e.range.getSheet().getName(), a1 = e.range.getCell(1, 1).getA1Notation();
  if (nombre === 'Resumen' && a1 === R.MIN) {
    const v = e.range.getCell(1, 1).getValue();
    if (typeof v === 'number' && v >= 0) PropertiesService.getDocumentProperties().setProperty('minimo', String(v));
  }
  if (nombre === 'Movimientos' || (nombre === 'Resumen' && Object.values(R).includes(a1))) renderResumen();
}

function abrirFormulario() {
  const html = HtmlService.createHtmlOutputFromFile('Formulario').setWidth(420).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Movimiento de brazaletes');
}

function datosFormulario() {
  const filas = activas(filasMovimientos_());
  const unicos = (...cols) => [...new Set(filas.flatMap(r => cols.map(i => String(r[i]).trim())))]
    .filter(s => s && s !== 'Stock inicial').sort();
  return {
    rollosCaja: ROLLOS_POR_CAJA,
    brazRollo: BRAZ_POR_ROLLO,
    stock: calcularStock(filas),
    minimo: minimo_(),
    destinos: DESTINOS,
    solicitantes: SOLICITANTES,
    personas: unicos(C.RECIBE, C.ENTREGA, C.RECOGE),
    custodio: PropertiesService.getUserProperties().getProperty('custodio') || '',
  };
}

function registrar(f) {
  const tipo = ['INGRESO', 'SALIDA'].includes(f.tipo) ? f.tipo : null;
  if (!tipo) throw new Error('Tipo de movimiento inválido.');
  const salida = tipo === 'SALIDA';
  const cajas = salida ? 0 : Number(f.cajas) || 0, rollos = Number(f.rollos) || 0;
  if (![cajas, rollos].every(n => Number.isInteger(n) && n >= 0) || cajas + rollos === 0)
    throw new Error(salida ? 'Indica un número entero de rollos, mayor a cero.'
      : 'Indica una cantidad válida (cajas y/o rollos enteros, mayor a cero).');
  const fecha = fechaMediodia_(f.fecha);

  const t = k => texto_(f[k]);
  if (salida && !DESTINOS.includes(f.destino)) throw new Error('Elige un destino de la lista.');
  if (!salida && !SOLICITANTES.includes(f.solicita)) throw new Error('Elige quién solicitó el pedido.');
  const requeridos = salida ? { recibe: 'Persona que recibe', entrega: 'Entregado por' } : { recoge: 'Recogido por' };
  for (const k in requeridos) if (!t(k)) throw new Error(`Falta completar: ${requeridos[k]}.`);

  const lock = LockService.getDocumentLock();
  lock.waitLock(15000); // varios usuarios: evita números duplicados y salidas sin stock
  try {
    const sh = hoja_('Movimientos');
    const filas = filasMovimientos_(sh);
    const total = cajas * ROLLOS_POR_CAJA + rollos;
    const stock = calcularStock(filas);
    if (salida && total > stock) throw new Error(`Stock insuficiente: solo hay ${plural_(stock, 'rollo', 'rollos')}.`);
    const num = siguienteNumero(filas, tipo), nuevo = stock + (salida ? -total : total);

    const fila = Array(ENCABEZADOS.length).fill('');
    Object.assign(fila, {
      [C.NUM]: num, [C.FECHA]: fecha, [C.TIPO]: tipo, [C.CAJAS]: cajas, [C.ROLLOS]: rollos, [C.TOTAL]: total,
      [C.REG_POR]: Session.getActiveUser().getEmail(), [C.REG_EL]: new Date(),
    }, salida
      ? { [C.DESTINO]: f.destino, [C.RECIBE]: t('recibe'), [C.ENTREGA]: t('entrega') }
      : { [C.SOLICITA]: f.solicita, [C.RECOGE]: t('recoge'), [C.REF]: t('ref') });
    sh.appendRow(fila);
    // La fila ya está guardada: lo que sigue no debe mostrarse como error (llevaría a registrarla dos veces)
    sinFallar_(() => PropertiesService.getUserProperties().setProperty('custodio', salida ? t('entrega') : t('recoge')));
    avisarSiCruza_(stock, nuevo);
    sinFallar_(renderResumen);
    return { tipo, num, cantidad: cantidadTexto(cajas, rollos), stock: nuevo };
  } finally {
    lock.releaseLock();
  }
}

// Envía un correo solo cuando el stock pasa de estar sobre el mínimo a estar en o bajo el mínimo.
// Si el envío falla, el registro ya está hecho: se anota el error y se sigue.
function avisarSiCruza_(antes, despues) {
  const min = minimo_();
  if (!ALERTA_CORREO || !cruzaMinimo(antes, despues, min)) return;
  try {
    const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    MailApp.sendEmail(ALERTA_CORREO, `Stock bajo de brazaletes: ${plural_(despues, 'rollo', 'rollos')}`, [
      'El stock de brazaletes de identificación llegó al mínimo establecido.',
      '',
      `Stock actual: ${stockTexto(despues)}.`,
      `Mínimo: ${plural_(min, 'rollo', 'rollos')}.`,
      `Fecha: ${Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm')}.`,
      '',
      'Se recomienda solicitar brazaletes a Farmacia.',
      '',
      `${INSTITUCION} · ${OFICINA}`,
    ].join('\n'));
  } catch (e) {
    console.error('No se pudo enviar la alerta de stock: ' + e.message);
  }
}

// ---------- Anulación ----------

function abrirAnulacion() {
  const opciones = opcionesAnulacion(filasMovimientos_(), 50);
  if (!opciones.length) return SpreadsheetApp.getUi().alert('No hay registros para anular.');
  const datos = JSON.stringify(opciones).replace(/</g, '\\u003c'); // los nombres no pueden cerrar el <script>
  const html = HtmlService.createHtmlOutput(`
<div style="font:14px Arial,sans-serif;padding:6px">
  <label><b>Registro</b><br><select id="n" style="width:100%;padding:6px"></select></label><br><br>
  <label><b>Motivo de la anulación</b><br>
    <input id="m" style="width:100%;padding:6px;box-sizing:border-box"></label><br><br>
  <button id="b" onclick="anular()" style="padding:9px 14px;font-weight:bold">Anular</button>
  <p id="r"></p>
</div>
<script>
  var sel = document.getElementById('n');
  ${datos}.forEach(function (o) {
    var e = document.createElement('option'); e.value = o.num; e.textContent = o.texto; sel.appendChild(e);
  });
  function anular() {
    var b = document.getElementById('b'), r = document.getElementById('r'), m = document.getElementById('m').value;
    if (!m.trim()) return r.textContent = 'Escribe el motivo.';
    b.disabled = true; r.textContent = 'Anulando...';
    google.script.run
      .withSuccessHandler(function (x) { r.textContent = 'Registro ' + x.num + ' anulado. Stock: ' + x.stock + '.'; })
      .withFailureHandler(function (e) { b.disabled = false; r.textContent = e.message; })
      .anular(sel.value, m);
  }
</script>`).setWidth(480).setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, 'Anular registro');
}

function anular(num, motivo) {
  motivo = texto_(motivo);
  if (!motivo) throw new Error('Escribe el motivo de la anulación.');
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const sh = hoja_('Movimientos');
    const filas = filasMovimientos_(sh);
    const i = validarAnulacion(filas, String(num));
    const antes = calcularStock(filas);
    sh.getRange(i + 2, C.ESTADO + 1, 1, 4)
      .setValues([['ANULADO', motivo, Session.getActiveUser().getEmail(), new Date()]]);
    filas[i][C.ESTADO] = 'ANULADO';
    const despues = calcularStock(filas);
    avisarSiCruza_(antes, despues);
    sinFallar_(renderResumen);
    return { num: String(num), stock: stockTexto(despues) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Manual y reporte PDF ----------

// Apps Script no abre pestañas directamente: se intenta con window.open y queda el enlace por si el navegador lo bloquea
function abrirManual() {
  if (!MANUAL_URL) throw new Error('Falta configurar MANUAL_URL al inicio de Codigo.gs.');
  dialogoEnlace_('Manual de uso', 'Abrir el manual de uso', MANUAL_URL);
}

function dialogoEnlace_(titulo, texto, url) {
  const html = HtmlService.createHtmlOutput(`
<p style="font:14px Arial,sans-serif"><a href="${url}" target="_blank" onclick="setTimeout(google.script.host.close, 300)">${texto}</a></p>
<script>if (window.open('${url}', '_blank')) google.script.host.close();</script>`).setWidth(320).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(html, titulo);
}

// Exporta el Resumen (A4 vertical, solo el área dibujada) a PDF y lo guarda en Drive
function exportarReportePdf() {
  const ss = SpreadsheetApp.getActive(), sh = hoja_('Resumen');
  renderResumen();
  const [desde, hasta] = [R.DESDE, R.HASTA].map(a => sh.getRange(a).getValue());
  if (!(desde instanceof Date) || !(hasta instanceof Date))
    throw new Error('Revisa las fechas "desde" y "hasta" en la hoja Resumen.');
  SpreadsheetApp.flush();
  const url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?format=pdf&gid=${sh.getSheetId()}` +
    `&r1=0&c1=0&r2=${sh.getLastRow()}&c2=6&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false` +
    '&sheetnames=false&printnotes=false&pagenum=CENTER&horizontal_alignment=CENTER' +
    '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';
  const resp = UrlFetchApp.fetch(url,
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error(`No se pudo generar el PDF (código ${resp.getResponseCode()}).`);
  const f = d => Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'dd-MM-yyyy');
  const archivo = carpeta_('carpetaReportes', 'Reportes - Brazaletes')
    .createFile(resp.getBlob().setName(`Reporte brazaletes ${f(desde)} al ${f(hasta)}.pdf`));
  dialogoEnlace_('Reporte PDF', 'Abrir el reporte PDF', archivo.getUrl());
}

function carpeta_(clave, nombre) {
  const props = PropertiesService.getDocumentProperties();
  const id = props.getProperty(clave);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* carpeta eliminada: se crea otra */ }
  }
  const f = DriveApp.createFolder(nombre);
  props.setProperty(clave, f.getId());
  return f;
}

// ---------- Utilidades ----------

function hoja_(nombre) {
  const sh = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!sh) throw new Error('Primero ejecuta "Brazaletes > Configuración inicial".');
  return sh;
}

// Solo advertencia: el formulario escribe con la cuenta de quien lo usa, un bloqueo real lo rompería
function protegerMovimientos_(sh) {
  sh.protect().setWarningOnly(true)
    .setDescription('Registra y anula con el menú Brazaletes. Edita a mano solo para corregir errores.');
}

function filasMovimientos_(sh = hoja_('Movimientos')) {
  return sh.getDataRange().getValues().slice(1);
}

// Lo guarda onEdit al cambiar la celda amarilla del Resumen
function minimo_() {
  const p = PropertiesService.getDocumentProperties().getProperty('minimo');
  return p !== null && Number(p) >= 0 ? Number(p) : MINIMO_POR_DEFECTO;
}

function sinFallar_(fn) {
  try { fn(); } catch (e) { console.error(e.message); }
}

// Texto libre: se recorta y se evita que se interprete como fórmula
function texto_(v) {
  return String(v || '').trim().replace(/^[=+\-@]/, "'$&");
}

// 'yyyy-mm-dd' → fecha al mediodía (evita saltos de día por zona horaria). Rechaza fechas inexistentes y futuras.
function fechaMediodia_(s, hoy = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  const d = m && new Date(m[1], m[2] - 1, m[3], 12);
  if (!d || m[1] < 2000 || d.getMonth() !== m[2] - 1 || d.getDate() !== Number(m[3])) throw new Error('Fecha inválida.');
  if (d > new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59)) throw new Error('La fecha no puede ser futura.');
  return d;
}

// ---------- Resumen (se redibuja completo desde los datos) ----------

const COLOR = {
  primario: '#0b5394', suave: '#e8f0fe', tarjeta: '#f4f7fb', borde: '#d0d7e2', gris: '#5f6368',
  alerta: '#fde8e8', alertaTexto: '#a50e0e', editable: '#fff8e1', zebra: '#f8fafc',
};

function renderResumen() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('Resumen');
  if (!sh || !ss.getSheetByName('Movimientos')) return;
  const filas = filasMovimientos_();

  // Conserva lo que el usuario escribió en las celdas amarillas (fórmula o valor), si es válido
  const fecha = (a, porDefecto) => {
    const r = sh.getRange(a), v = r.getValue();
    return v instanceof Date && v.getFullYear() >= 2000 ? (r.getFormula() || v) : porDefecto;
  };
  const min = minimo_();
  const desde = fecha(R.DESDE, '=EOMONTH(TODAY(),-1)+1'), hasta = fecha(R.HASTA, '=TODAY()');

  sh.clear();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearNote().breakApart();
  sh.setConditionalFormatRules([]);
  sh.setHiddenGridlines(true);
  [200, 85, 85, 85, 85, 85].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, 1, sh.getMaxRows(), 6).setFontFamily('Arial').setFontSize(9).setVerticalAlignment('middle');
  sh.setRowHeights(1, sh.getMaxRows(), 21);

  // Encabezado
  sh.getRange('A1:F1').merge().setValue('Control de Brazaletes de Identificación').setBackground(COLOR.primario)
    .setFontColor('#ffffff').setFontSize(16).setFontWeight('bold');
  sh.setRowHeight(1, 38);
  sh.getRange('A2:F2').merge().setValue(`${INSTITUCION} · ${OFICINA}`).setFontColor(COLOR.gris).setWrap(true);
  sh.setRowHeight(2, 30);
  const tz = ss.getSpreadsheetTimeZone();
  sh.getRange('A3:F3').merge().setValue('Actualizado: ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontColor(COLOR.gris).setFontSize(8).setFontStyle('italic').setHorizontalAlignment('right');
  sh.setRowHeight(4, 8);

  // Tarjetas
  const hoy = new Date();
  const stock = calcularStock(filas), bajo = stock <= min;
  const prom = promedioMensual(filas, hoy), cob = cobertura(stock, prom);
  tarjeta_(sh, 1, 'STOCK ACTUAL', stock,
    `${plural_(Math.floor(stock / ROLLOS_POR_CAJA), 'caja', 'cajas')} + ` +
    `${plural_(stock % ROLLOS_POR_CAJA, 'rollo', 'rollos')} · ${stock * BRAZ_POR_ROLLO} brazaletes` +
    (bajo ? ' · STOCK BAJO' : ''),
    bajo ? COLOR.alerta : COLOR.tarjeta, bajo ? COLOR.alertaTexto : COLOR.primario);
  tarjeta_(sh, 3, 'COBERTURA', cob === null ? '—' : cob,
    prom === null ? 'aún no hay meses cerrados' : `promedio ${Math.round(prom * 10) / 10} rollos/mes`,
    COLOR.tarjeta, COLOR.primario);
  tarjeta_(sh, 5, 'ALERTA DE STOCK', min, 'avisa si quedan ≤ (editable)', COLOR.editable, '#202124');
  sh.getRange('A6').setNumberFormat('0 "rollos"');
  sh.getRange('C6').setNumberFormat('0.0 "meses"');
  sh.getRange(R.MIN).setNumberFormat('0 "rollos"');
  sh.setRowHeight(6, 36);
  sh.setRowHeight(8, 10);

  // Período
  seccion_(sh, 9, 'Período del reporte');
  sh.getRange('A10:F11').setValues([
    ['Desde', '', 'Hasta', '', 'Ingresos', ''],
    ['Cambia las fechas amarillas para ver otro período.', '', '', '', 'Salidas', ''],
  ]);
  sh.getRange(R.DESDE).setValue(desde);
  sh.getRange(R.HASTA).setValue(hasta);
  sh.getRange('A10').setHorizontalAlignment('right').setFontColor(COLOR.gris);
  sh.getRange('C10').setHorizontalAlignment('right').setFontColor(COLOR.gris);
  sh.getRange('E10:E11').setHorizontalAlignment('right').setFontColor(COLOR.gris);
  sh.getRange('A11:D11').merge().setFontSize(8).setFontStyle('italic').setFontColor(COLOR.gris);
  [R.DESDE, R.HASTA].forEach(a => sh.getRange(a).setNumberFormat('dd/mm/yyyy').setBackground(COLOR.editable)
    .setHorizontalAlignment('center').setBorder(true, true, true, true, false, false, COLOR.borde, null));
  SpreadsheetApp.flush();
  const d = sh.getRange(R.DESDE).getValue(), h = sh.getRange(R.HASTA).getValue();
  const okPeriodo = d instanceof Date && h instanceof Date;
  const destino = okPeriodo ? agrupar(filas, 'SALIDA', C.DESTINO, d, h) : [];
  const persona = okPeriodo ? agrupar(filas, 'SALIDA', C.RECIBE, d, h) : [];
  const ingresos = okPeriodo ? sumar_(filas, 'INGRESO', d, new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1)) : 0;
  const suma = l => l.reduce((s, [, n]) => s + n, 0);
  sh.getRange('F10:F11').setValues([[ingresos], [suma(destino)]]).setNumberFormat('0 "rollos"')
    .setFontWeight('bold');

  // Tablas, una debajo de otra
  const vacio = okPeriodo ? 'Sin entregas en el período.' : 'Revisa las fechas del período.';
  const dm = destinosPorMes(filas, hoy, 5);
  let fila = 13;
  fila = tabla_(sh, fila, 'Consumo por destino', ['Destino', 'Rollos', '%', ''], conBarras(destino), true, vacio);
  fila = tabla_(sh, fila, 'Consumo por persona que recibe', ['Persona', 'Rollos', '%', ''], conBarras(persona), true,
    vacio);
  fila = tabla_(sh, fila, 'Mes a mes (últimos 12 meses, rollos)', ['Mes', 'Ingresos', 'Salidas', 'Saldo al cierre'],
    mesAMes(filas, hoy, 12), false, 'Sin movimientos.');
  tabla_(sh, fila, 'Consumo por destino (últimos 5 meses, rollos)', ['Destino', ...dm.meses], dm.filas, false,
    'Sin entregas en los últimos 5 meses.');
}

function tarjeta_(sh, col, etiqueta, valor, nota, fondo, colorValor) {
  sh.getRange(5, col, 3, 2).setBackground(fondo).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR.borde, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(5, col, 1, 2).merge().setValue(etiqueta).setFontSize(8).setFontWeight('bold').setFontColor(COLOR.gris);
  sh.getRange(6, col, 1, 2).merge().setValue(valor).setFontSize(20).setFontWeight('bold').setFontColor(colorValor);
  sh.getRange(7, col, 1, 2).merge().setValue(nota).setFontSize(8).setFontColor(COLOR.gris).setWrap(true);
}

function seccion_(sh, fila, titulo) {
  sh.getRange(fila, 1, 1, 6).merge().setValue(titulo).setFontSize(11).setFontWeight('bold').setFontColor(COLOR.primario)
    .setBorder(null, null, true, null, null, null, COLOR.primario, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

// Dibuja una tabla de hasta 6 columnas desde `fila`; con `barras`, la 4.ª columna (D:F) es una barra de texto.
// Devuelve la siguiente fila libre, dejando una en blanco.
function tabla_(sh, fila, titulo, encabezados, datos, barras, vacio) {
  seccion_(sh, fila, titulo);
  const enc = sh.getRange(fila + 1, 1, 1, 6).setBackground(COLOR.suave).setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, encabezados.length).setNumberFormat('@').setValues([encabezados]);
  sh.getRange(fila + 1, 2, 1, 5).setHorizontalAlignment('right');
  if (barras) enc.offset(0, 3, 1, 3).merge();
  if (!datos.length) {
    sh.getRange(fila + 2, 1, 1, 6).merge().setValue(vacio).setFontColor(COLOR.gris).setFontStyle('italic');
    return fila + 4;
  }
  const n = datos.length, cols = datos[0].length;
  sh.getRange(fila + 2, 1, n, 1).setNumberFormat('@'); // nombres y meses como texto ("oct 2026" no es una fecha)
  sh.getRange(fila + 2, 1, n, cols).setValues(datos);
  sh.getRange(fila + 2, 1, n, 6).setBackgrounds(datos.map((_, i) => Array(6).fill(i % 2 ? COLOR.zebra : '#ffffff')))
    .setBorder(null, null, true, null, null, null, COLOR.borde, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(fila + 2, 2, n, 5).setHorizontalAlignment('right');
  if (barras) {
    sh.getRange(fila + 2, 3, n, 1).setNumberFormat('0%');
    for (let i = 0; i < n; i++) sh.getRange(fila + 2 + i, 4, 1, 3).merge();
    sh.getRange(fila + 2, 4, n, 1).setHorizontalAlignment('left').setFontColor(COLOR.primario);
  }
  return fila + 3 + n;
}

// ---------- Configuración inicial ----------

function configurar() {
  const ss = SpreadsheetApp.getActive(), ui = SpreadsheetApp.getUi();
  if (ss.getSheetByName('Movimientos')) return ui.alert('La hoja ya está configurada.');
  const r = ui.prompt('Stock inicial',
    `¿Cuántos ROLLOS hay hoy en stock? (1 caja = ${ROLLOS_POR_CAJA} rollos; escribe 0 si no hay)`, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const inicial = Number(r.getResponseText().trim() || 0);
  if (!Number.isInteger(inicial) || inicial < 0) return ui.alert('El stock inicial debe ser un número entero de rollos.');

  const mov = ss.insertSheet('Movimientos');
  mov.appendRow(ENCABEZADOS);
  mov.getRange(1, 1, 1, ENCABEZADOS.length).setFontWeight('bold').setBackground(COLOR.primario).setFontColor('#ffffff');
  mov.setFrozenRows(1);
  protegerMovimientos_(mov);
  mov.getRange('B:B').setNumberFormat('dd/mm/yyyy');
  ['P:P', 'R:R'].forEach(a => mov.getRange(a).setNumberFormat('dd/mm/yyyy hh:mm'));
  // Los anulados se ven en gris y tachados
  mov.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$M2="ANULADO"').setFontColor('#9aa0a6').setStrikethrough(true)
    .setRanges([mov.getRange(2, 1, mov.getMaxRows() - 1, ENCABEZADOS.length)]).build()]);
  if (inicial > 0) {
    const hoy = new Date(), fila = Array(ENCABEZADOS.length).fill('');
    Object.assign(fila, {
      [C.NUM]: 'I-0001', [C.FECHA]: new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12), [C.TIPO]: 'INGRESO',
      [C.CAJAS]: 0, [C.ROLLOS]: inicial, [C.TOTAL]: inicial, [C.RECOGE]: 'Stock inicial',
      [C.REG_POR]: Session.getActiveUser().getEmail(), [C.REG_EL]: hoy,
    });
    mov.appendRow(fila);
  }

  ss.insertSheet('Resumen', 0);
  ss.getSheets().filter(s => !['Resumen', 'Movimientos'].includes(s.getName()) && s.getLastRow() === 0)
    .forEach(s => ss.deleteSheet(s));
  renderResumen();
  ss.getSheetByName('Resumen').activate();
  ui.alert('Listo. Usa el menú "Brazaletes > Registrar movimiento".');
}
