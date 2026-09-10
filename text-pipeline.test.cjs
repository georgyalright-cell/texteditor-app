"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

global.TextProcessor = require("./processor.js");
global.RuleParaphraser = require("./paraphraser.js");
global.StructuralRewriter = require("./rewriter.js");
global.HumanizerMetrics = require("./humanizer-metrics.js");
global.HumanizerEngine = require("./humanizer-engine.js");
global.Typography = require("./typography.js");

const pipeline = require("./text-pipeline.js");

test("protected terminology survives the common pipeline used by both modes", () => {
  const source = "These measures facilitate collaboration between the teams.";
  const protectedResult = pipeline.run(source, { terms: ["facilitate"] });
  assert.equal(protectedResult.text, source);
  assert.ok(protectedResult.warnings.some((s) => /защищённые термины/u.test(s)));
  assert.notEqual(pipeline.run(source).text, source);
});

test("общий контур сохраняет полный словарный проход перед замкнутым циклом", () => {
  const source =
    "В современном мире важно отметить, что цифровизация оказывает существенное влияние на выручку — " +
    "это позволяет компании быстрее принимать решения. В 2026 году результат составил 12,5 млн рублей, " +
    "источник: https://example.com/report.";
  const result = pipeline.run(source);

  assert.doesNotMatch(result.text, /в современном мире|важно отметить|оказывает существенное влияние/iu);
  assert.doesNotMatch(result.text, /сейчас отметим/iu);
  assert.match(result.text, /существенно влияет/iu);
  assert.match(result.text, /2026/u);
  assert.match(result.text, /12,5/u);
  assert.match(result.text, /https:\/\/example\.com\/report/u);
  assert.ok(result.summary.some((item) => /Словарная обработка/u.test(item)));
});
