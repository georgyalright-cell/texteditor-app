(function attach(root) {
  "use strict";
  let checkpoint = null;
  let revision = 0;
  const checkpointApi = () => root.ModelCheckpoint || require("./model-checkpoint.js");
  const storageKey = "fragment-model";
  function currentText(job) { return apply(job.base[0].text, job.details).text; }
  async function recover() {
    if (!root.MaterialDraft) return null;
    const operation = revision;
    const saved = await root.MaterialDraft.load(storageKey);
    if (operation !== revision) return null;
    checkpoint = saved && checkpointApi().restore(saved.job, saved.processed);
    return checkpoint ? currentText(checkpoint) : null;
  }
  function discard() {
    revision++; checkpoint = null;
    return root.MaterialDraft ? root.MaterialDraft.save(null, storageKey) : Promise.resolve();
  }
  function pending(text) { return Boolean(checkpoint && currentText(checkpoint) === text && checkpoint.cursor < checkpoint.jobs.length); }
  function finished(text) { return Boolean(checkpoint && currentText(checkpoint) === text && checkpoint.cursor === checkpoint.jobs.length); }
  async function persist(job) {
    if (root.MaterialDraft) await root.MaterialDraft.save({ job, processed: [{ type: "paragraph", text: currentText(job) }] }, storageKey);
  }
  function apply(source, details) {
    const blocks = [{ type: "paragraph", text: source }];
    const text = root.MaterialProcessing.apply(blocks, details)[0].text;
    if (!root.AnchorGuard.compare(source, text).ok) throw new Error("Замены отменены: изменились ссылки или числовые данные.");
    const words = (value) => (value.match(/[\p{L}\p{N}_-]+/gu) || []).length;
    return { source, text, details, replaced: details.length, totalSentences: root.EditPasses.sentenceSpans(source, 0).length,
      changedWordShare: details.reduce((n, d) => n + words(d.before), 0) / Math.max(1, words(source)) };
  }
  async function run(options) {
    const api = checkpointApi();
    const job = checkpoint && currentText(checkpoint) === options.text ? checkpoint : api.create([{ type: "paragraph", text: options.text }]);
    const operation = ++revision, current = () => operation === revision && options.isCurrent();
    checkpoint = job;
    const source = job.base[0].text, warnings = new Set(job.reasons);
    let latest = apply(source, job.details), failure = "";
    try { await persist(job); }
    catch { failure = "Браузер не сохранил точку продолжения. Скачайте текущий текст; освободите место и повторите."; }
    for (; !failure && job.cursor < job.jobs.length;) {
      if (!current()) break;
      const piece = job.jobs[job.cursor];
      let result = null;
      const progress = api.progress(job);
      await root.PolishUI.run({ text: piece.text, language: options.language, isCurrent: current,
        report: (message, error) => options.report(`${progress} Сейчас порция ${job.cursor + 1}. ${message}`, error),
        collect: (value) => { result = value; } });
      if (!current()) break;
      failure = api.failure(result);
      if (failure) { for (const w of [...(result && result.generatorWarnings || []), ...(result && result.warnings || []), result && result.rankingSummary].filter(Boolean)) warnings.add(w); break; }
      job.limited ||= Boolean(result.modelLimited);
      job.modelUsed ||= result.modelUsed !== false;
      for (const warning of [...(result.generatorWarnings || []), ...(result.warnings || [])]) warnings.add(warning);
      if (result.rankingSummary) warnings.add(result.rankingSummary);
      const selected = root.MaterialProcessing.accept(job.base, job.details,
        result.details.map((d) => ({ ...d, start: d.start + piece.offset, end: d.end + piece.offset })));
      if (selected.rejected || (result.integrityNotes || []).length) warnings.add(root.MaterialProcessing.INTEGRITY_NOTE);
      const next = selected.details;
      latest = apply(source, next);
      latest.warnings = [...warnings];
      job.details = next; job.cursor++; job.reasons = [...warnings];
      if (result.details.length) options.apply(latest);
      api.progress(job);
      try { await persist(job); }
      catch { failure = "Браузер не сохранил последнюю порцию. Скачайте текущий текст; продолжение пока возможно только в этой вкладке."; }
    }
    if (current()) options.report(`${api.progress(job)} ${failure || (job.cursor === job.jobs.length ? "Проход завершён." : "Остановлено.")} ${failure ? "Нажмите «Продолжить обработку моделью»." : ""}`, Boolean(failure));
    const outcome = latest || apply(source, []);
    return Object.assign(outcome, { warnings: [...warnings], completed: !failure && job.cursor === job.jobs.length && current(), limited: job.limited, modelUsed: job.modelUsed,
      reason: failure || (job.limited ? [...warnings].join(" ") : "") });
  }
  const api = { apply, run, recover, pending, finished, discard, cancel: () => { revision++; } };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AutomaticRevision = api;
})(typeof window === "object" ? window : globalThis);
