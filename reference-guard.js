(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReferenceGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";
  const heading = /^(?:#{1,6}\s*)?(?:\d+(?:\.\d+)*[.)]?\s+)?(?:references|bibliography|works cited|список (?:использованных )?(?:источников|литературы)|библиография)\s*[:.]?$/iu;
  const endMatter = /^(?:#{1,6}\s*)?(?:\d+(?:\.\d+)*[.)]?\s+)?(?:appendix|appendices|приложени[ея])(?:\s|$)/iu;
  function trimAddress(value) {
    let out = value.replace(/[.,;:!?]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (out.endsWith(close) && out.split(close).length > out.split(open).length) out = out.slice(0, -1);
    }
    return out;
  }
  function ranges(input) {
    const text = String(input || ""), found = [];
    let bibliography = false;
    for (const line of text.matchAll(/[^\n]+/gu)) {
      const value = line[0].trim();
      if (endMatter.test(value)) bibliography = false;
      if (heading.test(value)) { bibliography = true; continue; }
      if (bibliography) found.push({ start: line.index, end: line.index + line[0].length, value: line[0], bibliography: true });
    }
    const patterns = [
      /(?:https?:\/\/|www\.)[^\s<>"“”]+/giu,
      /\b10\.\d{4,9}\/[^\s<>"“”]+/giu,
      /\[(?:\^?\d[^\]\n]*|\^[\w-]+)\]/gu,
      /\([^()\n]*\p{L}[^()\n]*,\s*(?:18|19|20)\d{2}[a-z]?[^()\n]*\)/gu,
      /\[[^\]\n]+\]\((?:https?:\/\/|www\.)[^\s<>]+\)/giu,
      /\((?:accessed|access date|дата обращения)\s*:[^()\n]+\)/giu,
      /\b(?:Table|Figure|Fig\.|Appendix|Section|Equation)\s+(?:\d+(?:\.\d+)*\p{L}?|[A-Z])(?!(?:[\p{L}\p{N}]|\.\d))/giu,
      /(?<!\p{L})(?:таблиц[аыуе]|табл\.|рисунок|рисунке|рис\.|приложени[еяи]|раздел[ае]?)\s+(?:\d+(?:\.\d+)*\p{L}?|[А-ЯA-Z])(?!(?:[\p{L}\p{N}]|\.\d))/giu,
    ];
    for (const [index, pattern] of patterns.entries()) {
      for (const match of text.matchAll(pattern)) {
        const value = index < 2 ? trimAddress(match[0]) : match[0];
        found.push({ start: match.index, end: match.index + value.length, value });
      }
    }
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const result = [];
    for (const span of found) {
      const previous = result[result.length - 1];
      if (previous && span.start < previous.end) {
        previous.end = Math.max(previous.end, span.end); previous.value = text.slice(previous.start, previous.end);
      } else result.push({ ...span });
    }
    return result;
  }
  function compare(before, after) {
    const a = ranges(before), b = ranges(after);
    return a.length === b.length && a.every((span, i) => span.value === b[i].value);
  }
  // Opaque placeholders exist only inside a synchronous editing stage. Never
  // send them to a model, metrics, export or storage. Fail closed on damage.
  function transform(input, edit) {
    const source = String(input || ""), spans = ranges(source);
    if (!spans.length) return edit(source);
    let prefix = "\uE700REF";
    while (source.includes(prefix)) prefix += "X";
    const tokens = spans.map((_, i) => `${prefix}${String.fromCharCode(0xE800 + i % 256)}${"X".repeat(Math.floor(i / 256))}\uE701`);
    let masked = source;
    for (let i = spans.length - 1; i >= 0; i--) masked = masked.slice(0, spans[i].start) + tokens[i] + masked.slice(spans[i].end);
    const result = edit(masked);
    let text = result.text, intact = typeof text === "string";
    for (let i = 0; intact && i < tokens.length; i++) {
      if (text.split(tokens[i]).length !== 2) { intact = false; break; }
      text = text.replace(tokens[i], () => spans[i].value);
    }
    if (!intact || text.includes(prefix) || !compare(source, text)) {
      return { ...result, text: source, warnings: [...(result.warnings || []), "Правка ссылок отменена; исходные ссылки сохранены."] };
    }
    return { ...result, text };
  }
  function protectedBlocks(blocks) {
    let bibliography = false;
    return blocks.map((block) => {
      const text = block.title || block.text || (block.lines || []).join("\n");
      if (endMatter.test(text.trim())) bibliography = false;
      if (heading.test(text.trim())) bibliography = true;
      return bibliography;
    });
  }
  return { ranges, compare, transform, heading, endMatter, protectedBlocks };
});
