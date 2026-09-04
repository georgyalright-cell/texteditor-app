"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const builder = require("./document-builder.js");
const typography = require("./typography.js");
const metrics = require("./humanizer-metrics.js");

const METADATA = {
  topic: "Локализация производства",
  programme: "Business Management",
  teamMembers: [
    { name: "Ермошин А. А.", group: "БМ-201" },
    { name: "Иванов И. И.", group: "БМ-201" },
  ],
  supervisor: "к.э.н., доцент, Петров П. П.",
  year: "2026",
};

function assemble(text, metadata) {
  return builder.assemble({
    text,
    profileId: "hse-business-plan",
    metadata: metadata || METADATA,
  });
}

function headings(doc) {
  return doc.blocks.filter((block) => block.type === "heading").map((block) => block.title);
}

test("собирает все обязательные части работы из §3.1", () => {
  const doc = assemble("1. Executive Summary\n\nКраткое описание проекта.");
  const titles = headings(doc);
  for (const part of ["Team members", "Contents", "Individual Contribution", "Conclusion", "References"]) {
    assert.ok(titles.includes(part), `нет части «${part}»`);
  }
  assert.ok(titles.some((title) => /originality/iu.test(title)));
});

test("титульный лист заполняется реквизитами, а пустые поля остаются прочерком", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.");
  const plainText = doc.blocks.filter((block) => block.type === "plain").map((block) => block.text);
  assert.ok(plainText.includes("Локализация производства"));
  assert.ok(plainText.includes("к.э.н., доцент, Петров П. П."));
  assert.ok(plainText.includes("Ермошин А. А., БМ-201"));

  const empty = assemble("1. Executive Summary\n\nОписание.", { teamMembers: [] });
  const emptyText = empty.blocks.filter((block) => block.type === "plain").map((block) => block.text);
  assert.ok(emptyText.some((line) => line.includes(builder.BLANK_FIELD)));
});

test("все восемь разделов §2.1 присутствуют и пронумерованы подряд", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.");
  const numbered = doc.blocks
    .filter((block) => block.type === "heading" && block.level === 1 && block.number)
    .map((block) => block.number);
  assert.deepEqual(numbered, ["1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("подразделы автора и каркаса нумеруются без дублей", () => {
  const source = "1. Executive Summary\n\nОписание.\n\n1.1. Допущения\n\nТекст допущений.";
  const doc = assemble(source);
  const subs = doc.blocks
    .filter((block) => block.type === "heading" && block.level === 2 && block.number)
    .map((block) => block.number);
  assert.equal(new Set(subs).size, subs.length);
  assert.ok(subs.includes("1.1"));
  assert.ok(subs.includes("1.2"));
});

test("пустой раздел получает шаблонные таблицы методички", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.");
  const tables = doc.blocks.filter((block) => block.type === "docTable");
  assert.ok(tables.length >= 10);
  const summary = tables[0];
  assert.deepEqual(summary.columns, ["Project Data", "Period I", "Period II", "Period III", "Period IV", "Period V"]);
  assert.ok(summary.rows.includes("NPV"));
  assert.ok(summary.rows.includes("Payback Period"));
});

test("подпись таблицы идёт над таблицей, справа, со ссылкой на авторство", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.");
  const captionIndex = doc.blocks.findIndex((block) => block.type === "caption");
  assert.equal(doc.blocks[captionIndex].alignment, "right");
  assert.equal(doc.blocks[captionIndex].position, "above");
  assert.equal(doc.blocks[captionIndex + 1].type, "sourceNote");
  assert.equal(doc.blocks[captionIndex + 1].text, "designed by the authors");
  assert.equal(doc.blocks[captionIndex + 2].type, "docTable");
});

test("подписи нумеруются сквозно и раздельно для таблиц и рисунков", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.\n\nРисунок 7. Схема\n\nТекст про схему.");
  const captions = doc.blocks.filter((block) => block.type === "caption");
  const tables = captions.filter((item) => item.kind === "table").map((item) => item.number);
  const figures = captions.filter((item) => item.kind === "figure").map((item) => item.number);
  assert.deepEqual(tables.slice(0, 3), ["1", "2", "3"]);
  assert.deepEqual(figures, ["1"]);
});

test("текст автора попадает в свой раздел и не дублируется", () => {
  const source = "7. Financial Plan\n\nСвободный денежный поток выходит в плюс на третий год.";
  const doc = assemble(source);
  const index = doc.blocks.findIndex((block) => block.type === "heading" && block.title === "Financial Plan");
  const following = doc.blocks.slice(index + 1, index + 3).map((block) => block.text);
  assert.ok(following.some((text) => text && text.includes("третий год")));
  const occurrences = doc.blocks.filter((block) => block.text && block.text.includes("третий год")).length;
  assert.equal(occurrences, 1);
});

