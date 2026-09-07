(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuthorStyle = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const KEY = "texteditor.author-style.v1";
  const MAX_CHARS = 60000;
  const words = (text) => String(text || "").match(/[\p{L}\p{N}]+/gu) || [];
  const sentences = (text) => String(text || "").match(/[^.!?…]+[.!?…]+|[^.!?…]+$/gu) || [];
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

  function language(text) {
    const ru = (text.match(/[а-яё]/giu) || []).length;
    const en = (text.match(/[a-z]/giu) || []).length;
    return ru > en ? "ru" : "en";
  }

  function measure(text) {
    const lengths = sentences(text).map((item) => words(item).length).filter(Boolean);
    const average = mean(lengths);
    return {
      sentenceWords: average,
      sentenceSpread: average ? Math.sqrt(mean(lengths.map((n) => (n - average) ** 2))) / average : 0,
      shortShare: lengths.filter((n) => n <= 12).length / Math.max(1, lengths.length),
      paragraphWords: mean(String(text).split(/\n\s*\n/u).map((p) => words(p).length).filter(Boolean)),
    };
  }

  function build(text) {
    const source = String(text || "").trim();
    if (source.length > MAX_CHARS) throw new Error("Для образца достаточно 60 000 символов. Выберите более короткий фрагмент.");
    const count = words(source).length;
    if (count < 200 || sentences(source).length < 8) throw new Error("Добавьте хотя бы 200 слов и 8 предложений своего текста.");
    const lang = language(source);
    const letters = (source.match(/\p{L}/gu) || []).length;
    const matching = (source.match(lang === "ru" ? /[а-яё]/giu : /[a-z]/giu) || []).length;
    if (matching / Math.max(1, letters) < 0.85) throw new Error("Добавляйте русские и английские образцы отдельно.");
    const excerpts = sentences(source).map((s) => s.trim()).filter((s) =>
      words(s).length >= 8 && s.length <= 280 && !/[<>\[\]{}|\d]/u.test(s));
    return { version: 1, language: lang, words: count, sentences: sentences(source).length,
      metrics: measure(source), examples: [...new Set(excerpts)].slice(0, 2) };
  }

  function validate(profile) {
    if (!profile || profile.version !== 1 || !["ru", "en"].includes(profile.language)) return null;
    if (!Number.isInteger(profile.words) || profile.words < 200 || profile.words > MAX_CHARS) return null;
    if (!Number.isInteger(profile.sentences) || profile.sentences < 8 || profile.sentences > MAX_CHARS) return null;
    const limits = { sentenceWords: [1, 1000], sentenceSpread: [0, 20], shortShare: [0, 1], paragraphWords: [1, MAX_CHARS] };
    const metrics = {};
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = profile.metrics && profile.metrics[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
      metrics[key] = value;
    }
    const examples = Array.isArray(profile.examples) ? profile.examples.filter((s) => typeof s === "string" && s.length <= 280).slice(0, 2) : [];
    return { version: 1, language: profile.language, words: profile.words, sentences: profile.sentences, metrics, examples };
  }

  function terms(value) {
    const list = Array.isArray(value) ? value : String(value || "").split(/\r?\n/u);
    return [...new Set(list.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean))]
      .filter((s) => s.length <= 80 && !/[<>\n\r\u0000-\u001f]/u.test(s)).slice(0, 40);
  }

  function empty() { return { version: 1, enabled: false, profiles: {}, terms: [] }; }

  function parse(raw) {
    try {
      if (typeof raw !== "string" || raw.length > 20000) return empty();
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return empty();
      const profiles = {};
      for (const lang of ["ru", "en"]) {
        const profile = validate(data.profiles && data.profiles[lang]);
        if (profile && profile.language === lang) profiles[lang] = profile;
      }
      return { version: 1, enabled: data.enabled === true, profiles, terms: terms(data.terms) };
    } catch (_) { return empty(); }
  }

  function load(storage) {
    try { return parse(storage.getItem(KEY)); } catch (_) { return empty(); }
  }

  function save(storage, value) {
    const data = parse(JSON.stringify(value));
    storage.setItem(KEY, JSON.stringify(data));
    return data;
  }

  function distance(text, profile) {
    const valid = validate(profile);
    if (!valid) return 0;
    const actual = measure(text);
    // A personal preference only, never a replacement for corpus-calibrated zones.
    return Math.min(1, Math.abs(actual.sentenceWords - valid.metrics.sentenceWords) / Math.max(8, valid.metrics.sentenceWords));
  }

  return { KEY, MAX_CHARS, build, validate, terms, parse, load, save, empty, measure, distance };
});
