(function attachDeepRevision(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DeepRevision = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createDeepRevision() {
  "use strict";

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const DEFAULT_SHARE = 0.35;
  const DEFAULT_LIMIT = 12;
  const CONTENT_STOPWORDS = {
    ru: new Set([
      "также", "который", "которая", "которое", "которые", "которого", "которой", "которым", "которыми", "которых",
      "этот", "эта", "это", "эти", "того", "тому", "тем", "тех", "данный", "данная", "данное", "данные",
    ]),
    en: new Set(["also", "which", "that", "these", "those", "this", "whose", "where"]),
  };

  function wordTokens(text, language) {
    const locale = language === "ru" ? "ru" : "en";
    return (String(text || "").match(WORD_RE) || []).map((word) => word.toLocaleLowerCase(locale));
  }

  /** LCS учитывает и замену слов, и перестановку частей предложения. */
  function lexicalNovelty(source, candidate, language) {
    const left = wordTokens(source, language);
    const right = wordTokens(candidate, language);
    if (!left.length || !right.length) return 0;
    let previous = new Uint16Array(right.length + 1);
    for (const token of left) {
      const current = new Uint16Array(right.length + 1);
      for (let index = 1; index <= right.length; index += 1) {
        current[index] = token === right[index - 1]
          ? previous[index - 1] + 1
          : Math.max(previous[index], current[index - 1]);
      }
      previous = current;
    }
    return Math.max(0, Math.min(1, 1 - (2 * previous[right.length]) / (left.length + right.length)));
  }

  function contentStem(token, language) {
    if (language === "en") {
      return token.replace(/(?:ing|ied|ed|es|s)$/u, (ending) => ending === "ied" ? "y" : "");
    }
    return token.replace(
      /(?:иями|ями|ами|ого|ему|ому|ыми|ими|ее|ие|ые|ое|ей|ий|ый|ой|ем|им|ым|ом|их|ых|ую|юю|ая|яя|ою|ею|ают|яют|уют|ет|ёт|ит|ут|ют|ат|ят|ла|ли|ло|ть|ться|ся|ов|ев|ами|ями|ах|ях|ам|ям|ом|ем|ы|и|а|я|у|ю|е|о)$/u,
      "",
    );
  }

  /**
   * Сравнение по простым основам допускает падеж и число, но отсекает новый
   * глагол, синоним вместо термина и правдоподобную опечатку.
   */
  function stableVocabulary(source, candidate, language) {
    const vocabulary = (text) => {
      const counts = new Map();
      for (const token of wordTokens(text, language)) {
        if (token.length < 5 || CONTENT_STOPWORDS[language].has(token)) continue;
        const stem = contentStem(token, language);
        counts.set(stem, (counts.get(stem) || 0) + 1);
      }
      return counts;
    };
    const before = vocabulary(source);
    const after = vocabulary(candidate);
    if (before.size !== after.size) return false;
    for (const [token, count] of before) {
      if (after.get(token) !== count) return false;
    }
    return true;
  }

  function startsWithNewFiniteVerb(source, candidate, language) {
    if (language !== "ru") return false;
    const sourceFirst = wordTokens(source, language)[0] || "";
    const candidateFirst = wordTokens(candidate, language)[0] || "";
    const finiteVerb = /(?:ает|яет|ует|ирует|ывает|ивает|ет|ёт|ит|ут|ют|ат|ят|лся|лась|лись)$/u;
    return candidateFirst !== sourceFirst && finiteVerb.test(candidateFirst);
  }

  /** Профиль отделяет настоящую перестройку от косметики и смыслового дрейфа. */
  function candidateProfile(source, candidate, options) {
    const settings = options || {};
    const language = settings.language === "en" ? "en" : "ru";
    const sourceWords = wordTokens(source, language).length;
    const candidateWords = wordTokens(candidate, language).length;
    const lengthRatio = sourceWords ? candidateWords / sourceWords : 0;
    const novelty = lexicalNovelty(source, candidate, language);
    const sameLanguage = !settings.detectLanguage || candidateWords < 4 || settings.detectLanguage(candidate) === language;
    const sentenceCount = Number(settings.sentenceCount) || 0;
    const stable = stableVocabulary(source, candidate, language);
    const naturalOpening = !startsWithNewFiniteVerb(source, candidate, language);
    // New lexical proposals are edits, not summaries/expansions. Keep the old
    // structural path unchanged; similarity alone can miss an omitted clause.
    const lexicalEdit = settings.semanticVerified === true && lengthRatio >= 0.85 && lengthRatio <= 1.15;
    const safe = lengthRatio >= 0.68 && lengthRatio <= 1.38 && novelty >= 0.24 && novelty <= 0.74 &&
      sameLanguage && (stable || lexicalEdit) && naturalOpening && sentenceCount > 0 && sentenceCount <= 2;
    return {
      safe,
      novelty,
      lengthRatio,
      sameLanguage,
      stableVocabulary: stable,
      naturalOpening,
      sentenceCount,
    };
  }

  function upperFirst(value, language) {
    const text = String(value || "");
    return text ? text[0].toLocaleUpperCase(language === "ru" ? "ru" : "en") + text.slice(1) : text;
  }

  function lowerFirstCommon(value, language) {
    const text = String(value || "");
    if (!text || /^[A-ZА-ЯЁ]{2}/u.test(text)) return text;
    if (language === "en" && !/^(?:The|A|An|This|These|That|Those|It|We|They|Our|Their|Your)\b/u.test(text)) return text;
    return text[0].toLocaleLowerCase(language === "ru" ? "ru" : "en") + text.slice(1);
  }

  /** Меняет порядок существующих частей, но не смысловую лексику. */
  function syntacticReorderVariants(sentence, language) {
    const source = String(sentence || "").trim();
    const punctuation = (source.match(/[.!?…]+$/u) || [""])[0];
    const body = punctuation ? source.slice(0, -punctuation.length).trim() : source;
    if (!body || /[;:|\t]/u.test(body)) return [];
    const variants = [];
    const seen = new Set([source]);
    const push = (value) => {
      const text = String(value || "").replace(/\s+/gu, " ").trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      variants.push(text);
    };

    const conjunction = language === "ru" ? /\s+и\s+/u : /\s+and\s+/iu;
    const verbPattern = language === "ru"
      ? /(?:^|\s)([а-яё-]+(?:ает|яет|ует|ирует|ывает|ивает|ет|ёт|ит|ут|ют|ат|ят))(?=\s|$|[,.!?])/iu
      : /(?:^|\s)((?:is|are|has|have|helps?|supports?|provides?|creates?|improves?|increases?|reduces?|enables?|allows?|uses?|builds?|keeps?|makes?))(?=\s|$|[,.!?])/iu;
    const findVerb = (text) => {
      const match = verbPattern.exec(text);
      if (!match) return null;
      return { word: match[1], index: match.index + match[0].indexOf(match[1]) };
    };
    const verb = findVerb(body);
    if (verb && verb.index > 1) {
      const subject = body.slice(0, verb.index).trim();
      const tail = body.slice(verb.index + verb.word.length).trim();
      const parts = tail.split(conjunction);
      if (parts.length === 2 && wordTokens(parts[0], language).length >= 2 && wordTokens(parts[1], language).length >= 2) {
        const secondVerb = findVerb(parts[1].trim());
        const connector = language === "ru" ? " и " : " and ";
        // A coordinator inside a modifier is not a pair of direct objects:
        // "reduce costs by reviewing contracts and improving purchasing".
        const nestedModifier = language === "en" && /\b(?:by|through|with|without|during|within|in|on|at|for|from|of|to)\b/iu.test(parts[0]);
        if (nestedModifier) {
          // Keep the entire modifier together; no guessed attachment tree.
        } else if (secondVerb && secondVerb.index === 0) {
          push(`${subject} ${parts[1].trim()}${connector}${verb.word} ${parts[0].trim()}${punctuation}`);
        } else {
          push(`${subject} ${verb.word} ${parts[1].trim()}${connector}${parts[0].trim()}${punctuation}`);
        }
      }
    }

    // An explicit manner clause can move as a whole, including its own "and".
    if (language === "en" && verb && !body.includes(",")) {
      const clauses = [...body.matchAll(/\s+by\s+[a-z]+ing\b/giu)];
      if (clauses.length === 1 && clauses[0].index > verb.index) {
        const prefix = body.slice(0, clauses[0].index).trim();
        const manner = body.slice(clauses[0].index).trim();
        // Positive, deliberately small object grammar: "losses caused by
        // rising costs" must NOT become "By rising costs, ... losses caused".
        const object = body.slice(verb.index + verb.word.length, clauses[0].index).trim();
        const simpleObject = /^(?:(?:the|its|their)\s+)?(?:(?:operating|operational|production|administrative|overall|total|customer|employee)\s+){0,2}(?:costs|losses|delays|efficiency|sales|revenue|productivity|retention|profits)$/iu.test(object);
        if (wordTokens(prefix, language).length >= 4 && wordTokens(manner, language).length >= 3 &&
            simpleObject && !/\b(?:who|which|that|because|when|if|where)\b/iu.test(prefix)) {
          push(`${upperFirst(manner, language)}, ${lowerFirstCommon(prefix, language)}${punctuation}`);
        }
      }
    }

    const prepositions = language === "ru"
      ? /\s+(?:в|во|на|при|для|по|с|со|из|за|благодаря)\s+(?=[а-яё])/giu
      : /\s+(?:in|on|at|for|with|from|through|during|within)\s+(?=[a-z])/giu;
    let terminal = null;
    for (const match of body.matchAll(prepositions)) {
      if (match.index > body.length * 0.42) terminal = match;
    }
    if (terminal) {
      const prefix = body.slice(0, terminal.index).trim();
      let phrase = body.slice(terminal.index).trim();
      if (language === "ru" && /^в\s+достижении(?=\s|$)/iu.test(phrase)) {
        phrase = phrase.replace(/^в\s+достижении(?=\s|$)/iu, "Для достижения");
      }
      // Do not detach the tail of a nested phrase: "by aligning goals with
      // forecasts" is not "with forecasts, ... by aligning goals". We have no
      // dependency parser, so ambiguous English preposition chains stay intact.
      const nestedPhrase = language === "en" && /\b(?:by|through|with|without|during|within|in|on|at|for|from|of|to)\b/iu.test(prefix);
      if (!nestedPhrase && wordTokens(prefix, language).length >= 3 && wordTokens(phrase, language).length >= 3) {
        push(`${upperFirst(phrase, language)} ${lowerFirstCommon(prefix, language)}${punctuation}`);
      }
    }
    return variants;
  }

  function deepSpotsOf(source, spans, weakSpots, settings, language) {
    const ranked = weakSpots.rank(source, { language });
    const byIndex = new Map(ranked.map((spot) => [spot.index, spot]));
    const eligible = spans
      .map((span, index) => ({
        index,
        span,
        spot: byIndex.get(index) || { index, text: span.text, score: 0, reasons: [] },
      }))
      .filter((item) => {
        const text = String(item.span && item.span.text || "").trim();
        const words = wordTokens(text, language).length;
        return words >= 6 && words <= 80 && !/[\t|]/u.test(text) &&
          (settings.contextual === true && typeof settings.generate === "function" || syntacticReorderVariants(text, language).length > 0);
      });
    if (!eligible.length) return [];

    const share = Math.max(0.15, Math.min(Number(settings.share) || DEFAULT_SHARE, 0.6));
    const limit = Math.max(1, Math.min(Number(settings.limit) || DEFAULT_LIMIT, DEFAULT_LIMIT));
    const desired = Math.max(1, Math.min(limit, eligible.length, Math.ceil(spans.length * share)));
    const positives = eligible
      .filter((item) => item.spot.score > 0)
      .sort((left, right) => right.spot.score - left.spot.score || left.index - right.index);
    const selected = [];
    const selectedIndexes = new Set();
    const weakQuota = positives.length ? Math.min(positives.length, Math.max(1, Math.floor(desired * 0.6))) : 0;

    for (const item of positives.slice(0, weakQuota)) {
      selected.push(item);
      selectedIndexes.add(item.index);
    }
    while (selected.length < desired) {
      const remaining = eligible.filter((item) => !selectedIndexes.has(item.index));
      if (!remaining.length) break;
      const slot = selected.length - weakQuota;
      const slotsLeft = desired - weakQuota;
      const wantedIndex = Math.min(
        eligible.length - 1,
        Math.floor(((slot + 0.5) * eligible.length) / Math.max(1, slotsLeft)),
      );
      const wanted = eligible[wantedIndex].index;
      remaining.sort((left, right) => Math.abs(left.index - wanted) - Math.abs(right.index - wanted));
      selected.push(remaining[0]);
      selectedIndexes.add(remaining[0].index);
    }

    return selected
      .sort((left, right) => left.index - right.index)
      .map((item) => Object.assign({}, item.spot, {
        index: item.index,
        text: item.span.text,
        reasons: item.spot.reasons.length ? item.spot.reasons : ["обновление синтаксиса"],
      }));
  }

  return {
    DEFAULT_LIMIT,
    wordTokens,
    lexicalNovelty,
    stableVocabulary,
    candidateProfile,
    syntacticReorderVariants,
    deepSpotsOf,
  };
});
