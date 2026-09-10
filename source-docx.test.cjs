"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const JSZip = require("./vendor/jszip/jszip.min.js");
globalThis.JSZip = JSZip;
const source = require("./source-docx.js");
const TABLE = '<w:tbl custom="unchanged"><w:tblPr><w:tblStyle w:val="FancyTable"/><w:tblW w:w="8220" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5220"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="CDEFAB"/></w:tcPr><w:p><w:r><w:t>Forecast 2024: 125</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const PARA = '<w:p w:rsidR="00"><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>The company provides support for clients [1].</w:t></w:r></w:p>';
const END = '<w:p><w:r><w:t>The budget is 125.</w:t></w:r></w:p>';
const wrap = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
const XML = wrap(PARA + TABLE + END);
function blocks() {
  return [
    { type: "paragraph", text: "The company provides support for clients [1].", sourceChild: 0, sourceParagraph: 0 },
    { type: "docTable", sourceChild: 1, rows: [["Forecast 2024: 125"]] },
    { type: "paragraph", text: "The budget is 125.", sourceChild: 2, sourceParagraph: 2 },
  ];
}
async function packageBytes(xml = XML, additions = {}) {
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file("word/styles.xml", '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="FancyTable"/></w:styles>');
  zip.file("word/media/image1.png", new Uint8Array([1, 2, 3, 255, 0]));
  zip.file("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?a=1&amp;b=2" TargetMode="External"/></Relationships>');
  for (const [name, value] of Object.entries(additions)) zip.file(name, value);
  return zip.generateAsync({ type: "uint8array" });
}
async function input(xml = XML, additions = {}) {
  const result = blocks();
  result[0].sourceDocx = { version: 1, bytes: await packageBytes(xml, additions) };
  return result;
}
test("DOCX export changes prose only; table markup, section, styles, media and relationships remain identical", async () => {
  const data = await input();
  const original = await JSZip.loadAsync(data[0].sourceDocx.bytes);
  data[0].text = "The company supports clients [1].";
  const blob = await source.write(data), edited = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await edited.file("word/document.xml").async("text");
  assert.ok(xml.includes(TABLE));
  assert.ok(xml.includes(END));
  assert.ok(xml.includes('<w:rPr><w:b/><w:color w:val="123456"/></w:rPr>'));
  assert.ok(xml.includes('<w:pPr><w:spacing w:after="200"/></w:pPr>'));
  assert.ok(xml.includes("The company supports clients [1]."));
  assert.equal(xml.slice(xml.indexOf("<w:sectPr")), XML.slice(XML.indexOf("<w:sectPr")));
  for (const name of Object.keys(original.files).filter(name => !original.files[name].dir && name !== "word/document.xml")) {
    assert.deepEqual(await edited.file(name).async("uint8array"), await original.file(name).async("uint8array"));
  }
});
test("DOCX no-op returns original package bytes, not a regenerated ZIP", async () => {
  const data = await input(), blob = await source.write(data);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), data[0].sourceDocx.bytes);
});
test("DOCX validates citations/numbers against original XML, not mutable block metadata", () => {
  const data = blocks(); data[0].text = "The company supports clients [2]."; data[0].sourceText = data[0].text;
  assert.throws(() => source.patch(XML, data), /ссылки|числовые/);
  data[0].text = blocks()[0].text; data[2].text = "The budget is 126.";
  assert.throws(() => source.patch(XML, data), /ссылки|числовые/);
});
test("DOCX refuses missing, duplicate, reordered or forged paragraph bindings", () => {
  assert.throws(() => source.patch(XML, blocks().slice(1)), /Состав/);
  let data = blocks(); data[2].sourceChild = 0;
  assert.throws(() => source.patch(XML, data), /Порядок/);
  data = blocks(); data[0].sourceParagraph = 2;
  assert.throws(() => source.patch(XML, data), /привязка/);
  data = blocks(); [data[0], data[1]] = [data[1], data[0]];
  assert.throws(() => source.patch(XML, data), /Порядок/);
});
test("DOCX does not rewrite paragraphs with hyperlink relationships, bookmarks or field instructions", () => {
  for (const inner of [
    '<w:hyperlink r:id="rId1"><w:r><w:t>The company provides support for clients [1].</w:t></w:r></w:hyperlink>',
    '<w:bookmarkStart w:id="1" w:name="ref"/><w:r><w:t>The company provides support for clients [1].</w:t></w:r>',
    '<w:r><w:instrText>PAGE</w:instrText><w:t>The company provides support for clients [1].</w:t></w:r>',
  ]) {
    const xml = wrap('<w:p>' + inner + '</w:p>' + TABLE + END), data = blocks();
    assert.equal(source.patch(xml, data), xml);
    data[0].text = "The company supports clients [1].";
    assert.throws(() => source.patch(xml, data), /Защищённый/);
  }
});
test("DOCX patches only exact top-level paragraph ranges and escapes edited XML text", () => {
  const xml = wrap(PARA.replace('<w:p w:rsidR="00">', '<w:p w:rsidR="00" custom="a &gt; b">') + '<!-- <w:p>ignored</w:p> -->' + TABLE + END);
  const data = blocks(); data[0].text = "The company supports clients [1] & peers <directly>.";
  const out = source.patch(xml, data);
  assert.ok(out.includes(TABLE)); assert.ok(out.includes("&amp; peers &lt;directly&gt;"));
  assert.ok(out.includes('custom="a &gt; b"'));
});
test("DOCX rejects XML declarations/entities, malformed XML, and invalid output control characters", () => {
  for (const xml of ['<!DOCTYPE a [<!ENTITY b "x">]>' + XML, XML.replace('</w:body>', '</w:wrong>'), XML.replace('</w:document>', '')]) {
    assert.throws(() => source.patch(xml, blocks()), /XML/);
  }
  const data = blocks(); data[0].text += "\u0001";
  assert.throws(() => source.patch(XML, data), /управляющие/);
});
test("DOCX rejects active packages/external resources but allows normal hyperlink relationships", async () => {
  for (const additions of [
    { "word/vbaProject.bin": "macro" },
    { "word/embeddings/oleObject1.bin": "object" },
    { "word/_rels/settings.xml.rels": '<Relationships><Relationship Type="x/attachedTemplate" Target="https://example.com/template.dotm" TargetMode="External"/></Relationships>' },
    { "word/_rels/document.xml.rels": '<Relationships><Relationship Type="x/image" Target="https://example.com/image.png" TargetMode="External"/></Relationships>' },
    { "word/settings.xml": '<settings><instrText>DDEAUTO remote</instrText></settings>' },
  ]) await assert.rejects(source.write(await input(XML, additions)), /макрос|вложенн|внешние|Активное|активные/);
  await source.write(await input());
});
test("DOCX zip compressed size and expanded size have bounded limits", async () => {
  const data = blocks(); data[0].sourceDocx = { version: 1, bytes: new Uint8Array(source.MAX_BYTES + 1) };
  await assert.rejects(source.write(data), /20 МБ/);
  const actual = globalThis.JSZip;
  try {
    globalThis.JSZip = { loadAsync: async () => ({ files: { huge: { name: "huge", _data: { uncompressedSize: source.MAX_EXPANDED + 1 } } } }) };
    data[0].sourceDocx.bytes = new Uint8Array([1]);
    await assert.rejects(source.write(data), /64 МБ/);
  } finally { globalThis.JSZip = actual; }
});

