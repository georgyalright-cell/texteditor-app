(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RevisionQuality = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  // Pilot retrieval threshold, NOT a calibrated probability of equivalent meaning.
  // Lexically new candidates ALWAYS require author review, even above this value.
  const MIN_SIMILARITY = 0.86;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  function count(text, phrase) {
    return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(phrase)}(?![\\p{L}\\p{N}_-])`, "giu"))].length;
  }
  function quotes(text) {
    return (text.match(/«[^»]+»|“[^”]+”|"[^"\n]+"/gu) || []).sort().join("\n");
  }
  function termsPreserved(source, candidate, terms) {
    return (terms || []).every((term) => count(source, term) === count(candidate, term));
  }
  function check(source, candidate, terms) {
    const reasons = [];
    if (!candidate || candidate.length > 1800 || /[\n\r\t|<>\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(candidate)) reasons.push("служебные символы или структура");
    if (!/[.!?…][»”"]?$/u.test(candidate.trim()) || /(?:[,;:]\s*[.!?]|\b(\w+)\s+\1\b)/iu.test(candidate)) reasons.push("незавершённая фраза или повтор");
    if (quotes(source) !== quotes(candidate)) reasons.push("изменена цитата");
    for (const phrase of terms || []) if (count(source, phrase) !== count(candidate, phrase)) reasons.push(`изменён термин «${phrase}»`);
    const groups = [
      ["не", "ни", "нет", "без", "нельзя", "not", "no", "never", "without", "cannot"],
      ["может", "могут", "возможно", "вероятно", "may", "might", "could", "possibly"],
      ["должен", "должна", "должны", "необходимо", "must", "shall", "required"],
    ];
    for (const group of groups) {
      if (group.reduce((n, w) => n + count(source, w), 0) !== group.reduce((n, w) => n + count(candidate, w), 0)) reasons.push("изменено отрицание или степень уверенности");
    }
    // Preserve every capitalized source token even at sentence start. This errs
    // on the conservative side but closes the name-at-start gap of AnchorGuard.
    const capitals = (text) => text.match(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}-]+/gu) || [];
    for (const word of capitals(source)) if (count(source, word) !== count(candidate, word)) reasons.push("утрачено имя или исходное слово с заглавной");
    for (const word of capitals(candidate)) if (!count(source, word)) reasons.push("новое имя или слово с заглавной");
    for (const [left, right] of [["(", ")"], ["«", "»"], ["“", "”"]]) {
      if (candidate.split(left).length !== candidate.split(right).length) reasons.push("непарные скобки или кавычки");
    }
    return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
  }
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return NaN;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
    return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : NaN;
  }
  function context(text, span) {
    const start = text.lastIndexOf("\n\n", span.start);
    const end = text.indexOf("\n\n", span.end);
    return { before: text.slice(start < 0 ? 0 : start + 2, span.start).slice(-350), after: text.slice(span.end, end < 0 ? text.length : end).slice(0, 350) };
  }
  return { MIN_SIMILARITY, check, cosine, context, termsPreserved };
});
