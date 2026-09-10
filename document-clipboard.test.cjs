"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clipboard = require("./document-clipboard.js");

const BLOCKS = [
  { type: "heading", level: 2, title: "2.4. Market Analysis" },
  { type: "paragraph", text: "Выручка выросла на 12,5% за 2024 год." },
  { type: "caption", kind: "table", prefix: "Table", number: "2", title: "Segment sizes" },
  { type: "docTable", columns: ["Сегмент", "2024"], rows: [["CT", "48,0"], ["MRI", "104,0"]] },
  { type: "list", lines: ["1. Первый", "2. Второй"] },
  { type: "list", lines: ["— первый", "— второй"] },
];

test("заголовок сохраняет уровень, а не превращается в абзац", () => {
  assert.match(clipboard.html(BLOCKS), /<h2>2\.4\. Market Analysis<\/h2>/u);
});

test("таблица переносится таблицей, с шапкой", () => {
  const html = clipboard.html(BLOCKS);
  assert.match(html, /<table[^>]*>/u);
  assert.match(html, /<th>Сегмент<\/th>/u);
  assert.match(html, /<td>48,0<\/td>/u);
});

test("нумерованный и маркированный список различаются разметкой", () => {
  // Если отдать «1.» текстом внутри <li>, Word пронумерует заново и рядом с
  // исходной цифрой встанет вторая.
  const html = clipboard.html(BLOCKS);
  assert.match(html, /<ol><li>Первый<\/li><li>Второй<\/li><\/ol>/u);
  assert.match(html, /<ul><li>первый<\/li><li>второй<\/li><\/ul>/u);
});

test("список, начатый не с единицы, продолжает нумерацию исходника", () => {
  const html = clipboard.html([{ type: "list", lines: ["7. Седьмой", "8. Восьмой"] }]);
  assert.match(html, /<ol start="7">/u);
});

test("смешанный список не ломается в разметку списка", () => {
  const html = clipboard.html([{ type: "list", lines: ["1. Нумерованный", "— маркированный"] }]);
  assert.doesNotMatch(html, /<ol|<ul/u);
  assert.match(html, /<p>1\. Нумерованный<\/p>/u);
});

test("перевод строки внутри ячейки не теряется", () => {
  const html = clipboard.html([{ type: "docTable", columns: ["A"], rows: [["первая\nвторая"]] }]);
  assert.match(html, /первая<br>вторая/u);
});

test("разметка экранируется, а не вставляется как теги", () => {
  const html = clipboard.html([{ type: "paragraph", text: 'Условие a < b и "кавычки" & амперсанд' }]);
  assert.match(html, /a &lt; b/u);
  assert.match(html, /&amp; амперсанд/u);
  assert.doesNotMatch(html, /<b>/u);
});

test("потерянная картинка остаётся видимой пометкой, а не исчезает", () => {
  // Пропавшее при обратной вставке фото в готовом документе не заметить.
  const html = clipboard.html([{ type: "imageMissing", alt: "схема цепочки" }]);
  assert.match(html, /Фото не перенесено: схема цепочки/u);
  assert.match(clipboard.describe([{ type: "imageMissing", alt: "схема" }]), /не перенесено фотографий: 1/u);
});

test("картинка с данными переносится изображением", () => {
  const html = clipboard.html([{ type: "image", dataUrl: "data:image/png;base64,AAA", alt: "график" }]);
  assert.match(html, /<img src="data:image\/png;base64,AAA" alt="график">/u);
  assert.match(clipboard.describe([{ type: "image", dataUrl: "x", alt: "г" }]), /проверьте их после вставки/u);
});

test("в буфер уходит и разметка, и простой текст", async () => {
  const written = [];
  class FakeItem {
    constructor(parts) { this.parts = parts; }
  }
  const result = await clipboard.copy(BLOCKS, {
    clipboard: { write: (items) => { written.push(items[0]); return Promise.resolve(); } },
    ClipboardItem: FakeItem,
  });
  assert.equal(result.format, "html");
  assert.deepEqual(Object.keys(written[0].parts).sort(), ["text/html", "text/plain"]);
});

test("без права на запись разметки обычный текст остаётся доступен", async () => {
  let plain = "";
  class FakeItem {}
  const result = await clipboard.copy(BLOCKS.filter(b => b.type !== 'docTable'), {
    clipboard: {
      write: () => Promise.reject(new Error("отказано")),
      writeText: (value) => { plain = value; return Promise.resolve(); },
    },
    ClipboardItem: FakeItem,
  });
  assert.equal(result.format, "text");
  assert.match(result.message, /простой текст/u);
  assert.match(plain, /Выручка выросла на 12,5%/u);
});

test("таблицы не подменяются простым текстом при отказе clipboard HTML", async () => {
  let writes=0;
  await assert.rejects(clipboard.copy(BLOCKS, { ClipboardItem: class {}, clipboard:{
    write:async()=>{throw new Error('Denied');}, writeText:async()=>{writes++;}
  }}), /Скачайте DOCX/);
  assert.equal(writes,0);
  await assert.rejects(clipboard.copy(BLOCKS,{clipboard:{writeText:async()=>{writes++;}}}),/скачивание DOCX/);
  assert.equal(writes,0);
});

test("пустой документ копировать нечего, и это сказано прямо", async () => {
  await assert.rejects(() => clipboard.copy([], { clipboard: {} }), /документ пуст/u);
});
