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

  const CONFIDENCE_LABEL = { high: "безопасно", medium: "на ваше усмотрение" };

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
        element("li", "edit-empty", "Безопасных правок не нашлось. Смотрите список ниже — там то, что правит автор."),
      );
    }

    for (const edit of edits) {
      const item = element("li", `edit-item is-${edit.confidence}`);
      const label = element("label", "edit-toggle");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = edit.accepted;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.accepted.add(edit.id);
        else state.accepted.delete(edit.id);
        rebuild({ keepList: true });
      });
      label.appendChild(checkbox);

      const body = element("div", "edit-body");
      const head = element("p", "edit-head");
      head.append(
        element("span", "edit-pass", edit.passLabel),
        element("span", "edit-confidence", CONFIDENCE_LABEL[edit.confidence] || edit.confidence),
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
      item.append(label, body);
      nodes.editList.appendChild(item);
    }
  }

  function renderManual(proposal) {
    clear(nodes.manualList);
    if (!proposal.manual.length && !proposal.hints.length) return;

    if (proposal.manual.length) {
      nodes.manualList.appendChild(element("h3", "review-subtitle", "Правит автор: замена меняет падежи"));
      const list = element("ul", "manual-list");
      for (const item of proposal.manual) {
        const entry = element("li", "manual-item");
        entry.append(
          element("p", "manual-fragment", `«${item.context}»`),
          element("p", "manual-advice", item.advice),
        );
        list.appendChild(entry);
      }
      nodes.manualList.appendChild(list);
    }

    if (proposal.hints.length) {
      nodes.manualList.appendChild(element("h3", "review-subtitle", "Методы, которые код не выполняет"));
      const list = element("ul", "hint-list");
      for (const hint of proposal.hints) {
        const entry = element("li", "hint-item");
        entry.append(
          element("p", "hint-head", `${hint.method} · ${hint.label}`),
          element("p", "hint-text", hint.text),
        );
        list.appendChild(entry);
      }
      nodes.manualList.appendChild(list);
    }
  }

  function renderAsk(text, report) {
    const api = root.Elicitation;
    if (!api) return;
    const built = api.build(text, {
      language: report.language,
      strictSections: state.context.strictSections,
      headings: state.context.headings,
      targetDensity: (metricsApi().genre(report.genreId).zones.anchorDensity || {}).min,
    });

    clear(nodes.questionList);
    nodes.askCount.textContent = built.questions.length ? `${built.questions.length}` : "0";
    if (!built.questions.length) {
      nodes.questionList.appendChild(
        element("p", "ask-empty", "Плотность конкретики в норме во всех абзацах: вопросов к автору нет."),
      );
    }
    let currentScope = "";
    for (const question of built.questions) {
      if (question.scope !== currentScope) {
        currentScope = question.scope;
        const head = element("p", "ask-scope", currentScope);
        nodes.questionList.appendChild(head);
      }
      const item = element("div", "ask-item");
      item.append(
        element("p", "ask-question", question.question),
        element("p", "ask-excerpt", `«${question.excerpt}»`),
      );
      nodes.questionList.appendChild(item);
    }

    clear(nodes.checklistBox);
    nodes.checklistBox.appendChild(element("h3", "review-subtitle", "Чеклист: методы 12–17"));
    const list = element("ul", "checklist");
    for (const item of built.checklist) {
      const entry = element("li", "checklist-item");
      const label = element("label", "checklist-label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.checklist && state.checklist[item.id] === true;
      checkbox.addEventListener("change", () => {
        state.checklist = state.checklist || {};
        state.checklist[item.id] = checkbox.checked;
      });
      label.append(checkbox, element("span", "checklist-title", `${item.method} · ${item.title}`));
      entry.append(label, element("p", "checklist-prompt", item.prompt));
      list.appendChild(entry);
    }
    nodes.checklistBox.appendChild(list);

    clear(nodes.terminologyBox);
    if (built.terminology.length) {
      nodes.terminologyBox.appendChild(element("h3", "review-subtitle", "31 · дрейф терминологии"));
      const drift = element("ul", "drift-list");
      for (const group of built.terminology) {
        drift.appendChild(
          element("li", null, group.variants.map((variant) => `${variant.form} (${variant.count})`).join("  ·  ")),
        );
      }
      nodes.terminologyBox.append(
        drift,
        element("p", "review-note", "Выберите одно написание и держитесь его — либо оставьте дрейф осознанно."),
      );
    }
    if (built.headings && built.headings.enabled && built.headings.parallel) {
      nodes.terminologyBox.append(
        element("h3", "review-subtitle", "30 · параллельные заголовки"),
        element("p", "review-note", built.headings.note),
      );
    }
  }

  /**
   * Слабые места. Отчёт говорит, что не так с текстом целиком; этот список
   * говорит, где именно. Правка руками десятой части текста меняет профиль
   * сильнее любого пасса, и весь вопрос в том, какой именно десятой.
   */
  /**
   * Сравнение с собственной историей. Формулировки подобраны так, чтобы эту
   * базу нельзя было прочесть как норму: сюда приносят машинные черновики,
   * и «типичнее обычного» здесь означает «похоже на остальные ваши
   * черновики», а не «похоже на человека».
   */
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

  function renderWeakSpots(text, report) {
    const api = root.WeakSpots;
    if (!api || !nodes.weakList) return;
    clear(nodes.weakList);
    const spots = api.worst(text, { language: report.language, share: 0.15, limit: 8 });
    nodes.weakCount.textContent = spots.length ? String(spots.length) : "0";
    if (!spots.length) {
      nodes.weakNote.textContent =
        "Предложений с явными признаками машинности не осталось. Дальше решает содержание, а не формулировки.";
      return;
    }
    nodes.weakNote.textContent =
      "Эти предложения тянут текст вниз сильнее прочих. Перепишите их своими словами — это даёт больше, " +
      "чем любая автоматическая правка остального текста.";
    for (const spot of spots) {
      const item = element("li", "weak-item");
      const head = element("p", "weak-head");
      head.append(
        element("span", "weak-score", String(spot.score)),
        element("span", "weak-reasons", spot.reasons.join(" · ")),
      );
      item.append(head, element("p", "weak-text", spot.text));
      nodes.weakList.appendChild(item);
    }
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
    const keepList = Boolean(options && options.keepList);
    const edits = currentEdits();
    const applied = passesApi().apply(state.baseText, edits);
    state.workingText = applied.ok ? applied.text : state.baseText;
    state.report = metricsApi().analyze(state.workingText, { genreId: genreId() });

    renderReport(state.report);
    renderEdits(edits, applied, keepList);
    renderManual(state.proposal);
    renderAsk(state.workingText, state.report);
    renderWeakSpots(state.workingText, state.report);
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
    if (nodes.polishButton) nodes.polishButton.hidden = !state.baseText.trim();
    if (nodes.polishDownloadNote) nodes.polishDownloadNote.hidden = !state.baseText.trim();
    if (!state.baseText.trim()) return;

    state.baseReport = metricsApi().analyze(state.baseText, { genreId: genreId() });
    const zones = metricsApi().genre(genreId()).zones;
    state.proposal = passesApi().propose(state.baseText, {
      report: state.baseReport,
      discourseZone: zones.discourseShare,
    });
    state.accepted = new Set(state.proposal.edits.filter((edit) => edit.accepted).map((edit) => edit.id));
    if (root.UsageBaseline) root.UsageBaseline.record(state.baseReport);
    rebuild();
  }

  function reset() {
    state.operation += 1;
    state.baseText = "";
    state.baseReport = null;
    state.proposal = null;
    state.accepted = new Set();
    state.context = {};
    state.workingText = "";
    state.report = null;
    state.deepRevision = null;
    if (nodes.review) nodes.review.hidden = true;
    if (nodes.polishButton) {
      nodes.polishButton.hidden = true;
      nodes.polishButton.textContent = "Глубоко переработать формулировки";
    }
    if (nodes.polishDownloadNote) nodes.polishDownloadNote.hidden = true;
  }

  /**
   * Глубокая редакция формулировок локальной моделью. Она остаётся отдельным
   * осознанным шагом, чтобы обычная обработка не начинала скрытую загрузку
   * модели. Результат становится новым исходником панели: после замены
   * предложений прежние спаны композиционных правок уже указывают не туда.
   */
  function polishWithModel() {
    const selector = root.CandidateSelect;
    if (!selector || !state.workingText) return;
    if (root.NeuralScorerUI.lockForPolish && !root.NeuralScorerUI.lockForPolish()) {
      nodes.editsGuard.classList.add("is-error");
      nodes.editsGuard.textContent = "Дождитесь завершения текущей нейрооценки и повторите отбор формулировок.";
      return;
    }
    const generate = root.Generator && typeof root.Generator.paraphrase === "function"
      ? (sentence, options) => root.Generator.paraphrase(sentence, {
        language: options && options.language,
        count: 4,
        position: options && options.position,
        total: options && options.total,
      })
      : undefined;
    const operation = state.operation;

    nodes.polishButton.disabled = true;
    const label = nodes.polishButton.textContent;
    nodes.polishButton.textContent = "Глубокая редакция…";
    nodes.editsGuard.classList.remove("is-error");
    nodes.editsGuard.textContent =
      "Модель распределённо перестраивает формулировки. Числа, ссылки, имена, язык и объём остаются под защитой.";

    // Ранжировать перплексией имеет смысл только там, где модель есть. Одна
    // оценка — два прохода модели, поэтому при включённом ранжировании число
    // предложений за прогон урезается: двенадцать предложений со всеми их
    // версиями — это сотни проходов, то есть минуты вместо секунд.
    // Ранжирование подключается только к уже загруженным моделям. Тянуть
    // гигабайт весов по нажатию кнопки, которая до сих пор отрабатывала за
    // секунду и без сети, — не улучшение, а неожиданность.
    const engine = root.NeuralScorerUI;
    const warm = Boolean(engine && typeof engine.warm === "function" && engine.warm());
    const ranker = warm && selector.hybridScorer ? selector.hybridScorer(state.report.language, engine) : null;
    // Два бюджета, а не один: с ранжированием моделью каждая версия стоит двух
    // проходов, и двенадцать предложений превращают секунды в минуты.
    const budget = ranker ? { share: 0.15, limit: 5 } : { share: 0.35, limit: 12 };
    selector
      .polishSentences(state.workingText, {
        language: state.report.language,
        generate,
        preferFresh: true,
        share: budget.share,
        limit: budget.limit,
        score: ranker || undefined,
      })
      .then((result) => {
        if (operation !== state.operation) return;
        if (!result.ok) {
          nodes.editsGuard.classList.add("is-error");
          nodes.editsGuard.textContent = result.warnings.join(" ");
          return;
        }
        if (!result.replaced) {
          const warning = result.generatorWarnings && result.generatorWarnings[0];
          nodes.editsGuard.classList.toggle("is-error", Boolean(warning));
          nodes.editsGuard.textContent = warning
            ? `Локальная модель не запустилась: ${warning}. Текст оставлен без изменений.`
            : "Глубокая редакция не нашла достаточно отличающихся безопасных вариантов. Исходный смысл оставлен без риска.";
          return;
        }
        const share = Math.round((result.changedWordShare || 0) * 100);
        const deepRevision = {
          replaced: result.replaced,
          targeted: result.targeted,
          totalSentences: result.totalSentences,
          changedWordShare: result.changedWordShare,
        };
        update(result.text, Object.assign({}, state.context, { deepRevision }));
        nodes.editsGuard.textContent =
          `Глубокая редакция: обновлено ${result.replaced} из ${result.totalSentences} предложений, охвачено около ${share}% слов. ` +
          "Фактчек-гард сохранён." +
          (result.generatorWarnings && result.generatorWarnings.length
            ? ` Часть запросов модели завершилась ошибкой: ${result.generatorWarnings[0]}.`
            : "");
      })
      .catch((error) => {
        if (operation !== state.operation) return;
        nodes.editsGuard.classList.add("is-error");
        nodes.editsGuard.textContent = `Отбор не выполнен: ${error.message}`;
      })
      .then(() => {
        if (root.Generator && typeof root.Generator.release === "function") root.Generator.release();
        if (root.NeuralScorerUI && typeof root.NeuralScorerUI.reportProgress === "function") {
          root.NeuralScorerUI.reportProgress({ done: true });
        }
        if (root.NeuralScorerUI && typeof root.NeuralScorerUI.unlockAfterPolish === "function") {
          root.NeuralScorerUI.unlockAfterPolish();
        }
        nodes.polishButton.textContent = label;
        nodes.polishButton.disabled = false;
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
      manualList: document.querySelector("#manualList"),
      askCount: document.querySelector("#askCount"),
      questionList: document.querySelector("#questionList"),
      checklistBox: document.querySelector("#checklistBox"),
      terminologyBox: document.querySelector("#terminologyBox"),
      historyList: document.querySelector("#historyList"),
      weakList: document.querySelector("#weakList"),
      weakNote: document.querySelector("#weakNote"),
      weakCount: document.querySelector("#weakCount"),
      polishButton: document.querySelector("#polishButton"),
      polishDownloadNote: document.querySelector("#polishDownloadNote"),
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
    if (nodes.polishButton) {
      nodes.polishButton.hidden = true;
      const generatorAvailable = root.Generator && root.Generator.supported && root.Generator.supported();
      nodes.polishButton.disabled = !generatorAvailable;
      if (!generatorAvailable) {
        nodes.polishButton.disabled = true;
        nodes.polishButton.title =
          "Нужен WebGPU: глубокая редакция идёт локальной моделью. Остальная обработка работает без неё.";
      }
      nodes.polishButton.addEventListener("click", polishWithModel);
    }
    if (nodes.polishDownloadNote) nodes.polishDownloadNote.hidden = true;
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

  root.ReviewUI = { mount, update, reset, genreId, currentText: () => state.workingText };
})(typeof globalThis !== "undefined" ? globalThis : window);
