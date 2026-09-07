const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('./meaning-guard.js');
const quality = require('./revision-quality.js');

test('real model regression: realistic forecasts must not become accurate forecasts', () => {
  assert.equal(guard.check('realistic financial projections', 'accurate financial forecasts').ok, false);
  assert.equal(guard.check('realistic financial projections', 'realistic financial forecasts').ok, true);
});
test('new emphasis and changed frequency or scope are not cosmetic edits', () => {
  for (const [source, candidate] of [
    ['usually increases', 'rarely increases'], ['some companies', 'all companies'],
    ['in limited conditions', 'especially in limited conditions'],
    ['в условиях ограниченных ресурсов', 'особенно в условиях ограниченных ресурсов'],
    ['if results improve', 'results improve'], ['can reduce costs', 'reduces costs'],
    ['associated with lower costs', 'causes lower costs'],
  ]) assert.equal(guard.check(source, candidate).ok, false, candidate);
});
test('qualified claims allow structural edits without matching substrings or punctuation', () => {
  assert.equal(guard.check('The team can only improve accuracy if the data are realistic.', 'If the data are realistic, only the team can improve accuracy.').ok, true);
  // The preceding test also documents a limitation: scope/roles need author review.
  assert.equal(guard.check('A small factory produces goods.', 'Goods are produced by a small factory.').ok, true);
  assert.deepEqual(guard.terms('Realistic forecasts can help; small amounts.'), ['realistic','can']);
});
test('claim guard is connected to candidate quality and generation reference data', () => {
  assert.equal(quality.check('The team can reduce costs.', 'The team reduces costs.', []).ok, false);
  const core = require('./generator-core.js');
  const messages = core.buildMessages('The team can use realistic estimates.', {language:'en',contextual:true,creative:true});
  assert.deepEqual(JSON.parse(messages[1].content).protectedQualifications, ['realistic','can']);
  assert.match(messages[0].content, /protectedQualifications literally/);
});
