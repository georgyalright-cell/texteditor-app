(function attachElicitation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Elicitation = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createElicitation() {
  "use strict";

  // Блок B плана. Главная мысль блока: конкретику нельзя добавить правилом —
  // её знает только автор. Поэтому там, где плотность якорей проседает,
  // инструмент не переписывает абзац, а задаёт вопрос по этому абзацу и
  // показывает, какой ответ закроет дыру.
  //
  // Методы 12-17 не автоматизируются вовсе: это чеклист, который автор
  // проходит сам. Он здесь ради того, чтобы не выглядело, будто отчёт из
  // блока A и правки из блока C закрывают весь текст.

  const WORD_RE = /[\p{L}\p{N}-]+/gu;

  function loadAnchorGuard() {
    if (typeof globalThis !== "undefined" && globalThis.AnchorGuard) return globalThis.AnchorGuard;
    if (typeof require === "function") return require("./anchor-guard.js");
    return null;
  }

  // \b опирается на ASCII-класс \w и на кириллице не срабатывает вовсе —
  // тот же обход через lookaround, что в paraphraser.js и text-metrics.js.
  const EDGE_LEFT = "(?<![\\p{L}\\p{N}_-])";
  const EDGE_RIGHT = "(?![\\p{L}\\p{N}_-])";

  function phrase(body, open) {
    return new RegExp(EDGE_LEFT + body + (open ? "" : EDGE_RIGHT), "iu");
  }

  // Утверждения о пользе без числа — самое дешёвое место для конкретики.
  const BENEFIT_RU = phrase("(?:позволя[ею]т?|улучша[ею]т?|повыша[ею]т?|снижа[ею]т?|увеличива[ею]т?|оптимизиру[ею]т?|ускоря[ею]т?|значительно|существенно|эффективн\\p{L}*)");
  const BENEFIT_EN = phrase("(?:enables?|improves?|increases?|reduces?|optimi[sz]es?|significantly|substantial|efficien\\p{L}*|accelerates?)");
  const UNIVERSAL_RU = phrase("(?:все|всех|любой|любая|каждый|каждая|всегда|никогда|ни один|всякий)");
  const UNIVERSAL_EN = phrase("(?:all|any|every|always|never|none)");
  const HEDGE_QUOTE_RU = phrase("(?:возможно|вероятно|как правило|скорее всего|по-видимому|представляется|зачастую|потенциально|теоретически|в целом)");
  const HEDGE_QUOTE_EN = phrase("(?:possibly|probably|arguably|generally|typically|presumably|potentially)");

  // Методы 12-17: чеклист интерфейса, не автоматика.
  const CHECKLIST = [
    {
      id: "position",
      method: 12,
      title: "Одна главная мысль на раздел",
      prompt: "Сформулируйте позицию раздела одной фразой. Если получается «с одной стороны… с другой стороны» — позиции нет, есть обзор.",
    },
    {
      id: "tradeoff",
      method: 13,
      title: "Выгода ↔ издержка",
      prompt: "У каждого утверждения о пользе назовите цену: деньги, сроки, риск, отказ от альтернативы.",
    },
    {
      id: "omission",
      method: 14,
      title: "Осознанный пропуск",
      prompt: "Выбросьте один пункт и скажите в тексте, почему он не рассматривается. Полное покрытие таксономии — машинный признак.",
    },
    {
      id: "situation",
      method: 15,
      title: "Ситуативная привязка",
      prompt: "Когда, где, для кого, в какой версии или в каком периоде это верно?",
    },
    {
      id: "case",
      method: 16,
      title: "Единичный случай вместо обобщения",
      prompt: "Замените «компании часто…» одним конкретным случаем: кто, когда, что сделал, что вышло.",
    },
    {
      id: "falsifiable",
      method: 17,
      title: "Проверка фальсифицируемости",
      prompt: "Найдите в разделе хотя бы одно утверждение, с которым компетентный человек может не согласиться. Если таких нет — раздел пустой.",
    },
  ];

  function countWords(text) {
    return (String(text).match(WORD_RE) || []).length;
  }

  function paragraphs(text) {
    return String(text || "")
      .split(/\n{2,}/)
      .map((item, index) => ({ index: index + 1, text: item.trim() }))
      .filter((item) => item.text);
  }

  function quote(text, limit) {
    const flat = String(text).replace(/\s+/g, " ").trim();
    return flat.length > (limit || 90) ? `${flat.slice(0, limit || 90)}…` : flat;
  }

  function firstMatch(text, pattern) {
    const match = String(text).match(pattern);
    return match ? match[0] : null;
  }

  /**
   * Вопросы к автору по конкретным абзацам. Порог — не «мало якорей вообще»,
   * а «абзац достаточно длинный, чтобы конкретике там было место»: короткая
   * связка между разделами законно обходится без цифр.
   */
  function questions(text, options) {
    const settings = options || {};
    const language = settings.language || "ru";
    const guard = loadAnchorGuard();
    // Порог длины абзаца: ниже него молчим. Короткая связка между разделами
    // законно обходится без цифр, а двадцать слов — это уже утверждение,
    // которому место без единого якоря не полагается.
    const minWords = settings.minWords || 20;
    const targetDensity = settings.targetDensity === undefined ? 3 : settings.targetDensity;
    const result = [];

    for (const paragraph of paragraphs(text)) {
      const words = countWords(paragraph.text);
      if (words < minWords) continue;
      const anchors = guard ? guard.extractAnchors(paragraph.text) : [];
      const byType = guard ? guard.countByType(anchors) : {};
      const density = (anchors.length * 100) / words;
      const scope = `Абзац ${paragraph.index}`;
      const excerpt = quote(paragraph.text);

      if (density < targetDensity) {
        if (!byType.number && !byType.unit) {
          result.push({
            id: `${paragraph.index}-numbers`,
            method: 11,
            scope,
            excerpt,
            kind: "числа",
            question: "Ни одного числа на весь абзац. Что вы можете назвать точно: объём, долю, срок, цену, количество?",
          });
        }
        if (!byType.date) {
          result.push({
            id: `${paragraph.index}-dates`,
            method: 15,
            scope,
            excerpt,
            kind: "период",
            question: "К какому периоду это относится? Год, квартал, «до запуска» — любая привязка лучше её отсутствия.",
          });
        }
        if (!byType.proper) {
          result.push({
            id: `${paragraph.index}-names`,
            method: 16,
            scope,
            excerpt,
            kind: "имена",
            question: "Кто именно? Назовите компанию, продукт, отдел или роль вместо обобщённого субъекта.",
          });
        }
      }

      const benefit = firstMatch(paragraph.text, language === "ru" ? BENEFIT_RU : BENEFIT_EN);
      if (benefit && !byType.number) {
        result.push({
          id: `${paragraph.index}-benefit`,
          method: 13,
          scope,
          excerpt,
          kind: "насколько",
          question: `«${benefit}…» — насколько? Дайте цифру, а следом назовите, чем за это платят.`,
        });
      }

      const hedge = firstMatch(paragraph.text, language === "ru" ? HEDGE_QUOTE_RU : HEDGE_QUOTE_EN);
      if (hedge) {
        result.push({
          id: `${paragraph.index}-hedge`,
          method: 11,
          scope,
          excerpt,
          kind: "хедж",
          question: `«${hedge}» — это измерено или предположение? Если измерено, поставьте число; если нет, скажите прямо, что это гипотеза.`,
        });
      }

      const universal = firstMatch(paragraph.text, language === "ru" ? UNIVERSAL_RU : UNIVERSAL_EN);
      if (universal) {
        result.push({
          id: `${paragraph.index}-universal`,
          method: 17,
          scope,
          excerpt,
          kind: "фальсифицируемость",
          question: `«${universal}» — есть исключение? Названное исключение делает утверждение проверяемым, а абзац живым.`,
        });
      }
    }
    return result;
  }

  /**
   * D31 — терминологическая политика. Ловится не «плохой» термин, а дрейф:
   * один и тот же термин записан по-разному. Выбор между жёстким
   * единообразием и естественным дрейфом остаётся за автором, инструмент
   * только показывает места.
   */
  function terminology(text) {
    const source = String(text || "");
    const words = (source.match(/[\p{L}][\p{L}\p{N}-]{3,}/gu) || [])
      .map((word) => word.toLocaleLowerCase("ru"));
    const forms = new Map();

    function remember(surface) {
      // Ключ без дефисов и пробелов: «бизнес-модель», «бизнес модель» и
      // «бизнесмодель» — один термин, записанный тремя способами.
      const key = surface.replace(/[-\s]/g, "");
      if (key.length < 6) return;
      if (!forms.has(key)) forms.set(key, new Map());
      const variants = forms.get(key);
      variants.set(surface, (variants.get(surface) || 0) + 1);
    }

    for (let index = 0; index < words.length; index += 1) {
      remember(words[index]);
      // Пары считаются отдельно от одиночных слов: иначе жадное сопоставление
      // склеивает «бизнес-модель проверена» в один термин и дрейф теряется.
      if (index + 1 < words.length) remember(`${words[index]} ${words[index + 1]}`);
    }

    const drift = [];
    for (const [, variants] of forms) {
      if (variants.size < 2) continue;
      const entries = Array.from(variants, ([form, count]) => ({ form, count }))
        .sort((left, right) => right.count - left.count);
      drift.push({ variants: entries, total: entries.reduce((sum, entry) => sum + entry.count, 0) });
    }
    return drift.sort((left, right) => right.total - left.total).slice(0, 8);
  }

  /**
   * D30 — непараллельные заголовки. Для профилей с обязательной структурой
   * проверка выключается: там формулировки заданы методичкой, и «разнообразить»
   * их нельзя, даже если однообразие видно.
   */
  function headings(list, options) {
    const settings = options || {};
    if (settings.strictSections) {
      return { enabled: false, note: "Формулировки разделов заданы методичкой — вариативность заголовков здесь неприменима." };
    }
    const items = (list || []).map((item) => String(item).trim()).filter(Boolean);
    if (items.length < 3) return { enabled: false, note: "Заголовков слишком мало для оценки." };
    const signatures = new Map();
    for (const heading of items) {
      const words = heading.match(WORD_RE) || [];
      const first = (words[0] || "").toLocaleLowerCase("ru");
      const schema = `${/(?:ание|ение|ация|ость|ство)$/u.test(first) ? "отглагольное" : /(?:ть|ing)$/u.test(first) ? "действие" : "имя"}·${words.length <= 2 ? "короткий" : "длинный"}`;
      signatures.set(schema, (signatures.get(schema) || 0) + 1);
    }
    let dominant = { schema: "", count: 0 };
    for (const [schema, count] of signatures) {
      if (count > dominant.count) dominant = { schema, count };
    }
    const share = dominant.count / items.length;
    return {
      enabled: true,
      share,
      parallel: share >= 0.8,
      dominant: dominant.schema,
      note: share >= 0.8
        ? "Почти все заголовки построены по одной схеме. Переформулируйте один-два так, чтобы схема сбилась."
        : "Схемы заголовков различаются — отдельная правка не нужна.",
    };
  }

  function build(text, options) {
    const settings = options || {};
    return {
      questions: questions(text, settings),
      checklist: CHECKLIST,
      terminology: terminology(text),
      headings: headings(settings.headings, settings),
    };
  }

  return { build, questions, terminology, headings, CHECKLIST };
});
