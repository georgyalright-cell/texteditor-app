"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("./anchor-guard.js");
const passes = require("./edit-passes.js");

function applyAll(text, filter) {
  const proposal = passes.propose(text, {});
  const edits = proposal.edits.map((edit) =>
    Object.assign({}, edit, { accepted: filter ? filter(edit) : edit.accepted }),
  );
  return { proposal, result: passes.apply(text, edits) };
}

test("спан правки совпадает с текстом байт в байт", () => {
  const text = "В данном разделе рассматривается рынок. Кроме того, выручка выросла на 12% в 2024 году. Безусловно, это результат.";
  const proposal = passes.propose(text, {});
  for (const edit of proposal.edits) {
    assert.equal(text.slice(edit.start, edit.end), edit.before);
  }
});

test("после удаления вводного оборота предложение снова с заглавной буквы", () => {
  const text = "Безусловно, компания выросла на 12% за 2024 год. Кроме того, выручка удвоилась по данным отчёта.";
  const { result } = applyAll(text, (edit) => edit.confidence === "high");
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /^\p{Ll}/u);
  assert.doesNotMatch(result.text, /\.\s+\p{Ll}/u);
});

test("правки откатываются целиком, если якорь пропал или появился", () => {
  const text = "Безусловно, выручка составила 12 млн руб. за 2024 год.";
  const proposal = passes.propose(text, {});
  const broken = proposal.edits.map((edit) => Object.assign({}, edit, { accepted: true, after: "в 2025 году " }));
  const result = passes.apply(text, broken);
  assert.equal(result.ok, false);
  assert.equal(result.text, text);
  assert.match(result.warnings[0], /отменены целиком/);
});

test("часть связок остаётся намеренно: зона жанра, а не максимизация", () => {
  const text = [
    "Кроме того, рынок вырос на 12% за 2024 год по данным отчёта.",
    "Более того, доля компании достигла 12,5% в четвёртом квартале.",
    "Таким образом, выручка удвоилась относительно прошлого периода.",
    "Следовательно, инвестиции окупились за восемнадцать месяцев работы.",
  ].join(" ");
  const proposal = passes.propose(text, { discourseZone: { max: 0.15 } });
  const connectives = proposal.edits.filter((edit) => edit.pass === "connectives");
  assert.ok(connectives.length >= 3);
  assert.ok(connectives.some((edit) => edit.keptForZone), "хотя бы одна связка должна остаться");
  assert.ok(connectives.some((edit) => edit.accepted), "лишние связки должны сниматься");
});

test("противительная связка не снимается по умолчанию", () => {
  const text = "Однако выручка упала на 4% в 2024 году. Однако, рынок вырос на 12% за тот же период.";
  const proposal = passes.propose(text, {});
  const adversative = proposal.edits.filter((edit) => /однако/i.test(edit.before));
  assert.ok(adversative.every((edit) => edit.accepted === false));
});

test("небезопасная разноминализация уходит автору, а не ломает падеж", () => {
  const text = "Наблюдается рост выручки на 3,2 млрд руб. за 2024 год по данным отчёта компании.";
  const proposal = passes.propose(text, {});
  assert.equal(proposal.edits.filter((edit) => edit.pass === "denominalization").length, 0);
  assert.equal(proposal.manual.length, 1);
  assert.match(proposal.manual[0].fragment, /Наблюдается рост/);
  const { result } = applyAll(text);
  assert.match(result.text, /Наблюдается рост выручки/);
});

test("безопасная разноминализация применяется и сохраняет управление", () => {
  const text = "Структура затрат оказывает влияние на маржинальность бизнеса в 2024 году.";
  const { result } = applyAll(text);
  assert.equal(result.ok, true);
  assert.match(result.text, /влияет на маржинальность/);
});

test("дробление длинного предложения предлагается, но не принимается само", () => {
  const text =
    "Команда собрала прототип за шесть недель и вывела его на два региона без остановки текущих продаж, " +
    "и уже в первом квартале выручка выросла на 12% относительно аналогичного периода прошлого года.";
  const proposal = passes.propose(text, {});
  const rhythm = proposal.edits.filter((edit) => edit.pass === "rhythm");
  assert.equal(rhythm.length, 1);
  assert.equal(rhythm[0].accepted, false);
  const result = passes.apply(text, proposal.edits.map((edit) => Object.assign({}, edit, { accepted: true })));
  assert.equal(result.ok, true);
  assert.match(result.text, /продаж\. Уже в первом квартале/);
});

test("предложение о самом тексте удаляется целиком", () => {
  const text = "В данном разделе рассматривается рынок доставки. Рынок вырос на 12% за 2024 год.";
  const { result } = applyAll(text);
  assert.equal(result.text, "Рынок вырос на 12% за 2024 год.");
});

test("пересказ соседнего предложения помечается, но не удаляется по умолчанию", () => {
  const text =
    "Компания увеличила выручку за счёт расширения ассортимента и роста среднего чека. " +
    "Расширение ассортимента и рост среднего чека увеличили выручку компании. " +
    "Отдельно выросли продажи в регионах.";
  const proposal = passes.propose(text, {});
  const repeat = proposal.edits.find((edit) => /пересказ предложения/.test(edit.reason));
  assert.ok(repeat, "повтор тезиса должен находиться");
  assert.equal(repeat.accepted, false);
});

test("пасс сокращения показывает и потолок, и цель 20–30%", () => {
  const text = "Безусловно, в современном мире рынок вырос на 12% за 2024 год по данным отчёта аудитора.";
  const proposal = passes.propose(text, {});
  assert.ok(proposal.reduction.possibleShare > 0);
  assert.deepEqual(proposal.reduction.target, { min: 0.2, max: 0.3 });
});

test("расширенный словарь разноминализации сохраняет управление", () => {
  const cases = [
    ["Решение оказывает воздействие на маржинальность бизнеса в 2024 году.", /воздействует на маржинальность/],
    ["Проект находится в зависимости от поставок сырья из двух регионов.", /зависит от поставок/],
    ["Система даёт возможность сократить издержки на треть за квартал.", /позволяет сократить/],
    ["The platform makes use of the existing data in the second quarter.", /uses the existing data/],
    ["The result is dependent on the supply chain in the fourth quarter.", /depends on the supply chain/],
  ];
  for (const [source, expected] of cases) {
    const { result } = applyAll(source);
    assert.equal(result.ok, true, `гард отклонил: ${source}`);
    assert.match(result.text, expected);
  }
});

test("замена, требующая смены падежа, в словарь не попала", () => {
  const source = "Отдел проводит анализ рынка доставки за прошедший квартал года.";
  const { result } = applyAll(source);
  assert.match(result.text, /проводит анализ рынка/);
});
