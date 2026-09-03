(function attachDocumentStructurer(root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./format-profiles.js") : root.FormatProfiles,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DocumentStructurer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createDocumentStructurer(FormatProfiles) {
  "use strict";

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const URL_RE = /https?:\/\/[^\s<>()]+/giu;
  const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
  const LIST_LINE_RE = /^(?:[-*•▪◦]|\d+[.)])\s+/u;
  // Одиночная строка «1. Название» — это нумерованный заголовок, а не список
  // из одного пункта, поэтому маркерный список распознаётся отдельно.
  const BULLET_LINE_RE = /^[-*•▪◦]\s+/u;
  const STRUCTURAL_HEADING_RE = /^(?:contents|table\s+of\s+contents|individual\s+contribution|личный\s+вклад|conclusion|references|bibliography|appendix|содержание|оглавление|заключение|список\s+(?:источников|литературы)|приложение)/iu;
  const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/u;
  const APPENDIX_HEADING_RE = /^(?:appendix|приложение)\s+([A-Za-zА-Яа-я0-9]+)\.?\s*(.*)$/iu;
  const TABLE_CAPTION_RE = /^(?:table|таблица|табл\.)\s*([0-9]+(?:\.[0-9]+)*)?\s*[.—–-]?\s*(.*)$/iu;
  const FIGURE_CAPTION_RE = /^(?:figure|fig\.|рисунок|рис\.)\s*([0-9]+(?:\.[0-9]+)*)?\s*[.—–-]?\s*(.*)$/iu;
  const BACK_MATTER_RE = /^(?:conclusion|references|bibliography|appendix|заключение|список\s+(?:источников|литературы)|приложение)/iu;
  // \b в JS опирается на ASCII-класс \w, поэтому кириллическая аббревиатура
  // им не выделяется — границы задаются юникодными lookaround-ами.
  const ABBREVIATION_RE = /(?<![\p{L}\p{N}])[A-ZА-ЯЁ]{2,6}(?![\p{L}\p{N}])/gu;
  const HEADING_MAX_WORDS = 14;

  // Прочерк на месте недостающего раздела. Содержание вносится вручную:
  // инструмент не придумывает текст, он только держит структуру собранной.
  const PLACEHOLDER_MARK = "—";

  // Аббревиатуры, которые методичка относит к общеупотребимым: расшифровка
  // при первом упоминании для них не требуется (§5.1, «Rules for writing
  // abbreviations» — «along with common acronyms»).
  const COMMON_ABBREVIATIONS = new Set([
    "AI", "B2B", "B2C", "B2G", "CAGR", "CAPEX", "CEO", "CFO", "CRM", "DCF",
    "EBIT", "EBITDA", "ERP", "ESG", "EU", "FCF", "GDP", "GMV", "GPS", "HR",
    "IRR", "IT", "KPI", "LLC", "LTV", "MVP", "NPV", "OPEX", "PR", "R&D",
    "ROI", "SEO", "SME", "SWOT", "UK", "URL", "USA", "USD", "VAT", "WACC",
    "ВВП", "ГОСТ", "ЕС", "ИП", "НДС", "ООО", "РФ", "СМИ", "США", "ЦБ",
  ]);

  function countWords(text) {
    return (text.match(WORD_RE) || []).length;
  }

  function normalizeKey(text) {
    return text
      .toLocaleLowerCase("ru")
      .replace(/[\s\p{P}]+/gu, " ")
      .trim();
  }

  function anchorList(text, pattern) {
    return (text.match(pattern) || []).map((item) => item.toLocaleLowerCase("ru")).sort();
  }

  function sameList(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function isAllCaps(line) {
    const letters = line.match(/\p{L}/gu) || [];
    if (letters.length < 3) return false;
    return letters.every((letter) => letter === letter.toLocaleUpperCase("ru"));
  }

  function stripTerminalPunctuation(title) {
    return title.replace(/[.\s]+$/u, "");
  }

  /**
   * Классифицирует блок, отделённый пустыми строками. Заголовком считается
   * только короткая одиночная строка без завершающей точки либо строка с
   * явной нумерацией — так обычный короткий абзац не превращается в раздел.
   */
  function classifyBlock(block) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (lines.length > 1 && lines.some((line) => LIST_LINE_RE.test(line))) {
      return { type: "list", lines };
    }

    if (lines.length === 1) {
      const line = lines[0];
      if (BULLET_LINE_RE.test(line)) return { type: "list", lines };

      const appendix = line.match(APPENDIX_HEADING_RE);
      if (appendix) {
        return {
          type: "heading",
          kind: "appendix",
          level: 1,
          number: appendix[1],
          title: stripTerminalPunctuation(appendix[2] || ""),
          raw: line,
        };
      }

      const tableCaption = line.match(TABLE_CAPTION_RE);
      if (tableCaption && (tableCaption[1] || tableCaption[2])) {
        return { type: "caption", kind: "table", number: tableCaption[1] || "", title: tableCaption[2] || "", raw: line };
      }

      const figureCaption = line.match(FIGURE_CAPTION_RE);
      if (figureCaption && (figureCaption[1] || figureCaption[2])) {
        return {
          type: "caption",
          kind: "figure",
          number: figureCaption[1] || "",
          title: figureCaption[2] || "",
          raw: line,
        };
      }

      const numbered = line.match(NUMBERED_HEADING_RE);
      if (numbered && countWords(numbered[2]) <= HEADING_MAX_WORDS && !/[.!?…]$/u.test(numbered[2])) {
        return {
          type: "heading",
          kind: "section",
          level: numbered[1].split(".").length,
          number: numbered[1],
          title: stripTerminalPunctuation(numbered[2]),
          raw: line,
        };
      }

      if (countWords(line) <= HEADING_MAX_WORDS && (isAllCaps(line) || !/[.!?…:]$/u.test(line))) {
        // Оглавление, заключение, список источников и приложения — основные
        // структурные части (§3.1): всегда верхний уровень и без нумерации.
        const structural = STRUCTURAL_HEADING_RE.test(line);
        return {
          type: "heading",
          kind: "section",
          level: structural || isAllCaps(line) ? 1 : 2,
          number: "",
          title: stripTerminalPunctuation(line),
          raw: line,
          structural,
        };
      }
    }

    if (lines.length > 1 && lines.every((line) => line.includes("\t"))) {
      return { type: "table", lines };
    }

    return { type: "paragraph", text: lines.join(" ") };
  }

  function parseDocument(text) {
    return String(text || "")
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map(classifyBlock)
      .filter(Boolean);
  }

  function isBodyBlock(block) {
    return block.type === "paragraph" || block.type === "list" || block.type === "table";
  }

  function blockText(block) {
    if (block.type === "list" || block.type === "table") return block.lines.join("\n");
    return block.text || "";
  }

  function sectionCandidates(section) {
    return [section.title, ...section.aliases].map(normalizeKey);
  }

  function findHeadingIndex(blocks, candidates) {
    return blocks.findIndex(
      (block) => block.type === "heading" && candidates.some((candidate) => normalizeKey(block.title).includes(candidate)),
    );
  }

  function backMatterIndex(blocks) {
    const index = blocks.findIndex((block) => block.type === "heading" && BACK_MATTER_RE.test(block.title));
    return index === -1 ? blocks.length : index;
  }

  function makeStub(title, options) {
    const settings = options || {};
    return [
      {
        type: "heading",
        kind: "section",
        level: 1,
        number: "",
        title,
        raw: "",
        placeholder: true,
        structural: Boolean(settings.structural),
        numbered: Boolean(settings.numbered),
      },
      { type: "paragraph", text: PLACEHOLDER_MARK, placeholder: true },
    ];
  }

  /**
   * Ставит прочерк на месте каждого недостающего обязательного раздела,
   * сохраняя канонический порядок из §2.1: пропущенный раздел встаёт перед
   * ближайшим следующим найденным, а если таких нет — перед заключением,
   * списком источников и приложениями.
   */
  function insertMissingSections(blocks, profile, inserted) {
    if (!profile.requiredSections.length) return blocks;

    const result = blocks.slice();
    const found = profile.requiredSections.map((section) => findHeadingIndex(result, sectionCandidates(section)));
    const tail = backMatterIndex(result);

    const groups = new Map();
    profile.requiredSections.forEach((section, index) => {
      if (found[index] >= 0) return;
      let at = tail;
      for (let next = index + 1; next < found.length; next += 1) {
        if (found[next] >= 0) {
          at = found[next];
          break;
        }
      }
      if (!groups.has(at)) groups.set(at, []);
      groups.get(at).push(section.title);
      inserted.push(section.title);
    });

    for (const at of [...groups.keys()].sort((left, right) => right - left)) {
      const stubs = groups.get(at).flatMap((title) => makeStub(title, { numbered: true }));
      result.splice(at, 0, ...stubs);
    }
    return result;
  }

  /**
   * Прочерки для обязательных частей работы из §3.1: оглавление в начало,
   * заключение и список источников — перед приложениями.
   */
  function insertMissingParts(blocks, profile, text, inserted) {
    let result = blocks.slice();
    const missing = profile.requiredParts.filter(
      (part) => !part.optional && !part.patterns.some((pattern) => pattern.test(text)),
    );

    for (const part of missing) {
      if (part.id === "contents") {
        result = [...makeStub(part.title, { structural: true }), ...result];
      } else if (part.id === "conclusion") {
        const at = result.findIndex(
          (block) => block.type === "heading" && /^(?:references|bibliography|appendix|список|приложение)/iu.test(block.title),
        );
        const index = at === -1 ? result.length : at;
        result.splice(index, 0, ...makeStub(part.title, { structural: true }));
      } else {
        const at = result.findIndex(
          (block) => block.type === "heading" && /^(?:appendix|приложение)/iu.test(block.title),
        );
        const index = at === -1 ? result.length : at;
        result.splice(index, 0, ...makeStub(part.title, { structural: true }));
      }
      inserted.push(part.title);
    }
    return result;
  }

  /**
   * Пересобирает сквозную нумерацию заголовков. Работает только когда
   * документ уже пронумерован — иначе номера не выдумываются.
   */
  function renumberHeadings(blocks, changes) {
    // Нумеруются только содержательные разделы. Оглавление, заключение,
    // список источников и приложения по §3.1 номера не получают.
    const sectionHeadings = blocks.filter(
      (block) =>
        block.type === "heading" &&
        block.kind === "section" &&
        !block.structural &&
        (block.number || block.numbered),
    );
    if (!sectionHeadings.length) return blocks;

    const counters = [];
    for (const block of sectionHeadings) {
      const level = Math.max(1, Math.min(block.level, 6));
      counters.length = level;
      for (let index = 0; index < level; index += 1) {
        if (!counters[index]) counters[index] = index === level - 1 ? 0 : 1;
      }
      counters[level - 1] += 1;
      const next = counters.slice(0, level).join(".");
      if (next !== block.number) {
        changes.renumbered += 1;
        block.number = next;
      }
    }
    return blocks;
  }

  /**
   * Сквозная нумерация подписей (§5.1). Таблицы и рисунки нумеруются
   * независимо друг от друга, начиная с единицы.
   */
  function renumberCaptions(blocks, profile, changes) {
    const counters = { table: 0, figure: 0 };
    for (const block of blocks) {
      if (block.type !== "caption") continue;
      counters[block.kind] += 1;
      const expected = String(counters[block.kind]);
      const prefix = profile.captions[block.kind].prefix;
      if (block.number !== expected || !block.raw.startsWith(prefix)) changes.captions += 1;
      block.number = expected;
      block.prefix = prefix;
      block.title = stripTerminalPunctuation(block.title);
      block.alignment = profile.captions[block.kind].alignment;
      block.position = profile.captions[block.kind].position;
    }
    return blocks;
  }

  function headingText(block, profile) {
    const title = profile.layout.heading.uppercase && block.level === 1
      ? block.title.toLocaleUpperCase("ru")
      : block.title;
    if (block.kind === "appendix") {
      const label = block.number ? `Appendix ${block.number}` : "Appendix";
      return title ? `${label}. ${title}` : label;
    }
    return block.number ? `${block.number}. ${title}` : title;
  }

  function captionText(block) {
    const label = `${block.prefix} ${block.number}`;
    return block.title ? `${label}. ${block.title}` : label;
  }

  function renderBlocks(blocks, profile) {
    return blocks
      .map((block) => {
        if (block.type === "heading") return headingText(block, profile);
        if (block.type === "caption") return captionText(block);
        return blockText(block);
      })
      .join("\n\n");
  }

  function findMissingParts(text, profile) {
    return profile.requiredParts
      .filter((part) => !part.optional)
      .filter((part) => !part.patterns.some((pattern) => pattern.test(text)))
      .map((part) => part.title);
  }

  function checkAbbreviations(text) {
    const seen = new Set();
    const undefinedOnes = [];
    for (const match of text.matchAll(ABBREVIATION_RE)) {
      const token = match[0];
      if (COMMON_ABBREVIATIONS.has(token) || seen.has(token)) continue;
      seen.add(token);
      // Расшифровка допустима в двух формах: «Полное название (СОКР)»
      // либо «СОКР (полное название)».
      const before = text.slice(Math.max(0, match.index - 120), match.index);
      const after = text.slice(match.index + token.length, match.index + token.length + 120);
      const expandedBefore = /[\p{L}]{3,}[^()\n]{0,80}\(\s*$/u.test(before);
      const expandedAfter = /^\s*\([^)\n]{6,}\)/u.test(after);
      if (!expandedBefore && !expandedAfter) undefinedOnes.push(token);
    }
    return undefinedOnes;
  }

  function checkCitations(text, profile) {
    return {
      inText: (text.match(profile.citation.inTextPattern) || []).length,
      foreign: (text.match(profile.citation.foreignPattern) || []).length,
    };
  }

  function checkAppendixReferences(blocks, text) {
    const declared = new Set(
      blocks
        .filter((block) => block.type === "heading" && block.kind === "appendix" && block.number)
        .map((block) => String(block.number).toLocaleUpperCase("ru")),
    );
    const mentioned = new Set();
    for (const match of text.matchAll(/(?:see\s+)?appendix\s+([A-Za-z0-9]+)/giu)) {
      mentioned.add(match[1].toLocaleUpperCase("ru"));
    }
    return {
      unreferenced: [...declared].filter((id) => !mentioned.has(id)),
      missing: [...mentioned].filter((id) => !declared.has(id)),
    };
  }

  function checkCaptionReferences(blocks, text) {
    const orphans = [];
    for (const block of blocks) {
      if (block.type !== "caption") continue;
      const mentions = (text.match(new RegExp(`${block.prefix}\\s*${block.number}\\b`, "giu")) || []).length;
      if (mentions < 1) orphans.push(`${block.prefix} ${block.number}`);
    }
    return orphans;
  }

  function buildReport(blocks, text, profile, inserted) {
    const problems = [];
    const notes = [];

    // Проверки идут по основному тексту: заголовки — в том числе те, что
    // вставил сам инструмент, — иначе попадают в выдачу как аббревиатуры
    // и как ссылки на приложения.
    const bodyText = blocks.filter(isBodyBlock).map(blockText).join("\n\n");

    if (inserted.length) {
      problems.push({
        id: "placeholders",
        title: `Вставлены прочерки «${PLACEHOLDER_MARK}» — заполнить вручную`,
        items: inserted,
      });
    }

    const abbreviations = checkAbbreviations(bodyText);
    if (abbreviations.length) {
      problems.push({
        id: "abbreviations",
        title: "Аббревиатуры без расшифровки при первом упоминании (§5.1)",
        items: abbreviations.slice(0, 12),
      });
    }

    const citations = checkCitations(bodyText, profile);
    if (citations.foreign) {
      problems.push({
        id: "citations",
        title: "Ссылки в формате [12] вместо (Автор, год) по ГОСТ Р 7.0.5-2008 (§5.3)",
        items: [`найдено ${citations.foreign}; замена требует данных об источнике и делается вручную`],
      });
    }
    if (citations.inText) notes.push(`Ссылок в формате (Автор, год): ${citations.inText}.`);

    const appendices = checkAppendixReferences(blocks, bodyText);
    if (appendices.unreferenced.length) {
      problems.push({
        id: "appendix-unreferenced",
        title: "На приложение нет ссылки в тексте (§3.1)",
        items: appendices.unreferenced.map((id) => `Appendix ${id}`),
      });
    }
    if (appendices.missing.length) {
      problems.push({
        id: "appendix-missing",
        title: "В тексте есть ссылка на отсутствующее приложение",
        items: appendices.missing.map((id) => `Appendix ${id}`),
      });
    }

    const orphanCaptions = checkCaptionReferences(blocks, bodyText);
    if (orphanCaptions.length) {
      problems.push({
        id: "captions",
        title: "Таблица или рисунок не упомянуты в тексте (§5.1)",
        items: orphanCaptions,
      });
    }

    const pages = Math.max(1, Math.round(text.length / profile.layout.charactersPerPage));
    notes.push(
      `Объём: ${text.length} символов, примерно ${pages} с. при норме ${profile.layout.charactersPerPage} символов на страницу.`,
    );

    return { problems, notes };
  }

  /**
   * Проверяет, что структурная нормализация не потеряла содержание: каждый
   * абзац, список и таблица исходника должны целиком присутствовать в
   * результате. Нумерация заголовков и подписей под эту проверку не
   * подпадает — она меняется намеренно.
   */
  function verifyBodyPreserved(sourceBlocks, rendered) {
    const issues = [];
    const bodyBlocks = sourceBlocks.filter(isBodyBlock);
    const lowered = rendered.toLocaleLowerCase("ru");

    if (bodyBlocks.some((block) => !rendered.includes(blockText(block)))) {
      issues.push("потерян фрагмент основного текста");
    }

    const bodyText = bodyBlocks.map(blockText).join("\n");
    if (anchorList(bodyText, URL_RE).some((url) => !lowered.includes(url))) {
      issues.push("изменились ссылки");
    }
    if (anchorList(bodyText, NUMBER_RE).some((number) => !rendered.includes(number))) {
      issues.push("изменились числа или даты");
    }
    return issues;
  }

  function applyProfile(text, profileId, options) {
    const settings = options || {};
    const withPlaceholders = settings.placeholders !== false;
    const profile = FormatProfiles.get(profileId);
    const source = String(text || "").trim();
    const changes = { renumbered: 0, captions: 0, placeholders: 0 };

    if (!source) {
      return { text: "", blocks: [], profile, changes, inserted: [], report: { problems: [], notes: [] }, warnings: [] };
    }

    const sourceBlocks = parseDocument(source);
    const inserted = [];

    let blocks = sourceBlocks;
    if (withPlaceholders) {
      blocks = insertMissingSections(sourceBlocks, profile, inserted);
      blocks = insertMissingParts(blocks, profile, source, inserted);
    }
    changes.placeholders = inserted.length;

    renumberCaptions(blocks, profile, changes);
    renumberHeadings(blocks, changes);

    const rendered = renderBlocks(blocks, profile);
    const warnings = [];
    const issues = verifyBodyPreserved(sourceBlocks, rendered);

    if (issues.length) {
      warnings.push(`Структурные правки отменены: ${issues.join(", ")}.`);
      const fallback = parseDocument(source);
      renumberCaptions(fallback, profile, { renumbered: 0, captions: 0 });
      return {
        text: source,
        blocks: fallback,
        profile,
        changes: { renumbered: 0, captions: 0, placeholders: 0 },
        inserted: [],
        report: buildReport(fallback, source, profile, []),
        warnings,
      };
    }

    return {
      text: rendered,
      blocks,
      profile,
      changes,
      inserted,
      report: buildReport(blocks, rendered, profile, inserted),
      warnings,
    };
  }

  return {
    applyProfile,
    analyze: buildReport,
    isBodyBlock,
    blockText,
    sectionCandidates,
    normalizeKey,
    parseDocument,
    classifyBlock,
    renderBlocks,
    countWords,
    findMissingParts,
    PLACEHOLDER_MARK,
  };
});
