(function startApp() {
  "use strict";

  const elements = {
    sourceText: document.querySelector("#sourceText"),
    resultText: document.querySelector("#resultText"),
    sourceCount: document.querySelector("#sourceCount"),
    resultCount: document.querySelector("#resultCount"),
    resultState: document.querySelector("#resultState"),
    sourceStatus: document.querySelector("#sourceStatus"),
    resultNote: document.querySelector("#resultNote"),
    fileInput: document.querySelector("#fileInput"),
    dropZone: document.querySelector("#dropZone"),
    processButton: document.querySelector("#processButton"),
    clearButton: document.querySelector("#clearButton"),
    downloadButton: document.querySelector("#downloadButton"),
    downloadDocxButton: document.querySelector("#downloadDocxButton"),
    copyBackButton: document.querySelector("#copyBackButton"),
    addPartButton: document.querySelector("#addPartButton"),
    assembleProjectButton: document.querySelector("#assembleProjectButton"),
    resetProjectButton: document.querySelector("#resetProjectButton"),
    nextMissingButton: document.querySelector("#nextMissingButton"),
    profileBar: document.querySelector("#profileBar"),
    profileSelect: document.querySelector("#profileSelect"),
    profileDescription: document.querySelector("#profileDescription"),
    compliance: document.querySelector("#compliance"),
    complianceBody: document.querySelector("#complianceBody"),
    metrics: document.querySelector("#metrics"),
    metricsGrid: document.querySelector("#metricsGrid"),
    metricsNote: document.querySelector("#metricsNote"),
    assemblySummary: document.querySelector("#assemblySummary"),
    metadata: document.querySelector("#metadata"),
    projectWorkspace: document.querySelector("#projectWorkspace"),
    partFields: document.querySelector("#partFields"),
    partsLibrary: document.querySelector("#partsLibrary"),
    partsList: document.querySelector("#partsList"),
    partSection: document.querySelector("#partSection"),
    partTitle: document.querySelector("#partTitle"),
    readinessBadge: document.querySelector("#readinessBadge"),
    readinessCount: document.querySelector("#readinessCount"),
    readinessList: document.querySelector("#readinessList"),
    sourceTitle: document.querySelector("#source-title"),
    resultTitle: document.querySelector("#result-title"),
    review: document.querySelector("#review"),
    modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
  };

  const metaFields = {
    topic: document.querySelector("#metaTopic"),
    programme: document.querySelector("#metaProgramme"),
    goal: document.querySelector("#metaGoal"),
    object: document.querySelector("#metaObject"),
    scope: document.querySelector("#metaScope"),
    methods: document.querySelector("#metaMethods"),
    team: document.querySelector("#metaTeam"),
    supervisor: document.querySelector("#metaSupervisor"),
    year: document.querySelector("#metaYear"),
  };

  let currentMode = "fragment";
  let currentResult = "";
  let currentBlocks = [];
  let currentOutputKind = "", currentOutputProfileId = "";
  let currentProcessedPart = "", sourceFilename = "";
  let project = loadProject();
  let activeReview = null;
  let material = null;
  const processing = window.ProcessingRun.create({
    base: processSource,
    supported: () => Boolean(window.Generator && window.Generator.supported()),
    polish: () => window.ModelRunStatus ? window.ModelRunStatus.track(() => window.ReviewUI.polishWithModel()) : window.ReviewUI.polishWithModel(),
    cancel: () => { if (window.PolishUI) window.PolishUI.cancel(); },
    notice: (message) => window.NeuralScorerUI.reportProgress({ done: true, isError: true, message }),
    busy(value) {
      elements.processButton.textContent = value ? "Обрабатываю…" : currentMode === "project" ? "Обработать часть" : "Обработать текст";
      document.getElementById("polishCancelButton").hidden = !value;
      elements.processButton.setAttribute("aria-busy", String(value));
      updateControls();
    },
  });

  function pluralForm(value, one, few, many) {
    const absolute = Math.abs(value) % 100;
    const last = absolute % 10;
    if (absolute > 10 && absolute < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function characterLabel(value) {
    return `${value.toLocaleString("ru-RU")} ${pluralForm(value, "символ", "символа", "символов")}`;
  }

  function setStatus(element, message, isError) {
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function selectedProfileId() {
    return elements.profileSelect.value || window.FormatProfiles.defaultProfileId();
  }

  function loadProject() {
    if (!window.WorkProject) return null;
    try {
      const raw = localStorage.getItem(window.WorkProject.STORAGE_KEY);
      return window.WorkProject.sanitize(raw ? JSON.parse(raw) : null, window.FormatProfiles.defaultProfileId());
    } catch (_error) {
      return window.WorkProject.create(window.FormatProfiles.defaultProfileId());
    }
  }

  function saveProject() {
    try {
      localStorage.setItem(window.WorkProject.STORAGE_KEY, JSON.stringify(project));
      return true;
    } catch (_error) {
      setStatus(elements.sourceStatus, "Браузер запретил локальное сохранение. Не закрывайте вкладку до скачивания.", true);
      return false;
    }
  }

  function fillProfiles() {
    for (const profile of window.FormatProfiles.list()) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      elements.profileSelect.appendChild(option);
    }
    elements.profileSelect.value = project && project.profileId ? project.profileId : window.FormatProfiles.defaultProfileId();
    updateProfileDescription();
    fillSectionOptions();
  }

  function updateProfileDescription() {
    elements.profileDescription.textContent = window.FormatProfiles.get(selectedProfileId()).description;
  }

  function fillSectionOptions() {
    elements.partSection.textContent = "";
    const automatic = document.createElement("option");
    automatic.value = "auto";
    automatic.textContent = "Определить автоматически";
    elements.partSection.appendChild(automatic);
    for (const section of window.WorkProject.sections(selectedProfileId())) {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = section.optional ? `${section.title} — необязательно` : section.title;
      elements.partSection.appendChild(option);
    }
  }

  function hydrateMetadata() {
    if (!project) return;
    for (const [key, field] of Object.entries(metaFields)) field.value = project.metadata[key] || "";
  }

  function readMetadataForm() {
    return Object.fromEntries(Object.entries(metaFields).map(([key, field]) => [key, field.value.trim()]));
  }

  function syncProjectMetadata() {
    project = window.WorkProject.updateMetadata(project, readMetadataForm());
    saveProject();
  }

  function updateControls() {
    const hasSource = Boolean(elements.sourceText.value.trim());
    const hasResult = Boolean(currentResult);
    const hasParts = Boolean(project && project.parts.length);
    elements.sourceCount.textContent = characterLabel(elements.sourceText.value.length);
    elements.processButton.disabled = !hasSource || processing.busy();
    const polishButton = document.getElementById("polishButton");
    polishButton.disabled = !hasResult || !activeReview || processing.busy() || !window.Generator.supported();
    window.FragmentRecovery.controls(polishButton, window.ReviewUI.currentText());
    elements.clearButton.disabled = !hasSource && !hasResult;
    elements.downloadButton.disabled = !hasResult;
    elements.downloadDocxButton.disabled = !hasResult || !currentBlocks.length;
    elements.copyBackButton.disabled = !hasResult || !currentBlocks.length;
    elements.addPartButton.disabled = processing.busy() || currentMode !== "project" || !currentProcessedPart;
    elements.assembleProjectButton.disabled = processing.busy() || currentMode !== "project" || !hasParts;
    if (material) material.controls();
  }

  function renderMetrics(result, before) {
    elements.metricsGrid.textContent = "";
    elements.metrics.hidden = false;
    const signals = [
      ["Итог", "score"],
      ["Тире", "emDash"],
      ["Ритм", "burstiness"],
      ["Штампы", "cliche"],
      ["Антитезы", "antithesis"],
    ];
    const cells = signals.map(([label, key]) => {
      const value = result[key];
      if (!before || before[key] === value) return [label, `${value}`, value];
      return [label, `${before[key]} → ${value}`, value];
    });
    for (const [label, text, value] of cells) {
      const cell = document.createElement("div");
      cell.className = "metric";
      if (value >= 50) cell.classList.add("is-high");
      else if (value >= 30) cell.classList.add("is-mid");
      const name = document.createElement("span");
      name.className = "metric-label";
      name.textContent = label;
      const score = document.createElement("span");
      score.className = "metric-value";
      score.textContent = text;
      cell.append(name, score);
      elements.metricsGrid.appendChild(cell);
    }
    const notes = window.HumanizerMetrics.describe(result);
    elements.metricsNote.textContent = notes.length
      ? `Что делает стиль менее естественным: ${notes.join("; ")}.`
      : `Предложений ${result.sentenceCount}, тире ${result.dashCount}. Явных стилистических проблем не найдено.`;
  }

  function renderCompliance(report) {
    elements.complianceBody.textContent = "";
    const hasContent = report.problems.length > 0 || report.notes.length > 0;
    elements.compliance.hidden = !hasContent;
    if (!hasContent) return;
    for (const problem of report.problems) {
      const group = document.createElement("div");
      group.className = "compliance-group";
      const title = document.createElement("p");
      title.className = "compliance-group-title";
      title.textContent = problem.title;
      const list = document.createElement("ul");
      for (const item of problem.items) {
        const entry = document.createElement("li");
        entry.textContent = item;
        list.appendChild(entry);
      }
      group.append(title, list);
      elements.complianceBody.appendChild(group);
    }
    for (const note of report.notes) {
      const line = document.createElement("p");
      line.className = "compliance-note";
      line.textContent = note;
      elements.complianceBody.appendChild(line);
    }
  }

  function setResultState(label, tone) {
    elements.resultState.hidden = !label;
    elements.resultState.textContent = label || "";
    elements.resultState.classList.toggle("is-neutral", tone === "neutral");
    elements.resultState.classList.toggle("is-error", tone === "error");
  }

  function showResult(text, emptyLabel) {
    currentResult = text;
    elements.resultText.textContent = "";
    elements.resultText.classList.toggle("is-empty", !text);
    elements.resultText.classList.toggle("has-result", Boolean(text));
    if (text) elements.resultText.textContent = text;
    else {
      const placeholder = document.createElement("span");
      placeholder.className = "empty-state";
      placeholder.textContent = emptyLabel || "Здесь появится обработанный текст";
      elements.resultText.appendChild(placeholder);
    }
    elements.resultCount.textContent = characterLabel(text.length);
    updateControls();
  }

  function resetResult() {
    if (window.ModelRunStatus) window.ModelRunStatus.clear();
    processing.cancel();
    currentBlocks = [];
    currentOutputKind = "";
    currentOutputProfileId = "";
    currentProcessedPart = "";
    showResult("", currentMode === "project" ? "Здесь появится обработанная часть или собранная работа" : undefined);
    setResultState("", "neutral");
    setStatus(elements.resultNote, "", false);
    elements.compliance.hidden = true;
    elements.complianceBody.textContent = "";
    elements.metrics.hidden = true;
    elements.metricsGrid.textContent = "";
    elements.metricsNote.textContent = "";
    elements.assemblySummary.hidden = true;
    elements.assemblySummary.textContent = "";
    if (window.NeuralScorerUI) window.NeuralScorerUI.setTexts("", "");
    if (window.ReviewUI && typeof window.ReviewUI.reset === "function") window.ReviewUI.reset();
    activeReview = null;
    if (elements.review) elements.review.hidden = true;
  }

  function renderAssemblySummary(assembled, readiness) {
    elements.assemblySummary.textContent = "";
    elements.assemblySummary.hidden = false;
    const cells = [
      ["Разделов заполнено", `${assembled.stats.filled} из ${assembled.stats.sections}`],
      ["Частей проекта", String(project.parts.length)],
      ["Таблиц в документе", String(assembled.stats.tables)],
      ["Статус", readiness.ready ? "Формально готово" : `Не хватает: ${readiness.missing.length}`],
    ];
    for (const [label, value] of cells) {
      const cell = document.createElement("div");
      cell.className = "summary-cell";
      const name = document.createElement("span");
      name.className = "summary-label";
      name.textContent = label;
      const figure = document.createElement("span");
      figure.className = "summary-value";
      figure.textContent = value;
      cell.append(name, figure);
      elements.assemblySummary.appendChild(cell);
    }
  }

  function pipelineProfileId() { return currentMode === "project" ? selectedProfileId() : "academic-report"; }

  function startReview(source, processed, kind, profileId, keepReviewed = false) {
    if (!keepReviewed) window.FragmentRecovery.discard();
    activeReview = { source, processed, kind, profileId };
    const profile = window.FormatProfiles.get(profileId);
    if (window.ReviewUI) {
      window.ReviewUI.update(processed.text, {
        keepReviewed,
        terms: processed.terms || [],
        strictSections: profile.strictSections,
        headings: window.TextPipeline.headingCandidates(processed.text),
      });
    } else {
      applyReviewedText(processed.text, null);
    }
  }

  function reviewWarnings(review) {
    return review && review.applied && Array.isArray(review.applied.warnings) ? review.applied.warnings : [];
  }

  function applyReviewedText(text, review) {
    if (!activeReview) return;
    if (activeReview.kind === "document") finalizeDocument(text, review);
    else finalizeFragment(text, review);
  }

  function finalizeFragment(text, review) {
    const context = activeReview;
    const structured = window.DocumentStructurer.applyProfile(text, context.profileId, { placeholders: false });
    currentProcessedPart = structured.text;
    currentBlocks = structured.blocks;
    currentOutputKind = "fragment";
    currentOutputProfileId = context.profileId;
    showResult(structured.text);
    if (window.NeuralScorerUI) window.NeuralScorerUI.setTexts(context.source, structured.text);
    const deep = review && review.deepRevision;
    setResultState(
      deep
        ? "Глубокая редакция · текст обработан"
        : structured.text === context.source ? "Базовая правка · без замен" : "Базовая правка · текст изменён",
      structured.text === context.source && !deep ? "neutral" : "success",
    );
    renderCompliance(structured.report);
    renderMetrics(window.HumanizerMetrics.scoreText(text, context.processed.language), context.processed.metricsBefore);
    const summary = context.processed.summary.slice();
    const reviewMessage = window.TextPipeline.reviewMessage(review);
    if (reviewMessage) summary.push(reviewMessage);
    if (context.kind === "part" && elements.partSection.value === "auto") {
      const inferred = window.WorkProject.inferSection(structured.text, context.profileId);
      const section = window.WorkProject.sections(context.profileId).find((item) => item.id === inferred);
      summary.push(section ? `Предполагаемый раздел: ${section.title}.` : "Раздел не определён — выберите его перед добавлением.");
    }
    const warnings = [...context.processed.warnings, ...structured.warnings, ...reviewWarnings(review)];
    setStatus(elements.resultNote, [...summary, ...warnings].join(" "), warnings.length > 0);
    elements.resultText.focus({ preventScroll: true });
  }

  function finalizeDocument(text, review) {
    const context = activeReview;
    const assembled = window.DocumentBuilder.assemble({
      text,
      profileId: context.profileId,
      metadata: window.WorkProject.toBuilderMetadata(project),
    });
    const readiness = window.WorkProject.readiness(project);
    currentBlocks = assembled.blocks;
    currentOutputKind = "document";
    currentOutputProfileId = context.profileId;
    currentProcessedPart = "";
    showResult(window.DocumentBuilder.renderPreview(assembled.blocks, assembled.profile));
    if (window.NeuralScorerUI) window.NeuralScorerUI.setTexts(context.source, text);
    setResultState("Документ собран", "success");
    const report = {
      problems: assembled.normalized.report.problems.slice(),
      notes: assembled.normalized.report.notes.map((note) =>
        note.startsWith("Объём:") ? note.replace("Объём:", "Объём предоставленных материалов:") : note,
      ),
    };
    if (!readiness.ready) {
      report.problems.unshift({
        id: "readiness",
        title: "Для формально полного документа ещё нужны данные",
        items: readiness.missing.map((item) => `${item.label}${item.detail ? ` — ${item.detail}` : ""}`),
      });
    }
    if (readiness.ready && assembled.inserted.length) {
      report.problems.push({ id: "assembly", title: "Не удалось сопоставить заполненные данные", items: assembled.inserted });
    }
    renderCompliance(report);
    renderAssemblySummary(assembled, readiness);
    renderMetrics(window.HumanizerMetrics.scoreText(text, context.processed.language), context.processed.metricsBefore);
    const status = readiness.ready
      ? "Документ собран. Все обязательные категории заполнены."
      : `Собран честный черновик: осталось ${readiness.missing.length} обязательных пунктов.`;
    const reviewMessage = window.TextPipeline.reviewMessage(review);
    const warnings = [...context.processed.warnings, ...assembled.normalized.warnings, ...reviewWarnings(review)];
    setStatus(elements.resultNote, [status, reviewMessage, ...warnings].filter(Boolean).join(" "), !readiness.ready || warnings.length > 0);
    elements.resultText.focus({ preventScroll: true });
  }

  function processSource() {
    if (window.ModelRunStatus) window.ModelRunStatus.clear();
    if (!elements.sourceText.value.trim()) return;
    try {
      const source = elements.sourceText.value;
      const processed = window.TextPipeline.run(source);
      startReview(source, processed, currentMode === "project" ? "part" : "fragment", pipelineProfileId());
      return true;
    } catch (error) {
      setResultState("Ошибка обработки", "error");
      setStatus(elements.resultNote, error instanceof Error ? error.message : "Не удалось обработать текст.", true);
    }
  }

  function addCurrentPart() {
    if (!currentProcessedPart) return;
    try {
      const requestedSection = elements.partSection.value;
      project = window.WorkProject.addPart(project, {
        sectionId: requestedSection === "auto" ? "" : requestedSection,
        title: elements.partTitle.value,
        sourceName: sourceFilename,
        text: currentProcessedPart,
      });
      const saved = saveProject();
      const added = project.parts[project.parts.length - 1];
      const section = window.WorkProject.sections(project.profileId).find((item) => item.id === added.sectionId);
      elements.sourceText.value = "";
      elements.partTitle.value = "";
      sourceFilename = "";
      resetResult();
      renderProject();
      setStatus(
        elements.sourceStatus,
        saved
          ? `Часть добавлена${section ? ` в раздел «${section.title}»` : " без раздела"}.`
          : "Часть добавлена только в текущую вкладку: браузер не разрешил локальное сохранение.",
        !saved,
      );
      elements.sourceText.focus();
    } catch (error) {
      setStatus(elements.resultNote, error instanceof Error ? error.message : "Не удалось добавить часть.", true);
    }
  }

  function assembleProject() {
    syncProjectMetadata();
    const source = window.WorkProject.buildSource(project);
    if (!source) {
      setStatus(elements.resultNote, "Сначала добавьте хотя бы одну содержательную часть.", true);
      return;
    }
    try {
      const processed = window.TextPipeline.run(source);
      startReview(source, processed, "document", selectedProfileId());
    } catch (error) {
      setStatus(elements.resultNote, error instanceof Error ? error.message : "Не удалось собрать документ.", true);
    }
  }

  function renderProject() {
    const readiness = window.WorkProject.readiness(project);
    window.ProjectView.render({
      project,
      readiness,
      sections: window.WorkProject.sections(project.profileId),
      elements,
      metaFields,
      characterLabel,
      onMove: moveProjectPart,
      onRemove: removeProjectPart,
    });
    updateControls();
  }

  function moveProjectPart(partId, sectionId) {
    try {
      project = window.WorkProject.movePart(project, partId, sectionId);
      const saved = saveProject();
      if (currentOutputKind === "document") resetResult();
      renderProject();
      setStatus(elements.sourceStatus, saved ? "Раздел части изменён." : "Изменение сохранено только в текущей вкладке.", !saved);
    } catch (error) {
      setStatus(elements.sourceStatus, error instanceof Error ? error.message : "Не удалось изменить раздел.", true);
    }
  }

  function removeProjectPart(part) {
    const label = part && part.title ? ` «${part.title}»` : "";
    if (!window.confirm(`Удалить часть${label}? Это действие нельзя отменить.`)) return;
    project = window.WorkProject.removePart(project, part.id);
    const saved = saveProject();
    if (currentOutputKind === "document") resetResult();
    renderProject();
    if (!saved) setStatus(elements.sourceStatus, "Часть удалена только в текущей вкладке: сохранить изменение не удалось.", true);
  }

  function setMode(mode) {
    currentMode = mode === "project" ? "project" : "fragment";
    document.body.dataset.mode = currentMode;
    for (const button of elements.modeButtons) {
      const active = button.dataset.mode === currentMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
    const projectMode = currentMode === "project";
    if (projectMode && elements.profileSelect.value !== project.profileId) {
      elements.profileSelect.value = project.profileId;
      updateProfileDescription();
      fillSectionOptions();
    }
    elements.projectWorkspace.hidden = !projectMode;
    elements.profileBar.hidden = !projectMode;
    elements.metadata.hidden = !projectMode;
    elements.partFields.hidden = !projectMode;
    elements.partsLibrary.hidden = !projectMode;
    elements.addPartButton.hidden = !projectMode;
    elements.assembleProjectButton.hidden = !projectMode;
    elements.processButton.textContent = projectMode ? "Обработать часть" : "Обработать текст";
    elements.sourceTitle.textContent = projectMode ? "Новая часть работы" : "Текст для обработки";
    elements.resultTitle.textContent = projectMode ? "Обработанная часть или документ" : "Обработанный текст";
    elements.sourceText.placeholder = projectMode ? "Вставьте очередную часть, источник или таблицу" : "Вставьте сырой текст или перетащите файл";
    resetResult();
    if (projectMode) renderProject();
    if (material) material.setMode(projectMode);
    elements.sourceText.focus();
  }

  const loadFile = window.DocumentFileInput.create({
    material: () => material, source: elements.sourceText, inputs: [elements.fileInput, document.getElementById("wholeDocxInput")],
    documentButton: document.getElementById("wholeDocxButton"), report: (text, error) => setStatus(elements.sourceStatus, text, error),
    apply(file, extracted) {
      elements.sourceText.value = extracted;
      sourceFilename = file.name.replace(/\.[^.]+$/, "");
      resetResult();
      setStatus(elements.sourceStatus, `${file.name} · ${characterLabel(extracted.length)}`, false);
      updateControls();
      elements.sourceText.focus();
    }
  });

  async function clearCurrent() {
    const clearingText = elements.sourceText.value, clearingMode = currentMode;
    processing.cancel();
    if (material && material.active()) await material.clear();
    else { window.ReviewUI.reset(); await window.FragmentRecovery.discard(); }
    if (elements.sourceText.value !== clearingText || currentMode !== clearingMode) return;
    elements.sourceText.value = "";
    elements.partTitle.value = "";
    sourceFilename = "";
    setStatus(elements.sourceStatus, "", false);
    resetResult();
    elements.sourceText.focus();
  }

  function resetProject() {
    if (!window.confirm("Очистить паспорт и все добавленные части? Это действие нельзя отменить.")) return;
    project = window.WorkProject.create(selectedProfileId());
    saveProject();
    hydrateMetadata();
    clearCurrent();
    renderProject();
  }

  const exporter = window.AppExport.create({
    state: () => ({ text: currentResult, blocks: currentBlocks, kind: currentOutputKind,
      topic: project.metadata.topic, filename: sourceFilename, profileId: currentOutputProfileId || selectedProfileId() }),
    busy: () => { elements.downloadDocxButton.disabled = true; }, update: updateControls,
    error: (message) => setStatus(elements.resultNote, message, true),
    notify: (message) => setStatus(elements.resultNote, message, false),
  });
  function runProcessing() {
    if (!processing.busy() && !(material && material.busy()) && window.ModelRunStatus) window.ModelRunStatus.clear();
    return material && material.active() ? material.run() : processing.run();
  }

  elements.sourceText.addEventListener("input", () => {
    if (!material || !material.active()) window.FragmentRecovery.discard();
    if (material && material.active()) material.invalidate();
    setStatus(elements.sourceStatus, "", false);
    if (currentResult) resetResult();
    updateControls();
  });
  elements.sourceText.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runProcessing();
    }
  });
  elements.processButton.addEventListener("click", runProcessing);
  document.getElementById("polishButton").addEventListener("click", () => {
    if (material && material.active()) return window.ModelRunStatus ? window.ModelRunStatus.track(() => material.run({ withModel: true })) : material.run({ withModel: true });
    if (currentResult && activeReview) return processing.run({ modelOnly: true });
  });
  document.getElementById("polishCancelButton").addEventListener("click", () => { processing.cancel(); if (material) material.cancel(); });
  elements.addPartButton.addEventListener("click", addCurrentPart);
  elements.assembleProjectButton.addEventListener("click", assembleProject);
  elements.resetProjectButton.addEventListener("click", resetProject);
  elements.clearButton.addEventListener("click", clearCurrent);
  elements.downloadButton.addEventListener("click", exporter.text);
  elements.downloadDocxButton.addEventListener("click", exporter.docx);
  elements.copyBackButton.addEventListener("click", exporter.copyBack);
  elements.profileSelect.addEventListener("change", () => {
    if (material) material.invalidate(true);
    updateProfileDescription();
    fillSectionOptions();
    if (currentMode === "project") {
      project = window.WorkProject.setProfile(project, selectedProfileId());
      saveProject();
    }
    resetResult();
    if (currentMode === "project") renderProject();
  });
  for (const field of Object.values(metaFields)) {
    field.addEventListener("input", () => {
      if (material) material.invalidate(true);
      syncProjectMetadata();
      if (currentOutputKind === "document") resetResult();
      renderProject();
    });
  }
  for (const button of elements.modeButtons) button.addEventListener("click", () => setMode(button.dataset.mode));
  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      elements.dropZone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });
  elements.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  if (window.ReviewUI) {
    window.ReviewUI.mount({
      onRecover: text => window.FragmentRecovery.restore(text, { elements, currentMode: () => currentMode, startReview, updateControls }),
      onApply: applyReviewedText,
      onRestore(text) {
        elements.sourceText.value = text;
        updateControls();
        processSource();
      },
    });
  }

  material = window.MaterialWorkspace.mount({
    elements, otherBusy: () => processing.busy(), profile: selectedProfileId,
    enterWhole: () => setMode("project"),
    metadata: () => window.WorkProject.toBuilderMetadata(project), update: updateControls, invalidate: resetResult,
    result(assembled, changed) {
      currentBlocks = assembled.blocks; currentOutputKind = "document"; currentOutputProfileId = assembled.profile.id; currentProcessedPart = "";
      showResult(window.ClipboardDocument.textOf(assembled.blocks));
      window.MaterialView.render(elements.resultText, assembled.blocks);
      const missing = [...assembled.blanks, ...assembled.inserted];
      setResultState(missing.length ? "Документ собран · проверьте комплектность" : "Документ собран", missing.length ? "neutral" : "success");
      renderCompliance({ problems: missing.length ? [{ title: "Проверьте недостающие данные и разделы", items: missing }] : [], notes: [] });
      setStatus(elements.resultNote, "Текст обработан. Порядок блоков сохранён; новые титульные страницы не добавляются. Для сохранения таблиц и оформления скачайте DOCX.", false);
    },
  });
  fillProfiles();
  hydrateMetadata();
  renderProject();
  setMode("fragment");
  material.ready.then(() => window.ReviewUI.recover());
})();