test("разделы методички 2.2–2.10 распознаются как основные, а не как один вложенный блок", () => {
  const source = [
    "2.2. Executive Summary",
    "Краткое описание проекта и ключевых показателей.",
    "2.3. Business Outline and Market Analysis",
    "Описание продукта, клиентов и целевого рынка.",
    "2.9. Financial Plan",
    "Прогноз выручки и денежных потоков на пять лет.",
  ].join("\n\n");
  const doc = assemble(source);
  assert.equal(doc.stats.filled, 3);
  assert.ok(!doc.inserted.includes("Executive Summary"));
  assert.ok(!doc.inserted.includes("Business Outline and Market Analysis"));
  assert.ok(!doc.inserted.includes("Financial Plan"));
});

test("названия подразделов не отрываются от своей главы из-за частичного совпадения", () => {
  const source = [
    "3. Marketing and Sales Plan",
    "Sales process and sales funnel",
    "Описание процесса продаж.",
    "Sales plan and KPIs",
    "План продаж содержит измеримые показатели.",
    "4. Organization Plan",
    "Organizational structure",
    "Роли и подчинённость команды определены.",
  ].join("\n\n");
  const doc = assemble(source);
  assert.ok(!doc.inserted.includes("Marketing and Sales Plan → Sales plan and KPIs"));
  assert.ok(!doc.inserted.includes("Organization Plan → Organizational structure"));
  assert.equal(doc.stats.filled, 2);
});

test("короткие финансовые аббревиатуры считаются раскрытым подразделом", () => {
  const doc = assemble(
    "8. Project Performance Evaluation and Risk Analysis\n\nNPV and IRR\n\nОба показателя рассчитаны для базового сценария.",
  );
  assert.ok(!doc.inserted.includes("Project Performance Evaluation and Risk Analysis → NPV and IRR"));
});

test("раздел с содержанием не получает прочерк, пустой — получает", () => {
  const doc = assemble("7. Financial Plan\n\nРасчёты приведены полностью.");
  assert.equal(doc.stats.filled, 1);
  assert.ok(doc.inserted.includes("Executive Summary"));
  assert.ok(!doc.inserted.includes("Financial Plan"));
});

test("личный вклад собирается на каждого участника по Приложению 3", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.");
  const titles = headings(doc);
  assert.ok(titles.includes("Individual Contribution: Ермошин А. А."));
  assert.ok(titles.includes("Individual Contribution: Иванов И. И."));
  assert.equal(titles.filter((title) => title === "Role in the project").length, 2);
});

test("готовый личный вклад пользователя заменяет пустой шаблон", () => {
  const source = [
    "1. Executive Summary",
    "Описание проекта.",
    "Individual Contribution",
    "Role in the project",
    "Ермошин А. А. отвечал за анализ рынка, финансовую модель и проверку источников.",
    "Personal tasks and completed work",
    "Финансовые расчёты и проверка источников выполнены лично.",
  ].join("\n\n");
  const doc = assemble(source);
  const occurrences = doc.blocks.filter((block) => block.text && block.text.includes("отвечал за анализ рынка")).length;
  assert.equal(occurrences, 1);
  assert.ok(!doc.inserted.includes("Individual Contribution"));
  const contributionSubheadings = doc.blocks.filter(
    (block) => block.type === "heading" && ["Role in the project", "Personal tasks and completed work"].includes(block.title),
  );
  assert.equal(contributionSubheadings.length, 2);
  assert.ok(contributionSubheadings.every((block) => block.number === "" && block.structural));
});

test("библиографическая запись с URL не становится подразделом восьмой главы", () => {
  const source = [
    "8. Project Performance Evaluation and Risk Analysis",
    "Project risks",
    "Риски проекта оценены.",
    "References",
    "Smith, J. (2026). Market report. https://example.com/report",
  ].join("\n\n");
  const doc = assemble(source);
  assert.ok(!doc.blocks.some((block) => block.type === "heading" && /example\.com/u.test(block.title)));
  assert.ok(doc.blocks.some((block) => block.type === "paragraph" && /example\.com/u.test(block.text)));
});

test("приложения автора остаются в конце документа", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.\n\nAppendix D. Supporting tables\n\nТаблицы модели.");
  const appendixIndex = doc.blocks.findIndex((block) => block.type === "heading" && block.kind === "appendix");
  const referencesIndex = doc.blocks.findIndex((block) => block.type === "heading" && block.title === "References");
  assert.ok(appendixIndex > referencesIndex);
});

test("оглавление вставляется полем, а не текстом", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.");
  assert.ok(doc.blocks.some((block) => block.type === "toc"));
});

test("академический профиль не навязывает восемь разделов", () => {
  const doc = builder.assemble({
    text: "Введение\n\nРабота посвящена анализу рынка.",
    profileId: "academic-report",
    metadata: METADATA,
  });
  const titles = headings(doc);
  assert.ok(!titles.includes("Production Plan"));
  assert.ok(titles.includes("Contents"));
  assert.ok(titles.includes("References"));
});

