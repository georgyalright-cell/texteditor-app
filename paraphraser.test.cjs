"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const paraphraser = require("./paraphraser.js");

test("определяет английский текст и правит его академическим набором", () => {
  const result = paraphraser.paraphraseText("The team will utilize a wide range of cutting-edge instruments in the project.");
  assert.equal(result.language, "en");
  assert.match(result.text, /use various advanced instruments/u);
});

test("раскрывает сокращённые формы — они недопустимы в академическом тексте", () => {
  const source = "The company can't rely on one supplier, and it's clear that they're exposed to risk.";
  const result = paraphraser.paraphraseText(source).text;
  assert.match(result, /cannot rely/u);
  assert.match(result, /it is clear/u);
  assert.match(result, /they are exposed/u);
  assert.doesNotMatch(result, /can't|it's|they're/u);
});

test("убирает канцелярскую воду", () => {
  const source =
    "Due to the fact that demand is growing, the team will conduct an analysis of the segment in order to decide.";
  const result = paraphraser.paraphraseText(source).text;
  assert.match(result, /^Because demand is growing/u);
  assert.match(result, /analyse the segment to decide/u);
});

test("снимает обороты, характерные для языковых моделей", () => {
  const source =
    "It is worth noting that the report delves into unit economics and the model plays a key role in the plan.";
  const result = paraphraser.paraphraseText(source).text;
  assert.doesNotMatch(result, /worth noting|delves into|plays a key role/u);
  assert.match(result, /analyses|examines/u);
  assert.match(result, /is central/u);
});

test("исправления применяются везде, лимит остаётся только для связок", () => {
  const source =
    "The team can't wait. Moreover, the plan is due. Additionally, the model is ready. Thus, the work continues. " +
    "Hence, the schedule holds. The paragraph is long enough to be treated as ordinary connected prose by the tool.";
  const result = paraphraser.paraphraseText(source);
  assert.match(result.text, /cannot wait/u);
  const connectives = ["In addition,", "Also,", "Therefore,", "Consequently,", "As a result,", "Overall,"];
  const used = connectives.filter((item) => result.text.includes(item)).length;
  assert.ok(used >= 1 && used <= 3, `связок заменено: ${used}`);
});

test("сохраняет регистр в начале предложения", () => {
  const result = paraphraser.paraphraseText("Utilize the model for the forecast, then review the assumptions.").text;
  assert.match(result, /^Use the model/u);
});

test("не меняет прямые цитаты и библиографические ссылки", () => {
  const source = 'The author writes: "It is important to note that demand grows" [Ivanov, 2024: 17]. The rest is intact.';
  assert.equal(paraphraser.paraphraseText(source).text, source);
});

test("сохраняет числа, URL и абзацы", () => {
  const source =
    "The dataset was utilized in 2024 and published at https://example.com/a?id=27.\n\n" +
    "In conclusion, the method covers 3 tasks and stays applicable across the planning horizon of the project.";
  const result = paraphraser.paraphraseText(source);
  assert.match(result.text, /2024/u);
  assert.match(result.text, /https:\/\/example\.com\/a\?id=27/u);
  assert.match(result.text, /3 tasks/u);
  assert.equal(result.text.split(/\n{2,}/).length, 2);
  assert.equal(result.warnings.length, 0);
});

test("не трогает короткие заголовки", () => {
  assert.equal(paraphraser.paraphraseText("Executive Summary").text, "Executive Summary");
});

test("русский текст правится академическим русским набором, без научпопа", () => {
  const source = "Важно отметить, что в настоящее время проект играет ключевую роль и охватывает широкий спектр задач.";
  const result = paraphraser.paraphraseText(source);
  assert.equal(result.language, "ru");
  assert.match(result.text, /^Отметим, что/u);
  assert.match(result.text, /сейчас/u);
  assert.match(result.text, /имеет ключевое значение/u);
});

test("пересекающиеся вводные обороты не склеиваются в неестественную фразу", () => {
  const source = "В современном мире важно отметить, что цифровизация влияет на рынок.";
  const result = paraphraser.paraphraseText(source).text;
  assert.equal(result, "Сейчас цифровизация влияет на рынок.");
  assert.doesNotMatch(result, /сейчас отметим/iu);
});

test("переписывает частые русские формулировки из черновиков языковых моделей", () => {
  const source =
    "В рамках данного исследования цифровизация оказывает существенное влияние на рынок. " +
    "Данный подход предоставляет возможность провести анализ. " +
    "Таким образом, можно сделать вывод о том, что изменения необходимы.";
  const result = paraphraser.paraphraseText(source);
  assert.equal(result.language, "ru");
  assert.equal(
    result.text,
    "В этом исследовании цифровизация существенно влияет на рынок. " +
      "Этот подход позволяет провести анализ. Следовательно, изменения необходимы.",
  );
  assert.equal(result.replacements, 5);
});

test("не заменяет слово «данным» как существительное", () => {
  const source = "По данным Росстата показатель вырос на 12 процентов в 2025 году.";
  assert.equal(paraphraser.paraphraseText(source).text, source);
});

test("язык можно задать явно, минуя определение", () => {
  const result = paraphraser.paraphraseText("The team will utilize the model.", "ru");
  assert.equal(result.language, "ru");
  assert.equal(result.text, "The team will utilize the model.");
});

test("деловой английский B2-C1: вычурная лексика упрощается без разговорности", () => {
  const source = "The company commenced operations and subsequently demonstrated sufficient growth with regard to numerous markets.";
  const result = paraphraser.paraphraseText(source, "en").text;
  assert.match(result, /began operations/);
  assert.match(result, /later showed enough growth/);
  assert.match(result, /about many markets/);
  // Разговорность не вводится: сокращённых форм в академическом тексте быть
  // не должно, и упрощение регистра их не оправдывает.
  assert.doesNotMatch(result, /\b(?:don't|isn't|can't|it's|get)\b/i);
});

test("формы глагола не смешиваются", () => {
  const infinitive = paraphraser.paraphraseText("Stakeholders aim to facilitate the process.", "en").text;
  const third = paraphraser.paraphraseText("The platform facilitates the process.", "en").text;
  assert.match(infinitive, /to support the process/);
  assert.match(third, /supports the process/);
});
