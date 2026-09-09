(function attachAnchorGuard(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AnchorGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createAnchorGuard() {
  "use strict";

  // Гард 32 из плана: после каждого прохода сверяется, что в тексте не
  // появилось и не пропало ни одного якоря — числа, даты, единицы, версии,
  // ссылки, ссылки на источники и имена собственные. Тот же набор якорей
  // считает метрика A1 (плотность конкретики), поэтому извлечение живёт
  // в одном месте: иначе «мы измеряем одно, а защищаем другое».
  //
  // Правки инструмента только удаляют, дробят и переставляют текст, поэтому
  // любое расхождение по якорям — это ошибка правила, а не стилистический
  // выбор. Ответ на расхождение один: откат.

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const URL_RE = /https?:\/\/[^\s<>()]+|www\.[^\s<>()]+/giu;
  // Версии и номера сборок: 3.11.174, v1.2, ГОСТ Р 7.0.5-2008.
  const VERSION_RE = /\bv?\d+(?:\.\d+){1,4}\b/giu;
  const DATE_RE =
    /\b(?:\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\s+\d{4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}|\d{4}\s*(?:г\.|году|year)|Q[1-4]\s*\d{4})/giu;
  const NUMBER_RE = /\d+(?:[.,]\d+)?(?:\s*%)?/gu;
  // Единицы измерения и валюты — конкретика того же сорта, что и число.
  const UNIT_RE =
    /(?<=\d[\s ]?)(?:%|₽|\$|€|руб\.?|долл\.?|тыс\.?|млн|млрд|трлн|шт\.?|чел\.?|кг|г(?=\b)|т(?=\b)|км|мм|см|м(?=\b)|л(?=\b)|ч(?=\b)|мин|сек|дн(?:ей|я)?|мес(?:яц[ае]в?)?|лет|год[а]?|p\.?p\.?|bn|mn|k(?=\b)|kg|km|USD|EUR|RUB|GB|MB|pt|px)/giu;
  // Ссылки на источники: (Иванов, 1999) по ГОСТ Р 7.0.5-2008 и [12].
  const CITATION_RE = /\([^()\n]{2,80}?,\s*\d{4}[a-z]?\)|\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/gu;
  const SENTENCE_SPLIT_RE = /(?<=[.!?…])[\s ]+/u;

  // Слова, с которых предложение начинается сплошь и рядом: заглавная буква
  // здесь ничего не говорит об имени собственном.
  // \b считает границу слова по ASCII, поэтому кириллическую аббревиатуру
  // (НИУ, ВШЭ, ГОСТ) он не находит вовсе. Граница собирается из lookaround —
  // тот же обход, что в paraphraser.js.
  const ACRONYM_RE = /(?<![\p{L}\p{N}_-])\p{Lu}{2,}(?:-\p{Lu}\p{N}*)?(?![\p{L}\p{N}_-])/gu;
  const OPENER_STOP = new Set([
    "the", "a", "an", "this", "that", "these", "those", "it", "we", "they", "he", "she",
    "in", "on", "at", "for", "to", "by", "with", "as", "if", "when", "while", "however",
    "moreover", "furthermore", "therefore", "thus", "also", "but", "and", "such", "these",
    "и", "а", "но", "в", "во", "на", "по", "при", "для", "как", "что", "это", "этот", "эта",
    "эти", "тот", "та", "те", "он", "она", "они", "мы", "вы", "так", "таким", "кроме",
    "однако", "поэтому", "если", "когда", "чтобы", "после", "перед", "затем", "далее",
    "первый", "второй", "третий", "также", "более", "менее", "все", "всё", "весь",
  ]);

  function normalizeValue(value) {
    return String(value)
      .replace(/[\s ]+/g, " ")
      .replace(/[«»""'']/g, "")
      .trim()
      .toLocaleLowerCase("ru");
  }

  function collect(text, pattern, type, sink) {
    for (const match of String(text).matchAll(pattern)) {
      const value = normalizeValue(match[0]);
      if (value) sink.push({ type, value, index: match.index });
    }
  }

  function sentences(text) {
    return String(text || "")
      .split(SENTENCE_SPLIT_RE)
      .filter((item) => item.trim());
  }

  /**
   * Имена собственные без словаря и морфологии: слово с заглавной буквы не в
   * начале предложения, либо аббревиатура из заглавных. Слово, которое где-то
   * в тексте встречается со строчной, исключается — это обычная лексика,
   * поднятая началом строки или заголовком, а не имя.
   */
  function properNouns(text) {
    const source = String(text || "");
    const lowercased = new Set(
      (source.match(WORD_RE) || [])
        .filter((word) => word.length > 1 && word[0] === word[0].toLocaleLowerCase("ru"))
        .map((word) => word.toLocaleLowerCase("ru")),
    );
    const found = [];
    for (const acronym of source.match(ACRONYM_RE) || []) {
      found.push({ type: "proper", value: normalizeValue(acronym), index: source.indexOf(acronym) });
    }
    for (const sentence of sentences(source)) {
      const words = Array.from(sentence.matchAll(/[\p{L}][\p{L}\p{N}'’-]+/gu));
      for (let position = 1; position < words.length; position += 1) {
        const word = words[position][0];
        const first = word[0];
        if (first !== first.toLocaleUpperCase("ru")) continue;
        if (word === word.toLocaleUpperCase("ru")) continue; // уже посчитано как аббревиатура
        const key = word.toLocaleLowerCase("ru");
        if (OPENER_STOP.has(key) || lowercased.has(key)) continue;
        found.push({ type: "proper", value: key, index: source.indexOf(word) });
      }
    }
    return found;
  }

  function extractAnchors(text) {
    const source = String(text || "");
    const list = [];
    collect(source, URL_RE, "url", list);
    collect(source, CITATION_RE, "citation", list);
    collect(source, DATE_RE, "date", list);
    collect(source, VERSION_RE, "version", list);
    collect(source, NUMBER_RE, "number", list);
    collect(source, UNIT_RE, "unit", list);
    list.push(...properNouns(source));
    return list;
  }

  function countByType(anchors) {
    const counts = {};
    for (const anchor of anchors) counts[anchor.type] = (counts[anchor.type] || 0) + 1;
    return counts;
  }

  function multiset(anchors) {
    const map = new Map();
    for (const anchor of anchors) {
      const key = `${anchor.type}:${anchor.value}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  const GUARDED_TYPES = new Set(["url", "citation", "date", "version", "number", "unit"]);

  const TYPE_LABEL = {
    url: "ссылка",
    citation: "ссылка на источник",
    date: "дата",
    version: "версия",
    number: "число",
    unit: "единица измерения",
    proper: "имя собственное",
  };

  /**
   * Сверка двух версий текста. Пропажа якоря — всегда нарушение: правки
   * инструмента ничего не выбрасывают, кроме заведомо пустых оборотов.
   * Появление нового числа, даты или ссылки — тоже нарушение: сочинять
   * конкретику инструмент не имеет права.
   *
   * Имена собственные проверяются мягче: удаление вводного оборота может
   * сдвинуть слово в начало предложения, и эвристика перестанет считать его
   * именем. Такое расхождение попадает в notes, а не в нарушения.
   */
  function compare(source, candidate) {
    const before = multiset(extractAnchors(source));
    const after = multiset(extractAnchors(candidate));
    const lost = [];
    const added = [];
    const notes = [];
    // Literal reference integrity is independent of the calibrated A1 extractor.
    const references = globalThis.ReferenceGuard || (typeof require === "function" ? require("./reference-guard.js") : null);
    if (references && !references.compare(source, candidate)) lost.push({ type: "citation", value: "точное написание ссылок", count: 1 });

    for (const [key, count] of before) {
      const delta = count - (after.get(key) || 0);
      if (delta <= 0) continue;
      const [type, value] = splitKey(key);
      const entry = { type, value, count: delta };
      if (GUARDED_TYPES.has(type)) lost.push(entry);
      else notes.push(`${TYPE_LABEL[type] || type} «${value}» больше не распознаётся как имя собственное`);
    }
    for (const [key, count] of after) {
      const delta = count - (before.get(key) || 0);
      if (delta <= 0) continue;
      const [type, value] = splitKey(key);
      const entry = { type, value, count: delta };
      if (GUARDED_TYPES.has(type)) added.push(entry);
      else notes.push(`появилось имя собственное «${value}»`);
    }

    return { ok: lost.length === 0 && added.length === 0, lost, added, notes };
  }

  function splitKey(key) {
    const separator = key.indexOf(":");
    return [key.slice(0, separator), key.slice(separator + 1)];
  }

  function describe(result) {
    const parts = [];
    if (result.lost.length) {
      parts.push(`пропало: ${result.lost.map((item) => `${TYPE_LABEL[item.type]} «${item.value}»`).join(", ")}`);
    }
    if (result.added.length) {
      parts.push(`появилось: ${result.added.map((item) => `${TYPE_LABEL[item.type]} «${item.value}»`).join(", ")}`);
    }
    return parts.join("; ");
  }

  return {
    extractAnchors,
    properNouns,
    countByType,
    compare,
    describe,
    sentences,
    TYPE_LABEL,
  };
});
