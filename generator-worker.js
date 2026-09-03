"use strict";

importScripts("./generator-core.js?v=18");

const TRANSFORMERS_URL = "./vendor/transformers/transformers.web.min.mjs?v=18";
const GENERATOR_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
const GENERATOR_REVISION = "cc5cc01a65cc3ff17bdb73a7de33d879f62599b0";
const MAX_NEW_TOKENS = 256;

let generator = null;
let loading = null;
let queue = Promise.resolve();

function send(type, detail) {
  self.postMessage({ type, ...detail });
}

function progressReporter(event) {
  const progress = Number.isFinite(event && event.progress) ? Math.round(event.progress) : null;
  const filename = event && event.file ? String(event.file).split("/").pop() : "";
  send("progress", {
    progress,
    message: `Генератор · загрузка${filename ? ` ${filename}` : ""}${progress === null ? "" : ` · ${progress}%`}`,
  });
}

async function loadGenerator() {
  if (generator) return generator;
  if (loading) return loading;
  loading = (async () => {
    send("progress", { progress: null, message: "Подключаю локальный генератор формулировок…" });
    const transformers = await import(TRANSFORMERS_URL);
    transformers.env.backends.onnx.wasm.wasmPaths = {
      mjs: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs", self.location.href).href,
      wasm: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm", self.location.href).href,
    };
    generator = await transformers.pipeline("text-generation", GENERATOR_MODEL, {
      device: "webgpu",
      dtype: "q4f16",
      revision: GENERATOR_REVISION,
      progress_callback: progressReporter,
    });
    send("progress", { progress: null, message: "Генератор загружен. Готовлю варианты…" });
    return generator;
  })();
  try {
    return await loading;
  } catch (error) {
    generator = null;
    throw error;
  } finally {
    loading = null;
  }
}

async function paraphrase(request) {
  try {
    const sentence = String(request.sentence || "").trim();
    if (!sentence) throw new Error("Предложение для перефразирования пусто.");
    const count = self.GeneratorCore.variantCount(request.count);
    const pipeline = await loadGenerator();
    send("progress", {
      progress: null,
      message: `Генерирую до ${count} вариантов одного предложения…`,
    });
    const output = await pipeline(self.GeneratorCore.buildMessages(sentence, {
      language: request.language,
      count,
    }), {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: true,
      temperature: 0.75,
      top_p: 0.9,
      repetition_penalty: 1.08,
      return_full_text: false,
    });
    const variants = self.GeneratorCore.parseVariants(output, { sentence, count });
    send("variants", { id: request.id, variants });
  } catch (error) {
    send("error", {
      id: request.id,
      message: error instanceof Error ? error.message : "Локальный генератор не выполнил запрос.",
    });
  }
}

async function releaseGenerator() {
  if (generator && typeof generator.dispose === "function") await generator.dispose();
  generator = null;
}

self.addEventListener("message", (event) => {
  const request = event.data || {};
  if (request.type === "release") {
    queue = queue.then(releaseGenerator).catch(() => {
      generator = null;
    });
    return;
  }
  if (request.type !== "paraphrase") return;
  queue = queue.then(() => paraphrase(request));
});
