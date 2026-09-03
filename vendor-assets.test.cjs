"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const hashes = {
  "transformers/transformers.web.min.mjs": "1591170143b15bc00d930e7698ff0418a9b4d2fcbeb534b22f1035aa61a5a579",
  "transformers/ort.webgpu.bundle.min.mjs": "2ec70f685749470635e64dd142c2510dc13b37bb593d9cd6ab4f8923e5204479",
  "transformers/ort-wasm-simd-threaded.asyncify.mjs": "5959c6733039619c9af710d8e1bae8d6e84402787990637be987c2b1bd6c5fa9",
  "transformers/ort-wasm-simd-threaded.asyncify.wasm": "e0c0c6d3e73d43b8a249972f8358f845b08cc16fec3c80efafdf8bed40366786",
  "webllm/web-llm.mjs": "4c89beb3ed13946e6f1ca9376f33062b5c64765c26f3ddaba045df6a13dda858",
  "webllm/Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm": "6cd9f132ad258d2017291bb62e955e337f8ae4af74650f4b1ea5a803a7cec538",
  "pdfjs/pdf.mjs": "91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d",
  "pdfjs/pdf.worker.mjs": "df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b",
  "mammoth/mammoth.browser.min.js": "e660d427ddb9aaf51cf4ca237512d0776141a58f0dfb0fd58b576721e8195e2b",
  "jszip/jszip.min.js": "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e",
  "sheetjs/xlsx.full.min.js": "cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41",
};

test("контрольные суммы локальных runtime-файлов совпадают", () => {
  for (const [relative, expected] of Object.entries(hashes)) {
    const bytes = fs.readFileSync(path.join(__dirname, "vendor", relative));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), expected, relative);
  }
});

test("production не загружает исполняемый код с внешних адресов", () => {
  const index = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const generator = fs.readFileSync(path.join(__dirname, "generator-worker.js"), "utf8");
  const scorer = fs.readFileSync(path.join(__dirname, "neural-worker.js"), "utf8");
  const webllm = fs.readFileSync(path.join(__dirname, "vendor", "webllm", "web-llm.mjs"), "utf8");
  const transformers = fs.readFileSync(
    path.join(__dirname, "vendor", "transformers", "transformers.web.min.mjs"),
    "utf8",
  );
  assert.doesNotMatch(index, /<script[^>]+src=["']https?:/iu);
  assert.doesNotMatch(`${generator}\n${scorer}`, /(?:import|importScripts)\s*\([^)]*https?:/u);
  assert.doesNotMatch(`${generator}\n${webllm}`, /(?:from|import)\s*[(']["']https?:/u);
  assert.doesNotMatch(transformers, /from["']onnxruntime-/u);
  assert.match(transformers, /from["']\.\/ort\.webgpu\.bundle\.min\.mjs["']/u);
});

test("глубокая редакция использует одну существующую кнопку и локальный генератор", () => {
  const index = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const review = fs.readFileSync(path.join(__dirname, "review-ui.js"), "utf8");
  assert.equal((index.match(/id=["']polishButton["']/gu) || []).length, 1);
  assert.match(review, /preferFresh:\s*true/u);
  assert.match(review, /share:\s*0\.35/u);
  assert.doesNotMatch(review, /perplexityScorer\(root\.NeuralScorerUI\)/u);
});
