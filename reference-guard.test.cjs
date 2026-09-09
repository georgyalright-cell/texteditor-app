const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('./reference-guard.js');
const anchors = require('./anchor-guard.js');
global.TextProcessor = require('./processor.js');
global.RuleParaphraser = require('./paraphraser.js');
global.StructuralRewriter = require('./rewriter.js');
global.HumanizerMetrics = require('./humanizer-metrics.js');
global.HumanizerEngine = require('./humanizer-engine.js');
global.Typography = require('./typography.js');
const pipeline = require('./text-pipeline.js');
const structurer = require('./structurer.js');

for (const reference of [
  '[1-3]', '[1, 3, pp. 12-14]', '(Smith, 2024, pp. 12-14)', '(Иванов, 2024, с. 12-14)',
  '(Smith, 2024; Jones, 2023)', 'https://example.com/report_(final)?x=1&Y=AB',
  '(Smith, 2002a, 2002b)', '(accessed: 27.08.2026)', '(дата обращения: 27.08.2026)',
  'Table 2.3', 'Appendix B', 'рис. 2.3',
  'https://doi.org/10.1000/(SICI)123?ID=AB', '10.1234/report_(Final)',
  '[the report](https://example.com/A_(B)?X=1&Y=2)', '[^source-1]',
]) test(`literal references survive cleaning, typography, editing and document assembly: ${reference}`, () => {
  const source = `It is important to note that the findings remain preliminary ${reference}. The company plans to facilitate growth.`;
  for (const result of [TextProcessor.processText(source), Typography.normalize(source), pipeline.run(source)]) {
    assert.ok(result.text.includes(reference), result.text);
    assert.ok(guard.compare(source, result.text));
    assert.doesNotMatch(result.text, /[\uE700-\uEFFF]/u);
  }
  assert.ok(structurer.applyProfile(pipeline.run(source).text, 'business-plan', { placeholders: false }).text.includes(reference));
});

test('case-sensitive URL paths, reference ranges and multiplicity reject altered candidates', () => {
  for (const [a, b] of [
    ['https://example.com/Ab?ID=CD', 'https://example.com/ab?ID=CD'],
    ['See [1-3].', 'See [1–3].'],
    ['See [1]. Again [1].', 'See [1].'],
    ['Exports increased [1], while costs fell [2].', 'Exports increased [2], while costs fell [1].'],
    ['(Smith, 2024, pp. 12-14)', '(Smith, 2024, pp. 12–14)'],
    ['https://example.com/r_(final)?x=1', 'https://example.com/r_(final)? x=1'],
  ]) assert.equal(anchors.compare(a, b).ok, false, `${a} -> ${b}`);
});
test('numbered bibliography headings protect EN and RU entries', () => {
  for (const title of ['8. References', '9. Список литературы']) {
    assert.deepEqual(guard.protectedBlocks([{ type: 'heading', title }, { type: 'paragraph', text: 'A comprehensive framework.' }]), [true, true]);
    assert.equal(guard.compare(`${title}\nA comprehensive framework.`, `${title}\nA detailed framework.`), false);
  }
});
test('URL closing punctuation is not part of the protected URL', () => {
  assert.deepEqual(guard.ranges('(https://example.com/a_(b)?X=1).').map((r) => r.value), ['https://example.com/a_(b)?X=1']);
});
test('references bibliography is not paraphrased or renumbered', () => {
  const entry = '7. Smith, J. (2024). Facilitate Growth. https://example.com/Ref_(A)?X=1';
  const source = `The company plans to facilitate growth.\n\nReferences\n\n${entry}`;
  const edited = pipeline.run(source).text;
  assert.ok(edited.includes(entry));
  const document = structurer.applyProfile(edited, 'business-plan', { placeholders: false });
  assert.ok(document.text.includes(entry));
  assert.equal(document.blocks.find((b) => b.text === entry).type, 'paragraph');
});
test('damaged internal placeholders never reach output', () => {
  const source = 'See [1-3].';
  assert.equal(guard.transform(source, () => ({ text: 'broken', warnings: [] })).text, source);
  const colliding = '\uE700REF See [1-3].';
  assert.equal(guard.transform(colliding, (text) => ({ text })).text, colliding);
});
test('MB9 citation punctuation stays intact while other composition edits apply', () => {
  const passes = require('./edit-passes.js');
  const citation = "(EIS, 2026; authors' calc. from Kommersant, 2024)";
  const source = `It is important to note that the findings remain preliminary ${citation}. The company plans to facilitate growth.`;
  const proposal = passes.propose(source);
  const result = passes.apply(source, proposal.edits.map((d) => ({ ...d, accepted: d.confidence === 'high' && !d.keptForZone })));
  assert.equal(result.ok, true, result.warnings.join(' '));
  assert.ok(result.text.includes(citation));
  assert.equal(guard.compare(source, result.text), true);
  assert.equal(passes.apply(source, []).text, source);
});
test('existing cross-reference targets retain their original numbers through export', () => {
  const source = '2.4. Market analysis\n\nSee Table 7 and Figure 2.3 in Section 2.4.\n\nTable 7. Market values\n\nA\tB\n10\t20\n\nFigure 2.3. Market comparison';
  const result = structurer.applyProfile(source, 'hse-business-plan', { placeholders: false });
  assert.equal(result.blocks.find((b) => b.type === 'heading').number, '2.4');
  assert.deepEqual(result.blocks.filter((b) => b.type === 'caption').map((b) => b.number), ['7', '2.3']);
  const xml = require('./docx-writer.js').buildDocumentXml(result.blocks, result.profile);
  assert.match(xml, /Table 7\. Market values/);
  assert.match(xml, /Figure 2\.3\. Market comparison/);
});
test('cross-reference identifiers include suffixes and case-insensitive prefixes', () => {
  for (const label of ['Table 2.3a', 'table 2.3a', 'таблицу 2.3а']) {
    assert.deepEqual(guard.ranges(`See ${label}.`).map((s) => s.value), [label]);
    assert.equal(anchors.compare(label, label.replace(/[aа]$/u, 'b')).ok, false);
  }
  assert.equal(anchors.compare('table 2', 'figure 2').ok, false);
});
test('inserted sections do not reuse existing section identifiers', () => {
  const result = structurer.applyProfile('1. Marketing plan\n\nThe strategy is sound.', 'hse-business-plan');
  const numbers = result.blocks.filter((b) => b.type === 'heading' && b.kind === 'section' && b.number).map((b) => b.number);
  assert.equal(new Set(numbers).size, numbers.length);
});
