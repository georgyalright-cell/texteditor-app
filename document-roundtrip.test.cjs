"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("./vendor/jszip/jszip.min.js");
const mammoth = require("./vendor/mammoth/mammoth.browser.min.js");
const XLSX = require("./vendor/sheetjs/xlsx.full.min.js");
const profiles = require("./format-profiles.js");
const writer = require("./docx-writer.js");

globalThis.JSZip = JSZip;
globalThis.mammoth = mammoth;
globalThis.XLSX = XLSX;
require("./document-reader.js");
const reader = globalThis.DocumentReader;

test("реальный DOCX собирается локальным JSZip и читается локальным Mammoth", async () => {
  const phrase = "Проверяемый текст итогового документа.";
  const blob = await writer.createDocxBlob(
    [{ type: "paragraph", text: phrase }],
    profiles.get("hse-business-plan"),
    JSZip,
  );
  const text = await reader.readFile({
    name: "roundtrip.docx",
    size: blob.size,
    arrayBuffer: () => blob.arrayBuffer(),
  });
  assert.match(text, new RegExp(phrase));
});

test("реальный XLSX читается обновлённым локальным SheetJS", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Показатель", "Значение"],
    ["Выручка", 125],
  ]), "План");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const text = await reader.readFile({
    name: "roundtrip.xlsx",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes,
  });
  assert.match(text, /\[План\]/u);
  assert.match(text, /Выручка\t125/u);
});
