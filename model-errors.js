(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ModelErrors = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";
  function explain(error, { offline = false } = {}) {
    const raw = String(error && error.message || error || "");
    const text = `${error && error.name || ""} ${raw}`;
    if (/остановлен|cancelled|aborted/iu.test(text)) return { category: "cancelled", message: "Обработка остановлена. Текущий текст сохранён.", retryable: false };
    if (/QuotaExceeded|quota|disk.?full|не хватает.*места/iu.test(text)) return { category: "storage", message: "Не удалось сохранить файлы модели: не хватает места или превышена квота браузера. Освободите место и повторите запуск. Черновики автоматически не удаляются.", retryable: false };
    if (/out.of.memory|allocation.failed|allocate.*(?:buffer|memory)|insufficient.*memory|недостаточно.*памяти|не хватило памяти/iu.test(text)) return { category: "memory", message: "Для модели не хватило памяти. Закройте тяжёлые вкладки и приложения, затем повторите запуск. Обычная обработка доступна без модели.", retryable: false };
    if (/device.*lost|GPUDevice|WebGPU|adapter|shader|GPU.*(?:error|lost)/iu.test(text)) return { category: "gpu", message: "Не удалось запустить или удержать WebGPU. Сохраните результат, перезапустите браузер с поддержкой WebGPU и повторите. Обычная обработка работает без модели.", retryable: false };
    if (/\b(?:401|403|404)\b|forbidden|not.found|unauthorized/iu.test(text)) return { category: "access", message: "Сервер не разрешил загрузить файл модели либо файл недоступен. Повторение может не помочь: проверьте доступ к Hugging Face и сообщите об ошибке сопровождению сервиса.", retryable: false };
    if (/failed to fetch|fetch failed|NetworkError|network|net::|fetch.*(?:fail|error)|HTTP.*5\d\d|\b(?:502|503|504|429)\b|сетевая|не удалось получить файлы модели/iu.test(text)) {
      if (offline) return { category: "offline", message: "Браузер сообщает, что сети нет. Подключитесь к интернету и повторите запуск; текст сохранён.", retryable: false };
      return { category: "network", message: "Не удалось получить файлы модели. Возможны обрыв связи, блокировка загрузки или временная ошибка сервера. Проверьте сеть и доступ к Hugging Face, затем повторите запуск.", retryable: true };
    }
    if (/timeout|timed.out|время ожидания|не отвечает/iu.test(text)) return { category: "timeout", message: "Модель не ответила за отведённое время. Это может быть медленная загрузка или подготовка WebGPU, не обязательно интернет. Текст сохранён; можно повторить запуск.", retryable: false };
    return { category: "unknown", message: `Точная причина не определена.${raw ? ` Сообщение: ${raw.slice(0, 220)}` : " Модель не вернула завершённый результат."} Сохраните текст и повторите запуск; при повторении передайте это сообщение для проверки.`, retryable: false };
  }
  async function retryOnce(work, options) {
    try { return await work(); }
    catch (error) {
      const info = explain(error, { offline: options.offline() });
      if (!info.retryable || !options.isCurrent()) throw error;
      options.report("Файлы модели временно недоступны. Повторяю запрос один раз; текст сохранён.");
      if (!options.isCurrent()) throw error;
      return work();
    }
  }
  return { explain, retryOnce };
});
