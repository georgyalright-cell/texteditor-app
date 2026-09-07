(function attach(root) {
  "use strict";
  let active = false;
  let sequence = 0;
  const button = document.getElementById("polishButton");
  const stop = document.getElementById("polishCancelButton");

  function cancel() {
    sequence += 1;
    if (root.Generator) root.Generator.cancel();
    if (root.SemanticScorer) root.SemanticScorer.cancel();
    if (root.NeuralScorerUI && root.NeuralScorerUI.cancelPolishScoring) root.NeuralScorerUI.cancelPolishScoring();
  }
  stop.addEventListener("click", cancel);

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
    const budget = { share: 0.35, limit: 5, shortlist: 2 };
    const label = button.textContent;
    button.disabled = true; button.textContent = "Глубокая редакция…"; stop.hidden = false;
    root.RevisionPreview.clear();
    options.report("Готовлю варианты с учётом контекста и стиля. Результат появится для просмотра перед применением.");
    // Bounds a stalled GPU request without changing the source or export state.
    const timer = setTimeout(cancel, 15 * 60 * 1000);
    try {
      const result = await selector.polishSentences(options.text, {
        ...settings, ...budget, language: options.language, preferFresh: true,
        contextual: true, preview: true, score: ranker.score,
        isCancelled: () => !current(),
        semanticScore: settings.semantic ? (pairs) => root.SemanticScorer.score(pairs) : undefined,
        generate: (sentence, context) => root.Generator.paraphrase(sentence, {
          ...context, ...settings, contextual: true, creative: settings.semantic, count: 4,
        }),
      });
      if (!current()) return;
      if (!result.ok) { options.report(result.warnings.join(" "), true); return; }
      const warnings = (result.generatorWarnings || []).join(". ");
      for (const detail of result.details) detail.neural = ranker.pair(detail.before, detail.after);
      if (!result.replaced) {
        options.report(`Подходящих вариантов не найдено. Текущий текст сохранён. ${ranker.summary()}${warnings ? ` ${warnings}` : " Менять удачную формулировку необязательно."}`, Boolean(warnings));
        return;
      }
      options.report(`Для просмотра готово ${result.replaced} замен. ${ranker.summary()}${warnings ? ` ${warnings}` : ""}`, Boolean(warnings));
      root.RevisionPreview.show(result, (accepted) => { if (current()) options.apply(accepted); });
    } catch (error) { if (current()) options.report(error.message || "Редактура недоступна.", true); }
    finally {
      clearTimeout(timer);
      if (operation !== sequence && options.isCurrent()) options.report("Редактура остановлена. Текущий текст сохранён.");
      if (root.Generator) root.Generator.release();
      if (engine && engine.reportProgress) engine.reportProgress({ done: true });
      if (engine && engine.unlockAfterPolish) engine.unlockAfterPolish();
      button.textContent = label; button.disabled = !root.Generator.supported(); stop.hidden = true;
      active = false;
    }
  }
  root.PolishUI = { run, cancel, busy: () => active };
})(window);
