(function attach(root) {
  "use strict";
  // Only trusted element names and textContent. Never render clipboard HTML.
  function render(target, blocks, replace, remove, layout) {
    target.replaceChildren();
    const editable = layout && layout.edit;
    const units = editable ? root.DocumentLayout.units(blocks) : blocks.map((_b, index) => ({ index, indices: [index] }));
    const labels = editable ? root.DocumentLayout.captions(blocks, layout.profile) : null;
    for (const unit of units) {
      const index = unit.index, block = blocks[index];
      let node;
      if (block.type === "image" || block.type === "imageMissing") {
        node = document.createElement("figure");
        if (block.type === "image") {
          root.DocumentImages.read(block.dataUrl);
          const img = document.createElement("img"); img.src = block.dataUrl; img.alt = block.alt || "Фотография"; node.append(img);
        }
        if (block.type === "imageMissing") {
          const warning = document.createElement("p"); warning.textContent = `Фото недоступно: ${block.alt}. Прикрепите PNG/JPEG.`; node.append(warning);
        }
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
        node.textContent = block.type === "toc" ? "Оглавление — обновляется в Word" : block.type === "caption" ? root.DocumentLayout.label(block) : block.title || block.text || (block.lines || []).join("\n");
        if (block.type === "caption") { node.className = "material-caption"; node.style.textAlign = block.alignment || "center"; }
      }
      if (editable && unit.kind) {
        const wrapper = document.createElement("section"); wrapper.className = "material-object";
        const c = labels.get(index), caption = document.createElement("p"); caption.className = "material-caption";
        caption.textContent = root.DocumentLayout.label(c); caption.style.textAlign = c.alignment;
        wrapper.append(...(c.position === "above" ? [caption, node] : [node, caption]));
        for (const i of unit.indices) if (i !== index && i !== unit.captionIndex) {
          const note = document.createElement("p"); note.textContent = blocks[i].text; wrapper.append(note);
        }
        const tools = document.createElement("div"); tools.className = "material-layout-tools";
        for (const [direction, text] of [[-1, "Выше"], [1, "Ниже"]]) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.className = "button button-secondary";
          button.setAttribute("aria-label", `${text}: ${c.prefix} ${c.number}`);
          const neighbour = units[units.indexOf(unit) + direction];
          button.disabled = !neighbour || blocks[neighbour.index].type === "heading";
          // Commit the focused caption inside click, not between pointerdown
          // and pointerup (its new wrapping can shift this toolbar).
          button.addEventListener("pointerdown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            if (document.activeElement?.matches(".material-layout-tools input")) document.activeElement.blur();
            editable(index, "move", direction);
          }); tools.append(button);
        }
        const field = document.createElement("label"); field.textContent = `Подпись ${c.prefix} ${c.number}`;
        const input = document.createElement("input"); input.type = "text"; input.maxLength = 500; input.value = c.title;
        input.placeholder = "Название объекта (необязательно)";
        input.addEventListener("change", () => {
          editable(index, "caption", input.value);
          caption.textContent = root.DocumentLayout.label({ ...c, title: input.value.slice(0, 500) });
        }); field.append(input); tools.append(field);
        wrapper.insertBefore(tools, node); target.append(wrapper);
      } else target.append(node);
    }
  }
  root.MaterialView = { render };
})(window);
