(function attachTextPipeline(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TextPipeline = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createTextPipeline(root) {
  "use strict";

  function pluralForm(value, one, few, many) {
    const absolute = Math.abs(value) % 100;
    const last = absolute % 10;
    if (absolute > 10 && absolute < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function changeSummary(stats) {
    const labels = [
      [stats.artifacts, ["артефакт", "артефакта", "артефактов"]],
      [stats.punctuation, ["знак препинания", "знака препинания", "знаков препинания"]],
      [stats.spacing, ["пробел", "пробела", "пробелов"]],
      [stats.joinedBreaks, ["разрыв строки", "разрыва строк", "разрывов строк"]],
      [stats.duplicates, ["повтор", "повтора", "повторов"]],
      [stats.paragraphsCreated, ["новый абзац", "новых абзаца", "новых абзацев"]],
    ];
    return labels.filter(([count]) => count > 0).map(([count, forms]) => `${count} ${pluralForm(count, ...forms)}`);
  }

  function summary(cleaningStats, paraphrased, humanized, typographyStats) {
    const parts = [];
    if (paraphrased.replacements > 0) {
      const label = pluralForm(paraphrased.replacements, "оборот", "оборота", "оборотов");
      parts.push(`Безопасные словарные правки: изменено ${paraphrased.replacements} ${label}.`);
    } else {
      parts.push("Безопасные словарные правки: подходящих замен не найдено.");
    }
    parts.push(root.HumanizerEngine.describeRounds(humanized));
    // Предупреждение отвязано от цели цикла. Цель — медиана живого корпуса,
    // и не дойти до неё нормально: три четверти живых текстов до неё тоже не
    // доходят. Тревожит не это, а оставшаяся заметная машинность, то есть
    // выход за третий квартиль.
    const quiet = root.HumanizerEngine.quietBelow
      ? root.HumanizerEngine.quietBelow(humanized.language)
      : humanized.target;
    if (!humanized.reachedTarget && humanized.after && humanized.after.score > quiet) {
      parts.push(
        `Оценка ${humanized.after.score} осталась выше типичной для живого текста (${quiet}): ` +
          "для оставшихся признаков нет замены, которая гарантированно не сломает грамматику, — " +
          "их нужно править вручную.",
      );
    }
    const cleaning = changeSummary(cleaningStats);
    if (cleaning.length) parts.push(`Дополнительно исправлено: ${cleaning.join(", ")}.`);
    const typographyChanges = root.Typography.changeCount(typographyStats);
    if (typographyChanges > 0) {
      parts.push(
        `Типографика: приведено ${typographyChanges} ` +
          `${pluralForm(typographyChanges, "знак", "знака", "знаков")}.`,
      );
    }
    return parts;
  }

  // Свободный режим включается по бедности текста фактами, а не по желанию.
  //
  // Небрежность уместна там, где автор рассуждает, и неуместна там, где он
  // приводит числа: в плотном отчёте «Но» вместо «Однако» выглядит
  // разболтанностью, а в тексте из одних общих слов — живой речью. Порог тот
  // же, что у нижней границы зоны A1: три якоря на сто слов.
  const LOOSE_ANCHOR_LIMIT = 3;

  function looseNeeded(text) {
    const guard = root.AnchorGuard;
    if (!guard) return false;
    const words = root.TextProcessor.countWords(text);
    if (!words) return false;
    return (guard.extractAnchors(text).length * 100) / words < LOOSE_ANCHOR_LIMIT;
  }

  function run(text, options) {
    const required = [
      root.TextProcessor,
      root.RuleParaphraser,
      root.StructuralRewriter,
      root.HumanizerEngine,
      root.Typography,
      root.HumanizerMetrics,
    ];
    if (required.some((item) => !item)) throw new Error("Один из модулей обработки не загрузился. Обновите страницу.");
    const outcome = root.TextProcessor.processText(text);
    // Полный словарный проход был частью последней версии инструмента и не
    // должен зависеть от порога замкнутого цикла. Цикл запускается следом и
    // работает уже с тире, ритмом, антитезами и оставшимися штампами.
    const references = root.ReferenceGuard || (typeof require === "function" ? require("./reference-guard.js") : null);
    let paraphrased = references ? references.transform(outcome.text, (value) => root.RuleParaphraser.paraphraseText(value)) : root.RuleParaphraser.paraphraseText(outcome.text);
    // Словарь даёт несколько допустимых версий там, где у правила есть
    // варианты замены. Раньше выбор делал хеш абзаца — произвольно и
    // безальтернативно; теперь версии сравниваются по оценке. Слои рерайтера
    // в набор не входят: структурной работой занят замкнутый цикл ниже.
    if (root.CandidateSelect) {
      const chosen = root.CandidateSelect.improveSync(outcome.text, {
        language: paraphrased.language,
        layers: false,
      });
      if (chosen.improved) {
        paraphrased = Object.assign({}, paraphrased, { text: chosen.text, selected: chosen.chosen });
      }
    }
    // Разноминализация проходит один раз здесь, а не действием цикла.
    // Причина в измерении: метрика A6 считает суффиксы, и большую часть её
    // веса дают обычные слова предметной области — «производство»,
    // «образование», «operations», «equipment». Развернуть их в глагол
    // нельзя, значит и рулём для цикла эта метрика служить не может: сигнал,
    // который транформация не двигает, заставляет цикл гнаться за
    // недостижимым. То, что развернуть можно, разворачивается один раз, а
    // цепочки, требующие согласования падежей, уходят автору в панель.
    let denominalized = { text: paraphrased.text, applied: 0 };
    if (root.EditPasses) {
      const pass = root.EditPasses.applyPass(paraphrased.text, "denominalization", {
        language: paraphrased.language,
      });
      if (pass.changed) denominalized = pass;
    }
    // Типографика идёт ДО цикла, а не после. Она обязана набрать дефис между
    // словами длинным тире — это правильный набор, — но длинное тире и есть
    // самый заметный машинный признак, и цикл его штрафует тяжелее прочих.
    // Пока порядок был обратным, слой набора возвращал тире, которые цикл
    // только что разобрал, и оценка отыгрывала назад. Теперь цикл видит
    // финальные знаки и сам решает, какие из них разворачивать в предложение
    // или в скобки, а какие оставить: тире, которое он оставил, остаётся
    // осознанным решением, а не следствием порядка вызовов.
    const typography = root.Typography.normalize(denominalized.text);
    const loose = looseNeeded(typography.text);
    const humanized = root.HumanizerEngine.humanize(typography.text, {
      language: paraphrased.language,
      loose,
    });
    // Сторож на выходе. Замкнутый цикл не принимает шаг, поднимающий оценку,
    // но слои до него — словарь, отбор вариантов, типографика — оценкой не
    // проверяются вовсе. На живых текстах это давало то, чего быть не должно:
    // инструмент возвращал текст ХУЖЕ присланного. Здесь итог сравнивается с
    // вычищенным исходником, и если правки в сумме навредили, возвращается он.
    // Сравнение идёт с текстом ДО словаря: именно словарная замена может
    // поднять оценку, и если сравнивать с уже перефразированным вариантом,
    // её вред войдёт в базу сравнения и останется незамеченным.
    const cleanedScore = root.HumanizerMetrics.scoreText(outcome.text, paraphrased.language).score;
    const finalScore = root.HumanizerMetrics.scoreText(humanized.text, paraphrased.language).score;
    const regressed = finalScore > cleanedScore;
    let finalText = regressed ? outcome.text : humanized.text;
    const guardWarnings = regressed
      ? ["Правки в сумме подняли оценку машинности, поэтому оставлен вычищенный исходник."]
      : [];
    const terms = options && options.terms || [];
    const quality = root.RevisionQuality || (typeof require === "function" ? require("./revision-quality.js") : null);
    const termsChanged = terms.length && quality && !quality.termsPreserved(String(text), finalText, terms);
    if (termsChanged) {
      finalText = String(text);
      guardWarnings.push("Базовые замены отменены: они затрагивали защищённые термины. Исходный текст сохранён.");
    }
    if (references && !references.compare(text, finalText)) {
      finalText = outcome.text;
      guardWarnings.push("Замены, затрагивающие ссылки, отменены. Ссылки сохранены как в исходнике.");
    }

    return {
      text: finalText,
      language: humanized.language,
      summary: termsChanged ? ["Защищённые термины сохранены; базовые замены не применены."] : summary(outcome.stats, paraphrased, humanized, typography.stats),
      terms,
      metricsBefore: root.HumanizerMetrics.scoreText(outcome.text, paraphrased.language),
      warnings: [...outcome.warnings, ...paraphrased.warnings, ...humanized.warnings, ...guardWarnings],
    };
  }

  function headingCandidates(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line.length < 90 && !/[.!?…]$/u.test(line) && root.TextProcessor.countWords(line) <= 12);
  }

  function reviewMessage(review) {
    if (!review) return "";
    if (review.deepRevision) {
      const deep = review.deepRevision;
      const share = Math.round((deep.changedWordShare || 0) * 100);
      return `Глубокая редакция: обновлено ${deep.replaced} из ${deep.totalSentences} предложений, охвачено около ${share}% слов.`;
    }
    if (!review.editsTotal) return "";
    if (!review.editsAccepted) return `Композиционные правки предложены (${review.editsTotal}), но ни одна не принята.`;
    const label = pluralForm(review.editsAccepted, "правка", "правки", "правок");
    const share = Math.round((review.applied.removedShare || 0) * 100);
    return `Композиционные правки: принято ${review.editsAccepted} ${label} из ${review.editsTotal}, текст короче на ${share}%.`;
  }

  return { run, headingCandidates, reviewMessage };
});
