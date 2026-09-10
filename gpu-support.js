(function attach(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = { create: factory };
  root.GpuSupport = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : self, function create(root) {
  "use strict";
  // Minimum limits required by our pinned WebLLM runtime (not a VRAM promise).
  const limits = { maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728,
    maxComputeWorkgroupStorageSize: 32768, maxStorageBuffersPerShaderStage: 10 };
  const listeners = new Set();
  let state = { status: "checking", message: "Проверяю доступ к WebGPU… Модели не скачиваются." }, pending = null;
  const blocked = (code, message) => ({ status: "blocked", code, message });
  const settingsHint = "В Brave/Chrome/Edge откройте Настройки → Система, включите аппаратное ускорение графики и перезапустите браузер. Если оно уже включено, нужен браузер и видеоускоритель с поддержкой WebGPU.";
  async function probe() {
    if (root.isSecureContext === false) return blocked("context", "WebGPU требует HTTPS или localhost. Откройте защищённую версию сайта.");
    if (!root.navigator?.gpu || typeof root.navigator.gpu.requestAdapter !== "function") return blocked("api", "Этот браузер не предоставляет WebGPU. " + settingsHint);
    let timer;
    try {
      const adapter = await Promise.race([
        root.navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("probe-timeout")), 8000); }),
      ]);
      if (!adapter) return blocked("adapter", "Браузер не предоставил видеоускоритель. " + settingsHint);
      if (!adapter.features.has("shader-f16")) return blocked("feature", "WebGPU доступен, но нет необходимой функции shader-f16. Этот браузер или видеоускоритель не подходит для текущей модели.");
      for (const [name, required] of Object.entries(limits)) {
        if (!(adapter.limits[name] >= required)) return blocked("limits", `Недостаточный лимит WebGPU ${name}: ${adapter.limits[name]}, требуется ${required}. Нужен совместимый браузер или видеоускоритель.`);
      }
      return { status: "ready", message: "✓ WebGPU доступен. Модель можно запустить после обычной обработки." };
    } catch {
      return blocked("probe", "Не удалось проверить доступ к WebGPU. " + settingsHint);
    } finally { clearTimeout(timer); }
  }
  function publish(value) { state = value; for (const listener of listeners) listener({ ...state }); }
  function refresh() {
    if (pending) return pending;
    publish({ status: "checking", message: "Проверяю доступ к WebGPU… Модели не скачиваются." });
    pending = probe().then(result => { publish(result); return result; }).finally(() => { pending = null; });
    return pending;
  }
  return { probe, refresh, ready: () => state.status === "ready", snapshot: () => ({ ...state }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
});
