"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

// Хранилище подставляется до загрузки модуля: он определяет доступность
// один раз на каждый вызов, но обращается к globalThis.localStorage.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const baseline = require("./usage-baseline.js");

function report(values, extra) {
  return Object.assign(
    {
      genreId: "academic",
      language: "ru",
      metrics: Object.keys(values).map((id) => ({ id, label: id, value: values[id], direction: "down" })),
    },
    extra,
  );
}

test("в хранилище попадают только числа, ни одного слова текста", () => {
  baseline.clear();
  baseline.record(
    report({ hedgeDensity: 2 }, { metrics: [{ id: "hedgeDensity", label: "Хеджи", value: 2, evidence: { samples: ["секретное предложение"] } }] }),
  );
  const dump = JSON.stringify([...store.values()]);
  assert.doesNotMatch(dump, /секретное/);
  assert.match(dump, /hedgeDensity/);
});

test("сравнение молчит, пока наблюдений мало", () => {
  baseline.clear();
  baseline.record(report({ hedgeDensity: 1 }));
  assert.deepEqual(baseline.compare(report({ hedgeDensity: 1 })).rows, []);
});

test("показывает долю прежних текстов со слабее выраженным признаком", () => {
  baseline.clear();
  for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) baseline.record(report({ hedgeDensity: value }));
  const row = baseline.compare(report({ hedgeDensity: 9.5 })).rows.find((item) => item.id === "hedgeDensity");
  assert.equal(row.share, 0.9);
  assert.equal(baseline.compare(report({ hedgeDensity: 5 })).rows[0].share, 0.45);
  assert.equal(row.median, 5.5);
});

test("жанры и языки не смешиваются", () => {
  baseline.clear();
  for (let index = 0; index < 6; index += 1) baseline.record(report({ hedgeDensity: 1 }));
  const other = report({ hedgeDensity: 1 }, { genreId: "landing" });
  assert.deepEqual(baseline.compare(other).rows, []);
  assert.equal(baseline.compare(other).count, 0);
});

test("окно наблюдений ограничено", () => {
  baseline.clear();
  for (let index = 0; index < baseline.LIMIT + 40; index += 1) baseline.record(report({ hedgeDensity: index }));
  assert.equal(baseline.samplesFor("academic", "ru").length, baseline.LIMIT);
});

test("в заметные отличия попадают только края распределения", () => {
  baseline.clear();
  for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) baseline.record(report({ hedgeDensity: value, anchorDensity: 5 }));
  const notable = baseline.highlights(report({ hedgeDensity: 10, anchorDensity: 5 })).rows;
  assert.equal(notable.length, 1);
  assert.equal(notable[0].id, "hedgeDensity");
});
