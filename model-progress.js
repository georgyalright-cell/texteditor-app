(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ModelProgress = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";
  const percent = (value) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const mb = (bytes) => `${(bytes / 1000000).toFixed(1)} МБ`;

  function transformers(model, event = {}) {
    const file = String(event.file || "").split("/").pop();
    const value = percent(event.progress);
    const loaded = typeof event.loaded === "number" && Number.isFinite(event.loaded) && event.loaded >= 0 ? event.loaded : null;
    const total = typeof event.total === "number" && Number.isFinite(event.total) && event.total > 0 ? event.total : null;
    const bytes = loaded !== null ? total !== null ? `${mb(Math.min(loaded, total))} из ${mb(total)}` : mb(loaded) : "";
    const phase = event.status === "done" ? "Файл готов; подготовка модели" : event.status === "ready" ? "Готова к обработке"
      : event.status === "progress" ? "Чтение файла (сеть или кэш)" : "Проверка и получение файлов";
    return { progress: event.status === "done" || event.status === "ready" ? null : value,
      message: [model, phase, file, bytes, value !== null && event.status === "progress" ? `${Math.round(value)}% файла` : ""].filter(Boolean).join(" · ") };
  }

  function generator(report = {}) {
    const raw = typeof report.progress === "number" ? report.progress * 100 : null;
    const value = percent(raw);
    const text = String(report.text || "");
    const count = text.match(/\[(\d+)\/(\d+)\]/);
    const size = text.match(/([\d.]+)MB (?:loaded|fetched)/);
    const phase = text.includes("Loading model from cache") ? "Из кэша → в память"
      : text.includes("Fetching param cache") ? "Получение файлов модели"
      : text.includes("Loading GPU shader") ? "Подготовка WebGPU (не скачивание)" : "Подготовка и проверка кэша";
    return { progress: value, message: ["Генератор · Qwen2.5 1.5B", phase,
      count ? `части ${count[1]} из ${count[2]}` : "", size ? `≈${mb(Number(size[1]) * 1024 * 1024)}` : "",
      value !== null ? `${Math.round(value)}% этапа` : ""].filter(Boolean).join(" · ") };
  }
  return { percent, transformers, generator };
});
