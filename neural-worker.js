"use strict";

importScripts("./neural-scorer-core.js?v=42");
importScripts("./model-progress.js?v=42");

const TRANSFORMERS_URL = "./vendor/transformers/transformers.web.min.mjs?v=42";
const OBSERVER_MODEL = "onnx-community/Qwen2.5-0.5B-ONNX";
const OBSERVER_REVISION = "edb2f22b84411a7990bd63bf64c6a471fbd13ecc";
const PERFORMER_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct-ONNX";
const PERFORMER_REVISION = "4b32b4541cf2de9d0c0a85125e8fe8d9943f7982";
const MAX_TOKENS = 128;

let tokenizer = null;
let observer = null;
let performer = null;
let loading = null;
let queue = Promise.resolve();

function send(type, detail) {
  self.postMessage({ type, ...detail });
}

function progressReporter(stage) {
  return (event) => send("progress", self.ModelProgress.transformers(stage, event));
}

async function loadModels(perplexityOnly) {
  if (tokenizer && observer && (perplexityOnly || performer)) return;
  if (loading) return loading;
  loading = (async () => {
    const adapter = self.navigator && self.navigator.gpu && await self.navigator.gpu.requestAdapter();
    if (!adapter || !adapter.features.has("shader-f16")) {
      throw new Error("Устройство не поддерживает нужный режим WebGPU (shader-f16). Модели не загружались.");
    }
    send("progress", { stage: "Подготовка", progress: null, message: "Подключаю локальный вычислительный модуль…" });
    const transformers = await import(TRANSFORMERS_URL);
    transformers.env.backends.onnx.wasm.wasmPaths = {
      mjs: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs", self.location.href).href,
      wasm: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm", self.location.href).href,
    };
    if (!tokenizer) tokenizer = await transformers.AutoTokenizer.from_pretrained(OBSERVER_MODEL, {
      revision: OBSERVER_REVISION,
      progress_callback: progressReporter("Токенизатор · Qwen2.5"),
    });
    if (!observer) observer = await transformers.AutoModelForCausalLM.from_pretrained(OBSERVER_MODEL, {
      device: "webgpu",
      dtype: "q4f16",
      revision: OBSERVER_REVISION,
      progress_callback: progressReporter("Перплексия · Qwen2.5 0.5B"),
    });
    if (!perplexityOnly && !performer) performer = await transformers.AutoModelForCausalLM.from_pretrained(PERFORMER_MODEL, {
      device: "webgpu",
      dtype: "q4f16",
      revision: PERFORMER_REVISION,
      progress_callback: progressReporter("Binoculars · Qwen2.5 0.5B Instruct"),
    });
    send("ready", { fullPair: Boolean(performer), message: "Оценщик готов. Файлы обычно сохранены в кэше браузера." });
  })();
  try {
    await loading;
  } catch (error) {
    for (const model of [observer, performer]) {
      try { if (model && model.dispose) await model.dispose(); } catch (_) { /* retain the original load error */ }
    }
    tokenizer = null;
    observer = null;
    performer = null;
    throw error;
  } finally {
    loading = null;
  }
}

function releaseOutput(output) {
  if (!output || typeof output !== "object") return;
  const seen = new Set();
  const release = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (typeof value.dispose === "function") {
      value.dispose();
      return;
    }
    for (const nested of Object.values(value)) release(nested);
  };
  for (const value of Object.values(output)) {
    release(value);
  }
}

async function scoreText(text, label, fullText, perplexityOnly) {
  send("progress", { stage: "Оценка", progress: null, message: `Считаю ${label}…` });
  const inputs = await tokenizer(String(text || ""), {
    truncation: !fullText,
    max_length: MAX_TOKENS,
    add_special_tokens: true,
  });
  const ids = inputs.input_ids && inputs.input_ids.data;
  if (!ids || ids.length < 8 || (fullText && ids.length > MAX_TOKENS)) {
    releaseOutput(inputs);
    if (fullText) return null;
    throw new Error("Для нейрооценки нужно хотя бы несколько предложений.");
  }

  let observerOutput;
  let performerOutput;
  try {
    observerOutput = await observer(inputs);
    if (perplexityOnly) {
      if (!observerOutput.logits) throw new Error("Модель не вернула логиты текста.");
      const result = self.NeuralScorerCore.scorePerplexity(observerOutput.logits.data, ids, observerOutput.logits.dims);
      return { ...result, complete: Boolean(fullText && result.tokenCount === ids.length) };
    }
    performerOutput = await performer(inputs);
    if (!observerOutput.logits || !performerOutput.logits) throw new Error("Модель не вернула логиты текста.");
    const result = self.NeuralScorerCore.scoreLogits(
      observerOutput.logits.data,
      performerOutput.logits.data,
      ids,
      observerOutput.logits.dims,
      performerOutput.logits.dims,
    );
    return { ...result, complete: Boolean(fullText && result.tokenCount === ids.length) };
  } finally {
    releaseOutput(observerOutput);
    releaseOutput(performerOutput);
    releaseOutput(inputs);
  }
}

// Отбор формулировок просит оценить сразу несколько версий одного куска
// текста. Считать их по одной через отдельные сообщения нельзя: модели
// загружаются один раз, и накладные расходы на пересылку между потоками
// сопоставимы с самим счётом. Прогресс шлётся по мере готовности, чтобы
// интерфейс не выглядел зависшим — на WebGPU это секунды на кандидата.
async function scoreBatch(texts, fullText, perplexityOnly) {
  const scores = [];
  const cache = new Map();
  for (let index = 0; index < texts.length; index += 1) {
    send("progress", {
      stage: "Отбор",
      progress: 100 * index / texts.length,
      message: `Оцениваю вариант ${index + 1} из ${texts.length}…`,
    });
    if (!cache.has(texts[index])) cache.set(texts[index], await scoreText(texts[index], `вариант ${index + 1}`, fullText, perplexityOnly));
    scores.push(cache.get(texts[index]));
  }
  return scores;
}

async function handle(request) {
  if (request.type === "scoreMany") {
    try {
      const texts = Array.isArray(request.texts) ? request.texts.map((item) => String(item || "")) : [];
      if (!texts.length) throw new Error("Нечего оценивать: список вариантов пуст.");
      if (texts.length > 32 || (request.fullText && texts.some((text) => text.length > 1800))) throw new Error("Превышен размер пакета нейрооценки.");
      await loadModels(request.perplexityOnly);
      send("scores", { id: request.id, fullPair: Boolean(performer), scores: await scoreBatch(texts, request.fullText, request.perplexityOnly) });
    } catch (error) {
      send("error", {
        id: request.id,
        message: error instanceof Error ? error.message : "Не удалось оценить варианты.",
      });
    }
    return;
  }
  if (request.type !== "score") return;
  try {
    await loadModels();
    const before = await scoreText(request.source, "исходник");
    const after = request.source === request.result ? before : await scoreText(request.result, "результат");
    send("result", { id: request.id, before, after, maxTokens: MAX_TOKENS });
  } catch (error) {
    send("error", {
      id: request.id,
      message: error instanceof Error ? error.message : "Не удалось выполнить локальную нейрооценку.",
    });
  }
}
self.addEventListener("message", ({ data }) => {
  queue = queue.then(() => handle(data || {})).catch((error) => send("error", { id: data && data.id, message: error.message }));
});
