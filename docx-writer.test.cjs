"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const writer = require("./docx-writer.js");
const structurer = require("./structurer.js");
const profiles = require("./format-profiles.js");

const PROFILE = profiles.get("hse-business-plan");

function documentXml(source) {
  const outcome = structurer.applyProfile(source, "hse-business-plan");
  return writer.buildDocumentXml(outcome.blocks, outcome.profile);
}

test("поля страницы соответствуют §5.1: 2/2/3/1.5 см", () => {
  const xml = writer.buildDocumentXml([], PROFILE);
  assert.match(xml, /w:top="1134"/u);
  assert.match(xml, /w:bottom="1134"/u);
  assert.match(xml, /w:left="1701"/u);
  assert.match(xml, /w:right="850"/u);
});

test("страница A4 в твипах", () => {
  const xml = writer.buildDocumentXml([], PROFILE);
  assert.match(xml, /<w:pgSz w:w="11906" w:h="16838"\/>/u);
});

test("шрифт Times New Roman 12 pt задан и в docDefaults, и в стиле Normal", () => {
  const styles = writer.buildStylesXml(PROFILE);
  assert.equal([...styles.matchAll(/w:ascii="Times New Roman"/gu)].length, 2);
  assert.equal([...styles.matchAll(/<w:sz w:val="24"\/>/gu)].length, 2);
  const normal = styles.slice(styles.indexOf('w:styleId="Normal"'), styles.indexOf('w:styleId="SectionHeading"'));
  assert.match(normal, /w:ascii="Times New Roman"/u);
});

test("интервал 1.15 и отступ 1.25 см заданы по умолчанию", () => {
  const styles = writer.buildStylesXml(PROFILE);
  assert.match(styles, /w:line="276" w:lineRule="auto"/u);
  assert.match(styles, /<w:ind w:firstLine="709"\/>/u);
  assert.match(styles, /<w:jc w:val="both"\/>/u);
});

test("нумерация страниц идёт полем PAGE по центру и минует титул", () => {
  const footer = writer.buildFooterXml(PROFILE);
  assert.match(footer, /<w:jc w:val="center"\/>/u);
  assert.match(footer, /PAGE/u);
  const xml = writer.buildDocumentXml([], PROFILE);
  assert.match(xml, /<w:titlePg\/>/u);
  assert.match(xml, /<w:footerReference w:type="default" r:id="rId2"\/>/u);
});

test("заголовок раздела центрируется, без отступа и заглавными", () => {
  const xml = documentXml("1. Executive Summary\n\nТекст раздела о проекте.");
  assert.match(xml, /<w:t xml:space="preserve">1\. EXECUTIVE SUMMARY<\/w:t>/u);
  assert.match(xml, /<w:pStyle w:val="SectionHeading"\/>/u);
});

test("первый блок документа не получает разрыв страницы, последующие разделы получают", () => {
  const blocks = [
    { type: "heading", kind: "section", level: 1, number: "1", title: "Первый" },
    { type: "paragraph", text: "Текст первого раздела." },
    { type: "heading", kind: "section", level: 1, number: "2", title: "Второй" },
    { type: "paragraph", text: "Текст второго раздела." },
  ];
  const xml = writer.buildDocumentXml(blocks, PROFILE);
  const beforeFirstHeading = xml.slice(0, xml.indexOf("ПЕРВЫЙ"));
  assert.ok(!beforeFirstHeading.includes("<w:pageBreakBefore/>"));
  assert.equal([...xml.matchAll(/<w:pageBreakBefore\/>/gu)].length, 1);
});

test("подраздел второго уровня разрыв страницы не получает", () => {
  const blocks = [
    { type: "heading", kind: "section", level: 1, number: "1", title: "Первый" },
    { type: "heading", kind: "section", level: 2, number: "1.1", title: "Подраздел" },
  ];
  const xml = writer.buildDocumentXml(blocks, PROFILE);
  assert.equal([...xml.matchAll(/<w:pageBreakBefore\/>/gu)].length, 0);
  assert.match(xml, /<w:pStyle w:val="SubsectionHeading"\/>/u);
});

test("подпись к таблице выравнивается вправо, к рисунку — по центру", () => {
  const outcome = structurer.applyProfile(
    "Таблица 1. Допущения\n\nТекст про Table 1 и Figure 1.\n\nРисунок 1. Схема",
    "hse-business-plan",
  );
  const xml = writer.buildDocumentXml(outcome.blocks, outcome.profile);
  const tableIndex = xml.indexOf("Table 1. Допущения");
  const figureIndex = xml.indexOf("Figure 1. Схема");
  assert.ok(tableIndex > -1 && figureIndex > -1);
  assert.match(xml.slice(0, tableIndex).split("<w:p>").pop(), /<w:jc w:val="right"\/>/u);
  assert.match(xml.slice(0, figureIndex).split("<w:p>").pop(), /<w:jc w:val="center"\/>/u);
});

test("спецсимволы экранируются и не ломают XML", () => {
  const xml = documentXml('1. Обзор\n\nСравнение «A & B» с тегом <tag> и кавычкой "цитата".');
  assert.match(xml, /&amp;/u);
  assert.match(xml, /&lt;tag&gt;/u);
  assert.ok(!/<tag>/u.test(xml));
});

