// Atualização do app sem derrubar ninguém: quando sai uma versão nova dos arquivos do app,
// aparece um botão "Atualizar". A pessoa clica quando quiser; a página recarrega e volta
// sozinha para a sala em que estava. Nada é forçado.
(() => {
  "use strict";
  if (window.astra) return;   // programa de PC: atualiza pelo instalador (botão Baixar/Atualizar do próprio app)
  const meta = document.querySelector('meta[name="astra-build"]');
  let minha = meta ? meta.content : "";
  let mostrada = "", dispensada = "", caixa = null;
  const URL_VERSAO = "versao.json";

  async function conferir() {
    if (document.hidden) return;
    try {
      const r = await fetch(`${URL_VERSAO}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const nova = j && typeof j.web === "string" ? j.web : "";
      if (!nova) return;
      if (!minha) { minha = nova; return; }          // página sem a marca: a primeira leitura vira a base
      if (nova !== minha && nova !== dispensada) mostrar(nova, j);
    } catch (_) {}
  }

  function aoVivo() {
    try { return typeof souAoVivo === "function" && souAoVivo(); } catch (_) { return false; }
  }

  function mostrar(nova, j) {
    if (mostrada === nova && caixa) return;
    mostrada = nova;
    if (!caixa) {
      caixa = document.createElement("div");
      caixa.className = "atu";
      caixa.setAttribute("role", "status");
      caixa.innerHTML = '<span class="atu-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></span>'
        + '<span class="atu-txt"><b>Nova versão do Astra</b><small></small></span>'
        + '<button type="button" class="atu-bt">Atualizar</button>'
        + '<button type="button" class="atu-x" aria-label="Agora não"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
      caixa.querySelector(".atu-bt").onclick = atualizar;
      caixa.querySelector(".atu-x").onclick = () => { dispensada = mostrada; esconder(); };
      document.body.append(caixa);
    }
    const nota = j && typeof j.nota === "string" ? j.nota.slice(0, 90) : "";
    caixa.querySelector("small").textContent = nota || "Leva 2 segundos e você volta para onde estava.";
    requestAnimationFrame(() => caixa.classList.add("on"));
  }

  function esconder() {
    if (!caixa) return;
    caixa.classList.remove("on");
  }

  function atualizar() {
    if (aoVivo() && !confirm("Você está transmitindo. Ao atualizar, a transmissão para e você volta para a sala. Atualizar agora?")) return;
    const bt = caixa.querySelector(".atu-bt");
    bt.disabled = true;
    bt.textContent = "Atualizando...";
    location.reload();
  }

  setTimeout(conferir, 20000);
  setInterval(conferir, 3 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) conferir(); });
  window.astraAtualizar = { conferir };
})();

// publicado em 2026-11-11 04:12:21
