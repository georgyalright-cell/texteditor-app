const test = require('node:test');
const assert = require('node:assert/strict');
global.ReferenceGuard = require('./reference-guard.js');
global.AnchorGuard = require('./anchor-guard.js');
global.EditPasses = require('./edit-passes.js');
global.MaterialProcessing = require('./material-processing.js');
const automatic = require('./automatic-revision.js');

test('automatic replacement rejects changed references and overlap', () => {
  const source = 'The evidence is preliminary [1-3].';
  assert.throws(() => automatic.apply(source, [{ start: 0, end: source.length, before: source, after: source.replace('1-3', '1–3') }]));
  const detail = { start: 0, end: source.length, before: source, after: 'The preliminary evidence is reported [1-3].' };
  assert.throws(() => automatic.apply(source, [detail, detail]));
  assert.equal(automatic.apply(source, [detail]).text, detail.after);
});
test('full fragment uses every batch with automatic application and stable original offsets', async () => {
  const sentences = Array.from({ length: 12 }, (_, i) => `The team reports result ${i}.`);
  const source = sentences.join(' '); let calls = 0, result;
  global.PolishUI = { run: async (options) => {
    calls++;
    const spans = EditPasses.sentenceSpans(options.text, 0);
    assert.ok(spans.length <= 5);
    options.collect({ details: spans.map((s) => ({ start: s.start, end: s.end, before: s.text.trim(), after: s.text.trim().replace('reports', 'presents the') })) });
  } };
  const final = await automatic.run({ text: source, language: 'en', isCurrent: () => true, report() {}, apply: (value) => { result = value; } });
  assert.equal(calls, 3); assert.equal(result.replaced, 12);
  assert.equal(final.text, source.replaceAll('reports', 'presents the'));
});
test('stale result cannot apply and incomplete batch keeps preceding applied work', async () => {
  let current = true, applied = 0;
  global.PolishUI = { run: async (options) => { current = false; options.collect({ details: [] }); } };
  await automatic.run({ text: 'The company reports growth.', language: 'en', isCurrent: () => current, report() {}, apply() { applied++; } });
  assert.equal(applied, 0);
});
test('bibliographic paragraphs are excluded from base editing and model jobs', async () => {
  const blocks = [{ type: 'paragraph', text: 'The team reports growth.' }, { type: 'heading', title: 'References' },
    { type: 'paragraph', text: '7. Smith, J. (2024). Facilitate Growth.' }];
  const edited = await MaterialProcessing.base(blocks, { isCurrent: () => true, progress() {}, process: (text) => ({ text: text.replace('reports', 'presents'), warnings: [] }) });
  assert.equal(edited.blocks[2].text, blocks[2].text);
  assert.equal(MaterialProcessing.jobs(blocks).jobs.length, 1);
  const inline = [{ type: 'paragraph', text: 'The team reports growth.\n\nReferences\n\nSmith, J. (2024). Facilitate Growth.' }];
  assert.ok(MaterialProcessing.jobs(inline).jobs.every((j) => !j.text.includes('Smith')));
  inline[0].text += '\n\nAppendix A\n\nThe team develops useful products for local customers.';
  const queue = MaterialProcessing.jobs(inline).jobs;
  assert.equal(queue.length, 2);
  assert.ok(queue[0].text.includes('reports growth'));
  assert.ok(queue[1].text.includes('develops useful products'));
});
test('model and scoring fallbacks remain visible in compact diagnostics', async () => {
  let message = '';
  global.PolishUI = { run: async (options) => options.collect({ details: [], generatorWarnings: ['Generator unavailable'], warnings: ['Semantic skipped'], rankingSummary: 'PPL unavailable' }) };
  const result = await automatic.run({ text: 'The team reports growth.', language: 'en', isCurrent: () => true, apply() {}, report: (value) => { message = value; } });
  assert.deepEqual(result.warnings, ['Generator unavailable', 'Semantic skipped', 'PPL unavailable']);
  assert.match(message, /Generator unavailable.*Semantic skipped.*PPL unavailable/);
});
