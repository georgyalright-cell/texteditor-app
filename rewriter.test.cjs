"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const rewriter = require("./rewriter.js");
const metrics = require("./humanizer-metrics.js");

const onlyDashes = { antithesis: false, rhythm: false };
const onlyAntithesis = { dashes: false, rhythm: false };
const onlyRhythm = { dashes: false, antithesis: false };

test("тире перед местоимением разворачивается в два предложения", () => {
  // Норма — одно тире на пять предложений, поэтому в тексте их должно быть
  // больше нормы: иначе движок обоснованно не трогает ничего.
  const source =
    "The system processes documents locally — it never uploads them. The team confirmed the behaviour in a review. " +
    "The export step writes a docx file — the reviewer opens it afterwards. The result stays on the device.";
  const result = rewriter.rewrite(source, onlyDashes);
  assert.equal(result.actions.dashes, 1);
  assert.match(result.text, /locally\. It never uploads them\./u);
});

test("не ставит запятую между двумя самостоятельными предложениями", () => {
  const source =
    "The approach uses advanced tooling — the reviewer validated every step of it. Documents stay on the device. " +
    "The export writes a docx file. Nothing leaves the browser.";
  const result = rewriter.rewrite(source, onlyDashes).text;
  // Запятая здесь дала бы comma splice: справа полноценное предложение.
  assert.doesNotMatch(result, /tooling, the reviewer/u);
});

test("хвост без опознанного сказуемого уходит в скобки, а не в запятую", () => {
  // Первое тире обязательное («— это») и остаётся, второе уходит в скобки.
  const source =
    "Курсовая работа — это самостоятельное исследование. Обработка выполняется локально — данные не покидают устройство пользователя. " +
    "Отчёт собирается по профилю. Экспорт пишет файл docx.";
  const result = rewriter.rewrite(source, onlyDashes).text;
  assert.match(result, /локально \(данные не покидают устройство пользователя\)\./u);
  assert.doesNotMatch(result, /локально, данные/u);
});

test("связка «— это» остаётся: это обязательное тире, а не коннектор", () => {
  const source =
    "Курсовая работа — это самостоятельное исследование. Она готовится по методичке. " +
    "Структура задаётся профилем. Оформление проверяется отдельно.";
  const result = rewriter.rewrite(source, onlyDashes).text;
  assert.match(result, /Курсовая работа — это самостоятельное исследование\./u);
});

test("парное тире вокруг вставки заменяется запятыми", () => {
  // Парная замена снимает сразу два вхождения, поэтому нужен бюджет от двух.
  const source =
    "The corpus — a large one — was collected in advance. The team reviewed it in a session. " +
    "The export step writes a docx file — the reviewer opens it afterwards. Nothing leaves the browser.";
  const result = rewriter.rewrite(source, onlyDashes);
  assert.equal(result.actions.dashes, 2);
  assert.match(result.text, /The corpus, a large one, was collected in advance\./u);
});

test("числовой диапазон и ссылка не считаются коннектором и не трогаются", () => {
  const source =
    "Данные за 2023—2024 годы собраны заранее — команда проверила их вручную. Ссылка https://example.com/a-b ведёт на источник. " +
    "Отчёт собирается по профилю. Экспорт пишет файл docx.";
  const result = rewriter.rewrite(source, onlyDashes).text;
  assert.match(result, /2023—2024/u);
  assert.match(result, /https:\/\/example\.com\/a-b/u);
});

test("английская антитеза сворачивается без потери обеих половин", () => {
  const source = "The method is not only accurate but also cheap.";
  const result = rewriter.rewrite(source, onlyAntithesis);
  assert.equal(result.actions.antithesis, 1);
  assert.equal(result.text, "The method is both accurate and cheap.");
});

test("русская антитеза правится: \\b в JS не работает перед кириллицей", () => {
  const source = "Система не только собирает документ, но и проверяет его по методичке.";
  const result = rewriter.rewrite(source, onlyAntithesis);
  assert.equal(result.actions.antithesis, 1);
  assert.equal(result.text, "Система и собирает документ, и проверяет его по методичке.");
});

test("«не просто X, а Y» сохраняет обе половины на своих местах", () => {
  const source = "Это не просто редактор, а полноценная среда подготовки документа.";
  const result = rewriter.rewrite(source, onlyAntithesis).text;
  assert.equal(result, "Это редактор, а также полноценная среда подготовки документа.");
});

test("ритм поднимает разброс длин предложений выше порога метрики", () => {
  const source =
    "The team collected the corpus in advance; the reviewer validated every record in it. " +
    "The export step writes a docx file today. The reviewer reads the assembled result now. " +
    "The profile defines the section order here. The checker reports the missing parts.";
  const before = metrics.scoreText(source, "en");
  const result = rewriter.rewrite(source, onlyRhythm);
  const after = metrics.scoreText(result.text, "en");
  assert.ok(result.actions.splits + result.actions.merges > 0, "ожидалась хотя бы одна перестройка");
  assert.ok(after.burstiness < before.burstiness, `${after.burstiness} должно быть меньше ${before.burstiness}`);
});

