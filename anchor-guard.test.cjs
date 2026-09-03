"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const guard = require("./anchor-guard.js");

test("собирает числа, даты, единицы, ссылки и цитаты", () => {
  const anchors = guard.countByType(
    guard.extractAnchors("В 2024 году доля выросла до 12,5%, см. https://example.com (Иванов, 2023)."),
  );
  assert.ok(anchors.number >= 2);
  assert.equal(anchors.url, 1);
  assert.equal(anchors.citation, 1);
  assert.equal(anchors.date, 1);
});

test("кириллическая аббревиатура распознаётся как имя собственное", () => {
  const proper = guard.extractAnchors("Отчёт НИУ ВШЭ подготовлен кафедрой.").filter((item) => item.type === "proper");
  assert.deepEqual(proper.map((item) => item.value).sort(), ["вшэ", "ниу"]);
});

test("слово с заглавной, встречающееся в тексте со строчной, именем не считается", () => {
  const proper = guard.extractAnchors("Рынок растёт. Здесь рынок и Рынок — одно и то же слово.")
    .filter((item) => item.type === "proper");
  assert.deepEqual(proper, []);
});

test("удаление вводного оборота якорей не трогает", () => {
  const source = "Важно отметить, что выручка составила 3,2 млрд руб. в 2024 году.";
  const result = "Выручка составила 3,2 млрд руб. в 2024 году.";
  assert.equal(guard.compare(source, result).ok, true);
});

test("подмена числа ловится и как пропажа, и как появление", () => {
  const check = guard.compare("Доля 12,5% рынка.", "Доля 13% рынка.");
  assert.equal(check.ok, false);
  assert.equal(check.lost[0].value, "12,5%");
  assert.equal(check.added[0].value, "13%");
});

test("появление нового числа считается нарушением", () => {
  const check = guard.compare("Выручка выросла.", "Выручка выросла на 20%.");
  assert.equal(check.ok, false);
  assert.ok(check.added.length > 0);
});
