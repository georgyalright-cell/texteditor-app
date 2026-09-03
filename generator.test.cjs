"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const core = require("./generator-core.js");
const { create } = require("./generator.js");

test("русский и английский получают разные строгие промпты", () => {
  const ru = core.buildMessages("Выручка выросла на 12%.", { language: "ru", count: 4 });
  const en = core.buildMessages("Revenue rose by 12%.", { language: "en", count: 4 });
  assert.match(ru[0].content, /Сохрани без изменений каждый факт/);
  assert.match(en[0].content, /Preserve every fact/);
  assert.notEqual(ru[0].content, en[0].content);
  assert.match(ru[1].content, /<sentence>/);
});

test("парсер снимает нумерацию, дубли и ограничивает ответ четырьмя версиями", () => {
  const variants = core.parseVariants([{ generated_text: [
    { role: "user", content: "source" },
    { role: "assistant", content: "1. Первая версия.\n2. Вторая версия.\n3. Первая версия.\n4. Третья версия.\n5. Четвёртая версия.\n6. Пятая версия." },
  ] }], { sentence: "Исходник.", count: 20 });
  assert.deepEqual(variants, ["Первая версия.", "Вторая версия.", "Третья версия.", "Четвёртая версия."]);
});

test("обёртка соблюдает контракт воркера и передаёт его прогресс в существующую панель", async () => {
  const progress = [];
  const posted = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.listeners = {};
    }
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
    postMessage(message) {
      posted.push(message);
      if (message.type === "release") return;
      this.listeners.message({ data: { type: "progress", message: "Загрузка", progress: 50 } });
      this.listeners.message({ data: { type: "variants", id: message.id, variants: ["Вариант."] } });
    }
  }
  const api = create({
    navigator: { gpu: {} },
    Worker: FakeWorker,
    NeuralScorerUI: { reportProgress: (message) => progress.push(message) },
  });
  const variants = await api.paraphrase("Исходное предложение.", { language: "ru", count: 99 });
  assert.deepEqual(variants, ["Вариант."]);
  assert.equal(posted[0].type, "paraphrase");
  assert.equal(posted[0].count, 4);
  assert.equal(posted[1].type, "release");
  assert.equal(progress[0].progress, 50);
});

test("без WebGPU генератор отказывает, не создавая воркер", async () => {
  const api = create({ navigator: {}, Worker: class UnexpectedWorker {} });
  await assert.rejects(api.paraphrase("Текст."), /WebGPU недоступен/);
});

test("воркер использует локальный рантайм и закреплённую ревизию модели", () => {
  const workerSource = fs.readFileSync(require.resolve("./generator-worker.js"), "utf8");
  assert.match(workerSource, /\.\/vendor\/transformers\/transformers\.web\.min\.mjs/);
  assert.match(workerSource, /GENERATOR_REVISION = "[0-9a-f]{40}"/);
  assert.doesNotMatch(workerSource, /import\([^)]+cdn\.jsdelivr\.net/);
});
