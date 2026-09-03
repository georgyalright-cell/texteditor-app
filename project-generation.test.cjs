"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const projects = require("./work-project.js");
const profiles = require("./format-profiles.js");
const processor = require("./processor.js");
const paraphraser = require("./paraphraser.js");
const typography = require("./typography.js");
const structurer = require("./structurer.js");
const builder = require("./document-builder.js");
const writer = require("./docx-writer.js");

function completeProject() {
  let project = projects.updateMetadata(projects.create("hse-business-plan"), {
    topic: "Локализация производства беспилотников",
    goal: "Оценить коммерческую целесообразность проекта",
    object: "Производственная компания",
    scope: "Россия, 2026–2030 годы",
    methods: "Анализ рынка, сценарное моделирование и DCF",
    programme: "Business Management",
    team: "Ермошин А. А., БМ-201",
    supervisor: "к.э.н., доцент, Петров П. П.",
    year: "2026",
  });

  const profile = profiles.get(project.profileId);
  for (const section of projects.sections(project.profileId).filter((item) => !item.optional)) {
    const profileSection = profile.requiredSections.find((item) => item.id === section.id);
    const paragraphs = (section.subsections || []).map(
      (subsection) => `${subsection}\n\n${`The analysis documents the evidence, assumptions, result, and limitation for ${subsection}. `.repeat(4)}`,
    );
    const tables = (profileSection && profileSection.tables ? profileSection.tables : []).map(
      (_template, index) => `Indicator\t2026\t2027\nRevenue ${index + 1}\t${10 + index}\t${14 + index}`,
    );
    let text = [...paragraphs, ...tables].join("\n\n");
    if (section.id === "conclusion") text = "The calculations support the base scenario, while the sensitivity analysis defines the decision limits. ".repeat(3);
    if (section.id === "references") text = `Smith, J. (2026). Market report. https://example.com/report\n\n${"The source provides the market assumptions used in the calculations. ".repeat(3)}`;
    project = projects.addPart(project, { sectionId: section.id, text });
  }
  return project;
}

function runExistingTextPipeline(text, profileId) {
  const cleaned = processor.processText(text);
  const paraphrased = paraphraser.paraphraseText(cleaned.text);
  const typeset = typography.normalize(paraphrased.text);
  return structurer.applyProfile(typeset.text, profileId, { placeholders: false });
}

test("полный локальный контур собирает готовую работу без пустых мест", () => {
  const project = completeProject();
  const readiness = projects.readiness(project);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);

  const processed = runExistingTextPipeline(projects.buildSource(project), project.profileId);
  const document = builder.assemble({
    text: processed.text,
    profileId: project.profileId,
    metadata: projects.toBuilderMetadata(project),
  });

  assert.equal(document.stats.filled, 8);
  assert.equal(document.stats.tables, 14);
  assert.deepEqual(document.inserted, []);
  assert.deepEqual(document.blanks, []);
  assert.equal(document.blocks.filter((block) => block.placeholder).length, 0);
  assert.equal(document.blocks.filter((block) => block.type === "caption" && block.kind === "table").length, 14);
  assert.ok(!document.blocks.some((block) => block.type === "heading" && /^Project context/u.test(block.title)));
  assert.ok(
    document.blocks
      .filter((block) => block.type === "heading" && ["Role in the project", "Personal tasks and completed work", "Artefacts and references", "Conclusions on one's part"].includes(block.title))
      .every((block) => block.number === "" && block.structural),
  );

  const xml = writer.buildDocumentXml(document.blocks, document.profile);
  assert.equal([...xml.matchAll(/<w:tbl>/gu)].length, 14);
  assert.ok(!xml.includes(`<w:t xml:space="preserve">${builder.PLACEHOLDER_MARK}</w:t>`));
  for (const anchor of ["2026–2030", "https://example.com/report", "14"]) assert.ok(xml.includes(anchor));
});
