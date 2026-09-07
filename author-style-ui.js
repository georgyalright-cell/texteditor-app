(function attach(root) {
  "use strict";
  const api = root.AuthorStyle;
  let state = api.empty();
  try { state = api.load(root.localStorage); } catch (_) { /* session-only mode */ }
  const byId = (id) => document.getElementById(id);
  const status = byId("authorStyleStatus");
  const input = byId("authorStyleText");
  const enabled = byId("authorStyleEnabled");
  const glossary = byId("authorTerms");
  let reading = 0;
  function render(message) {
    enabled.checked = state.enabled;
    glossary.value = state.terms.join("\n");
    const profiles = Object.values(state.profiles).map((p) => `${p.language === "ru" ? "Русский" : "Английский"}: ${p.words} слов, средняя длина предложения ${Math.round(p.metrics.sentenceWords)} слов`);
    status.textContent = message || (profiles.length ? `${profiles.join(". ")}. Профиль ${state.enabled ? "включён" : "выключен"}.` : "Образцов пока нет — работает стандартная редактура.");
  }
  function persist() {
    try { state = api.save(root.localStorage, state); render(); }
    catch (_) { render("Профиль действует до закрытия вкладки: браузер запретил сохранение. Можно скачать профиль."); }
  }
  enabled.addEventListener("change", () => { state.enabled = enabled.checked; persist(); });
  glossary.addEventListener("change", () => { state.terms = api.terms(glossary.value); persist(); });
  byId("authorStyleSave").addEventListener("click", () => {
    try {
      const profile = api.build(input.value);
      state.profiles[profile.language] = profile;
      state.enabled = true;
      input.value = "";
      persist();
    } catch (error) { render(error.message); }
  });
  byId("authorStyleFiles").addEventListener("change", async (event) => {
    const operation = ++reading;
    const files = Array.from(event.target.files || []);
    try {
      if (files.length > 5) throw new Error("За один раз выберите не больше пяти образцов на одном языке.");
      const texts = [];
      for (const file of files) {
        if (file.size > 2 * 1024 * 1024) throw new Error("Образец должен быть меньше 2 МБ.");
        texts.push(await root.DocumentReader.readFile(file));
        if (texts.join("\n\n").length > api.MAX_CHARS) throw new Error("Образцы превышают 60 000 символов. Выберите более короткие тексты.");
      }
      if (operation !== reading) return;
      input.value = texts.join("\n\n");
      render("Образцы прочитаны. Нажмите «Использовать образец», чтобы построить профиль.");
    } catch (error) { if (operation === reading) render(error.message); }
    finally { event.target.value = ""; }
  });
  byId("authorStyleForget").addEventListener("click", () => {
    reading += 1;
    state = api.empty(); input.value = "";
    try { root.localStorage.removeItem(api.KEY); render("Профиль, примеры и термины удалены из этого браузера."); }
    catch (_) { render("Профиль очищен в этой вкладке. Браузер не разрешил удалить сохранение."); }
  });
  byId("authorStyleExport").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "texteditor-style.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  byId("authorStyleImport").addEventListener("change", async (event) => {
    const operation = ++reading;
    const file = event.target.files[0];
    try {
      if (!file || file.size > 20000) throw new Error("Выберите профиль TextEditor размером до 20 КБ.");
      const raw = await file.text();
      const parsed = api.parse(raw);
      if (!Object.keys(parsed.profiles).length) throw new Error("В файле нет корректного профиля стиля.");
      if (operation !== reading) return;
      state = parsed; persist();
    } catch (error) { if (operation === reading) render(error.message); }
    finally { event.target.value = ""; }
  });
  root.AuthorStyleUI = {
    snapshot(language) {
      return { authorProfile: state.enabled ? api.validate(state.profiles[language]) : null, terms: state.terms.slice(), semantic: byId("semanticEnabled").checked };
    },
  };
  render();
})(window);
