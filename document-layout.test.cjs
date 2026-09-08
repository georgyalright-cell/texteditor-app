const test = require("node:test"), assert = require("node:assert/strict");
const layout = require("./document-layout.js"), profiles = require("./format-profiles.js");
const writer = require("./docx-writer.js"), builder = require("./document-builder.js");
const profile = profiles.get("hse-business-plan");
const p = (text) => ({ type: "paragraph", text });
const table = () => ({ type: "docTable", columns: ["Year", "USD"], rows: [["2026", "125"]] });
const heading = (title) => ({ type: "heading", title, level: 1, kind: "section" });

test("caption recognition excludes reference sentences; semantic HTML captions may be unnumbered", () => {
  for (const text of ["Table 2 shows the budget.", "Рисунок 1 показывает рост.", "Table 2026 growth"]) assert.equal(layout.caption(text), null);
  assert.equal(layout.caption("Table 2. Budget").number, "2");
  assert.equal(layout.caption("Рисунок 1.2 — Рост").kind, "figure");
  assert.equal(layout.caption("Budget", "table").title, "Budget");
});
test("numbered media and source move together after the first explicit reference, not across headings", () => {
  const input = [heading("Budget"), p("See Table 7 for the amounts."), p("Interpretation."), p("Table 7. Budget"), table(), p("Source: Audit 2026."), heading("Next")];
  const before = JSON.stringify(input), result = layout.arrange(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.blocks.map((b) => b.type), ["heading", "paragraph", "caption", "docTable", "sourceNote", "paragraph", "heading"]);
  assert.equal(result.blocks[2].number, "7"); assert.equal(result.moved, 1);
  assert.equal(result.blocks[4].text, "Source: Audit 2026.");
  const other = layout.arrange([p("See Table 7."), heading("Other"), p("Text."), p("Table 7. Budget"), table()]);
  assert.equal(other.moved, 0);
});
test("missing and duplicate references preserve source order", () => {
  assert.equal(layout.arrange([p("Text."), p("Table 2. Budget"), table()]).moved, 0);
  const result = layout.arrange([p("See Table 2."), p("Interpretation."), p("Table 2. A"), table(), p("Table 2. B"), table()]);
  assert.equal(result.moved, 0); assert.match(result.warnings.join(), /Повторяющиеся/);
});
test("reference labels are exact, bilingual and not substrings of words or numbers", () => {
  assert.deepEqual(layout.references("Stable 2; MyTable 2; Table 12; Figure 1.2; в таблице 3; на рисунке 4."), ["table:12", "figure:1.2", "table:3", "figure:4"]);
  assert.deepEqual(layout.references("Figure 1.2a; Table 2.1a; Figure 1a; Table 12_3; Table 7. End."), ["table:7"]);
});
test("directional references do not become false after automatic placement", () => {
  const result = layout.arrange([p("Table 7. Budget"),table(),p("The figures in Table 7 above explain this result.")]);
  assert.equal(result.moved,0); assert.match(result.warnings.join(),/расположения/);
  const later=layout.arrange([p("Table 7 summarises costs."),p("See Table 7 below."),p("Table 7. Budget"),table()]);
  assert.equal(later.moved,0);assert.match(later.warnings.join(),/расположения/);
});
test("explicit semantic figure ownership wins over adjacent unrelated image", () => {
  const a={type:"imageMissing",alt:"A"},b={type:"imageMissing",alt:"B",layoutOwner:2};
  const blocks=[a,{...layout.caption("Figure 2. Caption B"),layoutOwner:2},b];
  const result=layout.present(blocks,profile);
  assert.deepEqual(result.filter(b=>b.type==="caption").map(b=>[b.number,b.title]),[["1",""],["2","Caption B"]]);
  assert.equal(result[2].alt,"B");
});
test("recognized captions and source notes are excluded from prose processing and model jobs", async () => {
  global.AnchorGuard=require("./anchor-guard.js");global.EditPasses=require("./edit-passes.js");
  const processing=require("./material-processing.js"), visited=[];
  const blocks=layout.prepare([p("See Table 7 for the figures."),p("Table 7. Budget"),table(),p("Source: report 2026.")]);
  await processing.base(blocks,{process:text=>{visited.push(text);return {text}},isCurrent:()=>true,progress(){}});
  assert.deepEqual(visited,["See Table 7 for the figures."]);assert.equal(processing.jobs(blocks).text,visited[0]);
});
test("image paragraph stays with its caption, original proportions and bounded height remain", () => {
  const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=","base64");
  bytes.writeUInt32BE(800,16);bytes.writeUInt32BE(3000,20);
  const image={type:"image",dataUrl:"data:image/png;base64,"+bytes.toString("base64"),alt:"Exact alt",layoutTitle:"Long caption ".repeat(15)};
  const blocks=layout.present([image],profile),xml=writer.buildDocumentXml(blocks,profile);
  assert.match(xml,/<w:p><w:pPr><w:keepNext\/><w:keepLines\/>/);
  const [,cx,cy]=/wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
  assert.ok(Math.abs(Number(cx)/Number(cy)-800/3000)<.00001);assert.ok(Number(cy)<(257-15)*36000);
  assert.equal(image.keepWithCaption,undefined);assert.match(xml,/descr="Exact alt"/);
});
test("manual movement returns a lossless permutation, groups captions and stops at section boundaries", () => {
  const blocks = layout.prepare([heading("Budget"), p("A"), p("Table 7. Budget"), table(), p("Source: 2026"), p("B")]);
  const order = layout.move(blocks, 3, 1);
  assert.deepEqual(order, [0, 1, 5, 2, 3, 4]);
  assert.deepEqual([...order].sort((a,b) => a-b), blocks.map((_b,i) => i));
  assert.equal(layout.move(blocks, 3, 0), null);
  assert.equal(layout.move([heading("A"), table()], 1, -1), null);
  const manual = [p("See Table 7."), p("A"), ...blocks.slice(2, 5)]; manual[3].manualPlacement = true;
  assert.equal(layout.arrange(manual).moved, 0);
});
test("presentation preserves explicit numbers, adds noncolliding labels only and never invents a source", () => {
  const blocks = layout.prepare([p("See Table 1."), p("Table 1. Budget"), table(), table()]);
  const result = layout.present(blocks, profile), cs = result.filter((b) => b.type === "caption");
  assert.deepEqual(cs.map((b) => [b.number,b.title]), [["1","Budget"],["2",""]]);
  assert.equal(result.some((b) => b.type === "sourceNote"), false);
  assert.deepEqual(layout.present(result,profile), result);
  const assembled = builder.assemble({blocks: layout.present(layout.prepare([p("See Table 7."), p("Table 7. Budget"), table()]),profile), preserveOrder:true, profileId:profile.id, text:""});
  assert.equal(assembled.blocks.find((b) => b.type === "caption").number,"7");
});
test("caption editing overrides title without changing source, numbers, rows or alt description", () => {
  const blocks = layout.prepare([p("Table 7. Old"), {...table(),layoutTitle:"New <caption>"}]);
  const result = layout.present(blocks,profile);
  assert.equal(result[0].title,"New <caption>"); assert.equal(result[0].number,"7");
  assert.deepEqual(result[1].rows,[["2026","125"]]); assert.equal(blocks[0].title,"Old");
  assert.match(writer.buildDocumentXml(result,profile),/New &lt;caption&gt;/);
});
test("headings and above-table captions stay with following content; prose remains breakable", () => {
  const xml = writer.buildDocumentXml([heading("Budget"),p("Long prose."),...layout.present([table()],profile)],profile);
  const paras = xml.match(/<w:p>.*?<\/w:p>/gu);
  assert.match(paras[0],/<w:keepNext\/><w:keepLines\/>/);
  assert.doesNotMatch(paras[1],/keepNext|keepLines/); assert.match(paras[1],/widowControl/);
  assert.match(paras[2],/<w:keepNext\/>/);
});
test("table headers repeat, short rows stay whole, long rows can split; no fixed row heights", () => {
  const b = table(); b.rows.push(["Long description ".repeat(1000),"1"]);
  const xml = writer.buildDocumentXml([b],profile), rows = xml.match(/<w:tr>.*?<\/w:tr>/gu);
  assert.match(rows[0],/tblHeader/); assert.match(rows[1],/cantSplit/); assert.doesNotMatch(rows[2],/cantSplit/);
  assert.doesNotMatch(xml,/trHeight/);
});
