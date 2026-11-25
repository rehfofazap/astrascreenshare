// 3.0.2: "Falar com o suporte" — chat com a equipe do Astra (respondem pelo painel astrascreenshare.com/admin).
(() => {
  "use strict";
  if (typeof TRATAR === "undefined") return;
  const $id = (i) => document.getElementById(i);
  const ICONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9.5 8.5a2.5 2.5 0 0 1 4.6 1.3c0 1.7-2.1 2-2.1 3.2"/><path d="M12 15.5h.01"/></svg>';
  let aberta = false, naoLidas = 0;

  // ---- botão na barra da esquerda (ao lado de "Sugestões") ----
  const ref = $id("trilho-sugestao");
  const bt = document.createElement("button");
  bt.type = "button"; bt.id = "trilho-suporte"; bt.className = "trilho-bt trilho-tema";
  bt.setAttribute("aria-label", "Falar com o suporte"); bt.dataset.rotulo = "Suporte"; bt.title = "Falar com a equipe do Astra";
  bt.innerHTML = ICONE + '<span>Suporte</span><b class="trilho-contador" id="trilho-sup" hidden></b>';
  if (ref) ref.before(bt); else document.body.append(bt);

  // ---- janela ----
  const jan = document.createElement("section");
  jan.id = "sup-janela"; jan.className = "sup-janela"; jan.hidden = true;
  jan.setAttribute("role", "dialog"); jan.setAttribute("aria-label", "Suporte do Astra");
  jan.innerHTML = `
    <header class="sup-topo">
      <div class="sup-marca">${ICONE}</div>
      <div class="sup-tit"><b>Suporte do Astra</b><small id="sup-estado">Fale com a equipe</small></div>
      <button type="button" class="sup-x" id="sup-fechar" aria-label="Fechar">✕</button>
    </header>
    <div class="sup-msgs" id="sup-msgs"></div>
    <p class="sup-erro" id="sup-erro" role="alert"></p>
    <form class="sup-form" id="sup-form">
      <textarea id="sup-texto" rows="1" maxlength="1000" placeholder="Escreva a sua mensagem…"></textarea>
      <button type="submit" aria-label="Enviar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button>
    </form>`;
  document.body.append(jan);
  const caixa = $id("sup-msgs"), txt = $id("sup-texto");

  function abrir() {
    aberta = true; jan.hidden = false;
    enviar({ t: "sup-ver" });
    enviar({ t: "sup-lido" });
    marcar(0);
    setTimeout(() => txt.focus(), 30);
  }
  function fechar() { aberta = false; jan.hidden = true; }
  bt.onclick = () => (aberta ? fechar() : abrir());
  $id("sup-fechar").onclick = fechar;
  jan.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
  txt.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $id("sup-form").requestSubmit(); } });
  txt.addEventListener("input", () => { txt.style.height = "auto"; txt.style.height = Math.min(120, txt.scrollHeight) + "px"; });
  $id("sup-form").onsubmit = (e) => {
    e.preventDefault();
    const t = txt.value.trim();
    if (!t) return;
    if (!estado.ws || estado.ws.readyState !== 1) { $id("sup-erro").textContent = "Sem conexão agora. Tente de novo em instantes."; return; }
    enviar({ t: "sup-enviar", texto: t });
    txt.value = ""; txt.style.height = "";
    $id("sup-erro").textContent = "";
  };

  function marcar(n) {
    naoLidas = n;
    const b = $id("trilho-sup");
    b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n);
  }
  const hora = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const NOME_PAPEL = { dono: "Dono", moderador: "Moderador", suporte: "Suporte" };

  function boasVindas() {
    const d = document.createElement("div");
    d.className = "sup-boas";
    d.innerHTML = "<b>Oi! 👋</b><span></span>";
    d.querySelector("span").textContent = "Conte o que aconteceu (bug, conta, denúncia, dúvida). A equipe responde por aqui, e você recebe um aviso quando responderem.";
    return d;
  }
  function desenhar(m) {
    const tk = m.ticket;
    $id("sup-estado").textContent = !tk ? "Fale com a equipe"
      : tk.estado === "fechado" ? "Atendimento encerrado · mande uma mensagem para abrir outro"
      : tk.atendente ? `${tk.atendente} está atendendo você` : "Esperando alguém da equipe…";
    const lista = m.msgs || [];
    caixa.innerHTML = "";
    if (!lista.length) { caixa.append(boasVindas()); return; }
    for (const x of lista) {
      const d = document.createElement("div");
      d.className = "sup-msg " + (x.de === "user" ? "eu" : x.de);
      const bolha = document.createElement("div");
      bolha.className = "sup-bolha";
      bolha.textContent = x.texto;
      d.append(bolha);
      if (x.de === "codigo") {
        const cod = (x.texto.match(/:\s*([A-Z0-9-]{16,40})/) || [])[1];
        if (cod && window.astraConta) {
          const usar = document.createElement("button");
          usar.type = "button"; usar.className = "sup-usar"; usar.textContent = "Usar este código";
          usar.onclick = () => { fechar(); window.astraConta.abrir("usar"); const i = $id("conta-in"); if (i) i.value = cod; };
          d.append(usar);
        }
      }
      const meta = document.createElement("small");
      meta.textContent = (x.de === "equipe" || x.de === "codigo") ? `${x.autor || "Equipe"} · ${NOME_PAPEL[x.papel] || "Equipe"} · ${hora(x.em)}`
        : x.de === "sistema" ? hora(x.em) : hora(x.em);
      if (x.de !== "sistema") d.append(meta);
      caixa.append(d);
    }
    caixa.scrollTop = caixa.scrollHeight;
  }

  TRATAR.sup = (m) => {
    desenhar(m);
    if (aberta) { if (m.naoLidas) enviar({ t: "sup-lido" }); return; }
    if (m.naoLidas && m.naoLidas > naoLidas) {
      aviso({ titulo: "A equipe do Astra respondeu", texto: "Clique para ver a resposta do suporte.", tempo: 10000, aoClicar: abrir });
    }
    marcar(m.naoLidas || 0);
  };
  TRATAR["sup-erro"] = (m) => { $id("sup-erro").textContent = m.msg || ""; };

  // ao conectar: vê se tem resposta nova esperando
  const prontoAntes = TRATAR.pronto;
  TRATAR.pronto = function (m) {
    prontoAntes.call(this, m);
    setTimeout(() => enviar({ t: "sup-ver" }), 1500);
  };
  if (estado.conexao) setTimeout(() => enviar({ t: "sup-ver" }), 1500);
  window.astraSuporte = { abrir };
})();
