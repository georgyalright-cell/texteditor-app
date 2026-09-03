"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const metrics = require("./humanizer-metrics.js");
const paraphraser = require("./paraphraser.js");
const rewriter = require("./rewriter.js");
const engine = require("./humanizer-engine.js");

const RU_SAMPLE =
  "В современном мире важно отметить, что система играет ключевую роль в подготовке документа — это не подлежит сомнению. " +
  "На сегодняшний день инструмент обрабатывает широкий спектр форматов — он принимает docx, pdf и txt. " +
  "Таким образом, обработка осуществляется локально — данные не покидают устройство пользователя.\n\n" +
  "Это не просто редактор, а полноценная среда — авторы проверили её на выборке из 40 работ за 2023—2024 годы. " +
  "Кроме того, следует отметить, что сборка документа выполняется по методичке — структура разделов задаётся профилем формата.";

const EN_SAMPLE =
  "It is important to note that the system utilizes a wide range of cutting-edge methods — this is a testament to the design. " +
  "Moreover, the approach leverages state-of-the-art tooling — it delivers seamless integration. " +
  "The framework is not just fast, but reliable — the reviewer confirmed this in testing.";

test("оценка падает, и падает по всем четырём сигналам", () => {
  const result = engine.humanize(RU_SAMPLE);
  assert.ok(result.after.score < result.before.score, `${result.after.score} должно быть меньше ${result.before.score}`);
  for (const signal of ["emDash", "burstiness", "cliche", "antithesis"]) {
    assert.ok(
      result.after[signal] <= result.before[signal],
      `${signal}: ${result.after[signal]} не должно превышать ${result.before[signal]}`,
    );
  }
});

test("цикл доводит текст до порога", () => {
  const result = engine.humanize(EN_SAMPLE, { target: 25 });
  assert.equal(result.reachedTarget, true, `оценка осталась ${result.after.score}`);
});

test("шаг принимается, когда его сигнал упёрся в потолок, но итог падает", () => {
  // emDash насыщается: превышение от двух тире над нормой уже даёт 100, и
  // снятие части тире оставляет компонент на месте. Проверка только по
  // компоненту отбрасывала бы этот шаг, хотя итоговая оценка снижается.
  const result = engine.humanize(RU_SAMPLE);
  const dashRound = result.rounds.find((item) => item.action === "dash");
  assert.ok(dashRound, "шаг по тире должен быть в трассе");
  assert.equal(dashRound.accepted, true, `отклонён: ${dashRound.reason}`);
});

test("сигнал, перекрытый более тяжёлым, всё равно доходит до правки", () => {
  // Антитеза поднимает итог снизу и в начале прогона перекрыта штампами и
  // тире. Раньше её шаг отбрасывался в первом же раунде и больше не повторялся.
  const result = engine.humanize(RU_SAMPLE);
  assert.equal(result.after.antithesis, 0, "антитеза должна быть снята");
  assert.ok(result.applied.antithesis > 0, "шаг по антитезам должен быть применён");
});

test("шаг, испортивший числа, откатывается, а текст остаётся исходным", () => {
  const brokenRewriter = {
    rewrite(text) {
      return { text: String(text).replace(/40/u, "48"), actions: { dashes: 1, antithesis: 0, splits: 0, merges: 0 } };
    },
    detectLanguage: rewriter.detectLanguage,
  };
  const result = engine.humanize(RU_SAMPLE, {
    // passes: null изолирует шаг до одного рерайтера — иначе композиционные
    // пассы правят текст сами и проверка «остался исходным» ничего не значит.
    modules: {
      metrics,
      paraphraser: { paraphraseText: (text) => ({ text, replacements: 0, warnings: [] }) },
      rewriter: brokenRewriter,
      passes: null,
    },
  });
  assert.equal(result.text, RU_SAMPLE);
  // Гард называет конкретный якорь, а не факт расхождения: «пропало число 40,
  // появилось 48» показывает, что именно сломало правило.
  assert.ok(
    result.warnings.some((item) => /число «40»/u.test(item) && /число «48»/u.test(item)),
    result.warnings.join(" | "),
  );
});

test("разбивка на абзацы и якоря текста переживают весь цикл", () => {
  const result = engine.humanize(RU_SAMPLE);
  assert.equal(result.text.split(/\n{2,}/u).length, RU_SAMPLE.split(/\n{2,}/u).length);
  assert.deepEqual(result.text.match(/\d+/gu).sort(), RU_SAMPLE.match(/\d+/gu).sort());
  assert.equal(engine.integrityIssues(RU_SAMPLE, result.text).length, 0);
});

test("трасса раундов пригодна для показа пользователю", () => {
  const result = engine.humanize(RU_SAMPLE);
  assert.ok(result.rounds.length > 0);
  for (const round of result.rounds) {
    assert.ok(engine.ACTION_LABELS[round.action], `нет подписи для шага ${round.action}`);
    assert.equal(typeof round.accepted, "boolean");
  }
  assert.match(engine.describeRounds(result), /Гуманизация: \d+ → \d+/u);
});

test("чистый текст не переписывается впустую", () => {
  const clean = "Работа описывает метод сборки документа. Метод опирается на профиль формата. Профиль задаёт порядок разделов.";
  const result = engine.humanize(clean);
  assert.equal(result.text, clean);
  assert.equal(result.applied.dash + result.applied.cliche + result.applied.antithesis, 0);
});

test("отсутствие модуля сообщается явно, а не падает где-то внутри", () => {
  assert.throws(
    () => engine.humanize("текст", { modules: { metrics, paraphraser: null, rewriter } }),
    /не загружены модули paraphraser/u,
  );
});
