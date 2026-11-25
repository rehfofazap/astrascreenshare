// Caixa de correio (envelope no topo). Desde a 2.7.23 junta duas coisas:
// - Novidades (patch notes) que o dono publica pela página /relatos: a mais nova aparece aberta,
//   as antigas fechadas. Bolinha vermelha até a pessoa abrir a caixa; abriu = leu, a bolinha some.
// - Pergunta do larpinho: todo mundo responde aqui (bolinha enquanto você não respondeu).
(() => {
  const $ = (id) => document.getElementById(id);
  const bt = $("bt-correio"), caixa = $("correio-caixa"), campo = $("correio-texto"), msg = $("correio-msg");
  const lista = $("cx-lista"), perg = $("cx-pergunta");
  let atual = null;          // pergunta do dono
  let novidades = [];        // da mais velha para a mais nova (como vem da VPS)

  function quando(seg) {
    if (!seg) return "";
    const d = new Date(seg * 1000);
    return new Date().toDateString() === d.toDateString()
      ? "hoje às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }
  const vistas = () => new Set(ler("astra.novidadesVistas").split(",").filter(Boolean));
  const naoLidas = () => { const v = vistas(); return novidades.filter((n) => !v.has(n.id)); };

  function marcarLidas() {
    const v = ler("astra.novidadesVistas").split(",").filter(Boolean);
    for (const n of novidades) if (!v.includes(n.id)) v.push(n.id);
    guardar("astra.novidadesVistas", v.slice(-60).join(","));
    pintarPonto();
  }

  function pintarPonto() {
    const falta = naoLidas().length > 0 || (atual && !atual.minha);
    $("correio-ponto").hidden = !falta;
    bt.hidden = !atual && !novidades.length;
    if (bt.hidden) caixa.hidden = true;
  }

  // Texto da novidade: cada linha que começa com "-" ou "•" vira um item da lista.
  function corpoNovidade(texto) {
    const linhas = String(texto || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const frag = document.createDocumentFragment();
    let ul = null;
    for (const l of linhas) {
      const item = /^[-•*]\s*/.test(l);
      if (item) {
        if (!ul) { ul = document.createElement("ul"); ul.className = "cx-txt"; frag.append(ul); }
        const li = document.createElement("li"); textoComBandeiras(li, l.replace(/^[-•*]\s*/, "")); ul.append(li);
      } else {
        ul = null;
        const p = document.createElement("p"); p.className = "cx-par"; textoComBandeiras(p, l); frag.append(p);
      }
    }
    return frag;
  }

  function desenharNovidades() {
    const v = vistas();
    lista.innerHTML = "";
    const ordem = novidades.slice().reverse();
    ordem.forEach((n, i) => {
      const d = document.createElement("div");
      d.className = "cx-item" + (v.has(n.id) ? "" : " nova") + (i === 0 ? "" : " fechada");
      const tit = document.createElement("button");
      tit.type = "button"; tit.className = "cx-tit";
      const nome = document.createElement("span");
      nome.textContent = n.titulo || "Atualização";
      const tag = document.createElement("span"); tag.className = "cx-tag"; tag.textContent = "novidade";
      nome.append(tag);
      const q = document.createElement("small"); q.textContent = quando(n.quando);
      tit.append(nome, q);
      tit.onclick = () => d.classList.toggle("fechada");
      const corpo = document.createElement("div"); corpo.className = "cx-corpo";
      corpo.append(corpoNovidade(n.texto));
      if (n.por) { const s = document.createElement("small"); s.className = "cx-por"; s.textContent = `Feito a pedido de ${n.por}`; corpo.append(s); }
      d.append(tit, corpo);
      lista.append(d);
    });
    $("cx-sep").hidden = !(novidades.length && atual);
  }

  function mostrar(c, novo) {
    atual = c || null;
    perg.hidden = !atual;
    if (atual) {
      $("correio-pergunta").textContent = atual.texto;
      $("correio-de").textContent = quando(atual.quando);
      $("correio-enviar").textContent = atual.minha ? "Trocar resposta" : "Responder";
      perg.classList.toggle("nova", !atual.minha);
      if (document.activeElement !== campo) campo.value = atual.minha || "";
      msg.textContent = atual.minha ? "Você já respondeu. Valeu!" : "";
      // sem novidades, a pergunta já aparece aberta
      if (!novidades.length || !atual.minha) perg.classList.remove("fechada");
    }
    $("cx-sep").hidden = !(novidades.length && atual);
    pintarPonto();
    if (novo) { bt.classList.remove("chegou"); void bt.offsetWidth; bt.classList.add("chegou"); }
  }

  window.correioNovidades = (itens) => {
    const antes = naoLidas().length;
    novidades = (itens || []).filter((n) => n && n.id);
    desenharNovidades();
    pintarPonto();
    if (naoLidas().length > antes) { bt.classList.remove("chegou"); void bt.offsetWidth; bt.classList.add("chegou"); }
  };

  bt.addEventListener("click", (ev) => {
    ev.stopPropagation();
    caixa.hidden = !caixa.hidden;
    if (caixa.hidden) return;
    desenharNovidades();   // mostra as bolinhas das que eram novas nesta abertura
    // abre logo embaixo do envelope, alinhada pela direita dele
    const barra = bt.offsetParent;
    const direita = barra ? barra.clientWidth - (bt.offsetLeft + bt.offsetWidth) : 0;
    caixa.style.right = Math.max(8, direita - 8) + "px";
    marcarLidas();         // abriu = leu: a bolinha do envelope some
    if (atual && !perg.classList.contains("fechada") && !novidades.length) campo.focus();
  });
  $("cx-pergunta-abre").addEventListener("click", () => {
    perg.classList.toggle("fechada");
    if (!perg.classList.contains("fechada")) campo.focus();
  });
  document.addEventListener("click", (ev) => { if (!caixa.hidden && !caixa.contains(ev.target) && ev.target !== bt) caixa.hidden = true; });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !caixa.hidden) caixa.hidden = true; });
  $("correio-enviar").addEventListener("click", () => {
    const t = campo.value.trim();
    if (!t || !atual) return campo.focus();
    $("correio-enviar").disabled = true;
    msg.textContent = "Enviando...";
    enviar({ t: "correio", id: atual.id, texto: t });
  });
  campo.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) $("correio-enviar").click(); });

  TRATAR.correio = (m) => mostrar(m.correio, m.novo);
  TRATAR["correio-ok"] = (m) => {
    $("correio-enviar").disabled = false;
    if (!m.ok) { msg.textContent = m.msg || "Não deu para enviar."; return; }
    atual.minha = campo.value.trim();
    mostrar(atual);
    msg.textContent = "Resposta enviada. Valeu!";
    setTimeout(() => { caixa.hidden = true; }, 1400);
  };
  const pronto = TRATAR.pronto;
  TRATAR.pronto = (m) => { pronto(m); mostrar(m.correio); };
})();
