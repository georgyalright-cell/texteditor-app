(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NeuralRanking = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";
  // Pilot quality penalty, NOT a calibrated detector threshold. A candidate
  // never earns a reward for being less predictable, nor for merely copying.
  const MAX_PENALTY = 4;
  function valid(item) {
    return item && item.complete === true && Number.isFinite(item.logPerplexity) &&
      item.logPerplexity >= 0 && Number.isFinite(item.perplexity) && item.perplexity > 0;
  }
  function create(options) {
    const observations = new Map();
    let checked = 0, skipped = 0, warning = "";
    const assertCurrent = () => { if (options.isCancelled()) throw new Error("Редактура остановлена."); };
    async function score(texts, context) {
      const base = await options.baseline(texts);
      const groups = context && context.groups || [];
      assertCurrent();
      if (!groups.some((g) => g.count > 1)) return base;
      // Generation has finished. Terminate its worker before loading scorers,
      // rather than relying on an asynchronous fire-and-forget unload message.
      options.releaseGenerator();
      let details;
      try {
        details = await options.engine.scoreDetails(texts, { fullText: true, perplexityOnly: true });
        assertCurrent();
        if (!Array.isArray(details) || details.length !== texts.length) throw new Error("Неполный ответ нейрооценки.");
      } catch (error) {
        assertCurrent();
        if (options.engine && options.engine.cancelPolishScoring) options.engine.cancelPolishScoring();
        warning = `Перплексия недоступна: ${String(error.message || "ошибка модели").replace(/[.\s]+$/, "")}. Использован обычный отбор`;
        skipped = texts.length;
        return base;
      }
      const result = base.slice();
      for (const group of groups) {
        const items = details.slice(group.offset, group.offset + group.count);
        // Compare like with like: no candidate-only bonus or prefix scoring.
        if (!items.every(valid)) { skipped += group.count; continue; }
        checked += group.count;
        const original = items[0];
        items.forEach((item, index) => {
          const offset = group.offset + index;
          const penalty = Math.min(MAX_PENALTY, Math.max(0, item.logPerplexity - original.logPerplexity) * MAX_PENALTY);
          result[offset] += penalty;
          observations.set(texts[offset], { perplexity: item.perplexity, tokenCount: item.tokenCount });
        });
      }
      return result;
    }
    return {
      score,
      limited: () => Boolean(warning) || skipped > 0,
      pair: (before, after) => observations.has(before) && observations.has(after)
        ? { before: observations.get(before), after: observations.get(after) } : null,
      summary: () => warning || `Перплексия: сравнено ${checked} текстовых вариантов${skipped ? `; пропущено ${skipped} (нет полной оценки)` : ""}.`,
    };
  }
  return { create, MAX_PENALTY };
});
