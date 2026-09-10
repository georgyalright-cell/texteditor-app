const test = require('node:test');
const assert = require('node:assert/strict');
const passes = require('./edit-passes.js');
const pipeline = require('./text-pipeline.js');
test('all 500 admissible edits are applied: there is no arbitrary edit-count cap', () => {
  const source = Array.from({ length: 500 }, (_, i) => `Компания ${i} оказывает влияние на рынок.`).join('\n\n');
  const proposal = passes.propose(source, { language: 'ru' });
  const result = passes.apply(source, proposal.edits.map(e => ({ ...e, accepted: e.confidence === 'high' && !e.keptForZone })));
  assert.equal(result.ok, true); assert.equal(result.applied, 500);
  assert.equal((result.text.match(/влияет на рынок/gu) || []).length, 500);
});
test('review result reports outcome, not an accepted/proposed scoreboard', () => {
  for (const editsAccepted of [0, 80, 500]) {
    const message = pipeline.reviewMessage({ editsTotal: 500, editsAccepted, applied: { ok: true, removedShare: .15 } });
    assert.doesNotMatch(message, /\d|из \d|предложено|принято/u);
  }
  assert.doesNotMatch(pipeline.reviewMessage({ deepRevision: { replaced: 80, totalSentences: 500 } }), /\d/u);
});
