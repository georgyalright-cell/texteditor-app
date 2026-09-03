(function mountHelpDialog() {
  "use strict";

  const button = document.querySelector("#helpButton");
  const dialog = document.querySelector("#helpDialog");

  if (!button || !dialog) return;

  button.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      return;
    }
    dialog.setAttribute("open", "");
  });

  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;

    const bounds = dialog.getBoundingClientRect();
    const inside = event.clientX >= bounds.left
      && event.clientX <= bounds.right
      && event.clientY >= bounds.top
      && event.clientY <= bounds.bottom;

    if (!inside) dialog.close();
  });
})();
