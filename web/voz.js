// Voz nas salas, estilo Discord. O áudio vai direto entre as pessoas (WebRTC em malha, até 10);
// o servidor só diz quem está na voz e repassa o "sinal". Usa os globais do app.js: estado, enviar, aviso, TRATAR.
//
// O que tem: detecção de voz com sensibilidade ou apertar-para-falar, microfone/saída/volume nas Configurações,
// volume e silenciar por pessoa (até 200%), quem está falando, qualidade da conexão, sons de entrar/sair,
// reconexão sozinha (ICE restart + negociação "perfeita") e Opus ajustado (FEC, DTX, 48 kbps, mono).
// Desempenho: nada roda enquanto você não está na voz nem nas Configurações; o laço de medição é de 25 Hz
// (não a cada quadro) e a interface só mexe no que mudou.
(() => {
  "use strict";
  const MAX_BITRATE = 48000, PASSO_MS = 40, SEGURA_MS = 350;
  const V = {
    on: false, mudo: false, surdo: false, voltar: false, ok: false,
    mic: null,        // stream original do microfone (só para medir o volume)
    envio: null,      // cópia da faixa que vai para os outros (liga/desliga pelo portão de voz)
    pcs: new Map(),   // id -> conexão
    gente: new Map(), // id -> { nome, mudo, falando, el, q, ms }
    ctx: null, nivel: 0, ultimaVoz: 0, ptt: false,
  };

  // ---------- preferências (só neste navegador) ----------
  const pref = (k, v) => {
    try { if (v === undefined) return localStorage.getItem("astra.voz." + k); localStorage.setItem("astra.voz." + k, String(v)); } catch { /* sem storage */ }
    return null;
  };
  const num = (k, d) => { const v = pref(k); return v === null || v === "" || isNaN(+v) ? d : +v; };
  const P = {
    get modo() { return pref("modo") === "ptt" ? "ptt" : "voz"; },
    get tecla() { return pref("tecla") || "KeyV"; },
    get sens() { return num("sens", 10); },
    get vol() { return num("vol", 100) / 100; },
    get ruido() { return pref("ruido") !== "0"; },
    get ruidoForte() { return pref("ruido") === "2"; },   // "0" desligado, "1" normal (navegador), "2" forte (RNNoise)
    get eco() { return pref("eco") !== "0"; },
    volDe(nome) { return num("pv:" + nome, 100) / 100; },
    caladoDe(nome) { return pref("pm:" + nome) === "1"; },
  };

  // ---------- áudio ----------
  function ctx() {
    if (!V.ctx) { try { V.ctx = new AudioContext({ latencyHint: "interactive" }); } catch { return null; } aplicarSaida(); }
    if (V.ctx.state === "suspended") V.ctx.resume().catch(() => {});
    return V.ctx;
  }
  addEventListener("pointerdown", () => { if (V.ctx && V.ctx.state === "suspended") V.ctx.resume().catch(() => {}); }, true);
  // sons curtos (gerados aqui, sem arquivo): entrar, sair, microfone
  function som(notas) {
    const c = ctx(); if (!c || V.surdo) return;
    let t = c.currentTime;
    for (const [f, d] of notas) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1 * P.vol + 0.001, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.02); t += d * 0.8;
    }
  }
  const SOM = { entrar: [[523, 0.09], [784, 0.14]], sair: [[784, 0.09], [523, 0.14]], alguem: [[659, 0.08], [880, 0.1]], foi: [[587, 0.08], [440, 0.1]], mudo: [[330, 0.07]], ligou: [[440, 0.07]] };

  // nível 0-100 (dB de -60 a 0, igual à escala do Discord). A janela cobre o intervalo do laço inteiro.
  function nivelDe(an) {
    an.a.getFloatTimeDomainData(an.buf);
    let s = 0; for (let i = 0; i < an.buf.length; i++) s += an.buf[i] * an.buf[i];
    const db = 20 * Math.log10(Math.sqrt(s / an.buf.length) + 1e-9);
    return Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
  }
  function analisador(fonte, tam = 2048) {
    const c = ctx(); if (!c) return null;
    const a = c.createAnalyser(); a.fftSize = tam; a.smoothingTimeConstant = 0;
    fonte.connect(a);
    return { a, buf: new Float32Array(a.fftSize) };
  }
  async function aplicarSaida() {
    const id = pref("saida") || "";
    if (V.ctx && V.ctx.setSinkId) { try { await V.ctx.setSinkId(id); } catch { /* aparelho sumiu */ } }
    for (const c of V.pcs.values()) if (c.audio.setSinkId && !c.web) c.audio.setSinkId(id).catch(() => {});
  }

  // ---------- microfone ----------
  function abrirMic() {
    const id = pref("mic");
    return navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: id ? { ideal: id } : undefined, echoCancellation: P.eco, noiseSuppression: P.ruido, autoGainControl: true,
      channelCount: 1, sampleRate: 48000 } });
  }
  // Supressão forte: RNNoise (rede neural, WASM) num AudioWorklet a 48 kHz. Se falhar, cai no normal sem avisar.
  let rnWasm = null;
  async function filtroForte(stream) {
    // se a política de segurança bloquear WebAssembly, o worklet ficaria mudo: testa antes e cai no normal
    try { await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])); } catch (e) { console.warn("supressor forte: WASM bloqueado", e); return null; }
    const c = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    try {
      if (!rnWasm) {
        const simd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
        rnWasm = await (await fetch(simd ? "rnnoise_simd.wasm" : "rnnoise.wasm")).arrayBuffer();
      }
      await c.audioWorklet.addModule("rnnoise-worklet.js");
      const no = new AudioWorkletNode(c, "@sapphi-red/web-noise-suppressor/rnnoise",
        { processorOptions: { maxChannels: 1, wasmBinary: rnWasm.slice(0) } });
      const dest = c.createMediaStreamDestination();
      c.createMediaStreamSource(stream).connect(no).connect(dest);
      if (c.state !== "running") c.resume().catch(() => {});
      return { c, no, faixa: dest.stream.getAudioTracks()[0] };
    } catch (e) { console.warn("supressor forte:", e); c.close().catch(() => {}); return null; }
  }
  function soltarForte(f) { if (!f) return; try { f.no.port.postMessage("destroy"); } catch {} f.faixa.stop(); f.c.close().catch(() => {}); }
  async function prepararMic(stream) {
    const forte = P.ruidoForte ? await filtroForte(stream) : null;
    V.mic = stream; V.forte = forte;
    V.envio = forte ? forte.faixa : stream.getAudioTracks()[0].clone();
    V.envio.contentHint = "speech";
    V.envio.enabled = false;
    const c = ctx();
    // o portão de voz mede o som JÁ limpo (assim o barulho não abre o microfone)
    V.anMic = c ? analisador(c.createMediaStreamSource(new MediaStream([forte ? forte.faixa.clone() : stream.getAudioTracks()[0]]))) : null;
  }
  function soltarMic() {
    V.mic?.getTracks().forEach((t) => t.stop()); V.envio?.stop(); soltarForte(V.forte);
    V.mic = V.envio = V.anMic = V.forte = null;
  }
  async function trocarMic() {
    if (!V.on) return;
    try {
      const velho = [V.mic, V.envio, V.forte];
      await prepararMic(await abrirMic());
      for (const c of V.pcs.values()) await c.sender?.replaceTrack(V.envio);
      velho[0]?.getTracks().forEach((t) => t.stop()); velho[1]?.stop(); soltarForte(velho[2]);
    } catch { aviso({ titulo: "Não deu para usar esse microfone." }); }
  }

  // ---------- laço de medição (só roda quando precisa) ----------
  // Portão de voz: só manda áudio quando você fala (ou segura a tecla): economiza banda e corta ruído de fundo.
  let relogio = 0;
  function precisaLaco() { return V.on || !!teste || (sec && !sec.hidden); }
  function agendar() {
    const quer = precisaLaco();
    if (quer && !relogio) relogio = setInterval(passo, PASSO_MS);
    else if (!quer && relogio) { clearInterval(relogio); relogio = 0; }
  }
  function passo() {
    const agora = performance.now();
    if (V.on && V.envio) {
      V.nivel = V.anMic ? nivelDe(V.anMic) : 0;
      let aberto;
      if (P.modo === "ptt") aberto = V.ptt;
      else if (document.hidden) aberto = true;   // aba em segundo plano: o navegador desacelera o laço; o DTX do Opus cuida do silêncio
      else { if (V.nivel >= P.sens) V.ultimaVoz = agora; aberto = agora - V.ultimaVoz < SEGURA_MS; }
      const manda = aberto && !V.mudo;
      if (V.envio.enabled !== manda) V.envio.enabled = manda;
      if (!document.hidden) {
        const eu = V.gente.get(estado.conexao);
        if (eu) marcarFalando(eu, manda && V.nivel >= Math.max(8, P.modo === "ptt" ? 8 : P.sens), agora);
        for (const [id, p] of V.gente) {
          if (id === estado.conexao) continue;
          const c = V.pcs.get(id);
          marcarFalando(p, !!c?.an && !p.mudo && !V.surdo && !P.caladoDe(p.nome) && nivelDe(c.an) > 18, agora);
        }
      }
    }
    if (medidor) medidor();
  }
  // segura o anel verde um pouco depois da última sílaba para não piscar
  function marcarFalando(p, sim, agora) {
    if (sim) p.ult = agora;
    const vale = sim || agora - (p.ult || 0) < 250;
    if (vale !== !!p.falando) { p.falando = vale; p.el?.classList.toggle("falando", vale); p.tile?.classList.toggle("falando", vale); }
  }

  // apertar-para-falar (funciona com o site em foco)
  const digitando = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === "KeyM" && V.on) { e.preventDefault(); mudo(!V.mudo); return; }
    if (V.on && P.modo === "ptt" && e.code === P.tecla && !digitando(e) && !e.repeat) V.ptt = true;
  });
  addEventListener("keyup", (e) => { if (e.code === P.tecla) V.ptt = false; });
  addEventListener("blur", () => { V.ptt = false; });

  // ---------- SDP: Opus para voz ----------
  function opus(sdp) {
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
    if (!m) return sdp;
    const extra = { useinbandfec: 1, usedtx: 1, stereo: 0, "sprop-stereo": 0, maxaveragebitrate: MAX_BITRATE, maxplaybackrate: 48000, minptime: 10 };
    return sdp.replace(new RegExp(`a=fmtp:${m[1]} ([^\\r\\n]*)`), (_, atual) => {
      const p = Object.fromEntries(atual.split(";").filter(Boolean).map((x) => x.split("=")));
      Object.assign(p, extra);
      return `a=fmtp:${m[1]} ` + Object.entries(p).map(([k, v]) => `${k}=${v}`).join(";");
    });
  }

  // ---------- conexões (negociação "perfeita": quem tem o id maior cede quando as ofertas se cruzam) ----------
  const mandar = (id, dados) => enviar({ t: "sinal", para: id, dados: { voz: 1, ...dados } });
  function conexao(id) {
    let c = V.pcs.get(id);
    if (c) return c;
    const pc = new RTCPeerConnection({ iceServers: estado.ice || [], bundlePolicy: "max-bundle", rtcpMuxPolicy: "require",
    // 2.7.33: a voz sempre passa pelo repasse da Astra (ninguém da call vê o seu IP)
    iceTransportPolicy: window.politicaIce ? window.politicaIce("voz") : "relay" });
    c = { pc, polido: String(estado.conexao) > String(id), ofertando: false, ignorar: false, fila: [], audio: new Audio(), web: false, an: null, ganho: null };
    c.audio.autoplay = true;
    V.pcs.set(id, c);
    c.sender = pc.addTrack(V.envio, V.mic);
    ajustarEnvio(c.sender);
    pc.onicecandidate = (e) => { if (e.candidate) mandar(id, { cand: e.candidate }); };
    pc.onnegotiationneeded = async () => {
      try {
        c.ofertando = true;
        const o = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription({ type: "offer", sdp: opus(o.sdp) });
        mandar(id, { sdp: pc.localDescription });
      } catch (e) { console.warn("voz oferta:", e); } finally { c.ofertando = false; }
    };
    pc.ontrack = (e) => tocar(id, c, e.streams[0] || new MediaStream([e.track]));
    // caiu a conexão: tenta de novo sozinho
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      clearTimeout(c.queda);
      if (s === "failed") pc.restartIce?.();
      else if (s === "disconnected") c.queda = setTimeout(() => { if (pc.iceConnectionState === "disconnected") pc.restartIce?.(); }, 4000);
    };
    return c;
  }
  async function ajustarEnvio(sender) {
    try {
      const p = sender.getParameters();
      p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
      Object.assign(p.encodings[0], { maxBitrate: MAX_BITRATE, priority: "high", networkPriority: "high" });
      await sender.setParameters(p);
    } catch { /* navegador sem suporte: fica no padrão */ }
  }
  // som de cada pessoa: passa por um ganho (volume até 200%) quando dá; senão toca direto no <audio>
  function tocar(id, c, stream) {
    c.audio.srcObject = stream;
    const ac = ctx();
    const p = V.gente.get(id) || {};
    // Firefox: o Web Audio não troca de saída; se escolheram um fone, toca direto no <audio>
    if (ac && (!pref("saida") || ac.setSinkId)) {
      try {
        c.audio.muted = true;   // o Chrome só "puxa" o áudio remoto para o Web Audio se ele também estiver num <audio> (mudo)
        const fonte = ac.createMediaStreamSource(stream);
        c.ganho = ac.createGain();
        fonte.connect(c.ganho).connect(ac.destination);
        c.an = analisador(fonte, 1024);
        c.web = true;
      } catch { c.web = false; }
    }
    if (!c.web) { c.audio.muted = false; c.an = null; }
    volumeDe(id, p.nome);
    c.audio.play().catch(() => {});
    aplicarSaida();
  }
  function volumeDe(id, nome) {
    const c = V.pcs.get(id); if (!c) return;
    const v = V.surdo || P.caladoDe(nome) ? 0 : P.vol * P.volDe(nome);
    if (c.web && c.ganho) c.ganho.gain.setTargetAtTime(v, c.ganho.context.currentTime, 0.02);
    else { c.audio.muted = v === 0; c.audio.volume = Math.min(1, v); }
  }
  function volumes() { for (const [id, p] of V.gente) if (id !== estado.conexao) volumeDe(id, p.nome); }
  function fechar(id) {
    const c = V.pcs.get(id); if (!c) return;
    clearTimeout(c.queda); c.pc.close(); c.audio.srcObject = null; c.ganho?.disconnect();
    V.pcs.delete(id);
  }
  async function sinal(de, d) {
    if (!V.on || !V.gente.has(de)) return;
    const c = conexao(de), pc = c.pc;
    try {
      if (d.sdp) {
        const cruzou = d.sdp.type === "offer" && (c.ofertando || pc.signalingState !== "stable");
        c.ignorar = !c.polido && cruzou;
        if (c.ignorar) return;
        await pc.setRemoteDescription(d.sdp);
        for (const x of c.fila.splice(0)) await pc.addIceCandidate(x).catch(() => {});
        if (d.sdp.type === "offer") {
          const a = await pc.createAnswer();
          await pc.setLocalDescription({ type: "answer", sdp: opus(a.sdp) });
          mandar(de, { sdp: pc.localDescription });
        }
      } else if (d.cand) {
        if (pc.remoteDescription) await pc.addIceCandidate(d.cand).catch((e) => { if (!c.ignorar) console.warn("voz ice:", e); });
        else c.fila.push(d.cand);
      }
    } catch (e) { console.warn("voz:", e); }
  }

  // qualidade da conexão de cada pessoa (ping e perda), a cada 4 s, só com a aba visível
  setInterval(async () => {
    if (!V.on || document.hidden) return;
    for (const [id, c] of V.pcs) {
      const p = V.gente.get(id); if (!p) continue;
      try {
        let rtt = null, perdidos = 0, recebidos = 0;
        (await c.pc.getStats()).forEach((s) => {
          if (s.type === "candidate-pair" && s.nominated && s.currentRoundTripTime != null) rtt = s.currentRoundTripTime * 1000;
          if (s.type === "inbound-rtp" && s.kind === "audio") { perdidos = s.packetsLost || 0; recebidos = s.packetsReceived || 0; }
        });
        // perda só nos últimos 4 s, não desde o começo
        const dP = perdidos - (c.pA || 0), dR = recebidos - (c.rA || 0);
        c.pA = perdidos; c.rA = recebidos;
        const perda = dP + dR > 0 ? Math.max(0, dP) / (dP + dR) : 0;
        const ice = c.pc.iceConnectionState;
        p.q = ice === "new" || ice === "checking" ? "conectando" : ice !== "connected" && ice !== "completed" ? "ruim" : rtt > 300 || perda > 0.08 ? "ruim" : rtt > 150 || perda > 0.03 ? "media" : "boa";
        p.ms = rtt == null ? null : Math.round(rtt);
        if (p.el) { p.el.dataset.q = p.q; p.el.title = dica(id, p); }
        if (menu?.id === id) infoMenu(p);
      } catch { /* conexão fechando */ }
    }
  }, 4000);

  // ---------- interface ----------
  const SVG = (d, extra = "") => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${d}"/>${extra}</svg>`;
  const RISCO = `<path class="risco" d="M4 4l16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;
  const I = {
    mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z",
    fone: "M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h2a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2a7 7 0 0 1 14 0v2h-3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9Z",
    desligar: "M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.96.96 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.42l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9Z",
  };
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "voz.css?v=9";
  document.head.append(css);

  const barra = document.createElement("div");
  barra.className = "voz-barra"; barra.hidden = true;
  barra.setAttribute("role", "group"); barra.setAttribute("aria-label", "Voz da sala");
  barra.innerHTML = `<button class="voz-entrar" type="button" data-v="entrar" title="Falar e ouvir com quem está na sala">${SVG(I.mic)}<span>Entrar na call</span></button>
