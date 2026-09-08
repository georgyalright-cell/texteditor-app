"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const core = require("./generator-core.js");
const { create } = require("./generator.js");

test("contextual generation uses four distinct editing approaches within the same cap", () => {
  const plan = core.generationPlan({ contextual: true, creative: true, count: 99 });
  assert.equal(plan.length, 4);
  assert.equal(plan[0].creative, false);
  assert.equal(new Set(plan.map(p => p.strategy)).size, 4);
  for (const language of ["ru", "en"]) {
    const messages = plan.map(p => core.buildMessages("Source.", { ...p, language, contextual: true })[0].content);
    assert.equal(new Set(messages).size, 4);
    for (const message of messages) assert.match(message, language === "en" ? /degree of certainty/ : /степень уверенности/);
  }
  assert.equal(core.generationPlan({ contextual: true, creative: true, count: 1 }).length, 1);
  assert.ok(core.generationPlan({ count: 4 }).every(p => !p.creative));
});
test("output budget gives longer Russian sentences room without unbounded generation", () => {
  assert.equal(core.outputBudget("Short sentence.", "en"), 160);
  assert.equal(core.outputBudget("слово ".repeat(80), "ru"), 352);
  assert.equal(core.outputBudget("word ".repeat(80), "en"), 192);
  assert.equal(core.outputBudget("слово ".repeat(1000), "ru"), 384);
});
test("token-truncated and abnormal model completions never enter candidate selection", () => {
  assert.deepEqual(core.completedChoices({ choices: [
    { finish_reason: "length", message: { content: "A plausible but incomplete claim." } },
    { finish_reason: "stop", message: { content: "Completed sentence." } },
    { finish_reason: "error", message: { content: "Broken sentence." } },
  ] }), ["Completed sentence."]);
  assert.deepEqual(core.completedChoices(null), []);
});

test("русский и английский получают разные строгие промпты", () => {
  const ru = core.buildMessages("Выручка выросла на 12%.", { language: "ru", count: 4 });
  const en = core.buildMessages("Revenue rose by 12%.", { language: "en", count: 4 });
  assert.match(ru[0].content, /Сохрани без изменений каждый факт/);
  assert.match(ru[0].content, /Перестрой синтаксис/);
  assert.match(en[0].content, /Preserve every fact/);
  assert.match(en[0].content, /Rebuild the syntax/);
  assert.notEqual(ru[0].content, en[0].content);
  assert.match(ru[1].content, /<sentence>/);
});

test("одиночный проход просит перестроить части и сохранить длинные слова", () => {
  const ru = core.buildMessages("Регулярное наблюдение помогает замечать отклонения.", { language: "ru", count: 1 });
  const en = core.buildMessages("Regular monitoring helps identify deviations.", { language: "en", count: 1 });
  assert.match(ru[0].content, /слово длиной от 10 букв/);
  assert.match(en[0].content, /word of 10 or more characters/);
  assert.doesNotMatch(ru[1].content, /\/no_think/);
});

test("парсер снимает нумерацию, дубли и ограничивает ответ четырьмя версиями", () => {
  const variants = core.parseVariants([{ generated_text: [
    { role: "user", content: "source" },
    { role: "assistant", content: "1. Первая версия.\n2. Вторая версия.\n3. Первая версия.\n4. Третья версия.\n5. Четвёртая версия.\n6. Пятая версия." },
  ] }], { sentence: "Исходник.", count: 20 });
  assert.deepEqual(variants, ["Первая версия.", "Вторая версия.", "Третья версия.", "Четвёртая версия."]);
});

test("парсер не принимает служебные think-теги за варианты", () => {
  const variants = core.parseVariants([{ generated_text: [
    { role: "assistant", content: "<think>\n</think>\nПерестроенное предложение." },
  ] }], { sentence: "Исходное предложение.", count: 4 });
  assert.deepEqual(variants, ["Перестроенное предложение."]);
});

test("парсер собирает независимые ответы num_return_sequences", () => {
  const variants = core.parseVariants([
    { generated_text: [{ role: "assistant", content: "Первый вариант." }] },
    { generated_text: [{ role: "assistant", content: "Второй вариант." }] },
    { generated_text: [{ role: "assistant", content: "Третий вариант." }] },
  ], { sentence: "Исходник.", count: 3 });
  assert.deepEqual(variants, ["Первый вариант.", "Второй вариант.", "Третий вариант."]);
});

test("обёртка соблюдает контракт воркера и передаёт его прогресс в существующую панель", async () => {
  const progress = [];
  const posted = [];
  const workers = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.listeners = {};
      workers.push(this);
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
  const variants = await api.paraphrase("Исходное предложение.", {
    language: "ru",
    count: 99,
    position: 2,
    total: 7,
  });
  api.release();
  assert.deepEqual(variants, ["Вариант."]);
  assert.equal(workers[0].options.type, "module");
  assert.equal(posted[0].type, "paraphrase");
  assert.equal(posted[0].count, 4);
  assert.equal(posted[0].position, 2);
  assert.equal(posted[0].total, 7);
  assert.equal(posted[1].type, "release");
  assert.equal(progress[0].progress, 50);
});

test("без WebGPU генератор отказывает, не создавая воркер", async () => {
  const api = create({ navigator: {}, Worker: class UnexpectedWorker {} });
  await assert.rejects(api.paraphrase("Текст."), /WebGPU недоступен/);
});

test("воркер использует локальный рантайм и закреплённую ревизию модели", () => {
  const workerSource = fs.readFileSync(require.resolve("./generator-worker.js"), "utf8");
  assert.match(workerSource, /\.\/vendor\/webllm\/web-llm\.mjs/);
  assert.match(workerSource, /\.\/vendor\/webllm\/Qwen2-1\.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu\.wasm/);
  assert.match(workerSource, /Qwen2\.5-1\.5B-Instruct-q4f16_1-MLC/);
  assert.match(workerSource, /GENERATOR_REVISION = "[0-9a-f]{40}"/);
  assert.match(workerSource, /resolve\/\$\{GENERATOR_REVISION\}/);
  assert.doesNotMatch(workerSource, /from\s+["']https?:/u);
});

test("глубокая редакция добавляет только контролируемую вариативность", () => {
  const workerSource = fs.readFileSync(require.resolve("./generator-worker.js"), "utf8");
  const generatorSource = fs.readFileSync(require.resolve("./generator.js"), "utf8");
  assert.match(workerSource, /crypto\.getRandomValues/u);
  assert.match(workerSource, /SAMPLING_TEMPERATURE = 0\.68/u);
  assert.match(workerSource, /SAMPLING_TOP_P = 0\.92/u);
  assert.match(workerSource, /seed: samplingSeed\(request\.id\)/u);
  assert.doesNotMatch(workerSource, /seed:\s*20260903/u);
  assert.match(generatorSource, /generator-worker\.js\?v=45/u);
});
