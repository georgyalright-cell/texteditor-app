(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrammarEdits = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  "use strict";
  // Closed inflected phrases: never guess a noun's case, agent, fact or qualifier.
  const phrases = [
    ["проводит анализ рынка", "анализирует рынок"],
    ["проводят анализ рынка", "анализируют рынок"],
    ["осуществляет анализ рынка", "анализирует рынок"],
    ["осуществляют анализ рынка", "анализируют рынок"],
    ["оказывает поддержку малому бизнесу", "поддерживает малый бизнес"],
    ["оказывают поддержку малому бизнесу", "поддерживают малый бизнес"],
    ["является причиной задержек", "вызывает задержки"],
    ["являются причиной задержек", "вызывают задержки"],
  ];
  const clauses = [
    ["наблюдается рост выручки", "выручка растёт"],
    ["наблюдается снижение выручки", "выручка снижается"],
    ["наблюдается рост спроса", "спрос растёт"],
    ["наблюдается снижение спроса", "спрос снижается"],
  ];
  function run(input) {
    const source = String(input || "");
    const guard = root.ReferenceGuard || (typeof require === "function" ? require("./reference-guard.js") : null);
    const protectedRanges = guard ? guard.ranges(source).slice() : [];
    // Do not rewrite quotations, headings or non-prose lines.
    for (const m of source.matchAll(/«[^»]*»|„[^“]*“|“[^”]*”|"[^"\n]*"|'[^'\n]*'|‘[^’]*’|`[^`]*`/gu)) {
      protectedRanges.push({ start: m.index, end: m.index + m[0].length });
    }
    let text = source, count = 0;
    const edits = [];
    for (const [pairs, anchored] of [[phrases, false], [clauses, true]]) {
      for (const [before, after] of pairs) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${before.replaceAll(" ", "[ \\u00a0]+")}(?=[ \\u00a0]*(?:[.!?;]|$))`, "giu");
        for (const m of source.matchAll(pattern)) {
          const start = m.index, end = start + m[0].length;
          if (protectedRanges.some(r => start < r.end && end > r.start)) continue;
          const lower = m[0].toLocaleLowerCase("ru");
          if (m[0] !== lower && m[0] !== lower[0].toLocaleUpperCase("ru") + lower.slice(1)) continue;
          const prefix = source.slice(source.lastIndexOf("\n", start - 1) + 1, start);
          const line = source.slice(source.lastIndexOf("\n", start - 1) + 1).split("\n")[0];
          if (/^\s*(?:#|>|\||[-*+] |\d+[.)] )/u.test(line) || !/[.!?;]\s*$/u.test(line)) continue;
          if (anchored && prefix.trim() && !/[.!?]\s*$/u.test(prefix)) continue;
          // Negated/qualified observations are not equivalent to direct assertions.
          if (anchored && /(?:не|возможно|вероятно|иногда|всегда)\s*$/iu.test(prefix)) continue;
          const replacement = /^[А-ЯЁ]/u.test(m[0]) ? after[0].toLocaleUpperCase("ru") + after.slice(1) : after;
          edits.push({ start, end, replacement });
        }
      }
    }
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, e.start) + e.replacement + text.slice(e.end); count++;
    }
    return { text, applied: count, edits };
  }
  return { run };
});
