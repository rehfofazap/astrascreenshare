// 2.7.23: clicar na sua foto (barra da esquerda) abre o seu cartão, igual ao Discord.
// Usa o mesmo cartãozinho "névoa" que aparece ao passar o mouse no nome (montarCartao),
// com uma lista simples embaixo: Editar perfil, Status, Mudar nick e Carteira.
// Só mexe na tela: o perfil é salvo pela mesma mensagem "perfil" de sempre.
(() => {
  const $ = (id) => document.getElementById(id);
  const IC = {
    lapis: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m4 17.2 10.6-10.6 3 3L7 20.2H4v-3Zm12-12 1.4-1.4a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L19 8.2l-3-3Z"/></svg>',
    nick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4h14v3h-2V6h-4v12h2v2H9v-2h2V6H7v1H5V4Z"/></svg>',
    ins: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a6 6 0 0 1 3.5 10.9L17 22l-5-3-5 3 1.5-9.1A6 6 0 0 1 12 2Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>',
    lua: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 1 0 8.6 11.6A7 7 0 0 1 12.4 3H12Zm6-1 .9 2.1L21 5l-2.1.9L18 8l-.9-2.1L15 5l2.1-.9L18 2Z"/></svg>',
  };

  const caixa = document.createElement("div");
  caixa.id = "meu-cartao";
  caixa.className = "meu-cartao";
  caixa.setAttribute("role", "dialog");
  caixa.setAttribute("aria-label", "Meu perfil");
  caixa.hidden = true;
  document.body.append(caixa);
  let botao = null;

  const aberto = () => !caixa.hidden;
  function fechar() {
    if (!aberto()) return;
    subAberto = null;
    caixa.hidden = true;
    if (botao) botao.setAttribute("aria-expanded", "false");
  }

  function linha(icone, texto, dir) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mc-op";
    b.innerHTML = icone;
    const t = document.createElement("span"); t.textContent = texto; b.append(t);
    if (dir != null) { const d = document.createElement("span"); d.className = "mc-dir"; d.append(dir); b.append(d); }
    return b;
  }

  // Recado: escreve ali mesmo e aperta Enter. Manda o perfil de sempre, só com o recado novo.
  function salvarRecado(texto) {
    const p = perfilDe(estado.meuId) || {};
    if (texto === recadoDe(p)) return;
    const dados = {
      cor: p.c || "", forca: p.f || 60, degrade: (p.k || p.kg) ? 0 : (p.d || 0), capaY: p.y ?? 50,
      recado: texto, sobre: "", recadoHoras: 0, manterPrazo: false,
    };
    guardar("astra.perfil", JSON.stringify({ ...dados, prazo: 0 }));
    enviar({ t: "perfil", ...dados });
    guardarPerfilDe(estado.meuId, { ...p, r: texto, ra: 0 });   // já aparece; a VPS confirma depois
    mostrarMeuNome();
  }
  function editarRecado(el) {
    if (el.querySelector("input")) return;
    const antes = recadoDe(perfilDe(estado.meuId));
    const i = document.createElement("input");
    i.maxLength = 60; i.placeholder = "Escreva e aperte Enter"; i.autocomplete = "off"; i.value = antes;
    el.textContent = ""; el.append(i); i.focus();
    let feito = false;
    const fim = (salvar) => {
      if (feito) return; feito = true;
      const novo = salvar ? i.value.trim().slice(0, 60) : antes;
      if (salvar) salvarRecado(novo);
      el.classList.toggle("vazio", !novo);
      el.textContent = novo || "+ escrever um recado";
    };
    i.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") fim(true); if (e.key === "Escape") fim(false); };
    i.onblur = () => fim(true);
  }

  function menuStatus(ancora) {
    const sub = document.createElement("div");
    sub.className = "mc-sub";
    sub.setAttribute("role", "menu");
    for (const [st, info] of Object.entries(STATUS)) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "mc-op" + (st === estado.status ? " on" : "");
      const bol = document.createElement("span"); bol.className = "bolinha st-" + st;
      const t = document.createElement("span"); t.textContent = info.nome;
      if (info.dica) { const s = document.createElement("small"); s.textContent = info.dica; t.append(s); }
      b.append(bol, t);
      b.onclick = (e) => { e.stopPropagation(); mudarStatus(st); desenhar(); };
      sub.append(b);
    }
    // Abre para cima a partir do pé do cartão: a foto fica embaixo na tela, então nunca corta.
    sub.style.bottom = "6px";
    return sub;
  }

  // 3.0.6: escolher quais insígnias aparecem no perfil (desligada some do perfil, da lista e do chat).
  let subAberto = null;   // "ins" = o submenu das insígnias fica aberto ao redesenhar
  let timerIns = 0;
  function minhasInsignias() {
    return insigniasDe({ ...visualDe(estado.meuId, meuNome()), esconder: [] }, Infinity, true);
  }
  function salvarInsignias(esconder, principal) {
    const p = perfilDe(estado.meuId) || {};
    if (esconder.includes(principal)) principal = "";   // desligada não pode ser a principal
    const novo = { ...p, eh: esconder };
    if (principal) novo.pp = principal; else delete novo.pp;
    guardarPerfilDe(estado.meuId, novo);   // já aparece; a VPS confirma depois
    mostrarMeuNome();
    if (typeof desenharOnline === "function") desenharOnline();
    clearTimeout(timerIns);
    // A VPS recusa salvar o perfil 2x em menos de 1,5 s: junta os cliques.
    timerIns = setTimeout(() => {
      const q = perfilDe(estado.meuId) || {};
      enviar({
        t: "perfil", cor: q.c || "", forca: q.f || 60, degrade: (q.k || q.kg) ? 0 : (q.d || 0), capaY: q.y ?? 50,
        recado: recadoDe(q), sobre: "", recadoHoras: 0, manterPrazo: true, esconder: Array.isArray(q.eh) ? q.eh : [],
        principal: String(q.pp || ""),
      });
    }, 1600);
  }
  function menuInsignias() {
    const sub = document.createElement("div");
    sub.className = "mc-sub mc-sub-ins";
    sub.setAttribute("role", "menu");
    const tit = document.createElement("div");
    tit.className = "mc-sub-tit";
    tit.textContent = "Quais aparecem no seu perfil";
    sub.append(tit);
    const esc = ((perfilDe(estado.meuId) || {}).eh || []).map(String);
    const pp = String((perfilDe(estado.meuId) || {}).pp || "");
    for (const e of minhasInsignias()) {
      const k = e.dataset.k;
      const nome = k === "apoiador" ? "Early Supporter" : e.alt || e.title || "";
      e.removeAttribute("title");
      e.classList.remove("ins-dica");
      const ligada = !esc.includes(k);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mc-op mc-ins" + (ligada ? "" : " desligada");
      b.setAttribute("role", "menuitemcheckbox");
      b.setAttribute("aria-checked", String(ligada));
      const t = document.createElement("span"); t.className = "mc-ins-nome"; t.textContent = nome;
      const sw = document.createElement("span"); sw.className = "mc-sw"; sw.setAttribute("aria-hidden", "true");
      // Estrela "Principal": a que aparece ao lado do nick na lista e no chat.
      const eP = pp === k && ligada;
      const pr = document.createElement("span");
      pr.className = "mc-pri" + (eP ? " on" : "");
      pr.setAttribute("role", "button");
      pr.tabIndex = ligada ? 0 : -1;
      pr.setAttribute("aria-pressed", String(eP));
      pr.setAttribute("aria-disabled", String(!ligada));
      pr.title = !ligada ? "Ligue a insígnia para poder escolher como principal"
        : eP ? "Principal (clique para voltar ao padrão)" : "Usar como principal";
      pr.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8L12 3Z"/></svg>';
      const escolher = (ev) => {
        ev.stopPropagation();
        if (!ligada) return;
        salvarInsignias(esc, eP ? "" : k);
        desenhar();
      };
      pr.onclick = escolher;
      pr.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); escolher(ev); } };
      b.append(e, t, pr, sw);
      b.onclick = (ev) => {
        ev.stopPropagation();
        salvarInsignias(ligada ? [...esc, k] : esc.filter((x) => x !== k), pp);
        desenhar();
      };
      sub.append(b);
    }
    const nota = document.createElement("div");
    nota.className = "mc-sub-nota";
    nota.textContent = "As desligadas somem do perfil, da lista e do chat. A principal aparece ao lado do seu nome na lista e no chat.";
    sub.append(nota);
    sub.style.bottom = "6px";
    return sub;
  }

  function desenhar() {
    const v = visualDe(estado.meuId, meuNome());
    const c = montarCartao(v);
    caixa.innerHTML = "";
    caixa.style.setProperty("--brilho", v.cor || "#ffffff");

    // Capa: clique troca (abre o editor do perfil já escolhendo o arquivo).
    const capa = c.querySelector(".cp-capa");
    capa.title = "Trocar capa";
    capa.onclick = () => { fechar(); abrirFoto(); $("in-capa").click(); };
    const dica = document.createElement("span"); dica.className = "mc-capa-dica"; dica.textContent = "Trocar capa";

    // Foto: bolinha do status e "Trocar" no hover.
    const av = c.querySelector(".cp-corpo .avatar");
    av.classList.add("mc-foto");
    av.title = "Trocar foto";
    pontoStatus(av, estado.status);
    av.onclick = () => { fechar(); abrirFoto(); $("in-foto").click(); };

    // Recado: sempre aparece (vazio = convite para escrever).
    let rec = c.querySelector(".cp-recado");
    if (!rec) { rec = document.createElement("div"); rec.className = "cp-recado"; c.querySelector(".cp-corpo").append(rec); }
    rec.classList.add("mc-recado");
    if (!v.recado) { rec.classList.add("vazio"); rec.textContent = "+ escrever um recado"; }
    rec.title = "Clique para mudar o recado";
    rec.tabIndex = 0;
    rec.onclick = () => editarRecado(rec);
    rec.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); editarRecado(rec); } };

    const ops = document.createElement("div");
    ops.className = "mc-ops";
    const editar = linha(IC.lapis, "Editar perfil");
    editar.onclick = () => { fechar(); abrirFoto(); };
    const bol = document.createElement("span"); bol.className = "bolinha st-" + (STATUS[estado.status] ? estado.status : "on");
    // 3.0.6: Insígnias (só aparece se a pessoa tiver alguma)
    const todasIns = minhasInsignias();
    const escIns = ((perfilDe(estado.meuId) || {}).eh || []).map(String);
    let ins = null, subIns = null;
    if (todasIns.length) {
      const visiveis = todasIns.filter((e) => !escIns.includes(e.dataset.k)).length;
      ins = linha(IC.ins, "Insígnias", `${visiveis} de ${todasIns.length}`);
      ins.setAttribute("aria-haspopup", "true");
      ins.onclick = (e) => {
        e.stopPropagation();
        if (subIns) { subIns.remove(); subIns = null; ins.classList.remove("on"); subAberto = null; return; }
        if (sub) { sub.remove(); sub = null; st.classList.remove("on"); }
        subIns = menuInsignias(); ops.append(subIns); ins.classList.add("on"); subAberto = "ins";
      };
    }
    const st = linha("", (STATUS[estado.status] || STATUS.on).nome, "›");
    st.prepend(bol);
    st.setAttribute("aria-haspopup", "true");
    let sub = null;
    st.onclick = (e) => {
      e.stopPropagation();
      if (sub) { sub.remove(); sub = null; st.classList.remove("on"); return; }
      if (subIns) { subIns.remove(); subIns = null; ins.classList.remove("on"); subAberto = null; }
      sub = menuStatus(st); ops.append(sub); st.classList.add("on");
    };
    const nick = linha(IC.nick, "Mudar nick");
    nick.onclick = () => { fechar(); pedirNome(); };
    const saldo = document.createElement("b");
    saldo.className = "mc-doll";
    saldo.textContent = estado.moedas != null ? Number(estado.moedas).toLocaleString("pt-BR") : "...";
    const carteira = linha(IC.lua, "Carteira", saldo);
    carteira.classList.add("mc-info");
    carteira.title = "Seu saldo de AstraDoll";
    carteira.onclick = () => enviar({ t: "carteira" });
    const rehbet = linha(IC.lua, "Converter p/ rehbet");
    rehbet.title = "Transformar AstraDoll em coins da rehbet";
    rehbet.onclick = () => { fechar(); if (window.abrirRehbet) window.abrirRehbet(); };
    ops.append(editar, ...(ins ? [ins] : []), st, nick, carteira, rehbet);
    if (subAberto === "ins" && ins) { subIns = menuInsignias(); ops.append(subIns); ins.classList.add("on"); }

    caixa.append(...c.childNodes, dica, ops);
  }

  function posicionar() {
    if (!botao) return;
    const r = botao.getBoundingClientRect();
    const largura = caixa.offsetWidth, altura = caixa.offsetHeight;
    let x = r.right + 12;
    if (x + largura > innerWidth - 8) x = Math.max(8, innerWidth - largura - 8);
    const y = Math.max(8, Math.min(innerHeight - altura - 8, r.bottom - altura));
    caixa.style.left = x + "px";
    caixa.style.top = y + "px";
  }

  window.abrirMeuCartao = (alvo) => {
    if (aberto()) return fechar();
    if (!estado.meuId) return abrirFoto();   // ainda sem conta: abre o editor de sempre
    botao = alvo;
    desenhar();
    caixa.hidden = false;
    caixa.classList.remove("abrindo"); void caixa.offsetWidth; caixa.classList.add("abrindo");
    posicionar();
    alvo.setAttribute("aria-expanded", "true");
    enviar({ t: "carteira" });   // saldo fresquinho
  };
  // O saldo chegou: atualiza o número sem fechar nada.
  const pintarAntes = window.pintarCarteira;
  if (typeof pintarAntes === "function") {
    window.pintarCarteira = function (...a) {
      pintarAntes.apply(this, a);
      const b = caixa.querySelector(".mc-doll");
      if (b && estado.moedas != null) b.textContent = Number(estado.moedas).toLocaleString("pt-BR");
    };
  }

  document.addEventListener("pointerdown", (e) => {
    if (!aberto() || caixa.contains(e.target) || (botao && botao.contains(e.target))) return;
    fechar();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aberto()) fechar(); });
  addEventListener("resize", () => { if (aberto()) posicionar(); });
})();
