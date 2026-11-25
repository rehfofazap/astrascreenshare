// rehbet na barra do Astra: botão com a ficha de cassino. Abre o site da rehbet
// (comandos e jogos de clicar) já logado pelo Discord da pessoa, num painel por
// cima do app ou numa janela separada (pop-up), à escolha dela.
(() => {
  const trilho = document.getElementById("trilho");
  const itens = trilho && trilho.querySelector(".trilho-itens");
  if (!itens) return;

  const FICHA = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.2"/>
    <path d="M12 2.5v3.3M12 18.2v3.3M2.5 12h3.3M18.2 12h3.3M5.3 5.3l2.3 2.3M16.4 16.4l2.3 2.3M18.7 5.3l-2.3 2.3M7.6 16.4l-2.3 2.3"/>
    <path d="M12 9.6l.75 1.55 1.7.25-1.23 1.2.29 1.7L12 13.5l-1.51.8.29-1.7-1.23-1.2 1.7-.25z" class="rb-estrela"/></svg>`;

  const bt = document.createElement("button");
  bt.type = "button";
  bt.className = "trilho-bt trilho-rehbet";
  bt.id = "trilho-rehbet";
  bt.setAttribute("aria-label", "rehbet");
  bt.dataset.rotulo = "rehbet · cassino";
  bt.innerHTML = FICHA + "<span>rehbet</span>";
  const jogos = document.getElementById("trilho-grupo-jogos");
  if (jogos) jogos.after(bt); else itens.append(bt);

  // ---------- painel ----------
  const painel = document.createElement("section");
  painel.id = "rb-painel"; painel.hidden = true;
  painel.setAttribute("aria-label", "rehbet");
  painel.innerHTML = `
    <header class="rb-topo">
      <span class="rb-marca">${FICHA}<b>rehbet</b></span>
      <nav class="rb-atalhos" aria-label="Atalhos da rehbet">
        <button type="button" data-ir="/jogar" class="on">Jogos</button>
        <button type="button" data-ir="/jogar/slots">Slots</button>
        <button type="button" data-ir="/jogar/originais">Originais</button>
        <button type="button" data-ir="/ganhar">Ganhar</button>
        <button type="button" data-ir="/loja">Loja</button>
        <button type="button" data-ir="/painel">Início</button>
      </nav>
      <span class="rb-acoes">
        <button type="button" class="rb-acao" id="rb-converter" title="Transformar AstraDoll em coins da rehbet">
          <img src="astradoll.svg" alt="" width="16" height="16"> Converter AstraDoll</button>
        <label class="rb-chave" title="Abrir a rehbet numa janelinha que dá para arrastar e redimensionar">
          <input type="checkbox" id="rb-popup"><i></i> Pop-up</label>
        <button type="button" class="rb-acao rb-icone" id="rb-recarregar" aria-label="Recarregar" title="Recarregar">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg></button>
        <button type="button" class="rb-acao rb-icone" id="rb-fechar" aria-label="Fechar" title="Fechar (Esc)">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </span>
    </header>
    <div class="rb-corpo">
      <div class="rb-aviso" id="rb-aviso"><div class="rb-girando">${FICHA}</div><p id="rb-aviso-txt">Entrando na rehbet…</p></div>
      <iframe id="rb-frame" title="rehbet" allow="clipboard-write; autoplay" referrerpolicy="strict-origin-when-cross-origin" hidden></iframe>
    </div>`;
  document.body.append(painel);

  const $p = (id) => document.getElementById(id);
  const frame = $p("rb-frame"), aviso = $p("rb-aviso"), avisoTxt = $p("rb-aviso-txt");
  const chave = $p("rb-popup");
  // "Pop-up" = janelinha solta por cima do Astra: arrasta pela barra de cima, aumenta/diminui
  // pelo canto de baixo, lembra lugar e tamanho. Sem pop-up, abre o painel grande.
  const querPopup = () => ler("astra.rehbetPopup") === "1";
  chave.checked = querPopup();
  let carregado = false;

  const canto = document.createElement("span");
  canto.className = "rb-canto"; canto.setAttribute("aria-hidden", "true");
  painel.append(canto);
  const topo = painel.querySelector(".rb-topo");

  function lerCaixa() {
    try { const c = JSON.parse(ler("astra.rehbetJanela") || "null"); if (c && c.w > 0) return c; } catch (_) {}
    const w = Math.min(980, innerWidth - 120), h = Math.min(680, innerHeight - 80);
    return { x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - h) / 2), w, h };
  }
  let caixa = lerCaixa();
  function prender() {
    // nunca sai da tela nem fica menor que dá para usar
    caixa.w = Math.max(420, Math.min(caixa.w, innerWidth - 16));
    caixa.h = Math.max(320, Math.min(caixa.h, innerHeight - 16));
    caixa.x = Math.max(8, Math.min(caixa.x, innerWidth - caixa.w - 8));
    caixa.y = Math.max(8, Math.min(caixa.y, innerHeight - caixa.h - 8));
  }
  function desenharCaixa() {
    if (!painel.classList.contains("solta")) { painel.style.cssText = ""; return; }
    prender();
    painel.style.left = caixa.x + "px"; painel.style.top = caixa.y + "px";
    painel.style.width = caixa.w + "px"; painel.style.height = caixa.h + "px";
  }
  const gravarCaixa = () => guardar("astra.rehbetJanela", JSON.stringify(caixa));
  function aplicarModo() {
    painel.classList.toggle("solta", querPopup());
    desenharCaixa();
  }
  aplicarModo();
  addEventListener("resize", () => { if (!painel.hidden) desenharCaixa(); });

  // arrastar pela barra de cima / aumentar pelo canto (o iframe não pode engolir o mouse no meio)
  function mexer(alvo, tipo) {
    alvo.addEventListener("pointerdown", (e) => {
      if (!painel.classList.contains("solta") || e.button > 0) return;
      if (tipo === "mover" && e.target.closest("button, label, input, a")) return;
      e.preventDefault();
      const ini = { mx: e.clientX, my: e.clientY, ...caixa };
      painel.classList.add("mexendo");
      try { alvo.setPointerCapture(e.pointerId); } catch (_) {}
      const mover = (ev) => {
        const dx = ev.clientX - ini.mx, dy = ev.clientY - ini.my;
        if (tipo === "mover") { caixa.x = ini.x + dx; caixa.y = ini.y + dy; }
        else { caixa.w = ini.w + dx; caixa.h = ini.h + dy; }
        desenharCaixa();
      };
      const soltar = () => {
        painel.classList.remove("mexendo");
        alvo.removeEventListener("pointermove", mover);
        alvo.removeEventListener("pointerup", soltar);
        alvo.removeEventListener("pointercancel", soltar);
        gravarCaixa();
      };
      alvo.addEventListener("pointermove", mover);
      alvo.addEventListener("pointerup", soltar);
      alvo.addEventListener("pointercancel", soltar);
    });
  }
  mexer(topo, "mover");
  mexer(canto, "tamanho");

  function mostrarAviso(txt, girando) {
    avisoTxt.textContent = txt;
    aviso.classList.toggle("parado", !girando);
    aviso.hidden = false;
  }
  const aberto = () => !painel.hidden;
  function abrirPainel() {
    painel.hidden = false;
    bt.classList.add("ativo-rb");
    desenharCaixa();
    painel.classList.remove("entrando"); void painel.offsetWidth; painel.classList.add("entrando");
    if (!carregado) { mostrarAviso("Entrando na rehbet…", true); pedirEntrada(); }
  }
  function fecharPainel() { painel.hidden = true; bt.classList.remove("ativo-rb"); }
  const alternar = () => (aberto() ? fecharPainel() : abrirPainel());

  const pedirEntrada = () => enviar({ t: "rehbet-entrar" });

  bt.addEventListener("click", alternar);

  TRATAR["rehbet-entrar"] = (m) => {
    if (!m.ok) {
      if (painel.hidden) abrirPainel();
      mostrarAviso(m.motivo || "Não deu para abrir a rehbet agora.", false);
      frame.hidden = true;
      return;
    }
    carregar(m.url, true);
  };

  // O iframe fica sempre à mostra: o aviso some quando a página carrega ou, no máximo, em 4 s
  // (antes ele ficava por cima para sempre se o "load" não chegasse).
  const SITE = "https://rehbet.com.br";
  let destino = "/jogar", relogios = [];
  function limparRelogios() { relogios.forEach(clearTimeout); relogios = []; }
  function carregar(url, entrando) {
    limparRelogios();
    frame.hidden = false;
    mostrarAviso("Entrando na rehbet…", true);
    frame.onload = () => {
      carregado = true; aviso.hidden = true; limparRelogios();
      // depois do login a rehbet abre o Início: troca para a página escolhida sem recarregar
      // (manda de novo um pouco depois, caso a rehbet ainda esteja terminando de abrir)
      if (entrando && destino !== "/painel") { irPara(destino, 700); irPara(destino, 2000); }
    };
    relogios.push(setTimeout(() => { aviso.hidden = true; }, 4000));
    relogios.push(setTimeout(() => {
      if (carregado) return;
      mostrarAviso("A rehbet está demorando. Tente Recarregar.", false);
    }, 15000));
    frame.src = url;
  }
  painel.querySelectorAll(".rb-atalhos button").forEach((b) => b.addEventListener("click", () => {
    painel.querySelectorAll(".rb-atalhos button").forEach((x) => x.classList.toggle("on", x === b));
    destino = b.dataset.ir;
    if (!carregado) { mostrarAviso("Entrando na rehbet…", true); pedirEntrada(); return; }
    irPara(destino, 0);
  }));
  /** Troca de página dentro da rehbet sem recarregar o site (mensagem para o iframe) */
  function irPara(caminho, atraso) {
    setTimeout(() => { try { frame.contentWindow.postMessage({ rehbet: "ir", para: caminho }, SITE); } catch (_) {} }, atraso);
  }

  chave.addEventListener("change", () => {
    // troca de jeito sem recarregar a rehbet (o mesmo iframe só muda de lugar com CSS)
    guardar("astra.rehbetPopup", chave.checked ? "1" : "0");
    aplicarModo();
  });
  $p("rb-recarregar").addEventListener("click", () => { carregado = false; mostrarAviso("Entrando na rehbet…", true); pedirEntrada(); });
  $p("rb-fechar").addEventListener("click", fecharPainel);
  $p("rb-converter").addEventListener("click", () => { if (window.abrirRehbet) window.abrirRehbet(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && aberto() && document.getElementById("rb-fundo")?.hidden !== false) fecharPainel();
  });
  // Coins mudaram por uma conversão: recarrega o painel para mostrar o saldo novo
  const convAntes = TRATAR["rehbet-convertido"];
  TRATAR["rehbet-convertido"] = (m) => {
    if (convAntes) convAntes(m);
    // o iframe é de outro site (não dá para dar reload nele): volta para a página atual da rehbet
    if (m.ok && carregado) irPara(destino, 300);
  };
})();