<span class="voz-gente"></span>
<span class="voz-sep" data-v="sep" hidden></span>
<button class="voz-bt" type="button" data-v="mudo" hidden aria-pressed="false">${SVG(I.mic, RISCO)}</button>
<button class="voz-bt" type="button" data-v="surdo" hidden aria-pressed="false">${SVG(I.fone, RISCO)}</button>
<button class="voz-bt fim" type="button" data-v="sair" hidden aria-label="Sair da voz" title="Sair da voz">${SVG(I.desligar)}</button>`;
  const btSair = document.getElementById("bt-sair");
  btSair.before(barra);
  const B = (k) => barra.querySelector(`[data-v="${k}"]`);
  const lista = barra.querySelector(".voz-gente");
  new MutationObserver(() => { barra.hidden = btSair.hidden || !V.ok; if (btSair.hidden && V.on) sair(false); })
    .observe(btSair, { attributes: true, attributeFilter: ["hidden"] });

  // ---------- grade da chamada (igual ao Discord) e controles na doca ----------
  const palco = document.getElementById("palco");
  const grade = document.createElement("div");
  grade.className = "voz-grade"; grade.hidden = true;
  grade.setAttribute("role", "list"); grade.setAttribute("aria-label", "Pessoas na voz");
  palco?.append(grade);
  const docaV = document.createElement("div");
  docaV.className = "voz-doca"; docaV.hidden = true;
  docaV.innerHTML = `<button class="voz-entrar voz-entrar-g" type="button" data-v="entrar" title="Falar e ouvir com quem está na call">${SVG(I.mic)}<span>Entrar na call</span></button><span class="voz-doca-grupo" data-v="grupo"><button class="voz-bt" type="button" data-v="mudo" aria-pressed="false">${SVG(I.mic, RISCO)}</button>
