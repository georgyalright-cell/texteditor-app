"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("./anchor-guard.js");
const elicitation = require("./elicitation.js");

const VAGUE = "Внедрение системы позволяет значительно повысить эффективность работы отдела продаж и снизить издержки на обработку заявок, что положительно сказывается на всех процессах компании.";
const CONCRETE = "В 2024 году выручка Ozon выросла на 12,5% по данным отчёта за четвёртый квартал, и это подтверждено независимым аудитором из большой четвёрки.";

test("абзац без конкретики получает вопросы про числа, период и имена", () => {
  const kinds = elicitation.questions(VAGUE, { language: "ru" }).map((item) => item.kind);
  assert.ok(kinds.includes("числа"));
  assert.ok(kinds.includes("период"));
  assert.ok(kinds.includes("имена"));
});

test("утверждение о пользе без числа получает вопрос «насколько»", () => {
  const questions = elicitation.questions(VAGUE, { language: "ru" });
  assert.ok(questions.some((item) => item.kind === "насколько"));
});

test("универсальное утверждение проверяется на фальсифицируемость", () => {
  const questions = elicitation.questions(VAGUE, { language: "ru" });
  assert.ok(questions.some((item) => item.kind === "фальсифицируемость"));
});

test("плотный абзац вопросов не порождает", () => {
  assert.deepEqual(elicitation.questions(CONCRETE, { language: "ru" }), []);
});

test("короткая связка между разделами вопросов не получает", () => {
  assert.deepEqual(elicitation.questions("Перейдём к анализу рынка.", { language: "ru" }), []);
});

test("дрейф терминологии ловится на дефисе и пробеле", () => {
  const drift = elicitation.terminology(
    "Бизнес-модель платформы описана выше. Бизнес модель проверена на клиентах. Бизнес-модель работает.",
  );
  const forms = drift.flatMap((group) => group.variants.map((variant) => variant.form));
  assert.ok(forms.includes("бизнес-модель"));
  assert.ok(forms.includes("бизнес модель"));
});

test("для профиля с обязательной структурой проверка заголовков выключена", () => {
  const result = elicitation.headings(["Анализ", "Оценка", "Планирование"], { strictSections: true });
  assert.equal(result.enabled, false);
  assert.match(result.note, /методичкой/);
});

test("однотипные заголовки помечаются как параллельные", () => {
  const result = elicitation.headings(
    ["Планирование бюджета", "Обоснование сроков", "Согласование рисков", "Утверждение сметы"],
    {},
  );
  assert.equal(result.parallel, true);
});

test("чеклист содержит все шесть методов блока B", () => {
  assert.deepEqual(elicitation.CHECKLIST.map((item) => item.method), [12, 13, 14, 15, 16, 17]);
});
