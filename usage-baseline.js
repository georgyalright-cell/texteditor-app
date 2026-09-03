(function attachUsageBaseline(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UsageBaseline = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createUsageBaseline() {
  "use strict";

  // Контрастная база: как выглядит то, что приносят в этот инструмент.
  //
  // Это НЕ норма и не замена калибровке. Сюда приносят черновики, которые
  // автор считает слишком машинными, — то есть база смещена в сторону
  // сгенерированного текста по построению. Использовать её как «человеческий
  // эталон» значит откалиброваться ровно наоборот, поэтому applyCalibration
  // её не принимает и принимать не должен.
  //
  // Польза у неё другая и вполне реальная: сравнение с собственной историей.
  // «Этот текст плотнее по конкретике, чем 80% того, что вы сюда носили» —
  // осмысленное утверждение без всякого корпуса, потому что обе стороны
  // сравнения ваши.
  //
  // Хранятся только числа. Ни одного слова текста в localStorage не попадает:
  // база наблюдений не должна превращаться в архив чужих документов.

  const KEY = "humanizer.usage-baseline.v1";
  const LIMIT = 200;

  function storage() {
    try {
      const target = typeof globalThis !== "undefined" ? globalThis.localStorage : null;
      if (!target) return null;
      const probe = "humanizer.baseline.probe";
      target.setItem(probe, "1");
      target.removeItem(probe);
      return target;
    } catch (error) {
      return null;
    }
  }

  function read() {
    const target = storage();
    if (!target) return {};
    try {
      const parsed = JSON.parse(target.getItem(KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function write(data) {
    const target = storage();
    if (!target) return false;
    try {
      target.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      return false;
    }
  }

  function keyFor(genreId, language) {
    return `${genreId || "academic"}:${language || "ru"}`;
  }

  /**
   * Запомнить наблюдение. Из отчёта берутся только идентификаторы метрик и
   * числа — никакого текста, никаких примеров, никаких заголовков.
   */
  function record(report) {
    if (!report || !Array.isArray(report.metrics)) return false;
    const values = {};
    for (const metric of report.metrics) {
      if (metric.value === null || !Number.isFinite(metric.value)) continue;
      values[metric.id] = Number(metric.value);
    }
    if (!Object.keys(values).length) return false;

    const data = read();
    const key = keyFor(report.genreId, report.language);
    const samples = Array.isArray(data[key]) ? data[key] : [];
    samples.push(values);
    // Хранится последнее окно наблюдений: инструмент меняется, и статистика
    // двухлетней давности описывала бы другой конвейер.
    data[key] = samples.slice(-LIMIT);
    return write(data);
  }

  function samplesFor(genreId, language) {
    const data = read();
    const samples = data[keyFor(genreId, language)];
    return Array.isArray(samples) ? samples : [];
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  /**
   * Где текущий текст стоит относительно всего, что проходило через
   * инструмент. Доля наблюдений строго ниже текущего значения.
   */
  function compare(report, options) {
    const settings = options || {};
    const minimum = settings.minimum === undefined ? 5 : settings.minimum;
    if (!report || !Array.isArray(report.metrics)) return { count: 0, rows: [] };
    const samples = samplesFor(report.genreId, report.language);
    if (samples.length < minimum) return { count: samples.length, rows: [] };

    const rows = [];
    for (const metric of report.metrics) {
      if (metric.value === null || !Number.isFinite(metric.value)) continue;
      const values = samples
        .map((sample) => sample[metric.id])
        .filter((value) => Number.isFinite(value));
      if (values.length < minimum) continue;
      // Средний ранг, а не доля строго меньших: при совпадении значений
      // «ниже» окажется ноль, и текст, равный всей своей истории, выглядел
      // бы самым редким из всех вместо самого типичного.
      const below = values.filter((value) => value < metric.value).length;
      const equal = values.filter((value) => value === metric.value).length;
      rows.push({
        id: metric.id,
        label: metric.label,
        value: metric.value,
        median: median(values),
        // Доля прежних текстов, у которых этот признак был выражен слабее.
        share: (below + equal / 2) / values.length,
        direction: metric.direction,
      });
    }
    return { count: samples.length, rows };
  }

  /** Самые заметные отличия от собственной истории — для одной строки в отчёте. */
  function highlights(report, options) {
    const result = compare(report, options);
    const notable = result.rows
      .filter((row) => row.share <= 0.2 || row.share >= 0.8)
      .sort((left, right) => Math.abs(right.share - 0.5) - Math.abs(left.share - 0.5))
      .slice(0, 3);
    return { count: result.count, rows: notable };
  }

  function clear() {
    return write({});
  }

  function available() {
    return Boolean(storage());
  }

  return { record, compare, highlights, samplesFor, clear, available, LIMIT };
});
