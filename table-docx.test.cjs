const { test } = require('node:test');
const assert = require('node:assert/strict');
const TableDocx = require('./table-docx.js');
const TableFormat = require('./table-format.js');

// Small namespace-aware DOM fixture, not a production XML parser.
function e(name, attrs = {}, ...children) {
  const node = { localName: name, nodeType: 1, children: children.flat().filter(v => typeof v !== 'string'),
    childNodes: children.flat().map(v => typeof v === 'string' ? { nodeType: 3, textContent: v } : v),
    getAttributeNS(_ns, key) { return attrs[key] ?? null; }, getAttribute(key) { return attrs[key.replace(/^w:/, '')] ?? null; },
    getElementsByTagNameNS(ns, key) { return this.children.flatMap(c => [...(c.localName === key ? [c] : []), ...c.getElementsByTagNameNS(ns, key)]); },
    get textContent() { return this.childNodes.map(c => c.textContent).join(''); } };
  node.children.forEach(child => { child.parentElement = node; });
  return node;
}
const p = (text, properties) => e('p', {}, e('r', {}, properties || e('rPr'), e('t', {}, text)));
const cell = (text, ...properties) => e('tc', {}, e('tcPr', {}, properties), p(text));
const grid = (...widths) => e('tblGrid', {}, widths.map(w => e('gridCol', { w: String(w) })));
const fixture = () => e('tbl', {},
  e('tblPr', {}, e('tblW', { w: '6000', type: 'dxa' }), e('tblCellMar', {}, e('left', { w: '120', type: 'dxa' }))),
  grid(2000, 4000),
  e('tr', {}, e('trPr', {}, e('tblHeader')), cell('Heading', e('gridSpan', { val: '2' }), e('shd', { fill: '112233' }))),
  e('tr', {}, cell('Merged', e('vMerge', { val: 'restart' })), cell('25 [1–3]')),
  e('tr', {}, cell('', e('vMerge')), cell('Final')));

test('DOCX table imports widths, colspan, rowspan and exact cell text without flattening', () => {
  const block = TableDocx.readTable(fixture());
  assert.deepEqual(block.columns, ['Heading', '']);
  assert.deepEqual(block.rows, [['Merged', '25 [1–3]'], ['', 'Final']]);
  assert.deepEqual(block.tableFormat.columnWidths, ['100pt', '200pt']);
  assert.equal(block.tableFormat.rows[0].cells[0].colSpan, 2);
  assert.equal(block.tableFormat.rows[1].cells[0].rowSpan, 2);
  assert.equal(block.tableFormat.rows[2].cells.length, 1);
  assert.equal(block.tableFormat.rows[0].header, true);
  assert.equal(TableFormat.normalize(block).rows[0].cells[0].style.backgroundColor, '#112233');
});

test('rich DOCX export preserves merged grid and original styling rather than a blue header', () => {
  const xml = TableDocx.xml(TableDocx.readTable(fixture()));
  assert.match(xml, /<w:gridCol w:w="2000"\/><w:gridCol w:w="4000"\/>/);
  assert.match(xml, /<w:gridSpan w:val="2"\/>/);
  assert.match(xml, /<w:vMerge w:val="restart"\/>/);
  assert.match(xml, /<w:vMerge\/>/);
  assert.match(xml, /w:fill="112233"/);
  assert.match(xml, /<w:left w:w="120" w:type="dxa"\/>/);
  assert.doesNotMatch(xml, /EAF0FA|<w:b w:val="1"/);
  assert.equal((xml.match(/Merged/g) || []).length, 1);
});

test('DOCX basedOn/defaults and direct rich run formatting survive export', () => {
  const styles = e('styles', {}, e('docDefaults', {}, e('rPrDefault', {}, e('rPr', {}, e('rFonts', { ascii: 'Arial' })))),
    e('style', { styleId: 'Base', type: 'table' }, e('tcPr', {}, e('shd', { fill: 'FFFF00' }))),
    e('style', { styleId: 'Custom', type: 'table' }, e('basedOn', { val: 'Base' })));
  const table = e('tbl', {}, e('tblPr', {}, e('tblStyle', { val: 'Custom' })), grid(3000),
    e('tr', {}, e('tc', {}, e('tcPr'), p('A & B', e('rPr', {}, e('b'), e('i'), e('sz', { val: '22' }), e('color', { val: 'AA0000' }))))));
  const block = TableDocx.readTable(table, styles), run = block.tableFormat.rows[0].cells[0].paragraphs[0].runs[0];
  assert.equal(run.style.fontFamily, 'Arial');
  assert.equal(run.style.fontSize, '11pt');
  assert.equal(run.style.fontWeight, 'bold');
  const xml = TableDocx.xml(block);
  assert.match(xml, /w:fill="ffff00"/);
  assert.match(xml, /w:ascii="Arial"/);
  assert.match(xml, /<w:i w:val="1"/);
  assert.match(xml, /A &amp; B/);
});

