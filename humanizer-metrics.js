(function attachHumanizerMetrics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HumanizerMetrics = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createHumanizerMetrics() {
  "use strict";

  // Числовая оценка «похоже на машинный текст», перенесённая один в один из
  // прежнего пайплайна (humanizer/heuristics.py): те же четыре сигнала, те же
  // веса и то же правило, что антитеза не усредняется, а поднимает итог
  // снизу — один живой хит «не просто X, а Y» иначе растворялся в среднем.
  // Считается прямо из текста, без моделей.

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const SENTENCE_SPLIT_RE = /(?<=[.!?…])\s+/u;
  // Коннектором считается и длинное тире, и дефис между словами: типографика
  // нормализует один глиф в другой, и оценка не должна от этого прыгать.
  const EM_DASH_RE = /[—–]|(?<=\s)-(?=\s)/gu;
  // Тире внутри числового диапазона (2026–2030, 5–7 лет) — правильный набор,
  // а не машинный коннектор: до подсчёта такие вхождения исключаются.
  const NUMERIC_RANGE_RE = /\d\s*[—–]\s*\d/gu;

  const CLICHE_EN = [
    "it is important to note", "it should be noted", "it is worth noting",
    // «in conclusion» и «in summary» здесь больше не значатся: словарной
    // замены, которая их улучшает, не существует — одна связка менялась бы
    // на другую. Их удаляет пасс сокращения (edit-passes.js, метод 18),
    // а долю зачинов меряет A4.
    "moreover", "furthermore", "additionally",
    "in today's world", "plays a key role", "plays a crucial role",
    "a testament to", "delve into", "cutting-edge", "state-of-the-art",
    "seamless", "leverage", "in the realm of", "a wide range of",
    "due to the fact that", "at the end of the day", "paradigm shift",
    "holistic approach", "game-changing", "unlock the potential",
    // Диалект бизнес-плана и консалтинговой записки. Прежний список ловил
    // блоговый регистр («delve into», «cutting-edge»), и англоязычный
    // бизнес-план проходил его с оценкой 0 из 100 — цикл гуманизации на
    // таком тексте просто не запускался. Каждой строке ниже соответствует
    // правило в paraphraser.js: сигнал без трансформации недостижим.
    "comprehensive framework", "proactive risk management", "strategic goals",
    "well-positioned to", "significant market share", "rigorous monitoring",
    "structured implementation approach", "in a dynamic environment",
    "data-driven decision-making", "key stakeholders", "core competencies",
    "competitive landscape", "significant potential", "plays a pivotal role",
    "going forward", "robust solution", "drive significant",
  ];

  // Связки и вводные обороты сюда не входят намеренно. Ими владеет метрика A4
  // и пассы 18 и 21, которые их удаляют, а не заменяют. Пока «таким образом»
  // числилось штампом, словарная замена на «в результате» обнуляла сигнал
  // штампов, не тронув связку: инструмент отчитывался об улучшении за обмен
  // одной печати на другую. Здесь остаётся то, что словарная замена
  // действительно улучшает.
  const CLICHE_RU = [
    "стоит подчеркнуть", "нельзя не отметить", "следует сказать",
    "можно сделать вывод", "играет ключевую роль", "не подлежит сомнению",
    "в современном мире", "на сегодняшний день", "трудно переоценить",
    "неотъемлемой частью", "широкий спектр",
  ];


  const ANTITHESIS_RU_STRONG =
    /не просто [^,.!?—]{2,40}[,—] а |не только [^,.!?—]{2,40}, но и |это не просто/giu;
  const ANTITHESIS_RU_WEAK =
    /(?<![\p{L}])не (?!просто\b|только\b)[^,.!?—]{2,30}, а [^,.!?—]{2,40}[.,!?]/giu;
  // Английский аналог того же риторического тика.
  const ANTITHESIS_EN_STRONG =
    /\bnot just [^,.!?—]{2,40}[,—] but |\bnot only [^,.!?—]{2,40},? but also |\bit is not merely /giu;
  const ANTITHESIS_EN_WEAK = /\bnot [^,.!?—]{2,30}, but rather [^,.!?—]{2,40}[.,!?]/giu;

  // Дискурсивные зачины и хеджи. Единственный экземпляр списков на весь
  // проект: text-metrics.js берёт их отсюда. Расхождение двух копий означало
  // бы, что отчёт и цикл гуманизации меряют разные вещи.
  const DISCOURSE_RU = [
    "кроме того", "более того", "таким образом", "следовательно", "в связи с этим",
    "вместе с тем", "при этом", "в то же время", "с одной стороны", "с другой стороны",
    "в заключение", "подводя итог", "в целом", "в частности", "во-первых", "во-вторых",
    "в-третьих", "наконец", "итак", "тем не менее", "однако", "поэтому", "также",
    "важно отметить", "следует отметить", "стоит отметить", "необходимо отметить",
    // Результаты словарных замен: без них сигнал отмывается синонимом.
    "наряду с этим", "помимо этого", "к тому же", "в результате", "в итоге",
    "отметим", "заметим", "подчеркнём",
  ];
  const DISCOURSE_EN = [
    "moreover", "furthermore", "additionally", "in addition", "therefore", "thus",
    "consequently", "however", "nevertheless", "nonetheless", "on the one hand",
    "on the other hand", "in conclusion", "to summarise", "to summarize", "overall",
    "in general", "in particular", "firstly", "secondly", "thirdly", "finally",
    "it is important to note", "it should be noted", "it is worth noting", "notably",
    "as a result", "in other words", "that said",
    // Результаты словарных замен.
    "also", "beyond that", "in addition",
  ];
  const HEDGE_RU = [
    "возможно", "вероятно", "как правило", "в некоторой степени", "относительно",
    "довольно", "достаточно часто", "скорее всего", "может быть", "по-видимому",
    "в определённой мере", "в известной мере", "как известно", "принято считать",
    "можно предположить", "представляется", "зачастую", "порой", "иногда",
    "в ряде случаев", "потенциально", "теоретически", "в целом можно",
  ];
  const HEDGE_EN = [
    "possibly", "probably", "arguably", "relatively", "somewhat", "rather",
    "generally", "typically", "often", "sometimes", "in some cases", "to some extent",
    "it seems", "it appears", "may suggest", "might suggest", "could suggest",
    "potentially", "presumably", "roughly", "more or less", "fairly",
  ];

  const SETS = {
    en: { cliche: CLICHE_EN, discourse: DISCOURSE_EN, hedge: HEDGE_EN, strong: ANTITHESIS_EN_STRONG, weak: ANTITHESIS_EN_WEAK, locale: "en" },
    ru: { cliche: CLICHE_RU, discourse: DISCOURSE_RU, hedge: HEDGE_RU, strong: ANTITHESIS_RU_STRONG, weak: ANTITHESIS_RU_WEAK, locale: "ru" },
  };

  function detectLanguage(text) {
    const cyrillic = (String(text).match(/\p{Script=Cyrillic}/gu) || []).length;
    const latin = (String(text).match(/\p{Script=Latin}/gu) || []).length;
    return cyrillic > latin ? "ru" : "en";
  }

  function countWords(text) {
    return (text.match(WORD_RE) || []).length;
  }

  function sentences(text) {
    return String(text || "")
      .split(SENTENCE_SPLIT_RE)
      .filter((item) => item.trim());
  }

  function connectorDashes(text) {
    return (text.replace(NUMERIC_RANGE_RE, "") .match(EM_DASH_RE) || []).length;
  }

  // Норма тире измерена, а не назначена: девятый дециль по корпусам живых
  // текстов. Единое «одно на пять предложений» было неверно в обе стороны.
  // В русском тире — штатный знак (нулевая связка: «Х — это Y»), и живая
  // проза даёт до 0.30 на предложение; прежний порог 0.20 штрафовал четверть
  // корпуса, причём сразу на 100. В английской деловой прозе тире почти не
  // встречается (медиана 0.00), и тот же порог 0.20 недоштрафовывал машинный
  // текст втрое.
  const DASH_ALLOWANCE = { ru: 0.3, en: 0.08 };

  function emDashScore(text, sentenceCount, locale) {
    const dashes = connectorDashes(text);
    if (dashes === 0) return 0;
    const rate = DASH_ALLOWANCE[locale] || DASH_ALLOWANCE.en;
    const allowance = Math.max(1, Math.round(sentenceCount * rate));
    const excess = dashes - allowance;
    if (excess <= 0) return 0;
    return Math.min(100, excess * 50);
  }

  function burstinessScore(sentenceList) {
    const lengths = sentenceList.map(countWords).filter((value) => value > 0);
    if (lengths.length < 3) return 0;
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    if (mean === 0) return 0;
    const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
    const cv = Math.sqrt(variance) / mean; // у живого текста обычно > 0.5
    const aiLikeness = Math.max(0, (0.55 - cv) / 0.55);
    return Math.min(100, Math.round(aiLikeness * 100));
  }

  function clicheScore(loweredText, phrases) {
    let hits = 0;
    for (const phrase of phrases) {
      let index = loweredText.indexOf(phrase);
      while (index !== -1) {
        hits += 1;
        index = loweredText.indexOf(phrase, index + phrase.length);
      }
    }
    return Math.min(100, hits * 20);
  }

  // Сколько антитез живой текст позволяет себе бесплатно. В русском «не
  // только X, но и Y» — обычная конструкция: она есть у 28% фрагментов
  // корпуса. Прежнее правило выставляло за одну встречу сразу 45, то есть
  // объявляло каждый четвёртый живой текст предельно машинным. В английской
  // деловой прозе конструкция редка (4% текстов), и там бесплатных нет.
  const ANTITHESIS_FREE = { ru: 1, en: 0 };

  function antithesisScore(text, set) {
    const strong = (text.match(set.strong) || []).length;
    const weak = (text.match(set.weak) || []).length;
    const free = ANTITHESIS_FREE[set.locale] === undefined ? 0 : ANTITHESIS_FREE[set.locale];
    const strongPenalty = Math.max(0, strong - free);
    // Первое вхождение слабой формы — обычная грамматика, не в счёт.
    const weakPenalty = Math.max(0, weak - 1);
    return Math.min(100, strongPenalty * 45 + weakPenalty * 30);
  }

  // Свободная норма у каждого признака своя: связка в каждом седьмом
  // предложении — нормальная письменная речь, а в каждом третьем — след
  // генерации. Штрафуется только превышение нормы, поэтому живой текст
  // получает по этим признакам ноль, а не «немного машинный».
  // Девятый дециль по корпусам: 127 разделов MD&A для английского,
  // 159 фрагментов статей по экономике для русского. Числа те же, что в
  // зонах отчёта, — иначе цикл гуманизации и отчёт мерили бы разную норму.
  const ALLOWANCES = {
    ru: { discourse: 0.12, opener: 0.3, hedge: 0.68 },
    en: { discourse: 0.09, opener: 0.54, hedge: 0.27 },
  };

  function allowanceFor(locale) {
    return ALLOWANCES[locale] || ALLOWANCES.en;
  }

  function discourseScore(sentenceList, set) {
    if (!sentenceList.length) return 0;
    let hits = 0;
    for (const sentence of sentenceList) {
      const head = sentence.toLocaleLowerCase(set.locale).replace(/^[^\p{L}]+/u, "").slice(0, 40);
      if (set.discourse.some((phrase) => head.startsWith(phrase))) hits += 1;
    }
    // Считается превышение над числом связок, а не над долей: пасс 21 всегда
    // оставляет хотя бы одну связку намеренно, и если оценка штрафует её, цикл
    // гоняется за признаком, который сам же запретил себе править.
    const allowed = Math.max(1, Math.round(sentenceList.length * allowanceFor(set.locale).discourse));
    return Math.min(100, Math.max(0, hits - allowed) * 35);
  }

  function openerRepeatScore(sentenceList, set) {
    if (sentenceList.length < 3) return 0;
    const counts = new Map();
    for (const sentence of sentenceList) {
      const opener = (sentence.match(/[\p{L}\p{N}-]+/u) || [""])[0].toLocaleLowerCase(set.locale);
      if (opener) counts.set(opener, (counts.get(opener) || 0) + 1);
    }
    let repeated = 0;
    for (const count of counts.values()) if (count > 1) repeated += count;
    const share = repeated / sentenceList.length;
    return Math.min(100, Math.round(Math.max(0, share - allowanceFor(set.locale).opener) * 300));
  }

  function hedgeScore(loweredText, words, set) {
    if (!words) return 0;
    let hits = 0;
    for (const phrase of set.hedge) {
      let index = loweredText.indexOf(phrase);
      while (index !== -1) {
        hits += 1;
        index = loweredText.indexOf(phrase, index + phrase.length);
      }
    }
    const density = (hits * 100) / words;
    return Math.min(100, Math.round(Math.max(0, density - allowanceFor(set.locale).hedge) * 35));
  }

  // Ровные абзацы — след нарезки по линейке. Считается только там, где
  // выбор вообще был: меньше трёх абзацев или короткие абзацы ничего не
  // говорят об авторе.
  const PARAGRAPH_SPREAD_TARGET = 0.3;

  function paragraphScore(text) {
    const paragraphs = String(text || "").split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
    if (paragraphs.length < 3) return 0;
    const lengths = paragraphs.map(countWords);
    if (lengths.some((value) => value < 40)) return 0;
    const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    if (!average) return 0;
    const variance = lengths.reduce((sum, value) => sum + (value - average) ** 2, 0) / lengths.length;
    const spread = Math.sqrt(variance) / average;
    if (spread >= PARAGRAPH_SPREAD_TARGET) return 0;
    return Math.min(100, Math.round(((PARAGRAPH_SPREAD_TARGET - spread) / PARAGRAPH_SPREAD_TARGET) * 100));
  }

  function scoreText(text, language) {
    const source = String(text || "");
    const resolved = language || detectLanguage(source);
    const set = SETS[resolved] || SETS.en;
    const sentenceList = sentences(source);
    const emDash = emDashScore(source, sentenceList.length, set.locale);
    const burstiness = burstinessScore(sentenceList);
    const cliche = clicheScore(source.toLocaleLowerCase(set.locale), set.cliche);
    const antithesis = antithesisScore(source, set);
    const lowered = source.toLocaleLowerCase(set.locale);
    const discourse = discourseScore(sentenceList, set);
    const openerRepeat = openerRepeatScore(sentenceList, set);
    const hedge = hedgeScore(lowered, countWords(source), set);
    const paragraphs = paragraphScore(source);

    let score = Math.round(
      0.28 * emDash + 0.24 * burstiness + 0.18 * cliche +
        0.11 * discourse + 0.09 * openerRepeat + 0.07 * hedge + 0.06 * paragraphs,
    );
    if (antithesis > 0) score = Math.max(score, antithesis);

    return {
      score,
      emDash,
      burstiness,
      cliche,
      antithesis,
      discourse,
      openerRepeat,
      hedge,
      paragraphs,
      language: resolved,
      sentenceCount: sentenceList.length,
      dashCount: connectorDashes(source),
    };
  }

  function describe(result) {
    const notes = [];
    if (result.emDash >= 30) {
      notes.push(`тире (—) вместо точки или запятой: ${result.emDash}/100, всего тире ${result.dashCount}`);
    }
    if (result.burstiness >= 30) {
      notes.push(`предложения почти одной длины, ритм ровный: ${result.burstiness}/100`);
    }
    if (result.cliche >= 30) {
      notes.push(`шаблонные обороты: ${result.cliche}/100`);
    }
    if (result.antithesis >= 30) {
      notes.push(`антитезы «not just X but Y» / «не просто X, а Y»: ${result.antithesis}/100`);
    }
    return notes;
  }

  return {
    scoreText,
    describe,
    detectLanguage,
    countWords,
    sentences,
    CLICHE_EN,
    CLICHE_RU,
    DISCOURSE_EN,
    DISCOURSE_RU,
    HEDGE_EN,
    HEDGE_RU,
  };
});
