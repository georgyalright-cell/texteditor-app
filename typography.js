(function attachTypography(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Typography = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createTypography() {
  "use strict";

  // Типографика набора. Меняет только оформление знаков — слова, числа и
  // ссылки остаются прежними. Смысл в том, что машинный вывод почти всегда
  // печатает прямые кавычки, дефис вместо тире и три точки вместо
  // многоточия; набранный руками документ выглядит иначе.

  const URL_RE = /https?:\/\/[^\s<>()]+/giu;
  const NBSP = " ";

  // Единицы и сокращения, которые не должны отрываться от числа при переносе.
  const UNIT_AFTER_NUMBER =
    /(\d)\s+(млн|млрд|тыс|руб|коп|шт|ед|чел|кг|км|см|мм|га|мин|сек|м|ч|mln|bn|RUB|USD|EUR|CNY|km|kg|ha|pp|units|years|%|₽|\$|€|руб\.|коп\.|тыс\.|млн\.|млрд\.)(?![\p{L}])/gu;
  // Сокращения, которые не должны отрываться от следующего числа.
  const PREFIX_BEFORE_NUMBER = /(\bс\.|\bстр\.|\bрис\.|\bтабл\.|\bп\.|\bгл\.|№|§)\s+(\d)/gu;

  function protectUrls(text) {
    const values = [];
    const protectedText = text.replace(URL_RE, (match) => {
      const token = `${values.length}`;
      values.push(match);
      return token;
    });
    return {
      text: protectedText,
      restore(value) {
        return value.replace(/(\d+)/g, (_match, index) => values[Number(index)] || "");
      },
    };
  }

  function applyQuotes(text, stats, language) {
    // Пара кавычек заменяется целиком; одиночная не трогается, чтобы не
    // сломать код и обозначение дюймов. Форма зависит от языка: английский
    // академический текст набирается «фигурными», русский — ёлочками.
    const [open, close] = language === "ru" ? ["«", "»"] : ["\u201C", "\u201D"];
    let result = text.replace(/"([^"\n]{1,400})"/gu, (match, inner) => {
      stats.quotes += 1;
      return `${open}${inner}${close}`;
    });
    if (language !== "ru") {
      // Апостроф в английском тексте: don't, company's.
      result = result.replace(/(\p{L})'(\p{L})/gu, (match, before, after) => {
        stats.quotes += 1;
        return `${before}\u2019${after}`;
      });
    }
    return result;
  }

  function applyDashes(text, stats) {
    let result = text;
    // Дефис, использованный как тире между словами, заменяется на длинное
    // тире. Дефис внутри слова (какой-то, кто-либо) не трогается.
    result = result.replace(/(\S)\s+-\s+(\S)/gu, (match, before, after) => {
      stats.dashes += 1;
      return `${before} — ${after}`;
    });
    // Диапазон чисел набирается коротким тире без пробелов: 2026–2030.
    result = result.replace(/(\d)\s*[-—]\s*(\d)/gu, (match, from, to) => {
      stats.ranges += 1;
      return `${from}–${to}`;
    });
    return result;
  }

  function applyEllipsis(text, stats) {
    return text.replace(/\.{3}/gu, () => {
      stats.ellipsis += 1;
      return "…";
    });
  }

  function applyNonBreakingSpaces(text, stats) {
    let result = text.replace(UNIT_AFTER_NUMBER, (match, digit, unit) => {
      stats.nbsp += 1;
      return `${digit}${NBSP}${unit}`;
    });
    result = result.replace(PREFIX_BEFORE_NUMBER, (match, prefix, digit) => {
      stats.nbsp += 1;
      return `${prefix}${NBSP}${digit}`;
    });
    return result;
  }

  function detectLanguage(text) {
    const cyrillic = (String(text).match(/\p{Script=Cyrillic}/gu) || []).length;
    const latin = (String(text).match(/\p{Script=Latin}/gu) || []).length;
    return cyrillic > latin ? "ru" : "en";
  }

  function normalize(input, language) {
    const stats = { quotes: 0, dashes: 0, ranges: 0, ellipsis: 0, nbsp: 0 };
    const source = String(input || "");
    if (!source.trim()) return { text: "", stats, language: language || "en" };
    const resolved = language || detectLanguage(source);

    const urls = protectUrls(source);
    let text = urls.text;
    text = applyEllipsis(text, stats);
    text = applyQuotes(text, stats, resolved);
    text = applyDashes(text, stats);
    text = applyNonBreakingSpaces(text, stats);
    return { text: urls.restore(text), stats, language: resolved };
  }

  function changeCount(stats) {
    return stats.quotes + stats.dashes + stats.ranges + stats.ellipsis + stats.nbsp;
  }

  return { normalize, changeCount, detectLanguage, NBSP };
});
