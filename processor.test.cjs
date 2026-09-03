"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const processor = require("./processor.js");

test("исправляет рассыпавшиеся запятые и точки без появления буквального $1", () => {
  const result = processor.processText("Механика. . электроника. . код. . Новый раздел!!").text;
  assert.equal(result, "Механика, электроника, код. Новый раздел!");
  assert.doesNotMatch(result, /\$1/);
});

test("три раздельные точки превращает в многоточие", () => {
  assert.equal(processor.processText("Продолжение. . . возможно.").text, "Продолжение… возможно.");
});

test("превращает артефакт n n в абзац", () => {
  const result = processor.processText("Первый блок завершён. n nГазонокосилки работают дальше.").text;
  assert.equal(result, "Первый блок завершён.\n\nГазонокосилки работают дальше.");
});

test("превращает литеральный /rn в перенос, но не трогает обычную n", () => {
  const result = processor.processText("Строка один/rnСтрока два с буквой n внутри.").text;
  assert.equal(result, "Строка один\n\nСтрока два с буквой n внутри.");
});

test("сохраняет числа и ссылки", () => {
  const source = "В 1814 году открыли страницу https://example.com/a?id=27. . Затем записали 2,5 кг.";
  const result = processor.processText(source).text;
  assert.match(result, /1814/);
  assert.match(result, /https:\/\/example\.com\/a\?id=27/);
  assert.match(result, /2,5/);
});

test("ссылка с вопросительным знаком не мешает удалить повтор предложения", () => {
  const sentence = "Ссылка https://example.com/a?id=27 остаётся.";
  assert.equal(processor.processText(`${sentence} ${sentence}`).text, sentence);
});

test("соединяет случайный разрыв только перед строчной буквой", () => {
  const result = processor.processText("Это одна незаконченная\n\nстрока.\n\nНовый абзац начинается здесь.").text;
  assert.equal(result, "Это одна незаконченная строка.\n\nНовый абзац начинается здесь.");
});

test("собирает перенесённое дефисное написание без пробела", () => {
  const result = processor.processText("Пример «тук-\nтук» остаётся цельным.").text;
  assert.equal(result, "Пример «тук-тук» остаётся цельным.");
});

test("удаляет точный повтор соседнего предложения", () => {
  const sentence = "Промышленные роботы выполняют повторяющиеся операции очень точно.";
  const result = processor.processText(`${sentence} ${sentence} Следующий этап уже начался.`).text;
  assert.equal(result, `${sentence} Следующий этап уже начался.`);
});

test("сохраняет академические связки из эталонного текста", () => {
  const source = "Важно также отметить, что пример показателен. Следовательно, вывод сохраняется. Итак, работа завершена.";
  assert.equal(processor.processText(source).text, source);
});

test("не режет обычные абзацы на одинаковые короткие блоки", () => {
  const source = Array.from(
    { length: 12 },
    (_value, index) => `Предложение ${index + 1} содержит несколько слов и продолжает одну законченную мысль.`,
  ).join(" ");
  assert.equal(processor.processText(source).text, source);
});
