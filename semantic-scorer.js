(function attach(root) {
  "use strict";
  let worker = null;
  let serial = 0;
  const pending = new Map();
  function cancel() {
    if (worker) worker.terminate();
    worker = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Проверка смысла остановлена.")); }
    pending.clear();
  }
  function score(pairs) {
    if (!pairs.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      if (!worker) {
        worker = new root.Worker("semantic-worker.js?v=39");
        worker.onmessage = ({ data }) => {
          if (data.type === "progress") { if (root.NeuralScorerUI) root.NeuralScorerUI.reportProgress(data); return; }
          const item = pending.get(data.id);
          if (!item) return;
          pending.delete(data.id); clearTimeout(item.timer);
          if (data.type === "scores") item.resolve(data.scores);
          else item.reject(new Error(data.message));
        };
        worker.onerror = cancel;
      }
      const id = ++serial;
      const timer = setTimeout(cancel, 600000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ type: "score", id, pairs }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  root.SemanticScorer = { score, cancel };
})(typeof globalThis !== "undefined" ? globalThis : window);
