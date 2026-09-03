"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const structurer = require("./structurer.js");
const profiles = require("./format-profiles.js");

const FULL_PLAN = [
  "1. Executive Summary",
  "Проект предполагает выпуск оборудования в Москве с выручкой 255,4 млн руб. на пятый год.",
  "2. Business Outline and Market Analysis",
  "Целевой сегмент оценивается в 7,8 млрд руб. по данным отраслевых обзоров.",
  "3. Marketing and Sales Plan",
  "Каналы продаж включают прямые контракты и партнёрские бюро.",
  "4. Organization Plan",
  "Штат на старте составляет 12 человек.",
  "5. Production Plan",
  "Сборка и калибровка выполняются на арендованной площадке.",
  "6. Investment Plan",
  "Стартовые вложения составляют 24,7 млн руб.",
  "7. Financial Plan",
  "Показатель NPV равен 19,2 млн руб. при ставке 25%.",
  "8. Project Performance Evaluation and Risk Analysis",
  "Приростной NPV относительно закупки за рубежом равен 14,7 млн руб.",
  "Contents",
  "Оглавление собирается по разделам работы.",
  "Conclusion",
  "Проект признан привлекательным при выполнении допущений.",
  "References",
  "Источники перечислены в алфавитном порядке.",
].join("\n\n");

test("классифицирует нумерованный заголовок и определяет уровень", () => {
  const block = structurer.classifyBlock("2.4.1. Целевой сегмент");
  assert.equal(block.type, "heading");
  assert.equal(block.number, "2.4.1");
  assert.equal(block.level, 3);
  assert.equal(block.title, "Целевой сегмент");
});

test("короткий абзац с точкой заголовком не считается", () => {
  const block = structurer.classifyBlock("Выручка выросла.");
  assert.equal(block.type, "paragraph");
});

test("подпись к таблице распознаётся и получает сквозной номер", () => {
  const source = ["Таблица 7 — Допущения", "Текст ссылается на Table 1 в этом же абзаце."].join("\n\n");
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  const caption = outcome.blocks.find((block) => block.type === "caption");
  assert.equal(caption.prefix, "Table");
  assert.equal(caption.number, "1");
  assert.equal(caption.alignment, "right");
  assert.equal(caption.position, "above");
});

test("подпись к рисунку выравнивается по центру и ставится под визуалом", () => {
  const outcome = structurer.applyProfile("Рисунок 3. Схема сборки", "hse-business-plan");
  const caption = outcome.blocks.find((block) => block.type === "caption");
  assert.equal(caption.prefix, "Figure");
  assert.equal(caption.alignment, "center");
  assert.equal(caption.position, "below");
});

test("заголовок верхнего уровня выводится заглавными без точки", () => {
  const outcome = structurer.applyProfile("1. Executive Summary\n\nТекст раздела.", "hse-business-plan");
  assert.match(outcome.text, /^1\. EXECUTIVE SUMMARY$/mu);
});

test("недостающие разделы заменяются прочерком, а не пропускаются", () => {
  const source = "1. Executive Summary\n\nКраткое описание проекта на 5 лет.";
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  assert.ok(outcome.inserted.includes("Financial Plan"));
  assert.ok(outcome.inserted.includes("Production Plan"));
  assert.match(outcome.text, /FINANCIAL PLAN\n\n—/u);
  const placeholders = outcome.report.problems.find((problem) => problem.id === "placeholders");
  assert.ok(placeholders);
  assert.ok(placeholders.items.includes("Financial Plan"));
});

test("прочерки встают в каноническом порядке перед следующим найденным разделом", () => {
  const source = ["1. Executive Summary", "Описание.", "7. Financial Plan", "Расчёты."].join("\n\n");
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  const headings = outcome.blocks.filter((block) => block.type === "heading").map((block) => block.title);
  assert.ok(headings.indexOf("Production Plan") < headings.indexOf("Financial Plan"));
  assert.ok(headings.indexOf("Marketing and Sales Plan") < headings.indexOf("Production Plan"));
});

test("полный комплект разделов не порождает прочерков", () => {
  const outcome = structurer.applyProfile(FULL_PLAN, "hse-business-plan");
  assert.deepEqual(outcome.inserted, []);
  assert.equal(outcome.changes.placeholders, 0);
});

test("профиль академического отчёта не навязывает список разделов", () => {
  const source = "Введение\n\nРабота посвящена анализу.\n\nContents\n\nОглавление.\n\nConclusion\n\nВывод.\n\nReferences\n\nИсточники.";
  const outcome = structurer.applyProfile(source, "academic-report");
  assert.deepEqual(outcome.inserted, []);
});

test("сохраняет числа и ссылки основного текста", () => {
  const source = "1. Executive Summary\n\nВыручка 255,4 млн руб., подробности на https://example.com/plan?id=7.";
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  assert.match(outcome.text, /255,4/u);
  assert.match(outcome.text, /https:\/\/example\.com\/plan\?id=7/u);
  assert.deepEqual(outcome.warnings, []);
});

test("находит аббревиатуру без расшифровки и пропускает общеупотребимую", () => {
  const source = "1. Executive Summary\n\nПоказатель NPV положителен, систему ЦКАД строит подрядчик.";
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  const problem = outcome.report.problems.find((item) => item.id === "abbreviations");
  assert.ok(problem.items.includes("ЦКАД"));
  assert.ok(!problem.items.includes("NPV"));
});

test("расшифрованная при первом упоминании аббревиатура замечанием не считается", () => {
  const source = "1. Executive Summary\n\nЕдиная диспетчерская служба (ЕДС) принимает заявки. ЕДС работает круглосуточно.";
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  const problem = outcome.report.problems.find((item) => item.id === "abbreviations");
  assert.ok(!problem || !problem.items.includes("ЕДС"));
});

test("отмечает ссылки в формате [12] как не соответствующие ГОСТ", () => {
  const source = "1. Executive Summary\n\nПо данным обзора [14] рынок растёт.";
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  assert.ok(outcome.report.problems.some((item) => item.id === "citations"));
});

test("замечает приложение, на которое нет ссылки в тексте", () => {
  const source = "1. Executive Summary\n\nОписание проекта.\n\nAppendix D. Supporting tables\n\nТаблицы модели.";
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  const problem = outcome.report.problems.find((item) => item.id === "appendix-unreferenced");
  assert.ok(problem.items.includes("Appendix D"));
});

test("профили отдают требования §5.1 в твипах", () => {
  const profile = profiles.get("hse-business-plan");
  assert.equal(profiles.mmToTwips(profile.layout.page.marginLeftMm), 1701);
  assert.equal(profiles.cmToTwips(profile.layout.body.firstLineIndentCm), 709);
  assert.equal(profile.layout.font.family, "Times New Roman");
  assert.equal(profile.layout.font.sizePt, 12);
});

test("пустой ввод не роняет обработку", () => {
  const outcome = structurer.applyProfile("   ", "hse-business-plan");
  assert.equal(outcome.text, "");
  assert.deepEqual(outcome.blocks, []);
});
