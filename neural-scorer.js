(function attachNeuralScorerUI(root) {
  "use strict";

  const elements = {
    panel: document.querySelector("#neuralAssistant"),
    button: document.querySelector("#neuralScoreButton"),
    status: document.querySelector("#neuralStatus"),
    progress: document.querySelector("#neuralProgress"),
    results: document.querySelector("#neuralResults"),
    note: document.querySelector("#neuralResultNote"),
  };
  let texts = { source: "", result: "" };
  let worker = null;
  let requestId = 0;
  let contentVersion = 0;
  let activeVersion = 0;
  let busy = false;
  let lockedForPolish = false;

  function supported() {
    return Boolean(root.navigator && root.navigator.gpu && root.Worker);
  }

  function setStatus(message, isError) {
    elements.status.textContent = message || "";
    elements.status.classList.toggle("is-error", Boolean(isError));
  }

  function reportProgress(message) {
    const detail = message || {};
    setStatus(detail.message, detail.isError);
    elements.progress.hidden = Boolean(detail.done) || !detail.message;
    if (elements.progress.hidden || !Number.isFinite(detail.progress)) elements.progress.removeAttribute("value");
    else elements.progress.value = detail.progress;
  }

  function setBusy(value) {
    busy = value;
    elements.button.disabled = value || lockedForPolish || !texts.result || !supported();
    elements.button.textContent = value ? "Оцениваю…" : "Загрузить и оценить";
  }

  function lockForPolish() {
    if (lockedForPolish || busy || pending.size) return false;
    lockedForPolish = true;
    if (worker) worker.terminate();
    worker = null;
    modelsWarm = false;
    setBusy(false);
    return true;
  }

  function unlockAfterPolish() {
    lockedForPolish = false;
    setBusy(busy);
  }

  function cancelPolishScoring() {
    if (!lockedForPolish) return;
    if (worker) worker.terminate();
    worker = null; modelsWarm = false;
    for (const waiting of pending.values()) waiting.reject(new Error("Редактура остановлена."));
    pending.clear();
  }

  function resetResult() {
    elements.results.textContent = "";
    elements.results.hidden = true;
    elements.note.textContent = "";
    elements.progress.hidden = true;
    elements.progress.removeAttribute("value");
  }

  function scoreCard(label, value) {
    const card = document.createElement("article");
    card.className = "neural-score-card";
    const title = document.createElement("h3");
    title.textContent = label;
    const binoculars = document.createElement("p");
    binoculars.className = "neural-score-main";
    const metricLabel = document.createElement("span");
    metricLabel.textContent = "Binoculars";
    const metricValue = document.createElement("strong");
    metricValue.textContent = value.binoculars.toFixed(3);
    binoculars.append(metricLabel, metricValue);
    const details = document.createElement("p");
    details.className = "neural-score-details";
    details.textContent = `Перплексия ${value.perplexity.toFixed(1)} · ${value.tokenCount} токенов`;
    card.append(title, binoculars, details);
    return card;
  }

  function renderResult(message) {
    elements.results.textContent = "";
    elements.results.append(scoreCard("Исходник", message.before), scoreCard("После обработки", message.after));
    elements.results.hidden = false;
    const delta = message.after.binoculars - message.before.binoculars;
    const direction = Math.abs(delta) < 0.0005 ? "не изменился" : `${delta > 0 ? "вырос" : "снизился"} на ${Math.abs(delta).toFixed(3)}`;
    elements.note.textContent =
      `Binoculars ${direction}. Проверено до ${message.maxTokens} токенов каждой версии. ` +
      "Это сравнительная метрика, а не доказательство авторства: универсального порога для этой пары моделей нет.";
    setStatus("Оценка завершена. Повторная загрузка моделей обычно не потребуется.", false);
  }

  const pending = new Map();
  let modelsWarm = false;
  let selectionId = 1000000;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("neural-worker.js?v=38");
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        reportProgress(message);
        return;
      }
      if (message.type === "ready") {
        modelsWarm = true;
        setStatus(message.message, false);
        return;
      }
      // Ответы отбора вариантов разбираются раньше: у них своё
      // пространство идентификаторов, и панель показа их не касается.
      if (pending.has(message.id)) {
        const waiting = pending.get(message.id);
        pending.delete(message.id);
        elements.progress.hidden = true;
        if (message.type === "scores") {
          modelsWarm = true;
          waiting.resolve(message.scores || []);
        }
        else if (message.type === "error") waiting.reject(new Error(message.message || "Оценка не выполнена."));
        return;
      }
      if (message.id !== requestId) return;
      elements.progress.hidden = true;
      if (activeVersion !== contentVersion) {
        setStatus("Текст изменился во время расчёта. Запустите оценку новой версии.", false);
        setBusy(false);
        return;
      }
      if (message.type === "result") {
        modelsWarm = true;
        renderResult(message);
      }
      if (message.type === "error") setStatus(`Нейрооценка не выполнена: ${message.message}`, true);
      if (message.type === "result" || message.type === "error") setBusy(false);
    });
    worker.addEventListener("error", (event) => {
      if (worker) worker.terminate();
      worker = null; modelsWarm = false;
      for (const waiting of pending.values()) {
        waiting.reject(new Error(event.message || "ошибка вычислительного модуля"));
      }
      pending.clear();
      elements.progress.hidden = true;
      setStatus(`Нейрооценка не выполнена: ${event.message || "ошибка вычислительного модуля"}`, true);
      setBusy(false);
    });
    return worker;
  }

  function setTexts(source, result) {
    texts = { source: String(source || ""), result: String(result || "") };
    contentVersion += 1;
    elements.panel.hidden = !texts.result;
    resetResult();
    if (!texts.result) return;
    if (!supported()) {
      setStatus("WebGPU недоступен. Обычная обработка продолжает работать без нейромоделей.", true);
    } else {
      setStatus(
        "Оценка при первом запуске загрузит около 1 ГБ. Генератор формулировок — ещё около 880 МБ только при его запуске.",
        false,
      );
    }
    setBusy(busy);
  }

  elements.button.addEventListener("click", () => {
    if (busy || !texts.result || !supported()) return;
    resetResult();
    setBusy(true);
    requestId += 1;
    activeVersion = contentVersion;
    ensureWorker().postMessage({ type: "score", id: requestId, ...texts });
  });

  /**
   * Оценить несколько версий текста локальной моделью.
   * Возвращает значения Binoculars: чем БОЛЬШЕ, тем человечнее. Отбор
   * кандидатов ждёт обратного соглашения и переворачивает знак сам —
   * держать оба соглашения в одном месте было бы источником ошибок.
   */
  function scoreTexts(texts) {
    const list = (texts || []).map((item) => String(item || ""));
    if (!list.length) return Promise.resolve([]);
    if (!supported()) return Promise.reject(new Error("WebGPU недоступен."));
    selectionId += 1;
    const id = selectionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ensureWorker().postMessage({ type: "scoreMany", id, texts: list });
    }).then((scores) => scores.map((item) => Number(item && item.binoculars)));
  }

  root.NeuralScorerUI = {
    setTexts,
    supported,
    scoreTexts,
    // Загружены ли модели. Ранжирование перплексией опирается на это: само
    // оно загрузку не начинает.
    warm: () => modelsWarm,
    reportProgress,
    lockForPolish,
    unlockAfterPolish,
    cancelPolishScoring,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
