(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root.document) return;
  const box = root.document.getElementById("modelRunStatus");
  if (!box) return;
  root.ModelRunStatus = api.create({ render(state) {
    box.hidden = state.phase === "idle";
    box.dataset.phase = state.phase;
    box.setAttribute("aria-busy", String(state.running));
    root.document.getElementById("modelRunLabel").textContent = state.label;
    root.document.getElementById("modelRunDetail").textContent = state.detail;
  } });
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  "use strict";
  function create({ render, now = Date.now, every = setInterval, stop = clearInterval }) {
    let ticket = 0, timer = null, started = 0, lastProgress = 0, stamp = "";
    let lastFailure = "";
    const errors = root.ModelErrors || (typeof require === "function" ? require("./model-errors.js") : null);
    const reason = error => errors ? errors.explain(error, { offline: Boolean(root.navigator && root.navigator.onLine === false) }).message : "Модуль диагностики не загрузился. Сохраните текст и обновите страницу; обработка моделью не подтверждена.";
    let state = { phase: "idle", running: false, label: "", detail: "" };
    function emit() {
      if (!state.running) { render({ ...state }); return; }
      const seconds = Math.floor((now() - started) / 1000);
      const stalled = now() - lastProgress >= 45000;
      render({ ...state, label: stalled ? "⏳ Давно нет прогресса — обработка ещё не завершена" : "⏳ Модель обрабатывает текст",
        detail: `Прошло ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}. ` + (stalled
          ? "Ожидаем ответ загрузчика или WebGPU. Причина пока неизвестна; можно остановить и повторить запуск."
          : "Дождитесь итогового статуса. Загрузка файлов — только один из этапов.") });
    }
    function finish(phase, label, detail = "Текущий текст сохранён.") {
      if (timer !== null) stop(timer);
      timer = null; state = { phase, label, detail, running: false }; emit();
    }
    return {
      async track(work) {
        if (state.running) return;
        const current = ++ticket;
        started = lastProgress = now(); stamp = ""; lastFailure = "";
        state = { phase: "running", running: true }; emit();
        timer = every(emit, 1000);
        try {
          const result = await work();
          if (current !== ticket || !state.running) return result;
          if (!result || result.completed !== true) finish("error", "! Обработка моделью не завершена", reason(lastFailure || result && result.reason));
          else if (result.limited) finish("partial", "! Модельная обработка выполнена не полностью", reason(lastFailure || result.reason));
          else if (result.modelUsed === false) finish("unchanged", "Модель не запускалась: нет подходящих предложений");
          else finish("done", "✓ Обработка моделью завершена", result.replaced
            ? "Перефразированный текст применён и готов к копированию или скачиванию."
            : "Модель проверила текст, но подходящих замен не нашлось. Исходные формулировки сохранены.");
          return result;
        } catch (error) {
          if (current === ticket && state.running) finish("error", "! Обработка моделью не завершена", reason(error));
          throw error;
        }
      },
      progress(event = {}) {
        if (!state.running) return;
        if (event.isError && event.message && (!lastFailure || errors && errors.explain(event.message).category !== "unknown")) lastFailure = event.message;
        const next = `${event.message || ""}|${event.progress ?? ""}`;
        if (next !== stamp) { stamp = next; lastProgress = now(); emit(); }
      },
      cancel(reason) {
        if (!state.running) return;
        ++ticket;
        if (reason === "timeout") finish("error", "! Истекло время ожидания модели", "Обработка не завершена. Текущий текст сохранён; можно повторить запуск.");
        else finish("cancelled", "■ Обработка моделью остановлена", "Завершённые изменения сохранены. Полный проход не выполнен.");
      },
      clear() { ++ticket; finish("idle", "", ""); },
    };
  }
  return { create };
});
