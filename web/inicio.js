// Início: saudação com o nick e sugestões de nome de sala.
// v5: o tutorial "Primeiros passos" saiu da tela inicial (pedido do dono).
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);

  // Sugestões de nome de sala (na janela Criar sala)
  const chips = document.querySelector(".iv-chips");
  if (chips) chips.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-nome]");
    if (!b) return;
    const inp = $("in-nome-sala");
    inp.value = b.dataset.nome;
    inp.focus();
  });

  // "Bom dia, nick"
  function saudar() {
    const alvo = $("iv-ola");
    if (!alvo) return;
    let nome = "";
    try { nome = localStorage.getItem("astra.nome") || ""; } catch (_) {}
    const h = new Date().getHours();
    const quando = h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    alvo.textContent = nome ? `${quando}, ${nome}` : `${quando}!`;
  }
  const alvoNome = $("txt-meu-nome");
  if (alvoNome) new MutationObserver(saudar).observe(alvoNome, { childList: true, characterData: true, subtree: true });
  saudar();
})();
