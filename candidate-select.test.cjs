"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("./anchor-guard.js");
require("./humanizer-metrics.js");
require("./paraphraser.js");
require("./rewriter.js");
const select = require("./candidate-select.js");

const SAMPLE =
  "Кроме того, важно отметить, что система обрабатывает документы локально — она не отправляет данные наружу. " +
  "Таким образом, пользователь получает результат быстро и приватно. Более того, обработка идёт без сервера.";

test("исходный текст всегда участвует в отборе", () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  assert.ok(candidates.some((item) => item.text === SAMPLE), "версия «как есть» обязана быть среди кандидатов");
});

test("кандидаты различаются между собой", () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  assert.ok(candidates.length >= 2);
  assert.equal(new Set(candidates.map((item) => item.text)).size, candidates.length);
});

test("кандидат, потерявший число, до отбора не доходит", () => {
  const source = "Выручка выросла на 12,5% за 2024 год, и команда вывела продукт на два региона рынка.";
  for (const candidate of select.generate(source, { language: "ru" })) {
    assert.match(candidate.text, /12,5%/);
    assert.match(candidate.text, /2024/);
  }
});

test("при равных оценках побеждает исходный текст", async () => {
  const result = await select.improve(SAMPLE, {
    language: "ru",
    score: (texts) => Promise.resolve(texts.map(() => 50)),
  });
  assert.equal(result.improved, false);
  assert.equal(result.text, SAMPLE);
});

test("выбирается кандидат с наименьшей оценкой", async () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  const target = candidates[candidates.length - 1];
  const result = await select.select(SAMPLE, candidates, {
    score: (texts) => Promise.resolve(texts.map((text) => (text === target.text ? 1 : 90))),
  });
  assert.equal(result.text, target.text);
  assert.equal(result.improved, true);
});

test("неоценённый кандидат выбывает, а не считается худшим", async () => {
  const candidates = select.generate(SAMPLE, { language: "ru" });
  const result = await select.select(SAMPLE, candidates, {
    score: (texts) => Promise.resolve(texts.map((text, index) => (index === 0 ? NaN : 10 + index))),
  });
  assert.ok(result.ranked.every((item) => Number.isFinite(item.score)));
  assert.equal(result.ranked.length, candidates.length - 1);
});

test("перплексия переворачивается в оценку машинности", async () => {
  const scorer = select.perplexityScorer({ scoreTexts: (texts) => Promise.resolve(texts.map((_, index) => index + 1)) });
  assert.deepEqual(await scorer(["a", "b", "c"]), [-1, -2, -3]);
});

test("без модели отбор идёт по детерминированной оценке", () => {
  assert.equal(select.perplexityScorer({}), null);
  assert.equal(typeof select.bestAvailableScorer("ru"), "function");
});

require("./edit-passes.js");
require("./weak-spots.js");

const WEAK =
  "Кроме того, цифровая трансформация играет ключевую роль в развитии бизнеса. " +
  "Выручка Ozon выросла на 12,5% за 2024 год по данным отчёта аудитора. " +
  "Как правило, автоматизация позволяет значительно повысить эффективность работы.";

test("полировка заменяет только те предложения, где нашлось лучше", async () => {
  const result = await select.polishSentences(WEAK, { language: "ru" });
  assert.equal(result.ok, true);
  assert.ok(result.replaced >= 1);
  for (const detail of result.details) assert.ok(detail.gain > 0, "замена без выигрыша недопустима");
});

test("предложение с конкретикой полировка не трогает", async () => {
  const result = await select.polishSentences(WEAK, { language: "ru" });
  assert.match(result.text, /Выручка Ozon выросла на 12,5% за 2024 год/);
});

test("равная оценка не считается улучшением", async () => {
  const result = await select.polishSentences(WEAK, {
    language: "ru",
    score: (texts) => Promise.resolve(texts.map(() => 42)),
  });
  assert.equal(result.replaced, 0);
  assert.equal(result.text, WEAK);
});

test("варианты одного предложения не теряют якорей", () => {
  const sentence = "Выручка выросла на 12,5% за 2024 год по данным отчёта аудитора.";
  for (const variant of select.sentenceVariants(sentence, "ru")) {
    assert.match(variant, /12,5%/);
    assert.match(variant, /2024/);
  }
});

