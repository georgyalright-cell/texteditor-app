(function attach(root) {
  "use strict";
  function create(options) {
    let revision = 0;
    async function load(file) {
      if (!file) return;
      const ticket = ++revision;
      const originalText = options.source?.value;
      const isCurrent = () => ticket === revision && options.source?.value === originalText;
      options.report(`Читаю ${file.name}…`, false);
      try {
        const workspace = options.material();
        const imported = workspace && await workspace.loadFile(file, { isCurrent });
        if (ticket !== revision) return;
        if (imported) { if (imported === "imported") options.report(file.name, false); return; }
        if (workspace && workspace.active()) throw new Error("Для сохранения целого документа загрузите DOCX или вставьте материал с форматированием.");
        const text = await root.DocumentReader.readFile(file);
        if (isCurrent()) options.apply(file, text);
      } catch (error) { if (ticket === revision) options.report(error.message || "Не удалось прочитать файл.", true); }
      finally { if (ticket === revision) for (const input of options.inputs) input.value = ""; }
    }
    for (const input of options.inputs) input.addEventListener("change", () => load(input.files[0]));
    options.documentButton.addEventListener("click", () => options.inputs[1].click());
    return load;
  }
  root.DocumentFileInput = { create };
})(window);
