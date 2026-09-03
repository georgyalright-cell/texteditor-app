(function attachDocumentReader(root) {
  "use strict";

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
  let pdfLibraryPromise = null;
  const TEXT_EXTENSIONS = new Set([
    "txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "jsonl",
    "yaml", "yml", "ini", "cfg", "conf", "tex", "srt", "vtt",
  ]);

  function extensionOf(filename) {
    const match = String(filename || "").toLocaleLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : "";
  }

  function decodeBytes(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      try {
        return new TextDecoder("windows-1251").decode(bytes);
      } catch (_fallbackError) {
        return new TextDecoder("utf-8").decode(bytes);
      }
    }
  }

  function requireLibrary(value, label) {
    if (!value) throw new Error(`Не удалось загрузить модуль ${label}. Проверьте соединение и обновите страницу.`);
    return value;
  }

  function loadPdfLibrary() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (!pdfLibraryPromise) {
      pdfLibraryPromise = import("./vendor/pdfjs/pdf.mjs?v=18").catch((error) => {
        pdfLibraryPromise = null;
        throw error;
      });
    }
    return pdfLibraryPromise;
  }

  function assertSafeZip(zip) {
    let expandedBytes = 0;
    for (const entry of Object.values(zip.files || {})) {
      const entryBytes = Number(entry && entry._data && entry._data.uncompressedSize);
      if (Number.isFinite(entryBytes) && entryBytes > 0) expandedBytes += entryBytes;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error("Архив документа после распаковки превышает безопасные 64 МБ.");
      }
    }
  }

  function xmlBlocks(xml, names) {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Документ содержит повреждённый XML.");
    const allowed = new Set(names);
    return Array.from(document.getElementsByTagName("*"))
      .filter((node) => allowed.has(node.localName))
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function htmlBlocks(source) {
    const document = new DOMParser().parseFromString(source, "text/html");
    document.querySelectorAll("script, style, noscript, svg").forEach((node) => node.remove());
    const blocks = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,tr"))
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return (blocks.length ? blocks.join("\n\n") : document.body.textContent).trim();
  }

  function rtfText(buffer) {
    const bytes = new Uint8Array(buffer);
    let source = new TextDecoder("latin1").decode(bytes);
    const cp1251 = new TextDecoder("windows-1251");
    source = source.replace(/\\u(-?\d+)\??/g, (_match, value) => {
      let code = Number(value);
      if (code < 0) code += 65536;
      return String.fromCharCode(code);
    });
    source = source.replace(/\\'([0-9a-f]{2})/gi, (_match, value) =>
      cp1251.decode(Uint8Array.of(Number.parseInt(value, 16))),
    );
    source = source
      .replace(/\\(?:par|line)\b\s?/gi, "\n")
      .replace(/\\tab\b\s?/gi, "\t")
      .replace(/\\[a-z]+-?\d*\s?/gi, "")
      .replace(/\\([{}\\])/g, "$1")
      .replace(/[{}]/g, "")
      .replace(/\n{3,}/g, "\n\n");
    return source.trim();
  }

  async function readPdf(buffer) {
    const pdfjs = await loadPdfLibrary();
    pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs?v=18";
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      enableScripting: false,
      isEvalSupported: false,
    }).promise;
    const pages = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const lines = [];
      let currentLine = null;

      function flushLine() {
        if (!currentLine) return;
        currentLine.parts.sort((left, right) => left.x - right.x);
        let text = "";
        let rightEdge = null;
        for (const part of currentLine.parts) {
          const gap = rightEdge === null ? 0 : part.x - rightEdge;
          const needsSpace = text
            && !/\s$/.test(text)
            && !/^\s/.test(part.text)
            && gap > Math.max(1.1, part.fontSize * 0.14);
          if (needsSpace) text += " ";
          text += part.text;
          rightEdge = Math.max(rightEdge === null ? part.x : rightEdge, part.x + part.width);
        }
        currentLine.text = text.replace(/\s+/g, " ").trim();
        if (currentLine.text) lines.push(currentLine);
        currentLine = null;
      }

      for (const item of content.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform ? item.transform[5] : 0);
        const x = item.transform ? item.transform[4] : 0;
        const fontSize = Math.abs(item.transform ? item.transform[3] : item.height || 0);
        if (!currentLine || Math.abs(y - currentLine.y) > 3) {
          flushLine();
          currentLine = { y, x, fontSize, parts: [] };
        }
        currentLine.x = Math.min(currentLine.x, x);
        currentLine.parts.push({
          text: item.str,
          x,
          width: Math.max(0, item.width || 0),
          fontSize,
        });
        currentLine.fontSize = Math.max(currentLine.fontSize, fontSize);
      }
      flushLine();

      const bodyLines = lines.filter((line) => line.text.length >= 40 && !/^\d{1,4}$/.test(line.text));
      const bodyLeft = bodyLines.length ? Math.min(...bodyLines.map((line) => line.x)) : 0;
      const sizes = bodyLines.map((line) => line.fontSize).filter(Boolean).sort((a, b) => a - b);
      const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
      const output = [];

      for (const line of lines) {
        const isMarginNumber = /^\d{1,4}$/.test(line.text)
          && (line.y < viewport.height * 0.1 || line.y > viewport.height * 0.92);
        if (isMarginNumber) continue;
        const startsParagraph = line.x > bodyLeft + Math.max(18, bodySize * 1.6);
        const largerType = line.fontSize > bodySize * 1.12;
        if (output.length && (startsParagraph || largerType)) output.push("\n\n");
        else if (output.length) output.push("\n");
        output.push(line.text);
      }
      pages.push(output.join("").replace(/\n{3,}/g, "\n\n").trim());
    }
    return pages.filter(Boolean).join("\n\n");
  }

  async function readDocx(buffer) {
    const mammoth = requireLibrary(root.mammoth, "DOCX");
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value.trim();
  }

  async function readZipXml(buffer, extension) {
    const JSZip = requireLibrary(root.JSZip, extension.toUpperCase());
    const zip = await JSZip.loadAsync(buffer);
    assertSafeZip(zip);
    if (extension === "odt") {
      const entry = zip.file("content.xml");
      if (!entry) throw new Error("В ODT отсутствует content.xml.");
      return xmlBlocks(await entry.async("text"), ["h", "p"]);
    }
    if (extension === "pptx") {
      const slides = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]));
      const result = [];
      for (let index = 0; index < slides.length; index += 1) {
        const xml = await zip.file(slides[index]).async("text");
        const text = xmlBlocks(xml, ["t"]);
        if (text) result.push(`[Слайд ${index + 1}]\n${text}`);
      }
      return result.join("\n\n");
    }
    const chapters = Object.keys(zip.files)
      .filter((name) => /\.(?:xhtml|html|htm)$/i.test(name) && !/(?:nav|toc)\./i.test(name))
      .sort();
    const result = [];
    for (const chapter of chapters) {
      const text = htmlBlocks(await zip.file(chapter).async("text"));
      if (text) result.push(text);
    }
    return result.join("\n\n");
  }

  async function readSpreadsheet(buffer) {
    const XLSX = requireLibrary(root.XLSX, "XLSX");
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      bookVBA: false,
      bookFiles: false,
    });
    return workbook.SheetNames.map((name) => {
      const body = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { FS: "\t", RS: "\n" }).trim();
      return body ? `[${name}]\n${body}` : "";
    }).filter(Boolean).join("\n\n");
  }

  async function readFile(file) {
    if (!file) throw new Error("Файл не выбран.");
    if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше допустимых 20 МБ.");
    const extension = extensionOf(file.name);
    const buffer = await file.arrayBuffer();
    let text;

    if (TEXT_EXTENSIONS.has(extension) || !extension) text = decodeBytes(buffer);
    else if (extension === "pdf") text = await readPdf(buffer);
    else if (extension === "docx") text = await readDocx(buffer);
    else if (extension === "rtf") text = rtfText(buffer);
    else if (["odt", "epub", "pptx"].includes(extension)) text = await readZipXml(buffer, extension);
    else if (["xlsx", "xlsm"].includes(extension)) text = await readSpreadsheet(buffer);
    else if (["html", "htm"].includes(extension)) text = htmlBlocks(decodeBytes(buffer));
    else if (["xml", "fb2"].includes(extension)) text = xmlBlocks(decodeBytes(buffer), ["title", "subtitle", "p"]);
    else if (extension === "doc") {
      throw new Error("Старый формат DOC не поддерживается браузером. Сохраните файл как DOCX или RTF.");
    } else {
      text = decodeBytes(buffer);
    }

    text = String(text || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("В документе не найден текст. Возможно, это скан без текстового слоя.");
    return text;
  }

  root.DocumentReader = { readFile, MAX_FILE_BYTES, MAX_EXPANDED_BYTES };
})(typeof globalThis !== "undefined" ? globalThis : window);
