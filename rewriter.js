(function attachStructuralRewriter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.StructuralRewriter = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createStructuralRewriter() {
  "use strict";

  // Структурный переписчик: трогает то, до чего таблица оборотов в
  // paraphraser.js дотянуться не может — тире-коннекторы, ритм предложений и
  // антитезы. Вместе они дают 0.75 веса в HumanizerMetrics.scoreText, поэтому
  // без них оценка почти не двигалась, сколько бы раундов ни крутили.
  //
  // Правила только грамматические: ни одного случайного слова, ни одного
  // разрыва внутри слова. Смысл, числа и ссылки обязаны выжить — за этим
  // следит вызывающая сторона (humanizer-engine.js), сверяя якоря.

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const SENTENCE_SPLIT_RE = /(?<=[.!?…])\s+/u;
  const PROTECTED_RE = /https?:\/\/[^\s<>()]+|\[[^\]\n]{1,400}\]|«[^»\n]{0,1200}»|“[^”\n]{0,1200}”|"[^"\n]{0,1200}"|`[^`\n]+`/gu;
  // Полный числовой диапазон, а не одна цифра с каждой стороны: тире внутри
  // «2020—2030» — правильный набор и трогать его нельзя.
  const NUMERIC_RANGE_RE = /\d+(?:[.,]\d+)?\s*[—–-]\s*\d+(?:[.,]\d+)?/gu;
  const DASH_RE = /[—–]|(?<=\s)-(?=\s)/gu;
  const LIST_LINE_RE = /^\s*(?:[-*•▪◦—–]|\d+[.)])\s+/u;

  // Целевой коэффициент вариации длин предложений. Метрика обнуляет штраф
  // при cv >= 0.55; берём запас, чтобы правка типографики не вернула штраф.
  const TARGET_CV = 0.6;
  const MIN_SPLIT_WORDS = 4;
  const MAX_MERGE_WORDS = 45;

  const CLAUSE_STARTERS = {
    ru: ["он", "она", "оно", "они", "мы", "здесь", "там", "тогда", "этот", "эта", "эти", "такой", "такая", "такие"],
    en: ["it", "they", "this", "these", "we", "there", "such"],
  };

  // Связки, после которых разрыв на два предложения остаётся грамматичным.
  const SPLIT_CONNECTIVES = {
    ru: { "но": "Однако", "однако": "Однако", "поэтому": "Поэтому", "следовательно": "Следовательно", "а": "" },
    en: { "but": "However,", "yet": "However,", "so": "Therefore,", "and": "" },
  };

  // После точки с запятой первое слово опускается в нижний регистр только из
  // этого набора: имена собственные так не пострадают.
  const SAFE_LOWERCASE = {
    ru: ["это", "эти", "этот", "эта", "он", "она", "они", "там", "здесь", "такой", "такая", "такие", "при", "в", "для", "на", "однако", "поэтому", "следовательно"],
    en: ["it", "its", "they", "their", "this", "these", "there", "such", "the", "a", "an", "however", "therefore", "in", "for", "at", "on"],
  };

  // Признак личной формы глагола справа от тире. Если он есть, справа
  // самостоятельное предложение и запятая дала бы comma splice — нужна точка.
  // Если его нет и хвост короткий, это приложение и запятая корректна.
  // Во всех остальных случаях тире остаётся на месте: лишний штраф в оценке
  // дешевле, чем грамматическая ошибка в сдаваемой работе.
  const FINITE_MARKERS = {
    en: /\b(is|are|was|were|be|been|has|have|had|does|do|did|can|could|will|would|should|shall|may|might|must|shows?|showed|confirms?|confirmed|demonstrates?|demonstrated|provides?|provided|requires?|required|allows?|allowed|reduces?|reduced|increases?|increased|remains?|remained|indicates?|indicated|suggests?|suggested|enables?|enabled|produces?|produced|makes?|made|becomes?|became)\b/iu,
    ru: /(?<![\p{L}\p{N}_-])(?:\p{L}+(?:тся|ться)|явля(?:ется|ются)|показ(?:ал|ала|али|ывает|ывают)|позвол(?:яет|яют)|требу(?:ет|ют)|обеспечива(?:ет|ют)|содерж(?:ит|ат)|включа(?:ет|ют)|описыва(?:ет|ют)|определя(?:ет|ют)|использу(?:ет|ют)|получен[аыо]?|основан[аыо]?|был[аио]?|буд(?:ет|ут)|мо(?:жет|гут)|должн[аоы]?|имеет|имеют)(?![\p{L}\p{N}_-])/iu,
  };

  // Антитезы правятся только в связке: содержание половин не захватывается и
  // не переставляется. Перестановка «B, а не только A» ломала смысл, когда во
  // второй половине оказывалось придаточное, — здесь этого произойти не может.
  const ANTITHESIS = {
    en: [
      [/\bnot only ([^,.!?—]{2,60}?),?\s*but also\s+/giu, "both $1 and "],
      [/\bnot only ([^,.!?—]{2,60}?),\s*but\s+/giu, "both $1 and "],
      [/\bnot just ([^,.!?—]{2,60}?)[,—]\s*but\s+/giu, "$1, and also "],
      [/\bit is not merely\s+/giu, "it is more than "],
      [/\bnot ([^,.!?—]{2,40}?),\s*but rather\s+/giu, "rather than $1, "],
    ],
    ru: [
      [/\bне только ([^,.!?—]{2,60}?), но и\s+/giu, "и $1, и "],
      [/\bне просто ([^,.!?—]{2,60}?)[,—]\s*а\s+/giu, "$1, а также "],
    ],
  };

  /**
   * В JavaScript \b опирается на ASCII-класс \w, поэтому перед кириллицей он
   * не срабатывает и русские правила молча не применялись. Здесь границы
   * заменяются юникодными утверждениями — тем же приёмом, что в paraphraser.js.
   */
  function compileRules(rules) {
    return rules.map(([pattern, replacement]) => [
      new RegExp(
        pattern.source
          .replace(/^\\b/u, "(?<![\\p{L}\\p{N}_-])")
          .replace(/\\b$/u, "(?![\\p{L}\\p{N}_-])"),
        pattern.flags,
      ),
      replacement,
    ]);
  }

  const ANTITHESIS_RULES = { en: compileRules(ANTITHESIS.en), ru: compileRules(ANTITHESIS.ru) };

  function detectLanguage(text) {
    const cyrillic = (String(text).match(/\p{Script=Cyrillic}/gu) || []).length;
    const latin = (String(text).match(/\p{Script=Latin}/gu) || []).length;
    return cyrillic > latin ? "ru" : "en";
  }

  function countWords(text) {
    return (String(text).match(WORD_RE) || []).length;
  }

  function protect(text) {
    const values = [];
    const store = (value) => {
      const token = `\uE200${values.length}\uE201`;
      values.push(value);
      return token;
    };
    let out = String(text).replace(PROTECTED_RE, store);
    out = out.replace(NUMERIC_RANGE_RE, store);
    return {
      text: out,
      restore(value) {
        return String(value).replace(/\uE200(\d+)\uE201/gu, (_match, index) => values[Number(index)] || "");
      },
    };
  }

  function capitalize(text, locale) {
    return String(text).replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(locale));
  }

  function lowercaseFirst(text, locale) {
    return String(text).replace(/\p{L}/u, (letter) => letter.toLocaleLowerCase(locale));
  }

  function firstWord(text) {
    const match = String(text).match(/[\p{L}]+/u);
    return match ? match[0].toLocaleLowerCase("ru") : "";
  }

  function sentencesOf(line) {
    return String(line).split(SENTENCE_SPLIT_RE).filter((item) => item.length > 0);
  }

  /** Документ как чередование строк и разделителей: переносы обязаны выжить. */
  function toDocument(text) {
    return String(text || "").split(/(\n+)/u).map((part) => {
      if (/^\n+$/u.test(part)) return { separator: part };
      return { sentences: sentencesOf(part), list: LIST_LINE_RE.test(part) };
    });
  }

  function fromDocument(units) {
    return units.map((unit) => (unit.separator !== undefined ? unit.separator : unit.sentences.join(" "))).join("");
  }

  // --- Слой 1: тире-коннекторы ------------------------------------------

  function dashPositions(sentence) {
    const pattern = new RegExp(DASH_RE.source, DASH_RE.flags);
    const found = [];
    for (const match of sentence.matchAll(pattern)) found.push({ index: match.index, length: match[0].length });
    return found;
  }

  function copulaTail(tail, language) {
    const word = firstWord(tail);
    if (language === "ru") return word === "это";
    return word === "is" || word === "are" || word === "was" || word === "were";
  }

  function rewriteSentenceDashes(sentence, language, budget) {
    if (budget <= 0) return { text: sentence, used: 0 };
    if (LIST_LINE_RE.test(sentence)) return { text: sentence, used: 0 };
    const positions = dashPositions(sentence);
    if (!positions.length) return { text: sentence, used: 0 };

    // Парное тире вокруг вставки: обе половины заменяются запятыми — это
    // единственный случай, где можно снять сразу два вхождения.
    if (positions.length === 2) {
      const inner = sentence.slice(positions[0].index + positions[0].length, positions[1].index);
      const innerWords = countWords(inner);
      if (!inner.includes(",") && innerWords >= 1 && innerWords <= 12 && budget >= 2) {
        const head = sentence.slice(0, positions[0].index).replace(/\s+$/u, "");
        const tail = sentence.slice(positions[1].index + positions[1].length).replace(/^\s+/u, "");
        return { text: `${head}, ${inner.trim()}, ${tail}`, used: 2 };
      }
    }

    // Тире в предложении может быть несколько: берём первое, для которого
    // замена определяется уверенно, остальные не трогаем.
    for (const position of positions) {
      const head = sentence.slice(0, position.index).replace(/\s+$/u, "");
      const tail = sentence.slice(position.index + position.length).replace(/^\s+/u, "");
      if (!head || !tail) continue;
      if (copulaTail(tail, language)) continue;
      if (countWords(head) < 3) continue;

      const locale = language === "ru" ? "ru" : "en";
      const starter = firstWord(tail);
      const connectives = SPLIT_CONNECTIVES[language] || SPLIT_CONNECTIVES.en;
      const starters = CLAUSE_STARTERS[language] || CLAUSE_STARTERS.en;

      const cleanHead = head.replace(/[,;:]$/u, "");
      const tailWords = countWords(tail);

      // (1) Хвост открывается связкой: разрыв на два предложения заведомо верен.
      if (Object.prototype.hasOwnProperty.call(connectives, starter) && tailWords >= MIN_SPLIT_WORDS) {
        const replacement = connectives[starter];
        const rest = tail.slice(starter.length).replace(/^[\s,]+/u, "");
        const joined = replacement ? `${replacement} ${rest}` : capitalize(rest, locale);
        return { text: `${cleanHead}. ${joined}`, used: 1 };
      }

      // (2) Хвост открывается местоимением — значит, у него есть подлежащее.
      if (starters.includes(starter) && tailWords >= 3) {
        return { text: `${cleanHead}. ${capitalize(tail, locale)}`, used: 1 };
      }

      const finite = FINITE_MARKERS[language] || FINITE_MARKERS.en;

      // (3) В хвосте есть личная форма глагола: это самостоятельное
      // предложение, и запятая здесь дала бы comma splice.
      if (finite.test(tail) && tailWords >= MIN_SPLIT_WORDS) {
        return { text: `${cleanHead}. ${capitalize(tail, locale)}`, used: 1 };
      }

      // (4) Признаков клаузы нет, но хвост замыкает предложение. Запятая тут
      // недопустима — если справа всё-таки самостоятельное предложение, выйдет
      // comma splice. Скобки же грамматичны в обоих случаях: и вокруг
      // приложения, и вокруг целого предложения, — поэтому решать, что именно
      // справа, не требуется.
      const isLastDash = position === positions[positions.length - 1];
      const closing = tail.match(/[.!?…]["»”')\]]*$/u);
      if (isLastDash && closing && !/[()]/u.test(tail) && tailWords >= 2 && tailWords <= 20) {
        const body = tail.slice(0, tail.length - closing[0].length).replace(/[\s,;:]+$/u, "");
        if (body) return { text: `${cleanHead} (${body})${closing[0]}`, used: 1 };
      }

      // (5) Ни одного безопасного варианта — тире остаётся на месте.
      continue;
    }

    return { text: sentence, used: 0 };
  }

  function decomposeDashes(units, language) {
    const sentences = [];
    for (const unit of units) {
      if (unit.separator !== undefined) continue;
      for (const sentence of unit.sentences) sentences.push(sentence);
    }
    const joined = sentences.join(" ");
    const total = (joined.match(new RegExp(DASH_RE.source, DASH_RE.flags)) || []).length;
    const allowance = Math.max(1, Math.round(sentences.length / 5));
    let budget = total - allowance;
    if (budget <= 0) return 0;

    let used = 0;
    for (const unit of units) {
      if (unit.separator !== undefined || unit.list) continue;
      for (let index = 0; index < unit.sentences.length && budget > 0; index += 1) {
        let sentence = unit.sentences[index];
        // Одно предложение может нести несколько тире: снимаем их по одному,
        // пока в бюджете есть место.
        for (let guard = 0; guard < 4 && budget > 0; guard += 1) {
          const result = rewriteSentenceDashes(sentence, language, budget);
          if (!result.used) break;
          sentence = result.text;
          budget -= result.used;
          used += result.used;
        }
        // Разрыв мог породить второе предложение внутри одной ячейки —
        // возвращаем документ к инварианту «одна ячейка = одно предложение».
        const parts = sentencesOf(sentence);
        unit.sentences.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
    }
    return used;
  }

  // --- Слой 2: антитезы --------------------------------------------------

  function rewriteAntithesis(units, language) {
    const rules = ANTITHESIS_RULES[language] || ANTITHESIS_RULES.en;
    let used = 0;
    for (const unit of units) {
      if (unit.separator !== undefined) continue;
      for (let index = 0; index < unit.sentences.length; index += 1) {
        let sentence = unit.sentences[index];
        for (const [pattern, replacement] of rules) {
          const compiled = new RegExp(pattern.source, pattern.flags);
          sentence = sentence.replace(compiled, (...args) => {
            used += 1;
            return replacement.replace(/\$(\d)/gu, (_token, group) => args[Number(group)] || "");
          });
        }
        unit.sentences[index] = sentence;
      }
    }
    return used;
  }

  // --- Слой 3: ритм ------------------------------------------------------

  function coefficientOfVariation(lengths) {
    const values = lengths.filter((value) => value > 0);
    if (values.length < 3) return Number.POSITIVE_INFINITY;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean === 0) return Number.POSITIVE_INFINITY;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) / mean;
  }

  function splitCandidate(sentence, language) {
    const locale = language === "ru" ? "ru" : "en";
    const semicolon = sentence.indexOf("; ");
    if (semicolon > 0) {
      const head = sentence.slice(0, semicolon);
      const tail = sentence.slice(semicolon + 2);
      if (countWords(head) >= MIN_SPLIT_WORDS && countWords(tail) >= MIN_SPLIT_WORDS) {
        return [`${head}.`, capitalize(tail, locale)];
      }
    }
    const connectives = SPLIT_CONNECTIVES[language] || SPLIT_CONNECTIVES.en;
    const starters = CLAUSE_STARTERS[language] || CLAUSE_STARTERS.en;
    const pattern = new RegExp(`,\\s+(${Object.keys(connectives).join("|")})\\s+`, "iu");
    const match = sentence.match(pattern);
    if (match && match.index > 0) {
      const head = sentence.slice(0, match.index);
      const tail = sentence.slice(match.index + match[0].length);
      const nextWord = firstWord(tail);
      const clauseLike = starters.includes(nextWord) || /^[\p{Lu}]/u.test(tail);
      if (clauseLike && countWords(head) >= MIN_SPLIT_WORDS && countWords(tail) >= MIN_SPLIT_WORDS) {
        const replacement = connectives[match[1].toLocaleLowerCase(locale)];
        const joined = replacement ? `${replacement} ${lowercaseFirst(tail, locale)}` : capitalize(tail, locale);
        return [`${head}.`, joined];
      }
    }
    return null;
  }

  function mergeCandidate(first, second, language) {
    const locale = language === "ru" ? "ru" : "en";
    if (!/[.]["»”')\]]*$/u.test(first)) return null;
    if (countWords(first) + countWords(second) > MAX_MERGE_WORDS) return null;
    const safe = SAFE_LOWERCASE[language] || SAFE_LOWERCASE.en;
    if (!safe.includes(firstWord(second))) return null;
    const head = first.replace(/\.(["»”')\]]*)$/u, "$1");
    return `${head}; ${lowercaseFirst(second, locale)}`;
  }

  function collectSentenceRefs(units) {
    const refs = [];
    for (const unit of units) {
      if (unit.separator !== undefined || unit.list) continue;
      for (let index = 0; index < unit.sentences.length; index += 1) refs.push({ unit, index });
    }
    return refs;
  }

  function tuneRhythm(units, language) {
    let refs = collectSentenceRefs(units);
    if (refs.length < 3) return { splits: 0, merges: 0 };

    let lengths = refs.map((ref) => countWords(ref.unit.sentences[ref.index]));
    let cv = coefficientOfVariation(lengths);
    const maxOperations = Math.max(1, Math.round(refs.length * 0.4));
    let splits = 0;
    let merges = 0;

    for (let step = 0; step < maxOperations && cv < TARGET_CV; step += 1) {
      let best = null;

      for (let position = 0; position < refs.length; position += 1) {
        const ref = refs[position];
        const sentence = ref.unit.sentences[ref.index];
        const parts = splitCandidate(sentence, language);
        if (parts) {
          const next = lengths.slice();
          next.splice(position, 1, countWords(parts[0]), countWords(parts[1]));
          const score = coefficientOfVariation(next);
          if (!best || score > best.score) best = { score, kind: "split", position, parts };
        }
        // Слияние допустимо только внутри одной строки: иначе схлопнется абзац.
        const nextRef = refs[position + 1];
        if (nextRef && nextRef.unit === ref.unit && nextRef.index === ref.index + 1) {
          const merged = mergeCandidate(sentence, ref.unit.sentences[nextRef.index], language);
          if (merged) {
            const next = lengths.slice();
            next.splice(position, 2, countWords(merged));
            const score = coefficientOfVariation(next);
            if (!best || score > best.score) best = { score, kind: "merge", position, merged };
          }
        }
      }

      if (!best || best.score <= cv + 1e-6) break;

      const target = refs[best.position];
      if (best.kind === "split") {
        target.unit.sentences.splice(target.index, 1, best.parts[0], best.parts[1]);
        splits += 1;
      } else {
        target.unit.sentences.splice(target.index, 2, best.merged);
        merges += 1;
      }
      refs = collectSentenceRefs(units);
      lengths = refs.map((ref) => countWords(ref.unit.sentences[ref.index]));
      cv = coefficientOfVariation(lengths);
    }

    return { splits, merges };
  }

  // --- Точка входа -------------------------------------------------------

  // --- Слой 4: вариативность зачинов -------------------------------------
  //
  // Метрика A8 меряет долю предложений, начинающихся одинаково, но до сих пор
  // ни один слой не мог её сдвинуть: словарь меняет обороты, ритм — длину, а
  // порядок слов не трогал никто. Между тем одинаковый зачин у соседних
  // предложений — один из самых заметных следов генерации.
  //
  // Обе операции обратимы и безошибочны по грамматике:
  //   вынос в конец — обстоятельство с предлогом из закрытого списка уходит
  //     из начала в хвост; предлог теряет заглавную букву, а она у него была
  //     только от позиции, так что двусмысленности нет;
  //   вынос в начало — то же в обратную сторону, но здесь первое слово
  //     предложения приходится опустить в строчную, и это делается только
  //     при доказательстве: то же слово встречается в тексте со строчной.
  //     Иначе «Ozon увеличил выручку в 2024 году» стало бы «в 2024 году ozon».
  const FRONTABLE_HEADS = {
    ru: ["в", "во", "на", "за", "при", "по", "после", "перед", "до", "с", "со", "через", "среди", "около"],
    en: ["in", "on", "at", "by", "after", "before", "during", "within", "across", "through", "since"],
  };
  const ADVERBIAL_MIN_WORDS = 2;
  const ADVERBIAL_MAX_WORDS = 5;
  const OPENER_REST_MIN_WORDS = 4;

  function headWord(sentence) {
    const match = String(sentence).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/u);
    return match ? match[0] : "";
  }

  function openerSignature(sentence, language) {
    return headWord(sentence).toLocaleLowerCase(language === "ru" ? "ru" : "en");
  }

  // Где кончается обстоятельство, без морфологии не вычислить: жадный
  // квантификатор съедает сказуемое и «В 2024 году команда вывела продукт»
  // разбирается как обстоятельство «в 2024 году команда вывела». Поэтому
  // граница берётся только оттуда, где она размечена явно, — из запятой или
  // из закрытого списка существительных времени и этапа.
  const ADVERBIAL_NOUNS = {
    ru: ["году", "год", "года", "годах", "квартале", "квартал", "месяце", "месяц", "неделе",
         "период", "периоде", "течение", "ходе", "рамках", "результате", "начале", "конце", "середине"],
    en: ["year", "years", "quarter", "month", "months", "week", "weeks", "period",
         "phase", "stage", "beginning", "end", "middle", "course"],
  };

  /** Обстоятельство в начале предложения: до запятой либо до опорного слова. */
  function leadingAdverbial(sentence, language) {
    const heads = FRONTABLE_HEADS[language] || FRONTABLE_HEADS.en;
    const nouns = ADVERBIAL_NOUNS[language] || ADVERBIAL_NOUNS.en;
    const byComma = sentence.match(
      new RegExp(`^(?:${heads.join("|")})\\s+[^,;:—–]{2,50},\\s+(?=[\\p{L}])`, "iu"),
    );
    const byNoun = sentence.match(
      new RegExp(
        `^(?:${heads.join("|")})\\s+(?:[\\p{L}\\p{N}-]+\\s+){0,2}(?:${nouns.join("|")})(?![\\p{L}\\p{N}_-]),?\\s+(?=[\\p{L}])`,
        "iu",
      ),
    );
    const match = byComma || byNoun;
    if (!match) return null;
    const phrase = match[0].replace(/[\s,]+$/u, "");
    const rest = sentence.slice(match[0].length);
    if (countWords(rest) < OPENER_REST_MIN_WORDS) return null;
    if (/[;:—–(«"]/u.test(phrase)) return null;
    return { phrase, rest };
  }

  /** Обстоятельство в хвосте предложения перед знаком конца. */
  function trailingAdverbial(sentence, language) {
    const heads = FRONTABLE_HEADS[language] || FRONTABLE_HEADS.en;
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_-])(${heads.join("|")})\\s+((?:[\\p{L}\\p{N}-]+\\s+){${ADVERBIAL_MIN_WORDS - 2},${ADVERBIAL_MAX_WORDS - 2}}[\\p{L}\\p{N}-]+)\\s*([.!?…]["»”')\\]]?)$`,
      "iu",
    );
    const match = sentence.match(pattern);
    if (!match) return null;
    const head = sentence.slice(0, match.index).replace(/[\s,]+$/u, "");
    if (countWords(head) < OPENER_REST_MIN_WORDS) return null;
    if (/[,;:—–(«"]/u.test(match[0])) return null;
    return { phrase: `${match[1]} ${match[2]}`, head, terminator: match[3] };
  }

  function lowerFirst(text, locale) {
    return text.replace(/\p{L}/u, (letter) => letter.toLocaleLowerCase(locale));
  }

  function upperFirst(text, locale) {
    return text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(locale));
  }

  function varyOpeners(units, language) {
    const refs = collectSentenceRefs(units);
    if (refs.length < 2) return 0;
    const locale = language === "ru" ? "ru" : "en";

    // Доказательство, что слово можно опустить в строчную: оно уже встречается
    // в тексте со строчной буквы, значит это не имя собственное.
    const lowercased = new Set();
    for (const ref of refs) {
      for (const word of ref.unit.sentences[ref.index].match(/[\p{L}\p{N}'’-]+/gu) || []) {
        if (word[0] === word[0].toLocaleLowerCase(locale)) lowercased.add(word.toLocaleLowerCase(locale));
      }
    }

    let changed = 0;
    for (let position = 1; position < refs.length; position += 1) {
      const previous = refs[position - 1].unit.sentences[refs[position - 1].index];
      const ref = refs[position];
      const sentence = ref.unit.sentences[ref.index];
      if (openerSignature(sentence, language) !== openerSignature(previous, language)) continue;

      const leading = leadingAdverbial(sentence, language);
      if (leading) {
        const tail = leading.rest.replace(/([.!?…]["»”')\]]?)\s*$/u, "");
        const terminator = leading.rest.slice(tail.length);
        ref.unit.sentences[ref.index] =
          `${upperFirst(tail, locale)} ${lowerFirst(leading.phrase, locale)}${terminator}`;
        changed += 1;
        continue;
      }

      const trailing = trailingAdverbial(sentence, language);
      if (!trailing) continue;
      const opener = headWord(trailing.head).toLocaleLowerCase(locale);
      if (!lowercased.has(opener)) continue;
      const fronted = upperFirst(trailing.phrase, locale);
      const rest = lowerFirst(trailing.head, locale);
      ref.unit.sentences[ref.index] =
        language === "ru" ? `${fronted} ${rest}${trailing.terminator}` : `${fronted}, ${rest}${trailing.terminator}`;
      changed += 1;
    }
    return changed;
  }

  // --- Слой 5: неровные абзацы ------------------------------------------
  //
  // Перенесено из legacy/humanizer/layout.py — единственная содержательная
  // часть прежнего слоя обхода детекторов. Остальное там ломало слова
  // дефисами и подменяло служебные слова редкими, а вот эта функция делает
  // ровно то, чего не умеет ни один текущий слой: рвёт абзацы на куски
  // разной длины, не влезая внутрь предложения.
  //
  // Отличие от оригинала одно: там длина куска бралась из random с общим
  // сидом, то есть один и тот же текст давал разный результат от запуска к
  // запуску. Здесь сид выводится из самого текста — неровность сохраняется,
  // воспроизводимость появляется.
  const PARAGRAPH_MIN_WORDS = 55;
  const PARAGRAPH_MAX_WORDS = 90;
  // Ниже этого разброса абзацы читаются как нарезанные по линейке.
  const PARAGRAPH_TARGET_CV = 0.3;

  function seedFrom(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function makeRandom(seed) {
    let state = seed || 1;
    return function nextInRange(minimum, maximum) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return minimum + (state % (maximum - minimum + 1));
    };
  }

  function reflowParagraphs(text, options) {
    const settings = options || {};
    const minimum = settings.min || PARAGRAPH_MIN_WORDS;
    const maximum = settings.max || PARAGRAPH_MAX_WORDS;
    const source = String(text || "");
    const paragraphs = source.split(/\n[ \t]*\n+/u).map((item) => item.trim()).filter(Boolean);
    if (!paragraphs.length) return { text: source, created: 0 };

    // Ровный разброс — единственная причина трогать абзацы. Если автор уже
    // написал их разной длины, вмешательство только испортит структуру.
    const lengths = paragraphs.map(countWords);
    const spread = coefficientOfVariation(lengths);
    if (spread !== null && spread >= PARAGRAPH_TARGET_CV) return { text: source, created: 0 };

    const nextTarget = makeRandom(seedFrom(source));
    const result = [];
    let created = 0;

    for (const paragraph of paragraphs) {
      if (LIST_LINE_RE.test(paragraph) || paragraph.includes("\n") || countWords(paragraph) <= maximum) {
        result.push(paragraph);
        continue;
      }
      const sentences = sentencesOf(paragraph.replace(/\s+/gu, " ").trim());
      if (sentences.length <= 1) {
        result.push(paragraph);
        continue;
      }
      const blocks = [];
      let current = [];
      let currentWords = 0;
      let target = nextTarget(minimum, maximum);
      for (const sentence of sentences) {
        const words = countWords(sentence);
        if (current.length && currentWords >= minimum && currentWords + words > target) {
          blocks.push(current.join(" "));
          current = [];
          currentWords = 0;
          target = nextTarget(minimum, maximum);
        }
        current.push(sentence);
        currentWords += words;
      }
      if (current.length) {
        const tail = current.join(" ");
        // Хвост короче минимума прирастает к предыдущему куску, иначе в конце
        // раздела повисает огрызок в одну строку.
        if (blocks.length && currentWords < minimum) blocks[blocks.length - 1] += ` ${tail}`;
        else blocks.push(tail);
      }
      if (blocks.length > 1) created += blocks.length - 1;
      result.push(...blocks);
    }

    return { text: result.join("\n\n"), created };
  }

  function rewrite(input, options) {
    const settings = options || {};
    const source = String(input || "");
    if (!source.trim()) {
      return { text: source, actions: { dashes: 0, antithesis: 0, splits: 0, merges: 0, openers: 0, paragraphs: 0 } };
    }
    const language = settings.language || detectLanguage(source);
    const guard = protect(source);
    const units = toDocument(guard.text);

    const dashes = settings.dashes === false ? 0 : decomposeDashes(units, language);
    const antithesis = settings.antithesis === false ? 0 : rewriteAntithesis(units, language);
    const rhythm = settings.rhythm === false ? { splits: 0, merges: 0 } : tuneRhythm(units, language);
    const openers = settings.openers === false ? 0 : varyOpeners(units, language);

    const assembled = guard.restore(fromDocument(units));
    const paragraphs = settings.paragraphs === true ? reflowParagraphs(assembled) : { text: assembled, created: 0 };

    return {
      text: paragraphs.text,
      language,
      actions: { dashes, antithesis, splits: rhythm.splits, merges: rhythm.merges, openers, paragraphs: paragraphs.created },
    };
  }

  return { rewrite, varyOpeners, reflowParagraphs, detectLanguage, countWords, coefficientOfVariation, TARGET_CV };
});
