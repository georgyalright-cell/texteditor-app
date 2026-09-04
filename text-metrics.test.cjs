"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
require("./anchor-guard.js");
const metrics = require("./text-metrics.js");

const MACHINE_RU = `Кроме того, в современном мире цифровая трансформация играет ключевую роль в развитии предприятия. Таким образом, осуществляется оптимизация процессов и повышается эффективность деятельности организации. Возможно, в целом это позволяет достичь повышения производительности труда сотрудников.

Кроме того, компания достигла роста выручки за счёт оптимизации внутренних процессов управления. Таким образом, была достигнута оптимизация затрат и повышена эффективность работы подразделений. Как правило, это приводит к улучшению показателей деятельности организации в целом.

Кроме того, руководство отмечает необходимость дальнейшего совершенствования системы управления качеством. Таким образом, реализация предложенных мероприятий обеспечивает достижение поставленных стратегических целей. Возможно, потребуется дополнительное обучение персонала и пересмотр действующих регламентов работы.

Кроме того, внедрение информационных систем требует значительных инвестиций и продолжительного времени. Таким образом, окупаемость проекта растягивается на несколько отчётных периодов подряд. Как правило, руководство предприятия учитывает данный фактор при планировании годового бюджета развития.`;

test("номинализация на кириллице считается, а не молча даёт ноль", () => {
  const report = metrics.analyze(MACHINE_RU, { genreId: "academic" });
  const nominalization = report.metrics.find((item) => item.id === "nominalizationDensity");
  assert.ok(nominalization.value > 5, `ожидалась плотность выше 5, получено ${nominalization.value}`);
});

test("абстрактные существительные на кириллице считаются", () => {
  const report = metrics.analyze(MACHINE_RU, { genreId: "academic" });
  const abstract = report.metrics.find((item) => item.id === "abstractShare");
  assert.ok(abstract.value > 0.03);
});

test("дискурсивные зачины и повтор зачинов уходят выше зоны", () => {
  const report = metrics.analyze(MACHINE_RU, { genreId: "academic" });
  assert.equal(report.metrics.find((item) => item.id === "discourseShare").status, "high");
  // У повтора зачинов теперь две границы, а не одна, поэтому сильное
  // превышение называется «перелётом», а не «выше зоны». Проверяется то же
  // самое: значение вышло за пределы нормы.
  assert.ok(["high", "overshoot"].includes(report.metrics.find((item) => item.id === "openerRepeat").status));
});

test("повтор лексики и зачинов имеет пол, а не только потолок", () => {
  // Машина повторяет меньше человека, а не больше: медиана повтора лексики
  // 0.054 в русском корпусе и 0.21 в английском, у сгенерированного текста
  // ноль. Пока у метрики был только потолок, этот ноль лежал внутри зоны и
  // читался как «хорошо».
  const zone = (id, language) =>
    metrics.analyze("текст", { genreId: "academic", language }).metrics.find((item) => item.id === id).zone;
  assert.ok(zone("ngramRepeat", "ru").min > 0);
  assert.ok(zone("openerRepeat", "ru").min > 0);
  assert.ok(zone("ngramRepeat", "en").min > 0);
  assert.ok(zone("openerRepeat", "en").min > 0);
});

test("плоские метрики ловят машинный текст: знаков нет, длинных периодов нет", () => {
  const report = metrics.analyze(MACHINE_RU, { genreId: "academic" });
  assert.equal(report.metrics.find((item) => item.id === "punctInventory").status, "low");
  assert.equal(report.metrics.find((item) => item.id === "longSentences").status, "low");
});

test("живой текст со скобками и длинным периодом плоским не считается", () => {
  const alive = [
    "Рынок вырос на 12% за 2024 год (по данным Росстата), причём почти весь прирост дала одна категория — готовая еда, которая ещё три года назад держалась в пределах статистической погрешности и не попадала в отраслевые обзоры вовсе.",
    "Дальше сложнее: региональные сети росли медленнее, а федеральные — быстрее.",
    "Мы считали по чекам, не по отгрузкам; расхождение с отчётностью сетей достигает 4%.",
    "Причина известна и скучна: возвраты учитываются в разные периоды.",
    "Отдельно стоит гипермаркет, потерявший 3% трафика.",
    "Это первый год, когда формат ушёл в минус.",
  ].join(" ");
  const report = metrics.analyze(alive, { genreId: "academic", language: "ru" });
  assert.notEqual(report.metrics.find((item) => item.id === "punctInventory").status, "low");
  assert.notEqual(report.metrics.find((item) => item.id === "longSentences").status, "low");
});

test("плотность якорей считает числа, даты и имена", () => {
  const text = "В 2024 году Ozon занял 12,5% рынка. Выручка достигла 3,2 млрд руб.";
  const report = metrics.analyze(text, { genreId: "academic" });
  assert.ok(report.metrics.find((item) => item.id === "anchorDensity").value >= 3);
});

