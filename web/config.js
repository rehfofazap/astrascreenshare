// Configurações: uma tela só, no estilo do Discord (menu na esquerda, conteúdo na direita).
// O rodapé ficou só com o nome, o status e a engrenagem. Os botões antigos do rodapé continuam
// existindo escondidos: cada "Abrir" aqui só clica neles, então nada do que já funcionava mudou.
(() => {
  const $ = (id) => document.getElementById(id);
  const modal = $("modal-config");
  if (!modal) return;
  const TITULOS = {};
  for (const b of modal.querySelectorAll(".config-item")) TITULOS[b.dataset.sec] = b.textContent.trim();

  // 2.7.11: perfil, tema, extras e "Fale com o dono" ficam abertos direto aqui dentro
  // (sem o botão "Abrir" que levava para outra janela). As janelas antigas continuam no
  // HTML só como casca vazia: o conteúdo é movido para cá e o código de sempre continua valendo.
  const EMBUTIR = [
    { sec: "conta", janela: "modal-foto", abrir: () => $("meu-avatar").click(), linha: '[data-abrir="meu-avatar"]', titulo: "Perfil", noFim: true },
    { sec: "aparencia", janela: "modal-tema", abrir: () => $("bt-tema").click(), linha: '[data-abrir="bt-tema"]' },
    { sec: "extras", janela: "modal-extras", abrir: () => $("bt-extras").click(), linha: '[data-abrir="bt-extras"]' },
    { sec: "dono", janela: "modal-relato", abrir: () => $("bt-relato").click(), linha: '[data-abrir="bt-relato"]' },
  ];
  for (const e of EMBUTIR) {
    const janela = $(e.janela), secao = modal.querySelector(`.config-sec[data-sec="${e.sec}"]`);
    if (!janela || !secao || !janela.firstElementChild) continue;
    const caixa = document.createElement("div");
    caixa.className = "config-embutido";
    caixa.append(janela.firstElementChild);
    const linha = secao.querySelector(e.linha)?.closest(".config-linha");
    if (e.noFim) {
      if (linha) linha.remove();
      const h = document.createElement("h3"); h.textContent = e.titulo;
      secao.append(document.createElement("hr"), h, caixa);
    } else if (linha) linha.replaceWith(caixa);
    else secao.append(caixa);
    e.secao = secao;
    // Se algum lugar do app abrir a janela antiga (ex.: clique na sua foto), abre aqui.
    new MutationObserver(() => {
      if (janela.hidden) return;
      janela.hidden = true;
      abrir(e.sec);
    }).observe(janela, { attributes: true, attributeFilter: ["hidden"] });
  }
  // Botões que só serviam para fechar a janela somem; "Cancelar" do perfil vira "Desfazer".
  for (const id of ["tema-fechar", "extras-fechar", "relato-cancelar"]) $(id)?.classList.add("so-janela");
  for (const id of ["tema-fechar", "extras-fechar"]) $(id)?.closest(".modal-rodape")?.classList.add("so-janela");
  if ($("foto-fechar")) $("foto-fechar").textContent = "Desfazer";
  function preparar(sec) {
    for (const e of EMBUTIR) {
      if (e.sec !== sec || !e.secao) continue;
      e.abrir();                      // o código de sempre prepara o conteúdo...
      $(e.janela).hidden = true;      // ...mas a janela antiga (vazia) não aparece
    }
  }
  // Depois de salvar ou desfazer o perfil, o editor continua pronto para mexer de novo.
  // 3.0.8: ao SALVAR, o editor só é remontado quando a VPS confirma. Antes ele era remontado na hora com o
  // perfil antigo: a prévia voltava à foto/capa de antes, e salvar de novo mandava o degradê antigo por cima
  // da capa nova (a troca se desfazia de verdade).
  $("foto-fechar")?.addEventListener("click", () => setTimeout(() => { if (!modal.hidden) preparar("conta"); }, 0));
  let esperandoVps = 0;
  $("perfil-salvar")?.addEventListener("click", () => { esperandoVps = Date.now(); });
  const parado = () => typeof rasc === "undefined" || !rasc || (rasc.foto === undefined && rasc.capa === undefined);
  const remontar = () => {
    // Só remonta se a tela está aberta e a pessoa não começou a mexer de novo.
    if (!esperandoVps || Date.now() - esperandoVps > 15000) { esperandoVps = 0; return; }
    if (!modal.hidden && $("modal-foto").hidden && parado()) preparar("conta");
  };
  if (typeof TRATAR === "object") {
    for (const k of ["perfil", "foto"]) {
      const antes = TRATAR[k];
      if (typeof antes === "function") TRATAR[k] = (m) => { antes(m); if (k === "perfil" && m.tipo === "perfil") { remontar(); esperandoVps = 0; } else remontar(); };
    }
  }

  function mostrarSecao(sec) {
    preparar(sec);
    for (const s of modal.querySelectorAll(".config-sec")) s.hidden = s.dataset.sec !== sec;
    for (const b of modal.querySelectorAll(".config-item")) b.classList.toggle("ativo", b.dataset.sec === sec);
    $("config-titulo").textContent = TITULOS[sec] || "";
    try { localStorage.setItem("astra.cfg-sec", sec); } catch { /* sem localStorage */ }
  }

  function preencher() {
    // Cabeçalho do menu: a sua foto e o seu nome, igual ao rodapé.
    const av = $("cfg-avatar"), meu = $("meu-avatar");
    av.className = meu.className;
    av.style.cssText = meu.style.cssText;
    av.innerHTML = meu.innerHTML;
    $("cfg-nome").textContent = $("txt-meu-nome").textContent;
    $("cfg-nome-atual").textContent = "@" + (estado.nome || "") + " · único: é por ele que te acham e te adicionam.";
    // ID de 9 dígitos da conta, com botão de copiar
    if ($("cfg-meu-id")) $("cfg-meu-id").textContent = (estado.meuId || "") + " · mande para o suporte ou para um amigo te achar.";
    if ($("cfg-copiar-id") && !$("cfg-copiar-id").onclick) $("cfg-copiar-id").onclick = () => { if (estado.meuId) copiar(estado.meuId, "ID copiado"); };
    if ($("cfg-exibicao-in") && document.activeElement !== $("cfg-exibicao-in")) $("cfg-exibicao-in").value = estado.exibicao || "";
    // Status: as mesmas opções do menu do rodapé.
    const caixa = $("cfg-status");
    caixa.textContent = "";
    for (const [st, info] of Object.entries(STATUS)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "config-opcao" + (st === estado.status ? " ativo" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(st === estado.status));
      const bol = document.createElement("span"); bol.className = "bolinha st-" + st;
      const t = document.createElement("span"); t.innerHTML = "<b></b><small></small>";
      t.querySelector("b").textContent = info.nome;
      t.querySelector("small").textContent = info.dica || "";
      b.append(bol, t);
      b.onclick = () => { mudarStatus(st); preencher(); };
      caixa.append(b);
    }
    $("cfg-popup").checked = popupLigado();
    $("cfg-acorde").checked = acordeLigado();
    $("cfg-mini").checked = (() => { try { return localStorage.getItem("astra.miniAuto") !== "0"; } catch { return true; } })();
    $("cfg-chat-live").checked = (() => { try { return localStorage.getItem("astra.chatNaLive") === "0"; } catch { return false; } })();
    $("cfg-versao").textContent = MINHA_VERSAO ? `v${MINHA_VERSAO}` : "Versão do navegador";
  }

  function abrir(sec) {
    preencher();
    let ultima = "conta";
    try { ultima = localStorage.getItem("astra.cfg-sec") || "conta"; } catch { /* sem localStorage */ }
    mostrarSecao(sec || ultima);
    modal.hidden = false;
  }
  function fechar() { modal.hidden = true; }

  $("bt-config").addEventListener("click", () => abrir());
  $("config-fechar").addEventListener("click", fechar);
  modal.addEventListener("click", (ev) => { if (ev.target === modal) fechar(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !ev.defaultPrevented && !modal.hidden) fechar(); });
  for (const b of modal.querySelectorAll("[data-sec]")) {
    if (b.classList.contains("config-sec")) continue;
    b.addEventListener("click", () => mostrarSecao(b.dataset.sec));
  }
  // "Abrir", "Editar perfil" etc.: fecha esta tela e abre a janela de sempre.
  for (const b of modal.querySelectorAll("[data-abrir]")) {
    b.addEventListener("click", () => {
      const alvo = $(b.dataset.abrir);
      fechar();
      if (!alvo) return;
      if (alvo.classList.contains("modal")) alvo.hidden = false;
      else alvo.click();
    });
  }
  // Interruptores das notificações: usam as mesmas funções dos botões do chat.
  $("cfg-popup").addEventListener("change", () => { if ($("cfg-popup").checked !== popupLigado()) $("bt-popup").click(); });
  $("cfg-acorde").addEventListener("change", () => mudarAcorde($("cfg-acorde").checked));
  $("cfg-chat-live").addEventListener("change", () => { try { localStorage.setItem("astra.chatNaLive", $("cfg-chat-live").checked ? "0" : "1"); } catch { /* sem localStorage */ } });
  $("cfg-mini").addEventListener("change", () => { try { localStorage.setItem("astra.miniAuto", $("cfg-mini").checked ? "1" : "0"); } catch { /* sem localStorage */ } });

  // Mensagens privadas novas: o número aparece na engrenagem e no item do menu.
  const contador = $("pv-contador");
  function copiarContador() {
    const n = contador && !contador.hidden ? contador.textContent : "";
    for (const id of ["config-contador", "cfg-pv-contador"]) { $(id).hidden = !n; $(id).textContent = n; }
    $("cfg-pv-txt").textContent = n ? `${n} mensage${n === "1" ? "m nova" : "ns novas"}.` : "Nenhuma mensagem nova.";
  }
  if (contador) new MutationObserver(copiarContador).observe(contador, { attributes: true, childList: true, characterData: true, subtree: true });
  copiarContador();
  // Tecla de emergência: apaga todos os rabiscos. No PC vira atalho global (vale com o
  // jogo na frente); no navegador/celular vale com o Astra aberto.
  const SOZINHAS = /^(F\d{1,2}|Insert|Home|End|PageUp|PageDown)$/;
  function teclaDoEvento(ev) {
    const c = ev.code || "";
    let k = "";
    if (/^Key[A-Z]$/.test(c)) k = c.slice(3);
    else if (/^Digit\d$/.test(c)) k = c.slice(5);
    else if (/^Numpad\d$/.test(c)) k = "num" + c.slice(6);
    else if (/^F([1-9]|1\d|2[0-4])$/.test(c)) k = c;
    else if (SOZINHAS.test(c)) k = c;
    if (!k) return "";
    const mods = [ev.ctrlKey && "Ctrl", ev.altKey && "Alt", ev.shiftKey && "Shift"].filter(Boolean);
    // Letra ou número sozinho atrapalharia o jogo e o chat: precisa de Ctrl ou Alt.
    if (!SOZINHAS.test(k) && !ev.ctrlKey && !ev.altKey) return "";
    return [...mods, k].join("+");
  }
  const lerTecla = () => { try { return localStorage.getItem("astra.teclaEmergencia") || ""; } catch { return ""; } };
  const bt = $("cfg-tecla"), tirar = $("cfg-tecla-tirar"), msg = $("cfg-tecla-msg");
  function pintarTecla(texto) {
    const t = lerTecla();
    bt.textContent = t || "Escolher tecla";
    bt.classList.toggle("tem-tecla", !!t);
    tirar.hidden = !t;
    msg.textContent = texto !== undefined ? texto : t ? "Aperte " + t + " para apagar os rabiscos." : "";
  }
  async function aplicarTecla(t) {
    if (!(typeof programa !== "undefined" && programa && programa.teclaEmergencia)) return true;
    try { return await programa.teclaEmergencia(t); } catch { return false; }
  }
  let ouvindo = false;
  bt.addEventListener("click", () => {
    ouvindo = true;
    bt.textContent = "Aperte a tecla…";
    bt.classList.add("ouvindo");
    msg.textContent = "Ex.: F8, Insert ou Ctrl+Shift+X. Esc para cancelar.";
  });
  document.addEventListener("keydown", async (ev) => {
    if (!ouvindo) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (ev.key === "Escape") { ouvindo = false; bt.classList.remove("ouvindo"); pintarTecla(); return; }
    if (["Control", "Alt", "Shift", "Meta"].includes(ev.key)) return;
    const t = teclaDoEvento(ev);
    if (!t) { msg.textContent = "Essa não dá. Use F1 a F12, Insert, Home, End, PageUp/PageDown, ou Ctrl/Alt + letra."; return; }
    ouvindo = false; bt.classList.remove("ouvindo");
    const antiga = lerTecla();
    if (!(await aplicarTecla(t))) { await aplicarTecla(antiga); pintarTecla(t + " já está sendo usada por outro programa. Escolha outra."); return; }
    try { localStorage.setItem("astra.teclaEmergencia", t); } catch { /* sem localStorage */ }
    pintarTecla();
  }, true);
  tirar.addEventListener("click", async () => {
    try { localStorage.removeItem("astra.teclaEmergencia"); } catch { /* sem localStorage */ }
    await aplicarTecla("");
    pintarTecla();
  });
  // No navegador/celular (sem atalho global): a tecla vale com o Astra aberto.
  document.addEventListener("keydown", (ev) => {
    if (ouvindo || (typeof programa !== "undefined" && programa && programa.teclaEmergencia)) return;
    const t = lerTecla();
    if (t && teclaDoEvento(ev) === t && typeof emergenciaRiscos === "function") { ev.preventDefault(); emergenciaRiscos(); }
  });
  if (lerTecla()) aplicarTecla(lerTecla()).then((ok) => { if (!ok) pintarTecla(lerTecla() + " está sendo usada por outro programa. Escolha outra."); });
  pintarTecla();

  window.astraConfig = { abrir };
})();
