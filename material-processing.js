(function attach(root) {
  "use strict";
  const guard = () => root.AnchorGuard || require("./anchor-guard.js");
  const INTEGRITY_NOTE = "Некоторые формулировки оставлены исходными: проверка в общем тексте защитила ссылки, числа и даты. Обработка продолжена.";
  function textMap(blocks) {
    let text = ""; const ranges = [];
    const protectedBlocks = root.ReferenceGuard ? root.ReferenceGuard.protectedBlocks(blocks) : [];
    for (const [index, block] of blocks.entries()) {
      if (block.type !== "paragraph" || protectedBlocks[index]) continue;
      if (text) text += "\n\n";
      ranges.push({ index, start: text.length, end: text.length + block.text.length }); text += block.text;
    }
    return { text, ranges };
  }
  function jobs(blocks, { batchSize = 10, maxChars = 3500 } = {}) {
    const mapping = textMap(blocks), result = [];
    for (const range of mapping.ranges) {
      const text = blocks[range.index].text;
      const frozen = root.ReferenceGuard ? root.ReferenceGuard.ranges(text).filter((r) => r.bibliography) : [];
      const spans = root.EditPasses.paragraphSpans(text).flatMap((p) => root.EditPasses.sentenceSpans(p.text, p.start))
        .filter((s) => !frozen.some((r) => s.start < r.end && s.end > r.start));
      for (let i = 0; i < spans.length;) {
        const start = spans[i].start; let end = spans[i++].end, size = 1;
        while (i < spans.length && size < batchSize && spans[i].end - start <= maxChars && !frozen.some((r) => end < r.end && spans[i].start > r.start)) {
          end = spans[i++].end; size++;
        }
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
      if (block.text.slice(start, end).trim() !== detail.before || !guard().compare(detail.before, detail.after).ok) throw new Error("Исходный текст или числовые данные изменились. Замена не применена.");
      block.text = block.text.slice(0, start) + detail.after + block.text.slice(end); previousStart = detail.start;
    }
    return result;
  }
  // Keep the global guard. An otherwise admissible sentence can change anchor
  // recognition at a batch boundary. Reject that proposal, not the whole job.
  function accept(blocks, previous, proposals) {
    const source = textMap(blocks).text;
    const valid = result => { const text = textMap(result).text; return source === text || guard().compare(source, text).ok; };
    let details = previous.slice(), output = apply(blocks, details), rejected = 0;
    if (!valid(output)) throw new Error("Сохранённые правки не прошли проверку ссылок и чисел. Исходный текст не изменён.");
    try {
      const all = apply(blocks, [...details, ...proposals]);
      if (valid(all)) return { blocks: all, details: [...details, ...proposals], rejected: 0 };
    } catch (_) { /* Resolve failed proposals individually below. */ }
    for (const proposal of proposals) {
      try {
        const next = apply(blocks, [...details, proposal]);
        if (valid(next)) { details.push(proposal); output = next; }
        else rejected++;
      } catch (_) { rejected++; }
    }
    return { blocks: output, details, rejected };
  }
  async function base(blocks, options) {
    const result = structuredClone(blocks), warnings = new Set(); let changed = 0;
    const protectedBlocks = root.ReferenceGuard ? root.ReferenceGuard.protectedBlocks(blocks) : [];
    for (const [index, block] of result.entries()) {
      if (!options.isCurrent()) return null;
      if (block.type === "paragraph" && !protectedBlocks[index]) {
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
  const api = { textMap, jobs, apply, accept, base, INTEGRITY_NOTE };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MaterialProcessing = api;
})(typeof window === "object" ? window : globalThis);
