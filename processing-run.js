(function attach(root) {
  "use strict";
  // Owns one complete run, including keyboard starts and cancellation on edits.
  function create(options) {
    let active = false;
    let revision = 0;
    return {
      busy: () => active,
      cancel() { revision += 1; options.cancel(); },
      async run() {
        if (active) return false;
        active = true;
        const operation = ++revision;
        options.busy(true);
        try {
          if (!options.base() || operation !== revision) return false;
          if (!options.supported()) {
            options.notice("Базовая обработка готова. Локальная модель не запущена: WebGPU недоступен. TXT, DOCX и сборка работают без неё.");
            return true;
          }
          await options.polish();
          return operation === revision;
        } catch (error) {
          if (operation === revision) options.notice(`Локальный проход не завершён. Текущий текст сохранён. ${error.message || "Попробуйте ещё раз."}`);
          return false;
        } finally {
          active = false;
          options.busy(false);
        }
      },
    };
  }
  const api = { create };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProcessingRun = api;
})(typeof window === "object" ? window : globalThis);
