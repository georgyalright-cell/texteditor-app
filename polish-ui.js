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
    // Bound inactivity, not elapsed work: slow hardware may legitimately need
    // more than 15 minutes while downloading or generating a large batch.
    let complete = false, modelUsed = false, timedOut = false, generationError = null;
    const requireGeneration = () => { if (generationError) throw generationError; };
    const started = Date.now();
    let timer;
    const watch = () => {
      const activity = Math.max(started, root.ModelRunStatus?.lastActivity?.() || 0);
      if (Date.now() - activity >= 15 * 60 * 1000) { timedOut = true; cancel("timeout"); }
      else timer = setTimeout(watch, 15000);
    };
    timer = setTimeout(watch, 15000);
    try {
      const result = await selector.polishSentences(options.text, {
        ...settings, ...budget, language: options.language, preferFresh: true,
        contextual: true, fullCoverage: Boolean(options.collect), preview: true,
        score: (...args) => { requireGeneration(); return ranker.score(...args); },
        isCancelled: () => !current(),
        semanticScore: settings.semantic ? async (pairs) => {
          // CandidateSelect awaits every generation before invoking this hook.
          // Do not keep the 1.5B generator resident while preparing embeddings.
          root.Generator.cancel();
          requireGeneration();
          try { return await root.SemanticScorer.score(pairs); }
          finally { root.SemanticScorer.cancel(); }
        } : undefined,
        generate: async (sentence, context) => {
          try {
            requireGeneration();
            const variants = await root.Generator.paraphrase(sentence, {
              ...context, ...settings, contextual: true, creative: settings.semantic, count: 4,
            });
            modelUsed = true; return variants;
          } catch (error) { generationError ||= error; throw error; }
        },
      });
      if (!current()) return;
      if (!result.ok) { options.report(result.warnings.join(" "), true); return; }
      const warnings = (result.generatorWarnings || []).join(". ");
      complete = !warnings && !(result.warnings || []).length && !ranker.failed();
      result.modelUsed = modelUsed;
      result.modelLimited = !complete;
      result.assessmentNotes = ranker.limited() && !ranker.failed() ? [ranker.summary()] : [];
      result.rankingFailed = ranker.failed();
      for (const detail of result.details) detail.neural = ranker.pair(detail.before, detail.after);
      if (!complete && engine && root.ModelErrors) engine.reportProgress(root.ModelErrors.event(
        warnings || (result.warnings || []).join(" ") || ranker.summary(), { stage: "Проверка порции", offline: root.navigator?.onLine === false }));
      if (options.collect) { result.rankingSummary = ranker.summary(); options.collect(result); return; }
      if (!result.replaced) {
        options.report(`Подходящих вариантов не найдено. Текущий текст сохранён. ${ranker.summary()}${warnings ? ` ${warnings}` : " Менять удачную формулировку необязательно."}`, Boolean(warnings));
        return;
      }
      const applied = root.AutomaticRevision.apply(options.text, result.details);
      if (current()) options.apply(applied);
      options.report(`Проверенные формулировки применены. ${ranker.summary()}${warnings ? ` ${warnings}` : ""}`, Boolean(warnings));
    } catch (error) {
      complete = false;
      if (current()) {
        options.report(error.message || "Редактура недоступна.", true);
        if (engine && root.ModelErrors) engine.reportProgress(root.ModelErrors.event(error, { stage: "Обработка порции", offline: root.navigator?.onLine === false }));
      }
    }
    finally {
      clearTimeout(timer);
      if (operation !== sequence && options.isCurrent()) options.report("Редактура остановлена. Текущий текст сохранён.");
      if (!complete) {
        // A failed device/runtime must not be reused when resuming this batch.
        if (root.Generator) root.Generator.cancel();
        if (root.SemanticScorer) root.SemanticScorer.cancel();
        if (engine && engine.cancelPolishScoring) engine.cancelPolishScoring();
      } else if (root.Generator) root.Generator.release();
      if (options.isCurrent() && engine && engine.reportProgress) engine.reportProgress({ done: true,
        message: timedOut ? "Время ожидания истекло. Полный проход не выполнен." : operation !== sequence
          ? "Редактура остановлена. Текущий текст сохранён." : complete
            ? options.collect ? "Порция передана на проверку и сохранение. Дождитесь общего итога." : "Текущая порция обработана. Общий итог — в индикаторе модельной обработки."
            : "Текущая порция не завершена. Текущий текст сохранён.", isError: !complete && operation === sequence || timedOut });
      if (engine && engine.unlockAfterPolish) engine.unlockAfterPolish();
      active = false;
    }
  }
  root.PolishUI = { run, cancel, busy: () => active };
})(window);
