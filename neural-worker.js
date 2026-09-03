"use strict";

importScripts("./neural-scorer-core.js?v=18");

const TRANSFORMERS_URL = "./vendor/transformers/transformers.web.min.mjs?v=19";
const OBSERVER_MODEL = "onnx-community/Qwen2.5-0.5B-ONNX";
const OBSERVER_REVISION = "edb2f22b84411a7990bd63bf64c6a471fbd13ecc";
const PERFORMER_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct-ONNX";
const PERFORMER_REVISION = "4b32b4541cf2de9d0c0a85125e8fe8d9943f7982";
const MAX_TOKENS = 128;

let tokenizer = null;
let observer = null;
let performer = null;
let loading = null;

function send(type, detail) {
  self.postMessage({ type, ...detail });
}

function progressReporter(stage) {
  return (event) => {
    const progress = Number.isFinite(event && event.progress) ? Math.round(event.progress) : null;
    const filename = event && event.file ? String(event.file).split("/").pop() : "";
    send("progress", {
      stage,
      progress,
      message: `${stage}${filename ? ` · ${filename}` : ""}${progress === null ? "" : ` · ${progress}%`}`,
    });
  };
}

async function loadModels() {
  if (tokenizer && observer && performer) return;
  if (loading) return loading;
  loading = (async () => {
    send("progress", { stage: "Подготовка", progress: null, message: "Подключаю локальный вычислительный модуль…" });
    const transformers = await import(TRANSFORMERS_URL);
    transformers.env.backends.onnx.wasm.wasmPaths = {
      mjs: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs", self.location.href).href,
      wasm: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm", self.location.href).href,
    };
    tokenizer = await transformers.AutoTokenizer.from_pretrained(OBSERVER_MODEL, {
      revision: OBSERVER_REVISION,
      progress_callback: progressReporter("Токенизатор"),
    });
    observer = await transformers.AutoModelForCausalLM.from_pretrained(OBSERVER_MODEL, {
      device: "webgpu",
      dtype: "q4f16",
      revision: OBSERVER_REVISION,
      progress_callback: progressReporter("Базовая модель"),
    });
    performer = await transformers.AutoModelForCausalLM.from_pretrained(PERFORMER_MODEL, {
      device: "webgpu",
      dtype: "q4f16",
      revision: PERFORMER_REVISION,
      progress_callback: progressReporter("Инструктивная модель"),
    });
    send("ready", { message: "Модели готовы и сохранены в кэше браузера." });
  })();
  try {
    await loading;
  } catch (error) {
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

async function scoreText(text, label) {
  send("progress", { stage: "Оценка", progress: null, message: `Считаю ${label}…` });
  const inputs = await tokenizer(String(text || ""), {
    truncation: true,
    max_length: MAX_TOKENS,
    add_special_tokens: true,
  });
  const ids = inputs.input_ids && inputs.input_ids.data;
  if (!ids || ids.length < 8) throw new Error("Для нейрооценки нужно хотя бы несколько предложений.");

  let observerOutput;
  let performerOutput;
  try {
    observerOutput = await observer(inputs);
    performerOutput = await performer(inputs);
    if (!observerOutput.logits || !performerOutput.logits) throw new Error("Модель не вернула логиты текста.");
    return self.NeuralScorerCore.scoreLogits(
      observerOutput.logits.data,
      performerOutput.logits.data,
      ids,
      observerOutput.logits.dims,
      performerOutput.logits.dims,
    );
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
async function scoreBatch(texts) {
  const scores = [];
  for (let index = 0; index < texts.length; index += 1) {
    send("progress", {
      stage: "Отбор",
      progress: index / texts.length,
      message: `Оцениваю вариант ${index + 1} из ${texts.length}…`,
    });
    scores.push(await scoreText(texts[index], `вариант ${index + 1}`));
  }
  return scores;
}

self.addEventListener("message", async (event) => {
  const request = event.data || {};
  if (request.type === "scoreMany") {
    try {
      await loadModels();
      const texts = Array.isArray(request.texts) ? request.texts.map((item) => String(item || "")) : [];
      if (!texts.length) throw new Error("Нечего оценивать: список вариантов пуст.");
      send("scores", { id: request.id, scores: await scoreBatch(texts) });
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
});
