(function attach(root) {
  "use strict";
  root.FragmentRecovery = {
    discard() {
      return root.AutomaticRevision.discard().catch(() => {
        root.document.getElementById("sourceStatus").textContent = "Браузер не удалил прежнюю точку продолжения. После перезагрузки может появиться прежний черновик.";
      });
    },
    controls(button, text) {
      const done = root.AutomaticRevision.finished(text);
      button.disabled ||= done;
      button.textContent = done ? "Модельный проход завершён" : root.AutomaticRevision.pending(text)
        ? "Продолжить обработку моделью" : "Дополнительно обработать моделью";
    },
    restore(text, { elements, currentMode, startReview, updateControls }) {
      if (elements.sourceText.value || currentMode() !== "fragment") return;
      elements.sourceText.value = text;
      const language = root.RuleParaphraser.detectLanguage(text);
      startReview(text, { text, language, summary: ["Восстановлен сохранённый результат модельной обработки."], warnings: [] }, "fragment", "academic-report", true);
      updateControls();
    },
  };
})(window);
