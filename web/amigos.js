// Amigos (2.7.33): adicionar, aceitar, excluir e bloquear, numa janelinha igual à dos Grupos.
// A VPS guarda quem é amigo de quem e quem bloqueou quem. Bloquear desfaz a amizade e impede a
// pessoa de mandar mensagem privada, pedido de amizade, convite e pedido para entrar na sua sala;
// as mensagens dela no chat da sala também somem para você.
// Para a equipe do Astra (reh e larpinhosahur), o menu "⋯" também tem "Banir do Astra" e a janela
// ganha a aba "Banidos".
(() => {
  "use strict";
  const A = { amigos: [], recebidos: [], enviados: [], bloqueados: [], banidos: [], pvAmigos: false, aba: "amigos", pedido: false };
  const painel = $("amigos"), bt = $("trilho-amigos"), contador = $("trilho-am");
  if (!painel || !bt) return;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const SVG_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const SVG_MAIS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  const bloqueadosSet = () => new Set(A.bloqueados.map((x) => x.id));
  const ehAmigo = (id) => A.amigos.some((x) => x.id === id);
  const pediu = (id) => A.enviados.some((x) => x.id === id);
  const mePediu = (id) => A.recebidos.some((x) => x.id === id);
  const bloqueado = (id) => A.bloqueados.some((x) => x.id === id);

  painel.innerHTML = `
    <aside class="gr-lado">
      <header class="gr-lado-cab"><b>Amigos</b></header>
      <div class="gr-lista am-abas" role="tablist"></div>
      <label class="am-pref"><input type="checkbox" class="am-pv-amigos"> <span>Só amigos me mandam mensagem privada</span></label>
    </aside>
    <section class="gr-conversa">
      <header class="gr-topo"></header>
      <form class="am-add"><input class="am-add-nick" maxlength="24" autocomplete="off" placeholder="Nome de usuário de quem você quer adicionar"><button class="bt primario pequeno">Adicionar</button></form>
      <div class="gr-msgs am-corpo" aria-live="polite"></div>
    </section>`;
  const abas = painel.querySelector(".am-abas"), topo = painel.querySelector(".gr-topo"), corpo = painel.querySelector(".am-corpo"),
    form = painel.querySelector(".am-add"), campo = painel.querySelector(".am-add-nick"), pref = painel.querySelector(".am-pv-amigos");

  // ---------- abrir / fechar ----------
  function abrirPainel(aba) {
    if (!$("privado").hidden) $("bt-privado").click();
    window.astraGrupos?.fechar();
    painel.hidden = false;
    bt.setAttribute("aria-pressed", "true");
    if (aba) A.aba = aba;
    if (!A.pedido) { A.pedido = true; enviar({ t: "am-lista" }); }
    if (estado.equipe && A.aba === "banidos") enviar({ t: "banidos" });
    desenhar();
  }
  function fecharPainel() { painel.hidden = true; bt.setAttribute("aria-pressed", "false"); }
  bt.addEventListener("click", () => (painel.hidden ? abrirPainel() : fecharPainel()));
  for (const b of document.querySelectorAll('[data-ir="mensagens"], #bt-privado, #trilho-grupos')) b.addEventListener("click", () => fecharPainel());
  window.astraGrupos && document.addEventListener("astra-grupos-abriu", () => fecharPainel());
  painel.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharPainel(); });

  // ---------- desenhar ----------
  function contar() {
    const n = A.recebidos.length;
    contador.hidden = !n;
    contador.textContent = n > 9 ? "9+" : String(n);
  }
  function infoOnline(id) { return (estado.online || []).find((p) => p.astraId === id); }
  function linhaPessoa(p, botoes, detalhe) {
    const li = el("div", "am-pessoa");
    if (p.f && !estado.fotos.has(p.id)) estado.fotos.set(p.id, p.f);
    const on = infoOnline(p.id);
    const av = avatar(p.nick, p.id, !!(on && on.transmitindo));
    pontoStatus(av, on ? on.st : "inv");
    const txt = el("span", "am-txt");
    const b = el("b", "", (on && on.nome) || p.nick);
    const raro = seloRaro(p.nick);
    if (raro) b.append(raro);
    txt.append(b, el("small", "", detalhe != null ? detalhe : on ? (on.transmitindo ? `Ao vivo em ${on.nomeSala}` : on.sala ? `Em ${on.nomeSala}` : "Online") : "Offline"));
    li.append(av, txt);
    const acoes = el("span", "am-acoes");
    for (const [rotulo, fn, cls] of botoes) {
      const x = el("button", "bt pequeno " + (cls || "secundario"), rotulo);
      x.type = "button";
      x.onclick = (ev) => { ev.stopPropagation(); fn(x); };
      acoes.append(x);
    }
    li.append(acoes);
    return li;
  }
  const mandar = (t, id, extra) => enviar({ t, id, ...(extra || {}) });
  function desenharAbas() {
    abas.innerHTML = "";
    const lista = [["amigos", "Amigos", A.amigos.length], ["pedidos", "Pedidos", A.recebidos.length + A.enviados.length], ["bloqueados", "Bloqueados", A.bloqueados.length]];
    if (estado.equipe) lista.push(["banidos", "Banidos", A.banidos.length]);
    for (const [id, nome, n] of lista) {
      const b = el("button", "gr-item" + (A.aba === id ? " on" : "") + (id === "pedidos" && A.recebidos.length ? " nl" : ""));
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(A.aba === id));
      const txt = el("span", "gr-item-txt"); txt.append(el("b", "", nome));
      b.append(txt);
      if (n) b.append(el("span", "gr-n am-n", n > 99 ? "99+" : String(n)));
      b.onclick = () => { A.aba = id; if (id === "banidos") enviar({ t: "banidos" }); desenhar(); };
      abas.append(b);
    }
  }
  function vazio(texto) { corpo.append(el("p", "gr-vazio", texto)); }
  function desenhar() {
    contar();
    desenharAbas();
    pref.checked = !!A.pvAmigos;
    topo.innerHTML = "";
    const titulos = { amigos: "Seus amigos", pedidos: "Pedidos de amizade", bloqueados: "Pessoas bloqueadas", banidos: "Banidos do Astra (equipe)" };
    const fechar = el("button", "gr-bt"); fechar.type = "button"; fechar.title = "Fechar"; fechar.setAttribute("aria-label", "Fechar"); fechar.innerHTML = SVG_X;
    fechar.onclick = fecharPainel;
    topo.append(el("b", "gr-titulo", titulos[A.aba] || "Amigos"), fechar);
    form.hidden = A.aba === "bloqueados" || A.aba === "banidos";
    corpo.innerHTML = "";
    if (A.aba === "amigos") {
      if (!A.amigos.length) return vazio("Você ainda não tem amigos aqui. Adicione pelo nick ou pelo ⋯ ao lado de alguém online.");
      const ordem = [...A.amigos].sort((a, b) => (!!infoOnline(b.id) - !!infoOnline(a.id)) || a.nick.localeCompare(b.nick));
      for (const p of ordem) {
        const on = infoOnline(p.id);
        const bts = [["Mensagem", () => { fecharPainel(); window.astraPrivado?.abrir(p.id, p.nick); }, "primario"]];
        if (on && on.sala && on.sala !== estado.sala) bts.push(["Entrar na sala", () => { fecharPainel(); entrarNaSala(on.sala); }]);
        bts.push(["Excluir", (x) => confirmar(x, () => mandar("am-remover", p.id))]);
        bts.push(["Bloquear", (x) => confirmar(x, () => mandar("am-bloquear", p.id)), "perigo"]);
        corpo.append(linhaPessoa(p, bts));
      }
    } else if (A.aba === "pedidos") {
      if (!A.recebidos.length && !A.enviados.length) return vazio("Nenhum pedido de amizade agora.");
      if (A.recebidos.length) corpo.append(el("h4", "am-sub", "Recebidos"));
      for (const p of A.recebidos) {
        corpo.append(linhaPessoa(p, [["Aceitar", () => mandar("am-aceitar", p.id), "primario"], ["Recusar", () => mandar("am-recusar", p.id)],
          ["Bloquear", (x) => confirmar(x, () => mandar("am-bloquear", p.id)), "perigo"]], "Quer ser seu amigo(a)"));
      }
      if (A.enviados.length) corpo.append(el("h4", "am-sub", "Enviados"));
      for (const p of A.enviados) corpo.append(linhaPessoa(p, [["Cancelar", () => mandar("am-cancelar", p.id)]], "Esperando resposta"));
    } else if (A.aba === "bloqueados") {
      corpo.append(el("p", "am-dica", "Quem você bloqueou não consegue te mandar mensagem privada, pedido de amizade, convite nem pedir para entrar na sua sala. As mensagens dessa pessoa no chat da sala somem para você."));
      if (!A.bloqueados.length) return vazio("Você não bloqueou ninguém.");
      for (const p of A.bloqueados) corpo.append(linhaPessoa(p, [["Desbloquear", () => mandar("am-desbloquear", p.id)]], "Bloqueado(a)"));
    } else if (A.aba === "banidos") {
      corpo.append(el("p", "am-dica", "Banir tira a conta e os aparelhos dela (PC, celular e navegador) do Astra. A internet não é banida: por 30 dias, só contas novas criadas nela ficam limitadas (assistem, mas não criam sala nem conversam). Quem já usava o Astra na mesma internet continua normal. Para tirar a limitação de alguém: ⋯ > Liberar conta limitada."));
      if (A.resumo) corpo.append(el("p", "am-dica", A.resumo));
      if (!A.banidos.length) return vazio("Ninguém banido.");
      for (const p of A.banidos) {
        const quando = p.em ? new Date(p.em * 1000).toLocaleDateString("pt-BR") : "";
        corpo.append(linhaPessoa({ id: p.id, nick: p.nick || p.id }, [["Desbanir", (x) => confirmar(x, () => enviar({ t: "desbanir", alvo: p.id }))]],
          `${p.motivo || "sem motivo"} · por ${p.por || "?"}${quando ? " · " + quando : ""}`));
      }
    }
  }
  // Segundo clique confirma (igual ao "Tirar?" da sala).
  function confirmar(bt, fn) {
    if (!bt.classList.contains("confirmar")) {
      const antes = bt.textContent;
      bt.classList.add("confirmar"); bt.textContent = "Certeza?";
      setTimeout(() => { bt.classList.remove("confirmar"); bt.textContent = antes; }, 3000);
      return;
    }
    bt.disabled = true;
    fn();
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const quem = campo.value.trim();
    if (!quem) return;
    enviar({ t: "am-pedir", quem });
    campo.value = "";
  });
  pref.addEventListener("change", () => enviar({ t: "am-pref", pvAmigos: pref.checked }));
  // Configurações > Minha conta: nome de exibição (pode repetir; vazio = aparece o nome de usuário)
  const fx = $("cfg-exibicao"), fxIn = $("cfg-exibicao-in");
  if (fx && fxIn) {
    fxIn.value = estado.exibicao || "";
    fx.addEventListener("submit", (ev) => { ev.preventDefault(); enviar({ t: "exibicao", nome: fxIn.value.trim() }); });
  }
  TRATAR.exibicao = (m) => {
    if (!m.ok) return aviso({ titulo: m.msg || "Não deu para mudar o nome.", tempo: 5000 });
    estado.exibicao = m.nome || "";
    guardar("astra.exibicao", estado.exibicao);
    if (fxIn) fxIn.value = estado.exibicao;
    mostrarMeuNome();
    if ($("cfg-nome")) $("cfg-nome").textContent = $("txt-meu-nome").textContent;
    aviso({ titulo: estado.exibicao ? `Agora você aparece como ${estado.exibicao}` : "Você aparece com o seu nome de usuário", tempo: 4000 });
  };

  // Configurações > Mensagens privadas: a mesma opção, e "Esconder meu IP em todas as salas"
  const cfgPv = $("cfg-pv-amigos"), cfgIp = $("cfg-ip-sempre"), cfgDireto = $("cfg-direto");
  // 2.7.38: conexão direta (menos ping, mostra o IP); não combina com "Esconder meu IP em todas as salas"
  if (cfgDireto) {
    cfgDireto.checked = ler("astra.direto") === "1";
    cfgDireto.addEventListener("change", () => {
      guardar("astra.direto", cfgDireto.checked ? "1" : "0");
      if (cfgDireto.checked && cfgIp && cfgIp.checked) { cfgIp.checked = false; guardar("astra.ipSempre", "0"); }
      aviso({ titulo: cfgDireto.checked ? "Conexão direta ligada" : "Conexão pelo servidor da Astra",
              texto: cfgDireto.checked ? "Menos ping com quem também ligou. Vale a partir da próxima sala em que você entrar." : "Seu IP volta a ficar escondido. Vale a partir da próxima sala.", tempo: 6000 });
    });
  }
  if (cfgPv) cfgPv.addEventListener("change", () => enviar({ t: "am-pref", pvAmigos: cfgPv.checked }));
  if (cfgIp) {
    cfgIp.checked = ler("astra.ipSempre") === "1";
    cfgIp.addEventListener("change", () => {
      guardar("astra.ipSempre", cfgIp.checked ? "1" : "0");
      if (cfgIp.checked && cfgDireto && cfgDireto.checked) { cfgDireto.checked = false; guardar("astra.direto", "0"); }
      aviso({ titulo: cfgIp.checked ? "IP escondido em todas as salas" : "IP escondido só nas salas públicas", texto: "Vale a partir da próxima sala em que você entrar.", tempo: 5000 });
    });
  }

  // ---------- ⋯ ao lado de cada pessoa (lista de online e da sala) ----------
  function botao(li, id, nome) {
    if (!id || id === estado.meuId || !/^\d{9}$/.test(id)) return;
    const b = el("button", "am-mais"); b.type = "button";
    b.title = `Mais opções para ${nome}`; b.setAttribute("aria-label", b.title);
    b.innerHTML = SVG_MAIS;
    b.onclick = (ev) => { ev.stopPropagation(); menuPessoa(b, id, nome); };
    li.dataset.amId = id; li.dataset.amNome = nome;   // botão direito na linha abre o mesmo menu
    li.append(b);
  }
  function menuPessoa(ancora, id, nome, ponto) {
    document.querySelector(".am-menu")?.remove();
    const m = el("div", "gr-menu am-menu");
    const item = (txt, fn, cls) => { const x = el("button", cls || "", txt); x.type = "button"; x.onclick = (e) => { e.stopPropagation(); m.remove(); fn(); }; m.append(x); };
    item("Copiar ID", () => copiar(id, `ID de ${nome} copiado`));
    if (bloqueado(id)) item("Desbloquear", () => mandar("am-desbloquear", id));
    else {
      if (ehAmigo(id)) item("Excluir amigo", () => { if (confirm(`Excluir ${nome} dos seus amigos?`)) mandar("am-remover", id); });
      else if (mePediu(id)) item("Aceitar pedido de amizade", () => mandar("am-aceitar", id));
      else if (pediu(id)) item("Cancelar pedido de amizade", () => mandar("am-cancelar", id));
      else item("Adicionar amigo", () => enviar({ t: "am-pedir", quem: id }));
      item("Bloquear", () => { if (confirm(`Bloquear ${nome}? Essa pessoa não vai conseguir te mandar mensagem, convite nem pedido de amizade.`)) mandar("am-bloquear", id); }, "perigo");
    }
    if (estado.equipe) {
      item("Banir do Astra…", () => {
        const motivo = prompt(`Banir ${nome} do Astra: a conta e os aparelhos dela (PC, celular, navegador). Na internet dela, só contas NOVAS ficam limitadas por 30 dias.\nMotivo:`);
        if (motivo === null) return;
        enviar({ t: "banir", alvo: id, motivo: motivo.trim() || "sem motivo" });
      }, "perigo");
      item("Liberar conta limitada", () => enviar({ t: "liberar", alvo: id }));
    }
    document.body.append(m);
    const r = ancora.getBoundingClientRect();
    m.style.position = "fixed";
    m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, ponto ? ponto.y : r.bottom + 4)) + "px";
    m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, ponto ? ponto.x : r.right - m.offsetWidth)) + "px";
    setTimeout(() => addEventListener("click", function fora(e) { if (!m.contains(e.target)) { m.remove(); removeEventListener("click", fora); } }), 0);
  }

  // ---------- botão direito (3.0.21) ----------
  // O menu do navegador (Voltar, Atualizar, Salvar como, Imprimir) não aparece mais.
  // Botão direito numa pessoa = o mesmo menu do ⋯; numa sala = Entrar / Denunciar.
  // Em campos de texto o menu normal continua (copiar e colar).
  function menuSala(card, ponto) {
    document.querySelector(".am-menu")?.remove();
    const id = card.dataset.sala, nome = card.dataset.salaNome || "sala";
    const m = el("div", "gr-menu am-menu");
    const item = (txt, fn, cls) => { const x = el("button", cls || "", txt); x.type = "button"; x.onclick = (e) => { e.stopPropagation(); m.remove(); fn(); }; m.append(x); };
    const bt = card.querySelector(".v5-card-bt");
    if (bt && !bt.disabled) item((card.querySelector(".v5-entrar")?.textContent || "Entrar").trim(), () => bt.click());
    item("Copiar nome da sala", () => copiar(nome, "Nome da sala copiado"));
    if (card.dataset.salaFixa !== "1" && id !== estado.meuId) {
      item("Denunciar sala…", () => {
        document.getElementById("bt-relato")?.click();
        if (typeof escolherTipoRelato === "function") escolherTipoRelato("problema");
        const t = document.getElementById("relato-texto");
        if (t) { t.value = `[Denúncia de sala] "${nome}" (ID ${id}): `; t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      }, "perigo");
    }
    document.body.append(m);
    m.style.position = "fixed";
    m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, ponto.y)) + "px";
    m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, ponto.x)) + "px";
    setTimeout(() => addEventListener("click", function fora(e) { if (!m.contains(e.target)) { m.remove(); removeEventListener("click", fora); } }), 0);
  }
  addEventListener("contextmenu", (ev) => {
    const alvo = ev.target instanceof Element ? ev.target : null;
    if (alvo && alvo.closest("input, textarea, [contenteditable=\"\"], [contenteditable=\"true\"]")) return;
    ev.preventDefault();
    if (!alvo) return;
    const ponto = { x: ev.clientX, y: ev.clientY };
    const pessoa = alvo.closest("[data-am-id]");
    if (pessoa) { menuPessoa(pessoa, pessoa.dataset.amId, pessoa.dataset.amNome || "", ponto); return; }
    const sala = alvo.closest(".v5-card[data-sala]");
    if (sala) { menuSala(sala, ponto); return; }
    document.querySelector(".am-menu")?.remove();
  });

  // ---------- o que chega da VPS ----------
  TRATAR["am-lista"] = (m) => {
    for (const k of ["amigos", "recebidos", "enviados", "bloqueados"]) A[k] = Array.isArray(m[k]) ? m[k] : [];
    A.pvAmigos = !!m.pvAmigos;
    if (cfgPv) cfgPv.checked = A.pvAmigos;
    A.pedido = true;
    if (!painel.hidden) desenhar(); else contar();
  };
  TRATAR["am-aviso"] = (m) => {
    aviso({ titulo: m.texto || "Amigos", tempo: 6000, windows: m.tipo === "pedido",
      aoClicar: () => { programa?.mostrar?.(); abrirPainel(m.tipo === "pedido" ? "pedidos" : "amigos"); } });
  };
  TRATAR["am-erro"] = (m) => aviso({ titulo: m.msg || "Não deu certo.", tempo: 5000 });
  TRATAR.banidos = (m) => {
    A.banidos = Array.isArray(m.lista) ? m.lista : [];
    A.resumo = `${m.aps || 0} aparelho(s) banido(s) · ${m.ips || 0} internet(s) em quarentena · ${m.liberadas || 0} conta(s) liberada(s)`;
    if (!painel.hidden) desenhar();
  };
  TRATAR["ban-ok"] = (m) => {
    if (m.liberou) return aviso({ titulo: `${m.nick} foi liberado(a).`, texto: "A conta não fica mais limitada.", tempo: 6000 });
    const partes = ["a conta"];
    if (m.aparelhos) partes.push(m.aparelhos === 1 ? "1 aparelho" : `${m.aparelhos} aparelhos`);
    aviso({ titulo: `${m.nick} foi banido(a).`, texto: `Banido: ${partes.join(" e ")}.` + (m.ip ? " Contas novas na mesma internet ficam limitadas por 30 dias (quem já usava o Astra lá continua normal)." : "") + (m.limitados ? ` ${m.limitados} conta(s) nova(s) online foram limitadas.` : ""), tempo: 9000 });
  };
  // 2.7.33: conta limitada (nova, numa internet onde alguém foi banido): só assiste salas
  function avisoLimitado(curto) {
    aviso({ titulo: "Sua conta está limitada", texto: curto ? "Enquanto estiver limitada, você só pode assistir às salas." : "Alguém foi banido nesta mesma internet há pouco tempo, e contas novas daqui ficam limitadas por até 30 dias: dá para assistir às salas, mas não criar sala, conversar ou mandar mensagem. Se foi engano, fale com a equipe em Configurações > Fale com o dono.", tempo: curto ? 5000 : 20000 });
  }
  TRATAR.limitado = (m) => {
    const antes = !!estado.limitado;
    estado.limitado = !!m.sim;
    document.documentElement.classList.toggle("conta-limitada", estado.limitado);
    if (estado.limitado) avisoLimitado(!!m.aviso || antes);
    else if (antes) aviso({ titulo: "Sua conta foi liberada", texto: "Já dá para usar o Astra normalmente.", tempo: 6000 });
  };
  TRATAR["ban-erro"] = (m) => aviso({ titulo: m.msg || "Não deu para banir.", tempo: 5000 });
  TRATAR.banido = (m) => {
    estado.banido = true;
    $("msg-inicio").textContent = m.msg;
    aviso({ titulo: "Você foi banido(a) do Astra", texto: m.msg, tempo: 60000 });
  };

  // Bloqueado: some do chat da sala e o privado dele é ignorado.
  const chatAntes = TRATAR.chat;
  TRATAR.chat = function (m) { if (m && bloqueadosSet().has(m.astraId)) return; return chatAntes.call(this, m); };
  const bemvindoAntes = TRATAR.bemvindo;
  TRATAR.bemvindo = function (m) {
    if (m && Array.isArray(m.chat)) { const b = bloqueadosSet(); m.chat = m.chat.filter((x) => !b.has(x.astraId)); }
    return bemvindoAntes.call(this, m);
  };
  const pvAntes = TRATAR.pv;
  if (pvAntes) TRATAR.pv = function (m) { if (m && bloqueadosSet().has(m.de)) return; return pvAntes.call(this, m); };
  const convAntes = TRATAR.convite;
  TRATAR.convite = function (m) { if (m && bloqueadosSet().has(m.deId)) return; return convAntes.call(this, m); };

  // equipe (vem no "pronto") e lista de amigos de novo a cada conexão
  const prontoAntes = TRATAR.pronto;
  TRATAR.pronto = function (m) {
    estado.equipe = !!m.equipe;
    if (typeof m.exibicao === "string") { estado.exibicao = m.exibicao; guardar("astra.exibicao", m.exibicao); }
    prontoAntes.call(this, m);
    mostrarMeuNome();
    if (!!m.limitado !== !!estado.limitado || m.limitado) TRATAR.limitado({ sim: !!m.limitado, aviso: !!estado.limitado });
    if (estado.equipe) document.documentElement.classList.add("sou-equipe");
  };
  // a lista de online muda: o status dos amigos também
  const onlineAntes = TRATAR.online;
  TRATAR.online = function (m) { onlineAntes.call(this, m); if (!painel.hidden) desenhar(); };

  window.astraAmigos = { botao, abrir: abrirPainel, fechar: fecharPainel, bloqueado };
})();
