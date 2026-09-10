const test = require('node:test');
const assert = require('node:assert/strict');
const grammar = require('./grammar-edits.js');
const references = require('./reference-guard.js');

for (const [input, expected] of [
  ['Компания проводит анализ рынка.', 'Компания анализирует рынок.'],
  ['Команды проводят анализ рынка.', 'Команды анализируют рынок.'],
  ['Банк оказывает поддержку малому бизнесу.', 'Банк поддерживает малый бизнес.'],
  ['Банки оказывают поддержку малому бизнесу.', 'Банки поддерживают малый бизнес.'],
  ['Этот фактор является причиной задержек.', 'Этот фактор вызывает задержки.'],
  ['Эти факторы являются причиной задержек.', 'Эти факторы вызывают задержки.'],
  ['Наблюдается рост выручки.', 'Выручка растёт.'],
  ['Наблюдается снижение спроса.', 'Спрос снижается.'],
  ['Компания не проводит анализ рынка.', 'Компания не анализирует рынок.'],
]) test(`closed grammatical rewrite: ${input}`, () => {
  const result = grammar.run(input);
  assert.equal(result.text, expected);
  assert.equal(result.applied, 1);
  assert.equal(grammar.run(result.text).applied, 0);
});

for (const input of [
  'Не наблюдается рост выручки.', 'Вероятно, наблюдается рост выручки.',
  'Наблюдается рост выручки компании.', 'Компания проводит анализ рынка труда.',
  'Банк оказывает поддержку новым компаниям.', 'Решение носит системный характер.',
  'Автор пишет: «Наблюдается рост выручки».', 'Автор пишет: "Компания проводит анализ рынка."',
  "Автор пишет: 'Компания проводит анализ рынка.' Это верно.",
  'Автор пишет: „Компания проводит анализ рынка.“ Это верно.',
  '> Компания проводит анализ рынка.', 'КОМПАНИЯ ПРОВОДИТ АНАЛИЗ РЫНКА.',
  '# Компания проводит анализ рынка.', '| Компания проводит анализ рынка. |',
  'Компания проводит анализ рынка', 'Возможны исключения, но данных нет.',
]) test(`no invented inflection, evidence or quotation change: ${input}`, () => {
  assert.equal(grammar.run(input).text, input);
});

test('bibliography and reference details stay literal', () => {
  const input = 'Компания проводит анализ рынка. См. [1].\n\nReferences\n\n1 Компания проводит анализ рынка. https://example.com/report';
  const result = grammar.run(input);
  assert.equal(result.applied, 1);
  assert.equal(references.compare(input, result.text), true);
});

test('same default pipeline runs grammar for fragments and document paragraphs without models', () => {
  global.TextProcessor = require('./processor.js');
  global.RuleParaphraser = require('./paraphraser.js');
  global.StructuralRewriter = require('./rewriter.js');
  global.HumanizerMetrics = require('./humanizer-metrics.js');
  global.HumanizerEngine = require('./humanizer-engine.js');
  global.Typography = require('./typography.js');
  global.EditPasses = require('./edit-passes.js');
  global.AnchorGuard = require('./anchor-guard.js');
  global.Generator = { paraphrase() { throw Error('no models in base pass'); } };
  const pipeline = require('./text-pipeline.js');
  const input = 'Компания проводит анализ рынка. Банк оказывает поддержку малому бизнесу.';
  const result = pipeline.run(input);
  assert.match(result.text, /анализирует рынок/);
  assert.match(result.text, /поддерживает малый бизнес/);
  assert.match(result.summary.join(' '), /Грамматические правки.*применены автоматически/);
  const protectedResult = pipeline.run(input, { terms: ['анализ рынка', 'поддержку'] });
  assert.equal(protectedResult.text, input);
  assert.doesNotMatch(protectedResult.summary.join(' '), /Грамматические правки/);
});

test('author homework panels are not part of the editing UI', () => {
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, 'review-ui.js'), 'utf8');
  assert.doesNotMatch(html, /id="(?:manualList|questionList|checklistBox|weakList)"/u);
  assert.doesNotMatch(ui, /renderManual\(|renderAsk\(|renderWeakSpots\(/u);
});
