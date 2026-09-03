(function attachRevisionStore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RevisionStore = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createRevisionStore() {
  "use strict";

  // Гард 36 — история версий. Без неё пасс сокращения необратим: автор
  // принимает двадцать правок, видит, что стало хуже, и вернуть исходник
  // уже нечем. Хранение локальное, как и всё остальное в этом приложении:
  // localStorage браузера, никаких загрузок наружу.

  const KEY = "humanizer.revisions.v1";
  const LIMIT = 20;
  const MAX_CHARS = 300000;

  function storage() {
    try {
      const target = typeof globalThis !== "undefined" ? globalThis.localStorage : null;
      if (!target) return null;
      const probe = "humanizer.probe";
      target.setItem(probe, "1");
      target.removeItem(probe);
      return target;
    } catch (error) {
      // Приватное окно или запрет на хранение — работаем без истории.
      return null;
    }
  }

  function read() {
    const target = storage();
    if (!target) return [];
    try {
      const raw = target.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function write(list) {
    const target = storage();
    if (!target) return false;
    try {
      target.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
      return true;
    } catch (error) {
      // Квота кончилась — старые версии уступают место новой.
      if (list.length > 1) return write(list.slice(0, Math.floor(list.length / 2)));
      return false;
    }
  }

  function list() {
    return read();
  }

  function save(entry) {
    const text = String(entry.text || "");
    if (!text.trim()) return null;
    const record = {
      id: `rev-${entry.at || Date.now()}-${Math.round(text.length)}`,
      at: entry.at || Date.now(),
      label: String(entry.label || "версия").slice(0, 60),
      words: entry.words || 0,
      score: entry.score === undefined ? null : entry.score,
      offZone: entry.offZone === undefined ? null : entry.offZone,
      text: text.slice(0, MAX_CHARS),
      truncated: text.length > MAX_CHARS,
    };
    const next = [record, ...read().filter((item) => item.text !== record.text)];
    return write(next) ? record : null;
  }

  function get(id) {
    return read().find((item) => item.id === id) || null;
  }

  function remove(id) {
    return write(read().filter((item) => item.id !== id));
  }

  function clear() {
    return write([]);
  }

  function available() {
    return Boolean(storage());
  }

  return { list, save, get, remove, clear, available, LIMIT };
});
