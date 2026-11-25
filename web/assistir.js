// AstraScreenShare - página de quem só quer assistir (link /v/<código>).
//
// A pessoa digita um nome e vê a tela de quem está transmitindo na sala. Não tem
// chat, conta, foto nem opções: só o vídeo (com o som). O servidor dá um ID
// provisório, que some quando a aba fecha. A conexão é a mesma do programa
// (WebRTC, "perfect negotiation"); aqui só se recebe, nunca se manda tela.
"use strict";

const $ = (id) => document.getElementById(id);
const codigo = decodeURIComponent(location.pathname.split("/v/")[1] || "").replace(/\/$/, "");

const estado = {
  ws: null, conexao: "", ice: [], nome: "",
  pares: new Map(),   // id da conexão -> par
  acabou: false, tentativas: 0, mudo: false,
};

function ler(chave) { try { return localStorage.getItem(chave) || ""; } catch (_) { return ""; } }
function guardar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (_) {} }

function enviar(msg) {
  if (estado.ws && estado.ws.readyState === WebSocket.OPEN) estado.ws.send(JSON.stringify(msg));
}

// ---------- nome ----------
$("nome").value = ler("astra.visitante");
$("nome").focus();
$("form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const nome = $("nome").value.trim().slice(0, 24);
  if (!nome) return;
  estado.nome = nome;
  guardar("astra.visitante", nome);
  $("entrada").hidden = true;
  $("palco").hidden = false;
  $("canto").hidden = false;
  document.body.classList.add("assistindo");
  recado("Conectando...");
  conectar();
});

function recado(texto) {
  $("recado").textContent = texto;
  $("recado").hidden = !texto;
}

// ---------- servidor ----------
function conectar() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  estado.ws = ws;
  ws.onopen = () => enviar({ t: "ola", visitante: true, nome: estado.nome, ponteOk: true });
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (_) { return; }
    const tratar = TRATAR[m.t];
    if (tratar) tratar(m);
  };
  ws.onclose = () => caiu(ws);
}

// A internet caiu: tenta de novo sozinho, enquanto a transmissão não acabou.
function caiu(ws) {
  if (estado.ws !== ws || ws.perdida) return;
  ws.perdida = true;
  fecharPares();
  if (estado.acabou) return;
  recado("A conexão caiu. Voltando...");
  estado.tentativas++;
  setTimeout(conectar, Math.min(10000, 1000 * estado.tentativas));
}

setInterval(() => enviar({ t: "ping" }), 10000);

const TRATAR = {
  pronto(m) {
    estado.conexao = m.id;
    estado.ice = m.ice || [];
    estado.tentativas = 0;
    enviar({ t: "entrar", convite: codigo });
  },
  ice(m) { estado.ice = m.ice || []; },   // ASTRA-WS-001: o TURN chega só depois de entrar com o link válido
  bemvindo(m) {
    fecharPares();
    for (const p of m.pares) novoPar(p);
    desenhar();
  },
  entrou(m) { novoPar(m); desenhar(); },
  saiu(m) { removerPar(m.id); desenhar(); },
  estado(m) {
    const par = estado.pares.get(m.id);
    if (!par) return;
    par.nome = m.nome;
    par.transmitindo = !!m.transmitindo;
    par.pausado = !!m.pausado;
    par.ponte = par.transmitindo && !!m.ponte;
    if (par.ponte) assistirPonte(par); else fecharPonte(par);
    if (!par.transmitindo) tirarVideos(par);
    desenhar();
  },
  sinal(m) { recebeuSinal(m.de, m.dados); },
  ponte(m) {
    const par = estado.pares.get(m.emissor);
    if (par && par.esperaPonte) par.esperaPonte(m);
  },
  fim(m) {
    estado.acabou = true;
    fecharPares();
    recado(m.invalido ? "Esse link não vale mais. Peça um novo para quem está transmitindo."
                      : "A transmissão acabou.");
    try { estado.ws.close(); } catch (_) {}
  },
  expulso() {
    estado.acabou = true;
    fecharPares();
    recado("O dono da sala tirou você da sala.");
    try { estado.ws.close(); } catch (_) {}
  },
  erro(m) { if (m.msg) recado(m.msg); },
};

