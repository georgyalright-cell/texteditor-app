(function attach(root) {
  "use strict";
  const notice = document.getElementById("gpuSupportStatus");
  function render(state) {
    notice.textContent = state.message + (state.status === "blocked" ? " Обычная обработка и скачивание документов работают без модели." : "");
    notice.dataset.state = state.status;
    root.dispatchEvent(new Event("gpu-support-change"));
  }
  root.GpuSupport.subscribe(render);
  render(root.GpuSupport.snapshot());
  root.GpuSupport.refresh();
  // A return from browser settings can recheck availability, never load a model.
  root.addEventListener("focus", () => { if (!root.GpuSupport.ready()) root.GpuSupport.refresh(); });
})(window);
