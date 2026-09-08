"use strict";

import "./author-style.js?v=43";
import "./business-english.js?v=43";
import "./generator-core.js?v=43";
import "./meaning-guard.js?v=43";
import "./model-progress.js?v=43";
import { CreateMLCEngine } from "./vendor/webllm/web-llm.mjs";

const GENERATOR_MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const GENERATOR_REVISION = "9bd564b064631febf14deadcac492efb761d60c3";
const MODEL_URL =
  `https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC/resolve/${GENERATOR_REVISION}`;
const MODEL_LIBRARY = new URL(
  "./vendor/webllm/Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm",
  self.location.href,
).href;
const SAMPLING_TEMPERATURE = 0.68;
const SAMPLING_TOP_P = 0.92;

const APP_CONFIG = {
  model_list: [{
    model: MODEL_URL,
    model_id: GENERATOR_MODEL,
    model_lib: MODEL_LIBRARY,
    low_resource_required: true,
    vram_required_MB: 1630,
    overrides: { context_window_size: 2048 },
  }],
  useIndexedDBCache: false,
};

let engine = null;
let loading = null;
let queue = Promise.resolve();

function send(type, detail) {
  self.postMessage({ type, ...detail });
}

/**
 * Повторный запуск не обязан возвращать тот же вариант. Seed меняет только
 * генеративные предложения: итог по-прежнему выбирают детерминированные гарды.
 */
function samplingSeed(requestId) {
  const fallback = (Date.now() + (Number(requestId) || 0)) % 2147483647;
  if (!self.crypto || typeof self.crypto.getRandomValues !== "function") return fallback;
  const value = new Uint32Array(1);
  self.crypto.getRandomValues(value);
  return value[0] % 2147483647;
}

function progressReporter(report) {
  send("progress", self.ModelProgress.generator(report));
}

async function loadGenerator() {
  if (engine) return engine;
  if (loading) return loading;
  loading = (async () => {
    send("progress", {
      progress: null,
      message: "Генератор · Qwen2.5 1.5B · проверяю кэш и подключаю модель. Первая загрузка — около 880 МБ…",
    });
    engine = await CreateMLCEngine(GENERATOR_MODEL, {
      appConfig: APP_CONFIG,
      initProgressCallback: progressReporter,
      logLevel: "WARN",
    });
    send("progress", { progress: null, message: "Генератор готов. Создаю новые формулировки…" });
    return engine;
  })();
  try {
    return await loading;
  } catch (error) {
    engine = null;
    throw error;
  } finally {
    loading = null;
  }
}

async function paraphrase(request) {
  try {
    const sentence = String(request.sentence || "").trim();
    if (!sentence) throw new Error("Предложение для перефразирования пусто.");
    if (sentence.length > 1800) throw new Error("Предложение слишком длинное для локальной редакции.");
    const count = self.GeneratorCore.variantCount(request.count);
    const localEngine = await loadGenerator();
    const position = Number(request.position);
    const total = Number(request.total);
    const stage = Number.isFinite(position) && Number.isFinite(total)
      ? ` · предложение ${position} из ${total}`
      : "";
    send("progress", {
      progress: null,
      message: `Глубокая редакция${stage}: создаю ${count} варианта…`,
    });
    const generate = ({ creative, strategy }) => localEngine.chat.completions.create({
      messages: self.GeneratorCore.buildMessages(sentence, {
        ...request,
        creative,
        strategy,
        language: request.language,
        count: 1,
      }),
      model: GENERATOR_MODEL,
      n: 1,
      max_tokens: self.GeneratorCore.outputBudget(sentence, request.language),
      temperature: request.contextual && !creative ? 0.4 : SAMPLING_TEMPERATURE,
      top_p: SAMPLING_TOP_P,
      repetition_penalty: 1.08,
      seed: samplingSeed(request.id),
    });
    const raw = [];
    const plan = self.GeneratorCore.generationPlan(request);
    for (const [index, approach] of plan.entries()) {
      send("progress", { progress: null,
        message: `Глубокая редакция${stage} · вариант ${index + 1} из ${count} · лимит ответа ${self.GeneratorCore.outputBudget(sentence, request.language)} токенов…` });
      raw.push(...self.GeneratorCore.completedChoices(await generate(approach)));
    }
    if (!raw.length) throw new Error("Модель не завершила ни одного варианта в пределах лимита. Незавершённые ответы отброшены.");
    const variants = self.GeneratorCore.parseVariants(raw, { sentence, count });
    send("variants", { id: request.id, variants });
  } catch (error) {
    send("error", {
      id: request.id,
      message: error instanceof Error ? error.message : "Локальный генератор не выполнил запрос.",
    });
  }
}

async function releaseGenerator() {
  if (engine && typeof engine.unload === "function") await engine.unload();
  engine = null;
}

self.addEventListener("message", (event) => {
  const request = event.data || {};
  if (request.type === "release") {
    queue = queue.then(releaseGenerator).catch(() => {
      engine = null;
    });
    return;
  }
  if (request.type !== "paraphrase") return;
  queue = queue.then(() => paraphrase(request));
});
