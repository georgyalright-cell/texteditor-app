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

// ─── 23/24. Плоская поверхность ──────────────────────────────────────────

test("перечислительный ряд собирается в один период через точку с запятой", () => {
  const text =
    "Развитие сектора сдерживается несколькими причинами, и все они известны.\n\n" +
    "Во-первых, доступ к финансовым ресурсам остаётся ограниченным для большинства заявителей. " +
    "Во-вторых, административная нагрузка на предприятие выросла за последние три года. " +
    "В-третьих, предпринимательских компетенций не хватает даже опытным руководителям.";
  const result = passes.applyPass(text, "period", { language: "ru" });
  assert.ok(result.changed);
  assert.match(result.text, /; во-вторых,/u);
  assert.match(result.text, /; в-третьих,/u);
  // Ни одного слова не убавилось и не прибавилось: правка чисто знаковая.
  assert.equal(passes.countWords(result.text), passes.countWords(text));
});

test("слияние снимает заглавную только при доказательстве, что слово нарицательное", () => {
  // Положительное свидетельство — то же слово со строчной буквы уже есть в
  // тексте. Без него заглавная может оказаться значащей, и «Ozon» превратится
  // в «ozon»: якорный гард такую правку не отклонит, имя собственное он
  // якорем не считает намеренно.
  const evidenced =
    "Первый абзац говорит про замедление рынка и нужен пассу как контекст.\n\n" +
    "Рынок рос почти весь прошедший год и уверенно держался выше прошлогодних значений сразу по всем товарным категориям без единого исключения. " +
    "Замедление началось только в декабре и продолжалось ровно до самого конца отчётного периода, пока сезонный спрос окончательно не выдохся. " +
    "Третье предложение здесь стоит для того, чтобы абзац не оказался из двух фраз.";
  const merged = passes.applyPass(evidenced, "period", { language: "ru" });
  assert.ok(merged.changed);
  assert.match(merged.text, /; замедление/u);

  const named =
    "Первый абзац говорит про замедление рынка и нужен пассу как контекст.\n\n" +
    "Рынок рос почти весь прошедший год и уверенно держался выше прошлогодних значений сразу по всем товарным категориям без единого исключения. " +
    "Ozon замедлился только в декабре и оставался в минусе ровно до самого конца отчётного периода, пока сезонный спрос окончательно не выдохся. " +
    "Третье предложение здесь стоит для того, чтобы абзац не оказался из двух фраз.";
  assert.doesNotMatch(passes.applyPass(named, "period", { language: "ru" }).text, /; ozon/u);
});

test("длинных периодов делается не больше человеческой нормы", () => {
  // Без потолка пасс сливает всё, до чего дотянется, и ровный ритм из
  // коротких фраз меняется на ровный ритм из длинных.
  const paragraph = [
    "Первое предложение абзаца достаточно длинное, чтобы пройти нижний порог слияния по объёму.",
    "Второе предложение абзаца тоже достаточно длинное, чтобы пройти нижний порог слияния.",
    "Третье предложение абзаца снова длинное и снова проходит нижний порог слияния по объёму.",
    "Четвёртое предложение абзаца длинное и проходит нижний порог слияния точно так же.",
  ].join(" ");
  const text = [paragraph, paragraph, paragraph, paragraph].join("\n\n");
  const proposal = passes.propose(text, { language: "ru" });
  const high = proposal.edits.filter((edit) => edit.pass === "period" && edit.confidence === "high");
  const sentences = passes.sentenceSpans(text, 0).length;
  assert.ok(high.length <= Math.max(1, Math.round(0.089 * 16) ) + 1, `слияний ${high.length}`);
  assert.ok(sentences >= 0);
});

test("попутное уточнение уходит в скобки, а пояснение — за двоеточие", () => {
  const text = "Рынок вырос на 12%, а именно за счёт готовой еды, и это заметно.";
  const result = passes.applyPass(text, "punctuation", { language: "ru" });
  assert.match(result.text, /12%: за счёт готовой еды/u);

  const aside = "Некоторые категории, например, готовая еда, выросли сильнее прочих в 2024 году.";
  const parens = passes.applyPass(aside, "punctuation", { language: "ru" });
  assert.match(parens.text, /\(например, готовая еда\)/u);
});

