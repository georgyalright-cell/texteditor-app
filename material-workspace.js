(function attach(root) {
  "use strict";
  function mount(options) {
    const e = options.elements;
    const toggle = document.getElementById("wholeDocument");
    const choice = document.getElementById("wholeDocumentChoice");
    const preview = document.getElementById("materialSource");
    const status = document.getElementById("materialStatus");
    let projectMode = false, source = [], processed = null, generation = 0, busy = false, pendingPaste = false;
    let modelJob = null, notes = [], changed = 0, pasteRevision = 0, contentRevision = 0;
    let storageNotice = "", lastReport = "";
    const active = () => projectMode && toggle.checked;
    function report(message, error = false) {
      lastReport = message; status.textContent = [message, storageNotice].filter(Boolean).join(" ");
      status.classList.toggle("is-error", error || Boolean(storageNotice));
    }
    function save() {
      const operation = generation;
      root.MaterialDraft.save(source.length ? { version: 1, source, processed, changed, profileId: options.profile(), notes } : null).then(() => {
        if (generation === operation && storageNotice) { storageNotice = ""; report(lastReport); }
      }).catch(() => {
        if (generation === operation) {
          storageNotice = "Черновик остался только в этой вкладке: браузер не разрешил сохранение. Скачайте DOCX перед закрытием.";
          report(lastReport, true);
        }
      });
    }
    function cancel() {
      generation++; pasteRevision++; pendingPaste = false;
      root.PolishUI.cancel(); root.RevisionPreview.clear();
    }
    function invalidate(keepProcessed = false) { cancel(); contentRevision++; modelJob = null; if (!keepProcessed) processed = null; options.invalidate(); }
    function controls() {
      choice.hidden = !projectMode; status.hidden = !active();
      preview.hidden = !active() || !source.length;
      e.sourceText.hidden = active() && source.length > 0;
      e.sourceCount.hidden = active() && source.length > 0;
      e.fileInput.closest(".file-row").hidden = active();
      e.partFields.hidden = !projectMode || active();
      e.partsLibrary.hidden = !projectMode || active();
      e.projectWorkspace.hidden = !projectMode || active();
      e.addPartButton.hidden = !projectMode || active();
      e.assembleProjectButton.hidden = !projectMode || active();
      if (!active()) {
        if (projectMode) {
          e.sourceTitle.textContent = "Новая часть работы";
          if (!options.otherBusy()) e.processButton.textContent = "Обработать часть";
        }
        return;
      }
      const available = source.length || e.sourceText.value.trim();
      e.processButton.textContent = busy ? "Обрабатываю документ…" : modelJob && modelJob.cursor < modelJob.jobs.length ? "Продолжить редактуру" : "Обработать и собрать документ";
      e.processButton.disabled = !available || busy || pendingPaste || options.otherBusy();
      e.clearButton.disabled = !available && !busy;
      e.sourceTitle.textContent = "Работа целиком из буфера";
      e.sourceText.placeholder = "Вставьте работу целиком";
      document.getElementById("polishCancelButton").hidden = !busy && !options.otherBusy();
      const missing = source.some((block) => block.type === "imageMissing");
      if (missing || busy || pendingPaste) { e.downloadDocxButton.disabled = true; e.downloadButton.disabled = true; }
    }
    function display() {
      root.MaterialView.render(preview, source, async (index, file) => {
        cancel(); const operation = generation, ticket = pasteRevision;
        pendingPaste = true; options.update();
        try {
          const picture = await root.ClipboardDocument.fileImage(file);
          if (operation !== generation) return;
          const next = source.slice(); next[index] = picture; root.ClipboardDocument.validate(next);
          invalidate(true); source = next; if (processed) processed[index] = picture; save(); display(); summary();
        } catch (error) { if (operation === generation) report(error.message, true); }
        finally { if (ticket === pasteRevision) pendingPaste = false; options.update(); }
      }, (index) => {
        if (!root.confirm("Удалить это место фотографии из документа?")) return;
        invalidate(true); source.splice(index, 1); if (processed) processed.splice(index, 1); save(); display(); summary();
      });
      e.sourceText.value = root.ClipboardDocument.textOf(source); options.update(); controls();
    }
    function summary() {
      const tables = source.filter((b) => b.type === "docTable" || b.type === "table").length;
      const photos = source.filter((b) => b.type === "image").length;
      const missing = source.filter((b) => b.type === "imageMissing").length;
      report(`Вставлено: ${source.length} блоков, таблиц ${tables}, фото ${photos}. ${missing ? `Недоступных фото: ${missing}. Прикрепите файлы ниже — до этого экспорт заблокирован. ` : ""}${notes.join(" ")} Черновик хранится в этом браузере; новая вставка заменяет его.`, missing > 0);
    }
    async function paste(event) {
      if (!active() || !event.clipboardData) return;
      event.preventDefault();
      if (source.length && !root.confirm("Заменить текущий документ материалом из буфера?")) return;
      contentRevision++;
      // Capture DataTransfer now: browsers can clear it after the event returns.
      const html = event.clipboardData.getData("text/html"), text = event.clipboardData.getData("text/plain");
      const files = Array.from(event.clipboardData.files);
      cancel(); const operation = generation, ticket = pasteRevision; pendingPaste = true; options.update();
      report("Читаю буфер: текст, таблицы и изображения…");
      try {
        const imported = await root.ClipboardDocument.read({ getData: (type) => type === "text/html" ? html : text, files }, document);
        if (generation !== operation) return;
        invalidate(); source = imported.blocks; notes = imported.warnings; save(); display(); summary();
      } catch (error) { if (generation === operation) report(`Вставка не применена, прежний материал сохранён. ${error.message}`, true); }
      finally { if (ticket === pasteRevision) pendingPaste = false; options.update(); }
    }
    function assemble(blocks) {
      root.DocumentImages.validate(blocks);
      const assembled = root.DocumentBuilder.assemble({ blocks, text: root.ClipboardDocument.textOf(blocks),
        preserveOrder: true, profileId: options.profile(), metadata: options.metadata() });
      options.result(assembled, changed);
      return assembled;
    }
    function showChoices() {
      if (!modelJob || !modelJob.details.length || !active()) return;
      const job = modelJob, base = processed, operation = generation;
      root.RevisionPreview.show({ source: job.text, details: job.details, replaced: job.details.length }, (accepted) => {
        if (operation !== generation || processed !== base || !active()) return;
        try {
          processed = root.MaterialProcessing.apply(base, accepted.details); modelJob = null;
          save();
          assemble(processed); report(`Применено ${accepted.replaced} подтверждённых замен. Таблицы и фото сохранены.`);
        } catch (error) { report(error.message, true); }
      });
    }
    async function run() {
      if (!active() || busy || pendingPaste || options.otherBusy()) return;
      if (!source.length) {
        contentRevision++;
        const importGeneration = ++generation, text = e.sourceText.value;
        pendingPaste = true; options.update();
        try {
          const imported = await root.ClipboardDocument.read({ getData: (type) => type === "text/plain" ? text : "", files: [] }, document);
          if (generation !== importGeneration) return;
          source = imported.blocks; notes = imported.warnings; display(); save();
        } catch (error) { if (generation === importGeneration) report(error.message, true); return; }
        finally { if (generation === importGeneration) pendingPaste = false; options.update(); }
      }
      if (!source.length) return;
      try { root.DocumentImages.validate(source); } catch (error) { report(error.message, true); return; }
      const operation = ++generation, current = () => operation === generation && active();
      busy = true; root.RevisionPreview.clear(); options.update();
      try {
        if (!processed) {
          const result = await root.MaterialProcessing.base(source, { process: (text) => root.TextPipeline.run(text), isCurrent: current,
            progress: (done, total) => report(`Базовая обработка: ${done} / ${total} блоков. Таблицы и фото не переписываются.`) });
          if (!result || !current()) return;
          processed = result.blocks; changed = result.changed; notes = [...notes, ...result.warnings];
          save();
        }
        assemble(processed);
        if (!root.Generator.supported()) { report(`Документ собран: изменено абзацев ${changed}. WebGPU недоступен — выполнена базовая обработка. ${notes.join(" ")}`); return; }
        if (!modelJob) modelJob = { ...root.MaterialProcessing.jobs(processed), cursor: 0, details: [] };
        for (; modelJob.cursor < modelJob.jobs.length;) {
          if (!current()) return;
          const job = modelJob, piece = job.jobs[job.cursor]; let result = null;
          const progress = `Локальная редактура: порция ${job.cursor + 1} / ${job.jobs.length}. `;
          report(progress + "Можно остановить и продолжить в этой вкладке.");
          await root.PolishUI.run({ text: piece.text, language: root.RuleParaphraser.detectLanguage(piece.text), isCurrent: current,
            collect: (value) => { result = value; }, report: (message, error) => report(progress + message, error) });
          if (!current()) return;
          if (!result) { report(progress + "Порция не завершена. Нажмите «Продолжить редактуру» или скачайте базовый DOCX.", true); break; }
          const rankingWarning = /недоступна|пропущено/u.test(result.rankingSummary || "") ? [result.rankingSummary] : [];
          notes = [...new Set([...notes, ...(result.generatorWarnings || []), ...(result.warnings || []), ...rankingWarning])];
          job.details.push(...result.details.map((detail) => ({ ...detail, start: detail.start + piece.offset, end: detail.end + piece.offset })));
          job.cursor++;
        }
        if (current()) {
          showChoices();
          if (modelJob.cursor === modelJob.jobs.length) report(`Документ собран. Базово изменено абзацев: ${changed}. Для подтверждения: ${modelJob.details.length} замен. Не каждая фраза нуждается в замене. ${notes.join(" ")}`);
        }
      } catch (error) { if (current()) report(error.message || "Не удалось собрать документ.", true); }
      finally {
        busy = false; options.update();
        if (operation !== generation && active()) { report("Остановлено. Материал сохранён. Продолжить можно в этой вкладке."); showChoices(); }
      }
    }
    toggle.addEventListener("change", () => { cancel(); options.invalidate(); options.update(); controls(); });
    e.sourceText.addEventListener("paste", paste); preview.addEventListener("paste", paste);
    preview.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); run(); } });
    const initialContent = contentRevision;
    root.MaterialDraft.load().then(async (draft) => {
      if (!draft || draft.version !== 1 || contentRevision !== initialContent || e.sourceText.value) return;
      root.ClipboardDocument.validate(draft.source);
      if (draft.processed) root.ClipboardDocument.validate(draft.processed);
      for (const block of draft.source) if (block.type === "image") await root.DocumentImages.decode(block.dataUrl);
      if (contentRevision !== initialContent || e.sourceText.value) return;
      source = draft.source; notes = Array.isArray(draft.notes) ? draft.notes : [];
      processed = draft.processed || null; changed = Number(draft.changed) || 0;
      if (active()) display(); summary();
    }).catch(() => report("Сохранённый черновик недоступен. Можно вставить материал заново.", true));
    return {
      active, controls, run, cancel, busy: () => busy,
      setMode(value) { if (value !== projectMode) cancel(); projectMode = value; if (active() && source.length) display(); controls(); },
      invalidate(keepProcessed = false) { cancel(); modelJob = null; if (!keepProcessed) { contentRevision++; processed = null; } else save(); },
      clear() { invalidate(); source = []; notes = []; save(); display(); report(""); },
    };
  }
  root.MaterialWorkspace = { mount };
})(window);
