"use strict";
importScripts("./meaning-guard.js?v=51");
importScripts("./revision-quality.js?v=51");
importScripts("./model-progress.js?v=51");

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const REVISION = "2c4055b12046f11709e9df2c122e59ffbdc2f900";
let extractor;
let queue = Promise.resolve();
const progress = (detail) => self.postMessage({ type: "progress", ...(typeof detail === "string" ? { message: detail } : detail) });

async function load() {
  if (extractor) return;
  const { pipeline, env } = await import("./vendor/transformers/transformers.web.min.mjs?v=51");
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs", self.location.href).href,
    wasm: new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm", self.location.href).href,
  };
  progress("Проверка смысла · MiniLM · проверяю кэш. Первая загрузка — около 140 МБ…");
  extractor = await pipeline("feature-extraction", MODEL, {
    revision: REVISION, device: "wasm", dtype: "q8",
    progress_callback: (event) => progress(self.ModelProgress.transformers("Проверка смысла · MiniLM", event)),
  });
}

async function score(request) {
  try {
    if (!Array.isArray(request.pairs) || request.pairs.length > 48) throw new Error("Слишком много вариантов для проверки.");
    await load();
    const cache = new Map();
    const embed = async (text) => {
      if (cache.has(text)) return cache.get(text);
      if (typeof text !== "string" || text.length > 1800) return null;
      const input = await extractor.tokenizer(text, { truncation: false });
      const size = input.input_ids.data.length;
      for (const tensor of Object.values(input)) if (tensor.dispose) tensor.dispose();
      // The model was trained with max_seq_length=128. Never silently compare
      // prefixes and present that result as a check of the full sentences.
      if (size > 128) return null;
      const output = await extractor(text, { pooling: "mean", normalize: true, truncation: true, max_length: 128 });
      const vector = Array.from(output.data);
      if (output.dispose) output.dispose();
      cache.set(text, vector);
      return vector;
    };
    const scores = [];
    for (const [index, pair] of request.pairs.entries()) {
      progress(`Сравниваю смысл · ${index + 1} из ${request.pairs.length}…`);
      scores.push(self.RevisionQuality.cosine(await embed(pair.source), await embed(pair.candidate)));
    }
    self.postMessage({ type: "scores", id: request.id, scores });
  } catch (error) {
    self.postMessage({ type: "error", id: request.id, message: error.message || "Проверка смысла недоступна." });
  }
}

self.onmessage = ({ data }) => {
  if (data.type === "score") queue = queue.then(() => score(data));
};
