// Converter AstraDoll em coins da rehbet (mão única, 1 = 100). Janela própria,
// aberta pelo "Converter p/ rehbet" do cartão da conta. Quem fala com a rehbet é
// o servidor do Astra; aqui só se pede e se mostra.
(() => {
  // (o estilo fica em rehbet-barra.css: o /app não aceita <style> embutido)
  const fundo = document.createElement("div");
  fundo.id = "rb-fundo"; fundo.hidden = true;
  fundo.innerHTML = `<div id="rb-caixa" role="dialog" aria-modal="true" aria-labelledby="rb-titulo">
    <h3 id="rb-titulo">Converter para rehbet</h3>
    <p class="rb-sub">1 AstraDoll = 100 coins na rehbet. Só de ida: não dá para voltar.</p>
    <div class="rb-linha"><span>Seu AstraDoll</span><b id="rb-doll">...</b></div>
    <div class="rb-linha"><span>Seus coins na rehbet</span><b id="rb-coins">...</b></div>
    <div class="rb-linha"><span>Convertido hoje</span><b id="rb-hoje">...</b></div>
    <input id="rb-valor" type="number" min="10" step="1" inputmode="numeric" placeholder="Quanto AstraDoll?">
    <div class="rb-vira" id="rb-vira"></div>
    <div class="rb-msg" id="rb-msg"></div>
    <div class="rb-botoes"><button type="button" id="rb-sair">Fechar</button><button type="button" id="rb-ir" disabled>Converter</button></div>
  </div>`;
  document.body.append(fundo);

  const $r = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
  let info = null, enviando = false;

  function msg(texto, tipo) { const el = $r("rb-msg"); el.textContent = texto || ""; el.className = "rb-msg" + (tipo ? " " + tipo : ""); }
  function conferir() {
    const v = Math.floor(Number($r("rb-valor").value) || 0);
    $r("rb-vira").textContent = v > 0 ? `Vira ${fmt(v * 100)} coins na rehbet` : "";
    const resta = info ? Math.max(0, (info.maxDia || 0) - (info.hoje || 0)) : 0;
    $r("rb-ir").disabled = enviando || !info || !info.ok || v < 10 || v > (info.astradoll || 0) || v > resta;
  }
  function fechar() { fundo.hidden = true; }

  window.abrirRehbet = () => {
    info = null; enviando = false;
    $r("rb-doll").textContent = $r("rb-coins").textContent = $r("rb-hoje").textContent = "...";
    $r("rb-valor").value = ""; msg("Buscando seu saldo..."); conferir();
    fundo.hidden = false;
    enviar({ t: "rehbet" });
  };

  TRATAR["rehbet"] = (m) => {
    info = m;
    if (!m.ok) { msg(m.motivo || "Não deu para falar com a rehbet.", "erro"); conferir(); return; }
    $r("rb-doll").textContent = fmt(m.astradoll);
    $r("rb-coins").textContent = fmt(m.saldo);
    $r("rb-hoje").textContent = `${fmt(m.hoje)} / ${fmt(m.maxDia)}`;
    msg(""); conferir();
  };
  TRATAR["rehbet-convertido"] = (m) => {
    enviando = false;
    if (m.ok) {
      msg(`Pronto! +${fmt(m.coins)} coins na rehbet.`, "ok");
      $r("rb-valor").value = "";
      enviar({ t: "rehbet" });
    } else {
      msg(m.motivo || "Não deu certo.", "erro");
    }
    conferir();
  };

  $r("rb-valor").addEventListener("input", conferir);
  $r("rb-ir").addEventListener("click", () => {
    const v = Math.floor(Number($r("rb-valor").value) || 0);
    if (!v) return;
    enviando = true; conferir(); msg("Convertendo...");
    enviar({ t: "rehbet-converter", valor: v });
  });
  $r("rb-sair").addEventListener("click", fechar);
  fundo.addEventListener("click", (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !fundo.hidden) fechar(); });
})();