test("варианты уходят в модель одним пакетом", async () => {
  let calls = 0;
  await select.polishSentences(WEAK, {
    language: "ru",
    score: (texts) => {
      calls += 1;
      return Promise.resolve(texts.map((_text, index) => index));
    },
  });
  assert.equal(calls, 1, "оценка обязана вызываться один раз на весь текст");
});

test("версии от генератора проходят тот же гард якорей", async () => {
  const source = "Как правило, автоматизация позволяет значительно повысить эффективность работы отдела.";
  const result = await select.polishSentences(source, {
    language: "ru",
    // Первая версия ломает число, вторая честная. До оценки должна дойти вторая.
    generate: () => Promise.resolve([
      "Автоматизация повысила эффективность отдела на 40%.",
      "Автоматизация ускорила работу отдела.",
    ]),
    score: (texts) => Promise.resolve(texts.map((text) => (text === "Автоматизация ускорила работу отдела." ? 1 : 90))),
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, "Автоматизация ускорила работу отдела.");
});

test("падение генератора не ломает полировку", async () => {
  const source = "Как правило, автоматизация позволяет значительно повысить эффективность работы отдела.";
  const result = await select.polishSentences(source, {
    language: "ru",
    generate: () => Promise.reject(new Error("модель не загрузилась")),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.generatorWarnings, ["модель не загрузилась"]);
});

test("профиль свежести отличает перестройку синтаксиса от косметической замены", () => {
  const source = "Команда изучает структуру рынка и оценивает поведение покупателей в выбранном сегменте.";
  const fresh = "Поведение покупателей в выбранном сегменте команда оценивает, а структуру рынка изучает.";
  const cosmetic = "Команда изучает структуру рынка и анализирует поведение покупателей в выбранном сегменте.";
  const shortened = "Команда изучает рынок.";

  assert.equal(select.freshCandidateProfile(source, fresh, "ru").safe, true);
  assert.equal(select.freshCandidateProfile(source, cosmetic, "ru").safe, false);
  assert.equal(select.freshCandidateProfile(source, shortened, "ru").safe, false);
});

test("глубокий фильтр не пропускает опечатку в длинном смысловом слове", () => {
  const source = "Регулярное наблюдение за показателями помогает вовремя замечать отклонения и корректировать решения.";
  const typo = "Регулярное наблюдение за показатиями позволяет быстро выявить отклонения и корректировать решения.";
  const profile = select.freshCandidateProfile(source, typo, "ru");
  assert.equal(profile.stableVocabulary, false);
  assert.equal(profile.safe, false);
});

test("код строит свежие варианты перестановкой хвоста и однородных частей", () => {
  assert.deepEqual(
    select.syntacticReorderVariants(
      "Современные организации работают в условиях постоянного изменения рынка.",
      "ru",
    ),
    ["В условиях постоянного изменения рынка современные организации работают."],
  );
  assert.ok(select.syntacticReorderVariants(
    "Комплексный подход обеспечивает последовательное развитие инициативы и повышает качество принимаемых решений.",
    "ru",
  ).includes(
    "Комплексный подход повышает качество принимаемых решений и обеспечивает последовательное развитие инициативы.",
  ));
  assert.ok(select.syntacticReorderVariants(
    "Эффективное управление имеет ключевое значение в достижении стратегических целей.",
    "ru",
  ).includes("Для достижения стратегических целей эффективное управление имеет ключевое значение."));
});

test("глубокая редакция распределяет цели по тексту и заметно меняет безопасные предложения", async () => {
  const pairs = [
    [
      "Команда изучает структуру рынка и оценивает поведение покупателей в выбранном сегменте.",
      "Поведение покупателей в выбранном сегменте команда оценивает, а структуру рынка изучает.",
    ],
    [
      "Исследование описывает основные потребности аудитории и показывает причины выбора продукта.",
      "Основные потребности аудитории описывает исследование, которое также показывает причины выбора продукта.",
    ],
    [
      "Проект предусматривает последовательный запуск функций и регулярную проверку обратной связи.",
      "Регулярную проверку обратной связи предусматривает проект, как и последовательный запуск функций.",
    ],
    [
      "Сервис помогает сотрудникам готовить материалы и поддерживать единый стиль документов.",
      "Готовить материалы и поддерживать единый стиль документов сотрудникам помогает сервис.",
    ],
    [
      "План учитывает доступные ресурсы команды и предполагаемый объём ежедневных задач.",
      "Доступные ресурсы команды и предполагаемый объём ежедневных задач учитывает план.",
    ],
    [
      "Результаты первого этапа станут основой для уточнения процессов и распределения ответственности.",
      "Основой для уточнения процессов и распределения ответственности станут результаты первого этапа.",
    ],
    [
      "Регулярное наблюдение за показателями помогает вовремя замечать отклонения и корректировать решения.",
      "Вовремя замечать отклонения и корректировать решения помогает регулярное наблюдение за показателями.",
    ],
    [
      "Итоговый подход сочетает понятный порядок действий и возможность адаптации к новым условиям.",
      "Понятный порядок действий и возможность адаптации к новым условиям сочетает итоговый подход.",
    ],
  ];
  const alternatives = new Map(pairs);
  const requests = [];
  const source = pairs.map(([sentence]) => sentence).join(" ");
  const result = await select.polishSentences(source, {
    language: "ru",
    preferFresh: true,
    share: 0.35,
    limit: 12,
    generate: (sentence, options) => {
      requests.push(options);
      return Promise.resolve([alternatives.get(sentence)]);
    },
    score: (texts) => Promise.resolve(texts.map(() => 0)),
  });

  assert.equal(result.ok, true);
  assert.equal(result.targeted, 3);
  assert.equal(result.replaced, 3);
  assert.equal(result.totalSentences, 8);
  assert.ok(result.changedWordShare >= 0.3, "изменения должны охватывать заметную часть слов");
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(({ position, total }) => [position, total]), [[1, 3], [2, 3], [3, 3]]);
  assert.notEqual(result.text, source);
  for (const detail of result.details) assert.ok(detail.novelty >= 0.24);
});

test("гибридная оценка ранжирует перплексией и страхует машинностью", async () => {
  const engine = { scoreTexts: (texts) => Promise.resolve(texts.map((_text, index) => (index === 1 ? 1.2 : 0.8))) };
  const score = select.hybridScorer("ru", engine);
  const values = await score([
    "Кроме того, это позволяет повысить эффективность работы отдела продаж.",
    "Отдел продаж стал работать быстрее.",
  ]);
  assert.ok(values[1] < values[0], "вариант с большей перплексией обязан выигрывать");
});

test("неоценённый моделью кандидат сохраняет детерминированную часть", async () => {
  const engine = { scoreTexts: (texts) => Promise.resolve(texts.map(() => Number.NaN)) };
  const score = select.hybridScorer("ru", engine);
  const values = await score(["Кроме того, таким образом, важно отметить, что это важно.", "Выручка выросла на 12%."]);
  assert.ok(values.every((value) => Number.isFinite(value)), "оценка не должна становиться NaN целиком");
  assert.ok(values[1] < values[0], "при недоступной модели решает машинность");
});

test("без модели гибрид не собирается", () => {
  assert.equal(select.hybridScorer("ru", {}), null);
  assert.equal(select.hybridScorer("ru", null), null);
});

test("в набор кандидатов попадают версии, отличающиеся одной заменой", () => {
  const sentence = "Кроме того, таким образом, инструмент обрабатывает документы локально и не отправляет данные наружу.";
  const variants = select.sentenceVariants(sentence, "ru");
  // Одна замена в первом обороте при нетронутом втором — признак того, что
  // места перебираются по одному, а не только все сразу.
  assert.ok(
    variants.some((item) => /^Помимо этого, таким образом,/u.test(item)),
    `пословных версий нет: ${variants.join(" | ").slice(0, 200)}`,
  );
  assert.ok(variants.some((item) => /^Кроме того, следовательно,/u.test(item)));
});

test("пословные версии не теряют защищённых участков", () => {
  const sentence = "Кроме того, таким образом, отчёт лежит по ссылке https://example.com/a?id=27 и содержит 12,5%.";
  for (const variant of select.sentenceVariants(sentence, "ru")) {
    assert.match(variant, /https:\/\/example\.com\/a\?id=27/);
    assert.match(variant, /12,5%/);
  }
});
