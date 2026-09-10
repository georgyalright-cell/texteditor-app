(function attach(root) {
  "use strict";
  const VERSION = 2;
  function create(base) {
    return { version: VERSION, base: structuredClone(base), ...root.MaterialProcessing.jobs(base),
      cursor: 0, details: [], limited: false, modelUsed: false, reasons: [] };
  }
  // Rebuild offsets from the saved source; never trust stored jobs or apply them
  // to a different document. Existing anchor checks validate every saved edit.
  function restore(saved, processed) {
    try {
      if (!saved || saved.version !== VERSION || !Array.isArray(saved.base) || !Array.isArray(saved.details)) return null;
      const job = create(saved.base);
      if (!Number.isInteger(saved.cursor) || saved.cursor < 0 || saved.cursor > job.jobs.length) return null;
      if (!saved.details.every(d => job.jobs.slice(0, saved.cursor).some(p => d.start >= p.offset && d.end <= p.offset + p.text.length))) return null;
      const output = root.MaterialProcessing.apply(job.base, saved.details);
      if (JSON.stringify(output) !== JSON.stringify(processed)) return null;
      const before = root.MaterialProcessing.textMap(job.base).text, after = root.MaterialProcessing.textMap(output).text;
      const guard = root.AnchorGuard || (typeof require === "function" ? require("./anchor-guard.js") : null);
      if (before !== after && (!guard || !guard.compare(before, after).ok)) return null;
      return Object.assign(job, { cursor: saved.cursor, details: saved.details, limited: Boolean(saved.limited),
        modelUsed: Boolean(saved.modelUsed), reasons: Array.isArray(saved.reasons) ? saved.reasons.filter(s => typeof s === "string") : [] });
    } catch { return null; }
  }
  function failure(result) {
    if (!result) return "Порция не завершена. Можно продолжить с неё.";
    const warnings = [...(result.generatorWarnings || []), ...(result.warnings || [])];
    if (result.rankingFailed) warnings.push(result.rankingSummary);
    return warnings.filter(Boolean).join(" ");
  }
  function progress(job) {
    const text = `Обработано порций: ${job.cursor} / ${job.jobs.length}.`;
    if (root.ModelRunStatus && root.ModelRunStatus.batch) root.ModelRunStatus.batch(job.cursor, job.jobs.length);
    return text;
  }
  const api = { create, restore, failure, progress };
  root.ModelCheckpoint = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : globalThis);