test("запятая после ведущего слова ставится только вводным словам", () => {
  // «(например, розничный сегмент)» верно, «(в том числе, логистику)» — нет:
  // «в том числе» вводит перечисление напрямую.
  const intro = passes.applyPass("Рынок растёт, например розничный сегмент, третий год подряд.", "punctuation", { language: "ru" });
  assert.match(intro.text, /\(например, розничный сегмент\)/u);
  const direct = passes.applyPass("Компания меняет процессы, в том числе логистику и склад, и растёт.", "punctuation", { language: "ru" });
  assert.match(direct.text, /\(в том числе логистику и склад\)/u);
  assert.doesNotMatch(direct.text, /в том числе,/u);
});

test("скобки заменяют обе запятые оборота, а не одну", () => {
  // Запятая после закрывающей скобки остаётся только там, где её требует не
  // оборот, а придаточное после него.
  const plain = passes.applyPass("Доля выросла, по сравнению с прошлым годом, на четыре пункта.", "punctuation", { language: "ru" });
  assert.match(plain.text, /\(по сравнению с прошлым годом\) на четыре пункта\./u);

  const clause = passes.applyPass("Затраты снизились, включая логистику, что заметно по годовому отчёту.", "punctuation", { language: "ru" });
  assert.match(clause.text, /\(включая логистику\), что заметно/u);

  const conjunction = passes.applyPass("Компания меняет процессы, включая склад, и снижает затраты.", "punctuation", { language: "ru" });
  assert.match(conjunction.text, /\(включая склад\) и снижает/u);
});

test("в скобки уходит доля оборотов, а не все подряд", () => {
  // Измерено на корпусе: живой автор берёт такие обороты в скобки в 15%
  // случаев. «Все в скобках» — своя собственная ровность, ничем не лучше
  // нуля скобок у генерации.
  const text = [
    "Компания меняет процессы, в том числе логистику и складские операции, и растёт.",
    "Затраты снижаются, в зависимости от объёма закупок, на десять процентов.",
    "Рынок растёт, например розничный сегмент, третий год подряд.",
    "Спрос падает, за исключением premium-сегмента, во всех каналах продаж.",
    "Доля выросла, по сравнению с прошлым годом, на четыре пункта.",
    "Отчёт готов, включая приложения, к назначенному сроку.",
  ].join(" ");
  const applied = passes.applyPass(text, "punctuation", { language: "ru" });
  const opened = (applied.text.match(/\(/gu) || []).length;
  assert.ok(opened >= 1, "хотя бы одна скобка должна появиться");
  assert.ok(opened <= 2, `скобок ${opened}, а кандидатов шесть — переведена должна быть доля`);
});

test("англоязычная номинализация разворачивается, но не после предлога", () => {
  const plain = "The implementation of the plan reduced costs by 12% in 2024.";
  assert.match(passes.applyPass(plain, "denominalization", { language: "en" }).text, /^Implementing the plan/u);

  const afterPreposition = "Costs fell by 12% during the implementation of the plan in 2024.";
  assert.doesNotMatch(
    passes.applyPass(afterPreposition, "denominalization", { language: "en" }).text,
    /during implementing/u,
  );
});

test("триады показываются автору пачкой, а не правятся сами", () => {
  const text = [
    "The process comprises identification, assessment, and monitoring of risk.",
    "Teams rely on documentation, review, and escalation to keep the register current.",
    "Benefits include lower cost, faster delivery, and clearer ownership across the group.",
  ].join(" ");
  const proposal = passes.propose(text, { language: "en" });
  const triads = proposal.manual.filter((item) => item.method === 40);
  assert.equal(triads.length, 3);
  // Ни одной автоматической правки: убрать триаду можно только выбросив один
  // из трёх членов, а это содержание, а не форма.
  assert.equal(proposal.edits.filter((edit) => edit.method === 40).length, 0);

  const single = "Benefits include lower cost, faster delivery, and clearer ownership across the group.";
  assert.equal(passes.propose(single, { language: "en" }).manual.filter((item) => item.method === 40).length, 0);
});
