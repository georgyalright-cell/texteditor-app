(function attach(root) {
  "use strict";
  let current = null;
  const box = document.getElementById("revisionPreview");
  const list = document.getElementById("revisionPreviewList");
  const note = document.getElementById("revisionPreviewNote");
  const apply = document.getElementById("revisionPreviewApply");
  function clear() { current = null; box.hidden = true; list.textContent = ""; }
  function show(result, onApply) {
    clear();
    if (!result.details.length) return;
    current = { result, onApply, selected: new Set() };
    for (const [index, detail] of result.details.entries()) {
      const row = document.createElement("li"); row.className = "revision-choice";
      const label = document.createElement("label");
      const checkbox = document.createElement("input"); checkbox.type = "checkbox";
      const text = document.createElement("span"); text.textContent = detail.requiresReview ? "Новая формулировка — проверьте смысл" : "Перестройка с сохранением лексики";
      checkbox.addEventListener("change", () => { if (!current) return; if (checkbox.checked) current.selected.add(index); else current.selected.delete(index); apply.disabled = !current.selected.size; });
      label.append(checkbox, text);
      const before = document.createElement("p"); before.textContent = detail.before;
      const after = document.createElement("p"); after.textContent = detail.after;
      before.className = "revision-before"; after.className = "revision-after";
      row.append(label, before, after); list.appendChild(row);
      const measures = [];
      if (Number.isFinite(detail.semanticSimilarity)) measures.push(`Сходство эмбеддингов: ${detail.semanticSimilarity.toFixed(3)}`);
      if (detail.neural) measures.push(`Перплексия: ${detail.neural.before.perplexity.toFixed(1)} → ${detail.neural.after.perplexity.toFixed(1)}`);
      if (measures.length) { const info = document.createElement("p"); info.className = "revision-before"; info.textContent = measures.join(" · ") + ". Не оценка авторства."; row.appendChild(info); }
    }
    note.textContent = "Отметьте подходящие варианты. Сравнение смысла — фильтр похожести, а не проверка фактов. Проверьте действующих лиц, причинность и грамматику; до применения документ не меняется.";
    apply.disabled = true; box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  apply.addEventListener("click", () => {
    if (!current) return;
    const { result, onApply, selected } = current;
    const details = result.details.filter((_, index) => selected.has(index));
    let text = result.source;
    for (const detail of details.slice().sort((a, b) => b.start - a.start)) {
      if (text.slice(detail.start, detail.end).trim() !== detail.before) { note.textContent = "Текст изменился. Запустите редактуру заново."; return; }
      text = text.slice(0, detail.start) + detail.after + text.slice(detail.end);
    }
    if (!root.AnchorGuard.compare(result.source, text).ok) { note.textContent = "Не удалось сохранить числа или ссылки. Замены не применены."; return; }
    const countWords = (s) => (s.match(/[\p{L}\p{N}_-]+/gu) || []).length;
    clear();
    onApply({ ...result, text, details, replaced: details.length, changedWordShare: details.reduce((n, d) => n + countWords(d.before), 0) / Math.max(1, countWords(result.source)) });
  });
  document.getElementById("revisionPreviewDiscard").addEventListener("click", clear);
  root.RevisionPreview = { show, clear };
})(window);