<button class="voz-bt" type="button" data-v="surdo" aria-pressed="false">${SVG(I.fone, RISCO)}</button></span>
<button class="voz-bt fim" type="button" data-v="sair" aria-label="Sair da voz" title="Sair da voz">${SVG(I.desligar)}</button>`;
  (document.querySelector("#sala .doca") || document.querySelector(".doca"))?.append(docaV);
  const todos = (k) => [B(k), docaV.querySelector(`[data-v="${k}"]`)].filter(Boolean);
  const D = (k) => docaV.querySelector(`[data-v="${k}"]`);

  // tamanho dos quadros: o maior 16:9 que cabe na área (testa todas as colunas possíveis)
  let temTela = false;
  function ajustarGrade() {
    const n = grade.childElementCount;
    temTela = !!palco?.querySelector(".bloco:not(.escondido)");
    const cheia = n > 0 && !temTela;
    palco?.classList.toggle("voz-cheia", cheia);
    grade.classList.toggle("compacta", temTela);
    // com tela ao vivo, a voz vira uma faixa em cima do palco (dentro da grade ela criava colunas
    // vazias e a transmissão ficava espremida num canto)
    if (palco) {
      if (temTela && grade.parentNode === palco) palco.before(grade);
      else if (!temTela && grade.parentNode !== palco) palco.append(grade);
    }
    if (!cheia || !n) return;
    const g = 8, W = grade.clientWidth, H = grade.clientHeight;
    if (!W || !H) return;
    let melhor = 0;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      melhor = Math.max(melhor, Math.min((W - (c - 1) * g) / c, ((H - (r - 1) * g) / r) * 16 / 9));
    }
    grade.style.setProperty("--w", Math.floor(Math.min(melhor, 720)) + "px");
  }
  if (palco) {
    let pend = 0;
    const depois = () => { if (!pend) pend = requestAnimationFrame(() => { pend = 0; ajustarGrade(); }); };
    new ResizeObserver(depois).observe(palco);
    new MutationObserver(depois).observe(palco, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  }

  const corDe = (nome) => { let h = 0; for (const ch of nome || "?") h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const inicial = (nome) => ([...(nome || "?").trim()][0] || "?").toUpperCase();
  const contaDe = (id) => (id === estado.conexao ? estado.meuId : estado.pares?.get?.(id)?.astraId) || "";
  // foto de perfil do Astra (ou a cor com as iniciais, igual ao resto do app)
  function avatar(caixa, nome, id) {
    caixa.style.setProperty("--h", corDe(nome));
    let a = caixa.querySelector(".avatar");
    if (!a) { a = document.createElement("span"); a.className = "avatar"; caixa.prepend(a); }
    const conta = contaDe(id);
    if (typeof pintarAvatar === "function" && conta) { try { pintarAvatar(a, nome, conta); return; } catch { /* segue sem foto */ } }
    a.removeAttribute("style"); a.textContent = inicial(nome);
  }
  function fundoTile(el, nome, id) {
    const conta = contaDe(id);
    let capa = "", cor = "";
    if (conta && typeof perfilDe === "function") {
      try { const p = perfilDe(conta); capa = typeof fundoCapa === "function" ? fundoCapa(p, conta, false) : "";
        cor = p && typeof p.c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(p.c) ? p.c : "";   // 2.7.33: só cor de verdade
      } catch { /* sem perfil */ }
    }
    el.classList.toggle("capa", !!capa);
    el.style.background = capa ? capa : cor ? `color-mix(in srgb, ${cor} 45%, #111)` : "";
    if (capa) { el.style.backgroundSize = "cover"; el.style.backgroundPosition = "center"; }
  }
  const pintar = (r) => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%");
  const dica = (id, p) => id === estado.conexao
    ? (P.modo === "ptt" ? `Você · apertar para falar: ${nomeTecla(P.tecla)}` : "Você · detecção de voz")
    : `${p.nome}${p.ms != null ? " · " + p.ms + " ms" : ""} · clique para ajustar o volume`;

  // ---------- menu de uma pessoa ----------
  let menu = null;
  function fecharMenu() { if (!menu) return; menu.alvo?.setAttribute("aria-expanded", "false"); menu.remove(); menu = null; }
  addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target) && !menu.alvo.contains(e.target)) fecharMenu(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && menu) { const a = menu.alvo; fecharMenu(); a.focus(); } });
  addEventListener("resize", fecharMenu);
  function infoMenu(p) {
    const q = { boa: "Conexão boa", media: "Conexão instável", ruim: "Conexão ruim" }[p.q] || "Conectando…";
    menu.querySelector("small").textContent = p.ms != null ? `${q} · ${p.ms} ms` : q;
  }
  function abrirMenu(id, alvo, ponto) {
    fecharMenu();
    const p = V.gente.get(id); if (!p) return;
    menu = document.createElement("div");
    menu.className = "voz-menu"; menu.id = id; menu.alvo = alvo;
    menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", "Voz de " + p.nome);
    const vol = Math.round(P.volDe(p.nome) * 100);
    menu.innerHTML = `<div class="voz-menu-topo"><span class="voz-av"></span><div style="min-width:0"><b></b><small></small></div></div>
<div><div class="voz-menu-rot"><span>Volume</span><output>${vol}%</output></div><input class="voz-r" type="range" min="0" max="200" step="5" value="${vol}" aria-label="Volume"></div>
<label class="voz-tg"><span>Silenciar para mim</span><input class="voz-sw" type="checkbox" ${P.caladoDe(p.nome) ? "checked" : ""}></label>`;
    avatar(menu.querySelector(".voz-av"), p.nome, id);
    menu.querySelector("b").textContent = p.nome;
    infoMenu(p);
    const r = menu.querySelector(".voz-r"), cb = menu.querySelector(".voz-sw"), out = menu.querySelector("output");
    pintar(r);
    r.oninput = () => { pref("pv:" + p.nome, r.value); out.textContent = r.value + "%"; pintar(r); volumeDe(id, p.nome); };
    cb.onchange = () => { pref("pm:" + p.nome, cb.checked ? "1" : "0"); volumeDe(id, p.nome); desenhar(); };
    // dono e moderadores: tirar a pessoa da call (moderador não tira o dono nem outro moderador)
    const mods = estado.mods || new Set(), souDono = estado.conexao === estado.dono;
    const alvoAid = estado.pares?.get(id)?.astraId;
    if (souDono || (mods.has(estado.meuId) && id !== estado.dono && !mods.has(alvoAid))) {
      const bt = document.createElement("button");
      bt.type = "button"; bt.className = "voz-menu-tirar"; bt.textContent = "Tirar da call";
      bt.onclick = () => {
        if (!bt.classList.contains("confirmar")) { bt.classList.add("confirmar"); bt.textContent = "Confirmar: tirar da call"; return; }
        enviar({ t: "tirar-voz", id }); fecharMenu();
      };
      menu.append(bt);
    }
    document.body.append(menu);
    const r0 = alvo.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    const a = ponto ? { left: ponto.x, width: 0, top: ponto.y, bottom: ponto.y } : r0;
    menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, a.left + a.width / 2 - w / 2)) + "px";
    menu.style.top = (a.bottom + 8 + h > innerHeight ? Math.max(8, a.top - h - 8) : a.bottom + 8) + "px";
    alvo.setAttribute("aria-expanded", "true");
  }

  // ---------- desenho da barra (reaproveita os elementos; só muda o que precisa) ----------
  function chip(id, p) {
    let s = p.el;
    if (!s) {
      s = document.createElement("button");
      s.type = "button"; s.className = "voz-pessoa";
      s.innerHTML = `<span class="voz-av"><i>${SVG(I.mic, RISCO)}</i></span><span class="voz-nome"></span>`;
      s.onclick = () => { if (!V.on || id === estado.conexao) return; menu?.id === id ? fecharMenu() : abrirMenu(id, s); };
      p.el = s;
    }
    const eu = id === estado.conexao, nome = eu ? "Você" : p.nome || "?";
    if (s.dataset.nome !== nome) { s.dataset.nome = nome; s.querySelector(".voz-nome").textContent = nome; avatar(s.querySelector(".voz-av"), p.nome || nome, id); }
    s.classList.toggle("mudo", !!p.mudo);
    s.classList.toggle("falando", !!p.falando);
    s.classList.toggle("calado", !eu && P.caladoDe(p.nome));
    if (eu) { s.dataset.q = "boa"; s.removeAttribute("aria-haspopup"); s.style.cursor = "default"; }
    else { if (p.q) s.dataset.q = p.q; s.setAttribute("aria-haspopup", "dialog"); s.style.cursor = ""; }
    s.title = dica(id, p);
    s.setAttribute("aria-label", nome + (p.mudo ? ", microfone desligado" : ""));
    return s;
  }
  // quadro da pessoa na grade da chamada
  function tile(id, p) {
    let t = p.tile;
    if (!t) {
      t = document.createElement("div");
      t.className = "voz-tile"; t.setAttribute("role", "listitem");
      t.innerHTML = `<span class="voz-tile-fundo"></span><span class="voz-tile-av"></span><span class="voz-tile-nome">${SVG(I.mic, RISCO)}<span></span></span><span class="voz-tile-mais" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg></span>`;
      const abrir = (e) => { if (id === estado.conexao) return; menu?.id === id ? fecharMenu() : abrirMenu(id, t, e && e.clientX ? { x: e.clientX, y: e.clientY } : null); };
      t.onclick = abrir;
      t.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } };
      p.tile = t;
    }
    const eu = id === estado.conexao, nome = eu ? `${p.nome || "Você"} (você)` : p.nome || "?";
    if (t.dataset.nome !== nome) {
      t.dataset.nome = nome;
      t.querySelector(".voz-tile-nome span").textContent = nome;
      avatar(t.querySelector(".voz-tile-av"), p.nome || nome, id);
      fundoTile(t.querySelector(".voz-tile-fundo"), p.nome, id);
      t.style.setProperty("--h", corDe(p.nome || nome));
    }
    t.classList.toggle("eu", eu);
    t.tabIndex = eu ? -1 : 0;
    t.classList.toggle("mudo", !!p.mudo);
    t.classList.toggle("falando", !!p.falando);
    t.classList.toggle("calado", !eu && P.caladoDe(p.nome));
    t.title = eu ? "" : dica(id, p);
    t.setAttribute("aria-label", nome + (p.mudo ? ", microfone desligado" : ""));
    return t;
  }
  function desenhar() {
    barra.classList.toggle("on", V.on);
    B("entrar").hidden = V.on;
    for (const k of ["sep", "mudo", "surdo", "sair"]) B(k).hidden = !V.on;
    B("entrar").lastChild.textContent = V.gente.size ? `Entrar na call · ${V.gente.size}` : "Entrar na call";
    for (const m of todos("mudo")) {
      m.setAttribute("aria-pressed", String(V.mudo));
      m.title = (V.mudo ? "Ligar o microfone" : "Desligar o microfone") + " (Ctrl+Shift+M)"; m.setAttribute("aria-label", m.title);
    }
    for (const f of todos("surdo")) {
      f.setAttribute("aria-pressed", String(V.surdo));
      f.title = V.surdo ? "Voltar a ouvir" : "Parar de ouvir"; f.setAttribute("aria-label", f.title);
    }
    docaV.hidden = !V.ok;
    D("entrar").hidden = V.on; D("grupo").hidden = D("sair").hidden = !V.on;
    D("entrar").lastChild.textContent = V.gente.size ? `Entrar na call · ${V.gente.size}` : "Entrar na call";
    grade.classList.toggle("de-fora", !V.on);
    // você primeiro, depois os outros na ordem em que entraram
    const ids = [...V.gente.keys()].sort((a, b) => (b === estado.conexao) - (a === estado.conexao));
    const els = ids.map((id) => chip(id, V.gente.get(id)));
    if (els.length !== lista.children.length || els.some((e, i) => lista.children[i] !== e)) lista.replaceChildren(...els);
    const ts = ids.map((id) => tile(id, V.gente.get(id)));   // mostra quem está na call mesmo para quem não entrou
    if (ts.length !== grade.children.length || ts.some((e, i) => grade.children[i] !== e)) grade.replaceChildren(...ts);
    grade.hidden = !ts.length;
    ajustarGrade();
    if (menu && !V.gente.has(menu.id)) fecharMenu();
  }

  // ---------- entrar / sair ----------
  async function entrar() {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return aviso({ titulo: "Este navegador não tem chamada de voz." });
    if (V.gente.size >= 10) return aviso({ titulo: "A voz desta sala está cheia (10 pessoas)." });
    for (const b of todos("entrar")) b.disabled = true;
    try { await prepararMic(await abrirMic()); } catch {
      for (const b of todos("entrar")) b.disabled = false;
      return aviso({ titulo: "Sem acesso ao microfone", texto: "Libere o microfone para o site nas permissões do navegador.", tempo: 7000 });
    }
    for (const b of todos("entrar")) b.disabled = false;
    V.on = true; V.mudo = false; V.ultimaVoz = 0;
    enviar({ t: "voz", on: true, mudo: false });
    for (const id of V.gente.keys()) if (id !== estado.conexao) conexao(id);   // quem chega liga para quem já está
    som(SOM.entrar);
    agendar();
    desenhar();
  }
  function sair(avisar = true) {
    fecharMenu();
    for (const id of [...V.pcs.keys()]) fechar(id);
    soltarMic();
    if (V.on && avisar) som(SOM.sair);
    V.on = false; V.surdo = false; V.ptt = false;
    V.gente.delete(estado.conexao);
    if (avisar) enviar({ t: "voz", on: false });
    agendar();
    desenhar();
  }
  function mudo(sim) {
    V.mudo = sim;
    som(sim ? SOM.mudo : SOM.ligou);
    enviar({ t: "voz", on: true, mudo: sim });
    desenhar();
  }
  for (const b of todos("entrar")) b.onclick = entrar;
  const aoMudo = () => { if (V.surdo && V.mudo) { V.surdo = false; volumes(); } mudo(!V.mudo); };
  const aoSurdo = () => {   // igual ao Discord: parar de ouvir também desliga o microfone
    V.surdo = !V.surdo;
    volumes();
    if (V.surdo && !V.mudo) mudo(true); else if (!V.surdo && V.mudo) mudo(false); else desenhar();
  };
  for (const b of todos("sair")) b.onclick = () => sair(true);
  for (const b of todos("mudo")) b.onclick = aoMudo;
  for (const b of todos("surdo")) b.onclick = aoSurdo;

  // ---------- mensagens do servidor ----------
  // o dono ou um moderador tirou você da call (você continua na sala e pode entrar de novo)
  TRATAR["voz-tirado"] = (m) => {
    aviso({ titulo: `${m.por || "O dono da sala"} tirou você da call.` });
    sair(false);
  };
  TRATAR.voz = (m) => {
    if (m.cheia) { aviso({ titulo: "A voz desta sala está cheia (10 pessoas)." }); return sair(false); }
    const ja = V.gente.has(m.id);
    if (m.on) {
      const p = V.gente.get(m.id) || {};
      V.gente.set(m.id, Object.assign(p, { nome: m.nome, mudo: !!m.mudo }));
      if (!ja && V.on && m.id !== estado.conexao) som(SOM.alguem);
    } else {
      if (ja && V.on && m.id !== estado.conexao) som(SOM.foi);
      V.gente.delete(m.id); fechar(m.id);
    }
    desenhar();
  };
  TRATAR["voz-lista"] = (m) => {
    V.ok = true; barra.hidden = btSair.hidden;   // o servidor sabe fazer voz: mostra a barra
    V.gente.clear();
    for (const p of m.lista || []) V.gente.set(p.id, { nome: p.nome, mudo: !!p.mudo });
    desenhar();
    if (V.voltar) { V.voltar = false; entrar(); }   // a conexão caiu e voltou: entra na voz de novo
  };
  const sinal0 = TRATAR.sinal;
  TRATAR.sinal = (m) => (m.dados && m.dados.voz ? sinal(m.de, m.dados) : sinal0(m));
  const saiu0 = TRATAR.saiu;
  TRATAR.saiu = (m) => { saiu0(m); if (V.gente.delete(m.id)) { fechar(m.id); if (V.on) som(SOM.foi); desenhar(); } };
  const bemvindo0 = TRATAR.bemvindo;
  TRATAR.bemvindo = (m) => {
    bemvindo0(m);
    if (V.on) { sair(false); V.voltar = true; }
    enviar({ t: "voz-lista" });
  };

  // ---------- Configurações > Voz e áudio ----------
  const $c = (id) => document.getElementById(id);
  const nomeTecla = (code) => code.replace(/^Key/, "").replace(/^Digit/, "").replace("Space", "Espaço");
  let medidor = null, teste = null;
  const sec = document.querySelector('.config-sec[data-sec="voz"]');
  async function listarAparelhos() {
    const selMic = $c("voz-cfg-mic"), selSaida = $c("voz-cfg-saida");
    if (!selMic || !navigator.mediaDevices?.enumerateDevices) return;
    let todos = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    if (todos.some((d) => d.kind === "audioinput" && !d.label)) {   // sem permissão o navegador esconde os nomes
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); todos = await navigator.mediaDevices.enumerateDevices(); } catch { /* negou */ }
    }
    const encher = (sel, tipo, chave) => {
      const ops = [new Option("Padrão do sistema", "")];
      let i = 1;
      for (const d of todos) if (d.kind === tipo && d.deviceId !== "default" && d.deviceId !== "communications") ops.push(new Option(d.label || `Aparelho ${i++}`, d.deviceId));
      sel.replaceChildren(...ops);
      const quer = pref(chave) || ""; sel.value = quer; if (sel.value !== quer) sel.value = "";
      sel.title = sel.selectedOptions[0]?.text || "";
    };
    encher(selMic, "audioinput", "mic");
    const temSaida = "setSinkId" in HTMLMediaElement.prototype || "setSinkId" in (window.AudioContext?.prototype || {});
    selSaida.disabled = !temSaida;
    if (temSaida) encher(selSaida, "audiooutput", "saida");
    else { selSaida.replaceChildren(new Option("Padrão do sistema", "")); $c("voz-cfg-saida-txt").textContent = "Este navegador não deixa escolher: o som sai no padrão do sistema."; }
  }
  function pararTeste() {
    if (!teste) return;
    teste.s.getTracks().forEach((t) => t.stop()); teste = null;
    const b = $c("voz-cfg-testar"); if (b) b.textContent = "Testar";
    agendar();
  }
  async function testar() {
    if (teste) return pararTeste();
    try {
      const s = await abrirMic(), c = ctx();
      teste = { s, an: analisador(c.createMediaStreamSource(s)) };
      $c("voz-cfg-testar").textContent = "Parar";
      $c("voz-cfg-msg").textContent = "";
      agendar();
    } catch { $c("voz-cfg-msg").textContent = "Sem acesso ao microfone: libere nas permissões do navegador."; }
  }
  if (sec) {
    const modo = $c("voz-cfg-modo"), tecla = $c("voz-cfg-tecla"), sens = $c("voz-cfg-sens"), vol = $c("voz-cfg-vol");
    const nivel = $c("voz-cfg-nivel"), barraNivel = nivel.parentElement;
    for (const r of [sens, vol]) r.classList.add("voz-r");
    for (const id of ["voz-cfg-eco"]) $c(id).classList.add("voz-sw");
    const mostrarModo = () => {
      const ptt = P.modo === "ptt";
      $c("voz-cfg-linha-tecla").hidden = !ptt;
      sens.hidden = ptt; barraNivel.classList.toggle("sem-sens", ptt);
      $c("voz-cfg-sens-txt").textContent = ptt
        ? "Clique em Testar e fale para ver se o microfone pega."
        : "Arraste a marca: abaixo dela o microfone fica fechado. Clique em Testar e fale; a barra fica verde quando passa.";
      tecla.textContent = nomeTecla(P.tecla);
    };
    modo.value = P.modo; mostrarModo();
    modo.onchange = () => { pref("modo", modo.value); mostrarModo(); desenhar(); };
    tecla.onclick = () => {
      tecla.textContent = "Aperte uma tecla…";
      const pega = (e) => { e.preventDefault(); e.stopPropagation(); if (e.code !== "Escape") pref("tecla", e.code); mostrarModo(); desenhar(); removeEventListener("keydown", pega, true); };
      addEventListener("keydown", pega, true);
    };
    sens.value = String(P.sens);
    sens.oninput = () => pref("sens", sens.value);
    vol.value = String(Math.round(P.vol * 100)); pintar(vol);
    vol.oninput = () => { pref("vol", vol.value); pintar(vol); volumes(); };
    const reabrir = () => { trocarMic(); if (teste) { pararTeste(); testar(); } };
    $c("voz-cfg-ruido").value = P.ruidoForte ? "2" : P.ruido ? "1" : "0"; $c("voz-cfg-eco").checked = P.eco;
    $c("voz-cfg-ruido").onchange = (e) => { pref("ruido", e.target.value); reabrir(); };
    $c("voz-cfg-eco").onchange = (e) => { pref("eco", e.target.checked ? "1" : "0"); reabrir(); };
    $c("voz-cfg-mic").onchange = (e) => { pref("mic", e.target.value); e.target.title = e.target.selectedOptions[0]?.text || ""; reabrir(); };
    $c("voz-cfg-saida").onchange = (e) => { pref("saida", e.target.value); e.target.title = e.target.selectedOptions[0]?.text || ""; aplicarSaida(); };
    $c("voz-cfg-testar").onclick = testar;
    // o medidor fica atrás da marca de sensibilidade (igual ao Discord); só escreve no DOM quando muda
    let ultimo = -1, passouAntes = null;
    medidor = () => {
      if (sec.hidden) return;
      const n = Math.round(teste?.an ? nivelDe(teste.an) : V.on ? V.nivel : 0);
      if (n !== ultimo) { ultimo = n; nivel.style.transform = `scaleX(${n / 100})`; }
      const passou = n >= P.sens;
      if (passou !== passouAntes) { passouAntes = passou; barraNivel.classList.toggle("passou", passou); }
    };
    new MutationObserver(() => { if (!sec.hidden) listarAparelhos(); else pararTeste(); agendar(); }).observe(sec, { attributes: true, attributeFilter: ["hidden"] });
    navigator.mediaDevices?.addEventListener?.("devicechange", () => { if (!sec.hidden) listarAparelhos(); });
  }
  agendar();
})();
