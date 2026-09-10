(function attach(root) {
  "use strict";
  function apply(source, details) {
    const blocks = [{ type: "paragraph", text: source }];
    const text = root.MaterialProcessing.apply(blocks, details)[0].text;
    if (!root.AnchorGuard.compare(source, text).ok) throw new Error("Замены отменены: изменились ссылки или числовые данные.");
    const words = (value) => (value.match(/[\p{L}\p{N}_-]+/gu) || []).length;
    return { source, text, details, replaced: details.length, totalSentences: root.EditPasses.sentenceSpans(source, 0).length,
      changedWordShare: details.reduce((n, d) => n + words(d.before), 0) / Math.max(1, words(source)) };
  }
  async function run(options) {
    const source = options.text, queue = root.MaterialProcessing.jobs([{ type: "paragraph", text: source }]);
    const details = [], warnings = new Set();
    let latest = null, completed = 0, limited = false, modelUsed = false;
    for (const [index, piece] of queue.jobs.entries()) {
      if (!options.isCurrent()) break;
      let result = null;
      await root.PolishUI.run({ text: piece.text, language: options.language, isCurrent: options.isCurrent,
        report: (message, error) => options.report(`Порция ${index + 1} / ${queue.jobs.length}. ${message}`, error),
        collect: (value) => { result = value; } });
      if (!options.isCurrent() || !result) break;
      completed++;
      limited ||= Boolean(result.modelLimited || (result.generatorWarnings || []).length || (result.warnings || []).length);
      modelUsed ||= result.modelUsed !== false;
      for (const warning of [...(result.generatorWarnings || []), ...(result.warnings || [])]) warnings.add(warning);
      if (result.rankingSummary) warnings.add(result.rankingSummary);
      const next = [...details, ...result.details.map((d) => ({ ...d, start: d.start + piece.offset, end: d.end + piece.offset }))];
      latest = apply(source, next);
      latest.warnings = [...warnings];
      details.splice(0, details.length, ...next);
      if (result.details.length) options.apply(latest);
    }
    if (latest && options.isCurrent()) options.report(`Проверенные формулировки применены. ${[...warnings].join(" ")}`);
    const outcome = latest || apply(source, []);
    return Object.assign(outcome, { completed: completed === queue.jobs.length && options.isCurrent(), limited, modelUsed,
      reason: limited ? [...warnings].join(" ") : "" });
  }
  const api = { apply, run };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AutomaticRevision = api;
})(typeof window === "object" ? window : globalThis);
