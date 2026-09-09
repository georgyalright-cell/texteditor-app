(function attach(root) {
  "use strict";

  // Обратный путь в документ. Скачивание отдаёт новый файл; здесь нужно
  // другое — вернуть обработанное содержимое туда, откуда его взяли.
  //
  // Поэтому в буфер пишется text/html: Word вставляет заголовки, таблицы и
  // списки на свои места, а не одной простыней. Рядом кладётся text/plain на
  // случай редактора, который HTML из буфера не берёт.
  //
  // Блоки, которые пайплайн не переписывает — таблицы, списки, картинки,
  // подписи — переносятся как есть. Это не украшение: если вернуть их в
  // другом виде, обратная вставка перестанет быть обратной.

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Абзац может содержать перевод строки внутри блока — в ячейках и в списках
  // он значащий, и терять его нельзя.
  function withBreaks(value) {
    return escapeHtml(value).replace(/\r\n?|\n/g, "<br>");
  }

  function captionText(block) {
    const prefix = block.prefix || (block.kind === "figure" ? "Figure" : "Table");
    const number = block.number ? ` ${block.number}` : "";
    const title = block.title ? `. ${block.title}` : "";
    return `${prefix}${number}${title}`.trim();
  }

  function tableHtml(block) {
    const columns = block.columns || [];
    const rows = block.rows || [];
    const head = columns.length
      ? `<thead><tr>${columns.map((cell) => `<th>${withBreaks(cell)}</th>`).join("")}</tr></thead>`
      : "";
    const body = rows.length
      ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${withBreaks(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
      : "";
    return `<table border="1" cellspacing="0" cellpadding="4">${head}${body}</table>`;
  }

  // Нумерованный список отличается от маркированного разметкой, а не только
  // видом: если отдать «1.» текстом внутри <li>, Word пронумерует заново и
  // рядом с исходной цифрой появится вторая.
  const ORDERED_RE = /^\s*(\d+)[.)]\s+/u;
  const BULLET_RE = /^\s*[-–—•*]\s+/u;

  function listHtml(block) {
    const lines = block.lines || [];
    if (!lines.length) return "";
    const ordered = lines.every((line) => ORDERED_RE.test(line));
    const bulleted = !ordered && lines.every((line) => BULLET_RE.test(line));
    if (!ordered && !bulleted) {
      return lines.map((line) => `<p>${withBreaks(line)}</p>`).join("");
    }
    const strip = ordered ? ORDERED_RE : BULLET_RE;
    const items = lines.map((line) => `<li>${withBreaks(line.replace(strip, ""))}</li>`).join("");
    if (!ordered) return `<ul>${items}</ul>`;
    const first = Number(lines[0].match(ORDERED_RE)[1]);
    // Список, начатый не с единицы, продолжает нумерацию исходника.
    return `<ol${first > 1 ? ` start="${first}"` : ""}>${items}</ol>`;
  }

  function blockHtml(block) {
    if (!block || typeof block !== "object") return "";
    switch (block.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(block.level) || 1));
        return `<h${level}>${withBreaks(block.title)}</h${level}>`;
      }
      case "caption":
        return `<p><em>${withBreaks(captionText(block))}</em></p>`;
      case "sourceNote":
        return `<p><em>${withBreaks(block.text)}</em></p>`;
      case "docTable":
      case "table":
        return tableHtml(block);
      case "list":
        return listHtml(block);
      case "image":
        return block.dataUrl
          ? `<p><img src="${escapeHtml(block.dataUrl)}" alt="${escapeHtml(block.alt || "")}"></p>`
          : `<p>[${escapeHtml(block.alt || "Фотография")}]</p>`;
      // Потерянная картинка обязана остаться видимой. Молча пропасть при
      // обратной вставке она не может: заметить это в готовом документе
      // почти невозможно.
      case "imageMissing":
        return `<p>[Фото не перенесено: ${escapeHtml(block.alt || "без описания")}]</p>`;
      case "pageBreak":
        return "<p style=\"page-break-before:always\"></p>";
      case "toc":
        return "";
      default:
        return block.text ? `<p>${withBreaks(block.text)}</p>` : "";
    }
  }

  function html(blocks) {
    const body = (Array.isArray(blocks) ? blocks : []).map(blockHtml).filter(Boolean).join("\n");
    return `<meta charset="utf-8"><div>${body}</div>`;
  }

  function plain(blocks) {
    if (root.ClipboardDocument && typeof root.ClipboardDocument.textOf === "function") {
      return root.ClipboardDocument.textOf(Array.isArray(blocks) ? blocks : []);
    }
    return (Array.isArray(blocks) ? blocks : [])
      .map((block) => block.text || block.title || (block.lines || []).join("\n") || "")
      .filter(Boolean)
      .join("\n\n");
  }

  function summary(blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    const count = (type) => list.filter((block) => block.type === type).length;
    return {
      blocks: list.length,
      paragraphs: count("paragraph"),
      headings: count("heading"),
      tables: count("docTable") + count("table"),
      lists: count("list"),
      images: count("image"),
      missingImages: count("imageMissing"),
    };
  }

  // Сообщение говорит, что именно уехало в буфер. Картинки называются
  // отдельно: их проверяют глазами после вставки, а не на слово.
  function describe(blocks) {
    const parts = summary(blocks);
    const pieces = [];
    if (parts.paragraphs) pieces.push(`абзацев ${parts.paragraphs}`);
    if (parts.headings) pieces.push(`заголовков ${parts.headings}`);
    if (parts.tables) pieces.push(`таблиц ${parts.tables}`);
    if (parts.lists) pieces.push(`списков ${parts.lists}`);
    if (parts.images) pieces.push(`фотографий ${parts.images} — проверьте их после вставки`);
    if (parts.missingImages) {
      pieces.push(`не перенесено фотографий: ${parts.missingImages} — на их месте стоит пометка`);
    }
    if (!pieces.length) return "В буфере пусто: переносить нечего.";
    return `Скопировано для вставки: ${pieces.join(", ")}.`;
  }

  async function copy(blocks, options) {
    const settings = options || {};
    const list = Array.isArray(blocks) ? blocks : [];
    if (!list.length) throw new Error("Нечего копировать: документ пуст.");
    const markup = html(list);
    const text = plain(list);
    const clipboard = settings.clipboard || (typeof navigator === "object" ? navigator.clipboard : null);
    if (!clipboard) throw new Error("Браузер не даёт доступ к буферу обмена.");
    const Item = settings.ClipboardItem || (typeof root.ClipboardItem === "function" ? root.ClipboardItem : null);
    // Разметка важнее простого текста, но не любой ценой: без ClipboardItem
    // или без права на запись html уходит текст, а не ошибка. Обратная
    // вставка простым текстом хуже, чем с разметкой, и всё же лучше, чем
    // ничего.
    if (Item && typeof clipboard.write === "function") {
      try {
        await clipboard.write([
          new Item({
            "text/html": new Blob([markup], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
        return { format: "html", message: describe(list) };
      } catch (error) {
        if (typeof clipboard.writeText !== "function") throw error;
      }
    }
    if (typeof clipboard.writeText !== "function") throw new Error("Браузер не даёт записать в буфер обмена.");
    await clipboard.writeText(text);
    return {
      format: "text",
      message: `${describe(list)} Разметку браузер не отдал, поэтому в буфере простой текст: заголовки и таблицы придётся оформить в документе.`,
    };
  }

  const api = { html, plain, summary, describe, copy };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DocumentClipboard = api;
})(typeof window === "object" ? window : globalThis);
