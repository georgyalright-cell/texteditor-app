(function attach(root) {
  "use strict";
  // Only trusted element names and textContent. Never render clipboard HTML.
  function render(target, blocks, replace, remove) {
    target.replaceChildren();
    for (const [index, block] of blocks.entries()) {
      let node;
      if (block.type === "image" || block.type === "imageMissing") {
        node = document.createElement("figure");
        if (block.type === "image") {
          root.DocumentImages.read(block.dataUrl);
          const img = document.createElement("img"); img.src = block.dataUrl; img.alt = block.alt || "Фотография"; node.append(img);
        }
        const caption = document.createElement("figcaption"); caption.textContent = block.type === "imageMissing" ? `Фото недоступно: ${block.alt}. Прикрепите PNG/JPEG.` : block.alt;
        node.append(caption);
        if (replace) {
          const label = document.createElement("label"); label.textContent = "Прикрепить / заменить фото ";
          const file = document.createElement("input"); file.type = "file"; file.accept = "image/png,image/jpeg";
          file.addEventListener("change", () => { if (file.files[0]) replace(index, file.files[0]); }); label.append(file); node.append(label);
        }
        if (remove && block.type === "imageMissing") {
          const button = document.createElement("button"); button.type = "button"; button.textContent = "Удалить место фото";
          button.addEventListener("click", () => remove(index)); node.append(button);
        }
      } else if (block.type === "docTable" || block.type === "table") {
        node = document.createElement("div"); node.className = "material-table";
        const table = document.createElement("table");
        const rows = block.type === "docTable" ? [block.columns, ...block.rows] : block.lines.map((line) => line.split("\t"));
        rows.forEach((row, r) => {
          const tr = document.createElement("tr");
          for (const value of row) { const cell = document.createElement(r ? "td" : "th"); cell.textContent = value; tr.append(cell); }
          table.append(tr);
        }); node.append(table);
      } else {
        node = document.createElement(block.type === "heading" ? "h3" : "p");
        node.textContent = block.type === "toc" ? "Оглавление — обновляется в Word" : block.title || block.text || (block.lines || []).join("\n");
      }
      target.append(node);
    }
  }
  root.MaterialView = { render };
})(window);
