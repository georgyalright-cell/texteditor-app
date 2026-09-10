(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DocumentLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";
  const mediaKind = (b) => b && (/^(table|docTable)$/u.test(b.type) ? "table" : /^(image|imageMissing)$/u.test(b.type) ? "figure" : "");
  const kindOf = (prefix) => /^(table|табл)/iu.test(prefix) ? "table" : "figure";
  function caption(text, hint) {
    // A reference sentence ("Table 2 shows …") is NOT a caption.
    const match = /^(Table|Figure|Fig\.|Таблица|Рисунок|Рис\.)\s+(\d+(?:\.\d+)*)(?:\s*[.:–—-]\s*(.*))?$/iu.exec(String(text).trim());
    if (match) return { type: "caption", kind: kindOf(match[1]), prefix: match[1], number: match[2], title: match[3] || "" };
    return hint ? { type: "caption", kind: hint, number: "", title: String(text).trim() } : null;
  }
  function prepare(blocks) {
    const result = structuredClone(blocks);
    for (let i = 0; i < result.length; i++) {
      const block = result[i];
      if (block.type === "paragraph") {
        const parsed = caption(block.text);
        if (parsed && [result[i - 1], result[i + 1]].some((b) => mediaKind(b) === parsed.kind)) result[i] = parsed;
      }
    }
    for (let i = 0; i < result.length; i++) {
      const b = result[i], previous = result[i - 1], before = result[i - 2];
      if (b.type === "caption" && b.number) {
        b.retainNumber = true;
        b.prefix = b.prefix || caption(b.raw || "")?.prefix || (b.kind === "table" ? "Table" : "Figure");
      }
      if (b.type === "paragraph" && /^(?:Sources?|Источник(?:и)?)\s*:/iu.test(b.text) &&
          (mediaKind(previous) || (previous?.type === "caption" && mediaKind(before)))) result[i] = { ...b, type: "sourceNote" };
    }
    return result;
  }
  function units(blocks) {
    const owners = new Map(), media = [];
    for (let i = 0; i < blocks.length; i++) {
      const kind = mediaKind(blocks[i]); if (!kind) continue;
      const unit = { index: i, kind, indices: [i], captionIndex: -1 }; media.push(unit); owners.set(i, unit);
    }
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]; if (b.type !== "caption") continue;
      const candidates = media.filter((u) => u.kind === b.kind && Math.abs(u.index - i) === 1 && u.captionIndex < 0 &&
        (b.layoutOwner === undefined || b.layoutOwner === blocks[u.index].layoutOwner));
      // Prefer the conventional position when captions sit between two objects.
      const owner = candidates.find((u) => b.kind === "table" ? u.index > i : u.index < i) || candidates[0];
      if (owner) { owner.captionIndex = i; owner.indices.push(i); owners.set(i, owner); }
    }
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type !== "sourceNote") continue;
      const owner = owners.get(i - 1);
      if (owner) { owner.indices.push(i); owners.set(i, owner); }
    }
    const seen = new Set(), result = [];
    for (let i = 0; i < blocks.length; i++) {
      const unit = owners.get(i) || { index: i, indices: [i] };
      if (!seen.has(unit)) { unit.indices.sort((a, b) => a - b); result.push(unit); seen.add(unit); }
    }
    return result;
  }
  function references(text) {
    const result = [];
    for (const m of String(text).matchAll(/(?:^|[^\p{L}\p{N}_])(Table|Figure|Fig\.|Таблиц[аеуы]?|Рисун(?:ок|ке|ка)|Рис\.)\s+(\d+(?:\.\d+)*)(?![\p{L}\p{N}_]|\.\d)/giu)) {
      result.push(`${kindOf(m[1])}:${m[2]}`);
    }
    return result;
  }
  function arrange(input) {
    const blocks = prepare(input), list = units(blocks), warnings = new Set(), labels = new Map(), anchors = new Map();
    if (blocks.some((b) => b.type === "docTable" ? b.columns.length > 8 : b.type === "table" && b.lines[0]?.split("\t").length > 8)) warnings.add("Широкая таблица: проверьте читаемость в Word. При необходимости разделите её или перенесите в приложение; шрифт автоматически не уменьшается.");
    for (const c of blocks) {
      if (c.type !== "caption" || !c.number) continue;
      const key = `${c.kind}:${c.number}`; labels.set(key, (labels.get(key) || 0) + 1);
    }
    let start = 0;
    for (let end = 0; end <= list.length; end++) {
      if (end < list.length && blocks[list[end].index].type !== "heading") continue;
      const section = list.slice(start, end);
      for (const u of section) {
        if (!u.kind || blocks[u.index].manualPlacement) continue;
        const c = blocks[u.captionIndex]; if (!c?.number) continue;
        const key = `${u.kind}:${c.number}`;
        if (labels.get(key) !== 1) { warnings.add("Повторяющиеся номера объектов: проверьте подписи; автоматическая привязка для них отключена."); continue; }
        const mentions = section.filter((v) => !v.kind && blocks[v.index].type === "paragraph" && references(blocks[v.index].text).includes(key));
        const anchor = mentions[0];
        if (anchor) {
          if (mentions.some((v) => /(?:\b(?:above|below|preceding|following)\b|выше|ниже|предыдущ|следующ)/iu.test(blocks[v.index].text))) {
            warnings.add("Ссылка содержит указание расположения («выше/ниже»): объект оставлен на месте. Проверьте его вручную.");
          } else anchors.set(u, anchor);
        }
      }
      start = end + 1;
    }
    const ordered = [];
    for (const u of list) {
      if (anchors.has(u)) continue;
      ordered.push(u);
      for (const [object, anchor] of anchors) if (anchor === u) ordered.push(object);
    }
    const permutation = ordered.flatMap((u) => u.indices);
    const moved = ordered.filter((u, i) => u.kind && list[i] !== u).length;
    return { blocks: permutation.map((i) => blocks[i]), warnings: [...warnings], moved };
  }
  function move(blocks, index, direction) {
    const list = units(blocks), position = list.findIndex((u) => u.kind && u.index === index), target = position + direction;
    if (![-1, 1].includes(direction) || position < 0 || target < 0 || target >= list.length || blocks[list[target].index].type === "heading") return null;
    [list[position], list[target]] = [list[target], list[position]];
    return list.flatMap((u) => u.indices);
  }
  function captions(blocks, profile) {
    const result = new Map(), list = units(blocks), used = { table: new Set(), figure: new Set() };
    for (const b of blocks) if (b.type === "caption" && used[b.kind] && b.number) used[b.kind].add(String(b.number));
    const russian = blocks.filter((b) => b.type === "paragraph" || b.type === "heading").some((b) => /[а-яё]/iu.test(b.text || b.title || ""));
    for (const u of list) {
      if (!u.kind) continue;
      const original = blocks[u.captionIndex], defaults = profile.captions[u.kind];
      let number = original?.number;
      if (!number) { let n = 1; while (used[u.kind].has(String(n))) n++; number = String(n); used[u.kind].add(number); }
      const prefix = original?.prefix || (russian ? u.kind === "table" ? "Таблица" : "Рисунок" : defaults.prefix);
      result.set(u.index, { ...original, type: "caption", kind: u.kind, number: String(number), prefix,
        ...(blocks[u.index].layoutOwner !== undefined ? { layoutOwner: blocks[u.index].layoutOwner } : {}),
        title: blocks[u.index].layoutTitle ?? original?.title ?? "", retainNumber: true,
        position: defaults.position, alignment: defaults.alignment });
    }
    return result;
  }
  const label = (c) => `${c.prefix} ${c.number}${c.title ? `. ${c.title}` : ""}`;
  function present(blocks, profile) {
    const labels = captions(blocks, profile), result = [];
    for (const u of units(blocks)) {
      if (!u.kind) { result.push({ ...blocks[u.index] }); continue; }
      const c = labels.get(u.index), object = { ...blocks[u.index] };
      if (u.kind === "figure") { object.keepWithCaption = c.position === "below"; object.captionLength = label(c).length; }
      const group = c.position === "above" ? [c, object] : [object, c];
      for (const i of u.indices) if (i !== u.index && i !== u.captionIndex) group.push({ ...blocks[i] });
      result.push(...group);
    }
    return result;
  }
  function presentEdits(blocks, profile) {
    const result = structuredClone(blocks), labels = captions(blocks, profile);
    for (const unit of units(blocks).slice().reverse()) {
      if (!unit.kind || blocks[unit.index].layoutTitle === undefined) continue;
      if (unit.captionIndex !== undefined && unit.captionIndex >= 0) result[unit.captionIndex] = { ...result[unit.captionIndex], title: blocks[unit.index].layoutTitle };
      else result.splice(unit.index + (unit.kind === "figure" ? 1 : 0), 0, labels.get(unit.index));
    }
    return result;
  }
  return { mediaKind, caption, prepare, units, references, arrange, move, captions, label, present, presentEdits };
});
