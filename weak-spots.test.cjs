"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("./anchor-guard.js");
require("./humanizer-metrics.js");
const weak = require("./weak-spots.js");

const SAMPLE =
  "Кроме того, цифровая трансформация играет ключевую роль в развитии бизнеса. " +
  "Выручка Ozon выросла на 12,5% за 2024 год по данным отчёта. " +
  "Как правило, автоматизация позволяет значительно повысить эффективность работы. " +
  "Команда собрала прототип за шесть недель. " +
  "Кроме того, компании получают конкурентное преимущество на рынке.";

test("предложение с числами и источником уходит вниз списка", () => {
  const ranked = weak.rank(SAMPLE, { language: "ru" });
  const concrete = ranked.find((item) => item.text.includes("12,5%"));
  assert.equal(concrete.score, 0);
  assert.equal(ranked[ranked.length - 1].score, 0);
});

test("связка, штамп и пустое обещание складываются, а не усредняются", () => {
  const ranked = weak.rank(SAMPLE, { language: "ru" });
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].reasons.length >= 3, `причин мало: ${ranked[0].reasons.join("; ")}`);
});

test("у каждого слабого места есть причина", () => {
  for (const item of weak.rank(SAMPLE, { language: "ru" })) {
    if (item.score > 0) assert.ok(item.reasons.length > 0, `нет причины: ${item.text}`);
  }
});

test("worst отдаёт долю текста, а не фиксированное число", () => {
  const many = Array.from(
    { length: 20 },
    (_item, index) => `Кроме того, решение позволяет значительно повысить эффективность процесса номер ${index}.`,
  ).join(" ");
  assert.ok(weak.worst(many, { language: "ru", share: 0.15 }).length <= 3);
  assert.ok(weak.worst(SAMPLE, { language: "ru", share: 0.15 }).length >= 1);
});

test("текст без слабых мест даёт пустой список", () => {
  const solid = "Выручка выросла на 12,5% за 2024 год. Команда из семи человек закрыла проект за квартал.";
  assert.deepEqual(weak.worst(solid, { language: "ru" }), []);
});

test("английский разбирается своим набором признаков", () => {
  const english =
    "Moreover, the platform provides a comprehensive framework for growth. " +
    "Revenue reached 12.5 million dollars in 2024 according to the audit.";
  const ranked = weak.rank(english, { language: "en" });
  assert.ok(ranked[0].text.startsWith("Moreover"));
  assert.equal(ranked[ranked.length - 1].score, 0);
});
