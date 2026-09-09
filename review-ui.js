(function attachReviewUI(root) {
  "use strict";

  // Панель отчёта и правок. Держит всю логику блоков A, B, C и E в одном
  // месте, чтобы app.js остался тем, чем был: пайплайн «почистить →
  // перефразировать → собрать документ».
  //
  // Правки применяются не по кнопке «переписать», а по набору принятых
  // галочек: любое изменение галочки пересобирает текст из исходника
  // заново. Так отмена правки всегда точная, а не «правка правки».

  const STATUS_LABEL = {
    ok: "в зоне",
    low: "ниже зоны",
    high: "выше зоны",
    overshoot: "перелёт",
    unknown: "мало данных",
  };


  const state = {
    baseText: "",
    baseReport: null,
    proposal: null,
    accepted: new Set(),
    context: {},
    workingText: "",
    report: null,
    deepRevision: null,
    operation: 0,
  };

  let callbacks = {};
  let nodes = {};

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    if (node) node.textContent = "";
  }

  function metricsApi() {
    return root.TextMetrics;
  }

  function passesApi() {
    return root.EditPasses;
  }

  function fillGenres() {
    const api = metricsApi();
    if (!api || !nodes.genreSelect || nodes.genreSelect.options.length) return;
    for (const item of api.genres()) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      nodes.genreSelect.appendChild(option);
    }
    nodes.genreSelect.value = api.defaultGenreId();
  }

  function genreId() {
    return (nodes.genreSelect && nodes.genreSelect.value) || metricsApi().defaultGenreId();
  }

  function renderReport(report) {
    clear(nodes.reportGrid);
    for (const metric of report.metrics) {
      const card = element("div", `metric-card is-${metric.status}`);
      const head = element("div", "metric-card-head");
      head.append(
        element("span", "metric-number", `A${metric.number}`),
        element("span", "metric-status", STATUS_LABEL[metric.status] || metric.status),
      );
      const value = element("p", "metric-card-value", metric.display);
      const label = element("p", "metric-card-label", metric.label);
      const zone = element("p", "metric-card-zone", `зона ${metric.zoneLabel}`);
      const hint = element("p", "metric-card-hint", metric.hint);
      card.append(head, value, label, zone, hint);
      nodes.reportGrid.appendChild(card);
    }

    const genre = metricsApi().genre(report.genreId);
    nodes.reviewSummary.textContent =
      `${report.words} слов, ${report.sentences} предложений, ${report.paragraphs} абзацев. ` +
      `В зоне ${report.counts.ok} метрик из ${report.counts.measurable}${report.counts.unknown ? ` (ещё ${report.counts.unknown} нечего измерять — текста мало)` : ""}. ${genre.note}` +
      (report.calibrated
        ? ` Пороги откалиброваны на ${report.calibration.texts} текстах.`
        : " Пороги зон не откалиброваны на корпусе: это ориентир, а не приговор — смотрите на сдвиг «до и после», а не на абсолютные значения.");

    clear(nodes.reportOvershoot);
    nodes.reportOvershoot.hidden = report.overshoot.length === 0;
    if (report.overshoot.length) {
      nodes.reportOvershoot.appendChild(
        element("p", "review-alert-title", "Перелёт: текст начинает кривляться"),
      );
      const list = element("ul");
      for (const warning of report.overshoot) list.appendChild(element("li", null, warning.text));
      nodes.reportOvershoot.appendChild(list);
    }
  }

  function renderEdits(edits, applied, keepList) {
    const acceptedCount = edits.filter((edit) => edit.accepted).length;
    nodes.editsCount.textContent = `${acceptedCount} из ${edits.length}`;

    const share = applied.ok ? applied.removedShare : 0;
    const target = state.proposal.reduction.target;
    nodes.editsGuard.textContent = applied.ok
      ? `Сокращение ${Math.round(share * 100)}% при цели ${Math.round(target.min * 100)}–${Math.round(target.max * 100)}%. ` +
        `Фактчек-гард: числа, даты, ссылки и единицы совпали с исходником.`
      : applied.warnings.join(" ");
    nodes.editsGuard.classList.toggle("is-error", !applied.ok);

    if (keepList) return;
    clear(nodes.editList);

    if (!edits.length) {
      nodes.editList.appendChild(
        element("li", "edit-empty", "Проверка завершена. Дополнительные композиционные замены не потребовались."),
      );
    }

    for (const edit of edits.filter((edit) => edit.accepted && applied.ok)) {
      const item = element("li", "edit-item");
      const body = element("div", "edit-body");
      const head = element("p", "edit-head");
      head.append(
        element("span", "edit-pass", edit.passLabel),
      );
      const diff = element("p", "edit-diff");
      diff.append(
        element("del", null, edit.before.replace(/\s+/g, " ").trim() || "␣"),
        element("span", "edit-arrow", "→"),
        element("ins", null, edit.after.replace(/\s+/g, " ").trim() || "∅"),
      );
      const reason = element("p", "edit-reason", edit.reason);
      body.append(head, diff, reason);
      if (edit.keptForZone) {
        body.appendChild(
          element("p", "edit-note", "Оставлено намеренно: связок должно остаться столько, сколько допускает зона жанра."),
        );
      }
      item.append(body);
      nodes.editList.appendChild(item);
    }
  }

  function renderBaseline(report) {
    const api = root.UsageBaseline;
    if (!api || !nodes.reviewBaseline) return;
    const summary = api.highlights(report);
    if (!summary.count) {
      nodes.reviewBaseline.hidden = true;
      return;
    }
    if (!summary.rows.length) {
      nodes.reviewBaseline.hidden = false;
      nodes.reviewBaseline.textContent =
        `Из ${summary.count} текстов, прошедших через инструмент, этот ничем заметно не выделяется. ` +
        "Это сравнение с вашими черновиками, а не с человеческой нормой.";
      return;
    }
    const parts = summary.rows.map((row) => {
      const share = Math.round(row.share * 100);
      return `${row.label.toLocaleLowerCase("ru")} выражена сильнее, чем у ${share}% из них`;
    });
    nodes.reviewBaseline.hidden = false;
    nodes.reviewBaseline.textContent =
      `Против ${summary.count} прежних текстов: ${parts.join("; ")}. ` +
      "Это сравнение с вашими черновиками, а не с человеческой нормой — сюда приносят именно машинный текст.";
  }

  function renderHistory() {
    const store = root.RevisionStore;
    clear(nodes.historyList);
    if (!store || !store.available()) {
      nodes.historyList.appendChild(
        element("p", "review-note", "Браузер не разрешает локальное хранение — история версий недоступна."),
      );
      return;
    }
    const versions = store.list();
    if (!versions.length) {
      nodes.historyList.appendChild(
        element("p", "review-note", "Версий пока нет. Кнопка «Сохранить версию» кладёт текущий текст сюда."),
      );
      return;
    }
    const list = element("ul", "history-list");
    for (const version of versions) {
      const item = element("li", "history-item");
      const when = new Date(version.at);
      const meta = element(
        "p",
        "history-meta",
        `${when.toLocaleString("ru-RU")} · ${version.words} слов · вне зоны метрик: ${version.offZone === null ? "—" : version.offZone}`,
      );
      const actions = element("div", "history-actions");
      const restore = element("button", "button button-secondary", "Восстановить");
      restore.type = "button";
      restore.addEventListener("click", () => {
        if (callbacks.onRestore) callbacks.onRestore(version.text);
      });
      const drop = element("button", "button button-secondary", "Удалить");
      drop.type = "button";
      drop.addEventListener("click", () => {
        if (!root.confirm("Удалить эту сохранённую версию? Это действие нельзя отменить.")) return;
        store.remove(version.id);
        renderHistory();
      });
      actions.append(restore, drop);
      item.append(element("p", "history-label", version.label), meta, actions);
      list.appendChild(item);
    }
    nodes.historyList.appendChild(list);
  }

  function currentEdits() {
    return state.proposal.edits.map((edit) =>
      Object.assign({}, edit, { accepted: state.accepted.has(edit.id) }),
    );
  }

  function rebuild(options) {
    if (!state.proposal) return;
    if (root.PolishUI && root.PolishUI.busy()) root.PolishUI.cancel();
    state.operation += 1;
    if (root.RevisionPreview) root.RevisionPreview.clear();
    const keepList = Boolean(options && options.keepList);
    const edits = currentEdits();
    const applied = passesApi().apply(state.baseText, edits);
    if (applied.ok && root.RevisionQuality && !root.RevisionQuality.termsPreserved(state.baseText, applied.text, state.context.terms)) {
      applied.ok = false;
      applied.warnings.push("Композиционные замены отменены: они затрагивают защищённые термины.");
    }
    state.workingText = applied.ok ? applied.text : state.baseText;
    state.report = metricsApi().analyze(state.workingText, { genreId: genreId() });

    renderReport(state.report);
    renderEdits(edits, applied, keepList);
    renderBaseline(state.report);
    renderHistory();

    if (callbacks.onApply) {
      callbacks.onApply(state.workingText, {
        applied,
        report: state.report,
        baseReport: state.baseReport,
        editsAccepted: edits.filter((edit) => edit.accepted).length,
        editsTotal: edits.length,
        deepRevision: state.deepRevision,
      });
    }
  }

  function update(baseText, context) {
    if (!metricsApi() || !passesApi()) return;
    state.operation += 1;
    state.baseText = String(baseText || "");
    state.context = context || {};
    state.deepRevision = state.context.deepRevision || null;
    nodes.review.hidden = !state.baseText.trim();
    if (!state.baseText.trim()) return;

    state.baseReport = metricsApi().analyze(state.baseText, { genreId: genreId() });
    const zones = metricsApi().genre(genreId()).zones;
    state.proposal = passesApi().propose(state.baseText, {
      report: state.baseReport,
      discourseZone: zones.discourseShare,
    });
    state.accepted = new Set(state.context.keepReviewed ? [] : state.proposal.edits.filter((edit) => edit.confidence === "high" && !edit.keptForZone).map((edit) => edit.id));
    if (root.UsageBaseline) root.UsageBaseline.record(state.baseReport);
    rebuild();
  }

  function reset() {
    state.operation += 1;
    if (root.PolishUI) root.PolishUI.cancel();
    if (root.RevisionPreview) root.RevisionPreview.clear();
    state.baseText = "";
    state.baseReport = null;
    state.proposal = null;
    state.accepted = new Set();
    state.context = {};
    state.workingText = "";
    state.report = null;
    state.deepRevision = null;
    if (nodes.review) nodes.review.hidden = true;
  }

  /**
   * Необязательный проход по отдельной кнопке; обычная обработка модель не запускает.
   * Только подтверждённый результат становится новым исходником: после замены
   * предложений прежние спаны композиционных правок уже указывают не туда.
   */
  async function polishWithModel() {
    if (!root.PolishUI || !state.workingText) return;
    let operation = state.operation;
    const original = state.workingText;
    const result = await root.AutomaticRevision.run({
      text: original,
      language: state.report.language,
      isCurrent: () => operation === state.operation,
      report(message, error) {
        nodes.editsGuard.classList.toggle("is-error", Boolean(error));
        nodes.editsGuard.textContent = message;
      },
      apply(result) {
        const deepRevision = {
          replaced: result.replaced, targeted: result.targeted,
          totalSentences: result.totalSentences, changedWordShare: result.changedWordShare,
        };
        update(result.text, Object.assign({}, state.context, { deepRevision, keepReviewed: true }));
        operation = state.operation;
        nodes.editsGuard.textContent = `Автоматически применено ${result.replaced} замен. Числа и ссылки сверены.`;
      },
    });
    if (result && operation === state.operation) root.RevisionPreview.showAutomatic(result, () => {
      if (operation === state.operation) update(original, Object.assign({}, state.context, { deepRevision: null, keepReviewed: true }));
    });
  }
  function mount(handlers) {
    callbacks = handlers || {};
    nodes = {
      review: document.querySelector("#review"),
      genreSelect: document.querySelector("#genreSelect"),
      reviewSummary: document.querySelector("#reviewSummary"),
      reportGrid: document.querySelector("#reportGrid"),
      reportOvershoot: document.querySelector("#reportOvershoot"),
      editsCount: document.querySelector("#editsCount"),
      editsGuard: document.querySelector("#editsGuard"),
      editList: document.querySelector("#editList"),
      historyList: document.querySelector("#historyList"),
      reviewBaseline: document.querySelector("#reviewBaseline"),
      acceptSafeButton: document.querySelector("#acceptSafeButton"),
      clearEditsButton: document.querySelector("#clearEditsButton"),
      saveRevisionButton: document.querySelector("#saveRevisionButton"),
    };
    if (!nodes.review) return;
    fillGenres();

    nodes.genreSelect.addEventListener("change", () => {
      if (state.baseText) update(state.baseText, state.context);
    });
    nodes.acceptSafeButton.addEventListener("click", () => {
      if (!state.proposal) return;
      state.accepted = new Set(
        state.proposal.edits.filter((edit) => edit.confidence === "high" && !edit.keptForZone).map((edit) => edit.id),
      );
      rebuild();
    });
    nodes.clearEditsButton.addEventListener("click", () => {
      state.accepted = new Set();
      rebuild();
    });
    nodes.saveRevisionButton.addEventListener("click", () => {
      const store = root.RevisionStore;
      if (!store || !state.workingText) return;
      store.save({
        label: `${state.report.genreLabel}, принято правок: ${currentEdits().filter((edit) => edit.accepted).length}`,
        text: state.workingText,
        words: state.report.words,
        offZone: state.report.counts.off + state.report.counts.overshoot,
      });
      renderHistory();
    });
  }

  root.ReviewUI = { mount, update, reset, genreId, polishWithModel, currentText: () => state.workingText };
})(typeof globalThis !== "undefined" ? globalThis : window);
