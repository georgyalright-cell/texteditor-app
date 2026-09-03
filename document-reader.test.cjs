"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("./document-reader.js");
const reader = globalThis.DocumentReader;

function fakeFile(name, size) {
  return {
    name,
    size: size || 16,
    arrayBuffer: async () => new ArrayBuffer(8),
  };
}

test("импорт отклоняет исходный файл больше 20 МБ", async () => {
  await assert.rejects(
    reader.readFile(fakeFile("large.txt", reader.MAX_FILE_BYTES + 1)),
    /больше допустимых 20 МБ/,
  );
});

test("ZIP-контейнер отклоняется до распаковки при объёме больше 64 МБ", async () => {
  globalThis.JSZip = {
    loadAsync: async () => ({
      files: {
        "content.xml": { _data: { uncompressedSize: reader.MAX_EXPANDED_BYTES + 1 } },
      },
    }),
  };
  await assert.rejects(reader.readFile(fakeFile("bomb.odt")), /безопасные 64 МБ/);
});

test("PDF.js запускается без eval и встроенных PDF-скриптов", async () => {
  let options = null;
  globalThis.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: (received) => {
      options = received;
      return { promise: Promise.resolve({ numPages: 0 }) };
    },
  };
  await assert.rejects(reader.readFile(fakeFile("empty.pdf")), /не найден текст/);
  assert.equal(options.isEvalSupported, false);
  assert.equal(options.enableScripting, false);
  assert.match(globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc, /vendor\/pdfjs\/pdf\.worker\.mjs/);
});

test("SheetJS вызывается с отключёнными формулами, HTML и VBA", async () => {
  let options = null;
  globalThis.XLSX = {
    read: (_buffer, received) => {
      options = received;
      return { SheetNames: ["Лист"], Sheets: { "Лист": {} } };
    },
    utils: { sheet_to_csv: () => "значение" },
  };
  assert.equal(await reader.readFile(fakeFile("table.xlsx")), "[Лист]\nзначение");
  assert.equal(options.cellFormula, false);
  assert.equal(options.cellHTML, false);
  assert.equal(options.bookVBA, false);
  assert.equal(options.bookFiles, false);
});