test('DOCX common first-row and alternate-band styles apply with tblLook flags', () => {
  const styles = e('styles', {}, e('style', { styleId: 'Bands', type: 'table' },
    e('tblStylePr', { type: 'firstRow' }, e('tcPr', {}, e('shd', { fill: '0000FF' })), e('rPr', {}, e('b'))),
    e('tblStylePr', { type: 'band1Horz' }, e('tcPr', {}, e('shd', { fill: 'EEEEEE' })))));
  const table = e('tbl', {}, e('tblPr', {}, e('tblStyle', { val: 'Bands' }), e('tblLook', { val: '0420' })), grid(3000),
    e('tr', {}, cell('Header')), e('tr', {}, cell('First')), e('tr', {}, cell('Second')));
  const rows = TableDocx.readTable(table, styles).tableFormat.rows;
  assert.equal(rows[0].cells[0].style.backgroundColor, '#0000FF');
  assert.equal(rows[0].cells[0].paragraphs[0].runs[0].style.fontWeight, 'bold');
  assert.equal(rows[1].cells[0].style.backgroundColor, '#EEEEEE');
  assert.equal(rows[2].cells[0].style.backgroundColor, undefined);
});

test('table import refuses unsupported nested content and corrupt merges without silent loss', () => {
  assert.throws(() => TableDocx.readTable(e('tbl', {}, e('tr', {}, e('tc', {}, e('tbl'))))), /вложенную/);
  assert.throws(() => TableDocx.readTable(e('tbl', {}, e('tr', {}, e('tc', {}, e('drawing'))))), /изображение/);
  assert.throws(() => TableDocx.readTable(e('tbl', {}, grid(1000), e('tr', {}, cell('Lost', e('vMerge'))))), /объединённые/);
  assert.throws(() => TableDocx.readTable(e('tbl', {}, grid(1000, 1000), e('tr', {}, cell('Only')))), /Непрямоугольная/);
});

test('rich export validates matrix, escapes payloads and preserves safe hyperlinks', () => {
  const block = TableDocx.readTable(fixture());
  block.tableFormat.rows[0].cells[0].paragraphs[0].runs[0].href = 'https://example.com/?a=1&b=2';
  let xml = TableDocx.xml(block);
  assert.match(xml, /HYPERLINK &quot;https:\/\/example.com\/\?a=1&amp;b=2&quot;/);
  block.tableFormat.rows[0].cells[0].paragraphs[0].runs[0].href = 'javascript:alert(1)';
  block.tableFormat.style.backgroundColor = 'transparent';
  xml = TableDocx.xml(block);
  assert.doesNotMatch(xml, /javascript:|ransparent/);
  block.rows[0][0] = 'Changed';
  assert.throws(() => TableDocx.xml(block), /повреждены/);
});

test('unspecified widths retain auto layout instead of zero-width or forced equal cells', () => {
  const block = TableDocx.readTable(e('tbl', {}, e('tr', {}, cell('One'), cell('Second column'))));
  const xml = TableDocx.xml(block);
  assert.match(xml, /<w:tblGrid\/>/);
  assert.doesNotMatch(xml, /<w:tcW|<w:gridCol/);
});

test('DOCX hyperlinks resolve only whitelisted relationship targets', () => {
  const table = e('tbl', {}, e('tr', {}, e('tc', {}, e('p', {}, e('hyperlink', { id: 'r1' }, e('r', {}, e('t', {}, 'Source [1]')))))));
  let run = TableDocx.readTable(table, null, new Map([['r1', 'https://example.com/source']])).tableFormat.rows[0].cells[0].paragraphs[0].runs[0];
  assert.equal(run.href, 'https://example.com/source');
  run = TableDocx.readTable(table, null, { r1: 'javascript:alert(1)' }).tableFormat.rows[0].cells[0].paragraphs[0].runs[0];
  assert.equal(run.href, undefined);
});
