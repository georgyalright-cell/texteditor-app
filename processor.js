(function attachTextProcessor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TextProcessor = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createTextProcessor() {
  "use strict";

  const INVISIBLE_CHARS = /[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/g;
  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const URL_RE = /https?:\/\/[^\s<>()]+/giu;
  const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
  const LIST_LINE_RE = /^(?:[-*•▪◦]|\d+[.)])\s+/;
  const TRANSITION_RE = /^(?:однако|при этом|кроме того|вместе с тем|следовательно|таким образом|итак|например|так(?:,|\s+как)|важно|особ(?:ое|ую|ая)|следующ|перв(?:ая|ое|ый)|наряду|с другой стороны|в то же время|наконец|несмотря|поскольку|благодаря|отдельно)\b/iu;

  function countWords(text) {
    return (text.match(WORD_RE) || []).length;
  }

  function replaceCounted(text, pattern, replacement, stats, field) {
    return text.replace(pattern, function countedReplacement() {
      const args = arguments;
      stats[field] += 1;
      return typeof replacement === "function"
        ? replacement.apply(null, args)
        : replacement.replace(/\$(\d+)/g, function expandCapture(_match, index) {
            return args[Number(index)] || "";
          });
    });
  }

  function protectUrls(text) {
    const values = [];
    const protectedText = text.replace(URL_RE, (match) => {
      const trailing = (match.match(/[.,!?;:]+$/) || [""])[0];
      const value = trailing ? match.slice(0, -trailing.length) : match;
      const token = `\uE000${values.length}\uE001`;
      values.push(value);
      return token + trailing;
    });
    return {
      text: protectedText,
      restore(value) {
        return value.replace(/\uE000(\d+)\uE001/g, (_match, index) => values[Number(index)] || "");
      },
    };
  }

  function normalizeArtifacts(input, stats) {
    const urls = protectUrls(String(input || ""));
    let text = urls.text.replace(/\r\n?/g, "\n");
    text = replaceCounted(text, INVISIBLE_CHARS, "", stats, "artifacts");
    text = replaceCounted(text, /(?:\\r\\n|\\rn|\/rn)/giu, "\n\n", stats, "artifacts");
    text = replaceCounted(text, /\bn\s+n(?=\s|[\p{L}])/giu, "\n\n", stats, "artifacts");
    text = replaceCounted(text, /\.\s+\.\s+\.(?:\s+\.)*/g, "…", stats, "punctuation");
    text = replaceCounted(text, /\.\s+\.(?=\s*[а-яё])/gu, ",", stats, "punctuation");
    text = replaceCounted(text, /\.\s+\./g, ".", stats, "punctuation");
    text = replaceCounted(text, /([!?])(?:\s*\1){1,}/g, "$1", stats, "punctuation");
    text = replaceCounted(text, /[ \t]+([,.;:!?])/g, "$1", stats, "spacing");
    text = replaceCounted(text, /([,;:!?])(?=[А-ЯЁа-яёA-Za-z])/g, "$1 ", stats, "spacing");
    text = replaceCounted(text, /([.!?…])(?=[А-ЯЁ])/g, "$1 ", stats, "spacing");
    text = replaceCounted(text, /[ \t]{2,}/g, " ", stats, "spacing");
    text = replaceCounted(text, /[ \t]+\n/g, "\n", stats, "spacing");
    text = replaceCounted(text, /\n[ \t]+/g, "\n", stats, "spacing");
    text = replaceCounted(text, /\n{3,}/g, "\n\n", stats, "spacing");
    text = replaceCounted(text, /-\n{1,2}(?=[а-яё])/gu, "-", stats, "joinedBreaks");

    // PDF and old generated output often place a blank line in the middle of
    // one unfinished sentence. Join only when the continuation starts lower-case.
    text = replaceCounted(
      text,
      /([^\s.!?…:])\n{2,}(?=[а-яё])/gu,
      "$1 ",
      stats,
      "joinedBreaks",
    );
    text = replaceCounted(
      text,
      /([^\s.!?…:])\n(?=[а-яё])/gu,
      "$1 ",
      stats,
      "joinedBreaks",
    );
    return urls.restore(text.trim());
  }

  function normalizeKey(text) {
    return text
      .toLocaleLowerCase("ru")
      .replace(/[\s\p{P}]+/gu, " ")
      .trim();
  }

  function sentenceSegments(text) {
    const urls = protectUrls(text);
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter("ru", { granularity: "sentence" });
      return Array.from(segmenter.segment(urls.text), (part) => urls.restore(part.segment.trim())).filter(Boolean);
    }
    return (urls.text.match(/.+?(?:[.!?…]+(?:["»”')\]]*)|$)(?=\s+|$)/gsu) || [])
      .map((item) => urls.restore(item.trim()))
      .filter(Boolean);
  }

  function isStructuralBlock(block) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return false;
    if (lines.some((line) => LIST_LINE_RE.test(line))) return true;
    if (lines.length > 1 && lines.every((line) => line.includes("\t"))) return true;
    if (lines.length === 1 && countWords(lines[0]) <= 12) {
      return lines[0].startsWith("#") || !/[.!?…]$/.test(lines[0]);
    }
    return false;
  }

  function deduplicateParagraphs(text, stats) {
    const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
    const result = [];
    let previous = "";
    for (const paragraph of paragraphs) {
      const key = normalizeKey(paragraph);
      if (key.length > 24 && key === previous) {
        stats.duplicates += 1;
        continue;
      }
      result.push(paragraph);
      previous = key;
    }
    return result.join("\n\n");
  }

  function deduplicateSentences(text, stats) {
    return text
      .split(/\n{2,}/)
      .map((paragraph) => {
        if (isStructuralBlock(paragraph)) return paragraph.trim();
        const output = [];
        let previous = "";
        for (const sentence of sentenceSegments(paragraph.replace(/\s+/g, " ").trim())) {
          const key = normalizeKey(sentence);
          if (key.length > 24 && key === previous) {
            stats.duplicates += 1;
            continue;
          }
          output.push(sentence);
          previous = key;
        }
        return output.join(" ");
      })
      .filter(Boolean)
      .join("\n\n");
  }

  function reflowParagraphs(text, stats) {
    const source = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
    const output = [];

    for (const paragraph of source) {
      if (isStructuralBlock(paragraph)) {
        output.push(paragraph);
        continue;
      }
      const flat = paragraph.replace(/\s+/g, " ").trim();
      const sentences = sentenceSegments(flat);
      if (sentences.length <= 1 || countWords(flat) <= 190) {
        output.push(flat);
        continue;
      }

      const blocks = [];
      let current = [];
      let currentWords = 0;
      for (const sentence of sentences) {
        const words = countWords(sentence);
        const semanticBoundary = currentWords >= 55 && TRANSITION_RE.test(sentence);
        const hardBoundary = currentWords >= 80 && currentWords + words > 170;
        if (current.length && (semanticBoundary || hardBoundary)) {
          blocks.push(current.join(" "));
          current = [];
          currentWords = 0;
        }
        current.push(sentence);
        currentWords += words;
      }
      if (current.length) {
        const tail = current.join(" ");
        if (blocks.length && currentWords < 35) blocks[blocks.length - 1] += ` ${tail}`;
        else blocks.push(tail);
      }
      if (blocks.length > 1) stats.paragraphsCreated += blocks.length - 1;
      output.push(...blocks);
    }
    return output.join("\n\n");
  }

  function anchorSet(text, pattern) {
    return new Set((text.match(pattern) || []).map((item) => item.toLocaleLowerCase("ru")));
  }

  function sameSet(left, right) {
    if (left.size !== right.size) return false;
    for (const item of left) if (!right.has(item)) return false;
    return true;
  }

  function checkIntegrity(source, result) {
    const issues = [];
    if (!result.trim()) issues.push("после обработки получился пустой текст");
    if (!sameSet(anchorSet(source, NUMBER_RE), anchorSet(result, NUMBER_RE))) {
      issues.push("изменились числа или даты");
    }
    if (!sameSet(anchorSet(source, URL_RE), anchorSet(result, URL_RE))) {
      issues.push("изменились ссылки");
    }
    return issues;
  }

  function processText(input) {
    const stats = {
      artifacts: 0,
      punctuation: 0,
      spacing: 0,
      joinedBreaks: 0,
      duplicates: 0,
      paragraphsCreated: 0,
    };
    const warnings = [];
    const normalized = normalizeArtifacts(input, stats);
    if (!normalized) {
      return { text: "", stats, warnings, inputChars: String(input || "").length, outputChars: 0 };
    }

    let result = deduplicateParagraphs(normalized, stats);
    result = deduplicateSentences(result, stats);
    result = reflowParagraphs(result, stats);
    result = normalizeArtifacts(result, stats);

    const integrityIssues = checkIntegrity(normalized, result);
    if (integrityIssues.length) {
      warnings.push(`Изменения отменены: ${integrityIssues.join(", ")}.`);
      result = normalized;
    }
    return {
      text: result,
      stats,
      warnings,
      inputChars: String(input || "").length,
      outputChars: result.length,
    };
  }

  return {
    countWords,
    normalizeArtifacts,
    processText,
    sentenceSegments,
  };
});
