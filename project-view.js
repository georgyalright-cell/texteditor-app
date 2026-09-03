(function attachProjectView(root) {
  "use strict";

  function goTo(target, context) {
    if (!target) return;
    if (target.type === "metadata") {
      context.metadata.open = true;
      const field = context.metaFields[target.field];
      if (field) {
        field.scrollIntoView({ behavior: "smooth", block: "center" });
        field.focus({ preventScroll: true });
      }
      return;
    }
    if (target.type === "section") {
      context.partSection.value = target.sectionId;
      context.partFields.scrollIntoView({ behavior: "smooth", block: "center" });
      context.sourceText.focus({ preventScroll: true });
      return;
    }
    if (target.type === "parts") {
      context.partsLibrary.scrollIntoView({ behavior: "smooth", block: "center" });
      const firstSelect = context.partsList.querySelector("select");
      if (firstSelect) firstSelect.focus({ preventScroll: true });
    }
  }

  function renderReadiness(readiness, elements, context) {
    elements.readinessBadge.textContent = readiness.ready ? "Формально готово" : `Нужно дополнить: ${readiness.missing.length}`;
    elements.readinessBadge.classList.toggle("is-ready", readiness.ready);
    elements.readinessCount.textContent = `${readiness.completed} из ${readiness.total}`;
    elements.readinessList.textContent = "";
    for (const item of readiness.items) {
      const cell = document.createElement(item.complete ? "div" : "button");
      cell.className = `readiness-item${item.complete ? " is-complete" : " readiness-action"}`;
      if (!item.complete) {
        cell.type = "button";
        cell.addEventListener("click", () => goTo(item.target, context));
      }
      const label = document.createElement("span");
      label.textContent = item.label;
      cell.appendChild(label);
      if (item.detail) {
        const detail = document.createElement("span");
        detail.className = "readiness-detail";
        detail.textContent = item.detail;
        cell.appendChild(detail);
      }
      elements.readinessList.appendChild(cell);
    }

    const next = readiness.missing.find((item) => item.target);
    elements.nextMissingButton.hidden = !next;
    if (next) {
      elements.nextMissingButton.textContent = `Заполнить: ${next.label}`;
      elements.nextMissingButton.onclick = () => goTo(next.target, context);
    }
  }

  function sectionSelect(part, sections, onMove) {
    const select = document.createElement("select");
    select.className = "part-section-select";
    select.setAttribute("aria-label", `Раздел для части ${part.title || "без названия"}`);
    const choices = [{ id: "unassigned", title: "Не распределено" }, ...sections];
    for (const section of choices) {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = section.title;
      select.appendChild(option);
    }
    select.value = part.sectionId;
    select.addEventListener("change", () => onMove(part.id, select.value));
    return select;
  }

  function renderParts(project, sections, elements, characterLabel, onMove, onRemove) {
    const sectionMap = new Map(sections.map((section) => [section.id, section.title]));
    elements.partsList.textContent = "";
    if (!project.parts.length) {
      const empty = document.createElement("p");
      empty.className = "parts-empty";
      empty.textContent = "Пока частей нет. Обработайте первый фрагмент и добавьте его в нужный раздел.";
      elements.partsList.appendChild(empty);
      return;
    }

    for (const part of project.parts) {
      const card = document.createElement("article");
      card.className = "part-card";
      const body = document.createElement("div");
      body.className = "part-card-body";
      const title = document.createElement("p");
      title.className = "part-card-title";
      title.textContent = part.title || sectionMap.get(part.sectionId) || "Часть без раздела";
      const meta = document.createElement("p");
      meta.className = "part-card-meta";
      meta.textContent = `${characterLabel(part.text.length)}${part.sourceName ? ` · ${part.sourceName}` : ""}`;
      body.append(title, meta, sectionSelect(part, sections, onMove));

      const remove = document.createElement("button");
      remove.className = "text-button danger-button part-remove";
      remove.type = "button";
      remove.textContent = "Удалить";
      remove.addEventListener("click", () => onRemove(part));
      card.append(body, remove);
      elements.partsList.appendChild(card);
    }
  }

  function render(settings) {
    const context = {
      metadata: settings.elements.metadata,
      metaFields: settings.metaFields,
      partSection: settings.elements.partSection,
      partFields: settings.elements.partFields,
      sourceText: settings.elements.sourceText,
      partsLibrary: settings.elements.partsLibrary,
      partsList: settings.elements.partsList,
    };
    renderReadiness(settings.readiness, settings.elements, context);
    renderParts(
      settings.project,
      settings.sections,
      settings.elements,
      settings.characterLabel,
      settings.onMove,
      settings.onRemove,
    );
    settings.elements.assembleProjectButton.textContent = !settings.project.parts.length
      ? "Собрать весь документ"
      : settings.readiness.ready
        ? "Собрать готовый документ"
        : `Собрать черновик · не хватает ${settings.readiness.missing.length}`;
  }

  root.ProjectView = { render };
})(typeof globalThis !== "undefined" ? globalThis : window);
