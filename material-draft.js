(function attach(root) {
  "use strict";
  let database, queue = Promise.resolve();
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("texteditor-material", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Закройте старые вкладки TextEditor для сохранения черновика."));
    });
    return database;
  }
  async function transaction(value, write) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("drafts", write ? "readwrite" : "readonly");
      const store = tx.objectStore("drafts");
      const request = write ? value ? store.put(value, "current") : store.delete("current") : store.get("current");
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Не удалось сохранить черновик."));
    });
  }
  root.MaterialDraft = {
    load: () => transaction(null, false),
    save(value) {
      const snapshot = value ? structuredClone(value) : null;
      queue = queue.catch(() => {}).then(() => transaction(snapshot, true)); return queue;
    },
  };
})(window);
