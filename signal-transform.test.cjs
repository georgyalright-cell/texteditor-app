"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const metrics = require("./humanizer-metrics.js");
const paraphraser = require("./paraphraser.js");

// Инвариант из CLAUDE.md: каждый сигнал, который меряет humanizer-metrics.js,
// должен иметь трансформацию, способную его сдвинуть. Фраза в стоп-листе без
// правила в paraphraser.js делает признак недостижимым — замкнутый цикл
// тратит на неё раунд и откатывается, а оценка не падает никогда.
//
// Проверка механическая, потому что вручную это не отслеживается: список
// штампов и список правил лежат в разных файлах и правятся по отдельности.

function contexts(phrase, language) {
  return language === "en"
    ? [
        `${phrase} that the team shipped the release on time and the plan held.`,
        `${phrase}, the team shipped the release on time and the plan held.`,
        `The team ${phrase} the release schedule and the plan held for two quarters.`,
        `${phrase} of the schedule kept the release on time for two quarters running.`,
      ]
    : [
        `${phrase}, что команда выпустила релиз вовремя и план сохранился.`,
        `${phrase}, команда выпустила релиз вовремя и план сохранился полностью.`,
        `Команда ${phrase} график релиза, и план сохранился на два квартала вперёд.`,
        `${phrase} графика удержало релиз в сроке на два квартала подряд.`,
      ];
}

// Единственное осознанное исключение: «трудно переоценить» требует перестройки
// предложения («трудно переоценить роль X» → «роль X велика»), а не подстановки
// оборота. Словарная замена здесь только поменяла бы один штамп на другой.
const WITHOUT_TRANSFORM = new Set(["трудно переоценить"]);

function orphans(list, language) {
  return list.filter(
    (phrase) =>
      !WITHOUT_TRANSFORM.has(phrase) &&
      !contexts(phrase, language).some((probe) => paraphraser.paraphraseText(probe, language).text !== probe),
  );
}

test("у каждого английского штампа есть трансформация", () => {
  assert.deepEqual(orphans(metrics.CLICHE_EN, "en"), []);
});

test("у каждого русского штампа есть трансформация", () => {
  assert.deepEqual(orphans(metrics.CLICHE_RU, "ru"), []);
});

test("диалект бизнес-плана поднимает оценку до обработки", () => {
  const text =
    "This business plan provides a comprehensive framework for achieving long-term success " +
    "by aligning strategic goals with proactive risk management, and the company is well-positioned " +
    "to capture significant market share through rigorous monitoring of data-driven decision-making.";
  assert.ok(metrics.scoreText(text).cliche > 0, "консалтинговый текст обязан давать ненулевой сигнал штампов");
});

test("словарь снимает диалект бизнес-плана, не трогая термины", () => {
  const text =
    "The plan provides a comprehensive framework and proactive risk management, " +
    "and the company is well-positioned to capture significant market share.";
  const result = paraphraser.paraphraseText(text, "en");
  assert.match(result.text, /a framework/);
  assert.match(result.text, /risk management/);
  assert.doesNotMatch(result.text, /comprehensive framework/);
  assert.doesNotMatch(result.text, /well-positioned/);
  // Термин с содержанием остаётся на месте.
  assert.match(paraphraser.paraphraseText("The value proposition is clear.", "en").text, /value proposition/);
});

// Второй инвариант, того же рода: словарь заменяет связку на синоним, и если
// синонима нет в списке дискурсивных зачинов, сигнал обнуляется, хотя текст
// не изменился по характеру. Всё, во что словарь превращает связки, обязано
// оставаться под наблюдением.
require("./anchor-guard.js");

function producedByDictionary(language) {
  const seeds = language === "ru"
    ? ["Кроме того, ", "Более того, ", "Таким образом, ", "Следует отметить, что ", "Важно отметить, что "]
    : ["Moreover, ", "Furthermore, ", "Additionally, "];
  const produced = new Set();
  for (const seed of seeds) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const probe = `${seed}команда выпустила релиз вовремя и план сохранился на ${attempt} квартала.`;
      const result = paraphraser.paraphraseText(probe, language).text.toLocaleLowerCase(language);
      const opener = result.replace(/^[^\p{L}]+/u, "").slice(0, 30);
      produced.add(opener);
    }
  }
  return produced;
}

test("во что словарь превращает связки, то и остаётся под наблюдением", () => {
  const watched = metrics.DISCOURSE_RU;
  const missed = [];
  for (const opener of producedByDictionary("ru")) {
    if (!watched.some((phrase) => opener.startsWith(phrase))) missed.push(opener.slice(0, 24));
  }
  assert.deepEqual(missed, [], `сигнал отмывается через: ${missed.join(" | ")}`);
});

// Обороты, которые словарь ПРОИЗВОДИТ, обязаны иметь путь снятия: иначе
// замена «кроме того» на «наряду с этим» просто перекладывает признак в
// место, откуда его уже нечем убрать.
const DICTIONARY_OUTPUT = [
  "наряду с этим", "помимо этого", "к тому же", "в результате", "в итоге",
  "отметим", "заметим", "подчеркнём",
];

