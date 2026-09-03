# Локально закреплённые runtime-файлы

Эти файлы входят в production-артефакт, чтобы текст не обрабатывался кодом,
который браузер динамически загрузил с внешнего CDN.

| Компонент | Версия | Файл | SHA-256 |
| --- | --- | --- | --- |
| Transformers.js | 4.2.0 | `transformers/transformers.web.min.mjs` | `0a96dcf4c48981b7d05f53827e6975ec239132606ad0d526bbc2db0fcdbc4ded` |
| ONNX Runtime Web | 1.26.0-dev.20260416-b7804b056c | `transformers/ort-wasm-simd-threaded.asyncify.mjs` | `5959c6733039619c9af710d8e1bae8d6e84402787990637be987c2b1bd6c5fa9` |
| ONNX Runtime Web | 1.26.0-dev.20260416-b7804b056c | `transformers/ort-wasm-simd-threaded.asyncify.wasm` | `e0c0c6d3e73d43b8a249972f8358f845b08cc16fec3c80efafdf8bed40366786` |
| PDF.js (legacy build) | 6.3.289 | `pdfjs/pdf.mjs` | `91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d` |
| PDF.js worker (legacy build) | 6.3.289 | `pdfjs/pdf.worker.mjs` | `df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b` |
| Mammoth | 1.12.2 | `mammoth/mammoth.browser.min.js` | `e660d427ddb9aaf51cf4ca237512d0776141a58f0dfb0fd58b576721e8195e2b` |
| JSZip | 3.10.1 | `jszip/jszip.min.js` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |
| SheetJS CE | 0.20.3 | `sheetjs/xlsx.full.min.js` | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |

Лицензии лежат рядом с соответствующими файлами. Обновление выполняется
осознанно: новая версия скачивается из официального npm-пакета либо, для
SheetJS CE, с официального CDN, сверяются её версия и контрольная сумма, после
чего запускаются все тесты и проверка импорта файлов.
