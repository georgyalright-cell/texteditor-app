"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const scorer = require("./neural-scorer-core.js");

test("равномерные модели дают perplexity словаря и Binoculars 1", () => {
  const logits = new Float32Array(3 * 3);
  const result = scorer.scoreLogits(logits, logits, BigInt64Array.from([0n, 1n, 2n]), [1, 3, 3], [1, 3, 3]);
  assert.ok(Math.abs(result.perplexity - 3) < 1e-9);
  assert.ok(Math.abs(result.binoculars - 1) < 1e-9);
  assert.equal(result.tokenCount, 3);
});

test("перплексия считается по следующему фактическому токену", () => {
  const observer = Float32Array.from([
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
  ]);
  const performer = Float32Array.from([
    0, 4, 0,
    0, 0, 4,
    0, 0, 0,
  ]);
  const result = scorer.scoreLogits(observer, performer, [0, 1, 2], [1, 3, 3], [1, 3, 3]);
  assert.ok(result.perplexity < 1.1, `получено ${result.perplexity}`);
  assert.ok(result.binoculars < 0.1, `получено ${result.binoculars}`);
});

test("несовместимые модели отклоняются явно", () => {
  assert.throws(
    () => scorer.scoreLogits(new Float32Array(12), new Float32Array(15), [0, 1, 2], [1, 3, 4], [1, 3, 5]),
    /несовместимые формы/u,
  );
});

test("для одного токена оценка не строится", () => {
  assert.throws(
    () => scorer.scoreLogits(new Float32Array(3), new Float32Array(3), [0], [1, 1, 3], [1, 1, 3]),
    /недостаточно данных/u,
  );
});
