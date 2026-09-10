(function attach(root) {
  "use strict";
  let active = false;
  let sequence = 0;

  function cancel(reason) {
    sequence += 1;
    if (root.AutomaticRevision) root.AutomaticRevision.cancel();
    if (root.ModelRunStatus) root.ModelRunStatus.cancel(reason);
    if (root.Generator) root.Generator.cancel();
    if (root.SemanticScorer) root.SemanticScorer.cancel();
    if (root.NeuralScorerUI && root.NeuralScorerUI.cancelPolishScoring) root.NeuralScorerUI.cancelPolishScoring();
  }

  async function run(options) {
    if (active) return;
    const engine = root.NeuralScorerUI;
    if (engine && engine.lockForPolish && !engine.lockForPolish()) {
      options.report("Дождитесь завершения нейрооценки.", true); return;
    }
    active = true;
    const operation = ++sequence;
    const current = () => operation === sequence && options.isCurrent();
    // One default flow; never revive a stored personal style or glossary.
    const settings = { semantic: true, terms: [] };
    const selector = root.CandidateSelect;
    const ranker = root.NeuralRanking.create({
      baseline: selector.deterministicScorer(options.language), engine,
      isCancelled: () => !current(), releaseGenerator: () => root.Generator.cancel(),
    });
    const budget = { share: 0.35, limit: options.collect ? 10 : 5, shortlist: 2 };
    if (options.collect) budget.share = 1;
    if (!options.collect) root.RevisionPreview.clear();
    options.report("Редактирую текст. Варианты, прошедшие проверки, применяются автоматически.");
    // Bounds a stalled GPU request without changing the source or export state.
    let complete = false, modelUsed = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; cancel("timeout"); }, 15 * 60 * 1000);
    try {
      const result = await selector.polishSentences(options.text, {
        ...settings, ...budget, language: options.language, preferFresh: true,
        contextual: true, fullCoverage: Boolean(options.collect), preview: true, score: ranker.score,
        isCancelled: () => !current(),
        semanticScore: settings.semantic ? (pairs) => root.SemanticScorer.score(pairs) : undefined,
        generate: async (sentence, context) => {
          const variants = await root.Generator.paraphrase(sentence, {
            ...context, ...settings, contextual: true, creative: settings.semantic, count: 4,
          });
          modelUsed = true; return variants;
        },
      });
      if (!current()) return;
      if (!result.ok) { options.report(result.warnings.join(" "), true); return; }
      const warnings = (result.generatorWarnings || []).join(". ");
      complete = true;
      result.modelUsed = modelUsed;
      result.modelLimited = Boolean(warnings) || Boolean(result.warnings && result.warnings.length) || ranker.limited();
      result.rankingFailed = ranker.failed();
      for (const detail of result.details) detail.neural = ranker.pair(detail.before, detail.after);
      if (options.collect) { result.rankingSummary = ranker.summary(); options.collect(result); return; }
      if (!result.replaced) {
        options.report(`Подходящих вариантов не найдено. Текущий текст сохранён. ${ranker.summary()}${warnings ? ` ${warnings}` : " Менять удачную формулировку необязательно."}`, Boolean(warnings));
        return;
      }
      const applied = root.AutomaticRevision.apply(options.text, result.details);
      if (current()) options.apply(applied);
      options.report(`Проверенные формулировки применены. ${ranker.summary()}${warnings ? ` ${warnings}` : ""}`, Boolean(warnings));
    } catch (error) { if (current()) options.report(error.message || "Редактура недоступна.", true); }
    finally {
      clearTimeout(timer);
      if (operation !== sequence && options.isCurrent()) options.report("Редактура остановлена. Текущий текст сохранён.");
      if (root.Generator) root.Generator.release();
      if (options.isCurrent() && engine && engine.reportProgress) engine.reportProgress({ done: true,
        message: timedOut ? "Время ожидания истекло. Полный проход не выполнен." : operation !== sequence
          ? "Редактура остановлена. Текущий текст сохранён." : complete
            ? "Текущая порция обработана. Общий итог — в индикаторе модельной обработки."
            : "Текущая порция не завершена. Текущий текст сохранён.", isError: !complete && operation === sequence || timedOut });
      if (engine && engine.unlockAfterPolish) engine.unlockAfterPolish();
      active = false;
    }
  }
  root.PolishUI = { run, cancel, busy: () => active };
})(window);
