(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RevisionCandidates = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";
  const load = (name, path) => globalThis[name] || (typeof require === "function" ? require(path) : null);

  async function prepare(targets, settings) {
    const quality = load("RevisionQuality", "./revision-quality.js");
    const deep = load("DeepRevision", "./deep-revision.js");
    const pending = [];
    for (const target of targets) {
      target.semantic = new Map();
      target.variants = target.variants.filter((text) => quality.check(target.original, text, settings.terms).ok);
      for (const text of target.variants) {
        if (target.generated && target.generated.has(text) && !deep.stableVocabulary(target.original, text, settings.language)) pending.push({ target, text });
      }
    }
    if (settings.semanticScore && pending.length) {
      if (settings.isCancelled && settings.isCancelled()) throw new Error("Редактура остановлена.");
      try {
        const scores = await settings.semanticScore(pending.map(({ target, text }) => ({ source: target.original, candidate: text })));
        if (!Array.isArray(scores) || scores.length !== pending.length) throw new Error("Неполный ответ проверки смысла.");
        for (const [index, item] of pending.entries()) {
          if (typeof scores[index] === "number" && Number.isFinite(scores[index]) && scores[index] >= quality.MIN_SIMILARITY && scores[index] <= 1) item.target.semantic.set(item.text, scores[index]);
        }
      } catch (error) {
        for (const target of targets) target.generatorWarning = `Проверка смысла недоступна: ${error.message}. Свободные варианты не предложены`;
      }
    }
    return targets;
  }
  return { prepare };
});
