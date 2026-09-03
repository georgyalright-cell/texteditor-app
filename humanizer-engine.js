(function attachHumanizerEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HumanizerEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createHumanizerEngine() {
  "use strict";

  // Замкнутый цикл гуманизации: переписал → измерил → принял или откатил.
  //
  // Прежде оценка HumanizerMetrics считалась последней и только рисовалась в
  // интерфейсе — обратной связи не было, поэтому текст обрабатывался ровно
  // один раз независимо от результата. Здесь оценка становится управляющим
  // сигналом: каждый раунд выбирается та трансформация, которая сейчас даёт
  // наибольший вклад в оценку, и её результат принимается только если оценка
  // упала и якоря текста (числа, ссылки, абзацы, объём) не пострадали.

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const NUMBER_RE = /\d+(?:[.,]\d+)?/gu;
  const URL_RE = /https?:\/\/[^\s<>()]+/giu;

  const DEFAULT_TARGET = 12;
  const DEFAULT_MAX_ROUNDS = 12;
  // Каждая трансформация может отработать дважды: слой ритма меняет число
  // предложений, а от него зависит норма по тире, поэтому второй проход по
  // тире после ритма нередко снимает ещё несколько вхождений.
  const ACTION_BUDGET = 3;

  // Какой компонент оценки лечит каждый шаг — по нему и судится результат.
  const ACTION_COMPONENTS = {
    dash: "emDash",
    rhythm: "burstiness",
    cliche: "cliche",
    antithesis: "antithesis",
    openers: "openerRepeat",
    discourse: "discourse",
    hedge: "hedge",
    paragraphs: "paragraphs",
  };

  const ACTION_LABELS = {
    dash: "тире-коннекторы",
    rhythm: "ритм предложений",
    cliche: "шаблонные обороты",
    antithesis: "антитезы",
    openers: "однообразные зачины",
    discourse: "связки в начале предложения",
    hedge: "хеджи",
    paragraphs: "ровные абзацы",
  };

  // Явно переданный ключ имеет приоритет над глобалом, даже если он пустой:
  // иначе подстановка модулей в тестах молча подменялась бы настоящими и
  // изолировать шаг было бы нельзя.
  // В браузере модуль лежит в globalThis, в Node его подтягивает require.
  // Без этого цикл в тестах молча терял два действия из семи и упирался в
  // порог, который в приложении проходится.
  function loadAnchorGuard() {
    if (typeof globalThis !== "undefined" && globalThis.AnchorGuard) return globalThis.AnchorGuard;
    if (typeof require !== "function") return null;
    try {
      return require("./anchor-guard.js");
    } catch (error) {
      return null;
    }
  }

  function loadPasses() {
    if (typeof require !== "function") return null;
    try {
      return require("./edit-passes.js");
    } catch (error) {
      return null;
    }
  }

  function modules(overrides) {
    const scope = typeof globalThis !== "undefined" ? globalThis : {};
    const given = overrides || {};
    const pick = (key, fallback) =>
      (Object.prototype.hasOwnProperty.call(given, key) ? given[key] : fallback);
    return {
      metrics: pick("metrics", scope.HumanizerMetrics),
      paraphraser: pick("paraphraser", scope.RuleParaphraser),
      rewriter: pick("rewriter", scope.StructuralRewriter),
      passes: pick("passes", scope.EditPasses || loadPasses()),
    };
  }

  function countWords(text) {
    return (String(text).match(WORD_RE) || []).length;
  }

  function anchors(text, pattern) {
    const compiled = new RegExp(pattern.source, pattern.flags);
    return (String(text).match(compiled) || []).map((item) => item.toLocaleLowerCase("ru")).sort();
  }

  function sameAnchors(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function paragraphCount(text) {
    return String(text).split(/\n{2,}/u).length;
  }

  const DELETING_ACTIONS = new Set(["cliche", "discourse", "hedge"]);
  const CUMULATIVE_MIN_RATIO = 0.65;
  const STEP_MIN_DELETING = 0.6;
  const STEP_MIN_STRUCTURAL = 0.9;

  /** Отклонение объёма между двумя версиями. */
  function volumeIssues(source, result, minRatio) {
    const sourceWords = countWords(source);
    if (!sourceWords) return [];
    const ratio = countWords(result) / sourceWords;
    if (ratio < minRatio) return ["потеряна часть текста"];
    if (ratio > 1.25) return ["текст разросся сверх меры"];
    return [];
  }

  /** Якоря, которые обязаны пережить любую трансформацию. */
  function integrityIssues(source, result, minRatio, allowReflow) {
    const issues = [];
    if (!String(result).trim()) issues.push("получился пустой текст");
    const guard = loadAnchorGuard();
    if (guard) {
      const check = guard.compare(source, result);
      if (!check.ok) issues.push(guard.describe(check));
    } else {
      // Запасной путь на случай, когда гард не загрузился: беднее, но лучше,
      // чем отсутствие проверки вовсе.
      if (!sameAnchors(anchors(source, NUMBER_RE), anchors(result, NUMBER_RE))) issues.push("изменились числа");
      if (!sameAnchors(anchors(source, URL_RE), anchors(result, URL_RE))) issues.push("изменились ссылки");
    }
    if (!allowReflow && paragraphCount(source) !== paragraphCount(result)) {
      issues.push("изменилась разбивка на абзацы");
    }
    issues.push(...volumeIssues(source, result, minRatio === undefined ? 0.85 : minRatio));
    return issues;
  }

  /**
   * Следующая трансформация — та, чей вклад в текущую оценку максимален.
   * Веса те же, что в scoreText; антитеза берётся сырым значением, потому
   * что она поднимает итог снизу, а не усредняется.
   */
  function nextAction(result, budgets) {
    const weighted =
      0.28 * result.emDash + 0.24 * result.burstiness + 0.18 * result.cliche +
      0.11 * result.discourse + 0.09 * result.openerRepeat + 0.07 * result.hedge +
      0.06 * result.paragraphs;
    // Антитеза не усредняется, а поднимает итог снизу. Пока итог держат другие
    // сигналы, её правка не сдвинет оценку и шаг выглядел бы бесполезным,
    // поэтому наверх она поднимается только когда становится связывающим
    // ограничением; в остальных случаях идёт последней, но не выбывает.
    const antithesis = result.antithesis === 0
      ? 0
      : (result.antithesis > weighted ? result.antithesis + 1000 : 0.5);
    return [
      { id: "antithesis", weight: antithesis },
      { id: "dash", weight: 0.28 * result.emDash },
      { id: "rhythm", weight: 0.24 * result.burstiness },
      { id: "cliche", weight: 0.18 * result.cliche },
      { id: "discourse", weight: 0.12 * result.discourse },
      { id: "openers", weight: 0.1 * result.openerRepeat },
      { id: "hedge", weight: 0.07 * result.hedge },
      { id: "paragraphs", weight: 0.06 * result.paragraphs },
    ]
      .filter((item) => item.weight > 0 && budgets[item.id] > 0)
      .sort((left, right) => right.weight - left.weight)
      .map((item) => item.id)[0] || null;
  }

  const PASS_ACTIONS = { discourse: ["connectives", "reduction"], hedge: ["reduction"] };

  function applyAction(id, text, language, deps) {
    if (PASS_ACTIONS[id]) {
      if (!deps.passes) return { text, changed: false, warnings: [] };
      // Пассы пробуются по очереди: связку снимает пасс 21, а вводный оборот
      // в начале предложения — пасс 18, и оба дают один и тот же признак.
      for (const passId of PASS_ACTIONS[id]) {
        const outcome = deps.passes.applyPass(text, passId, { language });
        if (outcome.changed) {
          return { text: outcome.text, changed: true, warnings: outcome.warnings || [] };
        }
      }
      return { text, changed: false, warnings: [] };
    }
    if (id === "cliche") {
      const outcome = deps.paraphraser.paraphraseText(text, language);
      return { text: outcome.text, changed: outcome.replacements > 0, warnings: outcome.warnings || [] };
    }
    const options = { language, dashes: false, antithesis: false, rhythm: false, openers: false };
    options[id === "dash" ? "dashes" : id] = true;
    const outcome = deps.rewriter.rewrite(text, options);
    const changed = Object.keys(outcome.actions).some((key) => outcome.actions[key] > 0);
    return { text: outcome.text, changed, warnings: [], detail: outcome.actions };
  }

  function humanize(input, options) {
    const settings = options || {};
    const deps = modules(settings.modules);
    const source = String(input || "");
    const missing = ["metrics", "paraphraser", "rewriter"].filter((name) => !deps[name]);
    if (missing.length) throw new Error(`HumanizerEngine: не загружены модули ${missing.join(", ")}`);

    const language = settings.language || deps.metrics.detectLanguage(source);
    const target = typeof settings.target === "number" ? settings.target : DEFAULT_TARGET;
    const maxRounds = typeof settings.maxRounds === "number" ? settings.maxRounds : DEFAULT_MAX_ROUNDS;

    const before = deps.metrics.scoreText(source, language);
    const rounds = [];
    const warnings = [];
    const applied = { dash: 0, rhythm: 0, cliche: 0, antithesis: 0 };
    const budgets = {
      dash: ACTION_BUDGET,
      rhythm: ACTION_BUDGET,
      cliche: ACTION_BUDGET,
      antithesis: ACTION_BUDGET,
      openers: ACTION_BUDGET,
      discourse: ACTION_BUDGET,
      hedge: ACTION_BUDGET,
      paragraphs: 1,
    };

    let text = source;
    let current = before;

    for (let round = 1; round <= maxRounds && current.score > target; round += 1) {
      const action = nextAction(current, budgets);
      if (!action) break;
      budgets[action] -= 1;

      const outcome = applyAction(action, text, language, deps);
      if (outcome.warnings.length) warnings.push(...outcome.warnings);
      if (!outcome.changed) {
        budgets[action] = 0;
        rounds.push({ round, action, label: ACTION_LABELS[action], score: current.score, accepted: false, reason: "нечего менять" });
        continue;
      }

      const stepFloor = DELETING_ACTIONS.has(action) ? STEP_MIN_DELETING : STEP_MIN_STRUCTURAL;
      const issues = [
        ...integrityIssues(source, outcome.text, CUMULATIVE_MIN_RATIO, action === "paragraphs"),
        ...volumeIssues(text, outcome.text, stepFloor),
      ];
      if (issues.length) {
        budgets[action] = 0;
        warnings.push(`Шаг «${ACTION_LABELS[action]}» отменён: ${issues.join(", ")}.`);
        rounds.push({ round, action, label: ACTION_LABELS[action], score: current.score, accepted: false, reason: issues.join(", ") });
        continue;
      }

      const scored = deps.metrics.scoreText(outcome.text, language);
      const component = ACTION_COMPONENTS[action];
      // Судим шаг по его собственному сигналу, а не по итогу: пока итог держит
      // другой, более тяжёлый сигнал, полезная правка выглядела бы бесполезной
      // и отбрасывалась. Требование к итогу — только не ухудшиться.
      // Шаг принимается, если продвинулся хоть один из двух показателей — свой
      // сигнал или общая оценка, — и при этом общая оценка не выросла.
      //
      // Оба условия нужны по разным причинам. Компонент emDash насыщается: при
      // норме в одно тире любое превышение от двух даёт уже 100, и снятие двух
      // тире из пяти оставляет компонент неподвижным, хотя итог падает. Обратно,
      // пока итог держит более тяжёлый сигнал, полезная правка лёгкого сигнала
      // итог не сдвинет. Проверка только по одному из показателей отбрасывала
      // верные шаги в обоих случаях.
      const improvedComponent = scored[component] < current[component];
      const improvedScore = scored.score < current.score;
      if (scored.score > current.score || (!improvedComponent && !improvedScore)) {
        // Шаг, ухудшивший итог, остаётся в очереди: когда более тяжёлые сигналы
        // упадут, он может пройти. Ничего не давший шаг выбывает сразу.
        if (scored.score <= current.score) budgets[action] = 0;
        rounds.push({
          round,
          action,
          label: ACTION_LABELS[action],
          score: current.score,
          accepted: false,
          reason: scored.score > current.score ? "итоговая оценка ухудшилась" : "ничего не улучшилось",
        });
        continue;
      }

      text = outcome.text;
      current = scored;
      applied[action] += 1;
      rounds.push({ round, action, label: ACTION_LABELS[action], score: scored.score, accepted: true, detail: outcome.detail });
    }

    return {
      text,
      language,
      before,
      after: current,
      reachedTarget: current.score <= target,
      target,
      rounds,
      applied,
      warnings,
    };
  }

  function describeRounds(result) {
    const accepted = result.rounds.filter((item) => item.accepted);
    if (!accepted.length) return "Правки не потребовались: оценка уже в пределах порога.";
    const steps = accepted.map((item) => `${item.label} → ${item.score}`);
    return `Гуманизация: ${result.before.score} → ${result.after.score} за ${accepted.length} ` +
      `${accepted.length === 1 ? "раунд" : accepted.length < 5 ? "раунда" : "раундов"} (${steps.join("; ")}).`;
  }

  return { humanize, describeRounds, integrityIssues, DEFAULT_TARGET, ACTION_LABELS };
});
