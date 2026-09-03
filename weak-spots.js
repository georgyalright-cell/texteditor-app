(function attachWeakSpots(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WeakSpots = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createWeakSpots() {
  "use strict";

  // Карта слабых мест: какие предложения тянут текст вниз сильнее прочих.
  //
  // Отчёт по метрикам говорит, что не так с текстом целиком, но не говорит,
  // где именно. Между тем по плану рука человека на 10-15% текста меняет
  // профиль сильнее любой автоматики — и весь вопрос в том, какие это 15%.
  // Наугад автор правит начало и конец, а машинность обычно сидит в
  // середине, в предложениях без единого числа.
  //
  // Оценка складывается из тех же признаков, что и общая, но считается по
  // одному предложению. Признаки не усредняются, а суммируются со своими
  // весами: предложение со связкой в начале, штампом и без единого якоря
  // плохо трижды, и показать его надо выше, чем плохое один раз.

  const WORD_RE = /[\p{L}\p{N}-]+/gu;

  function loadAnchorGuard() {
    if (typeof globalThis !== "undefined" && globalThis.AnchorGuard) return globalThis.AnchorGuard;
    if (typeof require === "function") return require("./anchor-guard.js");
    return null;
  }

  function loadMetrics() {
    if (typeof globalThis !== "undefined" && globalThis.HumanizerMetrics) return globalThis.HumanizerMetrics;
    if (typeof require === "function") return require("./humanizer-metrics.js");
    return null;
  }

  const CLAIM_RU = /(?<![\p{L}\p{N}_-])(?:позволя[ею]т?|обеспечива[ею]т?|улучша[ею]т?|повыша[ею]т?|снижа[ею]т?|способству[ею]т?|значительн\p{L}*|эффективн\p{L}*|ключев\p{L}*|важн\p{L}*|комплексн\p{L}*|успешн\p{L}*)(?![\p{L}\p{N}_-])/iu;
  const CLAIM_EN = /(?<![\p{L}\p{N}_-])(?:provides?|ensures?|enables?|delivers?|improves?|increases?|reduces?|supports?|significant|comprehensive|robust|effective|efficient|strategic|key)(?![\p{L}\p{N}_-])/iu;

  const WEIGHTS = {
    discourse: 25,
    cliche: 20,
    hedge: 15,
    emptyClaim: 25,
    repeatedOpener: 15,
    averageLength: 10,
    concrete: -20,
  };

  const REASONS = {
    discourse: "начинается со связки",
    cliche: "штампованный оборот",
    hedge: "хедж вместо утверждения",
    emptyClaim: "обещание без числа, срока и источника",
    repeatedOpener: "так же начинается другое предложение",
    averageLength: "длина как у соседей — ритм ровный",
    concrete: "есть конкретика",
  };

  function countWords(text) {
    return (String(text).match(WORD_RE) || []).length;
  }

  function sentences(text) {
    return String(text || "")
      .replace(/\n+/g, " ")
      .split(/(?<=[.!?…]["»”')\]]?)[\s ]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function opener(sentence, locale) {
    return (sentence.match(/[\p{L}\p{N}-]+/u) || [""])[0].toLocaleLowerCase(locale);
  }

  /**
   * Ранжирование предложений. Возвращает их в порядке убывания машинности,
   * с причинами: без причин список бесполезен — автор должен видеть, что
   * именно править, а не только где.
   */
  function rank(text, options) {
    const settings = options || {};
    const metrics = loadMetrics();
    const guard = loadAnchorGuard();
    if (!metrics) return [];

    const source = String(text || "");
    const language = settings.language || metrics.detectLanguage(source);
    const locale = language === "ru" ? "ru" : "en";
    const set = language === "ru"
      ? { discourse: metrics.DISCOURSE_RU, hedge: metrics.HEDGE_RU, cliche: metrics.CLICHE_RU, claim: CLAIM_RU }
      : { discourse: metrics.DISCOURSE_EN, hedge: metrics.HEDGE_EN, cliche: metrics.CLICHE_EN, claim: CLAIM_EN };

    const list = sentences(source);
    if (!list.length) return [];
    const lengths = list.map(countWords);
    const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;

    const openerCounts = new Map();
    for (const sentence of list) {
      const head = opener(sentence, locale);
      if (head) openerCounts.set(head, (openerCounts.get(head) || 0) + 1);
    }

    return list
      .map((sentence, index) => {
        const lowered = sentence.toLocaleLowerCase(locale);
        const head = lowered.replace(/^[^\p{L}]+/u, "");
        const reasons = [];
        let score = 0;

        if (set.discourse.some((phrase) => head.startsWith(phrase))) {
          score += WEIGHTS.discourse;
          reasons.push(REASONS.discourse);
        }
        const cliches = set.cliche.filter((phrase) => lowered.includes(phrase));
        if (cliches.length) {
          score += Math.min(WEIGHTS.cliche * cliches.length, WEIGHTS.cliche * 2);
          reasons.push(`${REASONS.cliche}: «${cliches[0]}»`);
        }
        if (set.hedge.some((phrase) => lowered.includes(phrase))) {
          score += WEIGHTS.hedge;
          reasons.push(REASONS.hedge);
        }

        // Якорем считается количество или источник: имя собственное не делает
        // утверждение проверяемым — «KPIs» это категория, а не факт.
        const anchors = guard ? guard.extractAnchors(sentence).filter((item) => item.type !== "proper") : [];
        if (set.claim.test(sentence) && !anchors.length) {
          score += WEIGHTS.emptyClaim;
          reasons.push(REASONS.emptyClaim);
        }
        if (anchors.length >= 2) {
          score += WEIGHTS.concrete;
          reasons.push(REASONS.concrete);
        }
        if ((openerCounts.get(opener(sentence, locale)) || 0) > 1) {
          score += WEIGHTS.repeatedOpener;
          reasons.push(REASONS.repeatedOpener);
        }
        if (average > 0 && Math.abs(lengths[index] - average) / average < 0.15 && list.length >= 4) {
          score += WEIGHTS.averageLength;
          reasons.push(REASONS.averageLength);
        }

        return {
          index,
          text: sentence,
          words: lengths[index],
          score: Math.max(0, Math.min(100, score)),
          reasons,
        };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index);
  }

  /**
   * Те предложения, которые стоит тронуть рукой. Доля, а не число: на длинном
   * тексте десять худших — капля, на коротком — половина работы.
   */
  function worst(text, options) {
    const settings = options || {};
    const share = settings.share === undefined ? 0.15 : settings.share;
    const ranked = rank(text, settings).filter((item) => item.score > 0);
    const limit = Math.max(1, Math.min(Math.round(ranked.length * share) || 1, settings.limit || 8));
    return ranked.slice(0, limit);
  }

  return { rank, worst, sentences, WEIGHTS };
});
