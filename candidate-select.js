(function attachCandidateSelect(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CandidateSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createCandidateSelect() {
  "use strict";

  // Отбор формулировки вместо жёсткого выбора.
  //
  // До сих пор каждый слой выдавал ровно один результат: словарь выбирал
  // синоним хешем абзаца, ритм — первую подходящую точку разрыва. Выбор был
  // произвольным, но безальтернативным, и оценить его было нечем.
  //
  // Здесь появляется второй шаг: собрать несколько допустимых версий одного
  // текста и выбрать из них по оценке. Оценка подключаемая — в этом весь
  // смысл. По умолчанию это детерминированная оценка машинности, а когда
  // доступна локальная модель, ту же роль играет перплексия: тогда цикл
  // оптимизирует ровно то, что меряет детектор, а не его косвенные признаки.
  //
  // Контракт оценки: score(texts) -> Promise<number[]>, где МЕНЬШЕ значит
  // человечнее. Перплексийный адаптер обязан перевернуть знак сам —
  // у Binoculars человечнее как раз больше.

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

  function loadParaphraser() {
    if (typeof globalThis !== "undefined" && globalThis.RuleParaphraser) return globalThis.RuleParaphraser;
    if (typeof require === "function") return require("./paraphraser.js");
    return null;
  }

  function loadPasses() {
    if (typeof globalThis !== "undefined" && globalThis.EditPasses) return globalThis.EditPasses;
    if (typeof require === "function") return require("./edit-passes.js");
    return null;
  }

  function loadWeakSpots() {
    if (typeof globalThis !== "undefined" && globalThis.WeakSpots) return globalThis.WeakSpots;
    if (typeof require === "function") return require("./weak-spots.js");
    return null;
  }

  function loadRewriter() {
    if (typeof globalThis !== "undefined" && globalThis.StructuralRewriter) return globalThis.StructuralRewriter;
    if (typeof require === "function") return require("./rewriter.js");
    return null;
  }

  /** Оценка по умолчанию: та же машинность, что управляет циклом. */
  function deterministicScorer(language) {
    const metrics = loadMetrics();
    return function score(texts) {
      return Promise.resolve(texts.map((text) => metrics.scoreText(text, language).score));
    };
  }

  // Комбинации слоёв рерайтера. Пустой набор оставлен намеренно: версия «как
  // есть» обязана участвовать в отборе на равных, иначе правка применяется
  // просто потому, что она была предложена.
  const REWRITE_COMBINATIONS = [
    {},
    { rhythm: true },
    { openers: true },
    { rhythm: true, openers: true },
    { dashes: true, rhythm: true, openers: true },
  ];

  function withDefaults(combination, language) {
    return Object.assign(
      { language, dashes: false, antithesis: false, rhythm: false, openers: false },
      combination,
    );
  }

  /**
   * Допустимые версии текста. Каждая проходит фактчек-гард до того, как
   * попадёт в отбор: кандидат, потерявший число или ссылку, не должен даже
   * участвовать в сравнении — иначе оценка однажды выберет именно его.
   */
  function generate(text, options) {
    const settings = options || {};
    const source = String(text || "");
    const paraphraser = loadParaphraser();
    const rewriter = loadRewriter();
    const guard = loadAnchorGuard();
    const language = settings.language || (paraphraser ? paraphraser.detectLanguage(source) : "ru");
    const limit = Math.max(2, Math.min(settings.limit || 8, 16));

    const useLayers = settings.layers !== false;
    const bases = [{ text: source, origin: "исходный" }];
    if (paraphraser) {
      for (const variant of paraphraser.paraphraseVariants(source, language, 3)) {
        bases.push({ text: variant.text, origin: "словарь" });
      }
    }

    const seen = new Set();
    const candidates = [];
    for (const base of bases) {
      for (const combination of useLayers ? REWRITE_COMBINATIONS : [{}]) {
        let produced = base.text;
        if (useLayers && rewriter && Object.keys(combination).length) {
          produced = rewriter.rewrite(base.text, withDefaults(combination, language)).text;
        }
        if (seen.has(produced)) continue;
        seen.add(produced);
        if (guard && produced !== source && !guard.compare(source, produced).ok) continue;
        const layers = Object.keys(combination);
        candidates.push({
          text: produced,
          origin: layers.length ? `${base.origin} + ${layers.join(", ")}` : base.origin,
        });
        if (candidates.length >= limit) return candidates;
      }
    }
    return candidates;
  }

  /**
   * Выбор лучшего кандидата. Исходный текст участвует наравне с остальными,
   * и при равенстве оценок побеждает он: правка должна доказать пользу, а не
   * получить её по умолчанию.
   */
  function select(source, candidates, options) {
    const settings = options || {};
    const list = candidates && candidates.length ? candidates : [{ text: String(source || ""), origin: "исходный" }];
    const language = settings.language;
    const score = settings.score || deterministicScorer(language);

    return Promise.resolve(score(list.map((item) => item.text))).then((scores) => {
      if (!Array.isArray(scores) || scores.length !== list.length) {
        throw new Error("CandidateSelect: оценка вернула не столько значений, сколько кандидатов.");
      }
      const ranked = list
        .map((item, index) => Object.assign({}, item, { score: Number(scores[index]) }))
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => left.score - right.score);
      if (!ranked.length) {
        return { text: String(source || ""), chosen: null, ranked: [], improved: false };
      }
      const best = ranked[0];
      const original = ranked.find((item) => item.text === String(source || ""));
      // Строгое неравенство: равный по оценке кандидат ничего не доказал.
      const improved = !original || best.score < original.score;
      return {
        text: improved ? best.text : String(source || ""),
        chosen: improved ? best : original || best,
        ranked,
        improved,
      };
    });
  }

  /**
   * Синхронный отбор по детерминированной оценке. Существует ровно потому,
   * что перплексия асинхронна, а словарные варианты считаются мгновенно:
   * ради них переписывать весь конвейер в промисы не нужно.
   */
  function improveSync(text, options) {
    const settings = options || {};
    const source = String(text || "");
    const metrics = loadMetrics();
    if (!metrics) return { text: source, chosen: null, ranked: [], improved: false };
    const candidates = generate(source, settings);
    const ranked = candidates
      .map((item) => Object.assign({}, item, { score: metrics.scoreText(item.text, settings.language).score }))
      .sort((left, right) => left.score - right.score);
    const best = ranked[0];
    const original = ranked.find((item) => item.text === source);
    const improved = Boolean(best) && (!original || best.score < original.score);
    return {
      text: improved ? best.text : source,
      chosen: improved ? best : original || best || null,
      ranked,
      improved,
    };
  }

  // --- Отбор формулировок по предложениям ---------------------------------
  //
  // Оценка всего документа целиком бесполезна для выбора: она усредняет и
  // тонет. Оценка каждого предложения по отдельности — уже разговор, но одна
  // оценка это два прохода модели, и считать весь текст значит ждать минуты.
  //
  // Поэтому берутся только худшие предложения по карте слабых мест, у каждого
  // собирается несколько версий, и всё это уходит в модель ОДНИМ пакетом:
  // модели грузятся один раз, а пересылка между потоками стоит столько же,
  // сколько сам счёт.

  function sentenceSpansOf(text) {
    const passes = loadPasses();
    if (!passes) return [];
    const spans = [];
    for (const paragraph of passes.paragraphSpans(text)) {
      spans.push(...passes.sentenceSpans(paragraph.text, paragraph.start));
    }
    return spans;
  }

  /** Версии одного предложения. Слой зачинов сюда не входит: он работает с парой соседей. */
  function sentenceVariants(sentence, language) {
    const paraphraser = loadParaphraser();
    const rewriter = loadRewriter();
    const guard = loadAnchorGuard();
    const seen = new Set([sentence]);
    const variants = [];

    const push = (text) => {
      const value = String(text || "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      if (guard && !guard.compare(sentence, value).ok) return;
      variants.push(value);
    };

    if (paraphraser) {
      for (const variant of paraphraser.paraphraseVariants(sentence, language, 3)) push(variant.text);
    }
    if (rewriter) {
      for (const layers of [{ dashes: true }, { antithesis: true }, { dashes: true, antithesis: true }]) {
        push(rewriter.rewrite(sentence, withDefaults(layers, language)).text);
      }
    }
    return variants;
  }

  /**
   * Полировка по предложениям: собрать версии худших предложений, оценить их
   * пакетом и заменить те, где нашлось лучше. Замена принимается только при
   * строгом улучшении — равная оценка ничего не доказала.
   */
  function polishSentences(text, options) {
    const settings = options || {};
    const source = String(text || "");
    const weakSpots = loadWeakSpots();
    const guard = loadAnchorGuard();
    const language = settings.language || (loadParaphraser() ? loadParaphraser().detectLanguage(source) : "ru");
    const score = settings.score || deterministicScorer(language);
    const limit = Math.max(1, Math.min(settings.limit || 5, 12));

    const spans = sentenceSpansOf(source);
    if (!spans.length || !weakSpots) {
      return Promise.resolve({ text: source, replaced: 0, details: [], ok: true, warnings: [] });
    }

    const worst = weakSpots.worst(source, { language, share: 1, limit });
    // Источник версий может быть не один: детерминированные правила всегда,
    // генеративная модель — если её подключили через settings.generate.
    // Контракт хука: generate(sentence) -> Promise<string[]>. Всё, что он
    // вернёт, проходит тот же гард якорей, что и правила: модель не имеет
    // права ни поменять число, ни добавить новое.
    const prepared = worst.map((spot) => {
      const span = spans.find((item) => item.text.trim() === spot.text.trim());
      if (!span) return Promise.resolve(null);
      const original = span.text.trim();
      const rules = sentenceVariants(original, language);
      const extra = settings.generate
        ? Promise.resolve(settings.generate(original, { language })).catch(() => [])
        : Promise.resolve([]);
      return extra.then((generated) => {
        const seen = new Set([original, ...rules]);
        const accepted = rules.slice();
        for (const candidate of Array.isArray(generated) ? generated : []) {
          const value = String(candidate || "").trim();
          if (!value || seen.has(value)) continue;
          seen.add(value);
          if (guard && !guard.compare(original, value).ok) continue;
          accepted.push(value);
        }
        return accepted.length ? { span, original, variants: accepted, reasons: spot.reasons } : null;
      });
    });

    return Promise.all(prepared).then((resolved) => {
      const targets = resolved.filter(Boolean);
      if (!targets.length) {
        return { text: source, replaced: 0, details: [], ok: true, warnings: [] };
      }
      return scoreAndReplace(source, targets, score, guard);
    });
  }

  /** Пакетная оценка версий и замена тех предложений, где нашлось лучше. */
  function scoreAndReplace(source, targets, score, guard) {

    // Один пакет на всё: оригиналы и версии подряд, границы запоминаются.
    const batch = [];
    for (const target of targets) {
      target.offset = batch.length;
      batch.push(target.original, ...target.variants);
    }

    return Promise.resolve(score(batch)).then((scores) => {
      if (!Array.isArray(scores) || scores.length !== batch.length) {
        throw new Error("CandidateSelect: оценка вернула не столько значений, сколько вариантов.");
      }
      const details = [];
      const replacements = [];
      for (const target of targets) {
        const baseline = Number(scores[target.offset]);
        let best = null;
        for (let index = 0; index < target.variants.length; index += 1) {
          const value = Number(scores[target.offset + 1 + index]);
          if (!Number.isFinite(value)) continue;
          if (!best || value < best.score) best = { text: target.variants[index], score: value };
        }
        if (!best || !Number.isFinite(baseline) || best.score >= baseline) continue;
        replacements.push({ span: target.span, text: best.text });
        details.push({
          before: target.original,
          after: best.text,
          gain: Math.round((baseline - best.score) * 1000) / 1000,
          reasons: target.reasons,
        });
      }

      let result = source;
      for (const replacement of replacements.slice().sort((left, right) => right.span.start - left.span.start)) {
        result = result.slice(0, replacement.span.start) + replacement.text + result.slice(replacement.span.end);
      }

      // Гард на весь документ: замены проверялись по одному предложению, но
      // потерять якорь можно и на склейке.
      const check = guard ? guard.compare(source, result) : { ok: true };
      if (!check.ok) {
        return {
          text: source,
          replaced: 0,
          details: [],
          ok: false,
          warnings: [`Полировка отменена целиком: ${guard.describe(check)}.`],
        };
      }
      return { text: result, replaced: replacements.length, details, ok: true, warnings: [] };
    });
  }

  /** Полный шаг: собрать версии и выбрать лучшую. */
  function improve(text, options) {
    const settings = options || {};
    const candidates = generate(text, settings);
    return select(text, candidates, settings);
  }

  /**
   * Оценка локальной моделью. Binoculars — отношение перплексий observer и
   * performer: чем оно больше, тем текст менее предсказуем, то есть
   * человечнее. Контракт отбора обратный, поэтому знак переворачивается
   * здесь, в одном месте.
   *
   * Кандидат, который модель не смогла оценить, получает NaN и выбывает из
   * сравнения, а не считается худшим: неоценённое и плохое — разные вещи.
   */
  function perplexityScorer(scorer) {
    const engine = scorer || (typeof globalThis !== "undefined" ? globalThis.NeuralScorerUI : null);
    if (!engine || typeof engine.scoreTexts !== "function") return null;
    return function score(texts) {
      return engine.scoreTexts(texts).then((values) =>
        values.map((value) => (Number.isFinite(value) ? -value : NaN)),
      );
    };
  }

  /** Оценка модели, если она доступна; иначе детерминированная. */
  function bestAvailableScorer(language, scorer) {
    return perplexityScorer(scorer) || deterministicScorer(language);
  }

  return {
    generate,
    select,
    improve,
    improveSync,
    polishSentences,
    sentenceVariants,
    deterministicScorer,
    perplexityScorer,
    bestAvailableScorer,
    REWRITE_COMBINATIONS,
  };
});
