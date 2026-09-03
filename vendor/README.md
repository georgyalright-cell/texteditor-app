# Локально закреплённые runtime-файлы

Эти файлы входят в production-артефакт, чтобы текст не обрабатывался кодом,
который браузер динамически загрузил с внешнего CDN.

| Компонент | Версия | Файл | SHA-256 |
| --- | --- | --- | --- |
| Transformers.js | 4.2.0 | `transformers/transformers.web.min.mjs` | `1591170143b15bc00d930e7698ff0418a9b4d2fcbeb534b22f1035aa61a5a579` |
| ONNX Runtime Web, WebGPU bundle | 1.26.0-dev.20260416-b7804b056c | `transformers/ort.webgpu.bundle.min.mjs` | `2ec70f685749470635e64dd142c2510dc13b37bb593d9cd6ab4f8923e5204479` |
| ONNX Runtime Web | 1.26.0-dev.20260416-b7804b056c | `transformers/ort-wasm-simd-threaded.asyncify.mjs` | `5959c6733039619c9af710d8e1bae8d6e84402787990637be987c2b1bd6c5fa9` |
| ONNX Runtime Web | 1.26.0-dev.20260416-b7804b056c | `transformers/ort-wasm-simd-threaded.asyncify.wasm` | `e0c0c6d3e73d43b8a249972f8358f845b08cc16fec3c80efafdf8bed40366786` |
| WebLLM | 0.2.82 | `webllm/web-llm.mjs` | `4c89beb3ed13946e6f1ca9376f33062b5c64765c26f3ddaba045df6a13dda858` |
| WebLLM Qwen2 1.5B WebGPU library | v0_2_80, commit `025bcaf` | `webllm/Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm` | `6cd9f132ad258d2017291bb62e955e337f8ae4af74650f4b1ea5a803a7cec538` |
| PDF.js (legacy build) | 6.3.289 | `pdfjs/pdf.mjs` | `91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d` |
| PDF.js worker (legacy build) | 6.3.289 | `pdfjs/pdf.worker.mjs` | `df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b` |
| Mammoth | 1.12.2 | `mammoth/mammoth.browser.min.js` | `e660d427ddb9aaf51cf4ca237512d0776141a58f0dfb0fd58b576721e8195e2b` |
| JSZip | 3.10.1 | `jszip/jszip.min.js` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |
| SheetJS CE | 0.20.3 | `sheetjs/xlsx.full.min.js` | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |

Лицензии лежат рядом с соответствующими файлами. Обновление выполняется
осознанно: новая версия скачивается из официального npm-пакета либо, для
SheetJS CE, с официального CDN, сверяются её версия и контрольная сумма, после
чего запускаются все тесты и проверка импорта файлов.

NPM-сборка Transformers.js использует пакетные импорты
`onnxruntime-web/webgpu` и `onnxruntime-common`, которые браузер без сборщика не
разрешает. В локальной копии ровно эти два импорта направлены на официальный
самодостаточный `ort.webgpu.bundle.min.mjs` из той версии ONNX Runtime, которая
закреплена в зависимостях Transformers.js. Остальной код Transformers.js не
изменён; тест запрещает возвращение неразрешимых пакетных импортов.

Генератор использует браузерный рантайм WebLLM из официального npm-пакета
`@mlc-ai/web-llm@0.2.82` (Apache-2.0); его лицензия находится в
`webllm/LICENSE`. WebGPU-библиотека модели взята из официального репозитория
`mlc-ai/binary-mlc-llm-libs` и закреплена коммитом. Сами веса Qwen2.5 1.5B
загружаются как данные из Hugging Face по закреплённой ревизии модели;
исполняемый JavaScript и WASM с внешних адресов не загружаются.