test("типографика меняет знаки, но не числа и не ссылки", () => {
  const source = 'Срок - пять лет за 2026-2030 гг. "Цитата" тут. Ссылка https://example.com/a?id=27 и 255,4 млн руб...';
  const result = typography.normalize(source);
  // Дефис между словами намеренно не повышается до длинного тире: тире —
  // самый заметный машинный признак, а разворачивать такие места умеет цикл.
  // Что он не смог развернуть, остаётся дефисом.
  assert.match(result.text, /Срок - пять лет/u);
  assert.match(result.text, /2026–2030/u);
  assert.match(result.text, /«Цитата»/u);
  assert.match(result.text, /…/u);
  assert.ok(result.text.includes("https://example.com/a?id=27"));
  assert.ok(result.text.includes("255,4"));
});

test("метрика повторяет прежние критерии: антитеза поднимает итог", () => {
  const clean = metrics.scoreText("Короткая фраза. Затем идёт заметно более длинное предложение с придаточным. И снова коротко.");
  assert.ok(clean.antithesis === 0);
  const tic = metrics.scoreText("Это не просто продукт, а решение. Рынок стабилен. Спрос растёт.");
  assert.ok(tic.antithesis >= 45);
  assert.ok(tic.score >= tic.antithesis);
});

test("числовой диапазон не считается тире-коннектором", () => {
  const ranged = metrics.scoreText("Горизонт 2026–2030 гг. Ставка 5–7 процентов. Расчёт закончен.");
  assert.equal(ranged.emDash, 0);
  const connector = metrics.scoreText("Проект — решение. Рынок — растёт. Спрос — стабилен. Команда — сильная.");
  assert.ok(connector.emDash >= 50);
});

test("незаполненными остаются только личные данные, и они перечислены", () => {
  const bare = builder.assemble({
    text: "1. Executive Summary\n\nОписание проекта.",
    profileId: "hse-business-plan",
    metadata: {},
  });
  assert.ok(bare.blanks.length > 0);
  assert.ok(bare.blanks.some((item) => /Тема проекта/u.test(item)));
  assert.ok(bare.blanks.some((item) => /Состав команды/u.test(item)));
  assert.ok(bare.blanks.some((item) => /руководитель/u.test(item)));

  const filled = assemble("1. Executive Summary\n\nОписание проекта.");
  assert.deepEqual(filled.blanks, []);
});

test("неполный участник отмечается точечно", () => {
  const doc = builder.assemble({
    text: "1. Executive Summary\n\nОписание.",
    profileId: "hse-business-plan",
    metadata: { topic: "Тема", programme: "Business Management", supervisor: "Петров П. П.", year: "2026", teamMembers: [{ name: "Ермошин А. А." }] },
  });
  assert.deepEqual(doc.blanks, ["Участник 1: номер группы"]);
});

test("количество таблиц попадает в сводку", () => {
  const doc = assemble("1. Executive Summary\n\nОписание.");
  assert.equal(doc.stats.tables, doc.blocks.filter((block) => block.type === "docTable").length);
  assert.ok(doc.stats.tables >= 10);
});

test("пользовательская TSV-таблица получает подпись, а недостающие шаблоны остаются видимыми", () => {
  const source = [
    "7. Financial Plan",
    "Revenue forecast",
    "Прогноз рассчитан на два года.",
    "Показатель\t2026\t2027\nВыручка\t10\t14",
  ].join("\n\n");
  const doc = assemble(source);
  const userTableIndex = doc.blocks.findIndex((block) => block.type === "table");
  assert.equal(doc.blocks[userTableIndex - 2].type, "caption");
  assert.equal(doc.blocks[userTableIndex - 2].title, "Operating cash flow planning");
  assert.equal(doc.blocks[userTableIndex - 1].type, "sourceNote");
  assert.ok(doc.blocks.some((block) => block.type === "docTable" && block.columns[0] === "Factor"));
  assert.equal(doc.stats.tables, doc.blocks.filter((block) => block.type === "table" || block.type === "docTable").length);
});

test("английская типографика ставит фигурные кавычки и апостроф", () => {
  const result = typography.normalize('The company\'s plan says "go" - firmly - for 2026-2030...');
  assert.equal(result.language, "en");
  assert.match(result.text, /“go”/u);
  assert.match(result.text, /company’s/u);
  assert.match(result.text, /2026–2030/u);
});

test("русская типографика ставит ёлочки", () => {
  const result = typography.normalize('План говорит "вперёд" за 2026-2030 гг.');
  assert.equal(result.language, "ru");
  assert.match(result.text, /«вперёд»/u);
});

test("метрика ловит английские штампы и английскую антитезу", () => {
  const result = metrics.scoreText(
    "It is important to note that the report delves into detail. It is not just a plan, but a roadmap. Moreover, the model is central.",
  );
  assert.equal(result.language, "en");
  assert.ok(result.cliche >= 40);
  assert.ok(result.antithesis >= 45);
});

test("оценка тире не меняется от нормализации глифов", () => {
  const source = "The plan - approved - holds. The model - ready - runs. Demand - stable - grows. Costs - fixed - stay.";
  const before = metrics.scoreText(source);
  const after = metrics.scoreText(typography.normalize(source).text);
  assert.equal(before.emDash, after.emDash);
  assert.equal(before.dashCount, after.dashCount);
});