test("DOCX preserves manual page/column breaks and mixed run formatting by protecting the paragraph", () => {
  for (const type of ["page", "column"]) {
    const xml = wrap(`<w:p><w:r><w:t>The company provides support</w:t><w:br w:type="${type}"/><w:t>for clients [1].</w:t></w:r></w:p>` + TABLE + END);
    const data = blocks(); data[0].text = "The company provides support\nfor clients [1].";
    assert.equal(source.patch(xml, data), xml);
    data[0].text = "The company supports\nclients [1].";
    assert.throws(() => source.patch(xml, data), /Защищённый/);
  }
  const xml = wrap('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>The company </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>provides support for clients [1].</w:t></w:r></w:p>' + TABLE + END);
  assert.equal(source.patch(xml, blocks()), xml);
  const data = blocks(); data[0].text = "The company supports clients [1].";
  assert.throws(() => source.patch(xml, data), /Защищённый/);
});

// Minimal DOM-shaped adapter for the read contract; the real browser XML parser
// is covered by the browser import/export QA, not simulated by this adapter.
class FixtureParser {
  parseFromString(xml) {
    const convert = node => {
      const result = {
        localName: node.local, nodeType: 1,
        getAttribute(name) { return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`).exec(xml.slice(node.start, node.openEnd))?.[2] || ""; },
        getAttributeNS(_namespace, name) { return this.getAttribute("w:" + name) || this.getAttribute(name); },
        getElementsByTagNameNS(_namespace, name) { return this.childNodes.flatMap(child => [...(child.localName === name ? [child] : []), ...child.getElementsByTagNameNS(_namespace, name)]); },
      };
      result.childNodes = node.children.map(convert); return result;
    };
    const documentElement = convert(source.scan(xml));
    return { documentElement, getElementsByTagName: () => [], getElementsByTagNameNS: (...args) => documentElement.getElementsByTagNameNS(...args) };
  }
}
test("DOCX read supplies heading title, original paragraph snapshot and an unchanged-source fallback for complex tables", async () => {
  const Parser = globalThis.DOMParser, Table = globalThis.TableDocx;
  try {
    globalThis.DOMParser = FixtureParser;
    globalThis.TableDocx = { readTable() { throw new Error("Unsupported nested table"); } };
    const heading = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Business plan</w:t></w:r></w:p>';
    const bytes = await packageBytes(wrap(heading + TABLE + END));
    const result = await source.read({ size: bytes.length, arrayBuffer: async () => bytes });
    assert.equal(result.blocks[0].type, "heading");
    assert.equal(result.blocks[0].title, "Business plan");
    assert.equal(result.blocks[0].text, "Business plan");
    assert.equal(result.blocks[1].type, "sourceNote");
    assert.equal(result.blocks[1].sourceChild, 1);
    assert.match(result.blocks[1].text, /Сложная таблица сохранена/);
    assert.equal(result.warnings.filter(message => /Сложные таблицы/.test(message)).length, 1);
    assert.deepEqual(result.blocks[0].sourceDocx.paragraphTexts, [{ sourceChild: 0, text: "Business plan" }, { sourceChild: 2, text: "The budget is 125." }]);
    assert.equal(source.integrity(result.blocks).ok, true);
    assert.deepEqual(new Uint8Array(await (await source.write(result.blocks)).arrayBuffer()), bytes);
  } finally { globalThis.DOMParser = Parser; globalThis.TableDocx = Table; }
});

test("DOCX fast integrity checks all source paragraphs including headings, not editable prose alone", () => {
  const data = [
    { type: "heading", text: "2024", title: "2024", sourceChild: 0, sourceParagraph: 0 },
    { type: "paragraph", text: "Year-end reports guide the company in planning its budget.", sourceChild: 1, sourceParagraph: 1 },
  ];
  data[0].sourceDocx = { version: 1, paragraphTexts: data.map(block => ({ sourceChild: block.sourceChild, text: block.text })) };
  assert.equal(source.integrity(data).ok, true);
  const before = data[1].text;
  data[1].text = "The company uses year-end reports to plan its budget.";
  assert.equal(require("./anchor-guard.js").compare(before, data[1].text).ok, true);
  assert.equal(source.integrity(data).ok, false);
  assert.equal(source.integrity([{ type: "paragraph", text: "Plain document." }]).ok, true);
  assert.equal(source.integrity([{ ...data[0], sourceDocx: { version: 1 } }, data[1]]).ok, false);
});

test("DOCX rejects active field instructions split across runs or encoded in XML", async () => {
  for (const pieces of [["DD", "EAUTO cmd /c calc"], ["INCLUDE", "TEXT https://example.com/source"], ["D&#68;", "EAUTO cmd /c calc"]]) {
    const field = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' + pieces.map(piece => `<w:r><w:instrText>${piece}</w:instrText></w:r>`).join("") + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    await assert.rejects(source.write(await input(wrap(field + TABLE + END))), /активные поля/);
    const preceding = '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    await assert.rejects(source.write(await input(wrap(preceding + field + TABLE + END))), /активные поля/);
  }
});
test('manual line breaks and tab-aligned prose cannot be flattened by rewriting',async()=>{
  for(const mark of ['<w:br/>','<w:cr/>','<w:tab/>']) {
    const xml=wrap('<w:p><w:r><w:t>First line.</w:t>'+mark+'<w:t>Second line.</w:t></w:r></w:p>'+TABLE+END);
    const data=await input(xml);data[0].text='First line. Second line.';
    await assert.rejects(source.write(data),/Защищённый абзац/);
  }
});
test('excessive XML depth fails before recursive processing',()=>{
  assert.throws(()=>source.scan('<x>'.repeat(150)+'</x>'.repeat(150)),/слишком сложен/);
});
