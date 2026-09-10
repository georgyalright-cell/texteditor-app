const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ supported = true, interrupt = false } = {}) {
  const nodes = new Map(), calls = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { checked: true, value: '', textContent: '',
      hidden: false, disabled: false, addEventListener() {},
      classList: { toggle() {} }, closest() { return node(`${id}-parent`); } });
    return nodes.get(id);
  }
  const elements = new Proxy({}, { get: (_, name) => node(name) });
  elements.sourceText.value = 'Source paragraph (Smith, 2024).';
  const blocks = [{ type: 'paragraph', text: elements.sourceText.value },
    { type: 'table', rows: [['Value'], ['10']] }];
  const root = {
    MaterialDraft: { load: async () => null, save: async () => {} },
    RevisionPreview: { clear() {}, showAutomatic() {} },
    MaterialView: { render() {} },
    DocumentImages: { validate() {} },
    FormatProfiles: { get: () => ({}) },
    DocumentLayout: { arrange: b => ({ blocks: b, warnings: [] }), present: b => b },
    ClipboardDocument: { read: async () => ({ blocks, warnings: [] }),
      textOf: b => b.map(x => x.text || '').join('\n') },
    DocumentBuilder: { assemble: ({ blocks }) => ({ blocks }) },
    TextPipeline: { run: text => ({ text }) },
    RuleParaphraser: { detectLanguage: () => 'en' },
    Generator: { supported: () => supported },
    MaterialProcessing: {
      base: async b => { calls.push('base'); return { blocks: b, changed: 1, warnings: [] }; },
      jobs: b => { calls.push('jobs'); return { jobs: [{ text: b[0].text, offset: 0 }] }; },
      apply: b => b,
    },
    PolishUI: { cancel() {}, async run({ collect }) {
      calls.push('model');
      if (!interrupt) collect({ details: [], warnings: [] });
    } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./material-workspace.js'), 'utf8'),
    { window: root, document: { getElementById: node }, structuredClone });
  const workspace = root.MaterialWorkspace.mount({ elements, otherBusy: () => false,
    profile: () => 'academic', metadata: () => ({}), update() {}, invalidate() {},
    result: result => { calls.push('assemble'); assert.equal(result.blocks[1].rows[1][0], '10'); } });
  workspace.setMode(true);
  return { workspace, calls, node, root };
}

test('whole-document default run assembles without a model queue, even with WebGPU', async () => {
  const { workspace, calls, node } = fixture();
  await workspace.run(); workspace.controls();
  assert.deepEqual(calls, ['base', 'assemble']);
  assert.match(node('materialStatus').textContent, /Модель не запускалась/);
  assert.equal(node('polishButton').disabled, false);
  assert.equal(node('processButton').textContent, 'Обработать и собрать документ');
});

test('whole-document works without WebGPU; optional button stays disabled', async () => {
  const { workspace, calls, node } = fixture({ supported: false });
  await workspace.run(); workspace.controls();
  assert.deepEqual(calls, ['base', 'assemble']);
  assert.equal(node('polishButton').disabled, true);
});

test('explicit whole-document model action reuses the processed result and marks completion', async () => {
  const { workspace, calls, node } = fixture();
  await workspace.run();
  await workspace.run({ withModel: true });
  assert.deepEqual(calls, ['base', 'assemble', 'assemble', 'jobs', 'model', 'assemble']);
  workspace.controls();
  assert.equal(node('polishButton').disabled, true);
  assert.equal(node('polishButton').textContent, 'Обработка моделью завершена');
});

test('ordinary rebuild never resumes an interrupted model queue', async () => {
  const { workspace, calls, node, root } = fixture({ interrupt: true });
  await workspace.run(); await workspace.run({ withModel: true });
  workspace.controls();
  assert.equal(node('polishButton').textContent, 'Продолжить обработку моделью');
  const count = calls.filter(x => x === 'model').length;
  await workspace.run(); workspace.controls();
  assert.equal(calls.filter(x => x === 'model').length, count);
  assert.equal(node('processButton').textContent, 'Обработать и собрать документ');
  root.PolishUI.run = async ({ collect }) => { calls.push('resume'); collect({ details: [] }); };
  await workspace.run({ withModel: true });
  assert.equal(calls.includes('resume'), true);
});

test('limited completed model pass remains retryable and keeps processed document', async () => {
  const { workspace, calls, node, root } = fixture();
  root.PolishUI.run = async ({ collect }) => collect({ details: [], modelLimited: true, modelUsed: false, generatorWarnings: ['Failed to fetch'] });
  await workspace.run();
  const partial = await workspace.run({ withModel: true }); workspace.controls();
  assert.equal(partial.limited, true); assert.equal(partial.completed, true);
  assert.equal(node('polishButton').disabled, false); assert.equal(node('polishButton').textContent, 'Повторить обработку моделью');
  root.PolishUI.run = async ({ collect }) => collect({ details: [], modelUsed: true });
  const retried = await workspace.run({ withModel: true }); workspace.controls();
  assert.equal(retried.limited, false); assert.equal(retried.completed, true);
  assert.equal(calls.filter(x => x === 'base').length, 1);
  assert.equal(node('polishButton').disabled, true);
});
