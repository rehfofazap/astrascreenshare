// Ponte entre a página (web/app.js, web/desktop.js) e o programa (Rust). Faz o papel do preload.js
// do Electron: cria o mesmo window.astra, com as mesmas funções, antes de qualquer script da página.
// O Rust põe na frente deste arquivo: window.__ASTRA_INICIO__ = { origem, servidor, site, versao, aparelho, semMouse }.
(function () {
  "use strict";
  const I = window.__ASTRA_INICIO__;
  try { delete window.__ASTRA_INICIO__; } catch (_) {}
  // Só a página do programa, no quadro principal (nada de iframes, minigames ou outros endereços).
  if (!I || window.top !== window || location.origin !== I.origem) return;

  const chamar = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args || {});
  const solto = (cmd, args) => { chamar(cmd, args).catch(() => {}); };
  const nucleo = () => window.__TAURI__ && window.__TAURI__.core;

  // ---------- avisos do programa para a página (um Channel só desta janela) ----------
  const ouvintes = {};
  let canal = null;
  function ligar() {
    if (canal || !nucleo()) return;
    canal = new (nucleo().Channel)();
    canal.onmessage = (m) => {
      const f = m && ouvintes[m.t];
      if (f) { try { f(m.v); } catch (e) { console.error("[astra]", e); } }
    };
    solto("ponte_eventos", { canal });
  }
  ligar();
  if (!canal) document.addEventListener("DOMContentLoaded", ligar, { once: true });
  const ouvir = (t) => (f) => { ouvintes[t] = typeof f === "function" ? f : null; ligar(); };

  let aoSom = null;

  // 3.0.16: arrastar a janela pelas barras marcadas com --arrastar: 1 no CSS (antes era -webkit-app-region,
  // que fazia o WebView2 criar ~200 janelinhas e recriá-las a cada mudança: a janela travava).
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    if (getComputedStyle(e.target).getPropertyValue("--arrastar").trim() !== "1") return;
    e.preventDefault();
    solto("janela", { acao: e.detail >= 2 ? "max" : "arrastar" });
  }, true);
  let somWs = null;   // 3.0.14: som pela conexão local (não passa pela linha principal da janela)
  function fecharSomWs() { if (somWs) { try { somWs.onmessage = null; somWs.close(); } catch (_) {} somWs = null; } }

  window.astra = Object.freeze({
    servidor: I.servidor,
    site: I.site,
    versao: I.versao,
    aparelho: I.aparelho,
    atualizar: () => chamar("atualizar"),
    aoProgressoAtualizacao: ouvir("atualizar"),
    usuario: "",
    aviso: (titulo, texto) => solto("aviso", { titulo: String(titulo || ""), texto: String(texto || "") }),
    // 3.0.20: cópia da conta fora do WebView2 (cifrada pelo Windows), para não perder a conta numa atualização
    lembrarConta: (id, chave) => solto("lembrar_conta", { id: String(id || ""), chave: String(chave || "") }),
    esquecerConta: () => solto("esquecer_conta"),
    transmitindo: (sim) => solto("transmitindo", { sim: !!sim }),
    relaxado: (sim) => solto("relaxado", { sim: !!sim }),
    acorde: (nome) => solto("acorde", { nome: String(nome || "") }),
    mostrar: () => solto("mostrar_janela"),
    janela: (acao) => solto("janela", { acao: String(acao) }),
    protegerTela: (sim) => solto("proteger_tela", { sim: !!sim }),
    gravadorNvidia: () => chamar("gravador_nvidia"),
    aoMaximizar: ouvir("max"),
    miniJanela: true,
    fecharMini: () => solto("fechar_mini"),   // 3.0.3: fecha a janela nativa da mini tela (não fica preta)
    popupChat: (m) => solto("popup_chat", { m: {
      nome: String(m.nome || ""), texto: String(m.texto || ""), cor: String(m.cor || ""),
      foto: String(m.foto || ""), imagem: String(m.imagem || ""), gif: !!m.gif, tipo: String(m.tipo || "") } }),
    listarFontes: () => chamar("listar_fontes"),
    definirFonte: (e) => chamar("definir_fonte", { id: String((e && e.id) || ""), som: String((e && e.som) || "") }),
    iniciarSom: async () => {
      fecharSomWs();
      const c = new (nucleo().Channel)();
      c.onmessage = (d) => { if (aoSom) aoSom(d instanceof Uint8Array ? d : new Uint8Array(d)); };
      const r = await chamar("som_iniciar", { canal: c });
      // Se a conexão local não abrir ou cair, o programa continua mandando pelo Channel acima.
      if (r && r.ok && r.porta && r.chave) {
        try {
          const ws = new WebSocket(`ws://127.0.0.1:${r.porta}/${r.chave}`);
          ws.binaryType = "arraybuffer";
          ws.onmessage = (e) => { if (aoSom && e.data instanceof ArrayBuffer) aoSom(new Uint8Array(e.data)); };
          ws.onclose = () => { if (somWs === ws) somWs = null; };
          somWs = ws;
        } catch (_) {}
      }
      return r && r.ok ? { ok: true, info: r.info || "" } : r;
    },
    pararSom: () => { fecharSomWs(); solto("som_parar"); },
    aoReceberSom: (cb) => { aoSom = typeof cb === "function" ? cb : null; },
    silencio: (sim) => solto("silencio", { sim: !!sim }),
    infoSilencio: () => chamar("info_silencio"),
    risco: (r) => solto("risco", { r }),
    teclaEmergencia: (acel) => chamar("tecla_emergencia", { acel: String(acel || "") }),
    aoEmergencia: ouvir("emergencia"),
    teclas: (sim) => solto("teclas", { sim: !!sim }),
    aoTeclas: ouvir("teclas"),
    semMouse: Object.freeze({ ligadoAgora: !!I.semMouse, salvar: (sim) => solto("sem_mouse_salvar", { sim: !!sim }) }),
    reiniciar: () => solto("reiniciar"),
    desempenho: (ligado) => solto("desempenho", { ligado: !!ligado }),
    aoDesempenho: ouvir("desempenho"),
    conferirModulo: (nome, texto, assinatura) =>
      chamar("conferir_modulo", { nome: String(nome || ""), texto: String(texto || ""), assinatura: String(assinatura || "") }),
    modulosAssinados: true,
  });

  // F11 liga e desliga a tela cheia (no Electron era o before-input-event).
  document.addEventListener("keydown", (e) => {
    if (e.key === "F11" && !e.repeat) { e.preventDefault(); solto("janela", { acao: "tela-cheia" }); }
  }, true);

  // ---------- transmitir a tela ----------
  // Quem captura é uma janelinha escondida do programa (num WebView2 próprio, que já nasce com a
  // fonte escolhida na janela "Transmitir tela"). Ela manda a imagem para cá por WebRTC dentro do
  // PC; esta página (a sala, a call) nunca recarrega. Para o app.js é o getDisplayMedia de sempre.
  const sinais = new Map();   // rótulo da janela de captura -> função que recebe as mensagens dela
  ouvintes.sinal = (v) => {
    const f = v && sinais.get(v.de);
    if (f) { try { f(JSON.parse(v.msg)); } catch (e) { console.error("[astra] sinal", e); } }
  };
  const juntarCandidatos = (pc) => new Promise((r) => {
    if (pc.iceGatheringState === "complete") return r();
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") r(); });
    setTimeout(r, 1500);
  });
  const limite = (x, padrao) => {
    if (typeof x === "number") return x;
    if (x && typeof x === "object") return Number(x.max || x.exact || x.ideal) || padrao;
    return padrao;
  };

  async function capturar(opcoes) {
    const v = (opcoes && typeof opcoes.video === "object" && opcoes.video) || {};
    const pedido = { largura: limite(v.width, 1920), altura: limite(v.height, 1080), qps: limite(v.frameRate, 60) };
    ligar();
    let info;
    try { info = await chamar("captura_iniciar", pedido); }
    catch (e) { throw new DOMException(String(e || "Nenhuma tela escolhida."), "NotAllowedError"); }
    return new Promise((ok, falha) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      let faixa = null, acabou = false;
      const fechar = () => {
        if (acabou) return;
        acabou = true;
        sinais.delete(info.rotulo);
        try { pc.close(); } catch (_) {}
        solto("captura_parar", { rotulo: info.rotulo });
      };
      const terminou = () => {   // a fonte fechou (ex.: a janela transmitida foi fechada)
        if (!faixa || acabou) return;
        fechar();
        faixa.dispatchEvent(new Event("ended"));
      };
      const tempo = setTimeout(() => { if (!faixa) { fechar(); falha(new DOMException("A captura não começou.", "AbortError")); } }, 15000);
      pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { if (faixa) terminou(); } };
      sinais.set(info.rotulo, async (m) => {
        if (m.erro) { clearTimeout(tempo); fechar(); if (!faixa) falha(new DOMException(m.erro, "NotAllowedError")); else terminou(); return; }
        if (m.fim) return terminou();
        if (m.sdp) {
          await pc.setRemoteDescription(m.sdp);
          await pc.setLocalDescription(await pc.createAnswer());
          await juntarCandidatos(pc);
          solto("sinal_principal", { msg: JSON.stringify({ sdp: pc.localDescription.toJSON() }) });
        }
      });
      pc.ontrack = (e) => {
        if (faixa) return;
        faixa = e.track;
        clearTimeout(tempo);
        // O app.js lê o tipo da fonte (tela/janela) e para a faixa com stop(): os dois vão para a captura.
        const ajustes = faixa.getSettings.bind(faixa);
        faixa.getSettings = () => Object.assign(ajustes(), { displaySurface: info.superficie });
        const parar = faixa.stop.bind(faixa);
        faixa.stop = () => { parar(); fechar(); };
        ok(new MediaStream([faixa]));
      };
    });
  }
  if (navigator.mediaDevices) {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: capturar, configurable: false, writable: false });
  }
})();
