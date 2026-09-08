(function attachDocumentBuilder(root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(
    isNode ? require("./format-profiles.js") : root.FormatProfiles,
    isNode ? require("./structurer.js") : root.DocumentStructurer,
  );
  if (isNode) module.exports = api;
  root.DocumentBuilder = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createDocumentBuilder(FormatProfiles, Structurer) {
  "use strict";

  // Сборка полного документа курсового проекта: титульный лист, состав
  // команды, подтверждение оригинальности, оглавление, восемь разделов
  // §2.1 с подразделами и шаблонными таблицами §2.2-2.9, личный вклад
  // (Приложение 3), заключение, список источников и приложения автора.
  //
  // Содержание не сочиняется: там, где у автора текста нет, ставится
  // прочерк или пустая шаблонная таблица.

  const PLACEHOLDER_MARK = "—";
  const BLANK_FIELD = "___________________________";
  const STRUCTURAL_TITLE_RE =
    /^(?:individual\s+contribution|личный\s+вклад|conclusion|references|bibliography|appendix|contents|заключение|список\s+(?:источников|литературы)|приложение|содержание|оглавление)/iu;

  function plain(text, options) {
    const settings = options || {};
    return {
      type: "plain",
      text,
      alignment: settings.alignment || "center",
      bold: Boolean(settings.bold),
      pageBreakBefore: Boolean(settings.pageBreakBefore),
      spacingAfterLines: settings.spacingAfterLines || 0,
    };
  }

  function heading(title, options) {
    const settings = options || {};
    return {
      type: "heading",
      kind: settings.kind || "section",
      level: settings.level || 1,
      number: settings.number || "",
      title,
      raw: "",
      structural: Boolean(settings.structural),
      numbered: settings.numbered !== false,
      placeholder: Boolean(settings.placeholder),
      generated: true,
    };
  }

  function placeholderParagraph() {
    return { type: "paragraph", text: PLACEHOLDER_MARK, placeholder: true, generated: true };
  }

  function normalizedTitle(value) {
    return Structurer.normalizeKey(String(value || ""));
  }

  function matchesSectionTitle(title, section) {
    return Structurer.sectionCandidates(section).some((candidate) => title === candidate);
  }

  /**
   * Делит блоки автора на сегменты по заголовкам верхнего уровня.
   * Первый сегмент может не иметь заголовка — это преамбула.
   */
  function segmentByHeadings(blocks, sections) {
    const segments = [];
    let current = { heading: null, blocks: [] };
    for (const block of blocks) {
      const title = block.type === "heading" ? normalizedTitle(block.title) : "";
      const canonical = block.type === "heading" && (sections || []).some((section) => {
        if (!matchesSectionTitle(title, section)) return false;
        // Совпадающий с псевдонимом заголовок второго уровня может быть
        // обязательным подразделом (например, Organizational structure).
        // При глубокой нумерации 2.2–2.10 новым разделом остаётся точное
        // каноническое название, а не любое частичное/синонимичное совпадение.
        return block.level === 1 || title === normalizedTitle(section.title);
      });
      // В реальных методичках основные разделы нередко продолжают общую
      // нумерацию документа (например, 2.2–2.10) и поэтому парсер формально
      // видит их как второй уровень. Каноническое название важнее глубины
      // номера: такой заголовок всё равно начинает самостоятельный раздел.
      const structuralTitle = block.type === "heading" && STRUCTURAL_TITLE_RE.test(block.title);
      if (block.type === "heading" && (block.level === 1 || block.structural || structuralTitle || block.kind === "appendix" || canonical)) {
        if (current.heading || current.blocks.length) segments.push(current);
        current = { heading: block, blocks: [] };
      } else {
        current.blocks.push(block);
      }
    }
    if (current.heading || current.blocks.length) segments.push(current);
    return segments;
  }

  function matchSection(segment, sections) {
    if (!segment.heading) return null;
    const title = normalizedTitle(segment.heading.title);
    return sections.find((section) => matchesSectionTitle(title, section)) || null;
  }

  function isStructuralSegment(segment) {
    return Boolean(segment.heading && STRUCTURAL_TITLE_RE.test(segment.heading.title));
  }

  function segmentHasContent(segment) {
    return segment && segment.blocks.some((block) => (Structurer.isBodyBlock(block) || ["image", "docTable"].includes(block.type)) && block.text !== PLACEHOLDER_MARK);
  }

  function coversSubsection(segment, subsection) {
    if (!segment) return false;
    const needle = normalizedTitle(subsection);
    let keywords = needle.split(" ").filter((word) => word.length > 3);
    // У финансовых подразделов встречаются короткие, но значимые
    // аббревиатуры (NPV, IRR). Если длинных слов нет, проверяем их тоже.
    if (!keywords.length) keywords = needle.split(" ").filter((word) => word.length >= 2);
    if (!keywords.length) return false;
    const haystack = segment.blocks
      .map((block) => (block.type === "heading" ? block.title : Structurer.blockText(block)))
      .join(" ")
      .toLocaleLowerCase("ru");
    // Подраздел считается раскрытым, если в разделе встречается большинство
    // значимых слов его названия. Это подсказка автору, а не строгий разбор.
    const hits = keywords.filter((word) => haystack.includes(word)).length;
    return hits >= Math.ceil(keywords.length / 2);
  }

  function segmentTableCount(segment) {
    return segment ? segment.blocks.filter((block) => block.type === "table" || block.type === "docTable").length : 0;
  }

  function addTablePresentation(blocks, section, profile) {
    const result = [];
    let tableIndex = 0;
    for (const block of blocks) {
      if (block.type === "table" || block.type === "docTable") {
        const previous = result[result.length - 1];
        const template = (section.tables || [])[tableIndex];
        if (template && (!previous || previous.type !== "caption" || previous.kind !== "table")) {
          result.push({
            type: "caption",
            kind: "table",
            number: "",
            title: template.title,
            raw: "",
            generated: true,
            alignment: profile.captions.table.alignment,
            position: profile.captions.table.position,
            prefix: profile.captions.table.prefix,
          });
          result.push({
            type: "sourceNote",
            text: profile.captions.authorsNote,
            alignment: profile.captions.table.alignment,
            generated: true,
          });
        }
        tableIndex += 1;
      }
      result.push(block);
    }
    return result;
  }

  function buildTitlePage(profile, metadata) {
    const template = profile.titlePage;
    const blocks = [];
    for (const line of template.institution) {
      blocks.push(plain(line, { bold: line === template.institution[1] }));
    }
    blocks.push(plain(""));
    blocks.push(plain(template.projectLabel, { bold: true }));
    blocks.push(plain(metadata.topic || BLANK_FIELD));
    blocks.push(plain("(thematic area of the course project, company name)"));
    blocks.push(plain(""));
    blocks.push(plain(template.fieldOfStudy));
    blocks.push(plain(`educational programme ${metadata.programme || template.programmeOptions.join(" / ")}`));
    blocks.push(plain(""));
    blocks.push(plain("Project completed by:", { alignment: "left" }));
    const members = metadata.teamMembers && metadata.teamMembers.length ? metadata.teamMembers : [null];
    for (const member of members) {
      const label = member && member.name ? `${member.name}, ${member.group || BLANK_FIELD}` : `${BLANK_FIELD}, group`;
      blocks.push(plain(label, { alignment: "left" }));
    }
    blocks.push(plain(""));
    blocks.push(plain("Course project supervisor:", { alignment: "left" }));
    blocks.push(plain(metadata.supervisor || "degree, academic title, position, full name", { alignment: "left" }));
    blocks.push(plain(""));
    blocks.push(plain(template.supervisorVerdict, { alignment: "left" }));
    blocks.push(plain(""));
    blocks.push(plain(template.city));
    blocks.push(plain(String(metadata.year || "")));
    return blocks;
  }

  function buildTeamPage(metadata) {
    const blocks = [heading("Team members", { structural: true, numbered: false })];
    const members = metadata.teamMembers && metadata.teamMembers.length ? metadata.teamMembers : [];
    if (!members.length) {
      blocks.push(placeholderParagraph());
      return blocks;
    }
    blocks.push({
      type: "list",
      lines: members.map((member, index) => `${index + 1}. ${member.name || BLANK_FIELD}, ${member.group || BLANK_FIELD}`),
      generated: true,
    });
    return blocks;
  }

  function buildOriginality(profile, metadata) {
    const template = profile.originality;
    if (!template) return [];
    const members = metadata.teamMembers && metadata.teamMembers.length ? metadata.teamMembers : [];
    const names = members.length
      ? members.map((member) => `${member.name || BLANK_FIELD}, ${member.group || BLANK_FIELD}`).join("; ")
      : BLANK_FIELD;

    const blocks = [heading(template.title, { structural: true, numbered: false })];
    blocks.push({
      type: "paragraph",
      generated: true,
      text:
        `We, ${names}, students of the undergraduate educational programme ` +
        `${metadata.programme || "Business Management / Business Informatics"} (field of study 38.03.02 Management) ` +
        `of the HSE Graduate School of Business, confirm that the course project on the topic of ` +
        `«${metadata.topic || BLANK_FIELD}»:`,
    });
    blocks.push({
      type: "list",
      generated: true,
      lines: template.claims.map((claim, index) => `${index + 1}. ${claim}`),
    });
    blocks.push({ type: "paragraph", text: template.acknowledgement, generated: true });
    blocks.push({ type: "paragraph", text: template.signatureLabel, generated: true });
    const signatureCount = members.length || 1;
    blocks.push({
      type: "list",
      generated: true,
      lines: Array.from(
        { length: signatureCount },
        (unused, index) => `${index + 1}. ${template.signatureLine}${metadata.year || ""}`,
      ),
    });
    return blocks;
  }

  function buildTableBlocks(template, profile) {
    return [
      {
        type: "caption",
        kind: "table",
        number: "",
        title: template.title,
        raw: "",
        generated: true,
        alignment: profile.captions.table.alignment,
        position: profile.captions.table.position,
        prefix: profile.captions.table.prefix,
      },
      {
        type: "sourceNote",
        text: profile.captions.authorsNote,
        alignment: profile.captions.table.alignment,
        generated: true,
      },
      {
        type: "docTable",
        columns: template.columns.slice(),
        rows: template.rows.slice(),
        generated: true,
      },
    ];
  }

  function buildIndividualContribution(profile, metadata) {
    const template = profile.individualContribution;
    if (!template) return [];
    const members = metadata.teamMembers && metadata.teamMembers.length ? metadata.teamMembers : [null];
    const blocks = [heading(template.title, { structural: true, numbered: false })];
    for (const member of members) {
      const name = member && member.name ? member.name : BLANK_FIELD;
      blocks.push(heading(`${template.title}: ${name}`, { level: 2, numbered: false, structural: true }));
      for (const subsection of template.subsections) {
        blocks.push(heading(subsection, { level: 3, numbered: false, structural: true }));
        blocks.push(placeholderParagraph());
      }
    }
    return blocks;
  }

  function contributionBlocks(segment) {
    return segment.blocks.map((block) =>
      block.type === "heading"
        ? { ...block, number: "", numbered: false, structural: true }
        : block,
    );
  }

  function looksLikeReference(text) {
    return /(?:https?:\/\/|\bdoi\b|\bisbn\b|\b(?:19|20)\d{2}\b)/iu.test(text);
  }

  function referenceBlocks(segment) {
    return segment.blocks.map((block) => {
      if (block.type !== "heading") return block;
      const text = block.raw || block.title || "";
      if (!looksLikeReference(text)) return block;
      return { type: "paragraph", text, generated: false };
    });
  }

  function assemble(options) {
    const settings = options || {};
    const profile = FormatProfiles.get(settings.profileId);
    const metadata = Object.assign(
      { topic: "", company: "", programme: "", teamMembers: [], supervisor: "", year: "" },
      settings.metadata || {},
    );

    const normalized = Structurer.applyProfile(settings.text || "", profile.id, { placeholders: false });
    if (settings.blocks) normalized.blocks = structuredClone(settings.blocks);
    const segments = segmentByHeadings(normalized.blocks, profile.requiredSections);

    const sections = profile.requiredSections;
    const bySection = new Map();
    const extras = [];
    const appendices = [];
    const structural = new Map();
    let preamble = null;

    for (const segment of segments) {
      if (!segment.heading) {
        preamble = segment;
        continue;
      }
      if (segment.heading.kind === "appendix") {
        appendices.push(segment);
        continue;
      }
      const match = matchSection(segment, sections);
      if (match) {
        if (!bySection.has(match.id)) bySection.set(match.id, segment);
        else bySection.get(match.id).blocks.push(...segment.blocks);
        continue;
      }
      if (isStructuralSegment(segment)) {
        structural.set(normalizedTitle(segment.heading.title), segment);
        continue;
      }
      extras.push(segment);
    }

    // Личные данные — единственное, что инструмент вывести не может.
    // Незаполненные поля перечисляются отдельно от содержательных пробелов.
    const blanks = [];
    if (!metadata.topic) blanks.push("Тема проекта и компания — на титульном листе");
    if (!metadata.teamMembers.length) blanks.push("Состав команды: фамилии и группы");
    else {
      metadata.teamMembers.forEach((member, index) => {
        if (!member.name) blanks.push(`Участник ${index + 1}: фамилия и инициалы`);
        if (!member.group) blanks.push(`Участник ${index + 1}: номер группы`);
      });
    }
    if (!metadata.supervisor) blanks.push("Научный руководитель: степень, звание, должность, ФИО");
    if (!metadata.programme) blanks.push("Образовательная программа — подчеркнуть нужную");
    if (!metadata.year) blanks.push("Год на титульном листе и в подписях");

    const inserted = [];
    const blocks = [];

    // Титульный лист (Приложение 1) — первая страница, без нумерации.
    blocks.push(...buildTitlePage(profile, metadata));
    blocks.push(...buildTeamPage(metadata));
    if (profile.originality) blocks.push(...buildOriginality(profile, metadata));

    // Оглавление (§3.1) — поле Word, номера страниц проставляются при открытии.
    blocks.push(heading("Contents", { structural: true, numbered: false }));
    blocks.push({ type: "toc", generated: true });

    // Основные разделы §2.1.
    let sectionNumber = 0;
    for (const section of sections) {
      sectionNumber += 1;
      const segment = bySection.get(section.id);
      blocks.push(heading(section.title, { number: String(sectionNumber), numbered: true }));

      if (segmentHasContent(segment)) {
        blocks.push(...addTablePresentation(segment.blocks, section, profile));
      } else {
        blocks.push(placeholderParagraph());
        inserted.push(section.title);
      }

      let subsectionNumber = 0;
      for (const subsection of section.subsections || []) {
        if (coversSubsection(segment, subsection)) continue;
        subsectionNumber += 1;
        blocks.push(
          heading(subsection, {
            level: 2,
            number: `${sectionNumber}.${subsectionNumber}`,
            numbered: true,
            placeholder: true,
          }),
        );
        blocks.push(placeholderParagraph());
        inserted.push(`${section.title} → ${subsection}`);
      }

      const suppliedTableCount = segmentTableCount(segment);
      if (suppliedTableCount < (section.tables || []).length) {
        for (const template of (section.tables || []).slice(suppliedTableCount)) {
          blocks.push(...buildTableBlocks(template, profile));
          inserted.push(`${section.title} → таблица «${template.title}»`);
        }
      }
    }

    // Разделы автора, не попавшие в канонический список.
    for (const segment of extras) {
      blocks.push(segment.heading, ...segment.blocks);
    }

    // Личный вклад (Приложение 3) — перед заключением. Если пользователь
    // добавил его как отдельную часть проекта, сохраняем этот текст вместо
    // пустого шаблона.
    if (profile.individualContribution) {
      const contribution = structural.get(normalizedTitle(profile.individualContribution.title));
      if (segmentHasContent(contribution)) {
        blocks.push(heading(profile.individualContribution.title, { structural: true, numbered: false }));
        blocks.push(...contributionBlocks(contribution));
      } else {
        blocks.push(...buildIndividualContribution(profile, metadata));
        inserted.push(profile.individualContribution.title);
      }
    }

    // Заключение и список источников (§3.1).
    for (const part of profile.requiredParts) {
      if (part.id === "contents") continue;
      const segment = structural.get(normalizedTitle(part.title));
      blocks.push(heading(part.title, { structural: true, numbered: false }));
      const hasReferenceEntry = part.id === "references" && segment && segment.blocks.some(
        (block) => block.type === "heading" && looksLikeReference(block.raw || block.title || ""),
      );
      if (segmentHasContent(segment) || hasReferenceEntry) {
        blocks.push(...(part.id === "references" ? referenceBlocks(segment) : segment.blocks));
      }
      else {
        blocks.push(placeholderParagraph());
        inserted.push(part.title);
      }
    }

    // Приложения автора идут последними (§5.3).
    for (const segment of appendices) {
      blocks.push(segment.heading, ...segment.blocks);
    }

    // Преамбула автора не теряется: если она есть и не попала ни в один
    // раздел, выносим её отдельным блоком перед приложениями.
    if (preamble && segmentHasContent(preamble)) {
      const anchor = blocks.findIndex((block) => block.type === "heading" && block.kind === "appendix");
      const tail = [heading("Материал без раздела", { structural: true, numbered: false }), ...preamble.blocks];
      if (anchor === -1) blocks.push(...tail);
      else blocks.splice(anchor, 0, ...tail);
      inserted.push("Материал без раздела (текст до первого заголовка)");
    }

    // A complete pasted document owns its order. Add the shared front matter,
    // but never silently reorder or replace supplied material with templates.
    if (settings.blocks && settings.preserveOrder) {
      const bodyStart = blocks.findIndex((block) => block.type === "toc") + 1;
      blocks.splice(bodyStart, blocks.length - bodyStart, ...structuredClone(settings.blocks));
    }
    renumberSections(blocks);
    renumberTables(blocks, profile);

    return {
      blocks,
      profile,
      metadata,
      inserted,
      blanks,
      normalized,
      stats: {
        sections: sections.length,
        filled: bySection.size,
        placeholders: inserted.length,
        tables: blocks.filter((block) => block.type === "docTable" || block.type === "table").length,
        extras: extras.length,
        appendices: appendices.length,
      },
    };
  }

  /**
   * Сквозная нумерация разделов по собранному документу. Нужна потому, что
   * подразделы автора и подразделы каркаса нумеруются независимо и иначе
   * дают дубли вида «1.1» дважды подряд. Структурные части (оглавление,
   * заключение, источники, приложения, личный вклад) номеров не получают.
   */
  function renumberSections(blocks) {
    const counters = [];
    for (const block of blocks) {
      if (block.type !== "heading") continue;
      if (block.kind === "appendix" || block.structural || block.numbered === false) continue;
      const level = Math.max(1, Math.min(block.level || 1, 6));
      counters.length = level;
      for (let index = 0; index < level; index += 1) {
        if (!counters[index]) counters[index] = index === level - 1 ? 0 : 1;
      }
      counters[level - 1] += 1;
      block.number = counters.slice(0, level).join(".");
    }
  }

  /** Сквозная нумерация подписей во всём собранном документе (§5.1). */
  function renumberTables(blocks, profile) {
    const counters = { table: 0, figure: 0 };
    for (const block of blocks) {
      if (block.type !== "caption") continue;
      counters[block.kind] += 1;
      block.number = String(counters[block.kind]);
      block.prefix = profile.captions[block.kind].prefix;
      block.alignment = block.alignment || profile.captions[block.kind].alignment;
      block.position = block.position || profile.captions[block.kind].position;
    }
  }

  /** Текстовый предпросмотр собранного документа для панели результата. */
  function renderPreview(blocks, profile) {
    const lines = [];
    for (const block of blocks) {
      if (block.type === "plain") {
        lines.push(block.text);
      } else if (block.type === "heading") {
        const title =
          profile.layout.heading.uppercase && block.level === 1
            ? String(block.title).toLocaleUpperCase("ru")
            : block.title;
        if (block.kind === "appendix") {
          lines.push(block.number ? `Appendix ${block.number}. ${title}` : `Appendix. ${title}`);
        } else {
          lines.push(block.number ? `${block.number}. ${title}` : title);
        }
      } else if (block.type === "caption") {
        lines.push(block.title ? `${block.prefix} ${block.number}. ${block.title}` : `${block.prefix} ${block.number}`);
      } else if (block.type === "sourceNote") {
        lines.push(block.text);
      } else if (block.type === "toc") {
        lines.push("[оглавление — Word соберёт его при открытии файла]");
      } else if (block.type === "docTable") {
        lines.push(block.columns.join(" | "));
        for (const row of block.rows) lines.push(`${row}${" |".repeat(Math.max(0, block.columns.length - 1))}`);
      } else if (block.type === "list" || block.type === "table") {
        lines.push(block.lines.join("\n"));
      } else {
        lines.push(block.text || "");
      }
    }
    return lines.filter((line) => line !== undefined).join("\n\n").replace(/\n{3,}/gu, "\n\n").trim();
  }

  return {
    assemble,
    renderPreview,
    renumberSections,
    segmentByHeadings,
    coversSubsection,
    PLACEHOLDER_MARK,
    BLANK_FIELD,
  };
});
