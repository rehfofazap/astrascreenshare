// Aposta na sala: qualquer um cria (uma por vez), todo mundo aposta AstraDoll numa opção,
// quem criou fecha as apostas e o dono da sala escolhe quem ganhou. Quem acertou divide
// o bolo todo, na proporção do que apostou. O cartão fica fixo no topo do chat.
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
  const CORES = ["#5865f2", "#eb459e", "#23a55a", "#f0b232"];
  let atual = null;        // resumo que a VPS mandou
  let fimTimer = null;
  const escolha = { i: null, valor: 50, outro: false };   // o que a pessoa escolheu (sobrevive quando a VPS atualiza o cartão)

  // ---------- cartão no topo do chat ----------
  const card = document.createElement("div");
  card.id = "aposta-card";
  card.className = "aposta-card";
  card.hidden = true;
  $("chat-lista").before(card);

  // botão de criar, ao lado do GIF
  const btCriar = document.createElement("button");
  btCriar.type = "button";
  btCriar.className = "bt-icone bt-aposta";
  btCriar.title = "Criar uma aposta na sala";
  btCriar.setAttribute("aria-label", "Criar aposta");
  btCriar.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M4 19h16v2H4v-2Zm1-2V9h3v8H5Zm5.5 0V4h3v13h-3ZM16 17v-6h3v6h-3Z"/></svg>';
  $("bt-gif").after(btCriar);

  function souJuiz() { return atual && atual.juiz === estado.meuId; }
  function souCriador() { return atual && atual.criadorId === estado.meuId; }
  function minha() { return atual ? atual.apostas.find((x) => x.aid === estado.meuId) : null; }

  function desenhar() {
    clearTimeout(fimTimer);
    if (!atual) { card.hidden = true; card.textContent = ""; return; }
    const a = atual;
    const bolo = a.totais.reduce((s, x) => s + x, 0);
    const eu = minha();
    card.className = "aposta-card" + (a.aberta ? "" : " fechada");
    card.textContent = "";

    const topo = document.createElement("div");
    topo.className = "aposta-topo";
    const rot = document.createElement("span");
    rot.className = "aposta-rotulo";
    rot.textContent = a.aberta ? "Aposta aberta" : "Apostas fechadas";
    const pote = document.createElement("span");
    pote.className = "aposta-pote";
    pote.innerHTML = '<img src="astradoll.svg" alt=""><b></b>';
    pote.querySelector("b").textContent = fmt(bolo);
    pote.title = "Total apostado";
    topo.append(rot, pote);

    const perg = document.createElement("b");
    perg.className = "aposta-pergunta";
    perg.textContent = a.pergunta;
    const quem = document.createElement("small");
    quem.className = "aposta-quem";
    quem.textContent = `por ${a.criador}` + (a.aberta ? "" : souJuiz() ? " · escolha quem ganhou" : " · esperando o resultado");

    // 2.7.11 (jeito A): toca na opção, toca no valor, aperta o botão.
    const ops = document.createElement("div");
    ops.className = "aposta-opcoes";
    if (a.opcoes.length === 3) ops.classList.add("tres");
    const podeApostar = a.aberta;
    if (podeApostar && eu) escolha.i = eu.op;              // já apostou: só dá para colocar mais na mesma
    if (!podeApostar) escolha.i = null;
    a.opcoes.forEach((nome, i) => {
      const pct = bolo ? Math.round((a.totais[i] / bolo) * 100) : 0;
      const paga = a.totais[i] ? (bolo / a.totais[i]) : 0;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "aposta-op" + (eu && eu.op === i ? " minha" : "") + (escolha.i === i ? " sel" : "");
      b.style.setProperty("--cor", CORES[i % CORES.length]);
      b.innerHTML = '<b class="aposta-nome"></b><small class="aposta-info"></small>';
      b.querySelector(".aposta-nome").textContent = nome;
      b.querySelector(".aposta-info").textContent = `${pct}%` + (paga ? ` · paga ${paga.toFixed(paga < 10 ? 1 : 0).replace(".", ",")}x` : "");
      b.title = `${a.pessoas[i] || 0} pessoa(s) · ${fmt(a.totais[i])} AstraDoll`;
      if (podeApostar) {
        b.disabled = !!(eu && eu.op !== i);
        b.onclick = () => { escolha.i = i; desenhar(); };
      } else if (souJuiz()) {
        b.classList.add("escolher");
        b.title = "Escolher como vencedora";
        b.onclick = () => confirmarResultado(i, b);
      } else b.disabled = true;
      ops.append(b);
    });

    // valores rápidos + botão grande (só com a aposta aberta)
    let valorBox = null;
    if (podeApostar) {
      const minimo = eu ? 1 : 10;
      const teto = Math.max(0, Math.min(5000 - (eu ? eu.valor : 0), estado.moedas != null ? estado.moedas : 5000));
      const cor = escolha.i != null ? CORES[escolha.i % CORES.length] : "#3a3a44";
      valorBox = document.createElement("div");
      valorBox.className = "aposta-valor";
      valorBox.style.setProperty("--cor", cor);
      const chips = document.createElement("div");
      chips.className = "aposta-chips";
      for (const v of [10, 50, 100, 500]) {
        const c = document.createElement("button");
        c.type = "button"; c.textContent = fmt(v);
        c.className = escolha.valor === v && !escolha.outro ? "sel" : "";
        c.disabled = v > teto;
        c.onclick = () => { escolha.valor = v; escolha.outro = false; desenhar(); };
        chips.append(c);
      }
      valorBox.append(chips);
      if (escolha.outro) {
        const campo = document.createElement("input");
        campo.inputMode = "numeric"; campo.className = "aposta-outro"; campo.placeholder = `Quanto? (máx. ${fmt(teto)})`;
        campo.value = escolha.valor ? String(escolha.valor) : "";
        campo.oninput = () => { escolha.valor = Math.min(teto, Number(campo.value.replace(/\D/g, "")) || 0); pintarOk(); };
        campo.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } };
        valorBox.append(campo);
        setTimeout(() => { if (campo.isConnected && document.activeElement !== campo) campo.focus(); }, 0);
      }
      const ok = document.createElement("button");
      ok.type = "button"; ok.className = "aposta-ok";
      function pintarOk() {
        const v = escolha.valor || 0;
        if (escolha.i == null) { ok.disabled = true; ok.textContent = "Escolha uma opção"; return; }
        if (teto < minimo) { ok.disabled = true; ok.textContent = "Sem AstraDoll suficiente"; return; }
        if (v < minimo) { ok.disabled = true; ok.textContent = `Mínimo ${fmt(minimo)}`; return; }
        ok.disabled = v > teto;
        ok.textContent = `${eu ? "Colocar mais" : "Apostar"} ${fmt(v)} em ${a.opcoes[escolha.i]}`;
      }
      pintarOk();
      ok.onclick = () => {
        if (ok.disabled) return;
        enviar({ t: "aposta", acao: "apostar", op: escolha.i, valor: Math.floor(escolha.valor) });
        escolha.outro = false;
      };
      const outro = document.createElement("button");
      outro.type = "button"; outro.className = "aposta-link";
      outro.textContent = escolha.outro ? "Voltar aos valores prontos" : "Outro valor";
      outro.onclick = () => { escolha.outro = !escolha.outro; if (!escolha.outro && ![10, 50, 100, 500].includes(escolha.valor)) escolha.valor = 50; desenhar(); };
      valorBox.append(ok, outro);
    }

    const pe = document.createElement("div");
    pe.className = "aposta-pe";
    const meuTxt = document.createElement("small");
    meuTxt.textContent = eu ? `Você apostou ${fmt(eu.valor)} em ${a.opcoes[eu.op]}` : "";
    pe.append(meuTxt);
    const bts = document.createElement("span");
    bts.className = "aposta-bts";
    if (a.aberta && (souCriador() || souJuiz())) bts.append(botao("Fechar apostas", () => enviar({ t: "aposta", acao: "fechar" })));
    if (souCriador() || souJuiz()) bts.append(botao("Cancelar", (bt) => {
      if (bt.dataset.certeza) return enviar({ t: "aposta", acao: "cancelar" });
      bt.dataset.certeza = "1"; bt.textContent = "Devolver tudo?";
      setTimeout(() => { if (bt.isConnected) { delete bt.dataset.certeza; bt.textContent = "Cancelar"; } }, 3000);
    }, "perigo"));
    pe.append(bts);

    card.append(topo, perg, quem, ops);
    if (valorBox) card.append(valorBox);
    card.append(pe);
    card.hidden = false;
  }

  function botao(texto, fn, classe = "") {
    const b = document.createElement("button");
    b.type = "button"; b.className = "aposta-bt " + classe; b.textContent = texto;
    b.onclick = () => fn(b);
    return b;
  }

  function confirmarResultado(i, b) {
    if (b.dataset.certeza) return enviar({ t: "aposta", acao: "resultado", op: i });
    card.querySelectorAll(".aposta-op").forEach((o) => { delete o.dataset.certeza; o.classList.remove("certeza"); });
    b.dataset.certeza = "1"; b.classList.add("certeza");
    b.querySelector(".aposta-info").textContent = "Clique de novo: essa ganhou";
    setTimeout(() => { if (b.isConnected && b.dataset.certeza) desenhar(); }, 3500);
  }

  // ---------- chuva de moedinhas (leve: poucas moedas, só transform/opacity, some sozinha) ----------
  function chuvaDeMoedas(qtd = 22) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const camada = document.createElement("div");
    camada.className = "chuva-moedas";
    camada.setAttribute("aria-hidden", "true");
    let fim = 0;
    for (let i = 0; i < qtd; i++) {
      const m = document.createElement("img");
      m.src = "astradoll.svg"; m.alt = "";
      const tam = 16 + Math.random() * 18;
      const dur = 1.6 + Math.random() * 1.2, atraso = Math.random() * 0.9;
      fim = Math.max(fim, dur + atraso);
      m.style.cssText = `left:${Math.random() * 100}%;width:${tam}px;height:${tam}px;` +
        `--x:${(Math.random() - .5) * 120}px;--giro:${(Math.random() - .5) * 720}deg;` +
        `animation-duration:${dur}s;animation-delay:${atraso}s;opacity:${.75 + Math.random() * .25}`;
      camada.append(m);
    }
    document.body.append(camada);
    setTimeout(() => camada.remove(), (fim + .2) * 1000);
  }
  window.chuvaDeMoedas = chuvaDeMoedas;

  // ---------- resultado ----------
  function mostrarFim(m) {
    atual = null;
    card.className = "aposta-card fim";
    card.textContent = "";
    const rot = document.createElement("span");
    rot.className = "aposta-rotulo";
    rot.textContent = m.devolvida ? "Aposta encerrada" : "Resultado";
    const perg = document.createElement("small");
    perg.className = "aposta-quem";
    perg.textContent = m.pergunta;
    const res = document.createElement("b");
    res.className = "aposta-resultado";
    res.textContent = m.devolvida ? (m.motivo === "cancelada" ? "Cancelada: todo mundo recebeu de volta" : "Ninguém acertou: todo mundo recebeu de volta")
      : `Deu ${m.opcoes[m.vencedora]}!`;
    card.append(rot, perg, res);
    const eu = (m.ganhadores || []).find((g) => g.aid === estado.meuId);
    if (eu) {
      const g = document.createElement("div");
      g.className = "aposta-ganhei";
      g.innerHTML = '<img src="astradoll.svg" alt=""><span></span>';
      g.querySelector("span").textContent = `Você ganhou ${fmt(eu.ganhou)} AstraDoll`;
      card.append(g);
      if (typeof tocarPlim === "function") tocarPlim();
      chuvaDeMoedas();
    }
    if (!m.devolvida && m.ganhadores && m.ganhadores.length) {
      const l = document.createElement("small");
      l.className = "aposta-ganhadores";
      l.textContent = m.ganhadores.slice(0, 5).map((g) => `${g.nome} +${fmt(g.ganhou)}`).join(" · ") + (m.ganhadores.length > 5 ? ` e mais ${m.ganhadores.length - 5}` : "");
      card.append(l);
    }
    card.hidden = false;
    clearTimeout(fimTimer);
    fimTimer = setTimeout(() => { if (!atual) { card.hidden = true; card.textContent = ""; } }, 12000);
  }

  // ---------- criar ----------
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "modal-aposta";
  modal.hidden = true;
  modal.innerHTML = `<form class="modal-caixa pequena aposta-form">
      <h2>Nova aposta</h2>
      <p class="sub">Todo mundo da sala aposta AstraDoll. O dono da sala escolhe quem ganhou e quem acertou divide o bolo.</p>
      <input name="pergunta" maxlength="80" placeholder="Pergunta (ex.: Ele ganha essa partida?)" autocomplete="off" required>
      <div class="aposta-campos"></div>
      <button type="button" class="aposta-mais">+ Opção</button>
      <p class="sub aposta-msg" role="status"></p>
      <div class="aposta-acoes"><button type="button" class="bt secundario aposta-fechar">Cancelar</button><button type="submit" class="bt primario">Abrir aposta</button></div>
    </form>`;
  document.body.append(modal);
  const form = modal.querySelector("form");
  const campos = modal.querySelector(".aposta-campos");
  function campoOpcao(valor = "") {
    const i = campos.children.length;
    const c = document.createElement("input");
    c.maxLength = 30; c.placeholder = `Opção ${i + 1}`; c.autocomplete = "off"; c.value = valor;
    c.style.setProperty("--cor", CORES[i % CORES.length]);
    campos.append(c);
    modal.querySelector(".aposta-mais").hidden = campos.children.length >= 4;
    return c;
  }
  function abrirCriar() {
    if (atual) { aviso({ titulo: "Já tem uma aposta rolando", texto: "Espere ela acabar para criar outra.", tempo: 3000 }); return; }
    form.reset(); campos.textContent = ""; campoOpcao("Sim"); campoOpcao("Não");
    modal.querySelector(".aposta-msg").textContent = "";
    modal.hidden = false;
    form.pergunta.focus();
  }
  btCriar.onclick = abrirCriar;
  modal.querySelector(".aposta-mais").onclick = () => campoOpcao().focus();
  modal.querySelector(".aposta-fechar").onclick = () => { modal.hidden = true; };
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  form.onsubmit = (e) => {
    e.preventDefault();
    const opcoes = [...campos.children].map((c) => c.value.trim()).filter(Boolean);
    if (opcoes.length < 2) { modal.querySelector(".aposta-msg").textContent = "Escreva pelo menos 2 opções."; return; }
    enviar({ t: "aposta", acao: "criar", pergunta: form.pergunta.value.trim(), opcoes });
    modal.hidden = true;
  };

  // ---------- mensagens da VPS ----------
  function novaAposta(nova) {
    const chave = (x) => x ? x.criadorId + "|" + x.pergunta + "|" + x.opcoes.join("|") : "";
    if (chave(nova) !== chave(atual)) { escolha.i = null; escolha.valor = 50; escolha.outro = false; }
    atual = nova;
  }
  TRATAR.aposta = (m) => { novaAposta(m.aposta); desenhar(); };
  TRATAR["aposta-fim"] = mostrarFim;
  TRATAR["aposta-erro"] = (m) => aviso({ titulo: m.msg, tempo: 3500 });
  const bemvindo = TRATAR.bemvindo;
  TRATAR.bemvindo = (m) => { bemvindo(m); novaAposta(m.aposta || null); desenhar(); };
})();
