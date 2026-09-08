(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DocumentImages = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";
  const MAX_BYTES = 20 * 1024 * 1024;
  function read(dataUrl) {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(String(dataUrl));
    if (!match || match[2].length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error("Нужно изображение PNG/JPEG до 20 МБ.");
    const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    let width = 0, height = 0;
    if (match[1] === "png" && bytes.length >= 33 && view.getUint32(0) === 0x89504e47 &&
        view.getUint32(4) === 0x0d0a1a0a && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
      width = view.getUint32(16); height = view.getUint32(20);
    } else if (match[1] === "jpeg" && bytes[0] === 255 && bytes[1] === 216) {
      for (let pos = 2; pos + 4 < bytes.length;) {
        if (bytes[pos++] !== 255) break;
        while (bytes[pos] === 255) pos++;
        const marker = bytes[pos++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (pos + 2 > bytes.length) break;
        const length = view.getUint16(pos);
        if (length < 2 || pos + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
          height = view.getUint16(pos + 3); width = view.getUint16(pos + 5); break;
        }
        pos += length;
      }
    }
    if (!width || !height || width * height > 30000000) throw new Error("Повреждённое изображение или размер больше 30 мегапикселей.");
    return { bytes, width, height, extension: match[1] === "jpeg" ? "jpg" : "png", mime: `image/${match[1]}` };
  }
  function validate(blocks) {
    let size = 0, count = 0, pixels = 0;
    for (const block of blocks) {
      if (block.type === "imageMissing") throw new Error("Есть недоступное фото. Прикрепите его файл или явно удалите место изображения перед сборкой.");
      if (block.type !== "image") continue;
      const info = read(block.dataUrl);
      size += info.bytes.length; pixels += info.width * info.height; count++;
      if (size > MAX_BYTES || count > 50) throw new Error("Лимит документа: 50 фотографий и 20 МБ изображений суммарно.");
      if (pixels > 40000000) throw new Error("Суммарный размер фотографий больше 40 мегапикселей. Уменьшите разрешение перед вставкой.");
    }
  }
  function drawing(block, index, page, escape) {
    const info = read(block.dataUrl);
    const maxWidth = (page.widthMm - page.marginLeftMm - page.marginRightMm) * 36000;
    const maxHeight = (page.heightMm - page.marginTopMm - page.marginBottomMm - 15) * 36000;
    const scale = Math.min(9525, maxWidth / info.width, maxHeight / info.height);
    const cx = Math.round(info.width * scale), cy = Math.round(info.height * scale);
    return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index}" name="Image ${index}" descr="${escape(block.alt || "")}"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>' +
      `<pic:cNvPr id="${index}" name="Image ${index}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImage${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  async function decode(dataUrl) {
    read(dataUrl);
    const picture = new Image(); picture.src = dataUrl;
    try { await picture.decode(); } catch (_) { throw new Error("Фото не декодируется. Прикрепите исправный PNG/JPEG."); }
  }
  return { read, validate, decode, drawing, MAX_BYTES };
});
