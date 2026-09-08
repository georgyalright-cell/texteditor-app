(function attachDocxWriter(root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./format-profiles.js") : root.FormatProfiles,
    typeof module === "object" && module.exports ? require("./document-images.js") : root.DocumentImages,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DocxWriter = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createDocxWriter(FormatProfiles, Images) {
  "use strict";

  // Минимальный WordprocessingML-пакет. Никаких библиотек генерации docx:
  // .docx — это zip с XML, и всё, что нужно по §5.1, выражается в разметке
  // напрямую. Сборка zip делается через JSZip, который страница уже грузит
  // для чтения xlsx; построение XML от него не зависит и потому тестируется.

  const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  const ALIGNMENT = { both: "both", center: "center", right: "right", left: "left" };

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function pointsToHalfPoints(value) {
    return Math.round(value * 2);
  }

  function pointsToTwips(value) {
    return Math.round(value * 20);
  }

  function lineSpacingToTwips(multiplier) {
    // Word хранит межстрочный интервал в двадцатых долях пункта: одинарный
    // интервал — 240, поэтому 1.15 превращается в 276.
    return Math.round(240 * multiplier);
  }

  function runXml(text, options) {
    const settings = options || {};
    const properties = [];
    if (settings.bold) properties.push("<w:b/>");
    if (settings.italic) properties.push("<w:i/>");
    const runProperties = properties.length ? `<w:rPr>${properties.join("")}</w:rPr>` : "";
    const content = String(text).split(/\r\n?|\n/u).map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("<w:br/>");
    return `<w:r>${runProperties}${content}</w:r>`;
  }

  function paragraphXml(text, options) {
    const settings = options || {};
    // Порядок элементов внутри w:pPr задан схемой OOXML (CT_PPr):
    // pStyle, keepNext, keepLines, pageBreakBefore, widowControl, spacing, ind, jc, outlineLvl.
    const properties = [];
    if (settings.style) properties.push(`<w:pStyle w:val="${settings.style}"/>`);
    if (settings.keepNext) properties.push("<w:keepNext/>");
    if (settings.keepLines) properties.push("<w:keepLines/>");
    if (settings.pageBreakBefore) properties.push("<w:pageBreakBefore/>");
    properties.push("<w:widowControl/>");
    if (settings.spacingAfterTwips !== undefined || settings.lineTwips !== undefined) {
      const after = settings.spacingAfterTwips !== undefined ? ` w:after="${settings.spacingAfterTwips}"` : "";
      const line = settings.lineTwips !== undefined ? ` w:line="${settings.lineTwips}" w:lineRule="auto"` : "";
      properties.push(`<w:spacing w:before="0"${after}${line}/>`);
    }
    if (settings.indentTwips !== undefined) properties.push(`<w:ind w:firstLine="${settings.indentTwips}"/>`);
    if (settings.alignment) properties.push(`<w:jc w:val="${ALIGNMENT[settings.alignment] || "both"}"/>`);
    // Уровень структуры нужен полю TOC: без него оглавление собирается пустым.
    if (settings.outlineLevel !== undefined) {
      properties.push(`<w:outlineLvl w:val="${settings.outlineLevel}"/>`);
    }
    const paragraphProperties = properties.length ? `<w:pPr>${properties.join("")}</w:pPr>` : "";
    const runs = text ? runXml(text, settings) : "";
    return `<w:p>${paragraphProperties}${runs}</w:p>`;
  }

  function sectionPropertiesXml(profile, hasFooter) {
    const page = profile.layout.page;
    const width = FormatProfiles.mmToTwips(page.widthMm);
    const height = FormatProfiles.mmToTwips(page.heightMm);
    const top = FormatProfiles.mmToTwips(page.marginTopMm);
    const bottom = FormatProfiles.mmToTwips(page.marginBottomMm);
    const left = FormatProfiles.mmToTwips(page.marginLeftMm);
    const right = FormatProfiles.mmToTwips(page.marginRightMm);

    // titlePg без footerReference типа first оставляет первую страницу без
    // колонтитула — титульный лист не нумеруется (§5.1).
    const footer = hasFooter ? '<w:footerReference w:type="default" r:id="rId2"/>' : "";
    const titlePage = hasFooter && profile.layout.pageNumbers.skipFirstPage ? "<w:titlePg/>" : "";

    return (
      `<w:sectPr>${footer}${titlePage}` +
      `<w:pgSz w:w="${width}" w:h="${height}"/>` +
      `<w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}"` +
      ' w:header="708" w:footer="708" w:gutter="0"/>' +
      "</w:sectPr>"
    );
  }

  function normalizeTableData(block) {
    if (block.type === "table") {
      const matrix = (block.lines || [])
        .map((line) => String(line).split("\t").map((cell) => cell.trim()))
        .filter((row) => row.some(Boolean));
      const columnCount = Math.max(1, ...matrix.map((row) => row.length));
      const padded = matrix.map((row) => Array.from({ length: columnCount }, (_unused, index) => row[index] || ""));
      return {
        columns: padded[0] || [""],
        rows: padded.slice(1),
      };
    }

    const columns = Array.isArray(block.columns) && block.columns.length ? block.columns.map(String) : [""];
    const rows = (block.rows || []).map((row) => {
      if (Array.isArray(row)) return columns.map((_column, index) => String(row[index] || ""));
      return columns.map((_column, index) => (index === 0 ? String(row || "") : ""));
    });
    return { columns, rows };
  }

  function calculateColumnWidths(data, totalTwips) {
    const weights = data.columns.map((heading, columnIndex) => {
      const lengths = [heading, ...data.rows.map((row) => row[columnIndex] || "")].map((value) => String(value).length);
      return Math.max(7, Math.min(38, Math.max(...lengths)));
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    // Даже очень широкая пользовательская TSV-таблица должна оставаться
    // валидной: базовая ширина уменьшается, если 640 твипов уже не помещаются.
    const minimum = Math.max(1, Math.min(640, Math.floor(totalTwips / weights.length)));
    const distributable = Math.max(0, totalTwips - minimum * weights.length);
    const widths = weights.map((weight) => minimum + Math.floor((distributable * weight) / totalWeight));
    const difference = totalTwips - widths.reduce((sum, width) => sum + width, 0);
    widths[widths.length - 1] += difference;
    return widths;
  }

  function tableXml(block, profile) {
    const layout = profile.layout;
    const page = layout.page;
    const usableMm = page.widthMm - page.marginLeftMm - page.marginRightMm;
    const totalTwips = FormatProfiles.mmToTwips(usableMm);
    const data = normalizeTableData(block);
    const columnCount = data.columns.length;
    const columnWidths = calculateColumnWidths(data, totalTwips);

    const borders =
      "<w:tblBorders>" +
      ["top", "left", "bottom", "right", "insideH", "insideV"]
        .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
        .join("") +
      "</w:tblBorders>";

    const grid =
      "<w:tblGrid>" +
      columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join("") +
      "</w:tblGrid>";

    function cell(text, columnIndex, options) {
      const settings = options || {};
      const paragraph = paragraphXml(text, {
        alignment: settings.alignment || "left",
        indentTwips: 0,
        lineTwips: lineSpacingToTwips(layout.body.lineSpacing),
        spacingAfterTwips: 0,
        bold: settings.bold,
        keepNext: settings.header && data.rows.length > 0,
      });
      return (
        `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[columnIndex]}" w:type="dxa"/>` +
        `${settings.header ? '<w:shd w:val="clear" w:color="auto" w:fill="EAF0FA"/>' : ""}<w:vAlign w:val="center"/>` +
        `</w:tcPr>${paragraph}</w:tc>`
      );
    }

    // Заголовочная строка повторяется на каждой странице (§5.1: таблица
    // читается и при переносе).
    const headerRow =
      '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
      data.columns.map((title, index) => cell(title, index, { bold: true, alignment: "center", header: true })).join("") +
      "</w:tr>";

    const bodyRows = data.rows
      .map((row) => {
        const cells = row.map((value, index) => {
          const numeric = /^\s*-?[\d\s.,%–—-]+\s*$/u.test(value) && /\d/u.test(value);
          return cell(value, index, { alignment: numeric ? "center" : "left" });
        });
        while (cells.length < columnCount) cells.push(cell("", cells.length));
        // Only short rows stay intact. Large narrative cells must be allowed
        // to flow across pages rather than overflow or leave a blank page.
        const short = row.every((value, i) => {
          const chars = Math.max(1, Math.floor((columnWidths[i] - 200) / (layout.font.sizePt * 11)));
          return String(value).split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0) <= 8;
        });
        return `<w:tr>${short ? '<w:trPr><w:cantSplit/></w:trPr>' : ""}${cells.join("")}</w:tr>`;
      })
      .join("");

    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${totalTwips}" w:type="dxa"/>` +
      borders +
      '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>' +
      '<w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr>' +
      `${grid}${headerRow}${bodyRows}</w:tbl>`
    );
  }

  function tocXml(profile) {
    // Поле TOC: Word проставляет номера страниц при открытии документа,
    // поэтому оглавление не нужно собирать вручную (§3.1).
    const lineTwips = lineSpacingToTwips(profile.layout.body.lineSpacing);
    return (
      "<w:p><w:pPr><w:ind w:firstLine=\"0\"/>" +
      `<w:spacing w:before="0" w:after="0" w:line="${lineTwips}" w:lineRule="auto"/></w:pPr>` +
      '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      "<w:r><w:t>Обновите поле в Word: правый клик по оглавлению → Update field.</w:t></w:r>" +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      "</w:p>"
    );
  }

  function headingLabel(block, profile) {
    const title = profile.layout.heading.uppercase && block.level === 1
      ? String(block.title).toLocaleUpperCase("ru")
      : block.title;
    if (block.kind === "appendix") {
      const label = block.number ? `Appendix ${block.number}` : "Appendix";
      return title ? `${label}. ${title}` : label;
    }
    return block.number ? `${block.number}. ${title}` : String(title);
  }

  function blockParagraphs(block, profile, state) {
    if (block.type === "imageMissing") throw new Error("Прикрепите недоступное фото перед экспортом.");
    if (block.type === "image") return [Images.drawing(block, ++state.imageIndex, profile.layout.page, escapeXml)];
    const layout = profile.layout;
    const bodyIndent = FormatProfiles.cmToTwips(layout.body.firstLineIndentCm);
    const lineTwips = lineSpacingToTwips(layout.body.lineSpacing);

    if (block.type === "heading") {
      const isTopLevel = block.level === 1;
      return [
        paragraphXml(headingLabel(block, profile), {
          style: isTopLevel ? "SectionHeading" : "SubsectionHeading",
          keepNext: true,
          keepLines: true,
          alignment: layout.heading.alignment,
          indentTwips: FormatProfiles.cmToTwips(layout.heading.firstLineIndentCm),
          lineTwips: lineSpacingToTwips(layout.heading.lineSpacing),
          // §5.1: одна дополнительная строка между заголовком и текстом.
          spacingAfterTwips: layout.heading.trailingBlankLine ? lineTwips : 0,
          // §5.1: каждая глава и каждая основная структурная часть — с новой
          // страницы. Первый блок документа разрыва не получает.
          pageBreakBefore: isTopLevel && layout.heading.pageBreakBeforeTopLevel && state.emitted > 0,
          outlineLevel: Math.min(2, Math.max(0, (block.level || 1) - 1)),
        }),
      ];
    }

    if (block.type === "plain") {
      return [
        paragraphXml(block.text, {
          alignment: block.alignment,
          indentTwips: 0,
          lineTwips,
          spacingAfterTwips: 0,
          bold: block.bold,
          pageBreakBefore: block.pageBreakBefore && state.emitted > 0,
        }),
      ];
    }

    if (block.type === "pageBreak") {
      return [paragraphXml("", { pageBreakBefore: state.emitted > 0, indentTwips: 0 })];
    }

    if (block.type === "toc") {
      return [tocXml(profile)];
    }

    if (block.type === "docTable" || block.type === "table") {
      const result = [];
      if (state.lastType === "docTable" || state.lastType === "table") {
        result.push(paragraphXml("", { alignment: "both", indentTwips: 0, spacingAfterTwips: 0 }));
      }
      result.push(tableXml(block, profile));
      return result;
    }

    if (block.type === "sourceNote") {
      return [
        paragraphXml(block.text, {
          alignment: block.alignment || "right",
          indentTwips: 0,
          lineTwips,
          spacingAfterTwips: 0,
          italic: true,
          keepLines: block.text.length <= 500,
        }),
      ];
    }

    if (block.type === "caption") {
      const label = block.title ? `${block.prefix} ${block.number}. ${block.title}` : `${block.prefix} ${block.number}`;
      return [
        paragraphXml(label, {
          style: "Caption",
          keepNext: (block.position || profile.captions[block.kind].position) === "above",
          keepLines: label.length <= 500,
          alignment: block.alignment || profile.captions[block.kind].alignment,
          indentTwips: 0,
          lineTwips,
          spacingAfterTwips: 0,
        }),
      ];
    }

    if (block.type === "list") {
      return block.lines.map((line) =>
        paragraphXml(line, {
          alignment: "left",
          indentTwips: 0,
          lineTwips,
          spacingAfterTwips: 0,
        }),
      );
    }

    return [
      paragraphXml(block.text, {
        alignment: layout.body.alignment,
        indentTwips: bodyIndent,
        lineTwips,
        spacingAfterTwips: pointsToTwips(layout.body.spacingAfterPt),
      }),
    ];
  }

  function buildDocumentXml(blocks, profile) {
    const state = { emitted: 0, imageIndex: 0 };
    const body = [];
    for (const block of blocks) {
      const paragraphs = blockParagraphs(block, profile, state);
      body.push(...paragraphs);
      state.emitted += 1;
      state.lastType = block.type;
    }
    const hasFooter = profile.layout.pageNumbers.enabled;
    return (
      `${XML_HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>` +
      body.join("") +
      sectionPropertiesXml(profile, hasFooter) +
      "</w:body></w:document>"
    );
  }

  function buildStylesXml(profile) {
    const layout = profile.layout;
    const font = escapeXml(layout.font.family);
    const size = pointsToHalfPoints(layout.font.sizePt);
    const lineTwips = lineSpacingToTwips(layout.body.lineSpacing);
    const bodyIndent = FormatProfiles.cmToTwips(layout.body.firstLineIndentCm);

    const runDefaults =
      `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>` +
      `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
    const paragraphDefaults =
      `<w:pPr><w:spacing w:before="0" w:after="0" w:line="${lineTwips}" w:lineRule="auto"/>` +
      `<w:jc w:val="${ALIGNMENT[layout.body.alignment] || "both"}"/>` +
      `<w:ind w:firstLine="${bodyIndent}"/></w:pPr>`;

    const headingAlignment = ALIGNMENT[layout.heading.alignment] || "center";
    // Шрифт и кегль дублируются в стиле Normal: docDefaults Word понимает,
    // но часть конвертеров и валидаторов читает только сам стиль.
    const headingProperties = `<w:pPr><w:jc w:val="${headingAlignment}"/><w:ind w:firstLine="0"/></w:pPr>`;

    return (
      `${XML_HEAD}<w:styles xmlns:w="${NS_W}">` +
      `<w:docDefaults><w:rPrDefault>${runDefaults}</w:rPrDefault>` +
      `<w:pPrDefault>${paragraphDefaults}</w:pPrDefault></w:docDefaults>` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      `${paragraphDefaults}${runDefaults}</w:style>` +
      '<w:style w:type="paragraph" w:styleId="SectionHeading"><w:name w:val="Section Heading"/>' +
      `<w:basedOn w:val="Normal"/>${headingProperties}</w:style>` +
      '<w:style w:type="paragraph" w:styleId="SubsectionHeading"><w:name w:val="Subsection Heading"/>' +
      `<w:basedOn w:val="Normal"/>${headingProperties}</w:style>` +
      '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>' +
      "</w:styles>"
    );
  }

  function buildFooterXml(profile) {
    const alignment = ALIGNMENT[profile.layout.pageNumbers.alignment] || "center";
    return (
      `${XML_HEAD}<w:ftr xmlns:w="${NS_W}"><w:p><w:pPr>` +
      `<w:jc w:val="${alignment}"/><w:ind w:firstLine="0"/></w:pPr>` +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      "<w:r><w:t>1</w:t></w:r>" +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      "</w:p></w:ftr>"
    );
  }

  function buildSettingsXml() {
    // updateFields заставляет Word пересобрать поле TOC при открытии файла.
    return (
      `${XML_HEAD}<w:settings xmlns:w="${NS_W}">` +
      '<w:updateFields w:val="true"/>' +
      "</w:settings>"
    );
  }

  function buildContentTypesXml(hasFooter) {
    const footer = hasFooter
      ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      : "";
    return (
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      `${footer}</Types>`
    );
  }

  function buildRootRelsXml() {
    return (
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/>` +
      "</Relationships>"
    );
  }

  function buildDocumentRelsXml(hasFooter) {
    const footer = hasFooter ? `<Relationship Id="rId2" Type="${NS_R}/footer" Target="footer1.xml"/>` : "";
    return (
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS_R}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId3" Type="${NS_R}/settings" Target="settings.xml"/>` +
      `${footer}</Relationships>`
    );
  }

  function buildPackage(blocks, profile) {
    Images.validate(blocks);
    const hasFooter = profile.layout.pageNumbers.enabled;
    const parts = {
      "[Content_Types].xml": buildContentTypesXml(hasFooter),
      "_rels/.rels": buildRootRelsXml(),
      "word/document.xml": buildDocumentXml(blocks, profile),
      "word/styles.xml": buildStylesXml(profile),
      "word/_rels/document.xml.rels": buildDocumentRelsXml(hasFooter),
      "word/settings.xml": buildSettingsXml(),
    };
    if (hasFooter) parts["word/footer1.xml"] = buildFooterXml(profile);
    let index = 0;
    const formats = new Set();
    for (const block of blocks.filter((item) => item.type === "image")) {
      const info = Images.read(block.dataUrl); index++;
      const name = `image${index}.${info.extension}`;
      parts[`word/media/${name}`] = info.bytes;
      parts["word/_rels/document.xml.rels"] = parts["word/_rels/document.xml.rels"].replace("</Relationships>",
        `<Relationship Id="rIdImage${index}" Type="${NS_R}/image" Target="media/${name}"/></Relationships>`);
      if (!formats.has(info.extension)) {
        parts["[Content_Types].xml"] = parts["[Content_Types].xml"].replace("</Types>", `<Default Extension="${info.extension}" ContentType="${info.mime}"/></Types>`);
        formats.add(info.extension);
      }
    }
    return parts;
  }

  /**
   * Собирает .docx в браузере. JSZip страница уже загружает для чтения xlsx,
   * поэтому дополнительной зависимости не появляется.
   */
  async function createDocxBlob(blocks, profile, zipLibrary) {
    const JSZipRef = zipLibrary || (typeof window !== "undefined" ? window.JSZip : null);
    if (!JSZipRef) throw new Error("Библиотека упаковки не загрузилась. Обновите страницу.");

    const zip = new JSZipRef();
    const parts = buildPackage(blocks, profile);
    for (const [path, content] of Object.entries(parts)) {
      zip.file(path, content);
    }
    return zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      compression: "DEFLATE",
    });
  }

  return {
    buildDocumentXml,
    buildStylesXml,
    buildFooterXml,
    buildSettingsXml,
    buildPackage,
    createDocxBlob,
    escapeXml,
  };
});
