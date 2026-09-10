(function attach(root) {
  "use strict";
  function save(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function create(options) {
    function basename(state) {
      const original = state.blocks?.find(block => block.sourceDocx)?.sourceDocx.filename;
      const source = original ? original.replace(/\.docx$/iu, "") : state.kind === "document" ? state.topic || "course_project" : state.filename || "processed_text";
      return source.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "processed_text";
    }
    return {
      text() {
        const state = options.state(); if (!state.text) return;
        save(new Blob(["\uFEFF", state.text], { type: "text/plain;charset=utf-8" }), `${basename(state)}_${state.kind === "document" ? "assembled" : "processed"}.txt`);
      },
      // Обратный путь: то же содержимое в буфер, а не новым файлом. Скачивание
      // отдаёт документ, который надо открывать; сюда текст вернулся, чтобы
      // встать на своё место в исходном файле.
      async copyBack() {
        const state = options.state();
        if (!state.blocks || !state.blocks.length) return;
        try {
          const result = await root.DocumentClipboard.copy(state.blocks);
          options.notify(result.message);
        } catch (error) {
          options.error(error.message || "Не удалось скопировать в буфер обмена.");
        }
      },
      async docx() {
        const state = options.state(); if (!state.text || !state.blocks.length) return;
        options.busy();
        try {
          const blob = await root.DocxWriter.createDocxBlob(state.blocks, root.FormatProfiles.get(state.profileId));
          save(blob, `${basename(state)}_${state.kind === "document" ? "document" : "formatted"}.docx`);
        } catch (error) { options.error(error.message || "Не удалось собрать DOCX."); }
        finally { options.update(); }
      },
    };
  }
  root.AppExport = { create };
})(window);
