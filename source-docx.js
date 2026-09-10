(function attach(root) {
  "use strict";
  const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const MAX_BYTES = 20 * 1024 * 1024, MAX_EXPANDED = 64 * 1024 * 1024, MAX_ENTRIES = 2048;
  const ACTIVE_FIELD = /\b(?:DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|DATABASE|LINK)\b/i;
  const fail = message => { throw new Error(message); };
  const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity];
  });
  const escape = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Locate original byte-equivalent XML substrings. Never serialize document.xml:
  // serializing the whole DOM would also rewrite untouched table markup.
  function scan(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("DOCX содержит запрещённое объявление XML.");
    const holder = { children: [] }, stack = [holder];
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w.:-]*(?:"[^"]*"|'[^']*'|[^<>"'])*\/?>/g;
    let match, end = 0, count = 0;
    while ((match = tokens.exec(xml))) {
      if (xml.slice(end, match.index).includes("<")) fail("Повреждённый XML в DOCX.");
      end = tokens.lastIndex;
      const tag = match[0];
      if (tag.startsWith("<?") && !/^<\?xml\s/i.test(tag)) fail("Подключаемые инструкции XML не поддерживаются.");
      if (/^<\?|^<!/.test(tag)) continue;
      const name = /^<\/?([^\s/>]+)/.exec(tag)[1];
      if (tag.startsWith("</")) {
        const node = stack.pop();
        if (!node || node === holder || node.name !== name) fail("Повреждённая структура XML в DOCX.");
        node.closeStart = match.index; node.end = end;
      } else {
        if (++count > 250000 || stack.length > 128) fail("XML документа слишком сложен для безопасной обработки.");
        const node = { name, local: name.split(":").pop(), start: match.index, openEnd: end, children: [] };
        stack[stack.length - 1].children.push(node);
        if (/\/>$/.test(tag)) { node.closeStart = end; node.end = end; node.empty = true; }
        else stack.push(node);
      }
    }
    if (stack.length !== 1 || xml.slice(end).includes("<") || holder.children.length !== 1) fail("Повреждённый XML в DOCX.");
    return holder.children[0];
  }
  function parse(xml, doc) {
    scan(xml);
    const Parser = doc?.defaultView?.DOMParser || root.DOMParser;
    if (!Parser) fail("Не загрузился браузерный модуль чтения DOCX. Обновите страницу.");
    const parsed = new Parser().parseFromString(xml, "application/xml");
    if (parsed.getElementsByTagName("parsererror").length) fail("Повреждённый XML в DOCX.");
    return parsed;
  }
  function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
  function paragraphText(xml, node) {
    return descendants(node).map(child => {
      if (child.local === "t") return (xml.slice(child.openEnd, child.closeStart).match(/<!\[CDATA\[[\s\S]*?\]\]>|[^<]+/g) || [])
        .map(part => part.startsWith("<![CDATA[") ? part.slice(9, -3) : decode(part)).join("");
      if (child.local === "tab") return "\t";
      if (["br", "cr"].includes(child.local)) return "\n";
      return "";
    }).join("");
  }
  function editable(xml, node) {
    if (node.local !== "p" || !node.children.every(child => child.local === "pPr" ||
      (child.local === "r" && child.children.every(run => ["rPr", "t", "tab", "br", "cr"].includes(run.local))))) return false;
    const runs = node.children.filter(child => child.local === "r");
    const styles = runs.map(run => {
      const properties = run.children.find(child => child.local === "rPr");
      return properties ? xml.slice(properties.start, properties.end) : "";
    });
    // Rewriting cannot map mixed bold/italic spans onto new wording reliably.
    // Keep the entire paragraph rather than silently flattening its formatting.
    if (new Set(styles).size > 1) return false;
    return !runs.some(run => run.children.some(child => ["br", "cr", "tab"].includes(child.local)));
  }
  function bodyNodes(xml) {
    const document = scan(xml), body = document.children.find(node => node.local === "body");
    if (document.local !== "document" || !body) fail("В DOCX не найден основной документ.");
    return body.children;
  }
  async function load(bytes, doc, validateDom = true) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) fail("Нужен DOCX размером до 20 МБ.");
    if (!root.JSZip) fail("Не загрузился модуль ZIP. Обновите страницу.");
    const zip = await root.JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    if (entries.length > MAX_ENTRIES) fail("В DOCX слишком много вложенных файлов.");
    let expanded = 0;
    for (const entry of entries) {
      if (entry.dir) continue;
      const size = Number(entry._data?.uncompressedSize);
      if (!Number.isSafeInteger(size) || size < 0 || (expanded += size) > MAX_EXPANDED) fail("DOCX после распаковки превышает безопасные 64 МБ.");
      if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name || /(?:^|\/)\.\.(?:\/|$)|^\/|\\/.test(entry.name)) fail("DOCX содержит небезопасный путь вложения.");
      if (/(?:^|\/)(?:embeddings|activeX|customUI)(?:\/|$)|vbaProject|vbaData|_xmlsignatures/i.test(entry.name)) fail("DOCX содержит макросы, вложенные программы или подпись. Сохраните обычную копию DOCX без них.");
    }
    for (const entry of entries.filter(entry => !entry.dir && /(?:\.xml|\.rels)$/i.test(entry.name))) {
      const text = await entry.async("text");
      const tree = scan(text);
      if (validateDom) parse(text, doc);
      if (/macroEnabled|vbaProject|activeX|oleObject/i.test(text)) fail("Активное содержимое DOCX не поддерживается. Сохраните обычную копию без макросов и вложений.");
      if (/\.rels$/i.test(entry.name)) {
        for (const rel of tree.children) {
          const tag = text.slice(rel.start, rel.openEnd);
          const attr = key => decode(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])(.*?)\\1`, "s").exec(tag)?.[2] || "");
          const type = attr("Type"), target = attr("Target"), mode = attr("TargetMode");
          if (/\/(?:oleObject|package|aFChunk|attachedTemplate|control)$/i.test(type) ||
            (mode.toLowerCase() === "external" && (!/\/hyperlink$/.test(type) || !/^(?:https?:|mailto:)/i.test(target)))) {
            fail("DOCX содержит внешние подключаемые объекты. Сохраните копию со встроенными изображениями и обычными ссылками.");
          }
        }
      }
      const xmlNodes = descendants(tree);
      // Word can split a single field instruction across arbitrary runs. A token
      // such as DD + EAUTO is still active when Word joins the instruction text.
      // A field delimiter separates groups so a preceding PAGE field cannot
      // hide a dangerous token by turning the joined string into PAGEDDEAUTO.
      const instructionGroups = []; let chunks = [];
      for (const node of xmlNodes) {
        if (["fldChar", "fldSimple"].includes(node.local)) { instructionGroups.push(chunks.join("")); chunks = []; }
        if (node.local === "instrText") chunks.push(decode(text.slice(node.openEnd, node.closeStart)));
      }
      instructionGroups.push(chunks.join(""));
      if (instructionGroups.some(instruction => ACTIVE_FIELD.test(instruction)) || xmlNodes.some(node => ["altChunk", "object"].includes(node.local) ||
        (node.local === "fldSimple" && ACTIVE_FIELD.test(decode(text.slice(node.start, node.end)))))) {
        fail("В DOCX есть активные поля или встроенные объекты. Сохраните обычную копию документа.");
      }
    }
    const entry = zip.file("word/document.xml");
    if (!entry) fail("В DOCX отсутствует word/document.xml.");
    const xml = await entry.async("text");
    bodyNodes(xml);
    return { zip, xml };
  }
  async function read(file, doc) {
    if (!file || file.size > MAX_BYTES) fail("Нужен DOCX размером до 20 МБ.");
    const bytes = new Uint8Array(await file.arrayBuffer()), { zip, xml } = await load(bytes, doc);
    const parsed = parse(xml, doc), body = parsed.getElementsByTagNameNS(W, "body")[0];
    if (!body) fail("Не поддерживается пространство имён этого DOCX. Сохраните обычный Word DOCX.");
    const elements = Array.from(body.childNodes).filter(node => node.nodeType === 1);
    const ranges = bodyNodes(xml), blocks = [], warnings = new Set();
    const styles = zip.file("word/styles.xml") ? parse(await zip.file("word/styles.xml").async("text"), doc) : null;
    const relationships = {};
    if (zip.file("word/_rels/document.xml.rels")) {
      const rels = parse(await zip.file("word/_rels/document.xml.rels").async("text"), doc);
      for (const rel of Array.from(rels.documentElement.childNodes).filter(node => node.nodeType === 1)) relationships[rel.getAttribute("Id")] = rel.getAttribute("Target");
    }
    for (let index = 0; index < ranges.length; index++) {
      const node = ranges[index], element = elements[index];
      if (node.local === "sectPr") continue;
      let block;
      if (node.local === "tbl") {
        if (!root.TableDocx) fail("Не загрузился модуль таблиц. Обновите страницу.");
        try { block = root.TableDocx.readTable(element, styles, relationships); }
        catch (_) {
          block = { type: "sourceNote", text: "Сложная таблица сохранена в исходном DOCX; предпросмотр недоступен." };
          warnings.add("Сложные таблицы сохранены в исходном DOCX без изменений; их предпросмотр недоступен.");
        }
      } else if (node.local === "p") {
        const text = paragraphText(xml, node);
        const styleId = element.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || "";
        const style = styles && Array.from(styles.getElementsByTagNameNS(W, "style")).find(item => item.getAttributeNS(W, "styleId") === styleId);
        const styleName = style?.getElementsByTagNameNS(W, "name")[0]?.getAttributeNS(W, "val") || styleId;
        const heading = /^(?:heading|заголовок)\s*([1-6])$/i.exec(styleName);
        block = { type: text && editable(xml, node) ? (heading ? "heading" : "paragraph") : "sourceNote", text, sourceParagraph: index };
        if (heading) { block.level = Number(heading[1]); block.title = text; }
        if (!editable(xml, node)) warnings.add("Абзацы с полями, гиперссылками, изображениями или сложной разметкой сохранены в исходном DOCX без изменений.");
      } else {
        block = { type: "sourceNote", text: paragraphText(xml, node) };
        warnings.add("Сложные элементы исходного DOCX сохранены без изменений; редактируется только обычный текст вне таблиц.");
      }
      blocks.push({ ...block, sourceChild: index });
    }
    if (!blocks.length) fail("В DOCX не найдено содержимое.");
    const paragraphTexts = ranges.map((node, sourceChild) => ({ node, sourceChild }))
      .filter(({ node }) => node.local === "p").map(({ node, sourceChild }) => ({ sourceChild, text: paragraphText(xml, node) }));
    blocks[0].sourceDocx = { version: 1, bytes, paragraphTexts, filename: String(file.name || "document.docx").slice(0, 200) };
    return { blocks, warnings: [...warnings] };
  }
  // Fast preflight for processing. Export independently verifies the original XML;
  // this snapshot is never accepted as authority when writing a DOCX package.
  function integrity(blocks) {
    const sources = blocks.filter(block => block.sourceDocx);
    if (!sources.length) return { ok: true };
    if (sources.length !== 1 || !Array.isArray(sources[0].sourceDocx.paragraphTexts)) return { ok: false };
    const originals = sources[0].sourceDocx.paragraphTexts, current = blocks.filter(block => Number.isInteger(block.sourceParagraph));
    if (originals.length !== current.length || originals.some((item, index) =>
      !Number.isInteger(item.sourceChild) || typeof item.text !== "string" || item.sourceChild !== current[index].sourceChild ||
      item.sourceChild !== current[index].sourceParagraph)) return { ok: false };
    const before = originals.map(item => item.text).join("\n\n"), after = current.map(block => String(block.text ?? "")).join("\n\n");
    if (before === after) return { ok: true };
    const guard = root.AnchorGuard || (typeof require === "function" ? require("./anchor-guard.js") : null);
    return guard?.compare(before, after) || { ok: false };
  }
  function replacement(xml, node, text) {
    const prefix = node.name.includes(":") ? node.name.split(":")[0] + ":" : "";
    const pPr = node.children.find(child => child.local === "pPr");
    const firstRun = node.children.find(child => child.local === "r");
    const rPr = firstRun?.children.find(child => child.local === "rPr");
    const runs = text.split(/([\t\n])/).filter(Boolean).map(part => part === "\t" ? `<${prefix}tab/>` :
      part === "\n" ? `<${prefix}br/>` : `<${prefix}t xml:space="preserve">${escape(part)}</${prefix}t>`).join("");
    const runOpen = firstRun ? xml.slice(firstRun.start, firstRun.openEnd).replace(/\/>$/, ">") : `<${prefix}r>`;
    return xml.slice(node.start, node.openEnd).replace(/\/>$/, ">") +
      (pPr ? xml.slice(pPr.start, pPr.end) : "") + runOpen +
      (rPr ? xml.slice(rPr.start, rPr.end) : "") + runs + `</${firstRun?.name || prefix + "r"}></${node.name}>`;
  }
  function patch(xml, blocks) {
    const ranges = bodyNodes(xml), expected = ranges.map((node, index) => ({ node, index })).filter(({ node }) => node.local !== "sectPr");
    if (blocks.length !== expected.length) fail("Состав исходного DOCX изменился. Для сохранения оформления нельзя удалять или добавлять блоки.");
    const patches = [], before = [], after = [];
    const guard = root.AnchorGuard || (typeof require === "function" ? require("./anchor-guard.js") : null);
    for (let i = 0; i < expected.length; i++) {
      const { node, index } = expected[i], block = blocks[i];
      if (block.sourceChild !== index) fail("Порядок исходного DOCX изменился. Восстановите исходное расположение блоков.");
      if (node.local !== "p") continue;
      if (block.sourceParagraph !== index) fail("Нарушена привязка абзаца к исходному DOCX.");
      const original = paragraphText(xml, node), text = String(block.text ?? "");
      before.push(original); after.push(text);
      if (original === text) continue;
      if (!editable(xml, node) || !["paragraph", "heading"].includes(block.type)) fail("Защищённый абзац DOCX нельзя изменять: в нём есть поля, ссылки, объекты или сложное оформление.");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) fail("В тексте есть недопустимые для DOCX управляющие символы.");
      if (!guard?.compare(original, text).ok) fail("Экспорт остановлен: изменились ссылки или числовые данные исходного абзаца.");
      patches.push({ start: node.start, end: node.end, text: replacement(xml, node, text) });
    }
    if (patches.length && !guard?.compare(before.join("\n\n"), after.join("\n\n")).ok) fail("Экспорт остановлен: изменились ссылки или числовые данные документа.");
    let result = xml;
    for (const change of patches.reverse()) result = result.slice(0, change.start) + change.text + result.slice(change.end);
    return result;
  }
  async function write(blocks) {
    const sources = blocks.filter(block => block.sourceDocx);
    if (sources.length !== 1 || sources[0].sourceDocx.version !== 1) fail("Исходный DOCX недоступен. Загрузите его заново.");
    const bytes = sources[0].sourceDocx.bytes;
    const { zip, xml } = await load(bytes, null, typeof module !== "object" || !module.exports);
    const edited = patch(xml, blocks);
    if (edited === xml) return new Blob([bytes], { type: MIME });
    if (root.DOMParser) parse(edited);
    zip.file("word/document.xml", edited);
    return zip.generateAsync({ type: "blob", mimeType: MIME, compression: "DEFLATE" });
  }
  const api = { read, write, integrity, patch, scan, MAX_BYTES, MAX_EXPANDED, MAX_ENTRIES };
  root.SourceDocx = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
