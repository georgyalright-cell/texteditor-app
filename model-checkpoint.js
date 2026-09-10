(function attach(root) {
  "use strict";
  const VERSION = 2;
  function sameData(a, b, depth = 0) {
    if (a === b) return true;
    if (depth > 80 || !a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
      if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.byteLength !== b.byteLength) return false;
      const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
      return true;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameData(a[key], b[key], depth + 1));
  }
  function create(base) {
    return { version: VERSION, base: structuredClone(base), ...root.MaterialProcessing.jobs(base),
      cursor: 0, details: [], limited: false, modelUsed: false, reasons: [], assessmentNotes: [] };
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
      if (!sameData(output, processed)) return null;
      const before = root.MaterialProcessing.textMap(job.base).text, after = root.MaterialProcessing.textMap(output).text;
      const guard = root.AnchorGuard || (typeof require === "function" ? require("./anchor-guard.js") : null);
      if (before !== after && (!guard || !guard.compare(before, after).ok)) return null;
      if (root.SourceDocx && !root.SourceDocx.integrity(output).ok) return null;
      const reasons = Array.isArray(saved.reasons) ? saved.reasons.filter(s => typeof s === "string") : [];
      const assessmentNotes = Array.isArray(saved.assessmentNotes) ? saved.assessmentNotes.filter(s => typeof s === "string") : [];
      // v55 persisted optional PPL coverage as failure. Migrate only the exact
      // known summaries; an unknown or runtime error must keep its limited flag.
      const coverageOnly = Boolean(saved.limited) && reasons.length > 0 && reasons.every(s =>
        /^Перплексия: сравнено \d+ текстовых вариантов(?:; пропущено \d+ \(нет полной оценки\))?\.$/u.test(s));
      return Object.assign(job, { cursor: saved.cursor, details: saved.details, limited: Boolean(saved.limited) && !coverageOnly,
        modelUsed: Boolean(saved.modelUsed), reasons: coverageOnly ? [] : reasons,
        assessmentNotes: [...new Set([...assessmentNotes, ...(coverageOnly ? reasons : [])])] });
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
  const api = { create, restore, failure, progress, sameData };
  root.ModelCheckpoint = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : globalThis);
