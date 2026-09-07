(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MeaningGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";
  // Conservative lexical guard, NOT entailment or a complete fact check.
  // Keep claim qualifications literal: "realistic" is not "accurate".
  const GROUPS = [
    ["ограничение", ["only", "solely", "exclusively", "только", "исключительно"]],
    ["всеобщность", ["all", "every", "always", "everyone", "everything", "всегда", "все", "каждый", "каждая", "каждое"]],
    ["частотность", ["often", "usually", "sometimes", "rarely", "часто", "обычно", "иногда", "редко"]],
    ["условие", ["if", "unless", "provided", "если"]],
    ["гарантия", ["guarantee", "guarantees", "guaranteed", "certainly", "definitely", "обязательно", "гарантирует", "гарантированно"]],
    ["точность", ["accurate", "accurately", "exact", "exactly", "точный", "точные", "точность", "точно"]],
    ["реалистичность", ["realistic", "realistically", "реалистичный", "реалистичные", "реалистично"]],
    ["акцент", ["especially", "particularly", "особенно", "прежде всего"]],
    ["возможность", ["can", "able", "способен", "способна", "способны"]],
    ["связь без причинного вывода", ["associated", "correlated", "correlation", "корреляция", "коррелирует", "связано", "связаны"]],
  ];
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  function count(text, term) {
    return [...String(text).matchAll(new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(term)}(?![\\p{L}\\p{N}_-])`, "giu"))].length;
  }
  function terms(source) {
    return GROUPS.flatMap(([, words]) => words).filter(word => count(source, word));
  }
  function check(source, candidate) {
    // Literal preservation avoids treating "usually" and "rarely" as equivalents.
    const reasons = GROUPS.filter(([, words]) => words.some(word => count(source, word) !== count(candidate, word)))
      .map(([label]) => `изменена смысловая оговорка: ${label}`);
    return { ok: !reasons.length, reasons };
  }
  return { check, terms };
});
