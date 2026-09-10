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
        worker = new root.Worker("semantic-worker.js?v=53");
        const instance = worker;
        worker.onmessage = ({ data }) => {
          if (worker !== instance) return;
          if (data.type === "progress") { if (root.NeuralScorerUI) root.NeuralScorerUI.reportProgress(data); return; }
          const item = pending.get(data.id);
          if (!item) return;
          pending.delete(data.id); clearTimeout(item.timer);
          if (data.type === "scores") item.resolve(data.scores);
          else item.reject(new Error(data.message));
        };
        worker.onerror = event => { if (worker === instance) cancel(new Error(event.message || "Ошибка воркера проверки смысла.")); };
      }
      const id = ++serial;
      const timer = setTimeout(() => cancel(new Error("Время ожидания проверки смысла истекло (timeout).")), 600000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ type: "score", id, pairs }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  root.SemanticScorer = { score, cancel };
})(typeof globalThis !== "undefined" ? globalThis : window);
