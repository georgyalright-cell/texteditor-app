(function attachGenerator(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = { create: factory };
  root.Generator = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createGenerator(root) {
  "use strict";

  const MAX_VARIANTS = 4;
  const pending = new Map();
  let worker = null;
  let requestId = 2000000;

  function supported() {
    return Boolean(root.navigator && root.navigator.gpu && root.Worker);
  }

  function report(message) {
    if (root.NeuralScorerUI && typeof root.NeuralScorerUI.reportProgress === "function") {
      root.NeuralScorerUI.reportProgress(message);
    }
  }

  function rejectPending(error) {
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new root.Worker("generator-worker.js?v=42", { type: "module" });
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        report(message);
        return;
      }
      if (!pending.has(message.id)) return;
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.type === "variants") waiting.resolve(Array.isArray(message.variants) ? message.variants : []);
      else waiting.reject(new Error(message.message || "Локальный генератор не выполнил запрос."));
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Ошибка локального генератора.");
      rejectPending(error);
      report({ message: `Генератор недоступен: ${error.message}. Продолжаю со словарными версиями.`, isError: true });
      if (worker) worker.terminate();
      worker = null;
    });
    return worker;
  }

  function release() {
    if (worker && !pending.size) worker.postMessage({ type: "release" });
  }

  function cancel() {
    if (worker) worker.terminate();
    worker = null;
    rejectPending(new Error("Редактура остановлена."));
  }

  function paraphrase(sentence, options) {
    const source = String(sentence || "").trim();
    if (!source) return Promise.resolve([]);
    if (!supported()) return Promise.reject(new Error("WebGPU недоступен."));
    const settings = options || {};
    const count = Math.max(1, Math.min(Math.floor(Number(settings.count)) || MAX_VARIANTS, MAX_VARIANTS));
    requestId += 1;
    const id = requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { ensureWorker().postMessage({
        type: "paraphrase",
        id,
        sentence: source,
        language: settings.language === "en" ? "en" : "ru",
        count,
        position: Number(settings.position) || null,
        total: Number(settings.total) || null,
        contextual: settings.contextual === true,
        creative: settings.creative === true,
        context: settings.context,
        terms: settings.terms,
      }); } catch (error) { pending.delete(id); reject(error); }
    }).catch((error) => {
      if (error.message !== "Редактура остановлена.") report({ message: `Генератор недоступен: ${error.message}. Продолжаю со словарными версиями.`, isError: true });
      throw error;
    });
  }

  return { supported, paraphrase, release, cancel };
});
