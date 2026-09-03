(function attachEditPasses(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EditPasses = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createEditPasses() {
  "use strict";

  // Блок C плана — композиционные правки. Отличие от остального пайплайна:
  // пасс ничего не применяет сам. Он возвращает спаны «было → стало» с
  // причиной (гард 33), а решение принимает автор поштучно. «Вот новая
  // версия» здесь запрещено: сокращение и ритм — это выбор, а не
  // исправление опечатки.
  //
  // Три вида результата:
  //   edits  — безопасные правки: удаления, дробление по сочинительной связи
  //            и подстановки из закрытого словаря, не трогающие падежи;
  //   manual — найденные места, которые правит автор: замена требует
  //            согласования, а морфологического разбора здесь нет;
  //   hints  — методы, для которых нужен предмет, а не текст.

  const EDGE_LEFT = "(?<![\\p{L}\\p{N}_-])";
  const EDGE_RIGHT = "(?![\\p{L}\\p{N}_-])";
  const WORD_RE = /[\p{L}\p{N}-]+/gu;
  const SPACE = "[\\s\\u00a0]";

  function loadAnchorGuard() {
    if (typeof globalThis !== "undefined" && globalThis.AnchorGuard) return globalThis.AnchorGuard;
    if (typeof require === "function") return require("./anchor-guard.js");
    return null;
  }

  function rule(body, flags) {
    return new RegExp(body, flags || "iu");
  }

  // ─── 18. Пасс сокращения: только удаления ──────────────────────────────
  const LEAD_FILLER_RU = [
    [rule(`^(?:отмет|замет)(?:им|ьте), что${SPACE}+`), "вводный оборот без содержания", "high"],
    [rule(`^подчеркн[её]м, что${SPACE}+`), "вводный оборот без содержания", "high"],
    [rule(`^(?:стоит|следует|необходимо|важно|нужно)${SPACE}+(?:отметить|подчеркнуть|сказать|заметить|понимать|иметь в виду),?${SPACE}+что${SPACE}+`), "вводный оборот без содержания", "high"],
    [rule(`^как (?:известно|показывает практика|уже (?:было )?сказано|уже отмечалось),${SPACE}+`), "апелляция к общему знанию вместо источника", "high"],
    [rule(`^(?:в целом|в принципе|по сути|по существу|фактически|собственно говоря),${SPACE}+`), "пустой вводный оборот", "high"],
    [rule(`^(?:безусловно|несомненно|очевидно|разумеется|конечно),${SPACE}+`), "утверждение о самоочевидности", "high"],
    [rule(`^(?:как правило|скорее всего|по-видимому|по видимому|зачастую|вероятно|возможно),${SPACE}+`), "хедж: утверждение снимает с себя ответственность", "high"],
    [rule(`^(?:принято считать|можно предположить|представляется), что${SPACE}+`), "хедж без источника", "high"],
    [rule(`^(?:иными словами|другими словами),${SPACE}+`), "пересказ предыдущего предложения", "medium"],
    [rule(`^в современном мире,?${SPACE}+`), "штамп из стоп-листа D28", "high"],
    [rule(`^в наши дни,?${SPACE}+`), "штамп из стоп-листа D28", "high"],
  ];

  const LEAD_FILLER_EN = [
    [rule(`^it (?:is|'s) (?:important|worth|crucial|essential|necessary) to (?:note|mention|highlight|emphasise|emphasize)(?: that)?,?${SPACE}+`), "вводный оборот без содержания", "high"],
    [rule(`^it should be (?:noted|mentioned|emphasised|emphasized)(?: that)?,?${SPACE}+`), "вводный оборот без содержания", "high"],
    [rule(`^(?:notably|importantly|clearly|obviously|of course|in general|overall|essentially|basically|in essence),${SPACE}+`), "пустой вводный оборот", "high"],
    [rule(`^(?:in other words|that is to say|put simply),${SPACE}+`), "пересказ предыдущего предложения", "medium"],
    [rule(`^(?:generally|typically|arguably|presumably|probably|possibly),${SPACE}+`), "хедж: утверждение снимает с себя ответственность", "high"],
    [rule(`^in today['’]s (?:world|fast-paced world|society),?${SPACE}+`), "штамп из стоп-листа D28", "high"],
    [rule(`^(?:in conclusion|in summary|to summarise|to summarize|to conclude),${SPACE}+`), "итоговая связка без содержания", "high"],
  ];

  // Предложения о самом тексте, а не о предмете.
  const META_SENTENCE_RU = rule(`^в (?:данн(?:ом|ой)|эт(?:ом|ой)|настоящ(?:ем|ей))${SPACE}+(?:раздел[еа]|глав[еы]|параграфе|пункте|работе|части)`);
  const META_SENTENCE_EN = rule(`^(?:this|the following|the present)${SPACE}+(?:section|chapter|paragraph|subsection|part)${SPACE}+(?:discusses|describes|presents|examines|outlines|provides|will)`);

  const INTENSIFIERS = {
    ru: [
      [["поистине", "своего рода", "в известном смысле", "в некотором роде"], "high"],
      [["весьма", "крайне", "достаточно", "довольно", "очень"], "medium"],
    ],
    en: [
      [["really", "actually", "basically", "essentially", "literally"], "high"],
      [["very", "quite", "rather", "somewhat"], "medium"],
    ],
  };

  // ─── 21. Снятие явных связок ───────────────────────────────────────────
  //
  // Противительная связка несёт логику: снятие «однако» меняет смысл, а не
  // только ритм. Такие правки никогда не приняты по умолчанию.
  const CONNECTIVES_RU = [
    ["кроме того", "high"], ["более того", "high"], ["таким образом", "high"],
    ["следовательно", "high"], ["в связи с этим", "high"], ["при этом", "high"],
    ["в результате", "high"], ["соответственно", "high"], ["в частности", "high"],
    ["итак", "high"], ["также", "high"], ["в свою очередь", "high"],
    ["вместе с тем", "medium"], ["в то же время", "medium"], ["наконец", "medium"],
    ["однако", "medium"], ["тем не менее", "medium"], ["поэтому", "medium"],
    // Те же обороты, в которые словарь превращает связки выше.
    ["наряду с этим", "high"], ["помимо этого", "high"], ["к тому же", "high"], ["в итоге", "high"],
  ];
  const CONNECTIVES_EN = [
    ["moreover", "high"], ["furthermore", "high"], ["additionally", "high"],
    ["in addition", "high"], ["therefore", "high"], ["thus", "high"],
    ["consequently", "high"], ["as a result", "high"], ["in particular", "high"],
    ["also", "high"], ["finally", "medium"], ["however", "medium"],
    ["nevertheless", "medium"], ["nonetheless", "medium"], ["that said", "medium"],
  ];

  // ─── 19. Ритмический пасс ──────────────────────────────────────────────
  //
  // Только сочинительная связь: дробить придаточное («, что …») без разбора
  // структуры нельзя — вместо предложения получится обрубок.
  const SPLIT_POINTS_RU = [", и ", ", а ", ", но ", ", однако ", ", поэтому ", ", при этом ", "; "];
  const SPLIT_POINTS_EN = [", and ", ", but ", ", so ", ", yet ", "; "];
  const SPLIT_MIN_WORDS = 30;
  const SPLIT_MIN_PART = 5;

  // ─── 22. Разноминализация ──────────────────────────────────────────────
  //
  // В словарь попадают только обороты, после замены которых зависимые слова
  // остаются в том же падеже. «Наблюдается рост выручки» → «растёт выручки»
  // — вот цена автоматической разноминализации без морфологии, поэтому
  // такие случаи уходят в manual, а не в edits.
  const DENOMINALIZATION_RU = [
    ["оказывает влияние на", "влияет на"],
    ["оказывают влияние на", "влияют на"],
    ["имеет возможность", "может"],
    ["имеют возможность", "могут"],
    ["не представляется возможным", "невозможно"],
    ["принимает участие в", "участвует в"],
    ["принимают участие в", "участвуют в"],
    ["было принято решение", "решили"],
    ["в результате чего", "поэтому"],
    ["путём использования", "с помощью"],
    ["при условии, что", "если"],
    ["в целях", "для"],
    // Добавления держатся того же правила: зависимые слова остаются в том же
    // падеже. «Проводит анализ рынка» сюда не попадает — «анализирует рынка»
    // требует винительного вместо родительного, и это работа автора.
    ["оказывает воздействие на", "воздействует на"],
    ["оказывают воздействие на", "воздействуют на"],
    ["имеет отношение к", "относится к"],
    ["находится в зависимости от", "зависит от"],
    ["даёт возможность", "позволяет"],
    ["дает возможность", "позволяет"],
    ["дают возможность", "позволяют"],
    ["имеется возможность", "можно"],
    ["в состоянии", "может"],
    ["по причине того, что", "потому что"],
    ["на основании того, что", "потому что"],
    ["в том случае, если", "если"],
    ["в том числе и", "в том числе"],
  ];
  const DENOMINALIZATION_EN = [
    ["makes a contribution to", "contributes to"],
    ["provides an explanation of", "explains"],
    ["gives an indication of", "indicates"],
    ["performs an assessment of", "assesses"],
    ["carries out an analysis of", "analyses"],
    ["has an impact on", "affects"],
    ["is indicative of", "indicates"],
    ["is in compliance with", "complies with"],
    ["makes use of", "uses"],
    ["is dependent on", "depends on"],
    ["is reflective of", "reflects"],
    ["puts emphasis on", "emphasises"],
    ["conducts a review of", "reviews"],
    ["is supportive of", "supports"],
    ["has the capability to", "can"],
    ["in the absence of", "without"],
  ];

  // Места, где номинализацию видно, но замена требует согласования падежей.
  // Показываются автору с готовой подсказкой — правит он.
  const MANUAL_NOMINALIZATION_RU = [
    [new RegExp(`${EDGE_LEFT}(осуществляется|осуществляются|производится|производятся|проводится|проводятся|происходит|происходят|наблюдается|наблюдаются|ведётся|ведется)${SPACE}+(?:\\p{L}{4,}(?:ание|ение|ация|изация|ирование)|рост|роста|снижение|увеличение|падение|прирост)${EDGE_RIGHT}`, "giu"),
      "разверните в глагол и поставьте подлежащее в именительный: «наблюдается рост выручки» → «выручка растёт»"],
    [new RegExp(`${EDGE_LEFT}(являе?тся|являются)${SPACE}+(причиной|следствием|результатом|источником)${EDGE_RIGHT}`, "giu"),
      "замените связкой-глаголом: «является причиной задержек» → «вызывает задержки» (падеж придётся поправить)"],
    [new RegExp(`${EDGE_LEFT}(оказывает|оказывают)${SPACE}+(поддержку|содействие|помощь|воздействие)${EDGE_RIGHT}`, "giu"),
      "замените глаголом: «оказывает поддержку малому бизнесу» → «поддерживает малый бизнес»"],
  ];
  const MANUAL_NOMINALIZATION_EN = [
    [new RegExp(`${EDGE_LEFT}(?:the|an?)${SPACE}+(\\p{L}{4,}(?:tion|sion|ment))${SPACE}+of${EDGE_RIGHT}`, "giu"),
      "разверните в глагол: «the implementation of the plan» → «we implemented the plan» или «the plan was implemented»"],
  ];

  const STOP_WORDS = new Set([
    "и", "в", "на", "с", "по", "для", "что", "как", "это", "все", "или", "the", "and",
    "for", "with", "that", "this", "from", "are", "was", "were", "has", "have",
  ]);

  const PASS_LABEL = {
    reduction: "18 · сокращение",
    connectives: "21 · снятие связок",
    rhythm: "19 · ритм",
    denominalization: "22 · разноминализация",
  };

  const PRIORITY = { reduction: 1, connectives: 2, denominalization: 3, rhythm: 4 };

  function detectLanguage(text) {
    const cyrillic = (String(text).match(/\p{Script=Cyrillic}/gu) || []).length;
    const latin = (String(text).match(/\p{Script=Latin}/gu) || []).length;
    return cyrillic > latin ? "ru" : "en";
  }

  function countWords(text) {
    return (String(text).match(WORD_RE) || []).length;
  }

  /**
   * Содержательные слова для сравнения предложений. Слово обрезается до пяти
   * букв: «расширение» и «расширения» — одно и то же для проверки на повтор
   * тезиса, а морфологии здесь нет и не будет. Огрубление осознанное — цена
   * ошибки низкая, потому что повтор только предлагается, а не удаляется.
   */
  function contentWords(text, locale) {
    return new Set(
      (String(text).toLocaleLowerCase(locale).match(WORD_RE) || [])
        .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
        .map((word) => word.slice(0, 5)),
    );
  }

  function overlap(left, right) {
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const word of left) if (right.has(word)) shared += 1;
    return shared / Math.min(left.size, right.size);
  }

  function capitalize(text, locale) {
    return text.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase(locale));
  }

  function paragraphSpans(text) {
    const spans = [];
    const source = String(text || "");
    const separator = /\n{2,}/g;
    let cursor = 0;
    let match = separator.exec(source);
    while (match) {
      spans.push({ start: cursor, end: match.index, text: source.slice(cursor, match.index) });
      cursor = match.index + match[0].length;
      match = separator.exec(source);
    }
    spans.push({ start: cursor, end: source.length, text: source.slice(cursor) });
    return spans.filter((span) => span.text.trim());
  }

  function sentenceSpans(paragraph, offset) {
    const spans = [];
    const base = offset || 0;
    const boundary = /(?<=[.!?…]["»”')\]]?)[\s ]+/g;
    let cursor = 0;
    let match = boundary.exec(paragraph);
    while (match) {
      const text = paragraph.slice(cursor, match.index);
      if (text.trim()) {
        spans.push({
          start: base + cursor,
          end: base + match.index,
          endWithGap: base + match.index + match[0].length,
          text,
        });
      }
      cursor = match.index + match[0].length;
      match = boundary.exec(paragraph);
    }
    const tail = paragraph.slice(cursor);
    if (tail.trim()) {
      spans.push({ start: base + cursor, end: base + paragraph.length, endWithGap: base + paragraph.length, text: tail });
    }
    return spans;
  }

  function allSentences(text) {
    return paragraphSpans(text).map((paragraph) => ({
      paragraph,
      sentences: sentenceSpans(paragraph.text, paragraph.start),
    }));
  }

  /**
   * Спан и его текст обязаны совпадать байт в байт, поэтому «было» всегда
   * режется из исходника, а не объявляется вызывающим кодом: расхождение
   * означало бы, что apply() отменит весь пакет правок.
   */
  function makeEdit(options) {
    const before = options.source.slice(options.start, options.end);
    return {
      id: `${options.pass}-${options.start}-${options.end}`,
      pass: options.pass,
      passLabel: PASS_LABEL[options.pass],
      method: options.method,
      start: options.start,
      end: options.end,
      before,
      after: options.after,
      reason: options.reason,
      confidence: options.confidence,
      // Заглавная буква восстанавливается после применения — по смещению, а
      // не захватом соседнего слова в спан: так диффы остаются короткими и
      // соседние правки не конфликтуют из-за одного общего слова.
      capitalizeAt: options.capitalizeAt === undefined ? null : options.capitalizeAt,
      removedWords: Math.max(0, countWords(before) - countWords(options.after)),
    };
  }

  function collectReduction(text, sentences, language, locale) {
    const edits = [];
    const leaders = language === "ru" ? LEAD_FILLER_RU : LEAD_FILLER_EN;
    const meta = language === "ru" ? META_SENTENCE_RU : META_SENTENCE_EN;
    const intensifiers = INTENSIFIERS[language] || INTENSIFIERS.en;

    for (const block of sentences) {
      const list = block.sentences;
      for (let index = 0; index < list.length; index += 1) {
        const sentence = list[index];
        const body = sentence.text;

        if (meta.test(body.trim()) && list.length > 1) {
          edits.push(makeEdit({
            source: text, pass: "reduction", method: 18,
            start: sentence.start, end: sentence.endWithGap, after: "",
            reason: "предложение о самом тексте, а не о предмете",
            confidence: "high",
          }));
          continue;
        }

        for (const [pattern, reason, confidence] of leaders) {
          const match = body.match(pattern);
          if (!match || match.index !== 0) continue;
          edits.push(makeEdit({
            source: text, pass: "reduction", method: 18,
            start: sentence.start, end: sentence.start + match[0].length, after: "",
            reason, confidence, capitalizeAt: 0,
          }));
          break;
        }

        for (const [words, confidence] of intensifiers) {
          for (const word of words) {
            const pattern = new RegExp(`${EDGE_LEFT}${word}${EDGE_RIGHT}[\\s\\u00a0]+`, "giu");
            for (const match of body.matchAll(pattern)) {
              if (match.index === 0) continue;
              edits.push(makeEdit({
                source: text, pass: "reduction", method: 18,
                start: sentence.start + match.index,
                end: sentence.start + match.index + match[0].length,
                after: "",
                reason: "усилитель без содержания",
                confidence,
              }));
            }
          }
        }

        // Повтор тезиса внутри абзаца: позднее предложение пересказывает
        // раннее. Удаляется позднее — раннее обычно точнее.
        if (countWords(body) >= 8) {
          const current = contentWords(body, locale);
          for (let earlier = 0; earlier < index; earlier += 1) {
            const previous = list[earlier];
            if (countWords(previous.text) < 8) continue;
            if (overlap(current, contentWords(previous.text, locale)) < 0.6) continue;
            edits.push(makeEdit({
              source: text, pass: "reduction", method: 18,
              start: sentence.start, end: sentence.endWithGap, after: "",
              reason: `пересказ предложения «${previous.text.slice(0, 40)}…» из этого же абзаца`,
              confidence: "medium",
            }));
            break;
          }
        }
      }

      // Резюме абзаца: последнее предложение начинается с итоговой связки и
      // не добавляет ни одного нового содержательного слова.
      if (list.length >= 3) {
        const last = list[list.length - 1];
        const opener = language === "ru"
          ? /^(?:таким образом|итак|в итоге|подводя итог|следовательно|в целом)/iu
          : /^(?:thus|therefore|in summary|in conclusion|to summarise|to summarize|overall)/i;
        if (opener.test(last.text.trim())) {
          const rest = list.slice(0, -1).map((item) => item.text).join(" ");
          if (overlap(contentWords(last.text, locale), contentWords(rest, locale)) >= 0.5) {
            edits.push(makeEdit({
              source: text, pass: "reduction", method: 18,
              start: list[list.length - 2].end, end: last.end, after: "",
              reason: "резюме абзаца: новых слов нет, только пересказ",
              confidence: "medium",
            }));
          }
        }
      }
    }
    return edits;
  }

  function collectConnectives(text, sentences, language) {
    const edits = [];
    const markers = language === "ru" ? CONNECTIVES_RU : CONNECTIVES_EN;
    for (const block of sentences) {
      for (const sentence of block.sentences) {
        const body = sentence.text;
        for (const [marker, confidence] of markers) {
          const pattern = new RegExp(`^${marker},${SPACE}+`, "iu");
          const match = body.match(pattern);
          if (!match) continue;
          if (countWords(body) - countWords(match[0]) < 4) break;
          edits.push(makeEdit({
            source: text, pass: "connectives", method: 21,
            start: sentence.start, end: sentence.start + match[0].length, after: "",
            reason: `связка «${marker}» в начале предложения: сцепка идёт через содержание`,
            confidence, capitalizeAt: 0,
          }));
          break;
        }
      }
    }
    return edits;
  }

  function collectRhythm(text, sentences, language) {
    const edits = [];
    const points = language === "ru" ? SPLIT_POINTS_RU : SPLIT_POINTS_EN;
    for (const block of sentences) {
      for (const sentence of block.sentences) {
        const body = sentence.text;
        const length = countWords(body);
        if (length < SPLIT_MIN_WORDS) continue;
        let best = null;
        for (const point of points) {
          let index = body.indexOf(point);
          while (index !== -1) {
            const leftWords = countWords(body.slice(0, index));
            const rightWords = countWords(body.slice(index + point.length));
            const balance = Math.abs(leftWords - rightWords);
            if (leftWords >= SPLIT_MIN_PART && rightWords >= SPLIT_MIN_PART) {
              if (!best || balance < best.balance) best = { index, point, balance };
            }
            index = body.indexOf(point, index + 1);
          }
        }
        if (!best) continue;
        edits.push(makeEdit({
          source: text, pass: "rhythm", method: 19,
          start: sentence.start + best.index,
          end: sentence.start + best.index + best.point.length,
          after: ". ",
          reason: `предложение на ${length} слов дробится по сочинительной связи`,
          confidence: "medium",
          capitalizeAt: 2,
        }));
      }
    }
    return edits;
  }

  function collectDenominalization(text, language, locale) {
    const edits = [];
    const dictionary = language === "ru" ? DENOMINALIZATION_RU : DENOMINALIZATION_EN;
    for (const [phrase, replacement] of dictionary) {
      const pattern = new RegExp(`${EDGE_LEFT}${phrase.replace(/ /g, `${SPACE}+`)}${EDGE_RIGHT}`, "giu");
      for (const match of String(text).matchAll(pattern)) {
        const head = match[0][0];
        const isCapital = head === head.toLocaleUpperCase(locale) && head !== head.toLocaleLowerCase(locale);
        edits.push(makeEdit({
          source: text, pass: "denominalization", method: 22,
          start: match.index, end: match.index + match[0].length,
          after: isCapital ? capitalize(replacement, locale) : replacement,
          reason: "отглагольное существительное разворачивается в глагол",
          confidence: "high",
        }));
      }
    }
    return edits;
  }

  /** Места номинализации, которые нельзя переписать без разбора падежей. */
  function collectManual(text, language) {
    const patterns = language === "ru" ? MANUAL_NOMINALIZATION_RU : MANUAL_NOMINALIZATION_EN;
    const found = [];
    for (const [pattern, advice] of patterns) {
      for (const match of String(text).matchAll(pattern)) {
        found.push({
          id: `manual-${match.index}`,
          method: 22,
          start: match.index,
          end: match.index + match[0].length,
          fragment: match[0],
          context: String(text).slice(Math.max(0, match.index - 30), match.index + match[0].length + 40).trim(),
          advice,
        });
      }
    }
    return found.sort((left, right) => left.start - right.start);
  }

  /** Правки не должны пересекаться; удаление целого предложения важнее правок внутри него. */
  function resolve(edits) {
    const sorted = edits.slice().sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      const sizeDelta = right.end - right.start - (left.end - left.start);
      if (sizeDelta !== 0) return sizeDelta;
      return PRIORITY[left.pass] - PRIORITY[right.pass];
    });
    const result = [];
    let occupiedUntil = -1;
    for (const edit of sorted) {
      if (edit.start < occupiedUntil) continue;
      result.push(edit);
      occupiedUntil = edit.end;
    }
    return result;
  }

  /**
   * Гард 34 действует и на входе: связки снимаются не все, а только сверх
   * целевой зоны жанра. Текст, где не осталось ни одной связки, читается
   * так же машинно, как текст, где связка стоит в каждом предложении.
   */
  function recommend(edits, context) {
    const sentenceCount = context.sentenceCount || 0;
    const zone = context.discourseZone || { max: 0.15 };
    const keep = Math.max(1, Math.round(sentenceCount * zone.max));
    let connectivesSeen = 0;
    return edits.map((edit) => {
      let accepted = edit.confidence === "high";
      let keptForZone = false;
      if (edit.pass === "connectives") {
        connectivesSeen += 1;
        keptForZone = edit.confidence === "high" && connectivesSeen <= keep;
        accepted = edit.confidence === "high" && !keptForZone;
      }
      if (edit.pass === "rhythm") accepted = false;
      return Object.assign({}, edit, { accepted, keptForZone });
    });
  }

  /**
   * Методы, которые код выполнить не может: они требуют знания предмета.
   * Возвращаются рядом с правками, а не опускаются молча — иначе список
   * правок читается как полное решение.
   */
  function hints(report) {
    const list = [];
    const byId = new Map((report && report.metrics ? report.metrics : []).map((metric) => [metric.id, metric]));
    const status = (id) => (byId.get(id) || {}).status;

    if (status("shortPerParagraph") === "low") {
      list.push({
        method: 19,
        label: "Короткая фраза",
        text: "В абзацах нет фразы короче шести слов. Придумать её код не может: напишите одну там, где делаете вывод — она задаёт ритм сильнее любого дробления.",
      });
    }
    if (status("paragraphCv") === "low") {
      list.push({
        method: 20,
        label: "Асимметрия структуры",
        text: "Абзацы почти одной длины. Раздуйте тот, где у вас больше всего материала, и сожмите соседний до двух фраз.",
      });
    }
    const paragraphMetric = byId.get("paragraphCv");
    if (paragraphMetric && paragraphMetric.evidence && paragraphMetric.evidence.evenList) {
      list.push({
        method: 20,
        label: "Три равных пункта",
        text: "Пункты списка одной длины — след генерации по таксономии. Один разверните, один сожмите до фразы, один выбросьте и скажите в тексте, почему он не нужен (метод 14).",
      });
    }
    if (status("anchorDensity") === "low") {
      list.push({
        method: 11,
        label: "Элицитация конкретики",
        text: "Плотность якорей ниже зоны. Ответьте на вопросы блока «Чего не хватает» — числа, сроки, имена. Выдумывать их инструмент не будет.",
      });
    }
    list.push({
      method: 13,
      label: "Парность выгода ↔ издержка",
      text: "У каждого утверждения о пользе найдите, чем за неё платят. Одна фраза «зато…» на раздел меняет текст сильнее, чем весь пасс сокращения.",
    });
    list.push({
      method: 23,
      label: "Эллипсис",
      text: "Найдите места, где договариваете очевидное, и оборвите фразу раньше. Коду всё договорённое кажется полезным.",
    });
    list.push({
      method: 24,
      label: "Отступление и самокоррекция",
      text: "Одна-две вставки на страницу — «точнее», «хотя нет». Больше — уже приём. В академическом регистре уместно только там, где вы оцениваете, а не описываете (метод 25).",
    });
    return list;
  }

  function propose(text, options) {
    const settings = options || {};
    const source = String(text || "");
    const language = settings.language || detectLanguage(source);
    const locale = language === "ru" ? "ru" : "en";
    const sentences = allSentences(source);
    const sentenceCount = sentences.reduce((sum, block) => sum + block.sentences.length, 0);

    const raw = [
      ...collectReduction(source, sentences, language, locale),
      ...collectConnectives(source, sentences, language),
      ...collectRhythm(source, sentences, language),
      ...collectDenominalization(source, language, locale),
    ];
    const edits = recommend(resolve(raw), { sentenceCount, discourseZone: settings.discourseZone });

    const totalWords = countWords(source);
    const removable = edits.reduce((sum, edit) => sum + edit.removedWords, 0);
    const recommended = edits
      .filter((edit) => edit.accepted)
      .reduce((sum, edit) => sum + edit.removedWords, 0);

    return {
      language,
      edits,
      manual: collectManual(source, language),
      sentenceCount,
      totalWords,
      // План целится в 20–30% сокращения. Безопасные правила столько не дают
      // почти никогда: остальное — работа автора, и это честнее показать,
      // чем добрать процент рискованными заменами.
      reduction: {
        possibleShare: totalWords ? removable / totalWords : 0,
        recommendedShare: totalWords ? recommended / totalWords : 0,
        target: { min: 0.2, max: 0.3 },
      },
      hints: hints(settings.report),
    };
  }

  /**
   * Применение выбранного подмножества. Спаны не пересекаются, применяются с
   * конца — смещения оставшихся правок остаются валидными. Затем
   * восстанавливаются заглавные буквы, чинятся пробелы, и результат
   * обязательно проходит фактчек-гард (32): расхождение по якорям означает
   * ошибку правила, поэтому пакет откатывается целиком.
   */
  function apply(text, edits) {
    const source = String(text || "");
    const selected = edits
      .filter((edit) => edit.accepted)
      .slice()
      .sort((left, right) => right.start - left.start);

    const locale = detectLanguage(source) === "ru" ? "ru" : "en";
    let result = source;
    for (const edit of selected) {
      if (result.slice(edit.start, edit.end) !== edit.before) {
        return { text: source, applied: 0, ok: false, warnings: ["Правки не совпали с текстом: пересоберите отчёт."] };
      }
      result = result.slice(0, edit.start) + edit.after + result.slice(edit.end);
      if (edit.capitalizeAt === null) continue;
      const position = edit.start + edit.capitalizeAt;
      const letter = result[position];
      if (!letter) continue;
      result = result.slice(0, position) + letter.toLocaleUpperCase(locale) + result.slice(position + 1);
    }

    result = result
      .replace(/[  \t]{2,}/g, " ")
      .replace(/[  \t]+([,.;:!?…])/g, "$1")
      .replace(/([(«"'])[  ]+/g, "$1")
      .replace(/\n[  \t]+/g, "\n")
      .replace(/[  \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const guard = loadAnchorGuard();
    const check = guard ? guard.compare(source, result) : { ok: true, lost: [], added: [], notes: [] };
    if (!check.ok) {
      return {
        text: source,
        applied: 0,
        ok: false,
        guard: check,
        warnings: [`Правки отменены целиком: ${guard.describe(check)}.`],
      };
    }

    return {
      text: result,
      applied: selected.length,
      ok: true,
      guard: check,
      warnings: [],
      removedWords: countWords(source) - countWords(result),
      removedShare: countWords(source) ? 1 - countWords(result) / countWords(source) : 0,
    };
  }

  /**
   * Применить один пасс целиком — точка входа для замкнутого цикла
   * гуманизации. Берутся только правки с высокой уверенностью и только
   * те, что не оставлены намеренно ради зоны жанра: всё спорное остаётся
   * автору в панели, как и было задумано.
   */
  function applyPass(text, passId, options) {
    const proposal = propose(text, options);
    const edits = proposal.edits.map((edit) =>
      Object.assign({}, edit, {
        accepted: edit.pass === passId && edit.confidence === "high" && !edit.keptForZone,
      }),
    );
    const outcome = apply(text, edits);
    return {
      text: outcome.text,
      changed: outcome.ok && outcome.applied > 0,
      applied: outcome.applied,
      warnings: outcome.warnings,
    };
  }

  return {
    propose,
    apply,
    applyPass,
    hints,
    paragraphSpans,
    sentenceSpans,
    detectLanguage,
    countWords,
    PASS_LABEL,
  };
});
