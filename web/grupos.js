// Grupos de texto (2.7.20): estilo Discord, mas simples. Janelinha flutuante igual à das
// Mensagens privadas: lista de grupos à esquerda e a conversa à direita. A caixa pode ser
// redimensionada pela alça do canto de cima à direita (o tamanho fica guardado).
// As mensagens ficam guardadas na VPS (o chat privado continua criptografado).
(() => {
  "use strict";
  const G = { grupos: [], aberto: null, msgs: new Map(), criando: false, pedido: false };
  const painel = $("grupos"), bt = $("trilho-grupos"), contador = $("trilho-gr");
  if (!painel || !bt) return;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const hora = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sigla = (nome) => (nome || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const grupo = (id) => G.grupos.find((g) => g.id === id);
  const SVG_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  painel.innerHTML = `
    <div class="gr-alca" title="Arraste para mudar o tamanho" aria-hidden="true"></div>
    <aside class="gr-lado">
      <header class="gr-lado-cab"><button type="button" class="gr-novo" title="Novo grupo" aria-label="Novo grupo">+</button></header>
      <div class="gr-lista" role="list"></div>
    </aside>
    <section class="gr-conversa">
      <header class="gr-topo"></header>
      <div class="gr-msgs" aria-live="polite"></div>
      <form class="gr-form" hidden><input class="gr-texto" maxlength="1000" autocomplete="off" enterkeyhint="send"></form>
    </section>`;
  const lista = painel.querySelector(".gr-lista"), topo = painel.querySelector(".gr-topo"),
    caixa = painel.querySelector(".gr-msgs"), form = painel.querySelector(".gr-form"), campo = painel.querySelector(".gr-texto");

  // ---------- tamanho (alça no canto de cima à direita; a caixa fica presa embaixo à esquerda) ----------
  const TAM = "astra.gruposTam";
  function aplicarTam(w, h) {
    const maxW = innerWidth - painel.getBoundingClientRect().left - 12, maxH = innerHeight - 24;
    painel.style.width = Math.round(Math.max(420, Math.min(w, maxW))) + "px";
    painel.style.height = Math.round(Math.max(320, Math.min(h, maxH))) + "px";
  }
  try { const t = JSON.parse(ler(TAM) || "null"); if (t && t.w && t.h) { painel.style.width = t.w + "px"; painel.style.height = t.h + "px"; } } catch (_) {}
  painel.querySelector(".gr-alca").addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const r = painel.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
    painel.classList.add("mexendo");
    const mover = (e) => aplicarTam(r.width + (e.clientX - x0), r.height - (e.clientY - y0));
    const soltar = () => {
      painel.classList.remove("mexendo");
      removeEventListener("pointermove", mover); removeEventListener("pointerup", soltar);
      guardar(TAM, JSON.stringify({ w: parseInt(painel.style.width), h: parseInt(painel.style.height) }));
    };
    addEventListener("pointermove", mover); addEventListener("pointerup", soltar);
  });

  // ---------- abrir / fechar ----------
  function abrirPainel() {
    if (!$("privado").hidden) $("bt-privado").click();   // um de cada vez, no mesmo lugar
    painel.hidden = false;
    bt.setAttribute("aria-pressed", "true");
    desenharAbas();
    document.dispatchEvent(new Event("astra-grupos-abriu"));
    if (!G.pedido) { G.pedido = true; enviar({ t: "gr-lista" }); }
    if (!G.aberto && G.grupos.length) abrirGrupo(G.grupos[0].id);
    else desenhar();
  }
  function fecharPainel() { painel.hidden = true; bt.setAttribute("aria-pressed", "false"); }
  bt.addEventListener("click", () => (painel.hidden ? abrirPainel() : fecharPainel()));
  // abrir as Mensagens privadas fecha os grupos (o botão Mensagens do trilho é tratado no nav.js)
  $("bt-privado").addEventListener("click", () => fecharPainel());
  // 2.7.33: abas "Conversas | Grupos" no lugar do título (os Grupos ficam dentro de Mensagens)
  function desenharAbas() {
    const cab = painel.querySelector(".gr-lado-cab");
    cab.querySelector(".msg-abas")?.remove();
    if (window.abasMensagens) cab.prepend(window.abasMensagens("grupos"));
  }
  painel.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharPainel(); });

  function abrirGrupo(id) {
    G.aberto = id; G.criando = false;
    const g = grupo(id);
    if (g) g.naoLidas = 0;
    enviar({ t: "gr-abrir", id });
    desenhar();
    if (!painel.hidden) setTimeout(() => campo.focus(), 0);
  }

  // ---------- desenhar ----------
  function contar() {
    const n = G.grupos.reduce((s, g) => s + (g.naoLidas || 0), 0);
    contador.hidden = !n;
    contador.textContent = n > 9 ? "9+" : String(n);
    if (!painel.hidden) desenharAbas();
  }
  function avatarDe(id, nick, cls) {
    const a = el("span", "avatar " + (cls || ""));
    pintarAvatar(a, nick, id);
    return a;
  }
  function desenharLista() {
    lista.innerHTML = "";
    if (!G.grupos.length) lista.append(el("p", "gr-vazio-lista", "Nenhum grupo ainda."));
    for (const g of G.grupos) {
      const b = el("button", "gr-item" + (g.id === G.aberto ? " on" : "") + (g.naoLidas ? " nl" : ""));
      b.type = "button"; b.setAttribute("role", "listitem");
      const txt = el("span", "gr-item-txt");
      txt.append(el("b", "", g.nome));
      const u = g.ult;
      txt.append(el("small", "", u ? `${u.de === estado.meuId ? "Você" : u.nick}: ${u.texto}` : `${g.membros.length} pessoas`));
      b.append(el("span", "gr-ic", sigla(g.nome)), txt);
      if (g.naoLidas) b.append(el("span", "gr-n", g.naoLidas > 9 ? "9+" : String(g.naoLidas)));
      b.onclick = () => abrirGrupo(g.id);
      lista.append(b);
    }
  }
  function desenharTopo(g) {
    topo.innerHTML = "";
    const fechar = el("button", "gr-bt"); fechar.type = "button"; fechar.title = "Fechar"; fechar.setAttribute("aria-label", "Fechar"); fechar.innerHTML = SVG_X;
    fechar.onclick = fecharPainel;
    if (!g) { topo.append(el("b", "gr-titulo", G.criando ? "Novo grupo" : "Grupos"), fechar); return; }
    const pilha = el("span", "gr-pilha");
    for (const p of g.membros.slice(0, 4)) { if (p.f && !estado.fotos.has(p.id)) estado.fotos.set(p.id, p.f); pilha.append(avatarDe(p.id, p.nick)); }
    pilha.append(el("small", "", String(g.membros.length)));
    pilha.title = g.membros.map((p) => p.nick).join(", ");
    const mais = el("button", "gr-bt gr-mais"); mais.type = "button"; mais.title = "Opções do grupo"; mais.setAttribute("aria-label", "Opções do grupo");
    mais.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
    mais.onclick = (ev) => { ev.stopPropagation(); menuGrupo(g, mais); };
    topo.append(el("b", "gr-titulo", g.nome), pilha, mais, fechar);
  }
  function desenharMsgs(g) {
    caixa.innerHTML = "";
    const msgs = G.msgs.get(g.id) || [];
    if (!msgs.length) { caixa.append(el("p", "gr-vazio", "Nenhuma mensagem ainda. Diga oi!")); return; }
    let ant = null;
    for (const m of msgs) {
      const junto = ant && ant.de === m.de && m.em - ant.em < 5 * 60e3;
      const linha = el("div", "gr-m" + (junto ? " seguida" : "") + (m.tmp ? " enviando" : ""));
      if (!junto) {
        linha.append(avatarDe(m.de, m.nick));
        const cab = el("div", "gr-cab");
        const nome = el("b", "", m.nick); nome.style.color = corDe(m.de);
        cab.append(nome, el("time", "", hora(m.em)));
        linha.append(cab);
      }
      const p = el("p", "");
      // @nick fica destacado; @você ganha a linha marcada
      const partes = String(m.texto).split(/(@[^\s@]{2,24})/g);
      for (const parte of partes) {
        if (/^@/.test(parte)) {
          const s = el("span", "gr-men", parte);
          if (meuNome() && parte.slice(1).toLowerCase() === meuNome().toLowerCase()) linha.classList.add("marcou");
          p.append(s);
        } else if (parte) p.append(document.createTextNode(parte));
      }
      linha.append(p);
      caixa.append(linha);
      ant = m;
    }
    caixa.scrollTop = caixa.scrollHeight;
  }
  function desenharCriar() {
    caixa.innerHTML = "";
    const f = el("form", "gr-criar");
    f.innerHTML = `<label>Nome do grupo<input class="gr-c-nome" maxlength="32" required placeholder="Ex.: Os Larpinhos"></label>
      <label>Chamar pessoas <small>(nicks, separados por vírgula)</small><input class="gr-c-pessoas" maxlength="400" placeholder="Ex.: Katarina, Dudu"></label>
      <div class="gr-sugestoes"></div>
      <div class="gr-c-bts"><button type="button" class="bt secundario gr-c-cancelar">Cancelar</button><button class="bt primario">Criar grupo</button></div>`;
    const pessoas = f.querySelector(".gr-c-pessoas"), sug = f.querySelector(".gr-sugestoes");
    // atalho: quem está online vira um botãozinho para adicionar
    for (const p of (estado.online || []).filter((x) => x.astraId !== estado.meuId && !x.visitante).slice(0, 12)) {
      const c = el("button", "gr-chip", p.nome); c.type = "button";
      c.onclick = () => {
        const atuais = pessoas.value.split(",").map((s) => s.trim()).filter(Boolean);
        if (!atuais.some((n) => n.toLowerCase() === p.nome.toLowerCase())) atuais.push(p.nome);
        pessoas.value = atuais.join(", "); c.disabled = true;
      };
      sug.append(c);
    }
    f.querySelector(".gr-c-cancelar").onclick = () => { G.criando = false; desenhar(); };
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const nome = f.querySelector(".gr-c-nome").value.trim();
      if (!nome) return;
      enviar({ t: "gr-criar", nome, pessoas: pessoas.value.split(",").map((s) => s.trim()).filter(Boolean) });
    };
    caixa.append(f);
    setTimeout(() => f.querySelector(".gr-c-nome").focus(), 0);
  }
  function desenhar() {
    contar();
    desenharLista();
    const g = !G.criando && grupo(G.aberto);
    desenharTopo(g);
    form.hidden = !g;
    if (G.criando) desenharCriar();
    else if (g) { campo.placeholder = `Mensagem para ${g.nome}`; desenharMsgs(g); }
    else {
      caixa.innerHTML = "";
      const v = el("div", "gr-boas");
      v.append(el("b", "", "Converse com a sua galera"), el("p", "", "Crie um grupo e chame os amigos. Só quem está no grupo vê as mensagens."));
      const c = el("button", "bt primario", "Criar grupo"); c.type = "button"; c.onclick = novoGrupo;
      v.append(c); caixa.append(v);
    }
  }
  function novoGrupo() { G.criando = true; desenhar(); }
  painel.querySelector(".gr-novo").onclick = novoGrupo;

  // menu "⋯": convidar (dono), sair do grupo
  function menuGrupo(g, ancora) {
    const velho = painel.querySelector(".gr-menu");
    if (velho) { velho.remove(); return; }
    const m = el("div", "gr-menu");
    const item = (txt, fn, cls) => { const b = el("button", cls || "", txt); b.type = "button"; b.onclick = () => { m.remove(); fn(); }; m.append(b); };
    if (g.dono === estado.meuId) {
      item("Chamar pessoa", () => {
        const nick = prompt("Nick de quem você quer chamar:");
        if (nick && nick.trim()) enviar({ t: "gr-convidar", id: g.id, nick: nick.trim() });
      });
      item("Mudar o nome", () => {
        const nome = prompt("Novo nome do grupo:", g.nome);
        if (nome && nome.trim()) enviar({ t: "gr-renomear", id: g.id, nome: nome.trim() });
      });
    }
    item("Sair do grupo", () => { if (confirm(`Sair do grupo "${g.nome}"?`)) enviar({ t: "gr-sair", id: g.id }); }, "perigo");
    topo.append(m);
    setTimeout(() => addEventListener("click", function fora(e) { if (!m.contains(e.target)) { m.remove(); removeEventListener("click", fora); } }), 0);
  }

  // ---------- mandar ----------
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const texto = campo.value.trim();
    if (!texto || !G.aberto) return;
    const tmp = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const lst = G.msgs.get(G.aberto) || [];
    lst.push({ id: 0, tmp, de: estado.meuId, nick: meuNome(), texto, em: Date.now() });
    G.msgs.set(G.aberto, lst);
    enviar({ t: "gr-msg", id: G.aberto, texto, tmp });
    campo.value = "";
    desenhar();
  });
  campo.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharPainel(); });

  // ---------- o que chega da VPS ----------
  TRATAR["gr-lista"] = (m) => {
    G.grupos = Array.isArray(m.grupos) ? m.grupos : [];
    if (G.aberto && !grupo(G.aberto)) G.aberto = null;   // saiu do grupo (ou foi tirado)
    if (!G.aberto && !G.criando && !painel.hidden && G.grupos.length) return abrirGrupo(G.grupos[0].id);
    const g = grupo(G.aberto);
    if (g && !painel.hidden) g.naoLidas = 0;
    desenhar();
  };
  TRATAR["gr-criado"] = (m) => { G.criando = false; G.aberto = m.id; enviar({ t: "gr-abrir", id: m.id }); };
  TRATAR["gr-hist"] = (m) => { G.msgs.set(m.id, m.msgs || []); if (m.id === G.aberto) desenhar(); };
  TRATAR["gr-erro"] = (m) => aviso({ titulo: m.msg || "Não deu certo.", tempo: 4000 });
  TRATAR["gr-msg"] = (m) => {
    const g = grupo(m.grupo), x = m.msg;
    if (!g || !x) return;
    const lst = G.msgs.get(m.grupo);
    if (lst) {
      const i = m.tmp ? lst.findIndex((y) => y.tmp === m.tmp) : -1;
      if (i >= 0) lst[i] = x; else lst.push(x);
      if (lst.length > 300) lst.splice(0, lst.length - 300);
    }
    g.ult = { ...x, texto: x.texto.slice(0, 120) };
    G.grupos.sort((a, b) => (b.ult ? b.ult.em : 0) - (a.ult ? a.ult.em : 0));
    const vendo = !painel.hidden && G.aberto === m.grupo && !document.hidden;
    if (x.de !== estado.meuId) {
      if (vendo) enviar({ t: "gr-lido", id: m.grupo, ate: x.id });
      else {
        g.naoLidas = (g.naoLidas || 0) + 1;
        if (estado.status !== "ocu") aviso({ titulo: `${x.nick} em ${g.nome}`, texto: x.texto.slice(0, 140), tempo: 5000, aoClicar: () => { abrirPainel(); abrirGrupo(g.id); } });
      }
    }
    desenhar();
  };
  // a cada conexão (e reconexão), pega a lista de novo
  const prontoAntes = TRATAR.pronto;
  TRATAR.pronto = function (m) { prontoAntes.call(this, m); G.pedido = true; enviar({ t: "gr-lista" }); if (G.aberto) enviar({ t: "gr-abrir", id: G.aberto }); };

  window.astraGrupos = { abrir: abrirPainel, fechar: fecharPainel };
})();
