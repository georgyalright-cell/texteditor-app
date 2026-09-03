"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const projects = require("./work-project.js");

function completeMetadata() {
  return {
    topic: "Локализация производства беспилотников",
    goal: "Оценить коммерческую целесообразность проекта",
    object: "Производственная компания",
    scope: "Россия, 2026–2030 годы",
    methods: "Анализ рынка, сценарное моделирование и DCF",
    programme: "Business Management",
    team: "Ермошин А. А., БМ-201",
    supervisor: "Петров П. П.",
    year: "2026",
  };
}

test("новый проект создаётся локально и без содержательных частей", () => {
  const project = projects.create("hse-business-plan");
  assert.equal(project.profileId, "hse-business-plan");
  assert.deepEqual(project.parts, []);
  assert.equal(projects.readiness(project).ready, false);
});

test("часть добавляется в выбранный раздел и не меняет исходный проект", () => {
  const original = projects.create("hse-business-plan");
  const next = projects.addPart(original, {
    sectionId: "financial",
    title: "Финансовая модель",
    text: "Выручка проекта рассчитана для трёх сценариев и пятилетнего горизонта.",
  });
  assert.equal(original.parts.length, 0);
  assert.equal(next.parts.length, 1);
  assert.equal(next.parts[0].sectionId, "financial");
});

test("добавленную часть можно перенести в другой раздел", () => {
  let project = projects.create("hse-business-plan");
  project = projects.addPart(project, { sectionId: "financial", text: "Финансовые исходные данные" });
  const moved = projects.movePart(project, project.parts[0].id, "marketing-sales");
  assert.equal(project.parts[0].sectionId, "financial");
  assert.equal(moved.parts[0].sectionId, "marketing-sales");
  assert.throws(() => projects.movePart(moved, moved.parts[0].id, "missing-section"), /неизвестный раздел/u);
});

test("раздел определяется по явному названию в тексте", () => {
  assert.equal(projects.inferSection("Financial Plan\n\nRevenue forecast", "hse-business-plan"), "financial");
  assert.equal(projects.inferSection("Заключение\n\nРезультаты подтверждены.", "hse-business-plan"), "conclusion");
});

test("сборка располагает части в каноническом порядке", () => {
  let project = projects.updateMetadata(projects.create("hse-business-plan"), completeMetadata());
  project = projects.addPart(project, { sectionId: "financial", text: "F".repeat(180) });
  project = projects.addPart(project, { sectionId: "executive-summary", text: "E".repeat(180) });
  project = projects.addPart(project, { sectionId: "references", text: "https://example.com " + "R".repeat(180) });
  const source = projects.buildSource(project);
  assert.ok(source.indexOf("Executive Summary") < source.indexOf("Financial Plan"));
  assert.ok(source.includes("Project goal: Оценить коммерческую целесообразность проекта"));
  assert.match(source, /Project context: Project goal:/u);
  assert.ok(source.indexOf("Financial Plan") < source.indexOf("References"));
});

test("источники превращаются в список и не маскируются под заголовки", () => {
  let project = projects.create("hse-business-plan");
  project = projects.addPart(project, {
    sectionId: "references",
    text: "Smith, J. (2026). Market report. https://example.com/report\n\nOECD. (2025). Outlook. https://example.com/outlook",
  });
  const source = projects.buildSource(project);
  assert.match(source, /\n1\. Smith, J\./u);
  assert.match(source, /\n2\. OECD\./u);
});

test("готовность требует паспорт, все разделы, заключение и настоящие источники", () => {
  let project = projects.updateMetadata(projects.create("hse-business-plan"), completeMetadata());
  for (const section of projects.sections(project.profileId).filter((item) => !item.optional)) {
    const requiredTables = ({
      "executive-summary": 1,
      "business-outline": 4,
      "marketing-sales": 2,
      organization: 2,
      production: 2,
      investment: 1,
      financial: 2,
    })[section.id] || 0;
    const tables = Array.from({ length: requiredTables }, (_unused, index) =>
      `Показатель ${index + 1}\tЗначение\nВыручка\t${index + 10}`,
    ).join("\n\n");
    const coverage = (section.subsections || []).map((subsection) => `${subsection}. Подтверждённые данные раздела.`).join("\n\n");
    const prose = section.id === "references"
      ? `https://example.com/${section.id} ${"R".repeat(180)}`
      : [coverage, "T".repeat(180)].filter(Boolean).join("\n\n");
    const text = [prose, tables].filter(Boolean).join("\n\n");
    project = projects.addPart(project, { sectionId: section.id, text });
  }
  const report = projects.readiness(project);
  assert.equal(report.ready, true);
  assert.equal(report.missing.length, 0);
});

test("готовность считает табличные блоки с реальными ячейками", () => {
  assert.equal(projects.tableCount("Год\tВыручка\n2025\t10\n\nГод\tРасходы\n2025\t7"), 2);
  assert.equal(projects.tableCount("Обычный абзац без табуляции."), 0);
  assert.equal(projects.tableCount("Показатель\tЗначение\nВыручка\t\nРасходы\t"), 0);
});

test("название добавленной части участвует в проверке обязательного подраздела", () => {
  let project = projects.create("hse-business-plan");
  project = projects.addPart(project, {
    sectionId: "financial",
    title: "Revenue forecast",
    text: "Выручка рассчитана по объёму продаж и средней цене. ".repeat(5),
  });
  const financial = projects.readiness(project).items.find((item) => item.id === "section-financial");
  assert.match(financial.detail, /Operating costs forecast/u);
  assert.ok(!financial.detail.includes("Revenue forecast"));
});

test("нераспределённая часть блокирует готовность", () => {
  let project = projects.updateMetadata(projects.create("academic-report"), completeMetadata());
  project = projects.addPart(project, { sectionId: "unassigned", text: "Неопределённый материал достаточной длины. ".repeat(5) });
  assert.ok(projects.readiness(project).missing.some((item) => item.id === "unassigned"));
});

test("каждый незаполненный пункт готовности ведёт к месту заполнения", () => {
  const report = projects.readiness(projects.create("hse-business-plan"));
  assert.ok(report.missing.length > 0);
  assert.ok(report.missing.every((item) => item.target && item.target.type));
});

test("повреждённое сохранение очищается без падения", () => {
  const project = projects.sanitize({ profileId: "academic-report", metadata: null, parts: [null, { text: "" }], unexpected: "ignored" });
  assert.equal(project.profileId, "academic-report");
  assert.deepEqual(project.parts, []);
  assert.deepEqual(Object.keys(project.metadata).sort(), ["goal", "methods", "object", "programme", "scope", "supervisor", "team", "topic", "year"]);
  assert.equal(projects.sanitize({ profileId: "unknown-profile" }).profileId, "hse-business-plan");
});

test("при смене формата части не пропадают незаметно", () => {
  let project = projects.create("hse-business-plan");
  project = projects.addPart(project, { sectionId: "financial", text: "Специальный материал без явного названия раздела. ".repeat(4) });
  project = projects.setProfile(project, "academic-report");
  assert.equal(project.parts.length, 1);
  assert.equal(project.parts[0].sectionId, "unassigned");
  assert.ok(projects.readiness(project).missing.some((item) => item.id === "unassigned"));
});
