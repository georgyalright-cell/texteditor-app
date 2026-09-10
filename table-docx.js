(function attach(root) {
  "use strict";
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const SIDES = ["Top", "Bottom", "Left", "Right"];
  const nodes = (el, name) => Array.from(el && el.children || []).filter(n => n.localName === name);
  const one = (el, name) => nodes(el, name)[0];
  const descendants = (el, name) => Array.from(el && el.getElementsByTagNameNS(W, name) || []);
  const attr = (el, key = "val") => el ? el.getAttributeNS(W, key) || el.getAttribute(`w:${key}`) : null;
  const esc = value => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const on = el => !!el && !/^(0|false|off)$/i.test(attr(el) || "");
  const pt = value => `${Number(value) / 20}pt`;
  const color = value => /^[0-9a-f]{6}$/i.test(value || "") ? `#${value.toUpperCase()}` : null;
  function assign(out, name, value) { if (value !== null && value !== undefined && value !== "") out[name] = value; }
  function width(el) {
    const n = Number(attr(el, "w")), type = attr(el, "type");
    return el && Number.isFinite(n) && n >= 0 ? type === "pct" ? `${n / 50}%` : type === "dxa" || !type ? pt(n) : null : null;
  }
  function border(el) {
    if (!el) return null;
    const val = attr(el);
    if (val === "nil" || val === "none") return "none";
    const kind = { single: "solid", double: "double", dotted: "dotted", dashed: "dashed", dashSmallGap: "dashed" }[val];
    if (!kind) return null;
    const size = Number(attr(el, "sz") || 4) / 8;
    return `${size}pt ${kind} ${color(attr(el, "color")) || "#000000"}`;
  }
  function common(pr) {
    const s = {};
    assign(s, "backgroundColor", color(attr(one(pr, "shd"), "fill")));
    const vertical = { center: "middle", top: "top", bottom: "bottom" }[attr(one(pr, "vAlign"))];
    assign(s, "verticalAlign", vertical);
    return s;
  }
  function runStyle(pr) {
    const s = common(pr), fonts = one(pr, "rFonts");
    assign(s, "fontFamily", attr(fonts, "ascii") || attr(fonts, "hAnsi") || attr(fonts, "cs"));
    if (one(pr, "sz")) assign(s, "fontSize", `${Number(attr(one(pr, "sz"))) / 2}pt`);
    assign(s, "color", color(attr(one(pr, "color"))));
    if (one(pr, "b")) s.fontWeight = on(one(pr, "b")) ? "bold" : "normal";
    if (one(pr, "i")) s.fontStyle = on(one(pr, "i")) ? "italic" : "normal";
    if (one(pr, "u")) s.textDecoration = attr(one(pr, "u")) === "none" ? "none" : "underline";
    if (one(pr, "strike")) s.textDecoration = on(one(pr, "strike")) ? "line-through" : "none";
    return s;
  }
  function paragraphStyle(pr) {
    const s = common(pr), spacing = one(pr, "spacing");
    assign(s, "textAlign", { left: "left", start: "left", right: "right", end: "right", center: "center", both: "justify" }[attr(one(pr, "jc"))]);
    if (attr(spacing, "before") !== null) s.marginTop = pt(attr(spacing, "before"));
    if (attr(spacing, "after") !== null) s.marginBottom = pt(attr(spacing, "after"));
    if (attr(spacing, "line") !== null) s.lineHeight = attr(spacing, "lineRule") === "auto" || !attr(spacing, "lineRule")
      ? String(Number(attr(spacing, "line")) / 240) : pt(attr(spacing, "line"));
    return s;
  }
  function cellStyle(pr) {
    const s = common(pr), borders = one(pr, "tcBorders"), margins = one(pr, "tcMar");
    assign(s, "width", width(one(pr, "tcW")));
    for (const side of SIDES) {
      const name = side.toLowerCase();
      assign(s, `border${side}`, border(one(borders, name)));
      assign(s, `padding${side}`, width(one(margins, name)));
    }
    return s;
  }
  function tableStyle(pr) {
    const s = common(pr), borders = one(pr, "tblBorders"), margins = one(pr, "tblCellMar");
    assign(s, "width", width(one(pr, "tblW")));
    assign(s, "textAlign", { left: "left", center: "center", right: "right" }[attr(one(pr, "jc"))]);
    for (const side of SIDES) {
      assign(s, `border${side}`, border(one(borders, side.toLowerCase())));
      assign(s, `padding${side}`, width(one(margins, side.toLowerCase())));
    }
    return s;
  }
  function styleReader(doc) {
    const styles = new Map(descendants(doc, "style").map(el => [attr(el, "styleId"), el]));
    const defaults = descendants(doc, "docDefaults")[0];
    function chain(id, seen = new Set()) {
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const el = styles.get(id);
      return el ? [...chain(attr(one(el, "basedOn")), seen), el] : [];
    }
    const defaultId = type => Array.from(styles.values()).find(el => attr(el, "type") === type && /^(1|true|on)$/.test(attr(el, "default") || ""));
    return {
      defaults: {
        run: runStyle(one(one(defaults, "rPrDefault"), "rPr")),
        paragraph: paragraphStyle(one(one(defaults, "pPrDefault"), "pPr")),
      },
      chain(id, type) { return chain(id || attr(defaultId(type), "styleId")); },
    };
  }
  function inherit(list, name, read) { return Object.assign({}, ...list.map(el => read(one(el, name)))); }
  function textOf(run) {
    let text = "";
    for (const el of Array.from(run.childNodes || [])) {
      if (el.nodeType !== 1) continue;
      if (el.localName === "t") text += el.textContent || "";
      else if (el.localName === "tab") text += "\t";
      else if (el.localName === "br" || el.localName === "cr") text += "\n";
      else if (el.localName === "noBreakHyphen") text += "\u2011";
      else if (el.localName === "softHyphen") text += "\u00ad";
    }
    return text;
  }
  function readParagraph(el, reader, inheritedRun, inheritedParagraph, relationships) {
    const pr = one(el, "pPr"), chain = reader.chain(attr(one(pr, "pStyle")), "paragraph");
    const style = Object.assign({}, reader.defaults.paragraph, inheritedParagraph, inherit(chain, "pPr", paragraphStyle), paragraphStyle(pr));
    const baseRun = Object.assign({}, reader.defaults.run, inheritedRun, inherit(chain, "rPr", runStyle));
    const runs = descendants(el, "r").map(run => {
      const rPr = one(run, "rPr"), rChain = reader.chain(attr(one(rPr, "rStyle")), "character");
      const link = run.parentElement && run.parentElement.localName === "hyperlink" ? run.parentElement : null;
      const id = link && (link.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || link.getAttribute("r:id"));
      const target = id && relationships && (typeof relationships.get === "function" ? relationships.get(id) : relationships[id]);
      const href = typeof target === "string" ? target : target && (target.Target || target.target);
      return { text: textOf(run), style: Object.assign({}, baseRun, inherit(rChain, "rPr", runStyle), runStyle(rPr)),
        ...(/^https?:\/\/[^\s<>"\x00-\x1f]+$/iu.test(href || "") ? { href } : {}) };
    });
    return { style, runs };
  }
  function readTable(el, stylesDocument, relationships) {
    if (!el || el.localName !== "tbl") throw new Error("Не найдена таблица DOCX.");
    if (descendants(el, "tbl").length || descendants(el, "drawing").length || descendants(el, "pict").length)
      throw new Error("Таблица содержит вложенную таблицу или изображение. Импорт остановлен, чтобы не потерять оформление.");
    if (["oMath", "oMathPara", "object", "altChunk"].some(name => el.getElementsByTagNameNS("*", name).length))
      throw new Error("Таблица содержит формулу или встроенный объект. Импорт остановлен, чтобы сохранить содержимое.");
    const reader = styleReader(stylesDocument), pr = one(el, "tblPr");
    const chain = reader.chain(attr(one(pr, "tblStyle")), "table");
    const style = Object.assign({}, inherit(chain, "tblPr", tableStyle), tableStyle(pr));
    const baseRun = inherit(chain, "rPr", runStyle), baseP = inherit(chain, "pPr", paragraphStyle);
    const baseCell = inherit(chain, "tcPr", cellStyle);
    const looks = [...chain.map(s => one(one(s, "tblPr"), "tblLook")), one(pr, "tblLook")].filter(Boolean);
    const look = (name, bit) => {
      let enabled = false;
      for (const el of looks) {
        if (attr(el)) enabled = !!(parseInt(attr(el), 16) & bit);
        if (attr(el, name) !== null) enabled = /^(1|true|on)$/.test(attr(el, name));
      }
      return enabled;
    };
    function conditional(ri, ci, span, width) {
      const types = ["wholeTable"];
      if (!look("noVBand", 0x400)) types.push(ci % 2 ? "band2Vert" : "band1Vert");
      if (!look("noHBand", 0x200)) types.push((ri - (look("firstRow", 0x20) ? 1 : 0)) % 2 ? "band2Horz" : "band1Horz");
      if (ci === 0 && look("firstColumn", 0x80)) types.push("firstCol");
      if (ci + span === width && look("lastColumn", 0x100)) types.push("lastCol");
      if (ri === 0 && look("firstRow", 0x20)) types.push("firstRow");
      if (ri === sourceRows.length - 1 && look("lastRow", 0x40)) types.push("lastRow");
      return types.flatMap(type => chain.flatMap(style => nodes(style, "tblStylePr").filter(n => attr(n, "type") === type)));
    }
    const borderPrs = [...chain.map(s => one(one(s, "tblPr"), "tblBorders")), one(pr, "tblBorders")].filter(Boolean);
    const inheritedBorders = {};
    for (const borders of borderPrs) for (const side of ["top", "bottom", "left", "right", "insideH", "insideV"])
      assign(inheritedBorders, side, border(one(borders, side)));
    const columnWidths = nodes(one(el, "tblGrid"), "gridCol").map(n => pt(attr(n, "w") || 0));
    const sourceRows = nodes(el, "tr"), rows = [], matrix = [], active = new Map(), explicitBottom = new WeakSet();
    let count = columnWidths.length || nodes(sourceRows[0], "tc").reduce((n, tc) => n + Number(attr(one(one(tc, "tcPr"), "gridSpan")) || 1), 0);
    sourceRows.forEach((tr, ri) => {
      const trPr = one(tr, "trPr"), before = Number(attr(one(trPr, "gridBefore")) || 0);
      if (before || Number(attr(one(trPr, "gridAfter")) || 0)) throw new Error("Таблица DOCX содержит неполные строки; импорт остановлен без потери данных.");
      const row = { header: on(one(trPr, "tblHeader")), style: {}, cells: [] }, line = [];
      const height = one(trPr, "trHeight");
      if (height) row.style[attr(height, "hRule") === "exact" ? "height" : "minHeight"] = pt(attr(height));
      let column = 0;
      const nextActive = new Map();
      for (const tc of nodes(tr, "tc")) {
        if (Array.from(tc.children).some(child => !["tcPr", "p", "bookmarkStart", "bookmarkEnd", "proofErr"].includes(child.localName)))
          throw new Error("В ячейке есть неподдерживаемый блок. Импорт остановлен без упрощения таблицы.");
        const tcPr = one(tc, "tcPr"), colSpan = Number(attr(one(tcPr, "gridSpan")) || 1), merge = one(tcPr, "vMerge");
        if (!Number.isInteger(colSpan) || colSpan < 1 || colSpan > 1000) throw new Error("Некорректное объединение ячеек DOCX.");
        const conditions = conditional(ri, column, colSpan, count);
        const inheritedRun = { ...baseRun, ...inherit(conditions, "rPr", runStyle) };
        const inheritedP = { ...baseP, ...inherit(conditions, "pPr", paragraphStyle) };
        const paragraphs = nodes(tc, "p").map(p => readParagraph(p, reader, inheritedRun, inheritedP, relationships));
        const text = paragraphs.map(p => p.runs.map(r => r.text).join("")).join("\n");
        if (merge && attr(merge) !== "restart") {
          const owner = active.get(column);
          if (!owner || owner.colSpan !== colSpan || text.trim()) throw new Error("Не удалось безопасно восстановить объединённые ячейки DOCX.");
          owner.rowSpan += 1;
          const bottom = cellStyle(tcPr).borderBottom;
          if (bottom) { owner.style.borderBottom = bottom; explicitBottom.add(owner); }
          else if (!explicitBottom.has(owner)) assign(owner.style, "borderBottom", inheritedBorders[ri === sourceRows.length - 1 ? "bottom" : "insideH"]);
          nextActive.set(column, owner);
        } else {
          const cell = { column, colSpan, rowSpan: 1, text, style: Object.assign({}, baseCell, inherit(conditions, "tcPr", cellStyle), cellStyle(tcPr)), paragraphs };
          if (cell.style.borderBottom) explicitBottom.add(cell);
          for (const side of SIDES) {
            const edge = side === "Top" ? ri === 0 : side === "Bottom" ? ri === sourceRows.length - 1 : side === "Left" ? column === 0 : column + colSpan === count;
            if (!cell.style[`border${side}`]) assign(cell.style, `border${side}`, inheritedBorders[edge ? side.toLowerCase() : side === "Top" || side === "Bottom" ? "insideH" : "insideV"]);
          }
          row.cells.push(cell);
          line[column] = text;
          if (merge) nextActive.set(column, cell);
        }
        for (let k = 0; k < colSpan; k++) if (line[column + k] === undefined) line[column + k] = "";
        column += colSpan;
      }
      if (!column) throw new Error("Пустая строка таблицы DOCX.");
      if (count && count !== column) throw new Error("Непрямоугольная таблица DOCX: импорт остановлен без изменения данных.");
      count = column;
      active.clear(); nextActive.forEach((v, k) => active.set(k, v));
      rows.push(row); matrix.push(line);
    });
    if (!rows.length) throw new Error("Таблица DOCX не содержит строк.");
    return { type: "docTable", columns: matrix[0], rows: matrix.slice(1), tableFormat: { version: 1, style, columnWidths, rows } };
  }
  function twips(value, reference = 9000) {
    const match = /^([\d.]+)(pt|px|cm|mm|in|%)$/.exec(String(value || ""));
    if (!match) return null;
    const n = Number(match[1]);
    return Math.round(n * ({ pt: 20, px: 15, cm: 1440 / 2.54, mm: 1440 / 25.4, in: 1440, "%": reference / 100 }[match[2]]));
  }
  function wWidth(name, value, reference) {
    if (!value) return "";
    const percent = String(value).endsWith("%"), n = percent ? Math.round(parseFloat(value) * 50) : twips(value, reference);
    return n === null ? "" : `<w:${name} w:w="${n}" w:type="${percent ? "pct" : "dxa"}"/>`;
  }
  function bordersXml(name, style) {
    const edges = SIDES.map(side => {
      const value = style[`border${side}`];
      if (!value) return "";
      if (value === "none") return `<w:${side.toLowerCase()} w:val="nil"/>`;
      const match = /^([\d.]+(?:pt|px|cm|mm|in)) (solid|double|dotted|dashed) (#[0-9a-f]{6})$/i.exec(value);
      return match ? `<w:${side.toLowerCase()} w:val="${{ solid: "single", double: "double", dotted: "dotted", dashed: "dashed" }[match[2]]}" w:sz="${Math.max(1, Math.round(twips(match[1]) / 2.5))}" w:color="${match[3].slice(1)}"/>` : "";
    }).join("");
    return edges ? `<w:${name}>${edges}</w:${name}>` : "";
  }
  function marginsXml(name, style) {
    const values = SIDES.map(side => wWidth(side.toLowerCase(), style[`padding${side}`])).join("");
    return values ? `<w:${name}>${values}</w:${name}>` : "";
  }
  const shade = style => /^#[0-9a-f]{6}$/i.test(style.backgroundColor || "") ? `<w:shd w:val="clear" w:fill="${esc(style.backgroundColor.slice(1))}"/>` : "";
  function runXml(run, inherited) {
    const s = { ...inherited, ...run.style }, properties = [];
    if (s.fontFamily) properties.push(`<w:rFonts w:ascii="${esc(s.fontFamily)}" w:hAnsi="${esc(s.fontFamily)}" w:cs="${esc(s.fontFamily)}"/>`);
    if (s.fontSize) properties.push(`<w:sz w:val="${Math.round(twips(s.fontSize) / 10)}"/>`);
    if (s.fontWeight) properties.push(`<w:b w:val="${s.fontWeight === "bold" ? 1 : 0}"/>`);
    if (s.fontStyle) properties.push(`<w:i w:val="${s.fontStyle === "italic" ? 1 : 0}"/>`);
    if (/^#[0-9a-f]{6}$/i.test(s.color || "")) properties.push(`<w:color w:val="${esc(s.color.slice(1))}"/>`);
    if (s.textDecoration) properties.push(`<w:u w:val="${s.textDecoration === "underline" ? "single" : "none"}"/><w:strike w:val="${s.textDecoration === "line-through" ? 1 : 0}"/>`);
    properties.push(shade(s));
    const text = String(run.text || "").split(/([\n\t])/).map(part => part === "\n" ? "<w:br/>" : part === "\t" ? "<w:tab/>" : `<w:t xml:space="preserve">${esc(part)}</w:t>`).join("");
    const result = `<w:r><w:rPr>${properties.join("")}</w:rPr>${text}</w:r>`;
    return /^https?:\/\/[^\s<>"\x00-\x1f]+$/iu.test(run.href || "") ? `<w:fldSimple w:instr="${esc(` HYPERLINK "${run.href}" `)}">${result}</w:fldSimple>` : result;
  }
  function paragraphXml(paragraph, inherited) {
    const s = { ...inherited, ...paragraph.style }, props = [];
    props.push(`<w:jc w:val="${s.textAlign === "justify" ? "both" : s.textAlign || "left"}"/>`);
    const line = /^\d+(?:\.\d+)?$/.test(s.lineHeight || "") ? Math.round(Number(s.lineHeight) * 240) : twips(s.lineHeight);
    props.push(`<w:spacing w:before="${twips(s.marginTop) || 0}" w:after="${twips(s.marginBottom) || 0}"${line !== null ? ` w:line="${line}" w:lineRule="${/^\d+(?:\.\d+)?$/.test(s.lineHeight || "") ? "auto" : "exact"}"` : ""}/>`);
    props.push('<w:ind w:firstLine="0"/>');
    return `<w:p><w:pPr>${props.join("")}</w:pPr>${paragraph.runs.map(run => runXml(run, s)).join("")}</w:p>`;
  }
  function xml(block, profile) {
    const normalize = root.TableFormat || (typeof require === "function" ? require("./table-format.js") : null);
    const format = normalize && normalize.normalize(block);
    if (!format) throw new Error("Оформление таблицы повреждено; экспорт остановлен, чтобы не изменить таблицу.");
    const page = profile && profile.layout && profile.layout.page || {};
    const available = Math.round(((page.widthMm || 210) - (page.marginLeftMm || 25) - (page.marginRightMm || 25)) * 1440 / 25.4);
    const s = format.style, total = twips(s.width, available) || available;
    const grid = format.columnWidths.map(w => twips(w, total)), hasGrid = grid.length && grid.every(v => v > 0);
    const props = wWidth("tblW", s.width || "100%", available) + bordersXml("tblBorders", s) + marginsXml("tblCellMar", s) + shade(s)
      + (s.textAlign && s.textAlign !== "justify" ? `<w:jc w:val="${s.textAlign}"/>` : "");
    const tableGrid = hasGrid ? `<w:tblGrid>${grid.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` : "<w:tblGrid/>";
    const font = profile && profile.layout && profile.layout.font || {};
    const inherited = { fontFamily: font.family || "Times New Roman", fontSize: `${font.sizePt || 12}pt`, ...s };
    const rows = format.rows.map((row, ri) => {
      const entries = row.cells.map(cell => ({ cell, continuation: false }));
      for (let previous = 0; previous < ri; previous++) for (const cell of format.rows[previous].cells)
        if (previous + cell.rowSpan > ri) entries.push({ cell, continuation: true });
      entries.sort((a, b) => a.cell.column - b.cell.column);
      const cells = entries.map(({ cell, continuation }) => {
        const style = { ...s, ...row.style, ...cell.style };
        let properties = wWidth("tcW", cell.style.width, total);
        if (!properties && hasGrid) properties = `<w:tcW w:w="${grid.slice(cell.column, cell.column + cell.colSpan).reduce((a, b) => a + b, 0)}" w:type="dxa"/>`;
        if (cell.colSpan > 1) properties += `<w:gridSpan w:val="${cell.colSpan}"/>`;
        if (cell.rowSpan > 1) properties += `<w:vMerge${continuation ? "" : ' w:val="restart"'}/>`;
        properties += bordersXml("tcBorders", cell.style) + marginsXml("tcMar", style) + shade(style);
        if (style.verticalAlign) properties += `<w:vAlign w:val="${style.verticalAlign === "middle" ? "center" : style.verticalAlign}"/>`;
        const paragraphs = cell.paragraphs.length ? cell.paragraphs : [{ style: {}, runs: [{ text: cell.text, style: {} }] }];
        return `<w:tc><w:tcPr>${properties}</w:tcPr>${continuation ? "<w:p/>" : paragraphs.map(p => paragraphXml(p, { ...inherited, ...row.style, ...cell.style })).join("")}</w:tc>`;
      }).join("");
      const height = row.style.height || row.style.minHeight;
      const props = (row.header ? "<w:tblHeader/>" : "") + (height ? `<w:trHeight w:val="${twips(height)}" w:hRule="${row.style.height ? "exact" : "atLeast"}"/>` : "");
      return `<w:tr><w:trPr>${props}</w:trPr>${cells}</w:tr>`;
    }).join("");
    return `<w:tbl><w:tblPr>${props}</w:tblPr>${tableGrid}${rows}</w:tbl>`;
  }
  const api = { readTable, xml };
  root.TableDocx = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