// ---------- conexões ----------
function novoPar(info) {
  if (info.id === estado.conexao || estado.pares.has(info.id) || info.visitante) return;
  const par = {
    id: info.id, nome: info.nome, transmitindo: !!info.transmitindo, pausado: !!info.pausado,
    ponte: !!(info.transmitindo && info.ponte),
    visitante: !!info.visitante,
    polido: estado.conexao < info.id, fazendoOferta: false, ignorarOferta: false,
    videos: new Map(),   // id da stream -> <video>
  };
  estado.pares.set(info.id, par);
  // 2.7.33: quem assiste pelo link sempre passa pelo repasse da Astra (ninguém vê o IP de ninguém)
  const pc = new RTCPeerConnection({ iceServers: estado.ice, iceTransportPolicy: "relay" });
  par.pc = pc;
  pc.onnegotiationneeded = async () => {
    try {
      par.fazendoOferta = true;
      await pc.setLocalDescription();
      enviar({ t: "sinal", para: par.id, dados: { descricao: pc.localDescription } });
    } catch (e) { console.warn("negociação", e); }
    finally { par.fazendoOferta = false; }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) enviar({ t: "sinal", para: par.id, dados: { candidato: candidate } });
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pc.restartIce(); };
  pc.ontrack = (ev) => receberFaixa(par, ev);
  if (par.ponte) assistirPonte(par);
}

// Tela no Modo leve: chega pela ponte da VPS, numa conexão separada (igual ao programa).
async function assistirPonte(par) {
  if (par.pcP || !estado.ice) return;
  const pc = new RTCPeerConnection({ iceServers: estado.ice });
  par.pcP = pc;
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (ev) => receberFaixa(par, ev);
  pc.onconnectionstatechange = () => {
    if (par.pcP !== pc) return;
    if (pc.connectionState === "connected") par.tentativasPonte = 0;
    if (pc.connectionState === "failed" || pc.connectionState === "closed") ponteDeNovo(par);
  };
  try {
    await pc.setLocalDescription();
    const r = await new Promise((resolver) => {
      par.esperaPonte = resolver;
      enviar({ t: "ponte", acao: "assistir", emissor: par.id, sdp: pc.localDescription.sdp });
      setTimeout(() => resolver({ erro: "sem resposta" }), 20000);
    });
    par.esperaPonte = null;
    if (par.pcP !== pc) return;
    if (r.erro || !r.sdp) throw new Error(r.erro || "sem resposta");
    await pc.setRemoteDescription({ type: "answer", sdp: r.sdp });
  } catch (e) {
    console.warn("ponte", e);
    if (par.pcP === pc) ponteDeNovo(par);
  }
}

function ponteDeNovo(par) {
  fecharPonte(par);
  par.tentativasPonte = (par.tentativasPonte || 0) + 1;
  if (par.tentativasPonte > 5) return recado("Não consegui abrir a tela pela ponte da VPS.");
  setTimeout(() => { if (estado.pares.get(par.id) === par && par.ponte) assistirPonte(par); }, 1500 * par.tentativasPonte);
}

function fecharPonte(par) {
  if (!par.pcP) return;
  par.pcP.close();
  par.pcP = null;
  const v = par.videos.get("astra-" + par.id);   // nome que a ponte dá para a tela
  if (v) { v.remove(); par.videos.delete("astra-" + par.id); desenhar(); }
}

async function recebeuSinal(de, dados) {
  const par = estado.pares.get(de);
  if (!par || !dados) return;
  if (dados.canal === "nativo") {   // quem transmite está no app Android
    if (dados.lado === "emissor") sinalNativo(par, dados);
    return;
  }
  const pc = par.pc;
  try {
    if (dados.descricao) {
      const d = dados.descricao;
      const colisao = d.type === "offer" && (par.fazendoOferta || pc.signalingState !== "stable");
      par.ignorarOferta = !par.polido && colisao;
      if (par.ignorarOferta) return;
      await pc.setRemoteDescription(d);
      if (d.type === "offer") {
        await pc.setLocalDescription();
        enviar({ t: "sinal", para: de, dados: { descricao: pc.localDescription } });
      }
    } else if (dados.candidato) {
      try { await pc.addIceCandidate(dados.candidato); }
      catch (e) { if (!par.ignorarOferta) throw e; }
    }
  } catch (e) { console.warn("sinal", e); }
}

// Tela de um celular: o celular faz a oferta numa conexão separada e aqui só se responde.
function sinalNativo(par, dados) {
  par.filaN = (par.filaN || Promise.resolve()).then(async () => {
    if (dados.fechar) { if (par.pcN) { par.pcN.close(); par.pcN = null; } return; }
    if (!par.pcN) {
      const pcN = new RTCPeerConnection({ iceServers: estado.ice, iceTransportPolicy: "relay" });
      pcN.onicecandidate = ({ candidate }) => {
        if (candidate) enviar({ t: "sinal", para: par.id, dados: { canal: "nativo", lado: "espectador", candidato: candidate } });
      };
      pcN.ontrack = (ev) => receberFaixa(par, ev);
      par.pcN = pcN;
    }
    const pcN = par.pcN;
    if (dados.descricao) {
      await pcN.setRemoteDescription(dados.descricao);
      if (dados.descricao.type === "offer") {
        await pcN.setLocalDescription();
        enviar({ t: "sinal", para: par.id, dados: { canal: "nativo", lado: "espectador", descricao: pcN.localDescription } });
      }
    } else if (dados.candidato) {
      await pcN.addIceCandidate(dados.candidato);
    }
  }).catch((e) => console.warn("sinal nativo", e));
}

