"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("./anchor-guard.js");
require("./humanizer-metrics.js");
require("./paraphraser.js");
require("./rewriter.js");
const select = require("./candidate-select.js");

const SAMPLE =
  "Кроме того, важно отметить, что система обрабатывает документы локально — она не отправляет данные наружу. " +
  "Таким образом, пользователь получает результат быстро и приватно. Более того, обработка идёт без сервера.";

test("исходный текст всегда участвует в отборе", () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  assert.ok(candidates.some((item) => item.text === SAMPLE), "версия «как есть» обязана быть среди кандидатов");
});

test("кандидаты различаются между собой", () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  assert.ok(candidates.length >= 2);
  assert.equal(new Set(candidates.map((item) => item.text)).size, candidates.length);
});

test("кандидат, потерявший число, до отбора не доходит", () => {
  const source = "Выручка выросла на 12,5% за 2024 год, и команда вывела продукт на два региона рынка.";
  for (const candidate of select.generate(source, { language: "ru" })) {
    assert.match(candidate.text, /12,5%/);
    assert.match(candidate.text, /2024/);
  }
});

test("при равных оценках побеждает исходный текст", async () => {
  const result = await select.improve(SAMPLE, {
    language: "ru",
    score: (texts) => Promise.resolve(texts.map(() => 50)),
  });
  assert.equal(result.improved, false);
  assert.equal(result.text, SAMPLE);
});

test("выбирается кандидат с наименьшей оценкой", async () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  const target = candidates[candidates.length - 1];
  const result = await select.select(SAMPLE, candidates, {
    score: (texts) => Promise.resolve(texts.map((text) => (text === target.text ? 1 : 90))),
  });
  assert.equal(result.text, target.text);
  assert.equal(result.improved, true);
});

test("неоценённый кандидат выбывает, а не считается худшим", async () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  const result = await select.select(SAMPLE, candidates, {
    score: (texts) => Promise.resolve(texts.map((text, index) => (index === 0 ? NaN : 10 + index))),
  });
  assert.ok(result.ranked.every((item) => Number.isFinite(item.score)));
  assert.equal(result.ranked.length, candidates.length - 1);
});

test("перплексия переворачивается в оценку машинности", async () => {
  const scorer = select.perplexityScorer({ scoreTexts: (texts) => Promise.resolve(texts.map((_, index) => index + 1)) });
  assert.deepEqual(await scorer(["a", "b", "c"]), [-1, -2, -3]);
});

test("без модели отбор идёт по детерминированной оценке", () => {
  assert.equal(select.perplexityScorer({}), null);
  assert.equal(typeof select.bestAvailableScorer("ru"), "function");
});

require("./edit-passes.js");
require("./weak-spots.js");

const WEAK =
  "Кроме того, цифровая трансформация играет ключевую роль в развитии бизнеса. " +
  "Выручка Ozon выросла на 12,5% за 2024 год по данным отчёта аудитора. " +
  "Как правило, автоматизация позволяет значительно повысить эффективность работы.";

test("полировка заменяет только те предложения, где нашлось лучше", async () => {
  const result = await select.polishSentences(WEAK, { language: "ru" });
  assert.equal(result.ok, true);
  assert.ok(result.replaced >= 1);
  for (const detail of result.details) assert.ok(detail.gain > 0, "замена без выигрыша недопустима");
});

test("предложение с конкретикой полировка не трогает", async () => {
  const result = await select.polishSentences(WEAK, { language: "ru" });
  assert.match(result.text, /Выручка Ozon выросла на 12,5% за 2024 год/);
});

test("равная оценка не считается улучшением", async () => {
  const result = await select.polishSentences(WEAK, {
    language: "ru",
    score: (texts) => Promise.resolve(texts.map(() => 42)),
  });
  assert.equal(result.replaced, 0);
  assert.equal(result.text, WEAK);
});

test("варианты одного предложения не теряют якорей", () => {
  const sentence = "Выручка выросла на 12,5% за 2024 год по данным отчёта аудитора.";
  for (const variant of select.sentenceVariants(sentence, "ru")) {
    assert.match(variant, /12,5%/);
    assert.match(variant, /2024/);
  }
});

test("варианты уходят в модель одним пакетом", async () => {
  let calls = 0;
  await select.polishSentences(WEAK, {
    language: "ru",
    score: (texts) => {
      calls += 1;
      return Promise.resolve(texts.map((_text, index) => index));
    },
  });
  assert.equal(calls, 1, "оценка обязана вызываться один раз на весь текст");
});

test("версии от генератора проходят тот же гард якорей", async () => {
  const source = "Как правило, автоматизация позволяет значительно повысить эффективность работы отдела.";
  const result = await select.polishSentences(source, {
    language: "ru",
    // Первая версия ломает число, вторая честная. До оценки должна дойти вторая.
    generate: () => Promise.resolve([
      "Автоматизация повысила эффективность отдела на 40%.",
      "Автоматизация ускорила работу отдела.",
    ]),
    score: (texts) => Promise.resolve(texts.map((text) => (text === "Автоматизация ускорила работу отдела." ? 1 : 90))),
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, "Автоматизация ускорила работу отдела.");
});

test("падение генератора не ломает полировку", async () => {
  const source = "Как правило, автоматизация позволяет значительно повысить эффективность работы отдела.";
  const result = await select.polishSentences(source, {
    language: "ru",
    generate: () => Promise.reject(new Error("модель не загрузилась")),
  });
  assert.equal(result.ok, true);
});
