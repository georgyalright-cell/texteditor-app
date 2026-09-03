(function attachWorkProject(root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(isNode ? require("./format-profiles.js") : root.FormatProfiles);
  if (isNode) module.exports = api;
  root.WorkProject = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createWorkProject(FormatProfiles) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MIN_SECTION_CHARS = 160;
  const MIN_CONCLUSION_CHARS = 100;
  const STORAGE_KEY = "humanizer.work-project.v1";

  const PASSPORT_FIELDS = [
    { id: "topic", label: "Тема работы или название проекта" },
    { id: "goal", label: "Цель работы" },
    { id: "object", label: "Объект исследования, компания или проект" },
    { id: "scope", label: "География, период и границы анализа" },
    { id: "methods", label: "Методы, исходные данные и база доказательств" },
    { id: "programme", label: "Образовательная программа" },
    { id: "team", label: "Автор или состав команды с группами" },
    { id: "supervisor", label: "Научный руководитель" },
    { id: "year", label: "Год" },
  ];

  const GENERIC_SECTIONS = [
    { id: "introduction", title: "Introduction", aliases: ["introduction", "введение"] },
    { id: "main-part", title: "Main Part", aliases: ["main part", "основная часть"] },
  ];

  const STRUCTURAL_SECTIONS = [
    { id: "individual-contribution", title: "Individual Contribution", aliases: ["individual contribution", "личный вклад"] },
    { id: "conclusion", title: "Conclusion", aliases: ["conclusion", "заключение"] },
    { id: "references", title: "References", aliases: ["references", "bibliography", "источники", "литература"] },
    { id: "appendix", title: "Appendix", aliases: ["appendix", "приложение"], optional: true },
  ];

  function normalizeProfileId(profileId) {
    const candidate = String(profileId || "");
    return FormatProfiles.list().some((profile) => profile.id === candidate)
      ? candidate
      : FormatProfiles.defaultProfileId();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function emptyMetadata() {
    return {
      topic: "",
      goal: "",
      object: "",
      scope: "",
      methods: "",
      programme: "",
      team: "",
      supervisor: "",
      year: "",
    };
  }

  function create(profileId) {
    const timestamp = nowIso();
    return {
      version: SCHEMA_VERSION,
      profileId: normalizeProfileId(profileId),
      metadata: emptyMetadata(),
      parts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function cleanText(value) {
    return String(value || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function safePart(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    const text = cleanText(raw.text);
    if (!text) return null;
    return {
      id: String(raw.id || `part-${index + 1}`),
      sectionId: String(raw.sectionId || "unassigned"),
      title: cleanText(raw.title),
      sourceName: cleanText(raw.sourceName),
      text,
      createdAt: String(raw.createdAt || nowIso()),
    };
  }

  function sanitize(raw, fallbackProfileId) {
    const base = create(fallbackProfileId);
    if (!raw || typeof raw !== "object") return base;
    const metadata = emptyMetadata();
    for (const key of Object.keys(metadata)) metadata[key] = cleanText(raw.metadata && raw.metadata[key]);
    return {
      version: SCHEMA_VERSION,
      profileId: normalizeProfileId(raw.profileId || base.profileId),
      metadata,
      parts: Array.isArray(raw.parts) ? raw.parts.map(safePart).filter(Boolean) : [],
      createdAt: String(raw.createdAt || base.createdAt),
      updatedAt: String(raw.updatedAt || base.updatedAt),
    };
  }

  function sections(profileId) {
    const profile = FormatProfiles.get(profileId);
    const content = profile.requiredSections.length ? profile.requiredSections : GENERIC_SECTIONS;
    const structural = STRUCTURAL_SECTIONS.filter((section) => section.id !== "individual-contribution" || profile.individualContribution);
    return [
      ...content.map((section) => ({
        id: section.id,
        title: section.title,
        aliases: Array.isArray(section.aliases) ? section.aliases.slice() : [],
        optional: false,
        note: section.note || "",
        subsections: Array.isArray(section.subsections) ? section.subsections.slice() : [],
      })),
      ...structural.map((section) => ({
        ...section,
        subsections:
          section.id === "individual-contribution" && profile.individualContribution
            ? profile.individualContribution.subsections.slice()
            : [],
      })),
    ];
  }

  function updateMetadata(project, values) {
    const next = sanitize(project, project && project.profileId);
    for (const [key, value] of Object.entries(values || {})) {
      if (Object.prototype.hasOwnProperty.call(next.metadata, key)) next.metadata[key] = cleanText(value);
    }
    next.updatedAt = nowIso();
    return next;
  }

  function setProfile(project, profileId) {
    const next = sanitize(project, profileId);
    next.profileId = normalizeProfileId(profileId);
    const allowed = new Set(sections(next.profileId).map((section) => section.id));
    next.parts = next.parts.map((part) => {
      if (allowed.has(part.sectionId)) return part;
      const inferred = inferSection([part.title, part.text].filter(Boolean).join("\n"), next.profileId);
      return { ...part, sectionId: allowed.has(inferred) ? inferred : "unassigned" };
    });
    next.updatedAt = nowIso();
    return next;
  }

  function makePartId() {
    return `part-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addPart(project, input) {
    const next = sanitize(project, project && project.profileId);
    const text = cleanText(input && input.text);
    if (!text) throw new Error("Нельзя добавить пустую часть.");
    const allowed = new Set(sections(next.profileId).map((section) => section.id));
    const sectionId = allowed.has(input.sectionId) ? input.sectionId : inferSection(text, next.profileId);
    next.parts.push({
      id: makePartId(),
      sectionId: sectionId || "unassigned",
      title: cleanText(input.title),
      sourceName: cleanText(input.sourceName),
      text,
      createdAt: nowIso(),
    });
    next.updatedAt = nowIso();
    return next;
  }

  function removePart(project, partId) {
    const next = sanitize(project, project && project.profileId);
    next.parts = next.parts.filter((part) => part.id !== partId);
    next.updatedAt = nowIso();
    return next;
  }

  function movePart(project, partId, sectionId) {
    const next = sanitize(project, project && project.profileId);
    const allowed = new Set(["unassigned", ...sections(next.profileId).map((section) => section.id)]);
    if (!allowed.has(sectionId)) throw new Error("Выбран неизвестный раздел работы.");
    const part = next.parts.find((item) => item.id === partId);
    if (!part) throw new Error("Часть проекта не найдена.");
    part.sectionId = sectionId;
    next.updatedAt = nowIso();
    return next;
  }

  function normalizeWords(value) {
    return cleanText(value)
      .toLocaleLowerCase("ru")
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .split(/\s+/u)
      .filter((word) => word.length >= 4);
  }

  function inferSection(text, profileId) {
    const normalized = ` ${cleanText(text).toLocaleLowerCase("ru")} `;
    let best = { id: "unassigned", score: 0 };
    for (const section of sections(profileId)) {
      let score = 0;
      const phrases = [section.title, ...(section.aliases || [])];
      for (const phrase of phrases) {
        const candidate = cleanText(phrase).toLocaleLowerCase("ru");
        if (candidate && normalized.includes(candidate)) score += candidate === section.title.toLocaleLowerCase("ru") ? 8 : 5;
      }
      const keywords = new Set(phrases.flatMap(normalizeWords));
      for (const word of keywords) {
        if (normalized.includes(` ${word} `)) score += 1;
      }
      if (score > best.score) best = { id: section.id, score };
    }
    return best.score >= 2 ? best.id : "unassigned";
  }

  function partLength(project, sectionId) {
    return project.parts
      .filter((part) => part.sectionId === sectionId)
      .reduce((total, part) => total + part.text.length, 0);
  }

  function hasReferences(text) {
    return /https?:\/\//iu.test(text) || /\b(?:doi|isbn)\b/iu.test(text) || /\(?.+?,\s*(?:19|20)\d{2}[a-z]?\)?/iu.test(text);
  }

  function tableCount(text) {
    return cleanText(text)
      .split(/\n{2,}/u)
      .filter((block) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.length < 2 || !lines.every((line) => line.includes("\t"))) return false;
        const rows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
        return rows.slice(1).some((row) => row.slice(1).some(Boolean));
      }).length;
  }

  function coversRequirement(text, requirement) {
    const haystack = ` ${cleanText(text)
      .toLocaleLowerCase("ru")
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()} `;
    let keywords = normalizeWords(requirement);
    if (!keywords.length) {
      keywords = cleanText(requirement)
        .toLocaleLowerCase("ru")
        .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
        .split(/\s+/u)
        .filter((word) => word.length >= 2);
    }
    if (!keywords.length) return false;
    const hits = keywords.filter((word) => haystack.includes(` ${word} `)).length;
    return hits >= Math.ceil(keywords.length / 2);
  }

  function readiness(project) {
    const current = sanitize(project, project && project.profileId);
    const items = [];
    for (const field of PASSPORT_FIELDS) {
      const value = current.metadata[field.id];
      items.push({
        id: `meta-${field.id}`,
        group: "Паспорт работы",
        label: field.label,
        complete: Boolean(value),
        target: { type: "metadata", field: field.id },
      });
    }

    for (const section of sections(current.profileId)) {
      if (section.optional) continue;
      const length = partLength(current, section.id);
      const minimum = section.id === "conclusion" ? MIN_CONCLUSION_CHARS : MIN_SECTION_CHARS;
      const sectionParts = current.parts.filter((part) => part.sectionId === section.id);
      const sectionText = sectionParts.map((part) => [part.title, part.text].filter(Boolean).join("\n")).join("\n\n");
      const missingSubsections = (section.subsections || []).filter((subsection) => !coversRequirement(sectionText, subsection));
      let complete = length >= minimum && missingSubsections.length === 0;
      let detail = complete ? `${length.toLocaleString("ru-RU")} символов` : `нужно хотя бы ${minimum} символов`;
      if (length >= minimum && missingSubsections.length) {
        detail = `не раскрыто: ${missingSubsections.join(", ")}`;
      }
      if (section.id === "references" && complete) {
        const referenceText = current.parts.filter((part) => part.sectionId === section.id).map((part) => part.text).join("\n");
        complete = hasReferences(referenceText);
        if (!complete) detail = "добавьте URL, DOI, ISBN или библиографические записи";
      }
      items.push({
        id: `section-${section.id}`,
        group: "Содержание",
        label: section.title,
        complete,
        detail,
        target: { type: "section", sectionId: section.id },
      });

      const profileSection = FormatProfiles.get(current.profileId).requiredSections.find((item) => item.id === section.id);
      const requiredTables = profileSection && Array.isArray(profileSection.tables) ? profileSection.tables.length : 0;
      if (requiredTables > 0) {
        const actualTables = tableCount(sectionText);
        items.push({
          id: `tables-${section.id}`,
          group: "Табличные данные",
          label: `${section.title}: таблицы и расчёты`,
          complete: actualTables >= requiredTables,
          detail: `${actualTables} из ${requiredTables} таблиц с данными`,
          target: { type: "section", sectionId: section.id },
        });
      }
    }

    const unassigned = current.parts.filter((part) => part.sectionId === "unassigned").length;
    if (unassigned) {
      items.push({
        id: "unassigned",
        group: "Распределение",
        label: `Распределить ${unassigned} ${unassigned === 1 ? "часть" : "части"} по разделам`,
        complete: false,
        target: { type: "parts" },
      });
    }

    const missing = items.filter((item) => !item.complete);
    return {
      ready: missing.length === 0,
      items,
      missing,
      completed: items.length - missing.length,
      total: items.length,
      parts: current.parts.length,
    };
  }

  function contextBlock(metadata) {
    const rows = [
      ["Project goal", metadata.goal],
      ["Object / organization", metadata.object],
      ["Scope and period", metadata.scope],
      ["Methods and evidence base", metadata.methods],
    ].filter((row) => row[1]);
    if (!rows.length) return "";
    return `Project context: ${rows.map(([label, value]) => `${label}: ${value}`).join(". ")}.`;
  }

  function referenceBlock(parts) {
    let number = 0;
    return parts
      .map((part) => {
        const entries = cleanText(part.text)
          .split(/\n{2,}/u)
          .map((entry) => entry.replace(/\s*\n\s*/gu, " ").trim())
          .filter(Boolean)
          .map((entry) => `${(number += 1)}. ${entry.replace(/^(?:[-*•▪◦]|\d+[.)])\s+/u, "")}`)
          .join("\n");
        return [part.title, entries].filter(Boolean).join("\n\n");
      })
      .join("\n\n");
  }

  function buildSource(project) {
    const current = sanitize(project, project && project.profileId);
    const profile = FormatProfiles.get(current.profileId);
    const availableSections = sections(current.profileId);
    const contentSections = availableSections.filter((section) => !["conclusion", "references", "appendix"].includes(section.id));
    const blocks = [];

    contentSections.forEach((section, index) => {
      const parts = current.parts.filter((part) => part.sectionId === section.id);
      if (!parts.length) return;
      blocks.push(`${index + 1}. ${section.title}`);
      if (index === 0) {
        const context = contextBlock(current.metadata);
        if (context) blocks.push(context);
      }
      blocks.push(parts.map((part) => [part.title, part.text].filter(Boolean).join("\n\n")).join("\n\n"));
    });

    for (const structural of availableSections.filter((section) => ["individual-contribution", "conclusion", "references", "appendix"].includes(section.id))) {
      const parts = current.parts.filter((part) => part.sectionId === structural.id);
      if (!parts.length) continue;
      const title = structural.id === "appendix" ? "Appendix A. Supporting materials" : structural.title;
      const content = structural.id === "references"
        ? referenceBlock(parts)
        : parts.map((part) => [part.title, part.text].filter(Boolean).join("\n\n")).join("\n\n");
      blocks.push(title, content);
    }

    const unassigned = current.parts.filter((part) => part.sectionId === "unassigned");
    if (unassigned.length) blocks.push("Material to classify", unassigned.map((part) => part.text).join("\n\n"));

    if (!blocks.length && !profile.requiredSections.length) return "";
    return blocks.join("\n\n").trim();
  }

  function toBuilderMetadata(project) {
    const current = sanitize(project, project && project.profileId);
    const teamMembers = current.metadata.team
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",");
        return { name: parts[0].trim(), group: parts.slice(1).join(",").trim() };
      });
    return {
      topic: current.metadata.topic,
      programme: current.metadata.programme,
      teamMembers,
      supervisor: current.metadata.supervisor,
      year: current.metadata.year,
    };
  }

  return {
    STORAGE_KEY,
    PASSPORT_FIELDS,
    SCHEMA_VERSION,
    create,
    sanitize,
    sections,
    updateMetadata,
    setProfile,
    addPart,
    removePart,
    movePart,
    inferSection,
    readiness,
    buildSource,
    toBuilderMetadata,
    tableCount,
  };
});
