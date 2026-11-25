// Tela de carregamento da Astra.
// A porcentagem vem de etapas REAIS da inicialização (nada de número sorteado):
//   arquivos (scripts, fonte e imagem)  0 → 20 %   (cada um que termina soma a sua parte)
//   identidade (ID e nome do aparelho)        30 %
//   conexão (WebSocket aberto)                55 %
//   conta (servidor respondeu "pronto")       80 %
//   dados (lista de pessoas e salas chegou)  100 %
// Entre uma etapa e outra não há como saber o quanto falta: a barra para onde está e mostra
// uma luz "indeterminada" na parte vazia. Ao chegar a 100 % some com um fade.
// Os números de usuários vêm do servidor (/estatisticas), atualizados enquanto a tela está aberta.
(() => {
  const el = document.getElementById("abertura");
  if (!el) return;
  const $ = (id) => document.getElementById(id);
  const calmo = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const base = window.astra && window.astra.site ? window.astra.site.replace(/\/?$/, "/") : "./";

  const ETAPA = { identidade: 30, conexao: 55, conta: 80, dados: 100 };
  const NOMES = { 0: "Carregando arquivos", 30: "Preparando sua identidade", 55: "Conectando ao servidor",
                  80: "Entrando na sua conta", 100: "Carregando salas e pessoas" };
  let alvo = 0, mostrado = 0, acabou = false, saiu = false;
  const inicioAbertura = performance.now();

  // ---------- desenho da barra (anda suave até o alvo real, nunca passa dele) ----------
  const enche = $("ab-enche"), pct = $("ab-pct"), barra = $("ab-barra");
  function desenhar(v) {
    const n = Math.floor(v);
    enche.style.width = v + "%";
    el.style.setProperty("--ab-cheio", v + "%");
    pct.textContent = n + "%";
    barra.setAttribute("aria-valuenow", String(n));
  }
  // Anda pelo tempo que passou (não por quadro): o requestAnimationFrame deixa suave, e um relógio
  // de reserva garante que a barra chega lá mesmo se o navegador pausar os quadros (aba escondida).
  let ultimo = performance.now();
  function passo() {
    const agora = performance.now();
    const dt = Math.min(250, agora - ultimo); ultimo = agora;
    if (mostrado < alvo) {
      mostrado = calmo || document.hidden ? alvo
        : Math.min(alvo, mostrado + Math.max(.05 * dt, (alvo - mostrado) * (1 - Math.pow(.88, dt / 16))));
    }
    desenhar(mostrado);
    el.classList.toggle("esperando", !acabou && mostrado >= alvo - .01 && !el.classList.contains("com-erro"));
    if (acabou && mostrado >= 100) sair();
  }
  function quadro() { if (saiu) return; passo(); requestAnimationFrame(quadro); }
  requestAnimationFrame(quadro);
  const reserva = setInterval(() => { if (saiu) clearInterval(reserva); else passo(); }, 120);

  function chegar(valor) {
    if (valor <= alvo) return;
    alvo = valor;
    const nome = NOMES[Object.keys(NOMES).map(Number).filter((k) => k <= alvo).pop()] || "";
    $("ab-etapa-sr").textContent = alvo >= 100 ? "Pronto" : nome;
    if (alvo >= 100) { acabou = true; tirarErro(); }
  }

  // v5: a tela fica pelo menos MINIMO ms (com conexão rápida ela sumia antes de dar para ver).
  // A barra continua real: chega a 100 % quando tudo carregou e só a saída espera o tempo mínimo.
  const MINIMO = calmo ? 600 : 2400;
  function sair() {
    if (saiu) return;
    saiu = true;
    clearInterval(vigia); clearInterval(timerStats);
    el.setAttribute("aria-busy", "false");
    $("ab-etapa").textContent = "Pronto";
    const falta = Math.max(0, MINIMO - (performance.now() - inicioAbertura));
    setTimeout(() => {
      el.classList.add("saindo");
      setTimeout(() => el.remove(), calmo ? 50 : 750);
    }, falta + (calmo ? 0 : 280));
  }

  // ---------- etapa 1: arquivos (fonte, imagem e cada script do app, um por um) ----------
  const TOTAL_SCRIPTS = Math.max(1, Number(el.dataset.scripts) || 1);
  const partes = { scripts: false, fonte: false, imagem: false };
  let scriptsProntos = 0;
  function contarArquivos() {
    const feitas = (partes.fonte ? 1 : 0) + (partes.imagem ? 1 : 0) +
                   (partes.scripts ? TOTAL_SCRIPTS : Math.min(scriptsProntos, TOTAL_SCRIPTS));
    chegar(Math.floor(20 * feitas / (TOTAL_SCRIPTS + 2)));
  }
  function parte(nome) {
    if (partes[nome]) return;
    partes[nome] = true;
    contarArquivos();
  }
  // "load"/"error" de cada <script src> (não sobem na árvore, mas passam pela captura no document)
  const scriptTerminou = (e) => {
    if (e.target && e.target.tagName === "SCRIPT" && e.target.src && !/\/abertura\.js/.test(e.target.src) && !partes.scripts) {
      scriptsProntos++;
      contarArquivos();
    }
  };
  document.addEventListener("load", scriptTerminou, true);
  document.addEventListener("error", scriptTerminou, true);
  const img = $("ab-fundo-img");
  const fundoPronto = () => { img.parentElement.classList.add("pronto"); parte("imagem"); };
  if (img.complete && img.naturalWidth) fundoPronto();
  else { img.addEventListener("load", fundoPronto, { once: true }); img.addEventListener("error", () => parte("imagem"), { once: true }); }
  if (document.fonts && document.fonts.load) document.fonts.load('italic 500 64px "Astra Marca"').then(() => parte("fonte"), () => parte("fonte"));
  else parte("fonte");

  // ---------- erro discreto + tentar de novo ----------
  let erroDesde = 0;
  function mostrarErro(texto) {
    if (acabou) return;
    $("ab-erro-txt").textContent = texto;
    $("ab-erro").hidden = false;
    el.classList.add("com-erro");
    $("ab-etapa").textContent = "Não foi possível carregar";
  }
  function tirarErro() {
    $("ab-erro").hidden = true;
    el.classList.remove("com-erro");
    $("ab-etapa").textContent = "Carregando Astra...";
  }
  $("ab-tentar").addEventListener("click", () => {
    tirarErro();
    erroDesde = Date.now();
    quedas = 0;
    if (typeof conectar !== "function" || typeof estado === "undefined") { location.reload(); return; }
    estado.tentativas = 0;
    clearTimeout(estado.timerConectar);
    if (!estado.ws || estado.ws.readyState > 1) conectar();
  });

  // ---------- etapas 2 a 5: ligadas ao app (depois que todos os scripts rodaram) ----------
  let vigia = 0, quedas = 0, wsVisto = null;
  const fechadas = new WeakSet();
  document.addEventListener("DOMContentLoaded", () => {
    if (scriptsProntos !== TOTAL_SCRIPTS) console.warn(`abertura: data-scripts=${TOTAL_SCRIPTS}, mas carregaram ${scriptsProntos} (atualize o index.html)`);
    parte("scripts");
    document.removeEventListener("load", scriptTerminou, true);
    document.removeEventListener("error", scriptTerminou, true);
    if (typeof estado === "undefined" || typeof TRATAR === "undefined") {
      mostrarErro("A Astra não conseguiu iniciar neste navegador.");
      return;
    }
    if (estado.meuId) chegar(ETAPA.identidade);
    // Sem nome ainda: a próxima tela é escolher o nick (não há conexão para esperar).
    if (!estado.nome) { chegar(100); return; }

    // a lista de pessoas e salas chegou: a Astra está pronta para usar
    const online = TRATAR.online;
    TRATAR.online = function (m) { const r = online.call(this, m); chegar(ETAPA.dados); return r; };
    // a conta precisa de atenção (senha / aberta em outro lugar): mostra a Astra com o aviso dela
    for (const t of ["conta-protegida", "em-outro-lugar", "substituido"]) {
      const original = TRATAR[t];
      if (original) TRATAR[t] = function (m) { const r = original.call(this, m); chegar(100); return r; };
    }

    erroDesde = Date.now();
    vigia = setInterval(() => {
      // Quedas: conta cada conexão que fechou antes da conta entrar. Uma conexão recusada fecha em
      // milissegundos (antes desta volta), então conta também pela troca e pelo estado "fechado".
      const ws = estado.ws;
      if (ws && ws !== wsVisto) {
        if (wsVisto && !fechadas.has(wsVisto)) { fechadas.add(wsVisto); quedas++; }
        wsVisto = ws;
        ws.addEventListener("close", () => { if (!acabou && !fechadas.has(ws)) { fechadas.add(ws); quedas++; } });
      }
      if (ws && ws.readyState === 3 && !fechadas.has(ws) && !estado.conexao) { fechadas.add(ws); quedas++; }
      if (ws && ws.readyState === 1) chegar(ETAPA.conexao);
      if (estado.conexao) chegar(ETAPA.conta);
      // começa como [] (vazio): só vale quando a lista do servidor chegou (eu mesmo estou nela)
      if (estado.conexao && Array.isArray(estado.online) && estado.online.length) chegar(ETAPA.dados);
      if (acabou) return;
      // Sem internet, servidor fora ou demorando demais: avisa (o app continua tentando sozinho).
      const parado = Date.now() - erroDesde;
      if (!navigator.onLine) mostrarErro("Sem conexão com a internet.");
      else if (quedas >= 2 || (alvo < ETAPA.conexao && parado > 8000)) mostrarErro("Não consegui conectar ao servidor.");
      else if (parado > 15000) mostrarErro("O servidor está demorando para responder.");
      else if (el.classList.contains("com-erro") && ws && ws.readyState === 1 && navigator.onLine) tirarErro();
    }, 200);
  });

  // ---------- estatísticas reais ----------
  const fmt = new Intl.NumberFormat("pt-BR");
  const nOnline = $("ab-online"), nTotal = $("ab-total");
  for (const n of [nOnline, nTotal]) n.classList.add("vazio");
  let timerStats = 0;
  async function buscarStats() {
    try {
      const ctrl = new AbortController();
      const corta = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(base + "estatisticas", { cache: "no-store", signal: ctrl.signal });
      clearTimeout(corta);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      if (!Number.isFinite(d.online) || !Number.isFinite(d.usuarios)) throw new Error("resposta inválida");
      for (const [n, v] of [[nOnline, d.online], [nTotal, d.usuarios]]) {
        n.classList.remove("vazio", "falhou");
        n.textContent = fmt.format(v);
        n.removeAttribute("title");
      }
      $("ab-online-txt").textContent = d.online === 1 ? "usuário online" : "usuários online";
    } catch (_) {
      // Sem número inventado: mostra um traço e tenta de novo na próxima volta.
      for (const n of [nOnline, nTotal]) {
        if (n.classList.contains("vazio") || n.classList.contains("falhou")) {
          n.classList.remove("vazio"); n.classList.add("falhou"); n.textContent = "—";
          n.title = "Não foi possível carregar agora";
        }
      }
    }
  }
  buscarStats();
  timerStats = setInterval(() => { if (!document.hidden) buscarStats(); }, 4000);
  window.addEventListener("online", buscarStats);
})();
