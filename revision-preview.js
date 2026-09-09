(function attach(root) {
  "use strict";
  let current = null;
  const box = document.getElementById("revisionPreview");
  const list = document.getElementById("revisionPreviewList");
  const note = document.getElementById("revisionPreviewNote");
  const apply = document.getElementById("revisionPreviewApply");
  function clear() { current = null; box.hidden = true; box.open = false; list.textContent = ""; }
  function showAutomatic(result, onUndo) {
    clear();
    if (!result.details.length) return;
    current = { onUndo };
    document.getElementById("revisionPreviewTitle").textContent = `Применённые формулировки: ${result.details.length} · сравнить и отменить`;
    for (const detail of result.details) {
      const row = document.createElement("li"); row.className = "revision-choice";
      for (const [key, style] of [["before", "revision-before"], ["after", "revision-after"]]) {
        const p = document.createElement("p"); p.className = style; p.textContent = detail[key]; row.appendChild(p);
      }
      list.appendChild(row);
    }
    note.textContent = "Проверенные варианты применены автоматически. Автоматическая проверка сходства не гарантирует сохранение всех фактов: перед отправкой прочитайте результат. Можно отменить весь локальный проход.";
    apply.textContent = "Отменить локальную редактуру"; apply.disabled = false; box.hidden = false;
    document.getElementById("revisionPreviewDiscard").textContent = "Скрыть сравнение";
  }
  apply.addEventListener("click", () => {
    if (!current) return;
    const undo = current.onUndo; clear(); undo();
  });
  document.getElementById("revisionPreviewDiscard").addEventListener("click", () => { box.open = false; });
  root.RevisionPreview = { showAutomatic, clear };
})(window);
