(function attachNeuralScorerCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NeuralScorerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function createNeuralScorerCore() {
  "use strict";

  function assertFiniteArray(value, label) {
    if (!value || typeof value.length !== "number") throw new TypeError(`${label}: ожидался массив чисел.`);
  }

  function normalizeDims(dims, label) {
    if (!Array.isArray(dims) || dims.length !== 3) throw new TypeError(`${label}: ожидается форма [1, токены, словарь].`);
    const [batch, tokens, vocabulary] = dims.map(Number);
    if (batch !== 1 || tokens < 2 || vocabulary < 2) throw new RangeError(`${label}: недостаточно данных для оценки.`);
    return { tokens, vocabulary };
  }

  function scoreLogits(observerLogits, performerLogits, inputIds, observerDims, performerDims) {
    assertFiniteArray(observerLogits, "Observer logits");
    assertFiniteArray(performerLogits, "Performer logits");
    assertFiniteArray(inputIds, "Input IDs");
    const observerShape = normalizeDims(observerDims, "Observer logits");
    const performerShape = normalizeDims(performerDims, "Performer logits");
    if (observerShape.tokens !== performerShape.tokens || observerShape.vocabulary !== performerShape.vocabulary) {
      throw new RangeError("Модели вернули несовместимые формы логитов.");
    }

    const tokens = Math.min(observerShape.tokens, inputIds.length);
    const vocabulary = observerShape.vocabulary;
    const expectedLength = observerShape.tokens * vocabulary;
    if (observerLogits.length < expectedLength || performerLogits.length < expectedLength) {
      throw new RangeError("Модель вернула неполный массив логитов.");
    }

    let negativeLogLikelihood = 0;
    let crossEntropy = 0;
    let positions = 0;

    for (let position = 0; position < tokens - 1; position += 1) {
      const offset = position * vocabulary;
      let observerMax = -Infinity;
      let performerMax = -Infinity;
      for (let token = 0; token < vocabulary; token += 1) {
        const observerValue = Number(observerLogits[offset + token]);
        const performerValue = Number(performerLogits[offset + token]);
        if (observerValue > observerMax) observerMax = observerValue;
        if (performerValue > performerMax) performerMax = performerValue;
      }

      let observerNormalizer = 0;
      let performerNormalizer = 0;
      let observerWeightedPerformer = 0;
      for (let token = 0; token < vocabulary; token += 1) {
        const observerWeight = Math.exp(Number(observerLogits[offset + token]) - observerMax);
        const performerValue = Number(performerLogits[offset + token]);
        observerNormalizer += observerWeight;
        performerNormalizer += Math.exp(performerValue - performerMax);
        observerWeightedPerformer += observerWeight * performerValue;
      }

      const target = Number(inputIds[position + 1]);
      if (!Number.isInteger(target) || target < 0 || target >= vocabulary) continue;
      const performerLogNormalizer = performerMax + Math.log(performerNormalizer);
      const tokenNll = performerLogNormalizer - Number(performerLogits[offset + target]);
      const tokenCrossEntropy = performerLogNormalizer - observerWeightedPerformer / observerNormalizer;
      if (!Number.isFinite(tokenNll) || !Number.isFinite(tokenCrossEntropy) || tokenCrossEntropy <= 0) continue;
      negativeLogLikelihood += tokenNll;
      crossEntropy += tokenCrossEntropy;
      positions += 1;
    }

    if (!positions) throw new RangeError("Недостаточно корректных токенов для оценки.");
    const meanNll = negativeLogLikelihood / positions;
    const meanCrossEntropy = crossEntropy / positions;
    return {
      logPerplexity: meanNll,
      perplexity: Math.exp(Math.min(meanNll, 50)),
      crossEntropy: meanCrossEntropy,
      binoculars: meanNll / meanCrossEntropy,
      tokenCount: positions + 1,
    };
  }

  return { scoreLogits };
});