test("пакет содержит все обязательные части OOXML", () => {
  const parts = writer.buildPackage([], PROFILE);
  assert.deepEqual(Object.keys(parts).sort(), [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/_rels/document.xml.rels",
    "word/document.xml",
    "word/footer1.xml",
    "word/settings.xml",
    "word/styles.xml",
  ]);
  for (const content of Object.values(parts)) {
    assert.match(content, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/u);
  }
});

test("прочерк недостающего раздела попадает в документ отдельным абзацем", () => {
  const xml = documentXml("1. Executive Summary\n\nОписание проекта.");
  // Вставленный раздел получает номер по общей нумерации §2.1.
  assert.match(xml, /<w:t xml:space="preserve">5\. PRODUCTION PLAN<\/w:t>/u);
  assert.match(xml, /<w:t xml:space="preserve">—<\/w:t>/u);
  // Структурные части из §3.1 нумерации не получают.
  assert.match(xml, /<w:t xml:space="preserve">REFERENCES<\/w:t>/u);
});

test("профиль академического отчёта даёт то же оформление страницы", () => {
  const academic = profiles.get("academic-report");
  assert.equal(writer.buildStylesXml(academic), writer.buildStylesXml(PROFILE));
});

test("settings.xml просит Word обновить поля при открытии", () => {
  assert.match(writer.buildSettingsXml(), /<w:updateFields w:val="true"\/>/u);
});

test("заголовки получают уровень структуры, иначе оглавление соберётся пустым", () => {
  const blocks = [
    { type: "heading", kind: "section", level: 1, number: "1", title: "Раздел" },
    { type: "heading", kind: "section", level: 2, number: "1.1", title: "Подраздел" },
  ];
  const xml = writer.buildDocumentXml(blocks, PROFILE);
  assert.match(xml, /<w:outlineLvl w:val="0"\/>/u);
  assert.match(xml, /<w:outlineLvl w:val="1"\/>/u);
});

test("поле TOC вставляется как поле Word", () => {
  const xml = writer.buildDocumentXml([{ type: "toc" }], PROFILE);
  assert.match(xml, /TOC/u);
  assert.match(xml, /w:fldCharType="begin"/u);
});

test("шаблонная таблица рендерится настоящей таблицей Word с повторяемой шапкой", () => {
  const block = { type: "docTable", columns: ["Factor", "Period 0", "Period 1"], rows: ["Revenues", "Costs"] };
  const xml = writer.buildDocumentXml([block], PROFILE);
  assert.match(xml, /<w:tbl>/u);
  assert.match(xml, /<w:tblHeader\/>/u);
  assert.equal([...xml.matchAll(/<w:tr>/gu)].length, 3);
  assert.equal([...xml.matchAll(/<w:gridCol/gu)].length, 3);
  assert.match(xml, /<w:t xml:space="preserve">Revenues<\/w:t>/u);
});

test("таблица из вставленного TSV сохраняет все ячейки как настоящую таблицу Word", () => {
  const blocks = structurer.parseDocument("Показатель\t2025\t2026\nВыручка\t10.5\t14.2\nРасходы\t7.1\t8.4");
  const xml = writer.buildDocumentXml(blocks, PROFILE);
  assert.match(xml, /<w:tbl>/u);
  assert.equal([...xml.matchAll(/<w:tr>/gu)].length, 3);
  for (const value of ["Показатель", "2025", "Выручка", "10.5", "Расходы", "8.4"]) {
    assert.match(xml, new RegExp(`<w:t xml:space="preserve">${value.replace(".", "\\.")}</w:t>`, "u"));
  }
  assert.match(xml, /<w:tblCellMar>/u);
  assert.match(xml, /<w:vAlign w:val="center"\/>/u);
});

test("широкая пользовательская таблица не получает отрицательные размеры столбцов", () => {
  const headings = Array.from({ length: 24 }, (_unused, index) => `C${index + 1}`).join("\t");
  const values = Array.from({ length: 24 }, (_unused, index) => String(index + 1)).join("\t");
  const blocks = structurer.parseDocument(`${headings}\n${values}`);
  const xml = writer.buildDocumentXml(blocks, PROFILE);
  const widths = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/gu)].map((match) => Number(match[1]));
  assert.equal(widths.length, 24);
  assert.ok(widths.every((width) => width > 0));
  assert.equal(widths.reduce((sum, width) => sum + width, 0), profiles.mmToTwips(165));
});

test("две соседние таблицы разделяются пустым абзацем без лишнего абзаца после последней", () => {
  const block = { type: "table", lines: ["A\tB", "1\t2"] };
  const xml = writer.buildDocumentXml([block, block], PROFILE);
  assert.match(xml, /<\/w:tbl><w:p><w:pPr>.*?<\/w:p><w:tbl>/u);
  assert.match(xml, /<\/w:tbl><w:sectPr>/u);
});

test("порядок свойств абзаца соответствует схеме OOXML", () => {
  const xml = writer.buildDocumentXml(
    [{ type: "heading", kind: "section", level: 1, number: "1", title: "Раздел" }],
    PROFILE,
  );
  const properties = xml.slice(xml.indexOf("<w:pPr>"), xml.indexOf("</w:pPr>"));
  const order = ["<w:pStyle", "<w:spacing", "<w:ind", "<w:jc", "<w:outlineLvl"]
    .map((tag) => properties.indexOf(tag))
    .filter((index) => index !== -1);
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
});
