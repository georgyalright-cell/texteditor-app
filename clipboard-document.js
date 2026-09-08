(function attach(root) {
  "use strict";
  const MAX_TEXT = 200000;
  const MAX_HTML = 32 * 1024 * 1024;
  const BLOCK_TAGS = /^(P|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|BLOCKQUOTE|PRE|UL|OL|FIGURE|FIGCAPTION)$/u;
  const UNSUPPORTED = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|VIDEO|AUDIO|CANVAS|FORM|INPUT|BUTTON|SELECT|TEXTAREA)$/u;
  function plain(text) {
    if (text.length > MAX_TEXT) throw new Error("Лимит вставки — 200 000 символов. Разделите материал на документы.");
    const blocks = [], lines = text.replace(/\r\n?/gu, "\n").split("\n");
    let buffer = [];
    const flush = () => { if (buffer.length) blocks.push(...root.DocumentStructurer.parseDocument(buffer.join("\n"))); buffer = []; };
    for (let i = 0; i < lines.length; i++) {
      const heading = /^(#{1,6})\s+(.+)$/u.exec(lines[i]);
      const picture = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/u.exec(lines[i]);
      if (heading || picture) {
        flush(); blocks.push(heading ? { type: "heading", level: heading[1].length, title: heading[2], kind: "section" } : image(picture[2], picture[1]));
      } else if (lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/u.test(lines[i + 1] || "")) {
        flush();
        const cells = (line) => line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());
        const columns = cells(lines[i]); i += 2; const rows = [];
        for (; i < lines.length && lines[i].includes("|"); i++) rows.push(cells(lines[i]));
        i--; if (rows.some((row) => row.length !== columns.length)) throw new Error("Неодинаковое число ячеек в Markdown-таблице. Вставьте таблицу с форматированием.");
        blocks.push({ type: "docTable", columns, rows });
      } else buffer.push(lines[i]);
    }
    flush(); return blocks;
  }
  function image(src, alt) {
    try { root.DocumentImages.read(src); return { type: "image", dataUrl: src, alt: alt || "Фотография" }; }
    catch (_) { return { type: "imageMissing", alt: alt || "Фотография" }; }
  }
  function parseHtml(html, doc) {
    if (html.length > MAX_HTML) throw new Error("Слишком большая HTML-вставка (лимит 32 МБ).");
    if ((html.match(/</gu) || []).length > 30000) throw new Error("Слишком много элементов HTML. Упростите вставку.");
    // Template content is inert: no scripts, resource loads or custom element upgrades.
    // No imported node or attribute is ever mounted into the live document.
    const template = doc.createElement("template"); template.innerHTML = html;
    if (template.content.querySelectorAll("*").length > 15000) throw new Error("Слишком сложная вставка (больше 15 000 элементов).");
    const blocks = [], warnings = new Set(); let pending = "";
    const flush = () => {
      const text = pending.replace(/[ \t]+/gu, " ").trim(); pending = "";
      if (text) blocks.push({ type: "paragraph", text });
    };
    const visit = (node, depth = 0) => {
      if (depth > 80) throw new Error("Слишком глубоко вложенная разметка.");
      if (node.nodeType === 3) { pending += node.textContent; return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (UNSUPPORTED.test(tag)) { warnings.add("Активные элементы, формулы и мультимедиа не импортируются. Проверьте исходник."); return; }
      if (tag === "BR") { pending += "\n"; return; }
      if (tag === "IMG") { flush(); blocks.push(image(node.getAttribute("src"), node.getAttribute("alt"))); return; }
      if (tag === "TABLE") {
        flush();
        if (node.querySelector("table, img, svg, math")) throw new Error("Вложенные таблицы, формулы и фото внутри ячеек пока не поддерживаются. Вынесите их отдельными блоками.");
        const rows = Array.from(node.querySelectorAll("tr"), (row) => Array.from(row.children).filter((c) => /^(TD|TH)$/u.test(c.tagName)));
        if (rows.some((row) => row.some((c) => Number(c.getAttribute("rowspan") || 1) !== 1 || Number(c.getAttribute("colspan") || 1) !== 1))) throw new Error("Разъедините объединённые ячейки перед вставкой: в этой версии поддерживаются прямоугольные таблицы.");
        const matrix = rows.filter((row) => row.length).map((row) => row.map((cell) => contentText(cell).trim()));
        if (!matrix.length) return;
        if (matrix.length > 1000 || matrix[0].length > 30 || matrix.some((row) => row.length !== matrix[0].length)) throw new Error("Нужна прямоугольная таблица до 1000 строк и 30 столбцов.");
        const caption = node.querySelector("caption"); if (caption) blocks.push({ type: "paragraph", text: caption.textContent.trim() });
        blocks.push({ type: "docTable", columns: matrix[0], rows: matrix.slice(1) }); return;
      }
      if (/^H[1-6]$/u.test(tag)) {
        flush(); if (node.querySelector("img")) throw new Error("Вынесите фото из заголовка отдельным блоком.");
        blocks.push({ type: "heading", level: Number(tag[1]), title: contentText(node).trim(), kind: "section" }); return;
      }
      if (tag === "LI") {
        flush();
        if (node.querySelector("img, table")) throw new Error("Вынесите фото и таблицы из пунктов списка отдельными блоками.");
        const marker = node.parentElement.tagName === "OL" ? `${listNumber(node)}. ` : "• ";
        let text = ""; const nested = [];
        for (const child of node.childNodes) {
          if (child.nodeType === 1 && /^(UL|OL)$/u.test(child.tagName)) nested.push(child);
          else text += contentText(child);
        }
        if (text.trim()) blocks.push({ type: "list", lines: [marker + text.trim()] });
        if (nested.length) warnings.add("Вложенные списки сохранены последовательно; проверьте уровни отступов в Word.");
        for (const child of nested) visit(child, depth + 1);
        return;
      }
      const boundary = BLOCK_TAGS.test(tag); if (boundary) flush();
      for (const child of node.childNodes) visit(child, depth + 1);
      if (tag === "A") {
        const href = node.getAttribute("href") || "";
        if (/^https?:\/\//iu.test(href) && href !== node.textContent.trim()) pending += ` (${href})`;
      }
      if (boundary) flush();
    };
    for (const node of template.content.childNodes) visit(node);
    flush(); return { blocks, warnings: [...warnings] };
  }
  async function fileImage(file) {
    if (!file || file.size > root.DocumentImages.MAX_BYTES) throw new Error("Нужно фото PNG/JPEG до 20 МБ.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Не удалось прочитать фото.")); reader.readAsDataURL(file);
    });
    await root.DocumentImages.decode(dataUrl);
    return { type: "image", dataUrl, alt: file.name || "Фотография" };
  }
  async function read(data, doc) {
    const html = data.getData("text/html"), text = data.getData("text/plain");
    const result = html ? parseHtml(html, doc) : { blocks: plain(text), warnings: [] };
    const files = Array.from(data.files || []);
    if (files.length > 50) throw new Error("Лимит — 50 фотографий в документе.");
    const photos = [];
    for (const file of files) { photos.push(await fileImage(file)); root.DocumentImages.validate(photos); }
    const missing = result.blocks.map((block, i) => block.type === "imageMissing" ? i : -1).filter((i) => i >= 0);
    if (missing.length === 1 && photos.length === 1) result.blocks[missing[0]] = photos[0];
    else if (!result.blocks.length) result.blocks.push(...photos);
    else if (photos.some((photo) => !result.blocks.some((block) => block.type === "image" && block.dataUrl === photo.dataUrl))) throw new Error("Не удалось однозначно расположить фото из буфера. Вставьте материал без файлов и прикрепите фото на отмеченные места.");
    if (!result.blocks.length) throw new Error("В буфере нет поддерживаемого текста, таблиц или фото.");
    validate(result.blocks);
    for (const [index, block] of result.blocks.entries()) if (block.type === "image") {
      try { await root.DocumentImages.decode(block.dataUrl); }
      catch (_) { result.blocks[index] = { type: "imageMissing", alt: block.alt || "Повреждённое фото" }; }
    }
    return result;
  }
  function contentText(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || UNSUPPORTED.test(node.tagName)) return "";
    if (node.tagName === "BR") return "\n";
    const text = Array.from(node.childNodes, contentText).join("");
    return /^(P|DIV|LI|PRE)$/u.test(node.tagName) ? text + "\n" : text;
  }
  function listNumber(node) {
    const parent = node.parentElement, siblings = Array.from(parent.children).filter((child) => child.tagName === "LI");
    const step = parent.hasAttribute("reversed") ? -1 : 1;
    let value = parent.hasAttribute("start") ? Number(parent.getAttribute("start")) : step === -1 ? siblings.length : 1;
    for (const item of siblings) {
      if (item.hasAttribute("value")) value = Number(item.getAttribute("value"));
      if (!Number.isSafeInteger(value)) throw new Error("Некорректный номер пункта списка.");
      if (item === node) return value;
      value += step;
    }
    return value;
  }
  function validate(blocks) {
    if (blocks.length > 3000 || textOf(blocks).length > MAX_TEXT) throw new Error("Лимит документа — 3000 блоков и 200 000 символов.");
    for (const block of blocks) {
      const matrix = block.type === "docTable" ? [block.columns, ...block.rows] : block.type === "table" ? block.lines.map((line) => line.split("\t")) : null;
      if (matrix && (matrix.length > 1000 || matrix.some((row) => row.length > 30 || row.length !== matrix[0].length))) throw new Error("Нужна прямоугольная таблица до 1000 строк и 30 столбцов.");
    }
    root.DocumentImages.validate(blocks.filter((block) => block.type !== "imageMissing"));
  }
  function textOf(blocks) {
    return blocks.map((block) => {
      if (block.type === "heading") return block.title;
      if (block.type === "image" || block.type === "imageMissing") return `[Фото: ${block.alt}]`;
      if (block.type === "docTable") return [block.columns, ...block.rows].map((row) => row.join("\t")).join("\n");
      return block.text || (block.lines || []).join("\n") || block.title || "";
    }).join("\n\n");
  }
  const api = { read, plain, parseHtml, fileImage, textOf, validate };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ClipboardDocument = api;
})(typeof window === "object" ? window : globalThis);
