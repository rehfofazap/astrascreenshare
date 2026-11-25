/* 3.0.33: botão "Comunidade" na barra de cima -> servidor do Astra no Discord.
   PC e navegador abrem em outra aba/no navegador; no app Android vai pelo próprio link (ele abre fora). */
(() => {
  const a = document.getElementById("bt-discord-com");
  if (!a) return;
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const cel = typeof celular !== "undefined" && celular;
    if (cel) location.href = a.href;
    else window.open(a.href, "_blank", "noopener");
  });
})();