test("разбивка на абзацы переживает все слои", () => {
  const source =
    "Первый абзац идёт первым — он открывает работу. Второе предложение продолжает мысль.\n\n" +
    "Второй абзац идёт следом — он развивает тему. Здесь тоже два предложения.\n\n" +
    "Третий абзац завершает раздел — он подводит итог. Последнее предложение закрывает мысль.";
  const result = rewriter.rewrite(source).text;
  assert.equal(result.split(/\n{2,}/u).length, 3);
});

test("строки списка не перестраиваются", () => {
  const source = "Список разделов:\n- первый пункт — он про введение\n- второй пункт — он про метод";
  const result = rewriter.rewrite(source).text;
  assert.match(result, /- первый пункт — он про введение/u);
  assert.match(result, /- второй пункт — он про метод/u);
});

test("пустой ввод не роняет обработку", () => {
  const result = rewriter.rewrite("");
  assert.equal(result.text, "");
  assert.equal(result.actions.dashes, 0);
});

test("одинаковый зачин-обстоятельство уходит в конец предложения", () => {
  const source = "В 2024 году компания увеличила выручку на треть. В 2024 году команда вывела продукт на два региона.";
  const result = rewriter.rewrite(source, { dashes: false, antithesis: false, rhythm: false });
  assert.equal(result.actions.openers, 1);
  assert.match(result.text, /Команда вывела продукт на два региона в 2024 году\./);
});

test("граница обстоятельства не съедает сказуемое", () => {
  // Жадный разбор превращал «В 2024 году команда вывела продукт» в
  // обстоятельство «в 2024 году команда вывела» и калечил предложение.
  const source = "В 2024 году компания выросла. В 2024 году команда вывела продукт на два региона.";
  const result = rewriter.rewrite(source, { dashes: false, antithesis: false, rhythm: false });
  assert.doesNotMatch(result.text, /команда вывела\./);
});

test("английское обстоятельство выносится вперёд с запятой", () => {
  const source = "The team shipped the release on time. The team reduced the handling cost in the fourth quarter.";
  const result = rewriter.rewrite(source, { dashes: false, antithesis: false, rhythm: false });
  assert.equal(result.actions.openers, 1);
  assert.match(result.text, /In the fourth quarter, the team reduced/);
});

test("имя собственное не опускается в строчную", () => {
  const source = "Ozon увеличил выручку на треть. Ozon вывел продукт на два региона в 2024 году.";
  const result = rewriter.rewrite(source, { dashes: false, antithesis: false, rhythm: false });
  assert.equal(result.actions.openers, 0);
  assert.doesNotMatch(result.text, /ozon/);
});

test("разные зачины не трогаются", () => {
  const source = "Команда собрала прототип за шесть недель. Выручка выросла на треть в 2024 году.";
  const result = rewriter.rewrite(source, { dashes: false, antithesis: false, rhythm: false });
  assert.equal(result.actions.openers, 0);
  assert.equal(result.text, source);
});

test("ровные абзацы разбиваются на куски разной длины", () => {
  const block = Array.from(
    { length: 14 },
    (_item, index) => `Предложение номер ${index + 1} описывает измеримый факт работы команды за прошедший квартал года.`,
  ).join(" ");
  const source = [block, block, block].join("\n\n");
  const result = rewriter.reflowParagraphs(source);
  const lengths = result.text.split("\n\n").map((paragraph) => rewriter.countWords(paragraph));
  assert.ok(result.created > 0, "разрывы должны появиться");
  assert.ok(new Set(lengths).size > 1, `длины обязаны различаться: ${lengths.join(", ")}`);
});

test("разбивка абзацев воспроизводима", () => {
  const block = Array.from(
    { length: 14 },
    (_item, index) => `Предложение ${index + 1} про измеримый факт работы команды за прошедший квартал года.`,
  ).join(" ");
  const source = [block, block, block].join("\n\n");
  assert.equal(rewriter.reflowParagraphs(source).text, rewriter.reflowParagraphs(source).text);
});

test("разрыв не попадает внутрь предложения", () => {
  const block = Array.from(
    { length: 14 },
    (_item, index) => `Предложение номер ${index + 1} описывает измеримый факт работы команды за квартал.`,
  ).join(" ");
  const result = rewriter.reflowParagraphs([block, block, block].join("\n\n"));
  for (const paragraph of result.text.split("\n\n")) {
    assert.match(paragraph.trim(), /[.!?…]$/u, `абзац оборван: ${paragraph.slice(-40)}`);
  }
});

test("абзацы, уже разной длины, не трогаются", () => {
  const short = "Команда собрала прототип за шесть недель без внешней поддержки.";
  const long = Array.from(
    { length: 12 },
    (_item, index) => `Предложение ${index + 1} про измеримый факт работы команды за квартал.`,
  ).join(" ");
  const source = [short, long, short].join("\n\n");
  assert.equal(rewriter.reflowParagraphs(source).created, 0);
});

test("список не переразбивается", () => {
  const list = ["- первый пункт списка про измеримый факт", "- второй пункт списка про другой факт"].join("\n");
  const source = [list, list, list].join("\n\n");
  assert.equal(rewriter.reflowParagraphs(source).created, 0);
});