function removerPar(id) {
  const par = estado.pares.get(id);
  if (!par) return;
  par.pc.close();
  if (par.pcN) par.pcN.close();
  fecharPonte(par);
  tirarVideos(par);
  estado.pares.delete(id);
}

function fecharPares() {
  for (const id of [...estado.pares.keys()]) removerPar(id);
  desenhar();
}

// ---------- vídeo ----------
// Nome no controle de mídia do celular (sem isso aparecia "null").
function nomeNaMidia(titulo) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titulo, artist: "Astra",
      artwork: [{ src: new URL("../icone-192.png", location.href).href, sizes: "192x192", type: "image/png" }],
    });
  } catch (_) {}
}

function receberFaixa(par, ev) {
  if (ev.track.kind !== "video") return;   // o som vem na mesma stream do vídeo
  nomeNaMidia(`Tela de ${par.nome}`);
  const stream = ev.streams[0] || new MediaStream([ev.track]);
  if (par.videos.has(stream.id)) return;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = estado.mudo;
  video.srcObject = stream;
  video.ondblclick = telaCheia;
  par.videos.set(stream.id, video);
  stream.onremovetrack = () => {
    if (!stream.getVideoTracks().length) { video.remove(); par.videos.delete(stream.id); desenhar(); }
  };
  $("palco").append(video);
  // Sem um clique antes (ex.: voltou sozinho depois de cair), o navegador pode
  // não deixar tocar com som: toca mudo e o botão de som libera.
  video.play().catch(() => { video.muted = true; estado.mudo = true; marcarSom(); video.play().catch(() => {}); });
  desenhar();
}

function tirarVideos(par) {
  for (const v of par.videos.values()) v.remove();
  par.videos.clear();
}

// Esta página aberta no mesmo navegador de quem está transmitindo a tela inteira
// entraria na própria live (efeito de espelho): aí a imagem fica escondida aqui.
const MSG_ESPELHO = "Você está transmitindo deste mesmo navegador. A imagem fica escondida aqui para não fazer efeito de espelho na live.";
let espelhoAte = 0;
try {
  const canal = new BroadcastChannel("astra-ao-vivo");
  canal.onmessage = () => { espelhoAte = Date.now() + 4000; marcarEspelho(); };
} catch (_) {}
setInterval(marcarEspelho, 1000);
function marcarEspelho() {
  const sim = Date.now() < espelhoAte;
  if (document.body.classList.contains("espelho") === sim) return;
  document.body.classList.toggle("espelho", sim);
  desenhar();
}

function desenhar() {
  if (estado.acabou) return;
  if (document.body.classList.contains("espelho")) return recado(MSG_ESPELHO);
  const videos = [...estado.pares.values()].reduce((n, p) => n + p.videos.size, 0);
  $("palco").classList.toggle("dois", videos > 1);
  const aoVivo = [...estado.pares.values()].filter((p) => p.transmitindo);
  if (!estado.conexao || (estado.ws && estado.ws.readyState !== WebSocket.OPEN)) return;
  if (aoVivo.some((p) => p.pausado)) recado(videos ? "" : "Transmissão pausada. Já volta.");
  else if (videos) recado("");
  else if (aoVivo.length) recado(`Carregando a tela de ${aoVivo[0].nome}...`);
  else recado("Esperando a transmissão começar...");
}

// ---------- botões ----------
function marcarSom() {
  $("bt-som").style.opacity = estado.mudo ? "0.5" : "1";
  $("bt-som").title = estado.mudo ? "Ligar o som" : "Tirar o som";
}

$("bt-som").addEventListener("click", () => {
  estado.mudo = !estado.mudo;
  for (const v of document.querySelectorAll("#palco video")) { v.muted = estado.mudo; v.play().catch(() => {}); }
  marcarSom();
});

function telaCheia() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$("bt-cheia").addEventListener("click", telaCheia);

// Os botões do canto aparecem quando o mouse mexe (ou ao tocar, no celular).
let timerMexeu = 0;
function mexeu() {
  document.body.classList.add("mexeu");
  clearTimeout(timerMexeu);
  timerMexeu = setTimeout(() => document.body.classList.remove("mexeu"), 2500);
}
document.addEventListener("mousemove", mexeu);
document.addEventListener("touchstart", mexeu, { passive: true });
