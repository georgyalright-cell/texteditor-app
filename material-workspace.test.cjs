const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ supported = true, interrupt = false, draft = null } = {}) {
  const nodes = new Map(), calls = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { checked: true, value: '', textContent: '',
      hidden: false, disabled: false, addEventListener() {},
      classList: { toggle() {} }, closest() { return node(`${id}-parent`); } });
    return nodes.get(id);
  }
  const elements = new Proxy({}, { get: (_, name) => node(name) });
  elements.sourceText.value = draft ? '' : 'Source paragraph (Smith, 2024).';
  const blocks = [{ type: 'paragraph', text: elements.sourceText.value },
    { type: 'table', rows: [['Value'], ['10']] }];
  const root = {
    MaterialDraft: { load: async () => draft, save: async () => {} },
    RevisionPreview: { clear() {}, showAutomatic() {} },
    MaterialView: { render() {} },
    DocumentImages: { validate() {} },
    FormatProfiles: { get: () => ({}) },
    DocumentLayout: { prepare: b => b, arrange: b => ({ blocks: b, warnings: [] }), present: b => b },
    ClipboardDocument: { validate() {}, read: async () => ({ blocks, warnings: [] }),
      textOf: b => b.map(x => x.text || '').join('\n') },
    DocumentBuilder: { assemble: ({ blocks }) => ({ blocks }) },
    TextPipeline: { run: text => ({ text }) },
    RuleParaphraser: { detectLanguage: () => 'en' },
    Generator: { supported: () => supported },
    MaterialProcessing: {
      base: async b => { calls.push('base'); return { blocks: b, changed: 1, warnings: [] }; },
      jobs: b => { calls.push('jobs'); return { jobs: [{ text: b[0].text, offset: 0 }] }; },
      textMap: b => ({ text: b.map(x => x.text || '').join('\n') }),
      apply: b => b,
      accept: (b, previous, proposals) => ({ blocks: b, details: [...previous, ...proposals], rejected: 0 }),
    },
    PolishUI: { cancel() {}, async run({ collect }) {
      calls.push('model');
      if (!interrupt) collect({ details: [], warnings: [] });
    } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./model-checkpoint.js'), 'utf8'), { window: root, structuredClone });
  vm.runInNewContext(fs.readFileSync(require.resolve('./material-workspace.js'), 'utf8'),
    { window: root, document: { getElementById: node }, structuredClone });
  const workspace = root.MaterialWorkspace.mount({ elements, otherBusy: () => false,
    profile: () => 'academic', metadata: () => ({}), update() {}, invalidate() {}, enterWhole() {},
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
test('whole-document optional assessment coverage is saved and does not become a failed pass',async()=>{
  const {workspace,root,node}=fixture();let saved;
  const note='Перплексия: сравнено 6 текстовых вариантов; пропущено 2 (нет полной оценки).';
  root.MaterialDraft.save=async value=>{saved=value;};
  root.PolishUI.run=async({collect})=>collect({details:[],modelUsed:true,modelLimited:false,assessmentNotes:[note],rankingSummary:note});
  await workspace.run();const result=await workspace.run({withModel:true});workspace.controls();
  assert.equal(result.completed,true);assert.equal(result.limited,false);assert.equal(result.assessmentNotes[0],note);
  assert.equal(node('polishButton').textContent,'Обработка моделью завершена');
  assert.equal(node('polishButton').disabled,true);
  assert.ok(JSON.stringify(saved).includes('assessmentNotes'));
});
test('restored completed document confirms readiness without inviting a disabled model action',async()=>{
  const source=[{type:'paragraph',text:'Source paragraph (Smith, 2024).'},{type:'table',rows:[['Value'],['10']]}];
  const modelJob={version:2,base:source,cursor:1,details:[],modelUsed:true,limited:true,
    reasons:['Перплексия: сравнено 6 текстовых вариантов; пропущено 1 (нет полной оценки).']};
  const {workspace,node,calls}=fixture({draft:{version:1,source,processed:source,modelJob}});
  await workspace.ready;workspace.controls();
  assert.match(node('materialStatus').textContent,/Обработка завершена.*повторный запуск не нужен/);
  assert.equal(node('polishButton').textContent,'Обработка моделью завершена');
  assert.equal(calls.includes('model'),false);
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

test('failed model batch does not advance and can resume without repeating base processing', async () => {
  const { workspace, calls, node, root } = fixture();
  root.PolishUI.run = async ({ collect }) => collect({ details: [], modelLimited: true, modelUsed: false, generatorWarnings: ['Failed to fetch'] });
  await workspace.run();
  const partial = await workspace.run({ withModel: true }); workspace.controls();
  assert.equal(partial.completed, false);
  assert.equal(node('polishButton').disabled, false); assert.equal(node('polishButton').textContent, 'Продолжить обработку моделью');
  root.PolishUI.run = async ({ collect }) => collect({ details: [], modelUsed: true });
  const retried = await workspace.run({ withModel: true }); workspace.controls();
  assert.equal(retried.limited, false); assert.equal(retried.completed, true);
  assert.equal(calls.filter(x => x === 'base').length, 1);
  assert.equal(node('polishButton').disabled, true);
});
test('older file import cannot release the pending state of a newer import',async()=>{
  const {workspace,root,node}=fixture();const pending=[];
  root.SourceDocx={read:()=>new Promise(resolve=>pending.push(resolve))};root.confirm=()=>true;
  const first=workspace.loadFile({name:'first.docx'}),second=workspace.loadFile({name:'second.docx'});
  pending[0]({blocks:[{type:'paragraph',text:'First',sourceDocx:{version:1}}],warnings:[]});
  assert.equal(await first,'superseded');workspace.controls();assert.equal(node('processButton').disabled,true);
  pending[1]({blocks:[{type:'paragraph',text:'Second',sourceDocx:{version:1}}],warnings:[]});
  assert.equal(await second,'imported');workspace.controls();assert.equal(node('processButton').disabled,false);
  assert.match(node('sourceText').value,/Second/);
});
test('a newer generic file or typed input can invalidate a pending DOCX before commit',async()=>{
  const {workspace,root,node}=fixture();let resolve,current=true;
  root.SourceDocx={read:()=>new Promise(r=>resolve=r)};
  const promise=workspace.loadFile({name:'old.docx'},{isCurrent:()=>current});current=false;
  resolve({blocks:[{type:'paragraph',text:'Must not replace new input',sourceDocx:{version:1}}],warnings:[]});
  assert.equal(await promise,'superseded');assert.doesNotMatch(node('sourceText').value,/Must not replace/);
});
