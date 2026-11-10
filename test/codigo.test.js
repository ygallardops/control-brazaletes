const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Codigo.gs es un script de Apps Script sin módulos: se carga en un contexto aislado.
const g = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Codigo.gs'), 'utf8'), g);
const json = x => JSON.parse(JSON.stringify(x));

// Fila de Movimientos (18 columnas) con lo mínimo para stock y numeración
const fila = (num, tipo, total, estado = '') => {
  const r = Array(18).fill('');
  Object.assign(r, { 0: num, 2: tipo, 5: total, 12: estado });
  return r;
};

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
  assert.strictEqual(g.stockTexto(1), '1 rollo (0 cajas + 1 rollo, 100 brazaletes)');
});

// Las fechas se crean con el Date del contexto aislado para que `instanceof Date` funcione dentro de Codigo.gs
const D = (...a) => new (vm.runInContext('Date', g))(...a);
const mov = (num, fecha, tipo, total, destino, recibe = '', estado = '') => {
  const r = fila(num, tipo, total, estado);
  Object.assign(r, { 1: fecha, 6: destino, 7: recibe });
  return r;
};
const datos = [
  mov('I-0001', D(2026, 7, 20, 12), 'INGRESO', 20, ''),
  mov('S-0001', D(2026, 8, 5, 12), 'SALIDA', 4, 'Módulos', 'Ana'),
  mov('S-0002', D(2026, 9, 1, 12), 'SALIDA', 2, 'Admisión de Emergencias', 'Luis'),
  mov('S-0003', D(2026, 9, 3, 12), 'SALIDA', 5, 'Módulos', 'Ana'),
  mov('S-0004', D(2026, 9, 3, 12), 'SALIDA', 9, 'Módulos', 'Ana', 'ANULADO'),
  mov('S-0005', D(2026, 8, 30, 12), 'SALIDA', 1, 'Módulos', 'Ana'), // registrado tarde, con fecha pasada
];

test('agrupar por destino en un período, sin anulados', () => {
  const DESTINO = 6; // C.DESTINO (las const del .gs no quedan expuestas en el contexto vm)
  assert.deepStrictEqual(json(g.agrupar(datos, 'SALIDA', DESTINO, D(2026, 9, 1), D(2026, 9, 4))),
    [['Módulos', 5], ['Admisión de Emergencias', 2]]);
  assert.strictEqual(g.agrupar(datos, 'SALIDA', DESTINO, D(2026, 9, 2), D(2026, 9, 2)).length, 0);
});

test('barras: porcentaje del total y largo relativo al mayor', () => {
  const r = g.conBarras([['A', 6], ['B', 2]]);
  assert.strictEqual(r[0][2], 0.75);
  assert.strictEqual(r[0][3].length, 14);
  assert.strictEqual(r[1][3].length, 5);
  assert.strictEqual(g.conBarras([]).length, 0);
});

test('mes a mes: fecha pasada cuenta en su mes, anulados fuera', () => {
  assert.deepStrictEqual(json(g.mesAMes(datos, D(2026, 9, 4), 12)),
    [['ago 2026', 20, 0, 20], ['sep 2026', 0, 5, 15], ['oct 2026', 0, 7, 8]]);
  assert.deepStrictEqual(json(g.mesAMes([], D(2026, 9, 4), 12)), []);
});

test('consumo por destino en los últimos meses', () => {
  const r = json(g.destinosPorMes(datos, D(2026, 9, 4), 3));
  assert.deepStrictEqual(r.meses, ['ago 2026', 'sep 2026', 'oct 2026']);
  assert.deepStrictEqual(r.filas, [['Módulos', 0, 5, 5], ['Admisión de Emergencias', 0, 0, 2]]);
});

test('promedio mensual de los últimos 3 meses cerrados', () => {
  assert.strictEqual(g.promedioMensual(datos, D(2026, 9, 4)), 5); // agosto (primer mes, parcial) no cuenta
  assert.strictEqual(g.promedioMensual(datos, D(2026, 8, 25)), null);
  assert.strictEqual(g.promedioMensual(datos, D(2027, 0, 10)), 7 / 3);
  assert.strictEqual(g.promedioMensual([], D(2026, 9, 4)), null);
});

test('cobertura en meses', () => {
  assert.strictEqual(g.cobertura(8, 2.5), 3.2);
  assert.strictEqual(g.cobertura(8, null), null);
  assert.strictEqual(g.cobertura(8, 0), null);
});

test('opciones de anulación: recientes primero, sin anulados', () => {
  const f = datos.slice(0, 5).map(r => r.slice());
  Object.assign(f[0], { 10: 'Pedro' });
  const r = json(g.opcionesAnulacion(f, 2));
  assert.deepStrictEqual(r, [
    { num: 'S-0003', texto: 'S-0003 · 03/10/2026 · Salida · 5 rollos · Módulos · Ana' },
    { num: 'S-0002', texto: 'S-0002 · 01/10/2026 · Salida · 2 rollos · Admisión de Emergencias · Luis' },
  ]);
  assert.strictEqual(json(g.opcionesAnulacion(f, 50))[3].texto, 'I-0001 · 20/08/2026 · Ingreso · 20 rollos · Farmacia · Pedro');
});

test('fecha del formulario: válida, inexistente, futura y año fuera de rango', () => {
  const hoy = D(2026, 10, 9, 15);
  assert.strictEqual(g.fechaMediodia_('2026-11-09', hoy).getTime(), D(2026, 10, 9, 12).getTime());
  assert.throws(() => g.fechaMediodia_('2026-02-31', hoy), /Fecha inválida/);
  assert.throws(() => g.fechaMediodia_('0026-05-01', hoy), /Fecha inválida/);
  assert.throws(() => g.fechaMediodia_('2026-11-10', hoy), /futura/);
  assert.throws(() => g.fechaMediodia_('', hoy), /Fecha inválida/);
});