function multiSentenceProbe(phrase) {
  const head = phrase[0].toUpperCase() + phrase.slice(1);
  const tail = /(?:отметим|заметим|подчеркнём)$/u.test(phrase) ? ", что" : ",";
  // Проба из нескольких предложений: на одном зона намеренно оставляет
  // единственную связку, и пасс честно не срабатывает.
  return [
    `${head}${tail} команда выпустила релиз вовремя и план сохранился.`,
    `${head}${tail} склад стал быстрее на треть за один квартал.`,
    `${head}${tail} выручка выросла и продажи не останавливались.`,
    "Отдельно выросли продажи в двух регионах за тот же период.",
    "Команда собрала прототип за шесть недель без внешней поддержки.",
  ].join(" ");
}

test("обороты, в которые словарь превращает связки, снимаются пассами", () => {
  const orphans = DICTIONARY_OUTPUT.filter((phrase) => {
    const probe = multiSentenceProbe(phrase);
    return !passes.applyPass(probe, "connectives", { language: "ru" }).changed
      && !passes.applyPass(probe, "reduction", { language: "ru" }).changed;
  });
  assert.deepEqual(orphans, [], `сигнал перекладывается в тупик: ${orphans.join(" | ")}`);
});

// ─── Отмывание связок ────────────────────────────────────────────────────
//
// Второй вид того же инварианта. Словарь варьирует связки в начале
// предложения, чтобы абзацы не начинались одинаково, — и в этот момент
// может подменить наблюдаемую связку синонимом, которого сигнал не видит
// или который нечем снять. Тогда оценка падает, а текст не меняется.
//
// Проверка нашла ровно это: «furthermore» превращалось в «Beyond that»,
// сигнал его считал, а в списке пасса 21 его не было.

const passes = require("./edit-passes.js");

function openerOf(text) {
  return String(text).replace(/^[^\p{L}]+/u, "").toLocaleLowerCase("ru");
}

function watched(list, opener) {
  return list.some((phrase) => opener.startsWith(phrase));
}

function removable(phrase, language) {
  const filler = Array.from({ length: 6 }, (_, index) =>
    language === "ru"
      ? `Предложение номер ${index + 1} несёт обычное содержание для пасса.`
      : `Sentence number ${index + 1} carries ordinary content for the pass.`,
  ).join(" ");
  const capital = phrase.charAt(0).toLocaleUpperCase(language) + phrase.slice(1);
  const tail = language === "ru" ? "команда выпустила релиз вовремя." : "the team shipped the release on time.";
  // Три вхождения, а не два: пасс 21 намеренно оставляет хотя бы одну связку
  // ради нижней границы зоны жанра, и на двух он не снимает ни одной.
  const source = `${filler} ${capital}, ${tail} ${capital}, ${tail} ${capital}, ${tail}`;
  // Проверяется существование правки, а не её автоматическое применение.
  // Противительные и итоговые связки пасс держит на medium намеренно: их
  // снятие меняет логику, и решает автор. Но путь снятия у них есть, и
  // инвариант ровно об этом.
  const proposal = passes.propose(source, { language });
  return proposal.edits.some(
    (edit) => edit.before && edit.before.toLocaleLowerCase(language).includes(phrase),
  );
}

for (const language of ["ru", "en"]) {
  const list = language === "ru" ? metrics.DISCOURSE_RU : metrics.DISCOURSE_EN;

  test(`${language}: словарь не подменяет связку тем, чего сигнал не видит`, () => {
    const laundered = [];
    for (const phrase of list) {
      const capital = phrase.charAt(0).toLocaleUpperCase(language) + phrase.slice(1);
      const tail = language === "ru" ? "команда выпустила релиз вовремя." : "the team shipped the release on time.";
      const rewritten = paraphraser.paraphraseText(`${capital}, ${tail}`, language).text;
      const opener = openerOf(rewritten);
      if (!opener) continue;
      if (!watched(list, opener)) laundered.push(`${phrase} → ${opener.slice(0, 30)}`);
    }
    assert.deepEqual(laundered, [], `связка подменена на ненаблюдаемую: ${laundered.join("; ")}`);
  });

  test(`${language}: каждую наблюдаемую связку есть чем снять`, () => {
    // Противительные связки несут логику, их снятие меняет смысл — пасс 21
    // держит их на medium и по умолчанию не применяет. Проверяются только
    // присоединительные и итоговые.
    const logical = language === "ru"
      ? ["однако", "тем не менее", "с одной стороны", "с другой стороны", "в то же время", "вместе с тем"]
      : ["however", "nevertheless", "nonetheless", "on the one hand", "on the other hand", "that said"];
    // Вводные обороты вида «важно отметить, что» снимает пасс 18, и снимает
    // вместе с придаточным — в конструкции без «что» их проверять нечем.
    const leadIn = /^(во-|в-|firstly|secondly|thirdly|it is|it should|важно отметить|следует отметить|стоит отметить|необходимо отметить|отметим|заметим|подчеркнём)/u;
    const orphans = list.filter(
      (phrase) => !logical.includes(phrase) && !leadIn.test(phrase) && !removable(phrase, language),
    );
    assert.deepEqual(orphans, [], `связка без пути снятия: ${orphans.join(", ")}`);
  });
}
