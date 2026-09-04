(function attachTextMetrics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TextMetrics = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createTextMetrics() {
  "use strict";

  // Блок A плана: десять детерминированных измерений текста. Ничего не
  // правится — считается и показывается. Это осознанно: правка без измерения
  // до и после превращается в вкусовщину, а измерение полезно и само по себе.
  //
  // Каждая метрика возвращает не только число, но и целевую зону. Зона, а не
  // максимизация (гард 34): CV длин предложений 0.9 — это уже не «живой
  // ритм», а кривляние, и инструмент обязан сказать об этом отдельным
  // статусом overshoot, а не зелёной галочкой.

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const SENTENCE_SPLIT_RE = /(?<=[.!?…])[\s ]+/u;
  const LIST_LINE_RE = /^(?:[-*•▪◦—]|\d+[.)])\s+/u;

  function loadAnchorGuard() {
    if (typeof globalThis !== "undefined" && globalThis.AnchorGuard) return globalThis.AnchorGuard;
    if (typeof require === "function") return require("./anchor-guard.js");
    return null;
  }

  // A4 и A5 берут списки из humanizer-metrics.js, а не держат свои копии.
  // Две копии означали бы, что отчёт и управляющая оценка меряют разные
  // вещи: словарь заменяет связку на синоним, одна копия про него знает,
  // другая нет — и признак пропадает из виду ровно там, где он остался.
  function loadHumanizerMetrics() {
    if (typeof globalThis !== "undefined" && globalThis.HumanizerMetrics) return globalThis.HumanizerMetrics;
    if (typeof require === "function") return require("./humanizer-metrics.js");
    throw new Error("TextMetrics: не загружен humanizer-metrics.js");
  }

  const shared = loadHumanizerMetrics();
  const DISCOURSE_RU = shared.DISCOURSE_RU;
  const DISCOURSE_EN = shared.DISCOURSE_EN;
  const HEDGE_RU = shared.HEDGE_RU;
  const HEDGE_EN = shared.HEDGE_EN;

  // \b в JavaScript опирается на ASCII-класс \w, поэтому на кириллице он
  // просто не срабатывает: «оптимизация» + \b не находится никогда. В
  // paraphraser.js этот же обход уже сделан — здесь граница слова тоже
  // собирается из lookaround, иначе половина метрик молча показывает ноль.
  const EDGE_LEFT = "(?<![\\p{L}\\p{N}_-])";
  const EDGE_RIGHT = "(?![\\p{L}\\p{N}_-])";

  function wordRegExp(body, flags) {
    return new RegExp(EDGE_LEFT + body + EDGE_RIGHT, flags || "giu");
  }

  // A6 — номинализация. Суффиксы отглагольных существительных: «осуществление
  // оптимизации» вместо «мы оптимизировали».
  const NOMINALIZATION_RU = wordRegExp("\\p{L}{3,}(?:ание|ение|ация|изация|ирование|ность|ость|ство|изм)[аеиоуыюя]{0,2}");
  const NOMINALIZATION_EN = wordRegExp("\\p{L}{4,}(?:tion|sion|ment|ance|ence|ency|ancy|ity|ness|ism)s?");
  // Пассив: русское «-ся» при отглагольном и «был/была/было + причастие»,
  // английское «is/are/was/were/been + причастие».
  const PASSIVE_RU = new RegExp(
    EDGE_LEFT +
      "(?:(?:был[аио]?|будет|будут)\\s+\\p{L}{4,}(?:ан|ана|ано|аны|ен|ена|ено|ены)" +
      "|\\p{L}{4,}(?:ирует|ируют|ается|аются|яется|яются|ется|ются|ился|илась|илось|ились)ся?)" +
      EDGE_RIGHT,
    "giu",
  );
  const PASSIVE_EN = wordRegExp("(?:is|are|was|were|be|been|being)\\s+(?:\\p{L}+ly\\s+)?\\p{L}{3,}(?:ed|en)");

  // A10 — абстрактные существительные. Пересекается с A6, но меряет другое:
  // A6 — про глагол, спрятанный в существительное, A10 — про долю слов, за
  // которыми не стоит ничего наблюдаемого.
  const ABSTRACT_RU = wordRegExp("\\p{L}{4,}(?:ость|ность|изм|ство|ация|ение|ание|итет|изация)[аеиоуыюя]{0,2}");
  const ABSTRACT_EN = wordRegExp("\\p{L}{4,}(?:ity|ism|ness|tion|sion|ance|ence|ology|hood|ship)s?");

  // Утверждение без якоря: предложение обещает пользу или даёт оценку, но не
  // содержит ни числа, ни даты, ни имени — с ним невозможно не согласиться,
  // потому что оно ничего не утверждает. Это метод 17 из плана,
  // фальсифицируемость, переведённый в измеримую форму: именно такие
  // предложения составляют тело сгенерированного текста, и ни одна из
  // остальных метрик их не видит.
  const CLAIM_RU = wordRegExp(
    "(?:позволя[ею]т?|обеспечива[ею]т?|улучша[ею]т?|повыша[ею]т?|снижа[ею]т?|способству[ею]т?|" +
      "гарантиру[ею]т?|значительн\\p{L}*|существенн\\p{L}*|эффективн\\p{L}*|ключев\\p{L}*|" +
      "важн\\p{L}*|комплексн\\p{L}*|современн\\p{L}*|инновационн\\p{L}*|успешн\\p{L}*|устойчив\\p{L}*)",
    "iu",
  );
  const CLAIM_EN = wordRegExp(
    "(?:provides?|ensures?|enables?|delivers?|improves?|increases?|reduces?|supports?|drives?|" +
      "allows?|helps?|significant|comprehensive|robust|effective|efficient|strategic|innovative|" +
      "successful|seamless|scalable|sustainable|critical|essential|key)",
    "iu",
  );

  const LANG = {
    ru: {
      discourse: DISCOURSE_RU,
      hedge: HEDGE_RU,
      nominalization: NOMINALIZATION_RU,
      passive: PASSIVE_RU,
      abstract: ABSTRACT_RU,
      claim: CLAIM_RU,
      locale: "ru",
    },
    en: {
      discourse: DISCOURSE_EN,
      hedge: HEDGE_EN,
      nominalization: NOMINALIZATION_EN,
      passive: PASSIVE_EN,
      abstract: ABSTRACT_EN,
      claim: CLAIM_EN,
      locale: "en",
    },
  };

  // Гард 35: целевые зоны различаются по жанру. Академический отчёт живёт с
  // более ровным ритмом и большей долей номинализаций, чем заметка; лендинг
  // наоборот. Одни и те же цифры для всех жанров — самый быстрый способ
  // испортить текст «в сторону человечности».
  const GENRES = [
    {
      id: "academic",
      label: "Академический отчёт, курсовой проект",
      note: "Терпит номинализацию и ровный ритм, но требует конкретики и позиции.",
      // Английские нормы жанра измерены, а не назначены: 127 разделов MD&A из
      // годовых отчётов 10-K сорока эмитентов разных отраслей, поданных до
      // июня 2021 года. Дата подачи и есть гарантия человеческого авторства.
      // Воспроизводится: tools/fetch-edgar.cjs → tools/prepare-corpus.cjs →
      // tools/calibrate.cjs.
      //
      // Несколько прежних порогов оказались неверны в разы. Максимум по
      // якорям стоял ниже медианы живых текстов; требование коротких фраз
      // описывало приём, которого в этом жанре просто нет; повтор лексики
      // штрафовался в семь раз строже, чем следует, — деловая проза
      // повторяет названия продуктов и сегментов, и это не машинность.
      //
      // Корпус корпоративный, он плотнее студенческого по цифрам. Нижняя
      // граница по якорям поэтому требовательна намеренно: она показывает
      // автору, насколько его текст беднее фактами, чем настоящий отчёт.
      calibration: {
        en: { texts: 127, metrics: 15 },
        ru: { texts: 159, metrics: 15 },
      },
      zonesByLanguage: {
        // Русские нормы измерены отдельно: 159 фрагментов из ста статей десяти
        // экономических журналов «КиберЛенинки», 1998-2019 годы. Год
        // публикации и есть гарантия авторства.
        //
        // Разница с английскими зонами оказалась больше ожидаемой и в другую
        // сторону: номинализация у русской академической прозы вдвое ниже
        // (4.35 против 9.83), а короткие фразы она использует свободно (0.38
        // против 0.05). Дело не в языках как таковых, а в том, что суффиксный
        // признак ловит в английском половину деловой лексики. Это и есть
        // причина, по которой зоны разделены: одно число для обоих языков
        // заведомо неверно хотя бы для одного из них.
        ru: {
          anchorDensity: { min: 3.99, max: 22.86, overshoot: 35.83 },
          emptyClaims: { max: 0.155, overshoot: 0.244 },
          sentenceCv: { min: 0.58, max: 1.26, overshoot: 2.2 },
          shortPerParagraph: { min: 0.14, max: 1.39, overshoot: 2.93 },
          discourseShare: { max: 0.119, overshoot: 0.157 },
          hedgeDensity: { max: 0.68, overshoot: 0.93 },
          nominalizationDensity: { max: 4.35, overshoot: 5.37 },
          paragraphCv: { min: 0.66, max: 1.28, overshoot: 1.55 },
          openerRepeat: { min: 0.037, max: 0.295, overshoot: 0.409 },
          ngramRepeat: { min: 0.006, max: 0.184, overshoot: 0.25 },
          abstractShare: { max: 0.042, overshoot: 0.054 },
          dashShare: { max: 0.147, overshoot: 0.219 },
          // Нижние границы и три метрики ниже измерены на повторной выемке
          // корпуса — 123 фрагмента для русского, 54 для английского. Верхние
          // границы двенадцати прежних метрик оставлены от первой калибровки,
          // где текстов было больше; повторная выемка воспроизвела их с
          // точностью до сотых, и заменять большую выборку меньшей незачем.
          //
          // Пол у повтора зачинов и лексики — исправление, а не добавка. У
          // метрик был только потолок, и машинный ноль лежал внутри зоны,
          // читаясь как «хорошо». Живой автор долбит один термин: медиана
          // повтора лексики 0.054 в русском и 0.21 в английском, у машины 0.
          punctInventory: { min: 0.22, max: 0.93, overshoot: 1.4 },
          longSentences: { min: 0.029, max: 0.161, overshoot: 0.213 },
          triadShare: { max: 0.066, overshoot: 0.119 },
        },
        en: {
          anchorDensity: { min: 5.25, max: 24.94, overshoot: 29.19 },
          emptyClaims: { max: 0.251, overshoot: 0.448 },
          sentenceCv: { min: 0.48, max: 1.03, overshoot: 1.43 },
          shortPerParagraph: { min: 0.01, max: 0.25, overshoot: 0.59 },
          discourseShare: { max: 0.093, overshoot: 0.153 },
          hedgeDensity: { max: 0.27, overshoot: 0.61 },
          nominalizationDensity: { max: 9.83, overshoot: 11.37 },
          paragraphCv: { min: 0.86, max: 1.85, overshoot: 2.37 },
          openerRepeat: { min: 0.162, max: 0.536, overshoot: 0.628 },
          ngramRepeat: { min: 0.111, max: 0.444, overshoot: 0.541 },
          abstractShare: { max: 0.067, overshoot: 0.088 },
          dashShare: { max: 0.033, overshoot: 0.065 },
          punctInventory: { min: 0.15, max: 0.89, overshoot: 1.28 },
          longSentences: { min: 0.117, max: 0.327, overshoot: 0.468 },
          triadShare: { max: 0.207, overshoot: 0.331 },
        },
      },
      zones: {
        anchorDensity: { min: 3, max: 14, overshoot: 20 },
        sentenceCv: { min: 0.45, max: 0.8, overshoot: 1.2 },
        shortPerParagraph: { min: 0.35, max: 1.5, overshoot: 2.5 },
        shortShare: { max: 0.35, overshoot: 0.4 },
        discourseShare: { max: 0.15, overshoot: 0.45 },
        hedgeDensity: { max: 2, overshoot: 5 },
        nominalizationDensity: { max: 9, overshoot: 18 },
        paragraphCv: { min: 0.25, max: 0.9, overshoot: 1.3 },
        openerRepeat: { min: 0.1, max: 0.3, overshoot: 0.6 },
        ngramRepeat: { min: 0.01, max: 0.06, overshoot: 0.15 },
        abstractShare: { max: 0.08, overshoot: 0.15 },
        dashShare: { max: 0.35, overshoot: 0.5 },
        punctInventory: { min: 0.15, max: 2.5, overshoot: 4 },
        longSentences: { min: 0.02, max: 0.35, overshoot: 0.5 },
        triadShare: { max: 0.2, overshoot: 0.35 },
        emptyClaims: { max: 0.3, overshoot: 0.6 },
      },
    },
    {
      id: "tech-post",
      label: "Техпост, разбор, документация",
      note: "Здесь конкретики нужно больше всего, а номинализации — меньше всего.",
      zones: {
        anchorDensity: { min: 4, max: 18, overshoot: 24 },
        sentenceCv: { min: 0.5, max: 0.85, overshoot: 1.2 },
        shortPerParagraph: { min: 0.5, max: 2, overshoot: 3 },
        shortShare: { max: 0.4, overshoot: 0.45 },
        discourseShare: { max: 0.12, overshoot: 0.4 },
        hedgeDensity: { max: 2, overshoot: 5 },
        nominalizationDensity: { max: 8, overshoot: 18 },
        paragraphCv: { min: 0.3, max: 1, overshoot: 1.4 },
        openerRepeat: { min: 0.1, max: 0.3, overshoot: 0.6 },
        ngramRepeat: { min: 0.01, max: 0.06, overshoot: 0.15 },
        abstractShare: { max: 0.08, overshoot: 0.15 },
        dashShare: { max: 0.35, overshoot: 0.5 },
        punctInventory: { min: 0.15, max: 2.5, overshoot: 4 },
        longSentences: { min: 0.02, max: 0.35, overshoot: 0.5 },
        triadShare: { max: 0.2, overshoot: 0.35 },
        emptyClaims: { max: 0.2, overshoot: 0.45 },
      },
    },
    {
      id: "note",
      label: "Записка, письмо, внутренний документ",
      note: "Самый свободный ритм: короткая фраза здесь норма, а не приём.",
      zones: {
        anchorDensity: { min: 3, max: 20, overshoot: 26 },
        sentenceCv: { min: 0.5, max: 0.95, overshoot: 1.3 },
        shortPerParagraph: { min: 0.5, max: 2.5, overshoot: 3.5 },
        shortShare: { max: 0.45, overshoot: 0.55 },
        discourseShare: { max: 0.12, overshoot: 0.4 },
        hedgeDensity: { max: 2.5, overshoot: 6 },
        nominalizationDensity: { max: 7, overshoot: 16 },
        paragraphCv: { min: 0.3, max: 1.1, overshoot: 1.5 },
        openerRepeat: { min: 0.1, max: 0.35, overshoot: 0.6 },
        ngramRepeat: { min: 0.01, max: 0.07, overshoot: 0.16 },
        abstractShare: { max: 0.07, overshoot: 0.14 },
        dashShare: { max: 0.4, overshoot: 0.55 },
        punctInventory: { min: 0.2, max: 3, overshoot: 4.5 },
        longSentences: { min: 0, max: 0.2, overshoot: 0.35 },
        triadShare: { max: 0.25, overshoot: 0.4 },
        emptyClaims: { max: 0.2, overshoot: 0.45 },
      },
    },
    {
      id: "landing",
      label: "Лендинг, презентация, продающий текст",
      note: "Короткие фразы допустимы массово, но хеджи и абстракции убивают текст.",
      zones: {
        anchorDensity: { min: 4, max: 22, overshoot: 28 },
        sentenceCv: { min: 0.5, max: 1, overshoot: 1.4 },
        shortPerParagraph: { min: 0.8, max: 3, overshoot: 4 },
        shortShare: { max: 0.5, overshoot: 0.6 },
        discourseShare: { max: 0.1, overshoot: 0.35 },
        hedgeDensity: { max: 1, overshoot: 3 },
        nominalizationDensity: { max: 6, overshoot: 14 },
        paragraphCv: { min: 0.3, max: 1.2, overshoot: 1.6 },
        openerRepeat: { min: 0.1, max: 0.3, overshoot: 0.6 },
        ngramRepeat: { min: 0.01, max: 0.08, overshoot: 0.18 },
        abstractShare: { max: 0.06, overshoot: 0.12 },
        dashShare: { max: 0.4, overshoot: 0.55 },
        punctInventory: { min: 0.2, max: 3, overshoot: 4.5 },
        longSentences: { min: 0, max: 0.2, overshoot: 0.35 },
        triadShare: { max: 0.25, overshoot: 0.4 },
        emptyClaims: { max: 0.15, overshoot: 0.4 },
      },
    },
  ];

  // Зоны в GENRES выставлены на глаз и остаются мнением, пока их не заменят
  // измерением. tools/calibrate.cjs считает процентили по корпусу живых
  // текстов и отдаёт их в этом формате; здесь они подставляются поверх.
  //
  // Подставляются только зоны для метрик, которые уже существуют: калибровка
  // уточняет пороги, а не заводит новые признаки. И только для жанра, который
  // в корпусе представлен, — переносить пороги записки на курсовую нельзя.
  const MIN_CALIBRATION_TEXTS = 100;

  function zonesFor(target, language) {
    const byLanguage = target.zonesByLanguage && target.zonesByLanguage[language];
    return byLanguage ? Object.assign({}, target.zones, byLanguage) : target.zones;
  }

  function applyCalibration(payload) {
    const data = payload || {};
    const target = GENRES.find((item) => item.id === data.genre);
    if (!target) return { applied: false, reason: `жанр «${data.genre}» неизвестен` };
    const zones = data.zones || {};
    const updated = [];
    // Калибровка без языка ложится в общие зоны жанра, с языком — в
    // отдельный слой поверх них. Так корпус на одном языке не портит нормы
    // второго, для которого корпуса ещё нет.
    const language = data.language || null;
    if (language) {
      target.zonesByLanguage = target.zonesByLanguage || {};
      target.zonesByLanguage[language] = target.zonesByLanguage[language] || {};
    }
    for (const id of Object.keys(zones)) {
      if (!target.zones[id]) continue;
      if (language) target.zonesByLanguage[language][id] = Object.assign({}, target.zones[id], zones[id]);
      else target.zones[id] = Object.assign({}, target.zones[id], zones[id]);
      updated.push(id);
    }
    target.calibration = target.calibration || {};
    target.calibration[language || "any"] = { texts: data.texts || 0, metrics: updated.length };
    return {
      applied: updated.length > 0,
      genre: target.id,
      metrics: updated,
      texts: data.texts || 0,
      // Меньше сотни текстов — процентили пляшут, и об этом надо сказать
      // вслух, а не молча принять цифры за истину.
      trustworthy: (data.texts || 0) >= MIN_CALIBRATION_TEXTS,
    };
  }

  function calibration(genreId, language) {
    const target = GENRES.find((item) => item.id === genreId);
    if (!target || !target.calibration) return null;
    return target.calibration[language] || target.calibration.any || null;
  }

  function genres() {
    return GENRES.map((genre) => ({ id: genre.id, label: genre.label, note: genre.note }));
  }

  function genre(id) {
    return GENRES.find((item) => item.id === id) || GENRES[0];
  }

  function defaultGenreId() {
    return GENRES[0].id;
  }

  function detectLanguage(text) {
    const cyrillic = (String(text).match(/\p{Script=Cyrillic}/gu) || []).length;
    const latin = (String(text).match(/\p{Script=Latin}/gu) || []).length;
    return cyrillic > latin ? "ru" : "en";
  }

  function words(text) {
    return String(text || "").match(WORD_RE) || [];
  }

  function countWords(text) {
    return words(text).length;
  }

  function sentences(text) {
    return String(text || "")
      .replace(/\n+/g, " ")
      .split(SENTENCE_SPLIT_RE)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function paragraphs(text) {
    return String(text || "")
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function listItems(text) {
    return String(text || "")
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => LIST_LINE_RE.test(line));
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function coefficientOfVariation(values) {
    if (values.length < 3) return null;
    const average = mean(values);
    if (!average) return null;
    const variance = mean(values.map((value) => (value - average) ** 2));
    return Math.sqrt(variance) / average;
  }

  function countPhrases(lowered, phrases) {
    let hits = 0;
    for (const phrase of phrases) {
      let index = lowered.indexOf(phrase);
      while (index !== -1) {
        hits += 1;
        index = lowered.indexOf(phrase, index + phrase.length);
      }
    }
    return hits;
  }

  function countMatches(text, pattern) {
    return (String(text).match(pattern) || []).length;
  }

  /** Зачин предложения: первое слово плюс, если оно служебное, второе. */
  function openerSignature(sentence, locale) {
    const parts = (sentence.match(/[\p{L}\p{N}-]+/gu) || []).slice(0, 2);
    if (!parts.length) return "";
    return parts.map((part) => part.toLocaleLowerCase(locale)).join(" ");
  }

  function discourseOpeners(sentenceList, set, locale) {
    const hits = [];
    for (const sentence of sentenceList) {
      const head = sentence.toLocaleLowerCase(locale).replace(/^[^\p{L}]+/u, "").slice(0, 40);
      const marker = set.discourse.find((phrase) => head.startsWith(phrase));
      if (marker) hits.push({ sentence, marker });
    }
    return hits;
  }

  /** Доля слов, попавших хотя бы в один повторяющийся 4-грамм. */
  function ngramRepetition(wordList, locale, size) {
    if (wordList.length < size * 2) return { share: 0, samples: [] };
    const normalized = wordList.map((word) => word.toLocaleLowerCase(locale));
    const seen = new Map();
    for (let index = 0; index + size <= normalized.length; index += 1) {
      const key = normalized.slice(index, index + size).join(" ");
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(index);
    }
    const covered = new Set();
    const samples = [];
    for (const [key, positions] of seen) {
      if (positions.length < 2) continue;
      samples.push({ ngram: key, count: positions.length });
      for (const position of positions) {
        for (let offset = 0; offset < size; offset += 1) covered.add(position + offset);
      }
    }
    samples.sort((left, right) => right.count - left.count);
    return { share: covered.size / normalized.length, samples: samples.slice(0, 6) };
  }

  function repeatedOpeners(sentenceList, locale) {
    const counts = new Map();
    for (const sentence of sentenceList) {
      const signature = openerSignature(sentence, locale);
      if (!signature) continue;
      counts.set(signature, (counts.get(signature) || 0) + 1);
    }
    let repeated = 0;
    const samples = [];
    for (const [signature, count] of counts) {
      if (count < 2) continue;
      repeated += count;
      samples.push({ opener: signature, count });
    }
    samples.sort((left, right) => right.count - left.count);
    return {
      share: sentenceList.length ? repeated / sentenceList.length : 0,
      samples: samples.slice(0, 6),
    };
  }

  /**
   * Инвентарь знаков (M38). Считается всё, кроме запятой, точки и тире:
   * двоеточие, точка с запятой, скобки, вопрос, восклицание, кавычки.
   *
   * Это измерено, а не предположено: у живой академической прозы медиана
   * 0.77 знака на предложение в русском и 0.64 в английском, а у машинного
   * текста ровно ноль — сразу по всем видам знаков. Генерация обходится
   * запятой и точкой, потому что остальные знаки требуют решения о том,
   * что в предложении главное, а что попутное. Метрике нужен пол, а не
   * потолок: избыток скобок — вопрос вкуса, их отсутствие — след машины.
   */
  function punctuationInventory(text, sentenceCount) {
    const source = String(text).replace(/\d\s*[—–-]\s*\d/gu, "");
    const counts = {
      colon: countMatches(source, /:/g),
      semicolon: countMatches(source, /;/g),
      parenthesis: countMatches(source, /\(/g),
      question: countMatches(source, /\?/g),
      exclamation: countMatches(source, /!/g),
      quote: Math.floor(countMatches(source, /[«»"“”]/gu) / 2),
    };
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return { counts, total, perSentence: sentenceCount ? total / sentenceCount : 0 };
  }

  /**
   * Длинный период (M39). Доля предложений от тридцати пяти слов.
   *
   * Разброс длин этого не ловит: чередование двенадцати и двадцати слов даёт
   * приличный CV, ни разу не выйдя за тридцать. У живого корпуса самое
   * длинное предложение фрагмента — 71 слово в русском и 96 в английском по
   * медиане; у машинного текста 25 и 27, то есть длинного периода нет вовсе.
   */
  const LONG_SENTENCE_WORDS = 35;

  function longSentenceShare(sentenceLengths) {
    if (!sentenceLengths.length) return { share: 0, longest: 0 };
    const long = sentenceLengths.filter((value) => value >= LONG_SENTENCE_WORDS);
    return { share: long.length / sentenceLengths.length, longest: Math.max(...sentenceLengths) };
  }

  /**
   * Триада (M40). Перечисление ровно из трёх однородных членов — «X, Y и Z».
   * Признак английский: там машина ставит её в каждом пятом предложении при
   * человеческой медиане 0.12, в русском корпусе разницы нет.
   */
  const TRIAD_RE = /[^,;:()]{3,},[^,;:()]{3,},\s*(?:and|or|и|или|а также)\s/giu;

  function triadShare(sentenceList) {
    if (!sentenceList.length) return { share: 0, samples: [] };
    const samples = [];
    for (const sentence of sentenceList) {
      TRIAD_RE.lastIndex = 0;
      if (TRIAD_RE.test(sentence)) samples.push(sentence.slice(0, 90));
    }
    return { share: samples.length / sentenceList.length, samples: samples.slice(0, 4) };
  }

  /** Пунктуация кроме точки: следим, чтобы всё не шло через длинное тире (D29). */
  function punctuationMix(text) {
    const source = String(text).replace(/\d\s*[—–]\s*\d/gu, "");
    const counts = {
      dash: countMatches(source, /[—–]|(?<=\s)-(?=\s)/gu),
      comma: countMatches(source, /,/g),
      colon: countMatches(source, /:/g),
      semicolon: countMatches(source, /;/g),
      parenthesis: countMatches(source, /\(/g),
    };
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return { counts, total, dashShare: total ? counts.dash / total : 0 };
  }

  /**
   * Статус метрики. Зона задаётся минимумом, максимумом и порогом перелёта:
   * «выше нормы» и «перелёт» — разные вещи, и вторая опаснее первой, потому
   * что возникает уже после правок инструмента, а не в исходнике.
   */
  function evaluate(value, zone, direction) {
    if (value === null || value === undefined) return "unknown";
    if (zone.overshoot !== undefined) {
      if (direction === "down" && value >= zone.overshoot) return "high";
      if (direction === "up" && value <= 0) return "low";
      if (direction === "band" && value > zone.overshoot) return "overshoot";
    }
    if (zone.min !== undefined && value < zone.min) return "low";
    if (zone.max !== undefined && value > zone.max) return "high";
    return "ok";
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined) return "—";
    return Number(value).toFixed(digits === undefined ? 2 : digits).replace(/\.?0+$/, "") || "0";
  }

  function formatPercent(value) {
    if (value === null || value === undefined) return "—";
    return `${Math.round(value * 100)}%`;
  }

  function zoneLabel(zone, kind) {
    if (kind === "percent") {
      const min = zone.min === undefined ? null : `${Math.round(zone.min * 100)}%`;
      const max = zone.max === undefined ? null : `${Math.round(zone.max * 100)}%`;
      if (min && max) return `${min}–${max}`;
      return max ? `не выше ${max}` : `не ниже ${min}`;
    }
    const min = zone.min === undefined ? null : formatNumber(zone.min);
    const max = zone.max === undefined ? null : formatNumber(zone.max);
    if (min && max) return `${min}–${max}`;
    return max ? `не выше ${max}` : `не ниже ${min}`;
  }

  function analyze(text, options) {
    const settings = options || {};
    const source = String(text || "");
    const language = settings.language || detectLanguage(source);
    const set = LANG[language] || LANG.en;
    const target = genre(settings.genreId);
    const zones = zonesFor(target, language);

    const wordList = words(source);
    const sentenceList = sentences(source);
    const paragraphList = paragraphs(source);
    const items = listItems(source);
    const lowered = source.toLocaleLowerCase(set.locale);
    const per100 = wordList.length ? 100 / wordList.length : 0;

    const guard = loadAnchorGuard();
    const anchors = guard ? guard.extractAnchors(source) : [];
    const anchorDensity = anchors.length * per100;

    const sentenceLengths = sentenceList.map(countWords).filter((value) => value > 0);
    const sentenceCv = coefficientOfVariation(sentenceLengths);
    const shortSentences = sentenceLengths.filter((value) => value < 6);
    const shortShare = sentenceLengths.length ? shortSentences.length / sentenceLengths.length : 0;
    const shortPerParagraph = paragraphList.length ? shortSentences.length / paragraphList.length : 0;

    const openers = discourseOpeners(sentenceList, set, set.locale);
    const discourseShare = sentenceList.length ? openers.length / sentenceList.length : 0;

    const hedges = countPhrases(lowered, set.hedge);
    const hedgeDensity = hedges * per100;

    const nominalizations = countMatches(source, set.nominalization);
    const passives = countMatches(source, set.passive);
    const nominalizationDensity = (nominalizations + passives) * per100;

    const paragraphLengths = paragraphList.map(countWords);
    const paragraphCv = coefficientOfVariation(paragraphLengths);
    const itemLengths = items.map(countWords);
    const itemCv = coefficientOfVariation(itemLengths);

    const openerRepeat = repeatedOpeners(sentenceList, set.locale);
    const ngram = ngramRepetition(wordList, set.locale, 4);
    const abstract = countMatches(source, set.abstract);
    const abstractShare = wordList.length ? abstract / wordList.length : 0;
    const punctuation = punctuationMix(source);
    const inventory = punctuationInventory(source, sentenceList.length);
    const longSentences = longSentenceShare(sentenceLengths);
    const triads = triadShare(sentenceList);

    const claimSentences = sentenceList.filter((sentence) => set.claim.test(sentence));
    // Имена собственные здесь не считаются якорем: «KPIs» — это категория, а
    // «[Company Name]» вообще заглушка под заполнение. Утверждение делает
    // проверяемым количество, срок или источник, а не заглавная буква.
    const emptyClaimList = claimSentences.filter(
      (sentence) =>
        !guard || guard.extractAnchors(sentence).every((anchor) => anchor.type === "proper"),
    );
    const emptyClaims = sentenceList.length ? emptyClaimList.length / sentenceList.length : 0;

    const metrics = [
      {
        id: "anchorDensity",
        number: 1,
        label: "Плотность якорей",
        hint: "Числа, даты, единицы, версии, имена собственные на 100 слов.",
        value: anchorDensity,
        display: formatNumber(anchorDensity, 1),
        zone: zones.anchorDensity,
        zoneLabel: zoneLabel(zones.anchorDensity),
        direction: "band",
        status: evaluate(anchorDensity, zones.anchorDensity, "band"),
        evidence: guard ? guard.countByType(anchors) : {},
      },
      {
        id: "emptyClaims",
        number: 17,
        label: "Утверждения без якорей",
        hint: "Доля предложений, которые обещают пользу или дают оценку, но не содержат ни числа, ни даты, ни имени.",
        value: emptyClaims,
        display: formatPercent(emptyClaims),
        kind: "percent",
        zone: zones.emptyClaims,
        zoneLabel: zoneLabel(zones.emptyClaims, "percent"),
        direction: "down",
        status: evaluate(emptyClaims, zones.emptyClaims, "down"),
        evidence: { claims: claimSentences.length, empty: emptyClaimList.length, samples: emptyClaimList.slice(0, 3) },
      },
      {
        id: "sentenceCv",
        number: 2,
        label: "Разброс длин предложений",
        hint: "σ/μ. Ниже зоны — ровный машинный ритм, выше — рваный и нарочитый.",
        value: sentenceCv,
        display: formatNumber(sentenceCv),
        zone: zones.sentenceCv,
        zoneLabel: zoneLabel(zones.sentenceCv),
        direction: "band",
        status: evaluate(sentenceCv, zones.sentenceCv, "band"),
        evidence: { sentences: sentenceLengths.length, average: Math.round(mean(sentenceLengths)) },
      },
      {
        id: "shortPerParagraph",
        number: 3,
        label: "Короткие фразы",
        hint: "Предложений короче 6 слов на абзац. Ориентир — хотя бы одно на два абзаца.",
        value: shortPerParagraph,
        display: formatNumber(shortPerParagraph),
        zone: zones.shortPerParagraph,
        zoneLabel: zoneLabel(zones.shortPerParagraph),
        direction: "band",
        status: evaluate(shortPerParagraph, zones.shortPerParagraph, "band"),
        evidence: { short: shortSentences.length, share: formatPercent(shortShare) },
      },
      {
        id: "discourseShare",
        number: 4,
        label: "Дискурсивные зачины",
        hint: "Доля предложений, начатых связкой «кроме того», «таким образом».",
        value: discourseShare,
        display: formatPercent(discourseShare),
        kind: "percent",
        zone: zones.discourseShare,
        zoneLabel: zoneLabel(zones.discourseShare, "percent"),
        direction: "down",
        status: evaluate(discourseShare, zones.discourseShare, "down"),
        evidence: { markers: openers.slice(0, 6).map((item) => item.marker) },
      },
      {
        id: "hedgeDensity",
        number: 5,
        label: "Плотность хеджей",
        hint: "«Возможно», «как правило», «в целом» на 100 слов.",
        value: hedgeDensity,
        display: formatNumber(hedgeDensity, 1),
        zone: zones.hedgeDensity,
        zoneLabel: zoneLabel(zones.hedgeDensity),
        direction: "down",
        status: evaluate(hedgeDensity, zones.hedgeDensity, "down"),
        evidence: { hits: hedges },
      },
      {
        id: "nominalizationDensity",
        number: 6,
        label: "Номинализация и пассив",
        hint: "«Осуществляется оптимизация» вместо «мы оптимизировали», на 100 слов.",
        value: nominalizationDensity,
        display: formatNumber(nominalizationDensity, 1),
        zone: zones.nominalizationDensity,
        zoneLabel: zoneLabel(zones.nominalizationDensity),
        direction: "down",
        status: evaluate(nominalizationDensity, zones.nominalizationDensity, "down"),
        evidence: { nominalizations, passives },
      },
      {
        id: "paragraphCv",
        number: 7,
        label: "Разброс абзацев и пунктов",
        hint: "Три абзаца одной длины подряд — самый заметный машинный признак после ритма.",
        value: paragraphCv,
        display: formatNumber(paragraphCv),
        zone: zones.paragraphCv,
        zoneLabel: zoneLabel(zones.paragraphCv),
        direction: "band",
        status: evaluate(paragraphCv, zones.paragraphCv, "band"),
        evidence: {
          paragraphs: paragraphList.length,
          listItems: items.length,
          listCv: itemCv === null ? "—" : formatNumber(itemCv),
          evenList: itemCv !== null && items.length >= 3 && itemCv < 0.15,
        },
      },
      {
        id: "openerRepeat",
        number: 8,
        label: "Повтор зачинов",
        hint: "Доля предложений, начинающихся так же, как другое предложение.",
        value: openerRepeat.share,
        display: formatPercent(openerRepeat.share),
        kind: "percent",
        zone: zones.openerRepeat,
        zoneLabel: zoneLabel(zones.openerRepeat, "percent"),
        direction: "band",
        status: evaluate(openerRepeat.share, zones.openerRepeat, "band"),
        evidence: { samples: openerRepeat.samples },
      },
      {
        id: "ngramRepeat",
        number: 9,
        label: "Повтор лексики",
        hint: "Доля слов внутри повторяющихся четырёхсловных сочетаний.",
        value: ngram.share,
        display: formatPercent(ngram.share),
        kind: "percent",
        zone: zones.ngramRepeat,
        zoneLabel: zoneLabel(zones.ngramRepeat, "percent"),
        direction: "band",
        status: evaluate(ngram.share, zones.ngramRepeat, "band"),
        evidence: { samples: ngram.samples },
      },
      {
        id: "abstractShare",
        number: 10,
        label: "Абстрактные существительные",
        hint: "Доля слов на -ость, -ание, -ация, -tion, -ity среди всех слов.",
        value: abstractShare,
        display: formatPercent(abstractShare),
        kind: "percent",
        zone: zones.abstractShare,
        zoneLabel: zoneLabel(zones.abstractShare, "percent"),
        direction: "down",
        status: evaluate(abstractShare, zones.abstractShare, "down"),
        evidence: { hits: abstract },
      },
      {
        id: "dashShare",
        number: 29,
        label: "Доля тире в пунктуации",
        hint: "D29: не всё внутри предложения должно идти через длинное тире.",
        value: punctuation.dashShare,
        display: formatPercent(punctuation.dashShare),
        kind: "percent",
        zone: zones.dashShare,
        zoneLabel: zoneLabel(zones.dashShare, "percent"),
        direction: "down",
        status: evaluate(punctuation.dashShare, zones.dashShare, "down"),
        evidence: punctuation.counts,
      },
      {
        id: "punctInventory",
        number: 38,
        label: "Разнообразие пунктуации",
        hint: "Двоеточия, скобки, точки с запятой, кавычки на предложение. У машинного текста их ноль.",
        value: inventory.perSentence,
        display: formatNumber(inventory.perSentence, 2),
        zone: zones.punctInventory,
        zoneLabel: zoneLabel(zones.punctInventory),
        direction: "band",
        status: evaluate(inventory.perSentence, zones.punctInventory, "band"),
        evidence: inventory.counts,
      },
      {
        id: "longSentences",
        number: 39,
        label: "Длинные периоды",
        hint: "Доля предложений от 35 слов. Разброс длин их не требует, а живой текст их пишет.",
        value: longSentences.share,
        display: formatPercent(longSentences.share),
        kind: "percent",
        zone: zones.longSentences,
        zoneLabel: zoneLabel(zones.longSentences, "percent"),
        direction: "band",
        status: evaluate(longSentences.share, zones.longSentences, "band"),
        evidence: { longest: longSentences.longest, threshold: LONG_SENTENCE_WORDS },
      },
      {
        id: "triadShare",
        number: 40,
        label: "Перечисления из трёх",
        hint: "«X, Y и Z» в каждом предложении подряд — заметный след генерации в английском.",
        value: triads.share,
        display: formatPercent(triads.share),
        kind: "percent",
        zone: zones.triadShare,
        zoneLabel: zoneLabel(zones.triadShare, "percent"),
        direction: "down",
        status: evaluate(triads.share, zones.triadShare, "down"),
        evidence: { samples: triads.samples },
      },
    ];

    // Зоны измерены на фрагментах от четырёхсот слов. Применять их к тексту
    // в две фразы — не строгость, а ошибка категории: доля коротких фраз на
    // двух предложениях скачет от одной правки, и отчёт объявляет ухудшением
    // то, что им не является. Метрики, описывающие распределение, на коротком
    // материале честно молчат.
    const DISTRIBUTION_METRICS = new Set([
      "sentenceCv",
      "shortPerParagraph",
      "paragraphCv",
      "openerRepeat",
      "ngramRepeat",
      "punctInventory",
      "longSentences",
      "triadShare",
    ]);
    const enoughMaterial = wordList.length >= 120 && sentenceList.length >= 5;
    if (!enoughMaterial) {
      for (const metric of metrics) {
        if (DISTRIBUTION_METRICS.has(metric.id) && metric.status !== "unknown") {
          metric.status = "unknown";
          metric.note = "текста мало для этой метрики";
        }
      }
    }

    const overshoot = detectOvershoot(metrics, {
      shortShare,
      shortShareZone: zones.shortShare,
      sentenceCv,
      sentenceCvZone: zones.sentenceCv,
    });

    return {
      language,
      genreId: target.id,
      genreLabel: target.label,
      // Откалиброваны ли пороги на корпусе. Без этого зоны остаются мнением,
      // и отчёт обязан сказать об этом вслух: «выше зоны» на некалиброванном
      // пороге — повод посмотреть, а не приговор.
      calibrated: Boolean(calibration(target.id, language)),
      calibration: calibration(target.id, language),
      words: wordList.length,
      sentences: sentenceList.length,
      paragraphs: paragraphList.length,
      metrics,
      overshoot,
      counts: {
        // Неизмеримое не считается ни нормой, ни отклонением: иначе короткий
        // текст выглядит провальным просто потому, что метрикам не хватило
        // материала.
        unknown: metrics.filter((metric) => metric.status === "unknown").length,
        measurable: metrics.filter((metric) => metric.status !== "unknown").length,
        ok: metrics.filter((metric) => metric.status === "ok").length,
        off: metrics.filter((metric) => metric.status === "low" || metric.status === "high").length,
        overshoot: metrics.filter((metric) => metric.status === "overshoot").length,
      },
    };
  }

  /**
   * Гард 34. Перелёт — это не «метрика вышла за максимум», а «текст начал
   * кривляться»: рваный ритм, сплошные рубленые фразы. Такое возникает
   * ровно после чрезмерно усердной правки, поэтому проверяется отдельно и
   * говорится прямым текстом, а не оттенком плашки.
   */
  function detectOvershoot(metrics, extra) {
    const warnings = [];
    for (const metric of metrics) {
      const overshootAt = metric.zone && metric.zone.overshoot;
      if (overshootAt === undefined || metric.value === null || metric.value === undefined) continue;
      if (metric.value >= overshootAt) {
        warnings.push({
          id: metric.id,
          text: `${metric.label}: ${metric.display} при пороге кривляния ${
            metric.kind === "percent" ? `${Math.round(overshootAt * 100)}%` : formatNumber(overshootAt)
          }`,
        });
      }
    }
    if (extra.shortShareZone && extra.shortShare >= extra.shortShareZone.overshoot) {
      warnings.push({
        id: "shortShare",
        text: `Рубленых фраз ${formatPercent(extra.shortShare)} — текст начинает звучать как слоган`,
      });
    }
    return warnings;
  }

  /** Разница двух отчётов: что правки реально сдвинули (для истории версий). */
  function diff(before, after) {
    const byId = new Map(before.metrics.map((metric) => [metric.id, metric]));
    return after.metrics
      .map((metric) => {
        const previous = byId.get(metric.id);
        if (!previous || previous.value === null || metric.value === null) return null;
        const delta = metric.value - previous.value;
        if (Math.abs(delta) < 0.0001) return null;
        return {
          id: metric.id,
          label: metric.label,
          before: previous.display,
          after: metric.display,
          improved: metric.status === "ok" && previous.status !== "ok",
          worsened: metric.status !== "ok" && previous.status === "ok",
        };
      })
      .filter(Boolean);
  }

  return {
    analyze,
    applyCalibration,
    calibration,
    MIN_CALIBRATION_TEXTS,
    diff,
    genres,
    genre,
    defaultGenreId,
    detectLanguage,
    sentences,
    paragraphs,
    countWords,
    coefficientOfVariation,
    GENRES,
  };
});
