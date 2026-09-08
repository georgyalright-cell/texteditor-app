(function attach(root) {
  "use strict";
  function textMap(blocks) {
    let text = ""; const ranges = [];
    for (const [index, block] of blocks.entries()) {
      if (block.type !== "paragraph") continue;
      if (text) text += "\n\n";
      ranges.push({ index, start: text.length, end: text.length + block.text.length }); text += block.text;
    }
    return { text, ranges };
  }
  function jobs(blocks) {
    const mapping = textMap(blocks), result = [];
    for (const range of mapping.ranges) {
      const text = blocks[range.index].text;
      const spans = root.EditPasses.paragraphSpans(text).flatMap((p) => root.EditPasses.sentenceSpans(p.text, p.start));
      for (let i = 0; i < spans.length; i += 5) {
        const group = spans.slice(i, i + 5), start = group[0].start, end = group[group.length - 1].end;
        result.push({ text: text.slice(start, end), offset: range.start + start });
      }
    }
    return { ...mapping, jobs: result };
  }
  function apply(blocks, details) {
    const result = structuredClone(blocks), mapping = textMap(blocks);
    let previousStart = Infinity;
    for (const detail of details.slice().sort((a, b) => b.start - a.start)) {
      const range = mapping.ranges.find((r) => detail.start >= r.start && detail.end <= r.end);
      if (!range || detail.end > previousStart || detail.start >= detail.end) throw new Error("Замена пересекает границу блока. Запустите обработку заново.");
      const block = result[range.index], start = detail.start - range.start, end = detail.end - range.start;
      if (block.text.slice(start, end).trim() !== detail.before || !root.AnchorGuard.compare(detail.before, detail.after).ok) throw new Error("Исходный текст или числовые данные изменились. Замена не применена.");
      block.text = block.text.slice(0, start) + detail.after + block.text.slice(end); previousStart = detail.start;
    }
    return result;
  }
  async function base(blocks, options) {
    const result = structuredClone(blocks), warnings = new Set(); let changed = 0;
    for (const [index, block] of result.entries()) {
      if (!options.isCurrent()) return null;
      if (block.type === "paragraph") {
        const processed = options.process(block.text);
        // Existing scripts remain intact; a final anchor check also protects
        // the surrounding document from a changed number/citation in one block.
        if (root.AnchorGuard.compare(block.text, processed.text).ok) {
          if (block.text !== processed.text) changed++;
          block.text = processed.text;
        } else warnings.add(`Блок ${index + 1}: сохранён оригинал из-за изменения чисел или ссылок.`);
        for (const warning of processed.warnings || []) warnings.add(warning);
      }
      options.progress(index + 1, result.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return options.isCurrent() ? { blocks: result, changed, warnings: [...warnings] } : null;
  }
  const api = { textMap, jobs, apply, base };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MaterialProcessing = api;
})(typeof window === "object" ? window : globalThis);
