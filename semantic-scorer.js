(function attach(root) {
  "use strict";
  let worker = null;
  let serial = 0;
  const pending = new Map();
  function cancel(error = new Error("Проверка смысла остановлена.")) {
    if (worker) worker.terminate();
    worker = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  function score(pairs) {
    if (!pairs.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      if (!worker) {
        worker = new root.Worker("semantic-worker.js?v=54");
        const instance = worker;
        let lastProgress = "";
        worker.onmessage = ({ data }) => {
          if (worker !== instance) return;
          if (data.type === "progress") {
            const signature = JSON.stringify([data.message, data.progress]);
            if (signature !== lastProgress) {
              lastProgress = signature;
              for (const item of pending.values()) item.touch();
            }
            if (root.NeuralScorerUI) root.NeuralScorerUI.reportProgress(data);
            return;
          }
          const item = pending.get(data.id);
          if (!item) return;
          pending.delete(data.id); clearTimeout(item.timer);
          if (data.type === "scores") item.resolve(data.scores);
          else item.reject(new Error(data.message));
        };
        worker.onerror = event => { if (worker === instance) cancel(new Error(event.message || "Ошибка воркера проверки смысла.")); };
      }
      const id = ++serial;
      const item = { resolve, reject, timer: null, touch() {
        clearTimeout(item.timer);
        item.timer = setTimeout(() => cancel(new Error("Проверка смысла не сообщает о прогрессе 10 минут (timeout).")), 600000);
      } };
      item.touch();
      pending.set(id, item);
      try { worker.postMessage({ type: "score", id, pairs }); }
      catch (error) { clearTimeout(item.timer); pending.delete(id); reject(error); }
    });
  }
  root.SemanticScorer = { score, cancel };
})(typeof globalThis !== "undefined" ? globalThis : window);
