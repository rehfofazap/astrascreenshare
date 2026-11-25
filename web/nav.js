// Navegação lateral da Astra: Início, Jogos, Música e Mensagens.
// Não cria sistemas novos: abre o que já existe.
//  - Jogos: a lista dos Extras (minigames MyWaifu e AstraPet) numa página, com Instalar/Abrir.
//  - Música: página própria (ouvir sozinho, Jams e a música da sala), em jam.js.
//  - Mensagens: a janela de conversas privadas (privado.js).
// O logo recolhe/expande a barra (preferência salva). Tudo sem recarregar: as páginas ficam
// por cima do centro e a sala (e a música) continuam rodando embaixo.
(function () {
  const $ = (id) => document.getElementById(id);
  const trilho = $("trilho");
  if (!trilho) return;
  // Fica numa camada própria, por cima do app (e de janelinhas como o AstraPet), sem depender da grade.
  document.body.insertBefore(trilho, $("app").nextSibling);
  const raiz = document.documentElement;
  const botoes = [...trilho.querySelectorAll(".trilho-bt[data-ir]")];
  const paginas = { salas: $("pg-salas"), jogos: $("pg-jogos"), musica: $("pg-musica") };
  let atual = "inicio";
  let abaAntesDoInicio = "chat";
  const celular = () => matchMedia("(max-width: 860px)").matches;

  const naSala = () => !$("sala").hidden;
  const privadoAberto = () => !!$("privado") && !$("privado").hidden;
  // 2.7.33: os Grupos ficam dentro de Mensagens
  const gruposAbertos = () => !!$("grupos") && !$("grupos").hidden;
  const mensagensAbertas = () => privadoAberto() || gruposAbertos();
  const conectado = () => !!(estado.ws && estado.ws.readyState === WebSocket.OPEN);

  // ---------- recolher / expandir ----------
  const marca = $("trilho-marca");
  function recolher(sim, salvar) {
    raiz.classList.add("nav-animando");
    raiz.classList.toggle("nav-recolhida", sim);
    marca.setAttribute("aria-expanded", String(!sim));
    marca.dataset.rotulo = sim ? "Expandir a barra" : "Recolher a barra";
    if (salvar) guardar("astra.navRecolhida", sim ? "1" : "0");
    clearTimeout(recolher.t);
    recolher.t = setTimeout(() => raiz.classList.remove("nav-animando"), 420);
  }
  // v5.2: a barra é sempre só de ícones (sem os nomes; o nome aparece ao passar o mouse). O logo leva ao Início.
  recolher(true, false);
  marca.dataset.rotulo = "Início";
  marca.removeAttribute("aria-expanded");
  marca.addEventListener("click", () => { ir("inicio"); if (celular()) scrollTo({ top: 0, behavior: "smooth" }); });

  // Com a barra recolhida: perfil e configurações no pé do trilho (os mesmos botões do rodapé).
  const eu = $("trilho-eu"), meuAvatar = $("meu-avatar");
  function copiarAvatar() {
    eu.className = "trilho-eu " + [...meuAvatar.classList].filter((c) => c !== "bt-foto").join(" ");
    eu.style.cssText = meuAvatar.style.cssText;
    eu.textContent = meuAvatar.textContent;
    const nome = ($("txt-meu-nome") && $("txt-meu-nome").textContent) || "";
    eu.dataset.rotulo = nome ? `${nome} · perfil` : "Meu perfil";
  }
  new MutationObserver(copiarAvatar).observe(meuAvatar, { attributes: true, childList: true, characterData: true, subtree: true });
  if ($("txt-meu-nome")) new MutationObserver(copiarAvatar).observe($("txt-meu-nome"), { childList: true, characterData: true, subtree: true });
  copiarAvatar();
  // 2.7.23: abre o seu cartão (igual ao Discord); sem ele, o editor de sempre.
  eu.setAttribute("aria-haspopup", "dialog");
  eu.addEventListener("click", () => (window.abrirMeuCartao ? window.abrirMeuCartao(eu) : meuAvatar.click()));
  $("trilho-config").addEventListener("click", () => $("bt-config").click());

  // ---------- páginas ----------
  function marcar() {
    let ativo = atual === "inicio" && naSala() && !raiz.classList.contains("v5-ver-inicio") ? "sala" : atual;
    if (mensagensAbertas()) ativo = "mensagens";
    for (const b of botoes) {
      const sim = b.dataset.ir === ativo;
      b.classList.toggle("ativo", sim);
      b.setAttribute("aria-selected", String(sim));
    }
    // v5: "Sala" só aparece quando você está numa; "Início" mostra a página inicial mesmo dentro da sala
    const bSala = botoes.find((b) => b.dataset.ir === "sala");
    if (bSala) bSala.hidden = !naSala();
  }

  const TITULOS = { salas: "Salas", jogos: "Jogos", musica: "Música" };
  function fecharPaginas() {
    const tinha = Object.values(paginas).some((p) => !p.hidden);
    for (const p of Object.values(paginas)) p.hidden = true;
    if (tinha) $("txt-titulo").textContent = naSala() && !raiz.classList.contains("v5-ver-inicio") ? estado.nomeSala : "Início";
  }

  function mostrarPagina(nome) {
    for (const [n, p] of Object.entries(paginas)) if (n !== nome) p.hidden = true;
    const p = paginas[nome];
    const nova = p.hidden;
    p.hidden = false;
    $("txt-titulo").textContent = TITULOS[nome];
    if (nova) {
      p.classList.remove("entrando");
      void p.offsetWidth;          // reinicia a animação de entrada
      p.classList.add("entrando");
      p.scrollTop = 0;
    }
    if (celular()) $("app").querySelector(".principal").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function desenharJogos() {
    const st = $("jogos-estado");
    if (!conectado()) st.textContent = "Conectando ao servidor da Astra…";
    else if (!extrasDisponiveis.length) st.textContent = "Carregando os jogos…";
    else st.textContent = "";
    st.hidden = !st.textContent;
    desenharExtras();
  }

  function ir(destino) {
    if (destino !== "mensagens" && privadoAberto()) $("bt-privado").click();   // fecha a conversa
    if (destino !== "mensagens" && gruposAbertos()) window.astraGrupos?.fechar();
    if (destino === "inicio" || destino === "sala") {
      atual = "inicio";
      // na sala: "Início" mostra a página inicial por cima (a sala continua rodando); "Sala" volta para ela
      const verInicio = destino === "inicio" && naSala();
      const jaVia = raiz.classList.contains("v5-ver-inicio");
      raiz.classList.toggle("v5-ver-inicio", verInicio);
      // Início dentro da sala = a página inicial completa (sem painel da sala, com a lista de online à direita);
      // ao voltar, a coluna da direita volta para a aba em que estava (chat, música...).
      if (verInicio && !jaVia) { abaAntesDoInicio = abaDireita; mostrarAbaDireita("online"); }
      else if (!verInicio && jaVia && naSala()) mostrarAbaDireita(abaAntesDoInicio || "chat");
      // "Assista relaxado" (modo cinema) vale só para a sala: no Início a tela volta ao normal
      $("app").classList.toggle("cinema", !!estado.relaxado && naSala() && destino === "sala");
      fecharPaginas();
      if (naSala()) $("txt-titulo").textContent = destino === "sala" ? estado.nomeSala : "Início";
    } else if (destino === "salas") {
      atual = "salas";
      mostrarPagina("salas");
    } else if (destino === "jogos") {
      atual = "jogos";
      mostrarPagina("jogos");
      desenharJogos();
      if (conectado()) enviar({ t: "modulos", lista: extrasInstalados() });   // pede a lista atualizada (igual ao botão Extras)
    } else if (destino === "musica") {
      atual = "musica";
      mostrarPagina("musica");
    } else if (destino === "mensagens") {
      // abre as Mensagens (conversas; os grupos ficam na aba ao lado); clicar de novo fecha
      if (gruposAbertos()) window.astraGrupos?.fechar(); else $("bt-privado").click();
    }
    marcar();
  }

  for (const b of botoes) b.addEventListener("click", () => ir(b.dataset.ir));

  // Tema claro/escuro rápido (o seletor completo continua nas Configurações).
  $("trilho-tema").addEventListener("click", () => {
    const claro = document.documentElement.dataset.tema === "claro";
    const novo = claro ? (ler("astra.temaEscuro") || "") : "claro";
    if (!claro) guardar("astra.temaEscuro", document.documentElement.dataset.tema || "");
    guardar("astra.tema", novo);
    aplicarTema(novo);
  });

  // Entrou ou saiu de sala, abriu/fechou o privado: o trilho acompanha.
  new MutationObserver(() => {
    // entrou numa sala estando em outra página: mostra a sala (a música continua tocando)
    if (naSala()) ir("sala"); else { raiz.classList.remove("v5-ver-inicio"); marcar(); }
  }).observe($("sala"), { attributes: true, attributeFilter: ["hidden"] });
  if ($("privado")) new MutationObserver(marcar).observe($("privado"), { attributes: true, attributeFilter: ["hidden"] });
  if ($("grupos")) new MutationObserver(marcar).observe($("grupos"), { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(marcar).observe($("app"), { attributes: true, attributeFilter: ["class"] });

  // Contador de mensagens privadas não lidas (o mesmo do rodapé): bolinha vermelha, "9+" acima de 9.
  const pv = $("pv-contador"), meu = $("trilho-pv");
  const btPv = botoes.find((b) => b.dataset.ir === "mensagens");
  const gr = $("trilho-gr");
  const numero = (e) => (e && !e.hidden ? (parseInt(e.textContent, 10) || 0) + (/\+/.test(e.textContent) ? 1 : 0) : 0);
  const copiar = () => {
    const n = numero(pv) + numero(gr);   // conversas + grupos (os grupos ficam dentro de Mensagens)
    const txt = n > 9 ? "9+" : n ? String(n) : "";
    const tem = !!n;
    if (tem && meu.textContent !== txt) { meu.classList.remove("pulsa"); void meu.offsetWidth; meu.classList.add("pulsa"); }
    meu.hidden = !tem;
    meu.textContent = tem ? txt : "";
    btPv.setAttribute("aria-label", tem ? `Mensagens, ${txt === "9+" ? "mais de 9" : txt} não ${txt === "1" ? "lida" : "lidas"}` : "Mensagens");
    btPv.dataset.rotulo = tem ? `Mensagens · ${txt} não ${txt === "1" ? "lida" : "lidas"}` : "Mensagens";
  };
  new MutationObserver(copiar).observe(pv, { attributes: true, childList: true, characterData: true, subtree: true });
  if (gr) new MutationObserver(copiar).observe(gr, { attributes: true, childList: true, characterData: true, subtree: true });
  copiar();

  // Pontinho na Música quando algo está tocando (sala ou Jam).
  const ponto = $("trilho-musica-ponto");
  new MutationObserver(() => { ponto.hidden = $("musica-agora").hidden; })
    .observe($("musica-agora"), { attributes: true, attributeFilter: ["hidden"] });

  // Esc fecha a página aberta.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && atual !== "inicio" && !document.querySelector(".modal:not([hidden])")) ir("inicio");
  });

  // Tooltip dos botões (só quando o nome não aparece: barra recolhida ou tela estreita).
  const dica = document.createElement("div");
  dica.className = "trilho-dica";
  dica.setAttribute("role", "tooltip");
  document.body.append(dica);
  trilho.addEventListener("pointerover", (e) => {
    const b = e.target.closest(".trilho-bt, .trilho-marca, .trilho-eu");
    const nomeVisivel = b && b.querySelector("span:not(.sr)") && getComputedStyle(b.querySelector("span:not(.sr)")).display !== "none";
    if (!b || celular() || nomeVisivel) { dica.classList.remove("aberta"); return; }
    dica.textContent = b.dataset.rotulo || b.getAttribute("aria-label") || "";
    const r = b.getBoundingClientRect();
    dica.style.top = r.top + r.height / 2 + "px";
    dica.style.left = r.right + 10 + "px";
    dica.classList.add("aberta");
  });
  trilho.addEventListener("pointerleave", () => dica.classList.remove("aberta"));

  // Banner do Início: quantos estão online e quantas salas estão abertas (lê os contadores que já existem).
  const infoOn = $("v5-info-online"), infoSalas = $("v5-info-salas");
  if (infoOn && infoSalas) {
    const contar = () => {
      const on = (($("txt-online") && $("txt-online").textContent) || "").match(/\d+/);
      infoOn.textContent = on ? on[0] : "–";
      const qs = $("trilho-salas-qtd");
      const n = qs && !qs.hidden ? (qs.textContent || "0") : "0";
      infoSalas.textContent = n;
      $("v5-info-salas-txt").textContent = n === "1" ? "sala aberta" : "salas abertas";
    };
    for (const id of ["txt-online", "trilho-salas-qtd"]) {
      if ($(id)) new MutationObserver(contar).observe($(id), { childList: true, characterData: true, subtree: true, attributes: true });
    }
    contar();
  }

  window.astraNav = { ir, atual: () => atual, recolher: () => recolher(true, false) };
  marcar();
})();