test("зоны различаются по жанру: одна и та же метрика получает разный статус", () => {
  // Направление здесь обратное тому, что казалось до калибровки. Измеренная
  // норма русской академической прозы по номинализации (4.35) строже, чем
  // назначенная на глаз норма лендинга (6): суффиксный признак ловит в
  // русском заметно меньше, чем в английском. Тест закрепляет измерение,
  // а не прежнее предположение.
  const text = "Внедрение системы прошло спокойно. Команда собрала прототип за шесть недель и вывела его на два региона без потерь.";
  const pick = (genreId) =>
    metrics.analyze(text, { genreId, language: "ru" }).metrics.find((item) => item.id === "nominalizationDensity").status;
  assert.equal(pick("academic"), "high");
  assert.equal(pick("landing"), "ok");
});

test("детектор перелёта срабатывает на рваном ритме, а не на любом выходе из зоны", () => {
  const jagged = "Да. Нет. Возможно. Мы построили систему, которая в течение восемнадцати месяцев обслуживала сорок два региональных подразделения без единого сбоя и без внешней поддержки. Точка.";
  const report = metrics.analyze(jagged, { genreId: "academic" });
  assert.ok(report.overshoot.some((item) => item.id === "sentenceCv" || item.id === "shortShare"));
});

test("diff показывает, какие метрики сдвинулись", () => {
  const before = metrics.analyze(MACHINE_RU, { genreId: "academic" });
  const after = metrics.analyze(MACHINE_RU.replace(/Кроме того, |Таким образом, /g, ""), { genreId: "academic" });
  const changes = metrics.diff(before, after);
  assert.ok(changes.some((item) => item.id === "discourseShare"));
});

test("утверждение без числа, срока и источника считается пустым", () => {
  const text =
    "This business plan provides a framework for achieving long-term success. " +
    "[Company Name] can capture market share and deliver value to customers. " +
    "The implementation plan ensures adaptability while monitoring of KPIs will enable decisions based on data.";
  const metric = metrics.analyze(text, { genreId: "academic" }).metrics.find((item) => item.id === "emptyClaims");
  assert.equal(metric.value, 1);
  assert.equal(metric.status, "high");
});

test("имя собственное не делает утверждение проверяемым, а число делает", () => {
  const named = "Ozon delivers value to customers and improves the experience.";
  const measured = "Ozon captured 12.5% of the market in 2024 and reduced costs by 3.2 million roubles.";
  const pick = (text) => metrics.analyze(text, { genreId: "academic" }).metrics.find((item) => item.id === "emptyClaims");
  assert.equal(pick(named).value, 1);
  assert.equal(pick(measured).value, 0);
});

test("предложение без обещания и оценки пустым утверждением не считается", () => {
  const text = "The office moved to another building. The team continued the work as before.";
  assert.equal(metrics.analyze(text, { genreId: "academic" }).metrics.find((item) => item.id === "emptyClaims").value, 0);
});

test("текст, набитый номинализациями, больше не проходит порог academic", () => {
  const text =
    "This business plan provides a framework for achieving long-term success by aligning goals " +
    "with realistic financial projections and risk management. The implementation plan ensures " +
    "adaptability as conditions change, while monitoring of KPIs will enable decisions based on data.";
  const report = metrics.analyze(text, { genreId: "academic" });
  assert.equal(report.metrics.find((item) => item.id === "nominalizationDensity").status, "high");
  assert.equal(report.metrics.find((item) => item.id === "abstractShare").status, "high");
});

test("калибровка заменяет зоны, но не заводит новых метрик", () => {
  const before = metrics.genre("note").zones.hedgeDensity.max;
  const result = metrics.applyCalibration({
    genre: "note",
    texts: 140,
    zones: { hedgeDensity: { max: 0.4 }, выдуманнаяМетрика: { max: 1 } },
  });
  assert.equal(result.applied, true);
  assert.equal(result.trustworthy, true);
  assert.deepEqual(result.metrics, ["hedgeDensity"]);
  assert.equal(metrics.genre("note").zones.hedgeDensity.max, 0.4);
  assert.equal(metrics.genre("note").zones.выдуманнаяМетрика, undefined);
  metrics.applyCalibration({ genre: "note", texts: 140, zones: { hedgeDensity: { max: before } } });
});

test("маленький корпус принимается, но помечается недостоверным", () => {
  const result = metrics.applyCalibration({ genre: "landing", texts: 12, zones: { hedgeDensity: { max: 0.9 } } });
  assert.equal(result.applied, true);
  assert.equal(result.trustworthy, false);
});

test("калибровка для неизвестного жанра отклоняется", () => {
  assert.equal(metrics.applyCalibration({ genre: "поэзия", zones: {} }).applied, false);
});

test("отчёт помечает, откалиброваны ли пороги", () => {
  const text = "Команда собрала прототип за шесть недель. Выручка выросла на треть за 2024 год.";
  assert.equal(metrics.analyze(text, { genreId: "tech-post" }).calibrated, false);
  metrics.applyCalibration({ genre: "tech-post", texts: 120, zones: { hedgeDensity: { max: 1.5 } } });
  const after = metrics.analyze(text, { genreId: "tech-post" });
  assert.equal(after.calibrated, true);
  assert.equal(after.calibration.texts, 120);
});
