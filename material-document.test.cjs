"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
global.DocumentImages = require("./document-images.js");
global.DocumentStructurer = require("./structurer.js");
global.EditPasses = require("./edit-passes.js");
global.AnchorGuard = require("./anchor-guard.js");
const Clipboard = require("./clipboard-document.js");
const Processing = require("./material-processing.js");
const Writer = require("./docx-writer.js");
const Builder = require("./document-builder.js");
const Profiles = require("./format-profiles.js");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";
const photo = { type: "image", dataUrl: PNG, alt: 'Chart <2026> "125"' };
const table = { type: "docTable", columns: ["Year", "Revenue"], rows: [["2026", "10\n20"]] };
const profile = Profiles.get(Profiles.defaultProfileId());

test("image codec validates PNG dimensions and never accepts a remote or SVG image", () => {
  assert.equal(DocumentImages.read(PNG).width, 1);
  for (const bad of ["https://example.com/photo.png", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,aW52YWxpZA=="]) assert.throws(() => DocumentImages.read(bad));
});
test("document image budgets bound aggregate count and decoded pixels", () => {
  assert.throws(() => DocumentImages.validate(Array(51).fill(photo)), /50/u);
  const bytes = Buffer.from(PNG.split(",")[1], "base64"); bytes.writeUInt32BE(5000, 16); bytes.writeUInt32BE(5000, 20);
  const large = { ...photo, dataUrl: "data:image/png;base64," + bytes.toString("base64") };
  assert.throws(() => DocumentImages.validate([large, large]), /40 мегапикселей/u);
});
test("missing media fails closed in both direct XML and complete DOCX export", () => {
  const blocks = [{ type: "imageMissing", alt: "Missing" }];
  assert.throws(() => Writer.buildPackage(blocks, profile), /фото/u);
  assert.throws(() => Writer.buildDocumentXml(blocks, profile), /фото/u);
});
test("DOCX embeds exact original bytes and internal image relationships", () => {
  const parts = Writer.buildPackage([photo, table, photo], profile);
  assert.deepEqual(Buffer.from(parts["word/media/image1.png"]), Buffer.from(PNG.split(",")[1], "base64"));
  assert.ok(parts["word/media/image2.png"]);
  assert.match(parts["word/_rels/document.xml.rels"], /Id="rIdImage2"[^>]*Target="media\/image2.png"/u);
  assert.doesNotMatch(parts["word/_rels/document.xml.rels"], /TargetMode="External"/u);
  assert.equal((parts["[Content_Types].xml"].match(/Extension="png"/gu) || []).length, 1);
  assert.match(parts["word/document.xml"], /Chart &lt;2026&gt; &quot;125&quot;/u);
  assert.match(parts["word/document.xml"], /10<\/w:t><w:br\/><w:t xml:space="preserve">20/u);
});
test("complete clipboard assembly preserves order and every repeated structural section", () => {
  const source = [{ type: "heading", level: 1, title: "Conclusion", kind: "section" }, photo, table,
    { type: "heading", level: 1, title: "Conclusion", kind: "section" }, { type: "paragraph", text: "Last statement." }];
  const original = structuredClone(source);
  const result = Builder.assemble({ blocks: source, preserveOrder: true, text: Clipboard.textOf(source), profileId: profile.id });
  const body = result.blocks.slice(result.blocks.findIndex((block) => block.type === "toc") + 1);
  assert.deepEqual(body.map((block) => block.type), source.map((block) => block.type));
  assert.deepEqual(body[1], photo); assert.deepEqual(body[2], table); assert.deepEqual(source, original);
  assert.ok(result.blanks.length, "missing metadata must remain visible");
});
test("Markdown input keeps headings, tables and unavailable photo positions", () => {
  const blocks = Clipboard.plain("# Executive Summary\n\nFirst sentence.\n\n| Year | Value |\n| --- | --- |\n| 2026 | 125 |\n\n![Figure](https://example.com/a.png)\n\nLast sentence.");
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "docTable", "imageMissing", "paragraph"]);
  assert.equal(blocks[2].rows[0][1], "125");
});
test("body beginning with prose or a photo starts after the contents page", () => {
  for (const first of [{ type: "paragraph", text: "Opening paragraph." }, photo]) {
    const result = Builder.assemble({ blocks: [first], preserveOrder: true, text: Clipboard.textOf([first]), profileId: profile.id });
    const toc = result.blocks.findIndex((block) => block.type === "toc");
    assert.equal(result.blocks[toc + 1].type, "pageBreak"); assert.deepEqual(result.blocks[toc + 2], first);
  }
});
test("plain and rich document limits reject oversized or irregular input", () => {
  assert.throws(() => Clipboard.plain("x".repeat(200001)), /200 000/u);
  assert.throws(() => Clipboard.validate(Array(3001).fill({ type: "paragraph", text: "x" })), /3000/u);
  assert.throws(() => Clipboard.validate([{ type: "docTable", columns: ["A", "B"], rows: [["A"]] }]), /прямоугольная/u);
  assert.throws(() => Clipboard.validate([{ type: "docTable", columns: Array(31).fill("X"), rows: [] }]), /30/u);
});
test("base processing visits all prose, preserves images/tables/headings and original input", async () => {
  const source = [{ type: "paragraph", text: "First statement." }, table, photo, { type: "paragraph", text: "Second statement." }];
  const input = structuredClone(source), visited = [];
  const result = await Processing.base(source, { process: (text) => { visited.push(text); return { text: text.replace("statement", "sentence"), warnings: [] }; }, isCurrent: () => true, progress() {} });
  assert.equal(visited.length, 2); assert.equal(result.changed, 2); assert.deepEqual(result.blocks[1], table); assert.deepEqual(result.blocks[2], photo); assert.deepEqual(source, input);
});
test("base document guard retains a paragraph if a script changes a numeric anchor", async () => {
  const source = [{ type: "paragraph", text: "The result is 125 USD." }];
  const result = await Processing.base(source, { process: () => ({ text: "The result is 250 USD." }), isCurrent: () => true, progress() {} });
  assert.deepEqual(result.blocks, source); assert.equal(result.warnings.length, 1);
});
test("base cancellation cannot return partially processed document as complete", async () => {
  let current = true;
  const result = await Processing.base([{ type: "paragraph", text: "First." }, photo], { process: (text) => ({ text }), isCurrent: () => current, progress: () => { current = false; } });
  assert.equal(result, null);
});
test("whole model queue covers prose after media with batches of at most five sentences", () => {
  const text = Array.from({ length: 12 }, (_, i) => `The company reviewed ${i + 1} regional contracts.`).join(" ");
  const job = Processing.jobs([{ type: "paragraph", text }, photo, table, { type: "paragraph", text: "A final statement." }]);
  assert.equal(job.jobs.length, 4);
  for (const piece of job.jobs) {
    assert.ok(EditPasses.sentenceSpans(piece.text, 0).length <= 5);
    assert.equal(job.text.slice(piece.offset, piece.offset + piece.text.length), piece.text);
  }
});
test("confirmed patches map to their own text blocks without shifting images or tables", () => {
  const source = [{ type: "paragraph", text: "First statement." }, photo, table, { type: "paragraph", text: "Second statement." }];
  const map = Processing.textMap(source), range = map.ranges[1];
  const result = Processing.apply(source, [{ start: range.start, end: range.end, before: "Second statement.", after: "Second sentence." }]);
  assert.equal(result[3].text, "Second sentence."); assert.deepEqual(result.slice(0, 3), source.slice(0, 3));
  assert.equal(source[3].text, "Second statement.");
});
test("patches crossing blocks, overlapping, stale or changing numbers fail closed", () => {
  const source = [{ type: "paragraph", text: "Budget 125 USD." }, photo, { type: "paragraph", text: "Final sentence." }];
  const patch = { start: 0, end: 15, before: "Budget 125 USD.", after: "Budget 250 USD." };
  assert.throws(() => Processing.apply(source, [patch]));
  assert.throws(() => Processing.apply(source, [{ ...patch, end: 25 }]));
  const valid = { start: 0, end: 15, before: "Budget 125 USD.", after: "The budget is 125 USD." };
  assert.throws(() => Processing.apply(source, [valid, valid]));
});
