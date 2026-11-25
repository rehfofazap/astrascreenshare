// AstraScreenShare - transmissão de tela (WebRTC).
//
// Cada programa tem um ID de 9 dígitos e fica sempre ligado ao servidor da VPS,
// que mostra quem está online. Uma sala usa o ID de quem a criou. Dentro da
// sala, cada pessoa tem uma conexão direta (RTCPeerConnection) com cada uma das
// outras; quem transmite manda a tela para todas. O servidor só apresenta as
// pessoas (mensagens "sinal") e o TURN da VPS serve de ponte quando a rede não
// deixa a ligação direta. A negociação segue o padrão "perfect negotiation".
"use strict";

const QUALIDADES = {
  "720-30":  { largura: 1280, altura: 720,  qps: 30, bitrate: 2_500_000 },
  "1080-30": { largura: 1920, altura: 1080, qps: 30, bitrate: 4_500_000 },
  "1080-60": { largura: 1920, altura: 1080, qps: 60, bitrate: 8_000_000 },   // 2.7.11: o padrão (com a mesma taxa da antiga Automática)
  "orig-60": { largura: 3840, altura: 2160, qps: 60, bitrate: 10_000_000 },
  // v5: 4K de verdade (3840x2160) com taxa maior. Precisa de upload bom (uns 25 Mbps) e de quem assiste aguentar.
  "4k-60":   { largura: 3840, altura: 2160, qps: 60, bitrate: 20_000_000 },
  // 2.7.11: a "Automática" saiu do menu a pedido: o padrão é sempre 1920x1080 a 60 qps, sem
  // baixar a resolução. Quem tinha "auto" guardado (ou o celular) cai no 1080p 60.
  "auto":    { largura: 1920, altura: 1080, qps: 60, bitrate: 8_000_000 },
};
const NIVEIS_AUTO = [1, 1.5, 2];   // 1080p, 720p, 540p
const CORES = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#1abc9c", "#9b59b6", "#e67e22"];

const $ = (id) => document.getElementById(id);
// No programa de PC existe window.astra (preload do Electron); no app Android,
// celular.js cria um window.astra parecido; no site, não existe.
const programa = window.astra || null;
const celular = !!(programa && programa.celular);

const estado = {
  escondidas: new Set(),  // ids de quem transmite e eu escolhi não assistir
  ws: null,
  conexao: null,          // id desta conexão no servidor
  ice: [],
  meuId: "",              // ID de 9 dígitos
  nome: "",
  sala: "",               // ID da sala em que estou ("" = início)
  nomeSala: "",
  pares: new Map(),       // id da conexão -> par da sala
  online: [],
  salas: [],              // salas abertas (lista da tela inicial)
  esperando: "",          // sala em que pedi para entrar
  dono: "",               // conexão de quem aprova os pedidos da minha sala
  tela: null,             // MediaStream da minha tela (PC e site)
  telaNativa: "",         // id da transmissão feita pelo app Android (o vídeo sai do Java)
  relaxado: false,
  status: ["on", "aus", "ocu", "inv"].includes(localStorage.getItem("astra.status")) ? localStorage.getItem("astra.status") : "on",
  fotos: new Map(),       // ID de 9 dígitos -> versão da foto de perfil
  tentativas: 0,
  primeiraConexao: true,
};

// ---------- utilidades ----------
function guardar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (_) {} }
function ler(chave) { try { return localStorage.getItem(chave) || ""; } catch (_) { return ""; } }
function formatarId(id) { return (id || "").replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3"); }
function corDe(id) { let h = 0; for (const c of id || "") h = (h * 31 + c.charCodeAt(0)) >>> 0; return CORES[h % CORES.length]; }
function iniciais(nome) { return (nome || "?").split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase(); }

// ---------- tema (Escuro / All black), guardado só neste aparelho ----------
const TEMAS = ["", "preto", "claro"];
function aplicarTema(t) {
  if (!TEMAS.includes(t)) t = "";
  if (t) document.documentElement.dataset.tema = t; else delete document.documentElement.dataset.tema;
  document.querySelectorAll(".tema-op").forEach((b) => b.classList.toggle("ativo", b.dataset.tema === t));
}

// Programa do PC sem a barra do Windows: arrasta a janela pelo topo, e minimizar,
// maximizar e fechar são botões do Astra (seguem o tema).
if (programa && programa.janela && !celular) {
  document.documentElement.classList.add("sem-moldura");
  const barra = document.createElement("div");
  barra.className = "barra-janela";
  const ICONES = {
    min: '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    max: '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    restaurar: '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="1.8" y="3.8" width="6.4" height="6.4" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.2 2.2h4a1.8 1.8 0 0 1 1.8 1.8v4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    fechar: '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  };
  for (const [acao, titulo] of [["min", "Minimizar"], ["max", "Maximizar"], ["fechar", "Fechar (continua perto do relógio)"]]) {
    const bt = document.createElement("button");
    bt.type = "button"; bt.className = "bt-janela bt-janela-" + acao; bt.title = titulo; bt.setAttribute("aria-label", titulo);
    bt.innerHTML = ICONES[acao];
    bt.addEventListener("click", () => programa.janela(acao));
    barra.append(bt);
  }
  programa.aoMaximizar?.((sim) => {
    const bt = barra.querySelector(".bt-janela-max");
    bt.innerHTML = sim ? ICONES.restaurar : ICONES.max;
    bt.title = sim ? "Restaurar" : "Maximizar";
    document.documentElement.classList.toggle("maximizada", sim);
  });
  document.body.append(barra);
}
aplicarTema(ler("astra.tema"));

function souAoVivo() { return !!(estado.tela || estado.telaNativa); }
function meuTelaId() { return estado.tela ? estado.tela.id : estado.telaNativa; }

function enviar(msg) {
  if (estado.ws && estado.ws.readyState === WebSocket.OPEN) estado.ws.send(JSON.stringify(msg));
}

// Erros de JavaScript vão para os logs do dono (no máx. 10 por sessão, sem repetir; só a mensagem e onde).
(() => {
  let n = 0;
  const vistos = new Set();
  const mandar = (msg, onde, pilha) => {
    const k = msg + "|" + onde;
    if (n >= 10 || vistos.has(k)) return;
    vistos.add(k); n++;
    try {
      enviar({ t: "erro-app", msg: String(msg).slice(0, 200), onde: String(onde || "").slice(0, 120),
        pilha: String(pilha || "").split("\n").slice(1, 3).join(" | ").replace(/https?:\/\/[^/]+\//g, "").slice(0, 190),
        versao: (typeof programa !== "undefined" && programa && programa.versao) || "site" });
    } catch { /* sem conexão: deixa para lá */ }
  };
  addEventListener("error", (e) => {
    if (!e.message || e.message === "Script error.") return;   // erros de outros sites (anúncios, extensões) não dizem nada
    mandar(e.message, (e.filename || "").split("/").pop().split("?")[0] + ":" + e.lineno, e.error && e.error.stack);
  });
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    if (r && (r.name === "AbortError" || r.name === "NotAllowedError")) return;   // cancelado ou permissão negada: normal
    mandar((r && r.message) || String(r), "promise", r && r.stack);
  });
})();

function avatar(nome, id, aoVivo) {
  const a = document.createElement("span");
  a.className = "avatar" + (aoVivo ? " ao-vivo" : "");
  pintarAvatar(a, nome, id);
  return a;
}

// Cor com as iniciais, ou a foto de perfil (guardada na VPS) por cima.
function pintarAvatar(a, nome, id) {
  a.style.background = corDe(id);
  a.textContent = iniciais(nome);
  const url = fotoDe(id);
  a.classList.toggle("com-foto", !!url);
  if (url) a.style.backgroundImage = `url("${url}")`;
}

function fotoDe(id) {
  // A própria foto: a que acabou de salvar; senão a da VPS; a cópia do aparelho só quando a VPS não tem.
  // (3.0.8: antes a cópia do aparelho vinha primeiro, e o app de PC às vezes fecha sem gravá-la: voltava a foto velha.)
  if (id && id === estado.meuId && estado.fotoAgora) return estado.fotoAgora;
  if (id && id === estado.meuId && !estado.fotos.get(id) && ler("astra.foto")) return ler("astra.foto");
  const v = estado.fotos.get(id);
  if (!v || !/^\d{9}$/.test(id) || !/^[0-9a-f]+$/.test(v)) return "";
  return (programa ? programa.site.replace(/\/?$/, "/") : "./") + `foto/${id}?v=${v}`;
}

async function copiar(texto, msg) {
  try { await navigator.clipboard.writeText(texto); aviso({ titulo: msg }); }
  catch (_) { prompt("Copie:", texto); }
}

// Cartão de aviso no canto da tela (e aviso do Windows, no programa).
function aviso({ titulo, texto = "", imagem = "", botoes = [], tempo = 5000, windows = false, classe = "", aoClicar = null }) {
  const card = document.createElement("div");
  // 3.0.20: ao vivo com "Esconder notificações": nada de aviso solto na tela (aparecia na transmissão). Só os que
  // pedem uma resposta (com botões) continuam.
  if (estado.escondendoNaLive && !botoes.length) return card;
  card.className = "aviso-card " + classe;
  if (aoClicar) { card.style.cursor = "pointer"; card.onclick = () => { card.remove(); aoClicar(); }; }
  if (imagem instanceof Element) card.append(imagem);
  else if (imagem) { const img = document.createElement("img"); img.src = imagem; img.alt = ""; card.append(img); }
  const corpo = document.createElement("div");
  corpo.className = "corpo";
  const b = document.createElement("b"); b.textContent = titulo;
  corpo.append(b);
  if (texto) corpo.append(texto);
  if (botoes.length) {
    const linha = document.createElement("div");
    linha.className = "botoes";
    for (const bt of botoes) {
      const el = document.createElement("button");
      el.className = "bt pequeno " + (bt.classe || "");
      el.textContent = bt.texto;
      el.onclick = () => { card.remove(); bt.acao && bt.acao(); };
      linha.append(el);
    }
    corpo.append(linha);
  }
  card.append(corpo);
  // 3.0.20: a caixa de avisos vai para dentro do vídeo em tela cheia; se esse vídeo sai da página (a live acabou),
  // ela ia junto e todo aviso depois disso quebrava ("Cannot read properties of null (reading 'append')").
  let caixaAvisos = $("avisos");
  if (!caixaAvisos) {
    caixaAvisos = document.createElement("div");
    caixaAvisos.id = "avisos"; caixaAvisos.className = "avisos"; caixaAvisos.setAttribute("aria-live", "polite");
    (document.fullscreenElement || document.body).append(caixaAvisos);
  }
  caixaAvisos.append(card);
  if (!tempo) card.dataset.fixo = "1";   // pedidos e "esperando": só saem com um clique
  const soltos = [...caixaAvisos.children].filter((c) => !c.dataset.fixo);
  while (soltos.length > 4) soltos.shift().remove();
  if (tempo) setTimeout(() => card.remove(), tempo);
  if (windows && programa && estado.status !== "ocu" && !document.documentElement.classList.contains("travado")) programa.aviso(titulo, texto);   // "Não perturbe": sem notificação
  return card;
}

// 3.0.20: "Esconder notificações durante a live" (PC) = status "Não perturbe" da conta enquanto transmite.
// Não grava no aparelho: se o app fechar no meio, volta ao status de antes.
function statusDaLive(ligar) {
  if (ligar) {
    if (estado.status === "ocu" || estado.status === "inv") return;   // já está sem notificações / invisível
    estado.statusAntesDaLive = estado.status || "on";
    estado.status = "ocu";
  } else {
    if (!estado.statusAntesDaLive) return;
    estado.status = estado.statusAntesDaLive;
    estado.statusAntesDaLive = null;
  }
  enviar({ t: "status", s: estado.status });
  mostrarMeuNome();
  desenharSala();
  desenharOnline();
}

// ---------- status (bolinha no avatar, igual ao Discord) ----------
const STATUS = {
  on: { nome: "Online", dica: "" },
  aus: { nome: "Ausente", dica: "" },
  ocu: { nome: "Não perturbe", dica: "Sem notificações do Windows" },
  inv: { nome: "Invisível", dica: "Você some da lista de online" },
};

function pontoStatus(av, st) {
  let b = av.querySelector(":scope > .bolinha");
  if (!b) { b = document.createElement("span"); av.append(b); }
  b.className = "bolinha st-" + (STATUS[st] ? st : "on");
  b.title = STATUS[st] ? STATUS[st].nome : "Online";
}

function mudarStatus(st) {
  estado.statusAntesDaLive = null;   // a pessoa escolheu: não volta sozinho depois da live
  estado.status = st;
  guardar("astra.status", st);
  enviar({ t: "status", s: st });
  mostrarMeuNome();
  desenharSala();
  desenharOnline();
}

function abrirMenuStatus(ev) {
  ev.stopPropagation();
  ev.preventDefault();
  const menu = $("menu-status");
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = "";
  for (const [st, info] of Object.entries(STATUS)) {
    const bt = document.createElement("button");
    bt.type = "button";
    bt.className = "status-op" + (st === estado.status ? " ativo" : "");
    const bol = document.createElement("span"); bol.className = "bolinha st-" + st;
    const txt = document.createElement("span"); txt.className = "status-txt";
    const b = document.createElement("b"); b.textContent = info.nome;
    txt.append(b);
    if (info.dica) { const d = document.createElement("small"); d.textContent = info.dica; txt.append(d); }
    bt.append(bol, txt);
    bt.onclick = (e) => { e.stopPropagation(); menu.hidden = true; mudarStatus(st); };
    menu.append(bt);
  }
  menu.hidden = false;
}
document.addEventListener("click", (ev) => {
  const menu = $("menu-status");
  if (menu && !menu.hidden && !menu.contains(ev.target)) menu.hidden = true;
});

// ---------- meu ID e meu nome ----------
function prepararIdentidade() {
  let id = ler("astra.id");
  if (!/^\d{9}$/.test(id)) {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    id = String(100000000 + (n[0] % 900000000));
    guardar("astra.id", id);
  }
  estado.meuId = id;
  estado.nome = ler("astra.nome");
  mostrarMeuNome();
  if (!estado.nome) pedirNome();
}

// 2.7.33: nome de exibição (o que os outros veem; pode repetir) e nome de usuário (estado.nome: único,
// é por ele que te acham e te adicionam). Sem nome de exibição, aparece o de usuário.
estado.exibicao = ler("astra.exibicao");
function meuNome() { return estado.exibicao || estado.nome; }

function mostrarMeuNome() {
  $("txt-meu-nome").textContent = meuNome() || "...";
  $("txt-meu-nome").append(...principalDe(visualDe(estado.meuId, meuNome())));
  pintarAvatar($("meu-avatar"), meuNome(), estado.meuId);
  pontoStatus($("meu-avatar"), estado.status);
  $("txt-meu-status").textContent = STATUS[estado.status].nome;
  const cor = (perfilDe(estado.meuId) || {}).c;
  $("meu-avatar").classList.toggle("anel", !!cor);
  if (cor) $("meu-avatar").style.setProperty("--anel", cor);
}

// ---------- perfil (2.6) ----------
// Foto (parada em JPEG, e um GIF opcional que só se mexe no cartão), capa (foto, GIF ou
// degradê) que aparece discreta atrás do nome na lista, cor da moldura e do nick,
// e recado. As imagens são diminuídas aqui mesmo antes de ir para a VPS.
const DEGRADES = [
  "",
  "linear-gradient(120deg,#3a1c71,#d76d77,#ffaf7b)",
  "linear-gradient(120deg,#0b3d91,#00a8fc)",
  "linear-gradient(120deg,#0f5132,#23a55a,#a3e635)",
  "linear-gradient(120deg,#5b1a1a,#ed4245,#f0b232)",
  "linear-gradient(120deg,#2d1b69,#9b59b6,#eb459e)",
  "linear-gradient(120deg,#1e1f22,#6d6f78)",
];
const CORES_PERFIL = ["", "#ffffff", "#eb459e", "#00a8fc", "#23a55a", "#f0b232", "#ed4245", "#9b59b6", "#1abc9c"];
const RECADOS_PRONTOS = ["jogando", "ouvindo música", "ausente", "estudando", "não perturbe"];
// Recados prontos antigos vinham com emoji na frente: aparecem sem ele.
const EMOJI_ANTIGO = /^(🎮|🎧|💤|📚|🔴) (?=jogando$|ouvindo música$|ausente$|estudando$|não perturbe$)/u;
const GIF_FOTO_MAX = 2 * 1024 * 1024;
const GIF_CAPA_MAX = 3 * 1024 * 1024;
estado.perfis = new Map();   // ID de 9 dígitos -> perfil que veio da VPS

function siteBase() { return new URL(programa ? programa.site.replace(/\/?$/, "/") : "./", location.href).href; }
function urlMidia(tipo, id, v) {
  if (!v || !/^\d{9}$/.test(id) || !/^[0-9a-f]+$/.test(v)) return "";
  return siteBase() + `${tipo}/${id}?v=${v}`;
}
function guardarPerfilDe(id, p) {
  if (!id) return;
  if (p && typeof p === "object") estado.perfis.set(id, p); else estado.perfis.delete(id);
}
function perfilDe(id) { return estado.perfis.get(id) || null; }
function recadoDe(p) { return p && p.r && (!p.ra || p.ra * 1000 > Date.now()) ? p.r.replace(EMOJI_ANTIGO, "") : ""; }
function fundoCapa(p, id, animado) {
  if (!p) return "";
  const u = (animado && urlMidia("capagif", id, p.kg)) || urlMidia("capa", id, p.k);
  if (u) return `url("${u}")`;
  return DEGRADES[p.d] || "";
}

// Tudo o que se desenha de um perfil, num formato só (serve também para a prévia do editor).
// 2.7.33: cor do perfil só como #rgb/#rrggbb/#rrggbbaa (vai para o CSS). Números com limite.
// capa de música (SoundCloud/Spotify): só https limpo
const capaSegura = (u) => (typeof u === "string" && /^https:\/\/[^\s"'()\\<>]+$/i.test(u) ? u : "");
const corSegura = (c) => (typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "");
const numeroEntre = (n, min, max, padrao) => (Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Number(n))) : padrao);
function visualDe(id, nome) {
  const p = perfilDe(id) || {};
  const foto = fotoDe(id);
  return {
    id, nome, cor: corSegura(p.c), capa: fundoCapa(p, id, false), capaAnim: fundoCapa(p, id, true),
    y: numeroEntre(p.y, 0, 100, 50), forca: numeroEntre(p.f || 60, 0, 100, 60) / 100, foto, fotoAnim: urlMidia("fotogif", id, p.g) || foto,
    recado: recadoDe(p), tem: !!(p.c || p.k || p.d || p.g || p.r || p.i || p.ix),
    insignia: id === estado.meuId ? (estado.discord || {}).insignia || "" : p.i || "",
    apoiador: id === estado.meuId ? !!estado.apoiador : !!p.ap,
    verificado: id === estado.meuId ? !!(estado.discord || {}).conectado : !!p.vf,
    extras: id === estado.meuId ? estado.meusExtras || [] : Array.isArray(p.ix) ? p.ix : [],
    // 3.0.6: a principal que a pessoa escolheu (pp); se não tiver, a que o dono escolheu no painel
    principal: String(p.pp || ""),
    principalPadrao: String((id === estado.meuId ? estado.minhaPrincipal : p.ip) || ""),
    usuario: id === estado.meuId ? estado.nome || "" : String(((estado.online || []).find((x) => x.astraId === id) || {}).u || ""),
    esconder: Array.isArray(p.eh) ? p.eh.map(String) : [],   // 3.0.6: insígnias que a pessoa escondeu
  };
}

// Insígnia do servidor do Discord (FDS), ao lado do nick.
const INSIGNIAS = { tung: "Tung Tung Sahur", dono: "Dono do FDS", estrela: "Conta verificada pelo Discord" };
// 2.7.11: o dono pode trocar a imagem das insígnias fixas na página dele; aí vem da VPS.
let fixasVer = {};
function srcFixa(nome, local) {
  const v = fixasVer[nome];
  return /^[0-9a-f]{1,12}$/.test(v || "") ? siteBase() + `insignia-fixa/${nome}?v=${v}` : local;
}
function insigniaEl(i) {
  if (!INSIGNIAS[i]) return null;
  const img = document.createElement("img");
  img.className = "insignia";
  img.src = srcFixa(i, `insignias/${i}.png`);
  img.alt = INSIGNIAS[i];
  img.title = INSIGNIAS[i];
  img.draggable = false;
  return img;
}

// "Early Supporter": quem usa o Astra desde o começo. Ao passar o mouse aparece o título.
// 2.7.31: selo discreto de quem ligou a conta ao Discord (ajuda a saber que não é alguém se passando por outro).
// 3.0.6: o selo azul virou a insígnia "Conta verificada pelo Discord" (a antiga "Membro do FDS").
function verificadoEl() { const e = insigniaEl("estrela"); e.dataset.k = "estrela"; return e; }
function apoiadorEl() {
  const s = document.createElement("span");
  s.className = "insignia-ap";
  s.tabIndex = 0;
  s.setAttribute("aria-label", "Early Supporter");
  s.innerHTML = '<img class="insignia" alt="" draggable="false">';
  s.firstChild.src = srcFixa("apoiador", "insignias/apoiador.svg");
  return s;
}
// O título fica solto na tela (as listas cortam o que passa da borda).
const dicaAp = document.createElement("div");
dicaAp.className = "ap-titulo";
dicaAp.innerHTML = "<b>Early Supporter</b>";
document.body.append(dicaAp);
function mostrarDicaAp(ev) {
  const alvo = ev.target.closest?.(".insignia-ap, .ins-dica");
  if (!alvo) return;
  dicaAp.querySelector("b").textContent = alvo.dataset.nome || "Early Supporter";
  // Na fileira do cartão o nome aparece embaixo, para não cobrir o nick.
  const embaixo = !!alvo.closest(".cp-fila");
  dicaAp.classList.toggle("embaixo", embaixo);
  const r = alvo.getBoundingClientRect();
  dicaAp.style.left = Math.max(70, Math.min(innerWidth - 70, r.left + r.width / 2)) + "px";
  dicaAp.style.top = (embaixo ? r.bottom : r.top) + "px";
  dicaAp.classList.add("aberta");
}
function esconderDicaAp(ev) { if (ev.target.closest?.(".insignia-ap, .ins-dica")) dicaAp.classList.remove("aberta"); }
document.addEventListener("mouseover", mostrarDicaAp);
document.addEventListener("focusin", mostrarDicaAp);
document.addEventListener("mouseout", esconderDicaAp);
document.addEventListener("focusout", esconderDicaAp);
// Insígnias que o dono deu (criadas na página dele): imagem + nome ao passar o mouse.
function extrasEl(lista) {
  const l = [];
  for (const x of Array.isArray(lista) ? lista : []) {
    const [id, nome, ver] = Array.isArray(x) ? x : [];
    if (!/^[0-9a-f]{8}$/.test(id || "") || !/^[0-9a-f]+$/.test(ver || "")) continue;
    const img = document.createElement("img");
    img.className = "insignia insignia-extra";
    img.dataset.k = id;
    img.src = siteBase() + `insignia-extra/${id}?v=${ver}`;
    img.alt = img.title = String(nome || "").slice(0, 40);
    img.draggable = false;
    l.push(img);
  }
  return l;
}
// 2.7.11: a insígnia principal (o dono escolhe na página dele) vem primeiro.
// Chaves: tung / dono / estrela / apoiador / id de insígnia criada pelo dono.
function insigniasDe(v, max = Infinity, todas = false) {
  let l = [];
  const ins = v.verificado && v.insignia === "estrela" ? null : insigniaEl(v.insignia);   // não repete a estrela
  if (ins) { ins.dataset.k = v.insignia; l.push(ins); }
  if (v.apoiador) { const a = apoiadorEl(); a.dataset.k = "apoiador"; l.push(a); }
  const ex = extrasEl(v.extras);
  l.push(...ex);
  if (v.verificado) l.push(verificadoEl());   // por último: nas listas só aparece se não tiver outra (ou se for a principal)
  let i = v.principal ? l.findIndex((e) => e.dataset.k === v.principal && !v.esconder?.includes(v.principal)) : -1;
  if (i < 0 && v.principalPadrao) i = l.findIndex((e) => e.dataset.k === v.principalPadrao);
  if (i > 0) l.unshift(...l.splice(i, 1));
  if (!todas && v.esconder?.length) l = l.filter((e) => !v.esconder.includes(e.dataset.k));
  return juntarSobra(l, max);
}
// Na lista de online e no chat: só a principal, para nunca encher o nome.
function principalDe(v) { return insigniasDe(v).slice(0, 1); }
// No cartão (5C): a principal ao lado do nome e as outras numa fileira embaixo;
// passando o mouse, a insígnia cresce e mostra o nome dela.
function filaDeInsignias(l) {
  if (!l.length) return null;
  const f = document.createElement("div");
  f.className = "cp-fila";
  for (const e of l) {
    const nome = e.dataset.k === "apoiador" ? "Early Supporter" : e.alt || e.title || "";
    e.removeAttribute("title");
    e.classList.add("ins-dica");
    e.dataset.nome = nome;
    f.append(e);
  }
  return f;
}

// Muitas insígnias: mostra só as primeiras e um "+N"; o resto abre ao passar o mouse.
function juntarSobra(l, max) {
  if (l.length <= max) return l;
  const fica = l.slice(0, max - 1);
  const resto = l.slice(max - 1);
  const s = document.createElement("span");
  s.className = "ins-mais";
  s.tabIndex = 0;
  s.textContent = "+" + resto.length;
  s.setAttribute("aria-label", "Mais " + resto.length + " insígnias");
  const caixa = document.createElement("span");
  caixa.className = "ins-sobra";
  caixa.append(...resto);
  s.append(caixa);
  fica.push(s);
  return fica;
}

// 2.7.33: nicks raros (quanto mais curto, mais raro). Mesma regra do servidor.
const RARIDADES_NICK = [[2, "lendario", "Lendário"], [3, "epico", "Épico"], [4, "raro", "Raro"]];
function raridadeNick(nome) {
  const n = [...String(nome || "").toLowerCase().replace(/\s+/g, "")].length;
  const r = n ? RARIDADES_NICK.find(([ate]) => n <= ate) : null;
  return r ? { id: r[1], nome: r[2] } : null;
}
function seloRaro(nome) {
  return null;   // 2.7.39: sem o cristal de nick raro (só as insígnias normais)
  const r = raridadeNick(nome);
  if (!r) return null;
  const s = document.createElement("span");
  s.className = "nick-raro nr-" + r.id;
  s.title = `Nick ${r.nome}`;
  s.setAttribute("aria-label", `Nick ${r.nome}`);
  // 2.7.33: uma insígnia só (o cristal), para quem tem nome de usuário Raro, Épico ou Lendário
  s.innerHTML = '<svg viewBox="0 0 512 512" width="15" height="15" aria-hidden="true"><g stroke="#ffe37a" stroke-width="24" stroke-linecap="round"><path d="M133 22l16 20M379 22l-16 20M68 108l20 12M444 108l-20 12M28 256h22M462 256h22M68 404l20-12M444 404l-20-12M133 490l16-20M379 490l-16-20"/></g><path fill="#b77de0" d="M256 0L88 258l55-18z"/><path fill="#a865d8" d="M88 258l168 254-113-272z"/><path fill="#c58fe3" d="M256 0L143 240l35-15z"/><path fill="#dcb4ef" d="M256 0l-78 225h154z"/><path fill="#e8ccf5" d="M256 0l76 225 90 33z"/><path fill="#d9aeee" d="M143 240l35-15h154l90 33-166 254z"/><path fill="#c48de2" d="M143 240l35-15 78 287z"/><path fill="#ffd400" d="M355 110Q355 137 382 137Q355 137 355 164Q355 137 328 137Q355 137 355 110zM207 291Q207 318 234 318Q207 318 207 345Q207 318 180 318Q207 318 207 291z"/></svg>';
  return s;
}
// Selo de quem é da equipe do Astra (reh e larpinhosahur).
function seloEquipe() {
  const s = document.createElement("span");
  s.className = "selo-equipe";
  s.title = "Equipe Astra";
  s.setAttribute("aria-label", "Equipe Astra");
  // 2.7.39: escudo de administração no lugar do texto
  s.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><defs><linearGradient id="eq-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b5cff"/><stop offset="1" stop-color="#e0469b"/></linearGradient></defs><path fill="url(#eq-g)" d="M12 1.5 3.5 4.8v6.1c0 5.2 3.6 9.9 8.5 11.6 4.9-1.7 8.5-6.4 8.5-11.6V4.8z"/><path fill="#fff" d="m10.6 15.6-3.4-3.4 1.4-1.4 2 2 4.8-4.8 1.4 1.4z"/></svg>';
  return s;
}

// Item de lista (sala ou online): capa discreta atrás, cor no nick e moldura na foto.
function enfeitarItem(li, av, b, v) {
  const raro = seloRaro(v.usuario);
  if (raro) b.append(raro);
  b.append(...principalDe(v));
  if (v.cor) { av.classList.add("anel"); av.style.setProperty("--anel", v.cor); b.style.color = v.cor; }
  if (v.capa) {
    li.classList.add("viva");
    li.style.setProperty("--capa", v.capa);
    li.style.setProperty("--capa-y", v.y + "%");
    li.style.setProperty("--forca", v.forca.toFixed(2));
  }
}

// 3.0.21: o @ do cartão vira link para o Astra Perfil da pessoa (astrascreenshare.com/<página>).
// Só fica clicável se a conta tiver página no site com "Ver no Astra" ligado (pergunta ao Astra Perfil).
const slugDaConta = new Map();   // id -> { slug, quando } (guarda também "não tem", por 5 min)
function paginaDaConta(id) {
  const c = slugDaConta.get(id);
  if (c && Date.now() - c.quando < 300000) return c.p || (c.p = Promise.resolve(c.slug));
  const p = fetch(new URL("/perfil/api/conta/" + id, siteBase()).href, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : {})).then((j) => (/^[a-z0-9-]{3,32}$/.test(j.slug || "") ? j.slug : ""))
    .catch(() => "")
    .then((slug) => { slugDaConta.set(id, { slug, quando: Date.now(), p: Promise.resolve(slug) }); return slug; });
  slugDaConta.set(id, { slug: "", quando: Date.now(), p });
  return p;
}
function linkNoUsuario(el, id) {
  if (!/^\d{9}$/.test(id || "")) return;
  paginaDaConta(id).then((slug) => {
    if (!slug || !el.isConnected) return;
    const a = document.createElement("a");
    a.className = "cp-usuario-link";
    a.href = new URL("/" + slug, siteBase()).href;
    a.target = "_blank"; a.rel = "noopener noreferrer";
    a.title = "Abrir o perfil no site";
    const t = document.createElement("span"); t.textContent = el.textContent;
    const seta = document.createElement("span"); seta.className = "cp-usuario-seta"; seta.textContent = "↗"; seta.setAttribute("aria-hidden", "true");
    a.append(t, seta);
    a.addEventListener("click", (e) => { e.stopPropagation(); if (celular) { e.preventDefault(); location.href = a.href; } });
    el.textContent = "";
    el.append(a);
  });
}

function montarCartao(v) {
  const c = document.createElement("div");
  c.className = "cartao-perfil";
  c.style.setProperty("--brilho", v.cor || "#ffffff");
  const capa = document.createElement("div");
  capa.className = "cp-capa";
  if (v.capaAnim) { capa.style.backgroundImage = v.capaAnim; capa.style.backgroundPosition = `center ${v.y}%`; }
  else capa.classList.add("vazia");
  const corpo = document.createElement("div");
  corpo.className = "cp-corpo";
  const av = document.createElement("span");
  av.className = "avatar";
  av.style.background = corDe(v.id);
  av.textContent = iniciais(v.nome);
  if (v.fotoAnim) { av.classList.add("com-foto"); av.style.backgroundImage = `url("${v.fotoAnim}")`; }
  if (v.cor) av.style.setProperty("--anel", v.cor);
  // Banner "névoa" (2.7.3): sem fundo nem borda, a capa se desfaz no que estiver atrás.
  const faixa = document.createElement("div");
  faixa.className = "cp-faixa";
  const nome = document.createElement("div");
  nome.className = "cp-nome";
  const tx = document.createElement("span");
  tx.className = "cp-nick";
  tx.textContent = v.nome;
  if (v.cor) tx.style.color = v.cor;
  nome.append(tx);
  const raro = seloRaro(v.usuario);
  if (raro) nome.append(raro);
  const todas = insigniasDe(v);
  faixa.append(nome);
  const info = document.createElement("div");
  info.className = "cp-info";
  info.append(faixa);
  if (v.usuario) {   // 2.7.33: o nome de usuário (único) embaixo do nome de exibição
    const u = document.createElement("div");
    u.className = "cp-usuario";
    u.textContent = "@" + v.usuario;
    info.append(u);
    linkNoUsuario(u, v.id);
  }
  const fila = filaDeInsignias(todas);   // 2.7.39: todas as insígnias embaixo do perfil
  if (fila) info.append(fila);
  corpo.append(av, info);
  if (v.recado) {
    const r = document.createElement("div"); r.className = "cp-recado"; r.textContent = v.recado; corpo.append(r);
  }
  c.prepend(capa, corpo);
  return c;
}

// Cartãozinho ao passar o mouse (no celular, ao tocar na foto).
let cartaoEspera = 0, cartaoSaida = 0, cartaoDe = "";
function mostrarCartao(alvo, v) {
  const caixa = $("cartao-perfil");
  clearTimeout(cartaoSaida);
  cartaoDe = v.id || "";
  caixa.innerHTML = "";
  const novo = montarCartao(v);
  caixa.style.cssText = novo.style.cssText;
  caixa.append(...novo.childNodes);
  caixa.hidden = false;
  const r = alvo.getBoundingClientRect();
  const largura = caixa.offsetWidth, altura = caixa.offsetHeight;
  let x = r.right + 8;
  if (x + largura > innerWidth - 8) x = r.left - largura - 8;
  if (x < 8) x = Math.max(8, Math.min(innerWidth - largura - 8, r.left));
  const y = Math.max(8, Math.min(innerHeight - altura - 8, r.top));
  caixa.style.left = x + "px";
  caixa.style.top = y + "px";
  // 2.7.11: abre em camadas (só transparência e posição, leve para a placa de vídeo).
  caixa.classList.remove("abrindo");
  void caixa.offsetWidth;
  caixa.classList.add("abrindo");
}
function esconderCartao() { clearTimeout(cartaoEspera); clearTimeout(cartaoSaida); cartaoDe = ""; $("cartao-perfil").hidden = true; $("cartao-perfil").innerHTML = ""; }
// Sair da foto/nome não fecha na hora: dá tempo de levar o mouse até o cartão e ficar nele.
function esconderCartaoDepois() { clearTimeout(cartaoEspera); clearTimeout(cartaoSaida); cartaoSaida = setTimeout(esconderCartao, 300); }
$("cartao-perfil").addEventListener("mouseenter", () => clearTimeout(cartaoSaida));
$("cartao-perfil").addEventListener("mouseleave", esconderCartaoDepois);
function ligarCartao(alvo, toque, v) {
  if (!v.tem) return;
  alvo.addEventListener("mouseenter", () => {
    clearTimeout(cartaoEspera); clearTimeout(cartaoSaida);
    // A lista se redesenha sozinha (status, quem entrou): se o cartão já é dessa pessoa, só fica.
    if (!$("cartao-perfil").hidden && cartaoDe === v.id) return;
    cartaoEspera = setTimeout(() => mostrarCartao(alvo, v), 350);
  });
  alvo.addEventListener("mouseleave", esconderCartaoDepois);
  toque.addEventListener("click", (e) => {
    if (!matchMedia("(hover: none)").matches) return;
    e.stopPropagation();
    if (!$("cartao-perfil").hidden) esconderCartao(); else mostrarCartao(alvo, v);
  });
}
document.addEventListener("click", () => { if (!$("cartao-perfil").hidden) esconderCartao(); });
document.addEventListener("scroll", esconderCartao, true);

// ----- editor -----
let rasc = null;   // o que está sendo editado (só vale depois de "Salvar perfil")
function abrirFoto() {
  mostrarMeuNome();
  const p = perfilDe(estado.meuId) || {};
  const ra = p.ra && p.ra * 1000 > Date.now() ? p.ra : 0;
  rasc = {
    // 3.0.8: com capa de imagem, o degradê guardado não vale (perfis que ficaram com os dois por causa do erro antigo)
    c: p.c || "", f: p.f || 60, d: (p.k || p.kg) ? 0 : (p.d || 0), y: p.y ?? 50, r: recadoDe(p),
    foto: undefined, capa: undefined,   // undefined = não mexeu; "" = tirar; {jpeg, gif}
    temFoto: !!(ler("astra.foto") || estado.fotos.get(estado.meuId)),
    capaAtual: urlMidia("capagif", estado.meuId, p.kg) || urlMidia("capa", estado.meuId, p.k),
    eh: Array.isArray(p.eh) ? p.eh.map(String) : [],
    recadoOriginal: recadoDe(p), prazoOriginal: ra,
  };
  $("in-forca").value = rasc.f;
  $("in-recado").value = rasc.r;
  $("sel-recado-horas").value = "0";
  const manter = $("sel-recado-horas").querySelector('[value="-1"]');
  if (manter) manter.remove();
  if (ra) {
    const op = document.createElement("option");
    op.value = "-1";
    const horas = Math.max(1, Math.round((ra * 1000 - Date.now()) / 3600000));
    op.textContent = `Some em ~${horas} h`;
    $("sel-recado-horas").prepend(op);
    $("sel-recado-horas").value = "-1";
  }
  desenharEditor();
  desenharDiscord();
  enviar({ t: "discord", acao: "ver" });   // renova o link do botão
  $("modal-foto").hidden = false;
}


function capaDoRascunho(animado) {
  if (rasc.capa === "") return DEGRADES[rasc.d] || "";
  if (rasc.capa) return `url("${(animado && rasc.capa.gif) || rasc.capa.jpeg}")`;
  if (rasc.d) return DEGRADES[rasc.d];
  return rasc.capaAtual ? `url("${rasc.capaAtual}")` : "";
}
function visualDoRascunho() {
  let foto = fotoDe(estado.meuId), fotoAnim = urlMidia("fotogif", estado.meuId, (perfilDe(estado.meuId) || {}).g) || foto;
  if (rasc.foto === "") foto = fotoAnim = "";
  else if (rasc.foto) { foto = rasc.foto.jpeg; fotoAnim = rasc.foto.gif || rasc.foto.jpeg; }
  return {
    id: estado.meuId, nome: meuNome(), cor: rasc.c, capa: capaDoRascunho(false), capaAnim: capaDoRascunho(true),
    y: rasc.y, forca: rasc.f / 100, foto, fotoAnim, recado: rasc.r, tem: true,
    ...(({ insignia, apoiador, verificado, extras, principal, principalPadrao, usuario }) => ({ insignia, apoiador, verificado, extras, principal, principalPadrao, usuario }))(visualDe(estado.meuId, meuNome())),
    esconder: rasc.eh,
  };
}

function desenharEditor() {
  const v = visualDoRascunho();
  // foto
  const fp = $("foto-previa");
  fp.style.background = corDe(estado.meuId);
  fp.textContent = iniciais(meuNome());
  fp.classList.toggle("com-foto", !!v.fotoAnim);
  if (v.fotoAnim) fp.style.backgroundImage = `url("${v.fotoAnim}")`;
  $("foto-remover").hidden = !v.foto;
  // capa
  const ed = $("capa-editor");
  ed.style.backgroundImage = v.capaAnim || "none";
  ed.style.backgroundPosition = `center ${rasc.y}%`;
  $("capa-dica").textContent = v.capaAnim ? "Arraste para ajustar a posição" : "Sem capa";
  $("capa-remover").hidden = !v.capaAnim;
  const deg = $("capa-degrades");
  deg.innerHTML = "";
  DEGRADES.forEach((g, i) => {
    if (!i) return;
    const bt = document.createElement("button");
    bt.type = "button";
    bt.title = "Usar este degradê";
    bt.style.backgroundImage = g;
    bt.classList.toggle("ativo", rasc.d === i && !rasc.capa && (rasc.capa === "" || !rasc.capaAtual));
    bt.onclick = () => { rasc.d = i; rasc.capa = ""; rasc.capaAtual = ""; desenharEditor(); };
    deg.append(bt);
  });
  // cores
  const cores = $("perfil-cores");
  cores.innerHTML = "";
  for (const cor of CORES_PERFIL) {
    const bt = document.createElement("button");
    bt.type = "button";
    if (cor) { bt.style.background = cor; bt.title = cor; } else { bt.className = "nenhuma"; bt.title = "Sem cor"; }
    bt.classList.toggle("ativo", rasc.c === cor);
    bt.onclick = () => { rasc.c = cor; desenharEditor(); };
    cores.append(bt);
  }
  // recados prontos
  const prontos = $("recados-prontos");
  if (!prontos.childElementCount) {
    for (const r of RECADOS_PRONTOS) {
      const bt = document.createElement("button");
      bt.type = "button"; bt.className = "chip"; bt.textContent = r;
      bt.onclick = () => { $("in-recado").value = r; rasc.r = r; desenharPrevia(); };
      prontos.append(bt);
    }
  }
  desenharPrevia();
}

function desenharPrevia() {
  const v = visualDoRascunho();
  const ul = $("previa-lista");
  ul.innerHTML = "";
  const li = document.createElement("li");
  const av = document.createElement("span");
  av.className = "avatar";
  av.style.background = corDe(v.id);
  av.textContent = iniciais(v.nome);
  if (v.foto) { av.classList.add("com-foto"); av.style.backgroundImage = `url("${v.foto}")`; }
  const nome = document.createElement("span"); nome.className = "nome";
  const b = document.createElement("b"); b.textContent = v.nome || "Você";
  const s = document.createElement("small"); s.textContent = v.recado || "Assistindo";
  nome.append(b, s);
  li.append(av, nome);
  enfeitarItem(li, av, b, v);
  ul.append(li);
  const cartao = $("previa-cartao");
  cartao.innerHTML = "";
  cartao.append(montarCartao(v));
}

$("in-forca").addEventListener("input", () => { rasc.f = Number($("in-forca").value); desenharPrevia(); });
$("in-recado").addEventListener("input", () => { rasc.r = $("in-recado").value.trim(); desenharPrevia(); });

// Arrastar a capa para cima e para baixo escolhe a parte que aparece.
(() => {
  const ed = $("capa-editor");
  let inicio = null;
  ed.addEventListener("pointerdown", (e) => {
    if (!rasc || !capaDoRascunho(false).startsWith("url")) return;
    inicio = { y: e.clientY, valor: rasc.y };
    ed.setPointerCapture(e.pointerId);
  });
  ed.addEventListener("pointermove", (e) => {
    if (!inicio) return;
    rasc.y = Math.round(Math.max(0, Math.min(100, inicio.valor - (e.clientY - inicio.y) / 1.5)));
    ed.style.backgroundPosition = `center ${rasc.y}%`;
  });
  const soltar = () => { if (inicio) { inicio = null; desenharPrevia(); } };
  ed.addEventListener("pointerup", soltar);
  ed.addEventListener("pointercancel", soltar);
})();

function lerImagem(arquivo) {
  return new Promise((ok, falhou) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => ok({ img, url: leitor.result });
      img.onerror = () => falhou(new Error("imagem"));
      img.src = leitor.result;
    };
    leitor.onerror = () => falhou(new Error("leitura"));
    leitor.readAsDataURL(arquivo);
  });
}

// Foto: quadrado de 160 px. Capa: até 720 px de largura (e 3 por 1 no máximo de altura).
async function prepararImagem(arquivo, tipo) {
  let lida;
  try { lida = await lerImagem(arquivo); }
  catch (_) { aviso({ titulo: "Não consegui abrir essa imagem.", texto: "Tente uma foto JPG, PNG ou um GIF." }); return null; }
  const { img } = lida;
  const tela = document.createElement("canvas");
  const ctx = tela.getContext("2d");
  if (tipo === "foto") {
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    tela.width = tela.height = 160;
    ctx.fillStyle = "#1e1f22";
    ctx.fillRect(0, 0, 160, 160);
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, 160, 160);
  } else {
    const escala = Math.min(1, 720 / img.naturalWidth);
    tela.width = Math.max(1, Math.round(img.naturalWidth * escala));
    tela.height = Math.max(1, Math.round(Math.min(img.naturalHeight * escala, tela.width * 1.5)));
    const altOrig = tela.height / escala;
    ctx.drawImage(img, 0, (img.naturalHeight - altOrig) / 2, img.naturalWidth, altOrig, 0, 0, tela.width, tela.height);
  }
  let jpeg = tela.toDataURL("image/jpeg", 0.85);
  const limite = tipo === "foto" ? 60000 : 380000;
  if (jpeg.length > limite) jpeg = tela.toDataURL("image/jpeg", 0.6);
  let gif = null;
  if (arquivo.type === "image/gif") {
    const maximo = tipo === "foto" ? GIF_FOTO_MAX : GIF_CAPA_MAX;
    if (arquivo.size > maximo) {
      aviso({ titulo: `GIF grande demais (máximo ${maximo / 1048576} MB).`, texto: "Ele vai ficar parado. Tente um GIF menor para ele se mexer.", tempo: 7000 });
    } else gif = lida.url;
  }
  return { jpeg, gif };
}

$("foto-escolher").addEventListener("click", () => $("in-foto").click());
$("in-foto").addEventListener("change", async () => {
  const arquivo = $("in-foto").files[0];
  $("in-foto").value = "";
  if (!arquivo) return;
  const pronto = await prepararImagem(arquivo, "foto");
  if (pronto) { rasc.foto = pronto; desenharEditor(); }
});
$("foto-remover").addEventListener("click", () => { rasc.foto = ""; desenharEditor(); });
$("capa-escolher").addEventListener("click", () => $("in-capa").click());
$("in-capa").addEventListener("change", async () => {
  const arquivo = $("in-capa").files[0];
  $("in-capa").value = "";
  if (!arquivo) return;
  const pronto = await prepararImagem(arquivo, "capa");
  if (pronto) { rasc.capa = pronto; rasc.d = 0; rasc.y = 50; desenharEditor(); }
});
$("capa-remover").addEventListener("click", () => { rasc.capa = ""; rasc.d = 0; rasc.capaAtual = ""; desenharEditor(); });
$("foto-fechar").addEventListener("click", () => { $("modal-foto").hidden = true; rasc = null; });

function enviarMidia(tipo, dataUrl) {
  enviar({ t: "midia", tipo, dados: dataUrl ? dataUrl.split(",")[1] : "" });
}
function guardarGrande(chave, valor) {
  try { if (valor) localStorage.setItem(chave, valor); else localStorage.removeItem(chave); } catch (_) { try { localStorage.removeItem(chave); } catch (_) {} }
}

$("perfil-salvar").addEventListener("click", () => {
  if (!rasc) return;
  const p = perfilDe(estado.meuId) || {};
  if (rasc.foto !== undefined) {
    if (rasc.foto) guardarFoto(rasc.foto.jpeg);
    else { try { localStorage.removeItem("astra.foto"); } catch (_) {} estado.fotos.delete(estado.meuId); }
    estado.fotoAgora = rasc.foto ? rasc.foto.jpeg : "";
    mandarFoto(rasc.foto ? rasc.foto.jpeg : "");   // direto da memória: não depende de o navegador ter guardado
    const gif = rasc.foto ? rasc.foto.gif : null;
    guardarGrande("astra.fotogif", gif);
    if (gif || p.g) enviarMidia("fotogif", gif);
  }
  if (rasc.capa !== undefined) {
    const jpeg = rasc.capa ? rasc.capa.jpeg : null, gif = rasc.capa ? rasc.capa.gif : null;
    guardarGrande("astra.capa", jpeg);
    guardarGrande("astra.capagif", gif);
    if (jpeg || p.k) enviarMidia("capa", jpeg);
    if (gif || p.kg) enviarMidia("capagif", gif);
  }
  const horas = Number($("sel-recado-horas").value);
  const texto = {
    cor: rasc.c, forca: rasc.f, degrade: rasc.capa || (rasc.capa === undefined && rasc.capaAtual) ? 0 : rasc.d,
    capaY: rasc.y, recado: rasc.r, sobre: "", esconder: rasc.eh,
    principal: String((perfilDe(estado.meuId) || {}).pp || ""),
    recadoHoras: horas > 0 ? horas : 0, manterPrazo: horas === -1 && rasc.r === rasc.recadoOriginal,
  };
  const prazo = horas > 0 ? Date.now() + horas * 3600000 : texto.manterPrazo ? rasc.prazoOriginal * 1000 : 0;
  guardar("astra.perfil", JSON.stringify({ ...texto, manterPrazo: false, recadoHoras: 0, prazo }));
  enviar({ t: "perfil", ...texto });
  if (rasc.foto !== undefined) { mostrarMeuNome(); desenharOnline(); }
  $("modal-foto").hidden = true;
  rasc = null;
});

// A VPS perdeu o perfil (ou é a primeira vez nesta VPS): manda a cópia do aparelho.
function recuperarPerfil(p) {
  p = p || {};
  if (!p.k && ler("astra.capa") && !p.d) enviarMidia("capa", ler("astra.capa"));
  if (!p.kg && ler("astra.capagif")) enviarMidia("capagif", ler("astra.capagif"));
  if (!p.g && ler("astra.fotogif") && ler("astra.foto")) enviarMidia("fotogif", ler("astra.fotogif"));
  const temTexto = p.c || p.d || p.r || p.f;
  if (!temTexto && ler("astra.perfil")) {
    try {
      const copia = JSON.parse(ler("astra.perfil"));
      // Recado com prazo: se já venceu, não volta; se não, some mais ou menos na mesma hora.
      if (copia.prazo) {
        const faltam = (copia.prazo - Date.now()) / 3600000;
        if (faltam <= 0) copia.recado = "";
        else copia.recadoHoras = [1, 4, 8, 24].find((h) => h >= faltam) || 24;
      }
      enviar({ t: "perfil", ...copia });
    } catch (_) {}
  }
}

// ----- Conectar com o Discord (opcional) -----
// O botão abre /discord/entrar no navegador; a VPS confere no Discord se a pessoa está
// no servidor e avisa o programa por aqui (mensagem "discord").
estado.discord = { ligado: false };
function desenharDiscord() {
  const d = estado.discord;
  $("discord-secao").hidden = !d.ligado;
  const caixa = $("discord-caixa");
  caixa.innerHTML = "";
  const texto = document.createElement("div");
  texto.className = "discord-texto" + (d.conectado ? (d.membro ? " ok" : " nao") : "");
  const botoes = document.createElement("div");
  botoes.className = "perfil-linha";
  const botao = (rotulo, classe, acao) => {
    const bt = document.createElement("button");
    bt.type = "button"; bt.className = "bt pequeno " + classe; bt.textContent = rotulo; bt.onclick = acao;
    botoes.append(bt);
  };
  if (!d.conectado) {
    texto.textContent = "Conecte o seu Discord para ganhar o selo \"Conta verificada pelo Discord\" e poder entrar pelo Discord no site.";
    botao("Conectar com o Discord", "discord", abrirDiscord);
  } else {
    texto.textContent = `✓ Discord conectado como ${d.nome}.`;
    botao("Conectar de novo", "secundario", abrirDiscord);
    botao("Desconectar", "perigo", () => enviar({ t: "discord", acao: "desconectar" }));
  }
  const dica = document.createElement("div");
  dica.className = "perfil-fraco";
  dica.textContent = "O Astra só confere em quais servidores você está. Não vê mensagens, senha nem amigos.";
  caixa.append(texto, botoes, dica);
}
function abrirDiscord() {
  const d = estado.discord;
  if (!d.chave) return;
  const url = siteBase() + "discord/entrar?c=" + encodeURIComponent(d.chave);
  if (celular) location.href = url;          // o app Android abre links de fora no navegador
  else window.open(url, "_blank", "noopener");
  aviso({ titulo: "Abrimos o Discord no navegador", texto: "Clique em Autorizar e depois volte para cá.", tempo: 8000 });
}

function redesenharPerfis() {
  mostrarMeuNome();
  desenharOnline();
  if (estado.sala) desenharSala();
}

// Guarda a cópia da foto no aparelho. Com o armazenamento cheio (o Safari do iPhone dá ~5 MB e os GIFs de
// capa/foto ocupam quase tudo), solta as cópias grandes (a VPS já tem todas) e tenta de novo.
function guardarFoto(jpeg) {
  try { localStorage.setItem("astra.foto", jpeg); return; } catch (_) {}
  for (const k of ["astra.capagif", "astra.fotogif", "astra.capa"]) { try { localStorage.removeItem(k); } catch (_) {} }
  try { localStorage.setItem("astra.foto", jpeg); } catch (_) {}
}

function mandarFoto(dados = ler("astra.foto")) {
  enviar({ t: "foto", dados: dados ? dados.split(",")[1] : "" });
}

$("meu-avatar").addEventListener("click", abrirFoto);


// Uma frase discreta embaixo do campo do nick (muda cada vez que a janela abre).
const FRASES_NICK = [
  "As mensagens da sala somem quando a sala fecha.",
  "Sem anúncio e sem vender seus dados.",
  "Em sala pública, a tela passa pelo servidor da Astra para esconder o seu IP.",
  "Servidor próprio: sua tela não passa por nenhuma big tech.",
  "As imagens do chat são apagadas quando todos saem da sala.",
  "Seu nick é só seu: ninguém pode usar o mesmo.",
  "O código do programa de PC é publicado: qualquer um pode conferir.",
  "Rejeite as big techs.",
];

function pedirNome() {
  $("frase-nick").textContent = FRASES_NICK[Math.floor(Math.random() * FRASES_NICK.length)];
  $("in-nome").value = estado.nome || (programa && programa.usuario) || "";
  $("modal-nome").hidden = false;
  $("in-nome").focus();
  $("in-nome").select();
}

$("form-nome").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const nome = $("in-nome").value.trim().slice(0, 24);
  if (!nome) return;
  $("msg-nome").textContent = "";
  if (!estado.ws) {
    // Primeira vez: o servidor confere o nick quando conectar (TRATAR.pronto).
    estado.nome = nome;
    guardar("astra.nome", nome);
    $("modal-nome").hidden = true;
    mostrarMeuNome();
    conectar();
  } else if (estado.ws.readyState !== WebSocket.OPEN) {
    $("msg-nome").textContent = "Sem conexão com o servidor. Tente de novo em instantes.";
  } else {
    enviar({ t: "nome", nome });   // a resposta vem em TRATAR.nick
  }
});

// O servidor respondeu se o nick está livre.
function respostaNick(m) {
  $("nick-acao")?.remove();
  if (!m.ok) {
    $("msg-nome").textContent = m.msg;
    // 2.7.33: nick raro livre (botão de comprar) ou trocar um nick raro (confirmar que vai perder)
    if ((m.raro && !m.semMoedas) || m.perder) {
      const b = document.createElement("button");
      b.type = "button"; b.id = "nick-acao"; b.className = "bt primario pequeno nick-acao";
      b.textContent = m.perder ? "Trocar mesmo assim" : `Comprar por ${Number(m.preco).toLocaleString("pt-BR")} AstraDoll`;
      b.onclick = () => {
        b.disabled = true;
        enviar({ t: "nome", nome: m.nome, confirmarPerder: true, ...(m.perder ? {} : { comprar: true }) });
      };
      $("msg-nome").after(b);
    }
    $("modal-nome").hidden = false;
    $("in-nome").focus();
    return;
  }
  estado.nome = m.nome;
  guardar("astra.nome", m.nome);
  $("modal-nome").hidden = true;
  $("msg-nome").textContent = "";
  mostrarMeuNome();
}
$("bt-meu-nome").addEventListener("click", pedirNome);

// ---------- baixar a versão mais nova ----------
// A VPS diz no "pronto" qual é o instalador mais novo do PC e do Android. No programa
// e no app, se o deles for mais novo que o desta cópia, o botão vira "Atualizar".
const MEU_TIPO = celular ? "android" : programa ? "pc" : "";
const MEU_DISP = celular ? "celular" : programa ? "desktop" : "navegador";   // vai no "ola" (lista de membros)
const MINHA_VERSAO = (programa && programa.versao) || "";

// "livre", no cantinho do rodapé: abre uma janelinha simples sobre o programa.
// No topo fica só a versão (o "livre" foi para Configurações > Sobre o Astra).
if (MINHA_VERSAO) $("bt-livre").textContent = `v${MINHA_VERSAO}`; else $("bt-livre").hidden = true;
$("livre-versao").textContent = MINHA_VERSAO ? `v${MINHA_VERSAO}` : "";
$("bt-livre").addEventListener("click", () => { $("modal-livre").hidden = false; });
$("livre-fechar").addEventListener("click", () => { $("modal-livre").hidden = true; });
$("modal-livre").addEventListener("click", (ev) => { if (ev.target === $("modal-livre")) $("modal-livre").hidden = true; });
// ---------- fale com o dono (ideias e problemas) ----------
// Um botão perto do nome abre uma caixinha; o texto vai para a VPS e o dono lê na página
// dele (/relatos). A chave sorteada do aparelho só serve para juntar as mensagens da mesma pessoa.
let tipoRelato = "ideia";
function chaveConversa() {
  let c = ler("astra.relatoChave");
  if (!/^[a-f0-9]{32}$/.test(c)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    c = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    guardar("astra.relatoChave", c);
  }
  return c;
}
function escolherTipoRelato(tipo) {
  tipoRelato = tipo;
  for (const b of document.querySelectorAll(".relato-tipo")) {
    b.classList.toggle("ativo", b.dataset.tipo === tipo);
    b.setAttribute("aria-checked", String(b.dataset.tipo === tipo));
  }
  $("relato-texto").placeholder = tipo === "problema"
    ? "O que aconteceu? O que você estava fazendo na hora?"
    : tipo === "sugestao" ? "O que dá para melhorar no Astra? Conte com detalhes." : "O que você gostaria que o Astra tivesse?";
}
for (const b of document.querySelectorAll(".relato-tipo")) b.addEventListener("click", () => escolherTipoRelato(b.dataset.tipo));
$("bt-tema").addEventListener("click", () => { aplicarTema(ler("astra.tema")); $("modal-tema").hidden = false; });
$("tema-fechar").addEventListener("click", () => { $("modal-tema").hidden = true; });
$("modal-tema").addEventListener("click", (ev) => { if (ev.target === $("modal-tema")) $("modal-tema").hidden = true; });
document.querySelectorAll(".tema-op").forEach((b) => b.addEventListener("click", () => { guardar("astra.tema", b.dataset.tema); aplicarTema(b.dataset.tema); }));
function fecharRelato() { $("modal-relato").hidden = true; }
$("trilho-sugestao")?.addEventListener("click", () => { $("bt-relato").click(); escolherTipoRelato("sugestao"); });
$("bt-relato").addEventListener("click", () => {
  escolherTipoRelato("ideia");
  $("relato-msg").textContent = "";
  $("relato-enviar").disabled = false;
  $("modal-relato").hidden = false;
  $("relato-texto").focus();
});
$("relato-cancelar").addEventListener("click", fecharRelato);
$("modal-relato").addEventListener("click", (ev) => { if (ev.target === $("modal-relato")) fecharRelato(); });
$("form-relato").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const texto = $("relato-texto").value.trim();
  if (texto.length < 5) { $("relato-msg").textContent = "Escreva um pouco mais."; return; }
  if (!estado.ws || estado.ws.readyState !== WebSocket.OPEN) {
    $("relato-msg").textContent = "Sem conexão com o servidor. Tente de novo daqui a pouco.";
    return;
  }
  enviar({ t: "relato", tipo: tipoRelato, texto, conversa: chaveConversa(), versao: MINHA_VERSAO,
           onde: celular ? "celular" : programa ? "pc" : "site" });
  $("relato-enviar").disabled = true;
  $("relato-msg").textContent = "Enviando...";
});

// ---------- novidades (patch notes) ----------
// O dono publica pela página dele; cada pessoa vê uma vez, num bloquinho no canto, ao entrar.
// "#HASHTAG" em maiúsculas (com ou sem parênteses) vira uma bandeirinha tremulando.
function textoComBandeiras(el, texto) {
  const re = /\(?#([A-Z0-9ÁÀÂÃÉÊÍÓÔÕÚÇ_]{3,40})\)?/g;
  let ult = 0, m;
  while ((m = re.exec(texto))) {
    if (m.index > ult) el.append(texto.slice(ult, m.index));
    const f = document.createElement("span");
    f.className = "bandeira";
    f.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 1.5v13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path class="bandeira-pano" d="M3.8 2.2c2.6-1.2 4.4 1 7 0 .6-.2 1.2-.5 1.7-.8v6.8c-.5.3-1.1.6-1.7.8-2.6 1-4.4-1.2-7 0z" fill="currentColor"/></svg><span></span>';
    f.lastChild.textContent = "#" + m[1];
    el.append(f);
    ult = re.lastIndex;
  }
  if (ult < texto.length) el.append(texto.slice(ult));
}
// 2.7.23: as novidades vão para a caixa de correio (envelope do topo, bolinha até ler).
// O bloquinho antigo (#novidades) só aparece se o correio.js não estiver carregado.
function mostrarNovidades(itens) {
  if (window.correioNovidades) return window.correioNovidades(itens);
  const vistas = new Set(ler("astra.novidadesVistas").split(",").filter(Boolean));
  const novas = (itens || []).filter((n) => n && n.id && !vistas.has(n.id)).slice(-3).reverse();
  if (!novas.length) return;
  const lista = $("novidades-lista");
  lista.innerHTML = "";
  for (const n of novas) {
    const d = document.createElement("div");
    d.className = "novidade";
    const b = document.createElement("b"); b.textContent = n.titulo || "Atualização";
    const p = document.createElement("p"); textoComBandeiras(p, n.texto || "");
    d.append(b, p);
    if (n.por) {
      const s = document.createElement("small");
      s.textContent = `Feito a pedido de ${n.por}`;
      d.append(s);
    }
    lista.append(d);
  }
  $("novidades").dataset.ids = novas.map((n) => n.id).join(",");
  $("novidades").hidden = false;
}
$("novidades-fechar").addEventListener("click", () => {
  const vistas = ler("astra.novidadesVistas").split(",").filter(Boolean);
  for (const id of ($("novidades").dataset.ids || "").split(",")) if (id && !vistas.includes(id)) vistas.push(id);
  guardar("astra.novidadesVistas", vistas.slice(-60).join(","));
  $("novidades").hidden = true;
});

const NOMES_TIPO = { pc: "PC (Windows)", android: "Celular (Android)" };
if (programa) $("bt-baixar").hidden = true;   // aparece só quando a VPS avisar de versão nova

function versaoMaior(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function temAtualizacao() {
  const novo = MEU_TIPO && estado.baixar && estado.baixar[MEU_TIPO];
  return !!(novo && MINHA_VERSAO && versaoMaior(novo.versao, MINHA_VERSAO));
}

function linkBaixar(tipo) {
  // No site o endereço é o próprio servidor; no programa e no app, o SITE da config.
  return (programa ? programa.site.replace(/\/?$/, "/") : "./") + "baixar/" + tipo;
}

// 2.7.17: o "pronto" (com a versão mais nova) só chega ao conectar; quem deixa o programa aberto
// não ficava sabendo da atualização. Agora ele confere sozinho a cada 10 min (e 1 min depois de abrir).
if (programa) {
  const conferirVersao = async () => {
    try {
      const r = await fetch(linkBaixar("").replace(/baixar\/$/, "versoes"), { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (j && typeof j === "object" && (j.pc || j.android)) { estado.baixar = j; atualizarBaixar(); }
    } catch (_) {}
  };
  setTimeout(conferirVersao, 5 * 1000);
  setInterval(conferirVersao, 3 * 60 * 1000);   // 3.0.25: antes 10 min
}

const autoAtualizar = { tentativas: {}, ultima: 0 };
function atualizarBaixar() {
  const novo = temAtualizacao();
  // No programa e no app o botão só aparece quando tem versão nova; no site, sempre.
  $("bt-baixar").hidden = !!programa && !novo;
  $("bt-baixar").classList.toggle("novo", novo);
  $("txt-baixar").textContent = novo ? "Atualizar" : "Baixar";
  $("bt-baixar").title = novo ? `Tem versão nova: ${estado.baixar[MEU_TIPO].versao}` : "Baixar a versão mais nova do AstraScreenShare";
  // 3.0.25: no PC a atualização entra na hora, sozinha (pedido do dono). Falhou = tenta de novo na
  // próxima conferência, no máximo 3 vezes por versão.
  if (novo && MEU_TIPO === "pc" && programa && programa.atualizar) {
    const v = estado.baixar[MEU_TIPO].versao;
    const n = autoAtualizar.tentativas[v] || 0;
    if (n < 3 && !$("bt-baixar").disabled && Date.now() - autoAtualizar.ultima > 60 * 1000) {
      autoAtualizar.tentativas[v] = n + 1;
      autoAtualizar.ultima = Date.now();
      guardar("astra.avisouVersao", v);
      aviso({ titulo: `Atualizando para a ${v}`, texto: "Baixando agora. O programa fecha e abre de novo sozinho.", imagem: "icone-192.png", tempo: 8000 });
      setTimeout(clicouBaixar, 1500);
      return;
    }
  }
  if (novo && ler("astra.avisouVersao") !== estado.baixar[MEU_TIPO].versao) {
    guardar("astra.avisouVersao", estado.baixar[MEU_TIPO].versao);
    aviso({
      titulo: `Versão ${estado.baixar[MEU_TIPO].versao} disponível!`,
      texto: MEU_TIPO === "pc" && programa.atualizar
        ? `Você está com a ${MINHA_VERSAO}. Clique em "Atualizar", lá no alto: ele instala sozinho.`
        : `Você está com a ${MINHA_VERSAO}. Toque em "Atualizar", lá no alto.`,
      imagem: "icone-192.png", tempo: 12000, windows: true, aoClicar: clicouBaixar,
    });
  }
}

function abrirBaixar() {
  const lista = estado.baixar || {};
  for (const tipo of ["pc", "android"]) {
    const item = $("baixar-" + tipo);
    const info = lista[tipo];
    const link = item.querySelector("a");
    item.classList.toggle("meu", tipo === MEU_TIPO || (!MEU_TIPO && tipo === "android" && /Android/i.test(navigator.userAgent)));
    if (info) {
      const mb = Math.max(1, Math.round(info.tamanho / 1048576));
      item.querySelector(".sub").textContent = `Versão ${info.versao} · ${mb} MB`;
      link.href = linkBaixar(tipo);
      link.classList.remove("desligado");
      link.removeAttribute("aria-disabled");
      // No programa e no app, o link abre no navegador do aparelho (que baixa o arquivo).
      if (programa) link.target = "_blank"; else link.setAttribute("download", "");
      link.rel = "noopener";
      link.textContent = tipo === MEU_TIPO && temAtualizacao() ? "Atualizar" : "Baixar";
    } else {
      item.querySelector(".sub").textContent = "Ainda não disponível";
      link.removeAttribute("href");
      link.classList.add("desligado");
      link.setAttribute("aria-disabled", "true");
      link.textContent = "Baixar";
    }
  }
  $("baixar-minha").textContent = MINHA_VERSAO
    ? (temAtualizacao()
      ? `Você está com a versão ${MINHA_VERSAO}. Tem uma mais nova!`
      : `Você está com a versão ${MINHA_VERSAO}, a mais nova.`)
    : "Instale no PC para transmitir com o som sem o Discord, ou no celular para transmitir de lá.";
  $("baixar-dica").textContent = MEU_TIPO === "pc"
    ? "Para atualizar, use o botão \"Atualizar\" lá no alto: ele confere a assinatura da Astra antes de instalar. Se baixar por aqui, confira o código do arquivo em astrascreenshare.com/seguranca.html antes de abrir."
    : MEU_TIPO === "android"
      ? "O arquivo baixa pelo navegador do celular. Depois, toque nele para instalar por cima: as suas configurações continuam."
      : "No PC: abra o instalador baixado. No celular: toque no arquivo baixado e permita instalar.";
  $("modal-baixar").hidden = false;
}

// No programa de PC, "Atualizar" baixa e instala sozinho (main.js); nos outros, abre a lista.
async function clicouBaixar() {
  if (!(programa && programa.atualizar && MEU_TIPO === "pc" && temAtualizacao())) return abrirBaixar();
  const bt = $("bt-baixar");
  if (bt.disabled) return;
  bt.disabled = true;
  $("txt-baixar").textContent = "Baixando...";
  programa.aoProgressoAtualizacao((p) => {
    $("txt-baixar").textContent = p === "instalando" ? "Instalando..." : `Baixando ${p}%`;
  });
  const r = await programa.atualizar();
  if (r && r.ok) {
    aviso({ titulo: "Instalando a versão nova", texto: "O programa fecha e abre de novo sozinho em alguns segundos.", tempo: 15000 });
    return;
  }
  bt.disabled = false;
  atualizarBaixar();
  // 2.7.33: falhou = para aqui. Antes abria o download pelo navegador e ensinava a passar pelo
  // aviso do Windows, justo quando a assinatura podia ter dado errado.
  aviso({
    titulo: r && r.assinatura ? "Atualização bloqueada por segurança" : "Não consegui atualizar agora",
    texto: r && r.assinatura
      ? "O arquivo que chegou não tem a assinatura da Astra, então nada foi instalado. Não baixe o instalador por outro lugar; tente de novo mais tarde."
      : `${(r && r.erro) || "Erro desconhecido"}. Tente de novo daqui a pouco.`,
    tempo: 12000,
  });
}
$("bt-baixar").addEventListener("click", clicouBaixar);
$("baixar-fechar").addEventListener("click", () => { $("modal-baixar").hidden = true; });
$("modal-baixar").addEventListener("click", (e) => { if (e.target === $("modal-baixar")) $("modal-baixar").hidden = true; });
for (const tipo of ["pc", "android"]) {
  $("baixar-" + tipo).querySelector("a").addEventListener("click", () => {
    setTimeout(() => { $("modal-baixar").hidden = true; }, 300);
  });
}

// ---------- conexão com o servidor ----------
function conectar() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(programa ? programa.servidor : `${proto}//${location.host}/ws`);
  estado.ws = ws;

  const forcar = !!estado.forcarEntrada;
  estado.forcarEntrada = false;
  ws.onopen = () => enviar({ t: "ola", meuId: estado.meuId, nome: estado.nome, programa: !!programa, ponteOk: true, ponteAuto: !celular, refazOk: true, status: estado.status, chave: ler("astra.chave"), chaveOk: true, dispositivo: MEU_DISP, forcar, ap: aparelhosDoAstra() });
  ws.onmessage = (ev) => {
    estado.ultimaMsg = Date.now();
    let m;
    try { m = JSON.parse(ev.data); } catch (_) { return; }
    const tratar = TRATAR[m.t];
    if (tratar) tratar(m);
  };
  ws.onclose = () => perdeuConexao(ws);
}

// A conexão caiu: tenta de novo sozinho (1 s, 2 s, ... até 10 s) e volta para a sala.
function perdeuConexao(ws) {
  if (estado.contaProtegida) return;   // conta com senha sem a chave: não fica tentando
  if (estado.banido) return;           // 2.7.33: banido do Astra: não fica tentando entrar
  if (estado.ws !== ws || ws.perdida) return;
  ws.perdida = true;
  try { ws.close(); } catch (_) {}
  fecharPares();
  estado.ms = null;
  mostrarConexao();
  $("ponto-conexao").className = "ponto caiu";
  $("ponto-conexao").title = "Sem conexão com o servidor. Tentando de novo...";
  clearTimeout(estado.timerConectar);
  // A conta foi aberta em outro lugar: esta para aqui (senão uma derruba a outra sem parar).
  if (estado.substituido) { $("ponto-conexao").title = "Aberto em outro aparelho ou aba."; return; }
  estado.tentativas++;
  if (estado.tentativas === 1) {
    $("msg-inicio").textContent = "Procurando o servidor...";
    if (estado.sala) aviso({ titulo: "A conexão caiu", texto: "Voltando para a sala sozinho...", tempo: 4000 });
    estado.caiuNaSala = !!estado.sala;
  }
  clearTimeout(estado.timerConectar);
  estado.timerConectar = setTimeout(conectar, Math.min(10000, 1000 * estado.tentativas));
}

// A conta foi aberta em outro aparelho/aba (ou ficou trocando demais): para de reconectar sozinho.
function contaEmOutroLugar(msg) {
  if (estado.substituido) return;
  estado.substituido = true;
  clearTimeout(estado.timerConectar);
  estado.cartaoOutroLugar = aviso({
    titulo: "Astra aberto em outro lugar",
    texto: (msg || "Sua conta foi aberta em outro aparelho ou aba.") + " Esta janela parou para uma não derrubar a outra.",
    tempo: 0,
    classe: "pedido",
    botoes: [{ texto: "Usar aqui", classe: "primario", acao: () => {
      estado.substituido = false;
      estado.forcarEntrada = true;
      estado.tentativas = 0;
      clearTimeout(estado.timerConectar);
      conectar();
    } }],
  });
}

// Sem esperar a próxima tentativa quando a internet volta ou a janela volta a aparecer.
function tentarAgora() {
  const ws = estado.ws;
  if (ws && ws.perdida && !estado.substituido) {
    clearTimeout(estado.timerConectar);
    conectar();
  }
}
window.addEventListener("online", tentarAgora);
window.addEventListener("offline", () => { if (estado.ws) perdeuConexao(estado.ws); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) tentarAgora(); });

// A internet pode cair sem o navegador perceber (a conexão fica "pendurada").
// A cada 10 s manda um ping; sem resposta nenhuma por 30 s, reconecta.
setInterval(() => {
  const ws = estado.ws;
  if (!ws || ws.perdida || ws.readyState !== WebSocket.OPEN) return;
  if (estado.pongOk && Date.now() - estado.ultimaMsg > 30000) return perdeuConexao(ws);
  enviar({ t: "ping" });
}, 10000);

// 2.7.11: na sala, o sinal de conexão (estilo "Voz conectada" do Discord). Mede a cada 5 s,
// só com o Astra na frente; o pacote é minúsculo.
function mostrarConexao() {
  const caixa = $("conexao-sala");
  const naSala = !!estado.sala && !!estado.ws && estado.ws.readyState === WebSocket.OPEN && !estado.ws.perdida;
  caixa.hidden = !estado.sala;
  // Programa do PC: na sala o Desempenho se junta ao "Conectado" (clicar abre em cima).
  document.documentElement.classList.toggle("junta-des", !!estado.sala && !$("painel-desempenho").hidden);
  if (!estado.sala) return;
  // 2.7.20: com alguém transmitindo, o número é o atraso da tela (ida e volta entre você e a pessoa);
  // sem tela nenhuma, mostra o tempo até o servidor.
  const tela = estado.msTela;
  const ms = tela ? tela.ms : estado.ms;
  // sem ninguém transmitindo: cinza (o número é só até o servidor)
  const nivel = !naSala ? "ruim" : !tela || ms == null ? "" : ms < 100 ? "bom" : ms < 200 ? "medio" : "ruim";
  caixa.classList.remove("bom", "medio", "ruim");
  if (nivel) caixa.classList.add(nivel);
  $("txt-conexao").textContent = naSala ? "Conectado" : "Reconectando…";
  $("txt-conexao-sala").textContent = estado.nomeSala || "";
  $("dica-ms").textContent = naSala && ms != null ? `${ms} ms` : "sem resposta";
}

// 2.7.20: atraso da tela. Lê o tempo de ida e volta da conexão de vídeo (o mesmo caminho que a
// imagem faz). Assistindo: até quem transmite (a pior, se forem várias). Transmitindo: até quem
// assiste (a pior). Só lê estatísticas; não muda nada na transmissão.
async function rttDe(pc) {
  if (!pc || pc.connectionState !== "connected") return null;
  const r = await pc.getStats();
  let melhor = null;
  r.forEach((x) => {
    if (x.type === "candidate-pair" && x.state === "succeeded" && x.currentRoundTripTime != null && (x.nominated || melhor == null))
      melhor = x.currentRoundTripTime;
  });
  return melhor == null ? null : Math.round(melhor * 1000);
}
async function medirTela() {
  if (!estado.sala) { estado.msTela = null; return; }
  if (document.hidden) return;
  let pior = null;
  try {
    for (const b of blocosDosOutros()) {
      const par = b.medicao && b.medicao.par;
      if (!par) continue;
      const faixa = b.medicao.stream && b.medicao.stream.getVideoTracks()[0];
      const pcs = [par.pc, par.pcN, par.pcP].filter(Boolean);
      const pc = pcs.find((c) => c.getReceivers().some((r) => r.track === faixa)) || pcs[0];
      const ms = await rttDe(pc);
      if (ms != null && (!pior || ms > pior.ms)) pior = { ms, quem: `a tela de ${par.nome || "alguém"}` };
    }
    if (!pior && meuBloco) {
      for (const par of canaisDeEnvio()) {
        if (!par.envios || !par.envios.some((x) => x.track && x.track.kind === "video")) continue;
        const ms = await rttDe(par.pc);
        if (ms != null && (!pior || ms > pior.ms)) pior = { ms, quem: par === estado.ponte ? "o Modo leve" : "quem assiste" };
      }
    }
  } catch (_) {}
  if (pior) {
    const ant = estado.msTela;
    estado.msTela = ant && ant.quem === pior.quem ? { ms: Math.round(ant.ms * 0.6 + pior.ms * 0.4), quem: pior.quem } : pior;
  } else estado.msTela = null;
  mostrarConexao();
}
setInterval(medirTela, 3000);
function medirPing() {
  const ws = estado.ws;
  if (!estado.sala || document.hidden || !ws || ws.perdida || ws.readyState !== WebSocket.OPEN) return;
  enviar({ t: "ping", n: Date.now() });
}
setInterval(medirPing, 5000);

const TRATAR = {
  // Chave secreta da conta (só este navegador tem): sem ela ninguém entra com o seu ID.
  chave(m) {
    if (!m.chave) return;
    guardar("astra.chave", m.chave);
    if (ler("astra.chave") === m.chave) enviar({ t: "chave-ok", chave: m.chave });   // guardou mesmo: pode valer
    programa?.lembrarConta?.(estado.meuId, m.chave);   // 3.0.20: cópia fora do WebView2
  },
  // A mesma conta entrou em outro aparelho/aba: esta não volta sozinha (antes uma derrubava a
  // outra a cada 2 s e a transmissão caía sem parar). "Usar aqui" pega a conta de volta.
  substituido(m) { contaEmOutroLugar(m.msg); },
  "em-outro-lugar"(m) { contaEmOutroLugar(m.msg); },
  "conta-protegida"(m) {
    estado.contaProtegida = true;
    // 3.0.20: diagnóstico para a equipe (sem a chave): por que este app ficou sem a chave certa?
    try {
      const L = localStorage, r = L.getItem("__astra_restaurado");
      enviar({ t: "erro-app", msg: ("Conta recusada (conta " + (estado.meuId || "?") + "): chave " + (L.getItem("astra.chave") ? "presente" : "ausente")
        + ", login migrado " + (L.getItem("__astra_login_migrado") ? "sim" : "não") + ", restaurado " + (r ? Math.round((Date.now() - Number(r)) / 1000) + " s atrás" : "não")).slice(0, 200),
        onde: "conta-protegida", pilha: "nome local: " + (ler("astra.nome") || "?"), versao: (programa && programa.versao) || "site" });
    } catch { /* sem conexão */ }
    $("msg-inicio").textContent = m.msg;
    aviso({ titulo: "Entre na sua conta", texto: m.msg, tempo: 20000 });
  },
  status(m) {
    const par = estado.pares.get(m.id);
    if (par) { par.st = m.st; desenharSala(); }
  },
  pronto(m) {
    enviar({ t: "gif-favs" });
    if (ler("astra.chave")) programa?.lembrarConta?.(estado.meuId, ler("astra.chave"));   // 3.0.20: o servidor aceitou: guarda a cópia
    if (m.novidades) setTimeout(() => mostrarNovidades(m.novidades), 1200);
    mostrarRecado(m.recado, false);
    mostrarVitrine(m.vitrine);
    estado.conexao = m.id;
    estado.ice = m.ice;
    estado.baixar = m.baixar || {};  // instaladores mais novos que a VPS tem (botão "Baixar")
    atualizarBaixar();
    // A VPS perdeu a foto (ou é a primeira vez nesta VPS): manda a cópia do aparelho.
    if (m.foto) estado.fotos.set(estado.meuId, m.foto);
    else if (ler("astra.foto")) mandarFoto();
    guardarPerfilDe(estado.meuId, m.perfil);
    estado.meusExtras = Array.isArray(m.ix) ? m.ix : [];
    estado.minhaPrincipal = m.ip || "";
    fixasVer = m.fv && typeof m.fv === "object" ? m.fv : {};
    recuperarPerfil(m.perfil);
    estado.tentativas = 0;
    if (estado.caiuNaSala) {
      estado.caiuNaSala = false;
      aviso({ titulo: "Conexão de volta", tempo: 2500 });
    }
    if (m.nickOcupado) {
      pedirNome();
      const rr = raridadeNick(estado.nome);
      $("msg-nome").textContent = rr
        ? `"${estado.nome}" é um nick ${rr.nome}: ou já tem dono, ou precisa ser comprado. Entre com outro nick; depois, se ele estiver livre, dá para comprar com AstraDoll clicando no seu nick.`
        : `O nick "${estado.nome}" já é de outra pessoa. Escolha outro.`;
    }
    $("ponto-conexao").className = "ponto ok";
    $("ponto-conexao").title = "Conectado";
    if ($("msg-inicio").textContent === "Procurando o servidor...") $("msg-inicio").textContent = "";
    // Voltar para a sala em que estava (a internet caiu, ou o PC ligou de novo).
    const ultima = estado.sala || ler("astra.ultimaSala");
    if (ultima) {
      // volta: se a sala já fechou, o servidor recria (com senha não dá: a senha não fica guardada aqui)
      if (ultima === estado.meuId) enviar({ t: "criar", nomeSala: estado.nomeSala || ler("astra.nomeSala"), acesso: estado.acessoSala || ler("astra.acessoSala") || "publica", volta: true });
      else enviar({ t: "entrar", sala: ultima, silencioso: true });
    }
    estado.primeiraConexao = false;
    enviar({ t: "modulos", lista: extrasInstalados() });
  },
  online(m) {
    estado.online = m.lista;
    estado.salas = m.salas || [];
    estado.jams = Array.isArray(m.jams) ? m.jams : [];
    desenharSalas();
    window.aoMudarJams?.();
    for (const p of m.lista) {
      if (p.foto) estado.fotos.set(p.astraId, p.foto); else estado.fotos.delete(p.astraId);
      if (p.astraId !== estado.meuId) guardarPerfilDe(p.astraId, p.perfil);
    }
    mostrarMeuNome();
    desenharOnline();
    if (estado.sala) desenharSala();
    repintarAvataresDoChat();
  },
  foto(m) {
    if (m.erro) aviso({ titulo: m.erro });
    if (m.foto) estado.fotos.set(estado.meuId, m.foto); else estado.fotos.delete(estado.meuId);
    if (m.erro) estado.fotoAgora = "";   // a VPS recusou: volta a mostrar a que está valendo
    redesenharPerfis();
  },
  discord(m) {
    const antes = estado.discord.membro;
    estado.discord = m;
    desenharDiscord();
    redesenharPerfis();
    if (m.membro && !antes && m.conectado) aviso({ titulo: "Discord conectado!", texto: `Conectado como ${m.nome}.`, tempo: 6000 });
  },
  perfil(m) {
    if (m.erro) aviso({ titulo: m.erro });
    guardarPerfilDe(estado.meuId, m.perfil);
    redesenharPerfis();
  },
  bemvindo(m) { aoEntrarNaSala(m); },
  entrou(m) { novoPar(m); desenharSala(); ponteAutomatica(); somCall(true); },
  saiu(m) { removerPar(m.id); desenharSala(); somCall(false); },
  estado(m) { mudouEstado(m); },
  relaxado(m) { mudouRelaxado(m); },
  sinal(m) { recebeuSinal(m.de, m.dados); },
  acorde(m) { tocarCampainha(m); },
  acordei(m) { aviso({ titulo: `${m.nome} acordou!`, texto: "Já está de olho na sua tela.", imagem: "acorde.png" }); },
  convite(m) { recebeuConvite(m); },
  aguardando(m) { esperandoDono(m); },
  recusado(m) {
    pararDeEsperar();
    aviso({ titulo: m.fechou ? `A sala "${m.nomeSala}" fechou.` : `O dono da sala "${m.nomeSala}" não deixou entrar.`, tempo: 8000 });
  },
  pedido(m) { if (m.sala === estado.sala) chegouPedido(m); },
  "pedido-fim"(m) { fimDoPedido(m.id); },
  nick(m) { respostaNick(m); },
  moderadores(m) { estado.mods = new Set(m.lista || []); desenharSala(); },
  dono(m) { estado.dono = m.id; if (m.id !== estado.conexao) limparPedidos(); desenharSala(); desenharAcessoSala(); },
  expulso(m) {
    sairDaSala();
    aviso({ titulo: `Você foi tirado(a) da sala "${m.nomeSala}"`, texto: m.texto || (m.por ? `Quem tirou foi ${m.por}, o dono da sala.` : ""), tempo: 8000 });
  },
  "chat-aviso"(m) { if (estado.sala) aviso({ titulo: m.texto, tempo: 4000 }); },
  chat(m) { chegouMensagem(m); },
  risco(m) { chegouRisco(m); },
  "limpar-riscos"(m) { limparRiscos(m.para); },
  teclas(m) { chegouTeclas(m); },
  "gif-busca"(m) { mostrarGifs(m); },
  "gif-favs"(m) { chegaramFavs(m.itens || []); },
  modulos(m) { chegouModulos(m); },
  mod(m) { mensagemDeExtra(m); },
  pong(m) {
    estado.pongOk = true;
    // 2.7.11: ping da sala (ida e volta até a VPS), mostrado ao passar o mouse no sinal.
    const n = Number(m.n);
    if (n > 0 && Date.now() >= n) {
      const ms = Date.now() - n;
      estado.ms = estado.ms == null ? ms : Math.round(estado.ms * 0.6 + ms * 0.4);
      mostrarConexao();
    }
  },
  musica(m) { receberMusica(m); },
  "musica-busca"(m) { mostrarBusca(m); },
  erro(m) {
    if (m.silencioso) { esquecerSala(); return; }
    pararDeEsperar();
    if (!$("modal-senha").hidden) { $("senha-erro").textContent = m.msg; return; }
    if (estado.sala) aviso({ titulo: m.msg });
    else if ($("inicio").hidden || $("inicio").offsetParent === null || document.querySelector(".pagina:not([hidden])")) {
      aviso({ titulo: m.msg, tempo: 6000 });   // o Início não está à vista: a mensagem não pode sumir
      $("msg-inicio").textContent = m.msg;
    }
    else $("msg-inicio").textContent = m.msg;
  },
};

// ---------- início: criar ou entrar ----------
// ---------- quem pode entrar: pública, com senha ou com aprovação do dono ----------
const ACESSO_TXT = {
  publica: { nome: "Pública", dica: "Aparece na lista e qualquer pessoa entra na hora." },
  senha: { nome: "Com senha", dica: "Aparece com um cadeado. Só entra quem souber a senha." },
  aprovacao: { nome: "Aprovação", dica: "Aparece na lista, mas você aprova cada pessoa que pedir para entrar." },
};
const ICONE_CADEADO_SALA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const ICONE_GLOBO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
const ICONE_APROVA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>';
let acessoCriar = ACESSO_TXT[ler("astra.acessoSala")] ? ler("astra.acessoSala") : "publica";

function marcarRadios(grupo, valor, attr) {
  for (const b of grupo.querySelectorAll(`[${attr}]`)) b.setAttribute("aria-checked", String(b.getAttribute(attr) === valor));
}
function desenharAcessoCriar() {
  marcarRadios(document.querySelector("#form-criar .privacidade"), acessoCriar, "data-acesso");
  $("privacidade-dica").textContent = ACESSO_TXT[acessoCriar].dica;
  $("campo-senha").hidden = acessoCriar !== "senha";
}
document.querySelector("#form-criar .privacidade").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-acesso]");
  if (!b) return;
  acessoCriar = b.dataset.acesso;
  guardar("astra.acessoSala", acessoCriar);
  desenharAcessoCriar();
  if (acessoCriar === "senha") $("in-senha-sala").focus();
});
// setas do teclado nos grupos de opções (radiogroup)
document.addEventListener("keydown", (ev) => {
  const grupo = ev.target.closest && ev.target.closest('[role="radiogroup"]');
  if (!grupo || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
  const bts = [...grupo.querySelectorAll('[role="radio"]')];
  const i = bts.indexOf(ev.target);
  if (i < 0) return;
  ev.preventDefault();
  const prox = bts[(i + (ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 1) + bts.length) % bts.length];
  prox.focus(); prox.click();
});
// olhinho de mostrar a senha
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(".ver-senha");
  if (!b) return;
  const inp = $(b.dataset.ver);
  inp.type = inp.type === "password" ? "text" : "password";
  b.classList.toggle("ligado", inp.type === "text");
  b.setAttribute("aria-label", inp.type === "text" ? "Esconder a senha" : "Mostrar a senha");
});
desenharAcessoCriar();

$("form-criar").addEventListener("submit", (ev) => {
  ev.preventDefault();
  $("msg-inicio").textContent = "";
  const nomeSala = $("in-nome-sala").value.trim() || `Sala de ${meuNome()}`;
  const msg = { t: "criar", nomeSala, acesso: acessoCriar, oculta: ler("astra.ocultaSala") === "1" };
  if (acessoCriar === "senha") {
    const senha = $("in-senha-sala").value;
    if (senha.length < 4) {
      $("msg-inicio").textContent = "A senha precisa ter pelo menos 4 caracteres.";
      $("in-senha-sala").focus();
      return;
    }
    msg.senha = senha;
  }
  if (!estado.ws || estado.ws.readyState !== WebSocket.OPEN) {
    $("msg-inicio").textContent = "Sem conexão com o servidor agora. Tentando de novo...";
    return;
  }
  guardar("astra.nomeSala", nomeSala);
  enviar(msg);
  $("in-senha-sala").value = "";   // a senha não fica guardada no aparelho
});

function entrarNaSala(id, senha) {
  if (id === estado.sala) return;
  $("msg-inicio").textContent = "";
  if (id === estado.meuId) enviar({ t: "criar", nomeSala: ler("astra.nomeSala"), acesso: ler("astra.acessoSala") || "publica", oculta: ler("astra.ocultaSala") === "1", volta: true });
  else enviar(senha ? { t: "entrar", sala: id, senha } : { t: "entrar", sala: id });
}

// Senha da sala: o servidor pede (e confere); aqui só a caixinha.
let senhaPara = "";
function pedirSenhaSala(m) {
  senhaPara = m.sala;
  $("senha-sub").textContent = `"${m.nomeSala}" pede uma senha para entrar.`;
  $("senha-erro").textContent = m.erro || "";
  $("senha-entrar").disabled = !!m.bloqueado;
  const caixa = $("modal-senha");
  const jaAberta = !caixa.hidden;
  caixa.hidden = false;
  const inp = $("in-senha-entrar");
  if (m.erro) {
    inp.select();
    const f = $("form-senha");
    f.classList.remove("treme"); void f.offsetWidth; f.classList.add("treme");
  } else if (!jaAberta) inp.value = "";
  setTimeout(() => inp.focus(), 30);
}
function fecharSenha() { $("modal-senha").hidden = true; $("in-senha-entrar").value = ""; senhaPara = ""; }
$("form-senha").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const senha = $("in-senha-entrar").value;
  if (!senha) { $("senha-erro").textContent = "Digite a senha."; return; }
  $("senha-erro").textContent = "Conferindo...";
  entrarNaSala(senhaPara, senha);
});
$("senha-cancelar").addEventListener("click", fecharSenha);
$("modal-senha").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) fecharSenha(); });
$("modal-senha").addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharSenha(); });

// Dono: trocar quem pode entrar (e a senha) com a sala aberta.
let acessoNovo = "publica";
function desenharAcessoSala() {
  const b = $("bt-acesso");
  const a = estado.acessoSala || "";
  b.hidden = !a;
  if (!a) return;
  const dono = estado.dono === estado.conexao;
  b.innerHTML = (a === "senha" ? ICONE_CADEADO_SALA : a === "publica" ? ICONE_GLOBO : ICONE_APROVA) + `<span>${ACESSO_TXT[a].nome}</span>`;
  b.disabled = !dono;
  b.title = dono ? "Mudar quem pode entrar" : ACESSO_TXT[a].dica;
  b.setAttribute("aria-label", dono ? `Sala ${ACESSO_TXT[a].nome.toLowerCase()}. Mudar quem pode entrar` : `Sala ${ACESSO_TXT[a].nome.toLowerCase()}`);
}
function desenharModalAcesso() {
  marcarRadios($("acesso-opcoes"), acessoNovo, "data-acesso");
  $("acesso-campo-senha").hidden = acessoNovo !== "senha";
}
$("bt-acesso").addEventListener("click", () => {
  if (estado.dono !== estado.conexao) return;
  acessoNovo = estado.acessoSala || "publica";
  $("acesso-erro").textContent = "";
  $("in-acesso-senha").value = "";
  desenharModalAcesso();
  $("modal-acesso").hidden = false;
  $("acesso-opcoes").querySelector('[aria-checked="true"]')?.focus();
});
$("acesso-opcoes").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-acesso]");
  if (!b) return;
  acessoNovo = b.dataset.acesso;
  desenharModalAcesso();
  if (acessoNovo === "senha") $("in-acesso-senha").focus();
});
function fecharAcesso() { $("modal-acesso").hidden = true; $("in-acesso-senha").value = ""; }
$("acesso-cancelar").addEventListener("click", fecharAcesso);
$("modal-acesso").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) fecharAcesso(); });
$("modal-acesso").addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharAcesso(); });
$("form-acesso").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const msg = { t: "sala-acesso", acesso: acessoNovo };
  if (acessoNovo === "senha") {
    msg.senha = $("in-acesso-senha").value;
    if (msg.senha.length < 4) { $("acesso-erro").textContent = "A senha precisa ter pelo menos 4 caracteres."; return; }
  } else if (acessoNovo === estado.acessoSala) { fecharAcesso(); return; }
  $("acesso-erro").textContent = "Salvando...";
  enviar(msg);
});
TRATAR["senha-sala"] = (m) => pedirSenhaSala(m);
TRATAR["sala-acesso"] = (m) => {
  if (!m.ok) { $("acesso-erro").textContent = m.msg || "Não deu para mudar agora."; return; }
  estado.acessoSala = m.acesso;
  guardar("astra.acessoSala", m.acesso);
  fecharAcesso();
  desenharAcessoSala();
  aviso({ titulo: m.acesso === "senha" ? "Senha da sala atualizada" : `A sala agora é: ${ACESSO_TXT[m.acesso].nome}`, tempo: 3500 });
};
TRATAR.acesso = (m) => { if (ACESSO_TXT[m.acesso]) { estado.acessoSala = m.acesso; desenharAcessoSala(); } };

// ---------- lista de salas abertas ----------
function desenharSalas() {
  const ul = $("lista-salas");
  ul.innerHTML = "";
  const salas = [...estado.salas].sort((a, b) => (b.fixa - a.fixa) || (b.aoVivo - a.aoVivo) || (b.pessoas - a.pessoas) || a.nome.localeCompare(b.nome));
  $("salas-qtd").textContent = salas.length ? String(salas.length) : "";
  for (const s of salas) {
    // A linha inteira é o botão: clicou, entra (ou pede para entrar).
    const li = document.createElement("li");
    const bt = document.createElement("button");
    bt.type = "button";
    bt.className = "sala-item";
    const rostos = document.createElement("span");
    rostos.className = "rostos";
    for (const p of (s.membros || []).slice(0, 3)) rostos.append(avatar(p.nome, p.astraId, false));
    if (!rostos.childElementCount) { const v = document.createElement("span"); v.className = "rosto-vazio"; rostos.append(v); }
    const info = document.createElement("span");
    info.className = "nome";
    const b = document.createElement("b"); b.textContent = s.nome;
    if (s.acesso === "senha") {
      const cad = document.createElement("span");
      cad.className = "sala-cadeado";
      cad.innerHTML = ICONE_CADEADO_SALA;
      cad.title = "Sala com senha";
      cad.setAttribute("role", "img");
      cad.setAttribute("aria-label", "com senha");
      b.append(cad);
    }
    const sm = document.createElement("small");
    let estadoTxt = "";
    if (s.id === estado.sala) { estadoTxt = "Você está aqui"; bt.disabled = true; li.classList.add("aqui"); }
    else if (estado.esperando === s.id) { estadoTxt = "Esperando o dono..."; bt.disabled = true; }
    else if (s.id === estado.meuId) estadoTxt = "Sua sala · voltar";
    const partes = [s.pessoas === 0 ? "vazia" : s.pessoas === 1 ? "1 pessoa" : `${s.pessoas} pessoas`];
    if (s.fixa) { li.classList.add("fixa"); partes.unshift("Discord"); }
    sm.textContent = estadoTxt || partes.join(" · ");
    info.append(b, sm);
    bt.append(rostos, info);
    if (s.aoVivo) {
      const tag = document.createElement("span");
      tag.className = "ao-vivo";
      tag.title = s.aoVivo === 1 ? "1 pessoa ao vivo" : `${s.aoVivo} pessoas ao vivo`;
      tag.textContent = "AO VIVO";
      bt.append(tag);
    }
    bt.title = s.id === estado.sala ? "" : (s.fixa || s.id === estado.meuId || s.acesso === "publica") ? "Entrar"
      : s.acesso === "senha" ? "Entrar com a senha"
      : `Pedir para entrar${s.dono ? " (dono: " + s.dono + ")" : ""}`;
    bt.onclick = () => entrarNaSala(s.id);
    li.append(bt);
    ul.append(li);
  }
  if (!salas.length) {
    const li = document.createElement("li");
    li.className = "vazia";
    li.textContent = "Nenhuma sala aberta agora. Crie a sua!";
    ul.append(li);
  }
  if (window.astraV5) astraV5.salas(salas);
}

// Eu pedi para entrar: espera o dono responder.
let cartaoEsperando = null;
function esperandoDono(m) {
  estado.esperando = m.sala;
  if (cartaoEsperando) cartaoEsperando.remove();
  cartaoEsperando = aviso({
    titulo: `Pedido enviado para "${m.nomeSala}"`,
    texto: "Esperando o dono da sala permitir...",
    tempo: 0,
    classe: "esperando",
    botoes: [{ texto: "Cancelar", acao: cancelarPedido }],
  });
  clearTimeout(esperandoDono.prazo);
  esperandoDono.prazo = setTimeout(() => {
    if (estado.esperando !== m.sala) return;
    cancelarPedido();
    aviso({ titulo: "O dono não respondeu.", texto: "Tente de novo daqui a pouco.", tempo: 8000 });
  }, 90000);
  desenharSalas();
}

function pararDeEsperar() {
  estado.esperando = "";
  clearTimeout(esperandoDono.prazo);
  if (cartaoEsperando) { cartaoEsperando.remove(); cartaoEsperando = null; }
  desenharSalas();
}

function cancelarPedido() {
  enviar({ t: "cancelar-pedido" });
  pararDeEsperar();
}

// Sou o dono: alguém pediu para entrar.
const cartoesPedido = new Map();
function chegouPedido(m) {
  if (cartoesPedido.has(m.id)) return;
  if (m.foto) estado.fotos.set(m.id, m.foto);
  const responder = (sim) => { cartoesPedido.delete(m.id); enviar({ t: "responder", id: m.id, sim }); };
  const card = aviso({
    titulo: `${m.nome} quer entrar na sala`,
    texto: m.cargo === "moderador" ? "Você é moderador(a) da sala. Deixa entrar?" : "Você é o dono da sala. Deixa entrar?",
    imagem: avatar(m.nome, m.id, false),
    tempo: 0,
    windows: true,
    classe: "pedido",
    botoes: [
      { texto: "Permitir", classe: "primario", acao: () => responder(true) },
      { texto: "Recusar", classe: "perigo", acao: () => responder(false) },
    ],
  });
  cartoesPedido.set(m.id, card);
  tocarSomPedido();
}

function fimDoPedido(id) {
  const card = cartoesPedido.get(id);
  if (card) card.remove();
  cartoesPedido.delete(id);
}

// O navegador só deixa tocar som depois que a pessoa clicou/teclou na página.
// No programa (PC/Android) não existe essa trava.
function somLiberado() { return !estado.surdo && (!!programa || !navigator.userActivation || navigator.userActivation.hasBeenActive); }

function limparPedidos() {
  for (const card of cartoesPedido.values()) card.remove();
  cartoesPedido.clear();
}

// "Toc toc" curtinho para o dono perceber o pedido.
function tocarSomPedido() {
  try {
    if (!somLiberado()) return;   // sem clique na página o navegador bloqueia o som (e avisa no console)
    const ctx = new AudioContext();
    for (const [quando, freq] of [[0, 660], [0.18, 880]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + quando);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + quando + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + quando + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + quando);
      o.stop(ctx.currentTime + quando + 0.18);
    }
    setTimeout(() => ctx.close(), 600);
  } catch (_) {}
}

// 2.7.20: "plop" baixinho quando alguém (ou você) entra ou sai da sala. Sobe ao entrar, desce ao sair.
// Feito na hora pelo navegador (sem arquivo); o "Desativar áudio" cala (somLiberado).
let audioCall = null;
function somCall(entrar) {
  try {
    if (!somLiberado()) return;
    audioCall = audioCall || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCall.state === "suspended") audioCall.resume().catch(() => {});
    const t = audioCall.currentTime + 0.01, dur = 0.16;
    const o = audioCall.createOscillator(), g = audioCall.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(entrar ? 380 : 620, t);
    o.frequency.linearRampToValueAtTime(entrar ? 620 : 380, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(g).connect(audioCall.destination);
    o.start(t);
    o.stop(t + dur + 0.06);
  } catch (_) {}
}

function aoEntrarNaSala(m) {
  pararDeEsperar();
  limparPedidos();
  if (!$("modal-senha").hidden) fecharSenha();
  estado.dono = m.dono || "";
  estado.mods = new Set(m.moderadores || []);
  estado.convite = m.convite || "";
  estado.acessoSala = m.acesso || "";
  desenharAcessoSala();
  fecharPares();
  if (souAoVivo() && estado.sala && estado.sala !== m.sala) pararTela();
  const voltando = estado.sala === m.sala;
  estado.sala = m.sala;
  estado.nomeSala = m.nomeSala;
  mostrarConexao();
  guardar("astra.ultimaSala", m.sala);
  $("inicio").hidden = true;
  $("sala").hidden = false;
  $("info-inicio").hidden = true;
  $("info-sala").hidden = false;
  $("bt-sair").hidden = false;
  $("bt-lado").hidden = false;
  mostrarLado(ler("astra.semLado") !== "1", false);
  $("txt-titulo").textContent = m.nomeSala;
  $("txt-nome-sala").textContent = m.nomeSala;
  for (const p of m.pares) novoPar(p);
  limparChat();
  for (const c of m.chat || []) adicionarMensagem(c);
  if (m.musica) receberMusica(m.musica);
  if (!voltando) { prepararChat(true); somCall(true); }
  if (souAoVivo() && estado.leve) {
    // Voltou depois de a internet cair: a ponte fechou a transmissão antiga.
    publicarNaPonte().then((ok) => {
      if (!souAoVivo()) return;
      if (!ok) usarSemPonte("A ponte da VPS não respondeu");
      enviarEstado();
    });
  } else if (souAoVivo()) enviarEstado();
  if (estado.relaxado && voltando) enviar({ t: "relaxado", sim: true });
  else ligarRelaxado(false);
  desenharSala();
  desenharOnline();
  desenharSalas();
  mostrarConexao();
  medirPing();
}

function esquecerSala() {
  guardar("astra.ultimaSala", "");
  estado.sala = "";
  mostrarConexao();
}

function sairDaSala() {
  if (estado.sala) somCall(false);
  ligarCamera(false);
  enviar({ t: "sair" });
  fecharPares();
  pararTela();
  ligarRelaxado(false);
  pararDeAssistir(false);
  receberMusica(null);
  esquecerSala();
  estado.acessoSala = "";
  desenharAcessoSala();
  $("inicio").hidden = false;
  $("sala").hidden = true;
  $("info-inicio").hidden = false;
  $("info-sala").hidden = true;
  $("bt-sair").hidden = true;
  $("bt-lado").hidden = true;
  mostrarLado(true, false);
  $("txt-titulo").textContent = "Início";
  limparChat();
  prepararChat(false);
  limparPedidos();
  estado.dono = "";
  estado.mods = new Set();
  desenharOnline();
  desenharSalas();
}

$("bt-sair").addEventListener("click", sairDaSala);

// ---------- lista da sala ----------
function desenharSala() {
  const ul = $("lista-sala");
  ul.innerHTML = "";
  const todos = [{ astraId: estado.meuId, nome: meuNome(), transmitindo: souAoVivo(), relaxado: estado.relaxado, st: estado.status, eu: true },
                 ...estado.pares.values()];
  $("txt-contagem").textContent = `Na sala — ${todos.length}`;
  const souDono = estado.conexao && estado.conexao === estado.dono;
  const mods = estado.mods || new Set();
  const souMod = !souDono && mods.has(estado.meuId);
  for (const p of todos) {
    const li = document.createElement("li");
    const av = avatar(p.nome, p.astraId, p.transmitindo);
    pontoStatus(av, p.st);
    const ehDono = (p.eu ? estado.conexao : p.id) === estado.dono;
    if (ehDono) li.classList.add("dono");
    li.append(av);
    const nome = document.createElement("span");
    nome.className = "nome";
    const b = document.createElement("b");
    b.textContent = p.eu ? `${p.nome} (você)` : p.nome;
    if (ehDono) b.append(coroa());
    const s = document.createElement("small");
    const v = visualDe(p.astraId, p.nome);
    s.textContent = p.transmitindo ? "Transmitindo" : v.recado || (p.relaxado ? "Assistindo relaxado" : p.visitante ? "Assistindo pelo link" : "Assistindo");
    const ehMod = !ehDono && !p.visitante && mods.has(p.astraId);
    if (ehMod) b.append(escudo());
    if (ehDono && !v.recado) s.textContent += " · dono da sala";
    else if (ehMod && !v.recado) s.textContent += " · moderador";
    nome.append(b, s);
    li.append(nome);
    enfeitarItem(li, av, b, v);
    ligarCartao(li, av, v);
    // v5: sem o selo da plataforma (PC/celular/navegador) na lista
    if (p.relaxado) {
      const img = document.createElement("img");
      img.src = "relaxado.webp"; img.className = "cachorro"; img.alt = "relaxado"; img.title = "Assistindo relaxado";
      li.append(img);
    }
    if (p.transmitindo) {
      const tag = document.createElement("span");
      tag.className = "pilula"; tag.textContent = "AO VIVO";
      li.append(tag);
    }
    if (p.eq || (p.eu && estado.equipe)) b.append(seloEquipe());
    if (!p.eu && !p.visitante) window.astraPrivado?.botao(li, p.astraId, p.nome);
    if (!p.eu && !p.visitante) window.astraAmigos?.botao(li, p.astraId, p.nome);
    // 2.7.33: a equipe do Astra modera qualquer sala; ninguém (fora a equipe) mexe na equipe
    const equipe = !!estado.equipe;
    if ((souDono || equipe) && !p.eu && !p.visitante && !(p.eq && !equipe)) li.append(botaoModerador(p, ehMod));
    if ((equipe || ((souDono || (souMod && !ehDono && !ehMod)) && !p.eq)) && !p.eu) li.append(botaoExpulsar(p));
    ul.append(li);
  }
  atualizarPlateia();
}

// Coroinha discreta ao lado do nome do dono da sala.
function coroa() {
  const c = document.createElement("span");
  c.className = "coroa";
  c.title = "Dono da sala";
  c.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 8.5 8.2 12 12 5.5l3.8 6.5L20 8.5 18.6 17H5.4L4 8.5ZM5.6 18.5h12.8V20H5.6z"/></svg>';
  return c;
}

// Escudinho ao lado do nome de quem é moderador da sala.
function escudo() {
  const c = document.createElement("span");
  c.className = "coroa escudo-mod";
  c.title = "Moderador da sala";
  c.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/></svg>';
  return c;
}

// Dono: dá ou tira o cargo de moderador (moderador pode tirar gente da sala e da call).
function botaoModerador(p, ehMod) {
  const bt = document.createElement("button");
  bt.type = "button";
  bt.className = "bt-expulsar bt-mod" + (ehMod ? " ligado" : "");
  bt.title = ehMod ? `Tirar ${p.nome} da moderação` : `Tornar ${p.nome} moderador(a)`;
  bt.setAttribute("aria-pressed", ehMod ? "true" : "false");
  bt.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 3 5 5.6V11c0 4.3 2.9 8.1 7 9.5 4.1-1.4 7-5.2 7-9.5V5.6L12 3Z"/>'
    + (ehMod ? '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 12 2 2 4-4"/>' : "") + "</svg>";
  bt.onclick = () => { enviar({ t: "moderador", id: p.id, sim: !ehMod }); bt.disabled = true; };
  return bt;
}

// Botão de tirar alguém da sala (dono e moderadores veem). Primeiro clique pergunta, o segundo tira.
function botaoExpulsar(p) {
  const bt = document.createElement("button");
  bt.type = "button";
  bt.className = "bt-expulsar";
  bt.title = `Tirar ${p.nome} da sala`;
  const icone = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg>';
  bt.innerHTML = icone;
  let espera = 0;
  bt.onclick = () => {
    if (!bt.classList.contains("confirmar")) {
      bt.classList.add("confirmar");
      bt.textContent = "Tirar?";
      espera = setTimeout(() => { bt.classList.remove("confirmar"); bt.innerHTML = icone; }, 3000);
      return;
    }
    clearTimeout(espera);
    enviar({ t: "expulsar", id: p.id });
    bt.disabled = true;
  };
  return bt;
}

// ---------- dispositivo de cada pessoa (selo de vidro à direita) ----------
// O servidor descobre por onde cada sessão está conectada (User-Agent + o que o app diz)
// e manda em "disp": {tipo: desktop|celular|navegador|"", detalhe}. Sem saber, fica genérico.
// Ícones Lucide (monitor, smartphone, globe, circle-help).
const DISP = {
  desktop: { nome: "Desktop", ic: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>' },
  celular: { nome: "Celular", ic: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>' },
  navegador: { nome: "Navegador", ic: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>' },
  "": { nome: "Desconhecido", ic: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>' },
};
function iconeLinha(desenho, tam = 15) {
  return `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${desenho}</svg>`;
}
function seloDispositivo(p) {
  const d = p.disp || (p.eu ? { tipo: MEU_DISP, detalhe: "Este aparelho" } : {});
  const tipo = DISP[d.tipo] ? d.tipo : "";
  const s = document.createElement("span");
  s.className = "selo-disp disp-" + (tipo || "nd");
  s.innerHTML = iconeLinha(DISP[tipo].ic) + "<i></i>";
  s.lastChild.textContent = DISP[tipo].nome;
  s.dataset.dica = tipo ? (d.detalhe || DISP[tipo].nome) : "Não deu para saber por onde está conectado";
  return s;
}
// Ícones de estado ao lado do nick (transmitindo, na sala...), com dica ao passar o mouse.
function iconeEstado(classe, desenho, dica) {
  const s = document.createElement("span");
  s.className = "ic-estado " + classe;
  s.innerHTML = iconeLinha(desenho, 14);
  s.dataset.dica = dica;
  return s;
}
// Dica flutuante (fica por cima de tudo, então não é cortada pela rolagem da lista).
const dicaG = document.createElement("div");
dicaG.className = "dica-g";
dicaG.setAttribute("role", "tooltip");
document.body.append(dicaG);
document.addEventListener("pointerover", (ev) => {
  const alvo = ev.target.closest?.(".lista [data-dica]");
  if (!alvo) { dicaG.classList.remove("aberta"); return; }
  dicaG.textContent = alvo.dataset.dica;
  const r = alvo.getBoundingClientRect();
  dicaG.classList.add("aberta");
  const w = dicaG.offsetWidth, h = dicaG.offsetHeight;
  dicaG.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  dicaG.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + "px";
});
document.addEventListener("scroll", () => dicaG.classList.remove("aberta"), true);

// ---------- lista de online ----------
$("in-busca").addEventListener("input", desenharOnline);

function desenharOnline() {
  mostrarMeuNome();   // as insígnias que o dono deu chegam junto com a lista
  const busca = $("in-busca").value.trim().toLowerCase();
  const outros = estado.online.filter((p) => p.astraId !== estado.meuId);
  // Você também aparece na lista (sempre em cima, com "você"), até no modo Invisível.
  const daVps = estado.online.find((p) => p.astraId === estado.meuId);
  const eu = estado.meuId ? {
    ...(daVps || {}), astraId: estado.meuId, nome: meuNome() || daVps?.nome || "Você",
    st: estado.status, programa: !!programa || daVps?.programa, transmitindo: souAoVivo() || !!daVps?.transmitindo,
    sala: estado.sala || "", nomeSala: estado.nomeSala || daVps?.nomeSala || "", eu: true,
  } : null;
  $("txt-online").textContent = `Online — ${outros.length + (eu ? 1 : 0)}`;
  const ul = $("lista-online");
  ul.innerHTML = "";
  const filtrados = outros
    .filter((p) => !busca || p.nome.toLowerCase().includes(busca) || String(p.u || "").toLowerCase().includes(busca))
    // quem transmite primeiro; depois quem tem banner (capa do perfil); quem não tem fica embaixo
    .map((p) => ({ p, banner: visualDe(p.astraId, p.nome).capa ? 1 : 0 }))
    .sort((a, b) => (b.p.transmitindo - a.p.transmitindo) || (b.banner - a.banner) || a.p.nome.localeCompare(b.p.nome))
    .map((x) => x.p);
  if (eu && (!busca || eu.nome.toLowerCase().includes(busca) || (estado.nome || "").toLowerCase().includes(busca))) filtrados.unshift(eu);
  for (const p of filtrados) {
    const li = document.createElement("li");
    if (p.eu) li.classList.add("sou-eu");
    const av = avatar(p.nome, p.astraId, p.transmitindo);
    pontoStatus(av, p.st);
    li.append(av);
    const nome = document.createElement("span");
    nome.className = "nome";
    const b = document.createElement("b"); b.textContent = p.nome;
    const s = document.createElement("small");
    const v = visualDe(p.astraId, p.nome);
    s.textContent = p.transmitindo ? `Ao vivo em ${p.nomeSala}` : v.recado || (p.sala ? `Em ${p.nomeSala}` : "Disponível");
    if (p.eu && p.st === "inv") s.textContent = "Invisível: só você se vê";
    if (p.st === "inv") li.classList.add("offline");
    nome.append(b, s);
    li.append(nome);
    enfeitarItem(li, av, b, v);
    ligarCartao(li, av, v);
    const ics = document.createElement("span");
    ics.className = "ics-estado";
    if (p.transmitindo) ics.append(iconeEstado("ao-vivo", DISP.desktop.ic, `Transmitindo a tela${p.nomeSala ? " em " + p.nomeSala : ""}`));
    // 2.7.20: sem o ícone de porta de "na sala" (pedido do dono); o texto embaixo do nick já diz onde a pessoa está
    if (ics.childElementCount) b.append(ics);
    if (p.eq || (p.eu && estado.equipe)) b.append(seloEquipe());
    const bol = av.querySelector(".bolinha");
    if (bol) { bol.dataset.dica = STATUS[p.st]?.nome || "Online"; bol.removeAttribute("title"); }
    // v5: sem o selo da plataforma
    if (p.eu) {
      const tag = document.createElement("span"); tag.className = "tag-voce"; tag.textContent = "você";
      b.append(tag);
      ul.append(li);
      continue;
    }

    let acao = null;
    if (p.sala && p.sala !== estado.sala) acao = { texto: estado.esperando === p.sala ? "Esperando..." : "Entrar", f: () => entrarNaSala(p.sala) };
    else if (estado.sala && p.sala !== estado.sala) acao = { texto: "Convidar", f: () => convidar(p) };
    window.astraPrivado?.botao(li, p.astraId, p.nome);   // balãozinho: mensagem privada
    window.astraAmigos?.botao(li, p.astraId, p.nome);    // ⋯: amigo, bloquear (e banir, para a equipe)
    if (acao) {
      const bt = document.createElement("button");
      bt.className = "bt pequeno primario acao";
      bt.textContent = acao.texto;
      bt.onclick = acao.f;
      li.append(bt);
    }
    ul.append(li);
  }
  if (!filtrados.length) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="nome"><small></small></span>';
    li.querySelector("small").textContent = busca ? "Ninguém com esse nome." : "Ninguém online agora.";
    ul.append(li);
  }
}

function convidar(p) {
  enviar({ t: "convidar", para: p.astraId });
  aviso({ titulo: `Convite enviado para ${p.nome}.` });
}

function recebeuConvite(m) {
  aviso({
    titulo: `${m.de} te chamou`,
    texto: `para a sala "${m.nomeSala}".`,
    tempo: 30000,
    windows: true,
    botoes: [
      { texto: "Entrar", classe: "primario", acao: () => { programa?.mostrar(); entrarNaSala(m.sala); } },
      { texto: "Agora não" },
    ],
  });
}

// ---------- chat da sala ----------
// As mensagens ficam no painel da direita. Quando o chat não está à vista
// (outra aba, modo relaxado, tela cheia, ou um jogo por cima do programa),
// cada mensagem vira um mini pop-up: no PC, uma janelinha por cima do jogo;
// no app Android, uma notificação; dentro do programa, um cartão no canto.
// O sininho no topo do chat liga e desliga os pop-ups.
const ICONE_SINO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>';
const ICONE_SINO_NAO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16c-.7.15-1.37.4-1.98.74L19 15.36V16ZM3.4 2.6 2 4l3.33 3.33A6.96 6.96 0 0 0 5 11v5l-2 2v1h14.67L20 21.34l1.4-1.4L3.4 2.6Z"/></svg>';
let abaDireita = "chat";
let naoLidas = 0;
const popupLigado = () => ler("astra.popup") !== "0";

function mostrarAbaDireita(aba) {
  abaDireita = aba;
  for (const b of document.querySelectorAll(".aba-d")) b.classList.toggle("ativa", b.dataset.aba === aba);
  $("painel-chat").hidden = aba !== "chat";
  $("painel-online").hidden = aba !== "online";
  $("painel-musica").hidden = aba !== "musica";
  desenharTempo();
  if (aba === "chat") { naoLidas = 0; desenharNaoLidas(); rolarChat(); }
}
for (const b of document.querySelectorAll(".aba-d")) b.addEventListener("click", () => mostrarAbaDireita(b.dataset.aba));

// Na sala aparecem as abas Chat/Online; no início, só a lista de online.
function prepararChat(naSala) {
  $("abas-direita").hidden = !naSala;
  if (naSala) mostrarAbaDireita("chat");
  else { $("painel-chat").hidden = true; $("painel-musica").hidden = true; $("painel-online").hidden = false; abaDireita = "online"; }
}

function desenharNaoLidas() {
  $("chat-novas").hidden = !naoLidas;
  $("chat-novas").textContent = naoLidas > 99 ? "99+" : String(naoLidas);
  // Com a coluna escondida, a bolinha aparece no botão de mostrar.
  $("lado-novas").hidden = !naoLidas || !ladoEscondido();
}

// Botão do topo que esconde/mostra a coluna da direita (Chat, Música, Online) na sala.
// A música continua tocando com a coluna escondida. A escolha fica guardada.
function ladoEscondido() { return $("app").classList.contains("sem-lado"); }
function mostrarLado(sim, guardarEscolha = true) {
  $("app").classList.toggle("sem-lado", !sim);
  const bt = $("bt-lado");
  bt.title = sim ? "Esconder chat e música" : "Mostrar chat e música";
  bt.setAttribute("aria-label", bt.title);
  bt.classList.toggle("ligado", !sim);
  if (guardarEscolha) guardar("astra.semLado", sim ? "0" : "1");
  if (sim && abaDireita === "chat") { naoLidas = 0; rolarChat(); }
  desenharNaoLidas();
  desenharTempo();
}
$("bt-lado").addEventListener("click", () => mostrarLado(ladoEscondido()));

function desenharBotaoPopup() {
  const sim = popupLigado();
  const bt = $("bt-popup");
  bt.innerHTML = sim ? ICONE_SINO : ICONE_SINO_NAO;
  bt.classList.toggle("desligado", !sim);
  bt.setAttribute("aria-pressed", String(sim));
  bt.title = sim ? "Pop-up das mensagens durante o jogo: ligado (clique para desligar)"
                 : "Pop-up das mensagens durante o jogo: desligado (clique para ligar)";
}
$("bt-popup").addEventListener("click", () => {
  guardar("astra.popup", popupLigado() ? "0" : "1");
  desenharBotaoPopup();
  aviso({ titulo: popupLigado() ? "Pop-up das mensagens ligado" : "Pop-up das mensagens desligado",
          texto: popupLigado() ? "As mensagens aparecem por cima do jogo." : "As mensagens ficam só no chat.", tempo: 3000 });
});
desenharBotaoPopup();

function limparChat() {
  $("chat-lista").innerHTML = "";
  naoLidas = 0;
  desenharNaoLidas();
}

// CL da sala: qualquer um apaga o chat (e as imagens) para todo mundo; aparece quem apagou.
$("bt-cl-sala").addEventListener("click", () => aviso({
  titulo: "Dar CL no chat da sala?", texto: "Apaga todas as mensagens e imagens do chat para todo mundo da sala.", tempo: 10000,
  botoes: [{ texto: "Dar CL", acao: () => enviar({ t: "limpar-chat" }) }, { texto: "Cancelar" }] }));
TRATAR["chat-limpo"] = (m) => {
  limparChat();
  const li = document.createElement("li");
  li.className = "chat-cl";
  li.textContent = `${m.por || "Alguém"} deu CL: o chat foi apagado.`;
  $("chat-lista").append(li);
};

function rolarChat() { const ul = $("chat-lista"); ul.scrollTop = ul.scrollHeight; }
const horaCurta = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// As fotos chegam com a lista de quem está online. Ao entrar (ou voltar) na sala, o
// histórico do chat pode chegar antes dela: aí as fotos são postas quando a lista chegar.
function repintarAvataresDoChat() {
  for (const av of $("chat-lista").querySelectorAll(".avatar[data-autor]")) {
    if (!av.classList.contains("com-foto") && fotoDe(av.dataset.autor)) pintarAvatar(av, av.dataset.nome, av.dataset.autor);
  }
}

function adicionarMensagem(m) {
  if (m.doacao) return linhaDoacao(m);
  const ul = $("chat-lista");
  const noFim = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 60;
  const ultimo = ul.lastElementChild;
  const li = document.createElement("li");
  li.dataset.autor = m.astraId;
  li.dataset.quando = m.quando;
  // Mensagens seguidas da mesma pessoa ficam juntas, sem repetir o nome.
  if (ultimo && ultimo.dataset.autor === m.astraId && m.quando - Number(ultimo.dataset.quando) < 120000) {
    li.className = "seguida";
  } else {
    const av = avatar(m.nome, m.astraId);
    av.dataset.nome = m.nome;
    av.dataset.autor = m.astraId;
    li.append(av);
    const cab = document.createElement("div");
    cab.className = "chat-cab";
    const b = document.createElement("b");
    b.textContent = m.nome;
    const v = visualDe(m.astraId, m.nome);
    b.style.color = v.cor || corDe(m.astraId);
    if (v.cor) { av.classList.add("anel"); av.style.setProperty("--anel", v.cor); }
    ligarCartao(av, av, v);
    const t = document.createElement("time");
    t.textContent = horaCurta(m.quando);
    cab.append(b, ...principalDe(v), t);
    li.append(cab);
  }
  li.dataset.nome = m.nome;
  let textoMsg = m.texto || "";
  // v5.1: resposta ("⤷ @nome «trecho» texto"): vira uma citação em cima da mensagem
  const resp = textoMsg && RESPOSTA.exec(textoMsg);
  if (resp) {
    const q = document.createElement("div");
    q.className = "chat-resp";
    const qb = document.createElement("b");
    qb.textContent = resp[1];
    q.append(qb, document.createTextNode(" " + resp[2]));
    if (resp[1].toLowerCase() === (meuNome() || "").toLowerCase() && m.astraId !== estado.meuId) li.classList.add("mencionado");
    li.append(q);
    textoMsg = resp[3];
  }
  if (m.imagem) li.append(imagemDoChat(m, ul, noFim));
  if (textoMsg) {
    const p = document.createElement("p");
    if (escreverComMencoes(p, textoMsg) && m.astraId !== estado.meuId) li.classList.add("mencionado");
    li.append(p);
  }
  if (m.id && (m.texto || m.imagem)) {
    const r = document.createElement("button");
    r.type = "button";
    r.className = "chat-responder";
    r.title = "Responder";
    r.setAttribute("aria-label", `Responder ${m.nome}`);
    r.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
    r.onclick = () => responderA(m.nome, textoMsg || (m.gif ? "GIF" : "imagem"));
    li.append(r);
  }
  ul.append(li);
  while (ul.children.length > 200) ul.firstElementChild.remove();
  if (noFim || m.astraId === estado.meuId) rolarChat();
}

// O chat está mesmo à vista de quem está no PC/celular agora?
function chatVisivel() {
  if (document.hidden || !document.hasFocus()) return false;
  if ($("abas-direita").hidden || abaDireita !== "chat" || ladoEscondido()) return false;
  if ($("app").classList.contains("cinema") || document.fullscreenElement || blocoCheio) return false;
  const r = $("chat-lista").getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
}

// v5.3: alguém escreveu "GG" no chat -> sobe um monte de balão na tela de todo mundo
const GG = /(^|[\s!.,])gg+($|[\s!.,])/i;
let ultimoGG = 0;
function baloesGG() {
  // 2.7.20: pedido do dono, os balões sobem no máximo 1 vez a cada 5 min (o "gg" no chat continua normal)
  if (document.hidden || Date.now() - ultimoGG < 5 * 60 * 1000) return;
  ultimoGG = Date.now();
  const ceu = document.createElement("div");
  ceu.className = "gg-ceu";
  ceu.setAttribute("aria-hidden", "true");
  const cores = ["#ff4d6d", "#ffb703", "#3a86ff", "#8338ec", "#06d6a0", "#fb5607", "#ff006e", "#4cc9f0", "#ffd60a"];
  const n = matchMedia("(prefers-reduced-motion: reduce)").matches ? 14 : innerWidth < 700 ? 24 : 40;
  for (let i = 0; i < n; i++) {
    const b = document.createElement("i");
    b.className = "gg-balao";
    const l = 38 + Math.random() * 34;
    b.style.cssText = `left:${Math.random() * 96}%;--l:${l}px;--c:${cores[i % cores.length]};--t:${4.2 + Math.random() * 2.6}s;--a:${Math.random() * 1.6}s;` +
      `--x1:${(Math.random() * 80 - 40).toFixed(0)}px;--x2:${(Math.random() * 80 - 40).toFixed(0)}px`;
    ceu.append(b);
  }
  document.body.append(ceu);
  setTimeout(() => ceu.remove(), 9500);
}

function chegouMensagem(m) {
  adicionarMensagem(m);
  if (m.texto && !m.doacao) {
    const resp = RESPOSTA.exec(m.texto);   // numa resposta, só conta o que a pessoa escreveu (não o trecho citado)
    if (GG.test(resp ? resp[3] : m.texto)) baloesGG();
  }
  if (m.astraId === estado.meuId) return;
  if (abaDireita !== "chat" || ladoEscondido()) { naoLidas++; desenharNaoLidas(); }
  const marcado = !!m.texto && mencionaEu(m.texto);
  if (marcado) tocarSomMencao();
  if (!popupLigado() && !marcado) return;   // quem foi marcado é avisado mesmo com o pop-up desligado
  // Fora do programa (jogando): pop-up do PC ou notificação do Android. Quem
  // decide é o programa (main.js / Java): só aparece se a janela não estiver na frente.
  const texto = m.texto || (m.gif ? "🎞️ mandou um GIF" : m.imagem ? "📷 mandou uma imagem" : "");
  const titulo = marcado ? `${m.nome} marcou você` : m.nome;
  const chatEscondidoNaLive = souAoVivo() && ler("astra.chatNaLive") === "0";   // Configurações > Notificações
  if (programa && programa.popupChat && !chatEscondidoNaLive) {
    // Pop-up do PC com cara de chat de live: foto, nick colorido e a imagem/GIF de verdade.
    const foto = fotoDe(m.astraId);
    programa.popupChat({ nome: m.nome, texto: m.texto || "", cor: corDe(m.astraId),
      foto: /^https:/.test(foto) ? foto : "", imagem: m.imagem ? enderecoImagem(m.imagem) : "", gif: !!m.gif,
      tipo: marcado ? "marcou" : !m.id ? "jogo" : "" });   // sem id = aviso de minigame (MyWaifu etc.)
  }
  else if (celular && !chatEscondidoNaLive) programa.aviso(titulo, texto);
  // Dentro do programa, mas com o chat escondido: cartãozinho no canto.
  if (!chatVisivel() && !document.hidden) {
    aviso({ titulo, texto, imagem: avatar(m.nome, m.astraId), tempo: 6000, classe: "aviso-chat",
            aoClicar: () => { if (!$("app").classList.contains("cinema")) { if (ladoEscondido()) mostrarLado(true); mostrarAbaDireita("chat"); } } });
  }
}

// ---------- menções com @ ----------
// "@Nome" no chat marca a pessoa: o nome fica destacado e ela recebe aviso e um "plim".
// Só vale para quem está na sala. O texto é montado com textContent (nada de HTML).
// 2.7.11: "@everyone" marca todo mundo da sala (aviso e "plim" para todos).
const TODOS = "everyone";
function nomesDaSala() {
  const nomes = [TODOS, meuNome(), ...[...estado.pares.values()].map((p) => p.nome)].filter(Boolean);
  return nomes.sort((a, b) => b.length - a.length);   // o mais comprido primeiro ("Ana Clara" antes de "Ana")
}
const LETRA = /[\p{L}\p{N}_]/u;
// Acha "@Nome" em texto[i] (que é "@"). Devolve o nome da sala ou "".
function mencaoEm(texto, i, nomes) {
  const resto = texto.slice(i + 1).toLowerCase();
  for (const n of nomes) {
    if (resto.startsWith(n.toLowerCase()) && !LETRA.test(resto.charAt(n.length))) return texto.substr(i + 1, n.length);
  }
  return "";
}
function mencionaEu(texto) {
  if (!meuNome() || !texto.includes("@")) return false;
  const nomes = nomesDaSala(), eu = meuNome().toLowerCase();
  for (let i = texto.indexOf("@"); i >= 0; i = texto.indexOf("@", i + 1)) {
    if (i > 0 && LETRA.test(texto.charAt(i - 1))) continue;   // e-mail não conta
    const quem = mencaoEm(texto, i, nomes).toLowerCase();
    if (quem === eu || quem === TODOS) return true;
  }
  return false;
}
// Escreve o texto no <p>, com as menções destacadas. Devolve true se me marcou.
// Links no chat viram clicáveis (abrem no navegador). O resto continua com as menções @.
const LINK_NO_TEXTO = /\bhttps?:\/\/[^\s<>"']+/gi;
function escreverComMencoes(p, texto) {
  if (!/https?:\/\//i.test(texto)) return escreverMencoes(p, texto);
  let comeco = 0, marcou = false;
  for (const m of texto.matchAll(LINK_NO_TEXTO)) {
    let url = m[0].replace(/[.,;:!?)\]]+$/, "");   // pontuação grudada no fim não faz parte do link
    if (m.index > comeco) marcou = escreverMencoes(p, texto.slice(comeco, m.index)) || marcou;
    const a = document.createElement("a");
    a.href = url; a.textContent = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "chat-link";
    p.append(a);
    comeco = m.index + url.length;
  }
  if (comeco < texto.length) marcou = escreverMencoes(p, texto.slice(comeco)) || marcou;
  return marcou;
}
function escreverMencoes(p, texto) {
  if (!texto.includes("@")) { p.append(texto); return false; }
  const nomes = nomesDaSala(), eu = (meuNome() || "").toLowerCase();
  let comeco = 0, marcouEu = false;
  for (let i = texto.indexOf("@"); i >= 0; i = texto.indexOf("@", i + 1)) {
    if (i > 0 && LETRA.test(texto.charAt(i - 1))) continue;
    const nome = mencaoEm(texto, i, nomes);
    if (!nome) continue;
    if (i > comeco) p.append(texto.slice(comeco, i));
    const s = document.createElement("span");
    s.className = "mencao";
    s.textContent = "@" + nome;
    if (nome.toLowerCase() === eu || nome.toLowerCase() === TODOS) { s.classList.add("eu"); marcouEu = true; }
    p.append(s);
    comeco = i = i + 1 + nome.length;
    i--;
  }
  if (comeco < texto.length) p.append(texto.slice(comeco));
  return marcouEu;
}
function tocarSomMencao() {
  try {
    if (!somLiberado()) return;   // sem clique na página o navegador bloqueia o som (e avisa no console)
    const ctx = new AudioContext();
    for (const [quando, freq] of [[0, 880], [0.12, 1320]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + quando);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + quando + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + quando + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + quando);
      o.stop(ctx.currentTime + quando + 0.25);
    }
    setTimeout(() => ctx.close(), 700);
  } catch (_) {}
}

// Sugestões enquanto digita "@...".
let mencoesAchadas = [], mencaoAtiva = 0;
function trechoDaMencao() {
  const inp = $("in-chat");
  const ate = inp.selectionStart ?? inp.value.length;
  const antes = inp.value.slice(0, ate);
  const m = /(^|[^\p{L}\p{N}_])@([^@\n]{0,24})$/u.exec(antes);
  if (!m) return null;
  return { inicio: ate - m[2].length - 1, fim: ate, busca: m[2].toLowerCase() };
}
function fecharMencoes() { $("lista-mencoes").hidden = true; mencoesAchadas = []; }
function desenharMencoes() {
  const t = estado.sala ? trechoDaMencao() : null;
  if (!t) return fecharMencoes();
  const gente = [...estado.pares.values()].filter((p) => p.nome && p.nome.toLowerCase() !== (meuNome() || "").toLowerCase());
  mencoesAchadas = gente.filter((p) => p.nome.toLowerCase().startsWith(t.busca))
    .concat(gente.filter((p) => !p.nome.toLowerCase().startsWith(t.busca) && p.nome.toLowerCase().includes(t.busca)))
    .slice(0, 6);
  if (gente.length && TODOS.startsWith(t.busca)) mencoesAchadas.unshift({ nome: TODOS, todos: true });
  if (!mencoesAchadas.length || t.busca.length > 24) return fecharMencoes();
  mencaoAtiva = Math.min(mencaoAtiva, mencoesAchadas.length - 1);
  const ul = $("lista-mencoes");
  ul.innerHTML = "";
  mencoesAchadas.forEach((p, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    if (i === mencaoAtiva) li.classList.add("ativa");
    const nome = document.createElement("span");
    nome.textContent = p.nome;
    if (p.todos) {
      const ic = document.createElement("span"); ic.className = "mencao-todos"; ic.textContent = "@";
      const dica = document.createElement("small"); dica.textContent = "marca todo mundo da sala";
      li.append(ic, nome, dica);
    } else li.append(avatar(p.nome, p.astraId), nome);
    li.addEventListener("mousedown", (e) => { e.preventDefault(); escolherMencao(i); });
    ul.append(li);
  });
  ul.hidden = false;
}
function escolherMencao(i) {
  const p = mencoesAchadas[i], t = trechoDaMencao();
  if (!p || !t) return fecharMencoes();
  const inp = $("in-chat");
  const depois = inp.value.slice(t.fim).replace(/^\S*/, "");
  const novo = inp.value.slice(0, t.inicio) + "@" + p.nome + " ";
  inp.value = (novo + depois.replace(/^ /, "")).slice(0, 500);
  inp.setSelectionRange(novo.length, novo.length);
  inp.focus();
  fecharMencoes();
}
$("in-chat").addEventListener("input", () => { mencaoAtiva = 0; desenharMencoes(); });
$("in-chat").addEventListener("blur", () => setTimeout(fecharMencoes, 100));
$("in-chat").addEventListener("keydown", (e) => {
  if ($("lista-mencoes").hidden || !mencoesAchadas.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = mencoesAchadas.length;
    mencaoAtiva = (mencaoAtiva + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    desenharMencoes();
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    escolherMencao(mencaoAtiva);
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    fecharMencoes();
  }
});

// ---------- responder uma mensagem ----------
// Vai no próprio texto ("⤷ @nome «trecho» resposta"): o servidor não muda, quem tem versão antiga
// lê normal, e a pessoa respondida é marcada (@) e recebe o aviso.
const RESPOSTA = /^⤷ @(.{1,24}?) «([^»\n]{0,80})» ?([\s\S]*)$/;
let respondendo = null;
const barraResp = document.createElement("div");
barraResp.className = "chat-resp-barra";
barraResp.hidden = true;
barraResp.innerHTML = '<span class="chat-resp-txt"></span><button type="button" class="chat-resp-x" aria-label="Cancelar resposta" title="Cancelar">✕</button>';
$("form-chat").before(barraResp);
barraResp.querySelector(".chat-resp-x").onclick = () => responderA(null);
function responderA(nome, trecho) {
  respondendo = nome ? { nome, trecho: String(trecho).replace(/[»«\n\r]+/g, " ").trim().slice(0, 60) + (String(trecho).length > 60 ? "…" : "") } : null;
  barraResp.hidden = !respondendo;
  if (respondendo) {
    const t = barraResp.querySelector(".chat-resp-txt");
    t.textContent = "";
    const b = document.createElement("b");
    b.textContent = respondendo.nome;
    t.append("Respondendo ", b, ": " + respondendo.trecho);
    $("in-chat").focus();
  }
}
$("in-chat").addEventListener("keydown", (e) => { if (e.key === "Escape" && respondendo) { e.stopPropagation(); responderA(null); } });

$("form-chat").addEventListener("submit", (ev) => {
  ev.preventDefault();
  let texto = $("in-chat").value.trim();
  if (!texto || !estado.sala) return;
  $("in-chat").value = "";
  fecharMencoes();
  if (comandoDeExtra(texto)) return;                         // ex.: comandos de um minigame
  if (LINK_GIF.test(texto)) return enviar({ t: "gif", url: texto });   // link do Tenor/Giphy vira o GIF
  if (respondendo) { texto = `⤷ @${respondendo.nome} «${respondendo.trecho}» ${texto}`; responderA(null); }
  enviar({ t: "chat", texto });
});

// ---------- imagens no chat ----------
// A imagem é diminuída aqui (até 1920 px, JPEG) e vai pela mesma conexão do chat.
// A VPS guarda enquanto a sala existir e apaga tudo quando a sala fecha.
const IMAGEM_LIMITE = 1200 * 1024;
const GIF_LIMITE = 10 * 1024 * 1024;

function enderecoImagem(caminho) {
  return (programa ? programa.site.replace(/\/?$/, "/") : "./") + caminho;
}

function imagemDoChat(m, ul, rolar) {
  const img = document.createElement("img");
  img.className = "chat-imagem";
  img.alt = "Imagem de " + m.nome;
  img.loading = "lazy";
  if (m.largura && m.altura) img.style.aspectRatio = `${m.largura} / ${m.altura}`;
  img.src = enderecoImagem(m.imagem);
  img.onload = () => { img.style.aspectRatio = ""; if (rolar) rolarChat(); };
  img.onerror = () => { const p = document.createElement("p"); p.className = "sub"; p.textContent = "(imagem apagada)"; img.replaceWith(p); };
  img.onclick = () => { $("visor-img").src = img.src; $("modal-imagem").hidden = false; };
  if (!m.gif || !m.h || !/^imagem\//.test(m.imagem || "")) return img;
  // GIF: estrelinha no canto (aparece ao passar o mouse) para guardar nos favoritos.
  const caixa = document.createElement("span");
  caixa.className = "chat-gif-caixa";
  const esc = m.largura && m.altura ? Math.min(1, 240 / m.largura, 240 / m.altura) : 0;
  caixa.style.setProperty("--w", esc ? Math.round(m.largura * esc) + "px" : "240px");
  const estrela = document.createElement("button");
  estrela.type = "button";
  estrela.className = "bt-fav";
  estrela.dataset.h = m.h;
  estrela.onclick = (e) => {
    e.stopPropagation();
    enviar(gifFavs.has(m.h) ? { t: "gif-fav-tirar", id: m.h } : { t: "gif-fav", imagem: m.imagem });
    pintarEstrela(estrela, !gifFavs.has(m.h));   // já muda na hora; a VPS confirma depois
  };
  pintarEstrela(estrela, gifFavs.has(m.h));
  img.addEventListener("error", () => estrela.remove());
  caixa.append(img, estrela);
  return caixa;
}

// ---------- GIFs favoritos ----------
// Ficam na VPS, ligados à sua conta (a do Discord, se conectou): valem em qualquer aparelho
// e não somem quando a sala fecha.
const gifFavs = new Map();   // id -> {id, largura, altura}
let gifAba = "";
function pintarEstrela(bt, sim) {
  bt.classList.toggle("ligada", sim);
  bt.textContent = sim ? "\u2605" : "\u2606";
  bt.title = sim ? "Tirar dos favoritos" : "Adicionar aos favoritos";
  bt.setAttribute("aria-label", bt.title);
}
function chegaramFavs(itens) {
  gifFavs.clear();
  for (const g of itens) gifFavs.set(g.id, g);
  for (const bt of document.querySelectorAll(".bt-fav[data-h]")) pintarEstrela(bt, gifFavs.has(bt.dataset.h));
  if (!$("painel-gif").hidden && gifAba === "fav") desenharFavs();
}
function desenharFavs() {
  const lista = $("lista-gif");
  lista.innerHTML = "";
  $("gif-mais").hidden = true;
  $("gif-msg").textContent = gifFavs.size ? "" : "Nenhum favorito ainda. Passe o mouse num GIF do chat e clique na estrela.";
  for (const g of gifFavs.values()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gif-fav-item";
    b.title = "Mandar este GIF";
    const img = document.createElement("img");
    img.loading = "lazy"; img.alt = "GIF favorito";
    img.src = enderecoImagem(`gif-fav/${g.id}.gif`);
    const tirar = document.createElement("span");
    tirar.className = "gif-fav-tirar"; tirar.textContent = "\u2605"; tirar.title = "Tirar dos favoritos";
    tirar.onclick = (e) => { e.stopPropagation(); enviar({ t: "gif-fav-tirar", id: g.id }); };
    b.append(img, tirar);
    b.onclick = () => { enviar({ t: "gif-fav-enviar", id: g.id }); abrirGifs(false); };
    lista.append(b);
  }
}
function trocarAbaGif(aba) {
  gifAba = aba;
  $("gif-aba-fav").classList.toggle("ativa", aba === "fav");
  $("gif-aba-busca").classList.toggle("ativa", aba === "busca");
  $("in-gif").hidden = aba !== "busca";
  if (aba === "fav") { desenharFavs(); return; }
  $("in-gif").value = "";
  $("lista-gif").innerHTML = "";
  $("gif-msg").textContent = "Carregando...";
  $("gif-mais").hidden = true;
  enviar({ t: "gif-busca", q: "" });
  $("in-gif").focus();
}

function fecharVisor() { $("modal-imagem").hidden = true; $("visor-img").removeAttribute("src"); }
$("modal-imagem").addEventListener("click", fecharVisor);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal-imagem").hidden) fecharVisor(); });

async function diminuirImagem(arquivo) {
  const bmp = await createImageBitmap(arquivo);
  for (const [lado, qualidade] of [[1920, 0.85], [1600, 0.75], [1280, 0.7], [960, 0.6]]) {
    const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * escala)), h = Math.max(1, Math.round(bmp.height * escala));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";   // PNG transparente: fundo branco em vez de preto
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", qualidade));
    if (blob && blob.size <= IMAGEM_LIMITE) { bmp.close(); return { blob, largura: w, altura: h }; }
  }
  bmp.close();
  throw new Error("A imagem é grande demais.");
}

async function mandarImagem(arquivo) {
  if (!estado.sala || !arquivo || !arquivo.type.startsWith("image/")) return;
  const bt = $("bt-imagem");
  bt.disabled = true;
  try {
    if (arquivo.type === "image/gif" && arquivo.size > GIF_LIMITE) throw new Error("O GIF passa de 10 MB.");
    const { blob, largura, altura } = arquivo.type === "image/gif" ? { blob: arquivo, largura: 0, altura: 0 } : await diminuirImagem(arquivo);
    const dados = await new Promise((ok, erro) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1]);
      r.onerror = erro;
      r.readAsDataURL(blob);
    });
    const texto = $("in-chat").value.trim();
    enviar({ t: "imagem", dados, largura, altura, texto });
    $("in-chat").value = "";
  } catch (e) {
    aviso({ titulo: "Não deu para mandar a imagem.", texto: e.message || "" });
  } finally {
    bt.disabled = false;
  }
}

$("bt-imagem").addEventListener("click", () => $("in-arquivo-imagem").click());
$("in-arquivo-imagem").addEventListener("change", () => {
  const f = $("in-arquivo-imagem").files[0];
  $("in-arquivo-imagem").value = "";
  mandarImagem(f);
});
// Colar um print (Ctrl+V) no campo do chat, ou arrastar uma imagem para o chat.
$("in-chat").addEventListener("paste", (ev) => {
  const item = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) { ev.preventDefault(); mandarImagem(item.getAsFile()); }
});
$("painel-chat").addEventListener("dragover", (ev) => { if ([...ev.dataTransfer.types].includes("Files")) ev.preventDefault(); });
$("painel-chat").addEventListener("drop", (ev) => {
  const f = [...ev.dataTransfer.files].find((x) => x.type.startsWith("image/"));
  if (f) { ev.preventDefault(); mandarImagem(f); }
});

// Em tela cheia, os avisos (e os pop-ups do chat) vão junto para dentro dela.
document.addEventListener("fullscreenchange", () => {
  const caixa = $("avisos");
  if (caixa) (document.fullscreenElement || document.body).append(caixa);
});

// ---------- conexões com as outras pessoas da sala ----------
function novoPar(info) {
  if (info.id === estado.conexao || estado.pares.has(info.id)) return;
  const par = {
    id: info.id, astraId: info.astraId, nome: info.nome, visitante: !!info.visitante, eq: !!info.eq,
    transmitindo: !!info.transmitindo, telaId: info.telaId || null, relaxado: !!info.relaxado,
    pausado: !!info.pausado, ponte: !!(info.transmitindo && info.ponte), ponteOk: !!info.ponteOk,
    refazOk: !!info.refazOk, ger: 0, st: info.st || "on",
    polido: estado.conexao < info.id, fazendoOferta: false, ignorarOferta: false, aplicandoResposta: false,
    envios: [], blocos: new Map(),
  };
  if (info.perfil !== undefined) guardarPerfilDe(info.astraId, info.perfil);
  estado.pares.set(info.id, par);
  criarConexao(par);
  if (par.ponte) assistirPonte(par);
  if (estado.telaNativa) programa.novoParCelular(par.id);   // o Java manda a tela para quem chegou
}

// 2.7.33: proteger o IP. Numa conexão direta, a outra pessoa da sala consegue ver o seu IP.
// Com "relay", tudo passa pelo servidor de repasse (TURN) da Astra e ninguém da sala vê o IP de
// ninguém. Vale sempre em sala pública (e na sala do Discord), na voz e para quem assiste pelo
// link. Em sala com senha ou aprovação (só gente que o dono deixou entrar) fica direto, a não ser
// que a pessoa ligue "Esconder meu IP em todas as salas" (astra.ipSempre = "1").
// ?soturn=1 continua forçando o repasse (testes); ?direto=1 desliga (só para testes).
function politicaIce(tipo = "tela") {
  const q = new URLSearchParams(location.search);
  if (q.get("soturn") === "1") return "relay";
  if (q.get("direto") === "1") return "all";
  if (ler("astra.ipSempre") === "1") return "relay";
  // 2.7.38: "Conexão direta (menos ping)": quem liga aceita mostrar o IP em troca de não passar
  // pelo servidor (que fica nos EUA). Só fica direto de verdade entre duas pessoas que ligaram;
  // com quem não ligou continua pelo servidor. Quem assiste pelo link (visita) segue escondido.
  if (ler("astra.direto") === "1" && tipo !== "visita") return "all";
  if (tipo !== "tela") return "relay";
  return estado.acessoSala === "senha" || estado.acessoSala === "aprovacao" ? "all" : "relay";
}
window.politicaIce = politicaIce;

function criarConexao(par) {
  const pc = new RTCPeerConnection({ iceServers: estado.ice, iceTransportPolicy: politicaIce(par.visitante ? "visita" : "tela") });
  par.pc = pc;
  const ger = par.ger;   // muda quando a conexão é refeita (refazerConexao)

  pc.onnegotiationneeded = async () => {
    if (par.pc !== pc) return;
    try {
      par.fazendoOferta = true;
      await pc.setLocalDescription();
      enviar({ t: "sinal", para: par.id, dados: { descricao: pc.localDescription, ger } });
    } catch (e) {
      console.warn("negociação", e);
    } finally {
      if (par.pc === pc) par.fazendoOferta = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && par.pc === pc) enviar({ t: "sinal", para: par.id, dados: { candidato: candidate, ger } });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && par.pc === pc) pc.restartIce();
  };
  pc.ontrack = (ev) => { if (par.pc === pc) receberFaixa(par, ev); };

  if (estado.tela && !(estado.ponte && par.ponteOk)) enviarTela(par);   // no Modo leve vai pela ponte
  if (estado.camera) enviarCamera(par);
}

async function recebeuSinal(de, dados) {
  const par = estado.pares.get(de);
  if (!par || !dados) return;
  if (dados.refazer) return aceitarRefazer(par, dados.ger);
  // Transmissão que sai de um celular Android usa uma conexão separada ("nativo").
  if (dados.canal === "nativo") {
    if (dados.lado === "emissor") sinalNativo(par, dados);       // eu assisto um celular
    else if (celular) programa.sinalCelular(par.id, dados);      // eu sou o celular transmitindo
    return;
  }
  if (dados.ger !== undefined) par.refazOk = true;   // versão que sabe refazer (mesmo se a VPS não avisou)
  if ((dados.ger || 0) !== par.ger) return;   // sobra de uma conexão que já foi refeita
  const pc = par.pc;
  try {
    if (dados.descricao) {
      const d = dados.descricao;
      // "aplicandoResposta": enquanto aplica a resposta do outro, uma oferta nova não é colisão
      // (sem isso, uma oferta podia ser ignorada e a conexão ficava travada esperando).
      const livre = !par.fazendoOferta && (pc.signalingState === "stable" || par.aplicandoResposta);
      const colisao = d.type === "offer" && !livre;
      par.ignorarOferta = !par.polido && colisao;
      if (par.ignorarOferta) return;
      par.aplicandoResposta = d.type === "answer";
      try { await pc.setRemoteDescription(d); }
      finally { par.aplicandoResposta = false; }
      if (par.pc !== pc) return;
      if (d.type === "offer") {
        await pc.setLocalDescription();
        enviar({ t: "sinal", para: de, dados: { descricao: pc.localDescription, ger: par.ger } });
      }
    } else if (dados.candidato) {
      try { await pc.addIceCandidate(dados.candidato); }
      catch (e) { if (!par.ignorarOferta) throw e; }
    }
  } catch (e) {
    console.warn("sinal", e);
  }
}

// Assistir a tela de um celular: o celular (Java) faz a oferta e aqui só respondemos.
// As mensagens entram numa fila para os candidatos não chegarem antes da oferta.
function sinalNativo(par, dados) {
  par.filaN = (par.filaN || Promise.resolve()).then(async () => {
    if (dados.fechar) return fecharNativo(par);
    if (!par.pcN) {
      const pcN = new RTCPeerConnection({ iceServers: estado.ice, iceTransportPolicy: politicaIce() });
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

function fecharNativo(par) {
  if (par.pcN) { par.pcN.close(); par.pcN = null; }
}

// ---------- quando a tela de alguém não chega ----------
// Às vezes (internet que oscilou, uma negociação que se perdeu) a conexão com uma pessoa
// trava: ela está ao vivo, mas a tela nunca aparece aqui. Se passar uns segundos assim,
// esta conexão é refeita do zero, dos dois lados. Não muda nada na transmissão em si
// (qualidade, bitrate, codec): é a mesma tela, numa conexão nova.
function temTelaDe(par) {
  for (const [id, b] of par.blocos) {
    if (b.camera && id !== par.telaId && !id.startsWith("astra-")) continue;
    // O quadro da tela existe, mas a imagem nunca chegou (fica preto): também conta como "não chegou".
    const v = b.querySelector("video");
    if (!v || v.videoWidth > 0 || par.pausado || b.classList.contains("parado")) return true;
  }
  return false;
}

function refazerConexao(par, ger) {
  par.ger = ger;
  const velha = par.pc;
  par.pc = null;
  try { velha.close(); } catch (_) {}
  par.envios = [];
  par.enviosCam = [];
  par.fazendoOferta = false;
  par.ignorarOferta = false;
  par.aplicandoResposta = false;
  for (const id of [...par.blocos.keys()]) if (!id.startsWith("astra-")) removerBloco(par, id);
  criarConexao(par);
}

// Eu (quem assiste) peço: conexão nova, com um número maior que o atual.
function pedirConexaoNova(par) {
  const ger = Math.max(Date.now(), par.ger + 1);
  console.warn(`a tela de ${par.nome} não chegou: refazendo a conexão`);
  fecharNativo(par);
  refazerConexao(par, ger);
  enviar({ t: "sinal", para: par.id, dados: { refazer: true, ger } });
}

// O outro lado pediu. Se os dois pediram juntos, vale o número maior.
function aceitarRefazer(par, ger) {
  if (!(ger > par.ger)) return;
  refazerConexao(par, ger);
  if (estado.telaNativa) {   // sou o celular transmitindo: o Java manda a tela de novo
    programa.removerParCelular(par.id);
    programa.novoParCelular(par.id);
  }
}

setInterval(() => {
  for (const par of estado.pares.values()) {
    if (par.transmitindo && par.ponte && par.pcP && !temTelaDe(par)) {
      // Modo leve: a tela vem pela ponte da VPS. Não chegou? Pede de novo para a ponte.
      par.semTelaP = (par.semTelaP || 0) + 1;
      if (par.semTelaP >= 6) { par.semTelaP = 0; fecharPonte(par); assistirPonte(par); }   // ~18 s: a ponte espera até 10 s pela tela
      continue;
    }
    if (par.transmitindo && par.ponte && !par.pcP && !temTelaDe(par)) {
      // Modo leve: a ligação com a ponte caiu ou desistiu. Tenta de novo de vez em quando.
      par.semPonte = (par.semPonte || 0) + 1;
      if (par.semPonte >= 6) { par.semPonte = 0; par.tentativasPonte = 0; assistirPonte(par); }
      continue;
    }
    par.semTelaP = 0;
    par.semPonte = 0;
    if (!par.transmitindo || par.ponte || !par.refazOk || !par.pc || temTelaDe(par)) {
      par.semTela = 0;
      continue;
    }
    par.semTela = (par.semTela || 0) + 1;
    if (par.semTela >= 3) {   // uns 9 s ao vivo sem a tela chegar
      par.semTela = -3;       // se não resolver, tenta de novo uns 20 s depois
      pedirConexaoNova(par);
    }
  }
}, 3000);

function removerPar(id) {
  const par = estado.pares.get(id);
  if (!par) return;
  par.pc.close();
  fecharNativo(par);
  fecharPonte(par);
  if (estado.telaNativa) programa.removerParCelular(id);
  estado.escondidas.delete(id);
  for (const id2 of [...par.blocos.keys()]) removerBloco(par, id2);
  estado.pares.delete(id);
}

function fecharPares() {
  for (const id of [...estado.pares.keys()]) removerPar(id);
  desenharSala();
}

function mudouEstado(m) {
  const par = estado.pares.get(m.id);
  if (!par) return;
  const antes = par.transmitindo;
  par.transmitindo = m.transmitindo;
  par.pausado = !!m.pausado;
  for (const b of par.blocos.values()) marcarPausa(b, par.pausado, par.nome);
  par.nome = m.nome;
  if (m.perfil !== undefined) guardarPerfilDe(par.astraId, m.perfil);
  if (m.telaId) par.telaId = m.telaId;
  par.ponte = !!(m.transmitindo && m.ponte);
  if (par.ponte) assistirPonte(par); else fecharPonte(par);
  if (!m.transmitindo) {
    estado.escondidas.delete(par.id);   // na próxima live dela, a tela aparece de novo
    for (const [id, b] of [...par.blocos]) if (!b.camera) removerBloco(par, id);   // a câmera fica
    fecharNativo(par);
  }
  if (m.transmitindo && !antes) {
    par.semTela = 0; par.semTelaP = 0; par.semPonte = 0; par.tentativasPonte = 0;   // live nova: vigia do zero
    aviso({ titulo: `${par.nome} está ao vivo`, texto: "Começou a transmitir a tela.", windows: true });
  }
  desenharSala();
}

function mudouRelaxado(m) {
  const par = estado.pares.get(m.id);
  if (!par) return;
  par.relaxado = m.sim;
  desenharSala();
  // Quem está transmitindo recebe o recado do doguinho.
  if (m.sim && souAoVivo()) {
    aviso({
      titulo: `${m.nome} está assistindo relaxado`,
      texto: "Deitou ou se afastou do PC, mas continua curtindo a sua transmissão. Pode seguir tranquilo!",
      imagem: "relaxado.png",
      tempo: 9000,
      windows: true,
    });
  }
}

function receberFaixa(par, ev) {
  const stream = ev.streams[0] || new MediaStream([ev.track]);
  if (ev.track.kind !== "video") return;   // o áudio da tela vem na mesma stream do vídeo
  // A tela tem o id que a pessoa avisou (telaId) ou vem da ponte ("astra-"); o resto é a câmera.
  const camera = stream.id !== par.telaId && !stream.id.startsWith("astra-");
  if (!par.blocos.has(stream.id)) criarBloco(par, stream, camera);
  stream.onremovetrack = () => {
    if (!stream.getVideoTracks().length) removerBloco(par, stream.id);
  };
}

// ---------- blocos de vídeo ----------
const ICONE_MINI = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19 7h-8v6h8V7Zm2-4H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H3V5h18v14Z"/></svg>';
const ICONE_CHEIA = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M5 5h5V3H3v7h2V5Zm9-2v2h5v5h2V3h-7Zm5 16h-5v2h7v-7h-2v5ZM5 14H3v7h7v-2H5v-5Z"/></svg>';
const ICONE_BORRACHA = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15.1 3.6a2 2 0 0 1 2.8 0l3.5 3.5a2 2 0 0 1 0 2.8L12.3 19H20v2H8.6l-5-5a2 2 0 0 1 0-2.8L15.1 3.6Zm-6 6L5 13.7l4.4 4.4.9.9h1.2l2.6-2.6-5-5.8Z"/></svg>';
const ICONE_LAPIS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.33-2.33a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.82-1.84Z"/></svg>';
const ICONE_RECORTE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17 15h2V7a2 2 0 0 0-2-2H9v2h8v8ZM7 17V1H5v4H1v2h4v10a2 2 0 0 0 2 2h10v4h2v-4h4v-2H7Z"/></svg>';
const ICONE_ESCONDER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 7a5 5 0 0 1 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16A4.9 4.9 0 0 1 12 7ZM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27ZM7.53 9.8l1.55 1.55A2.8 2.8 0 0 0 9 12a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55A5 5 0 0 1 7.53 9.8Zm4.31-.78 3.15 3.15.02-.16a3 3 0 0 0-3-3l-.17.01Z"/></svg>';
const ICONE_SOM = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z"/></svg>';

function criarBloco(par, stream, camera = false) {
  const meu = par === null;
  const bloco = document.createElement("div");
  bloco.className = "bloco";
  bloco.camera = camera;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  if (meu) video.muted = true;   // minha própria tela: sem eco

  const rotulo = document.createElement("div");
  rotulo.className = "rotulo";
  rotulo.innerHTML = '<span class="pilula">AO VIVO</span><span></span>';
  rotulo.lastChild.textContent = (meu ? "Você" : par.nome) + (camera ? " · câmera" : "");
  if (camera) rotulo.firstChild.textContent = "CÂMERA";

  const barra = document.createElement("div");
  barra.className = "barra";
  if (!meu) {
    const icone = document.createElement("span");
    icone.innerHTML = ICONE_SOM;
    icone.style.display = "grid";
    const vol = document.createElement("input");
    vol.type = "range"; vol.min = 0; vol.max = 1; vol.step = 0.05; vol.value = 1;
    vol.title = "Volume";
    vol.oninput = () => { video.volume = +vol.value; video.muted = false; };
    barra.append(icone, vol);
  }
  const medir = document.createElement("button");
  medir.innerHTML = ICONE_MEDIDOR;
  medir.title = "Medidor (qualidade, velocidade e ping)";
  medir.onclick = () => ligarMedidor(!estado.medidor);
  barra.append(medir);
  if (!meu) {
    const lapis = document.createElement("button");
    lapis.innerHTML = ICONE_LAPIS;
    lapis.title = "Desenhar na tela (os riscos somem sozinhos)";
    lapis.onclick = () => ligarLapis(bloco, !(bloco.classList.contains("riscando") && !bloco.classList.contains("apagando")));
    const borracha = document.createElement("button");
    borracha.innerHTML = ICONE_BORRACHA;
    borracha.className = "bt-borracha";
    borracha.title = "Borracha: apaga os riscos para todo mundo";
    borracha.onclick = () => ligarLapis(bloco, !bloco.classList.contains("apagando"), true);
    barra.append(lapis, borracha, coresDoLapis());
  } else if (podeRecortar) {
    const recorte = document.createElement("button");
    recorte.innerHTML = ICONE_RECORTE;
    recorte.title = "Recortar: mostrar só uma parte da tela";
    recorte.onclick = abrirRecorte;
    barra.append(recorte);
  }
  if (!meu && !camera) {
    const doar = document.createElement("button");
    doar.className = "bt-doar";
    doar.innerHTML = '<img src="astradoll.svg" alt="" width="18" height="18"><span>Doar</span>';
    doar.title = "Doar AstraDoll para " + par.nome;
    doar.onclick = () => abrirDoar(par);
    barra.append(doar);
  }
  if (!meu) {
    const esconder = document.createElement("button");
    esconder.innerHTML = ICONE_ESCONDER;
    esconder.title = "Não assistir esta tela (as outras continuam)";
    esconder.onclick = () => esconderTela(par, true);
    barra.append(esconder);
  }
  if (!meu && podeMiniTela()) {
    const mini = document.createElement("button");
    mini.innerHTML = ICONE_MINI;
    mini.title = "Mini tela (pop-up por cima dos outros programas)";
    mini.onclick = () => miniTela(bloco, video);
    barra.append(mini);
  }
  const cheia = document.createElement("button");
  cheia.innerHTML = ICONE_CHEIA;
  cheia.title = "Tela cheia";
  cheia.onclick = () => telaCheia(bloco, video);
  barra.append(cheia);
  video.ondblclick = () => telaCheia(bloco, video);
  // Quem transmite girou o celular: a tela cheia gira junto.
  video.onresize = () => { if (blocoCheio === bloco) programa.telaCheia(true, deitado(video)); };
  bloco.append(video, rotulo, barra);
  prepararRiscos(bloco, video, par);
  const teclas = document.createElement("div");
  teclas.className = "teclas-live";
  teclas.hidden = true;
  const pausa = document.createElement("div");
  pausa.className = "pausa-live";
  pausa.hidden = true;
  bloco.append(teclas, pausa);

  if (meu) {
    // Quem está assistindo a minha transmissão (e quem está relaxado).
    const plateia = document.createElement("div");
    plateia.className = "plateia";
    bloco.append(plateia);
  }

  // 2.7.11: já tinha outra tela ao vivo (ou eu estou ao vivo): a tela nova abre SEM SOM,
  // para não atrapalhar quem está jogando. Um clique no aviso (ou no volume) liga o som.
  let abrirMuda = false;
  if (!meu && !camera) {
    const outraTela = [...$("palco").querySelectorAll(".bloco")].some((b) => b !== bloco && !b.camera &&
      !b.classList.contains("minha-camera") && b.querySelector("video") && b !== meuBloco);
    abrirMuda = outraTela || souAoVivo();
  }
  if (abrirMuda) {
    video.muted = true;
    const vol = barra.querySelector('input[type="range"]');
    if (vol) { vol.value = 0; vol.addEventListener("input", () => aviso2.remove(), { once: true }); }
    const aviso2 = document.createElement("button");
    aviso2.className = "ativar-som som-desligado";
    aviso2.innerHTML = ICONE_MUDO + "<span>Som desligado: já tinha outra tela. Clique para ouvir</span>";
    aviso2.onclick = () => { video.muted = false; video.volume = 1; if (vol) vol.value = 1; video.play().catch(() => {}); aviso2.remove(); };
    bloco.append(aviso2);
  }

  $("palco").append(bloco);
  const escondida = !meu && estado.escondidas.has(par.id);
  if (escondida) bloco.classList.add("escondido");
  if (!meu && (estado.semAssistir || escondida)) pausarBloco(bloco, true);
  else video.play().catch(() => {
    // O navegador bloqueou o som automático: toca mudo e pede um clique.
    video.muted = true;
    video.play().catch(() => {});
    const b = document.createElement("button");
    b.className = "ativar-som";
    b.textContent = "Clique para ativar o som";
    b.onclick = () => { video.muted = false; video.play(); b.remove(); };
    bloco.append(b);
  });

  if (par) par.blocos.set(stream.id, bloco);
  if (par && par.pausado) marcarPausa(bloco, true, par.nome);
  bloco.medicao = { par, stream, antes: new Map() };
  const medidor = document.createElement("div");
  medidor.className = "medidor";
  medidor.hidden = !estado.medidor;
  bloco.append(medidor);
  atualizarPalco();
  return bloco;
}

function removerBloco(par, id) {
  const b = par.blocos.get(id);
  if (b && b === blocoCheio) sairTelaCheia();
  if (b) { b.remove(); par.blocos.delete(id); }
  atualizarPalco();
}

function atualizarPalco() {
  const n = $("palco").querySelectorAll(".bloco:not(.escondido)").length;
  desenharEscondidas();
  const soEscondidas = !$("escondidas").hidden;
  $("vazio").querySelector("b").textContent = soEscondidas ? "Você não está assistindo nenhuma tela" : "Ninguém está transmitindo";
  $("vazio").querySelector(".sub").textContent = soEscondidas ? "Clique em \"Assistir\" lá em cima para ver de novo."
    : "Quando alguém da sala entrar ao vivo, a tela aparece aqui.";
  $("vazio").hidden = n > 0;
  $("palco").classList.toggle("um-so", n === 1);
  // "Parar de assistir" só aparece quando tem a tela de outra pessoa (ou já está ligado).
  $("bt-parar-assistir").hidden = !estado.semAssistir && !blocosDosOutros().length;
}

// ---------- música da sala (YouTube) ----------
// O servidor diz qual vídeo está tocando e em que instante ele começou. O vídeo toca num
// player do YouTube que fica no endereço da VPS (player.html), dentro de um quadro aqui;
// a cada 2 s o quadro conta em que segundo está, e se atrasou mais de 2,5 s, acerta.
const ICONE_PAUSAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICONE_TOCAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15L19.5 12 7 4.5Z"/></svg>';
const ICONE_MUDO = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3Zm13.6 3 2.7-2.7-1.1-1.1-2.7 2.7-2.7-2.7-1.1 1.1 2.7 2.7-2.7 2.7 1.1 1.1 2.7-2.7 2.7 2.7 1.1-1.1-2.7-2.7Z"/></svg>';
const musica = {
  atual: null, fila: [], difRelogio: 0, quadro: null, idCarregado: 0, chave: "", espera: 0, duracao: 0, relogio: 0,
  bloqueado: false, mudo: ler("astra.musicaMudo") === "1", volume: Number(ler("astra.musicaVolume") || 80),
};
musica.fechouMudo = musica.mudo;   // já abriu silenciado: nem abre o player

// Duas fontes de música: a da sala e a da Jam (jam.js). Só uma toca por vez aqui (sem som dobrado):
// estando numa Jam, a música da sala fica guardada e volta quando você sai da Jam.
const fontesMusica = { sala: null, jam: null };
let musicaFonte = "sala";
function receberMusica(m) {
  const f = m && m.fonte === "jam" ? "jam" : "sala";
  fontesMusica[f] = m ? { ...m, recebido: Date.now() } : null;
  if (f === musicaFonte) aplicarMusica(fontesMusica[f]);
}
function trocarFonteMusica(f) {
  if (f === musicaFonte) return;
  musicaFonte = f;
  // os números das músicas da sala e da Jam são independentes: força carregar de novo
  musica.idCarregado = 0; musica.chave = ""; musica.vigiaId = 0;
  $("musica-resultados").innerHTML = ""; $("musica-msg").textContent = "";
  aplicarMusica(fontesMusica[f]);
}
function musicaVisivel() {
  const painel = $("painel-musica");
  return !painel.hidden && painel.offsetParent !== null && !document.hidden;
}
function aplicarMusica(m) {
  if (m) musica.difRelogio = m.agora - (m.recebido || Date.now());
  const antes = musica.atual;
  musica.atual = m ? m.atual : null;
  musica.fila = m ? m.fila : [];
  musica.limparDireto = !!(m && m.limpar);   // 3.0.4: o servidor limpa a fila toda de uma vez
  if (!m) { $("musica-resultados").innerHTML = ""; $("musica-msg").textContent = ""; }
  if (m && m.busca === false) { $("in-musica").placeholder = "Cole o link do YouTube aqui"; for (const el of document.querySelectorAll("#musica-logo-sp, #musica-logo-sc")) el.hidden = true; }
  // Música nova, colocada por outra pessoa: avisa quem não está olhando a música.
  if (musica.atual && (!antes || antes.id !== musica.atual.id) && !musicaVisivel() && !musica.mudo && musica.atual.por !== meuNome()) {
    aviso({ titulo: musicaFonte === "jam" ? "Tocando na Jam" : "Tocando na sala", texto: musica.atual.titulo, tempo: 4000 });
  }
  desenharMusica();
  sincronizarMusica();
  desenharVideo();
}

// ---------- ver o vídeo (pedido: "YouTube como fonte direta") ----------
// O player da música já toca o vídeo do YouTube sincronizado para todo mundo da sala; aqui
// ele só deixa de ficar escondido e vira uma janelinha (arrastar pela barra, aumentar, fechar).
// Cada pessoa escolhe se quer ver; quem estiver vendo não tem o player fechado pelo "silenciar".
musica.verVideo = ler("astra.verVideo") === "1";
musica.videoGrande = ler("astra.videoGrande") === "1";
function desenharVideo() {
  const motor = $("musica-motor");
  const ligado = !!(musica.verVideo && musica.atual);
  motor.classList.toggle("ver-video", ligado);
  motor.classList.toggle("grande", ligado && musica.videoGrande);
  motor.setAttribute("aria-hidden", String(!ligado));
  if (ligado && musica.atual.titulo) $("video-titulo").textContent = musica.atual.titulo;
  const bt = $("musica-video");
  bt.setAttribute("aria-pressed", String(musica.verVideo));
  bt.classList.toggle("ligado", musica.verVideo);
  if (ligado) prenderVideo();
}
function prenderVideo() {
  // não deixa a janelinha sair da tela (janela redimensionada, tamanho trocado)
  const m = $("musica-motor");
  if (!m.style.left) return;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(0, Math.min(innerWidth - r.width, r.left)) + "px";
  m.style.top = Math.max(0, Math.min(innerHeight - r.height, r.top)) + "px";
}
function trocarVerVideo(sim) {
  musica.verVideo = sim;
  guardar("astra.verVideo", sim ? "1" : "0");
  if (sim && musica.fechouMudo) { musica.fechouMudo = false; sincronizarMusica(); }   // estava fechado pelo silenciar
  desenharVideo();
  if (sim && !musica.atual) aviso({ titulo: "Ver o vídeo", texto: "Coloque um link do YouTube na Música: o vídeo aparece aqui para você, no mesmo tempo que todo mundo.", tempo: 5000 });
}
$("musica-video").addEventListener("click", () => trocarVerVideo(!musica.verVideo));
$("video-fechar").addEventListener("click", () => trocarVerVideo(false));
$("video-tamanho").addEventListener("click", () => {
  musica.videoGrande = !musica.videoGrande;
  guardar("astra.videoGrande", musica.videoGrande ? "1" : "0");
  desenharVideo();
});
(() => {
  const barra = $("video-barra"), motor = $("musica-motor");
  let arr = null;
  barra.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || e.button > 0) return;
    const r = motor.getBoundingClientRect();
    arr = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    motor.classList.add("arrastando");
    try { barra.setPointerCapture(e.pointerId); } catch (_) {}
  });
  barra.addEventListener("pointermove", (e) => {
    if (!arr) return;
    motor.style.right = "auto"; motor.style.bottom = "auto";
    motor.style.left = Math.max(0, Math.min(innerWidth - motor.offsetWidth, e.clientX - arr.dx)) + "px";
    motor.style.top = Math.max(0, Math.min(innerHeight - motor.offsetHeight, e.clientY - arr.dy)) + "px";
  });
  const soltar = () => { arr = null; motor.classList.remove("arrastando"); };
  barra.addEventListener("pointerup", soltar);
  barra.addEventListener("pointercancel", soltar);
  addEventListener("resize", () => { if (motor.classList.contains("ver-video")) prenderVideo(); });
})();

function segundoEsperado() {
  const a = musica.atual;
  if (!a) return 0;
  return (a.pausadoEm != null ? a.pausadoEm : Date.now() + musica.difRelogio - a.inicio) / 1000;
}

function mandarPlayer(msg) {
  if (musica.quadro && musica.quadro.contentWindow) musica.quadro.contentWindow.postMessage(msg, "*");
}

function mandarVolume() {
  mandarPlayer({ musica: "volume", valor: musica.volume, mudo: musica.mudo || musica.volume === 0 || !!estado.surdo });
}

function criarQuadroMusica() {
  if (musica.quadro) return;
  const q = document.createElement("iframe");
  q.src = (programa ? programa.site.replace(/\/?$/, "/") : "./") + "player.html";
  q.allow = "autoplay; encrypted-media";
  q.title = "Música";
  q.onload = () => { musica.idCarregado = 0; musica.chave = ""; mandarVolume(); sincronizarMusica(); };
  musica.quadro = q;
  // Fica num lugar fixo (fora dos painéis): mudar de página ou de aba nunca recarrega o player.
  $("musica-motor").append(q);
}

// Abre o player da música de novo (o vigia da música usa quando ele trava).
window.recarregarMusica = () => {
  if (!musica.quadro) return;
  musica.quadro.remove();
  musica.quadro = null;
  musica.idCarregado = 0; musica.chave = "";
  musica.desistiu = false;   // player novo: o vigia volta a olhar
  sincronizarMusica();
};

function sincronizarMusica() {
  clearTimeout(musica.espera);
  const a = musica.atual;
  // Silenciou só para você há mais de 20 s: o player (YouTube/SoundCloud) é fechado para
  // não gastar memória tocando sem som. Ao tirar o silêncio ele abre de novo no ponto certo.
  if (a && musica.mudo && musica.fechouMudo && !musica.verVideo) {
    if (musica.quadro) { musica.quadro.remove(); musica.quadro = null; }
    musica.idCarregado = 0; musica.chave = "";
    return;
  }
  if (!a) {
    if (musica.quadro) { musica.quadro.remove(); musica.quadro = null; }
    musica.idCarregado = 0; musica.chave = ""; musica.bloqueado = false;
    $("musica-ouvir").hidden = true;
    return;
  }
  criarQuadroMusica();
  const chave = `${a.id}:${a.inicio}:${a.pausadoEm}`;
  if (chave === musica.chave) return;
  musica.chave = chave;
  const seg = segundoEsperado();
  const pausado = a.pausadoEm != null;
  if (musica.idCarregado !== a.id) {
    if (musica.vigiaId !== a.id) {
      musica.vigiaId = a.id; musica.recarregou = false; musica.desistiu = false; musica.ultimoTocando = 0;
      if (musica.bloqueadoPeloVigia) { musica.bloqueadoPeloVigia = false; musica.bloqueado = false; $("musica-ouvir").hidden = true; }
    }
    musica.idCarregado = a.id;
    musica.inicioCarga = Date.now();
    // Ainda não chegou a hora de começar (todos começam juntos): carrega parado e espera.
    mandarPlayer({ musica: "carregar", video: a.video, sc: a.sc, segundo: Math.max(0, seg), pausado: pausado || seg < 0 });
  } else if (pausado) {
    mandarPlayer({ musica: "pausar", segundo: seg });
  } else if (seg >= 0) {
    mandarPlayer({ musica: "tocar", segundo: seg });
  }
  if (!pausado && seg < 0) {
    musica.espera = setTimeout(() => mandarPlayer({ musica: "tocar", segundo: Math.max(0, segundoEsperado()) }), -seg * 1000);
  }
}

window.addEventListener("message", (ev) => {
  if (!musica.quadro || ev.source !== musica.quadro.contentWindow) return;
  const m = ev.data || {};
  const a = musica.atual;
  if (m.musica === "pronto") { mandarVolume(); musica.idCarregado = 0; musica.chave = ""; sincronizarMusica(); }
  else if (m.musica === "fim" && a && m.video === (a.video || a.sc)) enviar({ t: "musica", acao: "fim", id: a.id });
  else if (m.musica === "aviso" && typeof m.texto === "string") {
    // Aviso do player (ex.: "Não tocou aqui"): mostra embaixo da busca, porque o quadro fica atrás da capa.
    if (m.texto) $("musica-msg").textContent = musica.avisoPlayer = m.texto.slice(0, 200);
    else if (musica.avisoPlayer && $("musica-msg").textContent === musica.avisoPlayer) $("musica-msg").textContent = "";
  }
  else if (m.musica === "bloqueado") { musica.bloqueado = true; $("musica-ouvir").hidden = false; }
  else if (m.musica === "erro" && a && m.video === (a.video || a.sc)) {
    // 101/150: o dono do vídeo não deixa tocar fora do YouTube.
    $("musica-msg").textContent = [101, 150].includes(m.codigo)
      ? "Esse vídeo não deixa tocar fora do YouTube. Pulando..." : "Esse vídeo não abriu. Pulando...";
    enviar({ t: "musica", acao: "pular", id: a.id });
  }
  if (m.musica === "aviso" && m.texto) musica.desistiu = true;   // o player já explicou que não toca aqui
  if (m.musica === "tempo" && (m.tocando || m.esperando)) musica.ultimoTocando = Date.now();
  if (m.musica === "tempo" && a && m.duracao > 0 && musica.duracao !== m.duracao) {
    musica.duracao = m.duracao;
    desenharTempo();
  }
  if (m.musica === "tempo" && a && a.pausadoEm == null && !musica.bloqueado) {
    const esperado = segundoEsperado();
    if (esperado < 0 || m.esperando) return;
    if (!m.tocando) mandarPlayer({ musica: "tocar", segundo: esperado });
    else if (Math.abs(m.segundo - esperado) > 2.5) mandarPlayer({ musica: "ir", segundo: esperado });
  }
});

// Vigia da música: a sala está tocando, mas aqui o player ficou mudo e parado (o YouTube ou
// o SoundCloud não carregou, ou travou) sem dar erro. Primeiro abre o player de novo; se
// ainda assim não tocar, mostra o botão "Clique para ouvir".
setInterval(() => {
  const a = musica.atual;
  if (!a || a.pausadoEm != null || !musica.quadro || musica.desistiu || musica.bloqueado) return;
  if (segundoEsperado() < 2) return;
  if (musica.duracao > 0 && segundoEsperado() > musica.duracao - 3) return;   // acabando: a próxima já vem
  const ref = Math.max(musica.ultimoTocando || 0, musica.inicioCarga || 0);
  if (Date.now() - ref < 12000) return;
  if (!musica.recarregou) {
    musica.recarregou = true;
    console.warn("música parada aqui: abrindo o player de novo");
    window.recarregarMusica();
  } else {
    musica.bloqueado = true;
    musica.bloqueadoPeloVigia = true;
    $("musica-ouvir").hidden = false;
  }
}, 3000);

function itemMusica(x, comBotao) {
  const li = document.createElement("li");
  const img = document.createElement("img");
  // Capa: a do SoundCloud (se veio de lá) ou a miniatura do YouTube.
  img.src = x.sc ? (capaSegura(x.capa) || "icone-192.png") : `https://i.ytimg.com/vi/${encodeURIComponent(x.video || "")}/mqdefault.jpg`;
  if (x.sc) li.classList.add("de-soundcloud");
  img.alt = "";
  img.loading = "lazy";
  const txt = document.createElement("span");
  txt.className = "txt";
  const b = document.createElement("b"); b.textContent = x.titulo;
  const s = document.createElement("span");
  // Só o artista embaixo do nome (mais limpo); quem colocou aparece ao parar o mouse em cima.
  s.textContent = x.canal || "";
  li.title = [x.titulo, x.canal, x.por ? `colocada por ${x.por}` : ""].filter(Boolean).join(" · ");
  txt.append(b, s);
  // 3.0.4: na fila aparece quem colocou a música (antes só passando o mouse).
  if (!comBotao && x.por) {
    const por = document.createElement("span");
    por.className = "por";
    const quem = document.createElement("b");
    quem.textContent = x.por;
    por.append("colocada por ", quem);
    txt.append(por);
  }
  if (comBotao) {
    const bt = document.createElement("button");
    bt.type = "button";
    bt.className = "adicionar";
    bt.title = "Colocar na fila";
    bt.append(img, txt);
    li.append(bt);
  } else {
    li.append(img, txt);
  }
  return li;
}

function desenharMusica() {
  const a = musica.atual;
  $("musica-vazia").hidden = !!a;
  $("musica-jam").hidden = !!a;   // explicação só enquanto não tem música
  $("musica-player").hidden = !a;
  $("musica-agora").hidden = !a;
  desenharCapa(a);
  $("musica-nota").hidden = !a;
  if (a) {
    $("musica-titulo").textContent = a.titulo;
    $("musica-info").textContent = [a.canal, a.por ? `colocada por ${a.por}` : ""].filter(Boolean).join(" · ");
    $("musica-agora").title = a.por ? `Colocada por ${a.por}` : "";
    const pausado = a.pausadoEm != null;
    $("musica-pausar").innerHTML = pausado ? ICONE_TOCAR : ICONE_PAUSAR;
    $("musica-pausar").title = pausado ? "Tocar para todos" : "Pausar para todos";
    // 3.0.3: na Jam em que só o dono controla, o pausar/pular de quem não é dono não fazia nada
    // (o servidor recusa) e a música continuava: agora os botões ficam desligados e explicam.
    const soDono = !!(window.jamSoDonoBloqueia && window.jamSoDonoBloqueia());
    for (const b of [$("musica-pausar"), $("musica-pular")]) {
      if (!b) continue;
      if (b.dataset.tituloNormal == null) b.dataset.tituloNormal = b.title;
      b.disabled = soDono;
      if (soDono) b.title = "Nesta Jam só o dono controla a música";
      else if (b.id === "musica-pular") b.title = b.dataset.tituloNormal;
    }
    $("musica-estado").textContent = pausado ? "Pausada" : "Tocando agora";
    $("musica-estado").parentElement.classList.toggle("pausado", pausado);
    document.querySelector(".musica-cartao").classList.toggle("pausada", pausado);
  }
  if (!a || a.id !== musica.duracaoDe) { musica.duracao = 0; musica.duracaoDe = a ? a.id : 0; }
  desenharTempo();
  desenharVolume();
  $("musica-mudo").innerHTML = musica.mudo ? ICONE_MUDO : ICONE_SOM;
  $("musica-mudo").title = musica.mudo ? "Você silenciou a música (clique para ouvir)" : "Silenciar só para você";
  $("musica-mudo").classList.toggle("desligado", musica.mudo);
  if (!musica.arrastando) desenharFila();
  window.aoDesenharMusica?.();   // miniplayer e página Música (jam.js)
}

// Capa da música (estilo Spotify): a do SoundCloud ou a miniatura do YouTube. Sem capa,
// fica um quadrado com uma nota. O clipe não aparece: o player fica atrás da capa.
function desenharCapa(a) {
  const img = $("musica-capa");
  const src = !a ? "" : a.sc ? capaSegura(a.capa) : (a.video ? `https://i.ytimg.com/vi/${encodeURIComponent(a.video)}/hqdefault.jpg` : "");
  if (!src) { img.hidden = true; img.removeAttribute("src"); return; }
  if (img.getAttribute("src") === src) return;
  img.hidden = true;
  img.classList.toggle("do-youtube", !a.sc);
  img.onload = () => { img.hidden = false; };
  img.onerror = () => { img.hidden = true; };
  img.src = src;
}

const limpandoFila = new Set();   // 2.7.23: músicas que o "Limpar fila" está tirando
function desenharFila() {
  const ul = $("musica-fila");
  const antes = $("painel-musica").hidden ? null : posicoesFila();   // para as músicas deslizarem
  ul.innerHTML = "";
  const fila = musica.fila.filter((x) => !limpandoFila.has(x.id));   // 2.7.23: as que estão sendo limpas já somem
  for (const x of fila) {
    const li = itemMusica(x, false);
    li.dataset.id = x.id;
    const alca = document.createElement("span");
    alca.className = "musica-alca";
    alca.title = "Arraste para mudar a ordem";
    alca.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-1.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM18 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM16.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm1.5 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>';
    alca.addEventListener("pointerdown", (ev) => arrastarMusica(ev, li, x.id));
    li.prepend(alca);
    const tirar = document.createElement("button");
    tirar.type = "button";
    tirar.className = "bt-icone";
    tirar.title = "Tirar da fila";
    tirar.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M6 6l12 12M18 6 6 18"/></svg>';
    tirar.onclick = () => enviar({ t: "musica", acao: "remover", id: x.id });
    li.append(tirar);
    ul.append(li);
  }
  $("musica-fila-titulo").hidden = !fila.length;
  $("musica-fila-n").textContent = fila.length;
  // 2.7.23: na Jam em que só o dono controla, quem não é dono não vê o "Limpar fila"
  $("musica-limpar").hidden = !!(window.jamSoDonoBloqueia && window.jamSoDonoBloqueia());
  if (!fila.length) fecharLimpar();
  if (antes && Object.keys(antes).length) deslizarFila(antes, null);
}

// 2.7.23: "Limpar fila": a lixeira abre "Limpar fila" com o mouse; o clique abre a pergunta
// pela largura toda (✓ / ✕), que fecha sozinha em 5 s. Limpa só a fila, a música atual continua.
// Usa o "remover" que o servidor já tem (uma música de cada vez): não precisa mudar a VPS.
let limparTempo = 0, limparFila = 0;
function fecharLimpar() {
  clearTimeout(limparTempo);
  $("musica-limpar").classList.remove("conf");
}
(() => {
  const caixa = $("musica-limpar");
  caixa.querySelector(".fl-abre").onclick = () => {
    if (caixa.classList.contains("conf")) return;
    caixa.classList.add("conf");
    clearTimeout(limparTempo);
    limparTempo = setTimeout(fecharLimpar, 5000);
  };
  caixa.querySelector(".fl-nao").onclick = fecharLimpar;
  caixa.querySelector(".fl-sim").onclick = () => {
    fecharLimpar();
    const lis = [...$("musica-fila").children];
    lis.forEach((li, i) => { li.style.transitionDelay = `${Math.min(i, 8) * 0.05}s`; li.classList.add("saindo"); });
    const ids = musica.fila.map((x) => x.id);
    ids.forEach((id) => limpandoFila.add(id));
    setTimeout(() => { $("musica-fila-titulo").hidden = true; }, lis.length ? 400 : 0);
    clearInterval(limparFila);
    if (musica.limparDireto) {
      // 3.0.4: um pedido só (também para a playlist que ainda está entrando).
      enviar({ t: "musica", acao: "limpar" });
      setTimeout(() => { limpandoFila.clear(); desenharFila(); }, 1500);   // recusou (Jam só do dono): volta
      return;
    }
    // O servidor aceita um pedido de música a cada 0,3 s: manda um a cada 0,35 s.
    let voltas = ids.length * 3 + 10;   // se o servidor não deixar (ex.: Jam só do dono), desiste
    limparFila = setInterval(() => {
      while (ids.length && !musica.fila.some((x) => x.id === ids[0])) ids.shift();
      if (!ids.length || --voltas < 0) {
        clearInterval(limparFila); limpandoFila.clear();
        if (ids.length) desenharFila();   // não deu para tirar tudo: mostra o que sobrou
        return;
      }
      enviar({ t: "musica", acao: "remover", id: ids[0] });   // só sai da lista quando o servidor confirmar
    }, 350);
  };
})();

function desenharVolume() {
  const v = $("musica-volume");
  v.value = musica.volume;
  v.style.setProperty("--cheio", `${musica.volume}%`);
  v.classList.toggle("mudo", musica.mudo);
  $("musica-volume-num").textContent = musica.mudo ? "0" : String(musica.volume);
}

// Barra de tempo da música (a duração vem do player do YouTube). Anda sozinha a cada
// segundo só enquanto a aba Música está aberta.
function minutos(seg) {
  seg = Math.max(0, Math.floor(seg));
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
}
function desenharTempo() {
  const a = musica.atual;
  const ok = !!a && musica.duracao > 0;
  $("musica-progresso").hidden = !ok;
  clearInterval(musica.relogio);
  musica.relogio = 0;
  if (!ok) return;
  const pintar = () => {
    if (!musica.atual) return;
    const seg = Math.min(musica.duracao, Math.max(0, segundoEsperado()));
    $("musica-tempo").textContent = minutos(seg);
    $("musica-duracao").textContent = minutos(musica.duracao);
    $("musica-andou").style.width = `${(seg / musica.duracao) * 100}%`;
  };
  pintar();
  if (a.pausadoEm == null && !$("painel-musica").hidden) musica.relogio = setInterval(pintar, 1000);
}

// Arrastar uma música da fila (pela alça de pontinhos) muda a ordem para todos.
// Usa eventos de ponteiro, então funciona com o mouse e com o dedo no celular. A música
// segura acompanha o ponteiro e as outras deslizam para abrir espaço.
const SEM_ANIMACAO = matchMedia("(prefers-reduced-motion: reduce)");

// Anima as músicas da fila do lugar antigo até o novo (antes = {id: topo antigo}).
function deslizarFila(antes, menos) {
  if (SEM_ANIMACAO.matches) return;
  for (const o of $("musica-fila").children) {
    if (o === menos) continue;
    const velho = antes[o.dataset.id];
    if (velho == null) { o.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" }); continue; }
    const dy = velho - o.offsetTop;
    if (dy) o.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}

function posicoesFila() {
  const antes = {};
  for (const o of $("musica-fila").children) antes[o.dataset.id] = o.offsetTop;
  return antes;
}

// Rolagem suave da aba Música com a rodinha do mouse: em vez de pular de uma vez,
// o painel desliza até o ponto pedido. (O dedo no celular já rola suave sozinho.)
(() => {
  const painel = $("painel-musica");
  let alvo = 0, quadro = 0;
  painel.addEventListener("wheel", (e) => {
    if (e.ctrlKey || SEM_ANIMACAO.matches || e.target.closest("input[type=range]")) return;
    e.preventDefault();
    const linha = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? painel.clientHeight : 1;
    if (!quadro) alvo = painel.scrollTop;
    alvo = Math.max(0, Math.min(painel.scrollHeight - painel.clientHeight, alvo + e.deltaY * linha));
    if (!quadro) quadro = requestAnimationFrame(passo);
  }, { passive: false });
  function passo() {
    const falta = alvo - painel.scrollTop;
    if (Math.abs(falta) < 1) { painel.scrollTop = alvo; quadro = 0; return; }
    const antes = painel.scrollTop;
    painel.scrollTop += falta * 0.2;
    if (painel.scrollTop === antes) { quadro = 0; return; }   // chegou na borda
    quadro = requestAnimationFrame(passo);
  }
})();

function arrastarMusica(ev, li, id) {
  if (ev.button > 0) return;
  ev.preventDefault();
  const ul = $("musica-fila");
  const painel = $("painel-musica");
  musica.arrastando = true;
  li.classList.add("arrastando");
  const inicio = [...ul.children].indexOf(li);
  const pegou = ev.clientY - ul.getBoundingClientRect().top - li.offsetTop;   // onde o dedo pegou
  let ultimoY = ev.clientY, rolando = 0;
  const seguir = () => {
    const y = ultimoY - ul.getBoundingClientRect().top - pegou;   // topo que a música teria
    li.style.transform = `translateY(${y - li.offsetTop}px)`;
    // Fica antes da primeira música (das outras) cujo meio está abaixo do meio da segura.
    const meio = y + li.offsetHeight / 2;
    const outros = [...ul.children].filter((o) => o !== li);
    const depois = outros.find((o) => meio < o.offsetTop + o.offsetHeight / 2) || null;
    if (depois ? li.nextElementSibling !== depois : ul.lastElementChild !== li) {
      const antes = posicoesFila();
      ul.insertBefore(li, depois);
      li.style.transform = `translateY(${y - li.offsetTop}px)`;
      deslizarFila(antes, li);
    }
  };
  // Perto da borda do painel, rola sozinho (e continua rolando enquanto segura ali).
  const rolar = () => {
    const r = painel.getBoundingClientRect();
    const passo = ultimoY < r.top + 40 ? -6 : ultimoY > r.bottom - 40 ? 6 : 0;
    if (passo) { painel.scrollTop += passo; seguir(); }
    rolando = requestAnimationFrame(rolar);
  };
  const mover = (e) => { ultimoY = e.clientY; seguir(); };
  const soltar = () => {
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", soltar);
    cancelAnimationFrame(rolando);
    // Assenta no lugar novo deslizando.
    const resto = li.style.transform;
    li.style.transform = "";
    if (resto && !SEM_ANIMACAO.matches) li.animate([{ transform: resto }, { transform: "none" }], { duration: 160, easing: "ease-out" });
    li.classList.remove("arrastando");
    musica.arrastando = false;
    const para = [...ul.children].indexOf(li);
    const agora = musica.fila.findIndex((x) => x.id === id);
    if (para !== inicio && agora >= 0) {
      const [item] = musica.fila.splice(agora, 1);   // já mostra na ordem nova
      musica.fila.splice(para, 0, item);
      enviar({ t: "musica", acao: "mover", id, para });
    }
    // A lista já está na ordem certa na tela; só redesenha se alguém mudou a fila enquanto arrastava.
    if ([...ul.children].map((o) => Number(o.dataset.id)).join() !== musica.fila.map((x) => x.id).join()) desenharFila();
  };
  // Escuta na janela inteira: mudar o item de lugar tira a alça da página por um instante,
  // e aí ela perderia o ponteiro.
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", soltar);
  rolando = requestAnimationFrame(rolar);
}

function mostrarBusca(m) {
  $("musica-msg").textContent = m.erro || "";
  const ul = $("musica-resultados");
  ul.innerHTML = "";
  for (const x of m.itens || []) {
    const li = itemMusica(x, true);
    li.querySelector("button").onclick = () => {
      enviar({ t: "musica", acao: "adicionar", video: x.video, titulo: x.titulo, canal: x.canal });
      ul.innerHTML = "";
      $("musica-msg").textContent = musica.atual ? "Colocada na fila." : "";
    };
    ul.append(li);
  }
}

// Enquanto digita/cola: o logo do link (YouTube ou Spotify) acende.
$("in-musica").addEventListener("input", () => {
  const t = $("in-musica").value;
  const yt = /youtu\.?be/i.test(t), sp = /spotify/i.test(t), sc = /soundcloud/i.test(t);
  $("musica-logo-yt").classList.toggle("aceso", yt);
  $("musica-logo-sp").classList.toggle("aceso", sp);
  $("musica-logo-sc").classList.toggle("aceso", sc);
  $("musica-aceita").classList.toggle("apagado", yt || sp || sc);
});

$("form-musica").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const texto = $("in-musica").value.trim();
  if (!texto) return;
  enviar({ t: "musica", acao: "buscar", texto });
  $("in-musica").value = "";
  $("in-musica").dispatchEvent(new Event("input"));
  $("musica-resultados").innerHTML = "";
  $("musica-msg").textContent = /youtu|spotify|soundcloud/.test(texto) ? "Colocando na fila..." : "Procurando...";
  // Clicar aqui já conta como "a pessoa quer som": libera o player.
  if (musica.bloqueado) $("musica-ouvir").click();
});
$("musica-pausar").addEventListener("click", () => {
  if (musica.atual) enviar({ t: "musica", acao: musica.atual.pausadoEm != null ? "tocar" : "pausar" });
});
$("musica-pular").addEventListener("click", () => {
  if (musica.atual) enviar({ t: "musica", acao: "pular", id: musica.atual.id });
});
$("musica-volume").addEventListener("input", () => {
  musica.volume = Number($("musica-volume").value);
  if (musica.mudo && musica.volume > 0) { musica.mudo = false; guardar("astra.musicaMudo", "0"); desenharMusica(); vigiarMudo(); }
  guardar("astra.musicaVolume", String(musica.volume));
  desenharVolume();
  mandarVolume();
});
function vigiarMudo() {
  clearTimeout(musica.timerMudo);
  if (musica.mudo) musica.timerMudo = setTimeout(() => { musica.fechouMudo = true; sincronizarMusica(); }, 20000);
  else if (musica.fechouMudo) { musica.fechouMudo = false; musica.ultimoTocando = Date.now(); sincronizarMusica(); }
}
$("musica-mudo").addEventListener("click", () => {
  musica.mudo = !musica.mudo;
  guardar("astra.musicaMudo", musica.mudo ? "1" : "0");
  desenharMusica();
  mandarVolume();
  vigiarMudo();
});
$("musica-ouvir").addEventListener("click", () => {
  musica.bloqueado = false;
  musica.bloqueadoPeloVigia = false;
  musica.ultimoTocando = Date.now();
  $("musica-ouvir").hidden = true;
  if (musica.atual && musica.atual.pausadoEm == null) mandarPlayer({ musica: "tocar", segundo: Math.max(0, segundoEsperado()) });
});

// ---------- medidor ----------
// Um quadrinho no canto de cada tela: resolução, quadros por segundo, velocidade,
// ping e perda. Em quem transmite, uma linha por pessoa que está assistindo.
const ICONE_MEDIDOR = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 19h3v-6H4v6Zm6.5 0h3V5h-3v14ZM17 19h3V9h-3v10Z"/></svg>';
estado.medidor = ler("astra.medidor") === "1";

function ligarMedidor(sim) {
  estado.medidor = sim;
  guardar("astra.medidor", sim ? "1" : "0");
  for (const m of document.querySelectorAll(".bloco .medidor")) { m.hidden = !sim; m.textContent = sim ? "medindo..." : ""; }
}

const numero = (v, casas = 1) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas });

// Lê as estatísticas de um envio ou recebimento e calcula a velocidade desde a última leitura.
async function medirCanal(pc, alvo, antes, chave) {
  const r = await (alvo ? alvo.getStats() : pc.getStats());
  let rtp = null, par = null, remoto = null;
  const locais = new Map(), codecs = new Map();
  r.forEach((x) => {
    if (x.type === "codec") codecs.set(x.id, x.mimeType);
    if ((x.type === "inbound-rtp" || x.type === "outbound-rtp") && x.kind === "video") rtp = x;
    if (x.type === "remote-inbound-rtp" && x.kind === "video") remoto = x;
    if (x.type === "candidate-pair" && x.state === "succeeded" && (x.nominated || !par)) par = x;
    if (x.type === "local-candidate") locais.set(x.id, x);
  });
  if (!rtp) return null;
  const bytes = rtp.bytesReceived ?? rtp.bytesSent ?? 0;
  const ultimo = antes.get(chave);
  antes.set(chave, { bytes, t: rtp.timestamp, perdidos: rtp.packetsLost || 0, recebidos: rtp.packetsReceived || 0 });
  const mbps = ultimo && rtp.timestamp > ultimo.t ? ((bytes - ultimo.bytes) * 8) / ((rtp.timestamp - ultimo.t) * 1000) : 0;
  let perda = 0;
  if (rtp.type === "inbound-rtp" && ultimo) {
    const p = (rtp.packetsLost || 0) - ultimo.perdidos, ok = (rtp.packetsReceived || 0) - ultimo.recebidos;
    perda = p + ok > 0 ? (100 * Math.max(0, p)) / (p + ok) : 0;
  } else if (remoto && remoto.fractionLost != null) {
    perda = remoto.fractionLost * 100;
  }
  const rtt = par && par.currentRoundTripTime != null ? par.currentRoundTripTime : remoto && remoto.roundTripTime;
  const local = par && locais.get(par.localCandidateId);
  return {
    res: rtp.frameWidth ? `${rtp.frameWidth}×${rtp.frameHeight}` : "--",
    qps: Math.round(rtp.framesPerSecond || 0),
    mbps, perda,
    ping: rtt != null ? Math.round(rtt * 1000) : null,
    caminho: local ? (local.candidateType === "relay" ? "pela VPS" : "direta") : "",
    travadas: rtp.freezeCount || 0,
    limite: { bandwidth: "limitado pela internet", cpu: "limitado pelo processador" }[rtp.qualityLimitationReason] || "",
    codec: (codecs.get(rtp.codecId) || "").replace("video/", ""),
    // Só no envio: quem está codificando (placa de vídeo ou processador).
    quem: rtp.type !== "outbound-rtp" ? "" : rtp.powerEfficientEncoder ? "placa de vídeo"
      : /OpenH264|libvpx|libaom|Simulcast/i.test(rtp.encoderImplementation || "") ? "processador" : "",
  };
}

function linhaMedida(m) {
  const partes = [`${m.res} · ${m.qps} qps · ${numero(m.mbps)} Mbps` + (m.codec ? ` · ${m.codec}` : "") + (m.quem ? ` (${m.quem})` : "")];
  partes.push([m.ping != null ? `ping ${m.ping} ms` : "", `perda ${numero(m.perda)}%`, m.caminho].filter(Boolean).join(" · "));
  if (m.travadas) partes.push(`travadas: ${m.travadas}`);
  if (m.limite) partes.push(m.limite);
  return partes;
}

setInterval(async () => {
  if (!estado.medidor) return;
  for (const bloco of document.querySelectorAll("#palco .bloco")) {
    const med = bloco.medicao, caixa = bloco.querySelector(".medidor");
    if (!med || !caixa) continue;
    let linhas = [];
    try {
      if (med.par) {
        // Tela de outra pessoa: o que está chegando aqui.
        const faixa = med.stream.getVideoTracks()[0];
        const pcs = [med.par.pc, med.par.pcN, med.par.pcP].filter(Boolean);
        const pcM = pcs.find((c) => c.getReceivers().some((r) => r.track === faixa));
        const rec = pcM && pcM.getReceivers().find((r) => r.track === faixa);
        const m = rec && await medirCanal(pcM, rec, med.antes, "rec");
        if (m) linhas = linhaMedida(m);
      } else {
        // A minha tela: uma linha para cada pessoa que está recebendo.
        for (const par of canaisDeEnvio()) {
          const s = par.envios.find((x) => x.track && x.track.kind === "video");
          const m = s && await medirCanal(par.pc, s, med.antes, par.id);
          if (m) linhas.push(`${par.nome}: ${linhaMedida(m).join(" · ")}`);
        }
        if (!linhas.length) linhas = ["Ninguém recebendo ainda"];
      }
    } catch (_) {}
    caixa.textContent = linhas.join("\n") || "medindo...";
  }
}, 1000);

// ---------- parar de assistir (sem sair da sala) ----------
// Só esconde as telas e o som aqui neste aparelho. Quem transmite não muda nada.
function blocosDosOutros() {
  return [...$("palco").querySelectorAll(".bloco:not(.escondido)")].filter((b) => b !== meuBloco && !b.classList.contains("meu-celular") && !b.classList.contains("minha-camera"));
}

// Escolher quais telas assistir: "Não assistir esta tela" esconde só a de uma pessoa
// (sem imagem nem som dela aqui). Ela vira um botão na barrinha de cima para voltar.
function esconderTela(par, sim) {
  if (!par) return;
  if (sim) estado.escondidas.add(par.id); else estado.escondidas.delete(par.id);
  for (const b of par.blocos.values()) {
    b.classList.toggle("escondido", sim);
    pausarBloco(b, sim || !!estado.semAssistir);
  }
  atualizarPalco();
}

function desenharEscondidas() {
  const caixa = $("escondidas");
  const lista = [...estado.pares.values()].filter((p) => estado.escondidas.has(p.id) && p.transmitindo);
  caixa.hidden = !lista.length;
  caixa.replaceChildren();
  if (!lista.length) return;
  const t = document.createElement("span");
  t.textContent = "Telas que você não está assistindo:";
  caixa.append(t);
  for (const p of lista) {
    const b = document.createElement("button");
    b.className = "bt pequeno";
    b.type = "button";
    b.textContent = `Assistir ${p.nome}`;
    b.onclick = () => esconderTela(p, false);
    caixa.append(b);
  }
}

function pausarBloco(bloco, sim) {
  const video = bloco.querySelector("video");
  bloco.classList.toggle("parado", sim);
  if (!video) return;
  if (bloco === blocoCheio && sim) sairTelaCheia();
  if (video.srcObject) for (const f of video.srcObject.getTracks()) f.enabled = !sim;
  if (sim) video.pause();
  else video.play().catch(() => {});
}

function pararDeAssistir(sim) {
  estado.semAssistir = sim;
  for (const b of blocosDosOutros()) pausarBloco(b, sim);
  $("bt-parar-assistir").classList.toggle("ligado", sim);
  $("txt-parar-assistir").textContent = sim ? "Voltar a assistir" : "Parar de assistir";
  atualizarPalco();
}
$("bt-parar-assistir").addEventListener("click", () => pararDeAssistir(!estado.semAssistir));

function atualizarPlateia() {
  const pl = meuBloco && meuBloco.querySelector(".plateia");
  if (!pl) return;
  const assistindo = [...estado.pares.values()];
  const relaxados = assistindo.filter((p) => p.relaxado);
  pl.innerHTML = "";
  pl.append(assistindo.length === 1 ? "1 pessoa assistindo" : `${assistindo.length} pessoas assistindo`);
  if (relaxados.length) {
    const img = document.createElement("img");
    img.src = document.querySelector(".bt.relaxado img").src; img.alt = "";
    img.title = "Assistindo relaxado";
    pl.append(" · ", img, relaxados.map((p) => p.nome).join(", "));
  }
}

// Tela cheia. No app Android o WebView não tem a tela cheia do navegador: o
// bloco ganha a classe "cheia" (ocupa tudo) e o Java esconde as barras e gira a
// tela para o lado do vídeo (deitado para o PC, em pé para outro celular).
let blocoCheio = null;
const deitado = (video) => !video.videoHeight || video.videoWidth >= video.videoHeight;

function telaCheia(bloco, video) {
  if (celular) {
    if (blocoCheio) return sairTelaCheia();
    blocoCheio = bloco;
    bloco.classList.add("cheia");
    document.body.classList.add("tem-cheia");
    programa.telaCheia(true, deitado(video));
    return;
  }
  if (document.fullscreenElement) return document.exitFullscreen();
  if (bloco.requestFullscreen) {
    bloco.requestFullscreen({ navigationUI: "hide" }).then(() => {
      // Celular pelo navegador: gira a tela para o lado do vídeo.
      if (screen.orientation?.lock && matchMedia("(pointer: coarse)").matches) {
        screen.orientation.lock(deitado(video) ? "landscape" : "portrait").catch(() => {});
      }
    }).catch(() => {});
  } else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();   // iPhone
}

// ---------- mini tela (pop-up) ----------
// No PC e no site: a janelinha "picture-in-picture" do próprio navegador, que fica
// por cima de tudo, dá para arrastar e mudar de tamanho. No app Android: o modo
// "picture-in-picture" do Android, com a tela da pessoa ocupando a janelinha.
let blocoMini = null;
// App de PC 3.x (Tauri) sem o comando fecharMini: o close() do JavaScript não fecha a
// janela nativa (fica uma tela preta). Nesse caso a mini tela fica desligada.
function miniSemFechar() {
  return !!(programa && programa.miniJanela && !programa.fecharMini && /^3\./.test(programa.versao || ""));
}
function podeMiniTela() {
  if (miniSemFechar()) return false;
  if (programa && programa.miniJanela) return true;
  return celular ? !!programa.miniTela : !!document.pictureInPictureEnabled;
}

async function miniTela(bloco, video) {
  if (celular) {
    blocoMini = bloco;
    if (!programa.miniTela(deitado(video))) blocoMini = null;
    return;
  }
  if (miniSemFechar()) return;
  if (programa && programa.miniJanela) return miniJanela(bloco, video);
  try {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (e) {
    aviso({ titulo: "Não deu para abrir a mini tela.", texto: e.message });
  }
}

// A tela em tela cheia, ou a primeira de outra pessoa.
function miniTelaPrincipal() {
  const outros = blocosDosOutros();
  const bloco = outros.find((b) => b === blocoCheio || b === document.fullscreenElement) || outros[0];
  if (bloco) return miniTela(bloco, bloco.querySelector("video"));
}

// Programa do PC: a mini tela é uma janelinha do próprio programa (main.js cria a
// janela, fora do Alt+Tab e sem tirar o foco do jogo) e o vídeo é posto nela daqui.
// O som continua saindo da janela principal: o vídeo da mini tela fica mudo.
let janelaMini = null;
function miniAberta() { return !!(janelaMini && !janelaMini.closed); }

function fecharMiniJanela() {
  // 3.0.x (Tauri): o close() do JavaScript só apaga a página e a janela nativa fica preta.
  // Quem fecha de verdade é o programa (comando fechar_mini, a partir da 3.0.3).
  if (programa && programa.fecharMini) { try { programa.fecharMini(); } catch (e) {} }
  if (miniAberta()) janelaMini.close();
  janelaMini = null;
}

function miniJanela(bloco, video) {
  if (miniAberta()) {
    if (janelaMini.astraVideo === video) return fecharMiniJanela();
    fecharMiniJanela();
  }
  const w = window.open("about:blank", "astra-mini");
  if (!w) { aviso({ titulo: "Não deu para abrir a mini tela." }); return; }
  janelaMini = w;
  w.astraVideo = video;
  const d = w.document;
  d.title = "Mini tela";
  // O CSP da janela principal vale também aqui (proíbe <style> solto): o estilo vai
  // por uma folha criada pelo JavaScript.
  const folha = new w.CSSStyleSheet();
  folha.replaceSync(`
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; -webkit-app-region: drag; user-select: none; }
      video { width: 100%; height: 100%; object-fit: contain; display: block; }
      .botoes { position: fixed; top: 6px; right: 6px; display: flex; gap: 4px; }
      button { -webkit-app-region: no-drag; width: 26px; height: 26px; border: 0; border-radius: 6px; padding: 0;
        display: grid; place-items: center; background: rgba(0,0,0,.55); color: #fff; cursor: pointer; opacity: .75; }
      button:hover { background: rgba(0,0,0,.85); opacity: 1; }`);
  d.adoptedStyleSheets = [folha];
  d.body.innerHTML = `
    <video autoplay playsinline muted></video>
    <div class="botoes">
      <button id="voltar" title="Abrir o Astra"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7ZM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7Z"/></svg></button>
      <button id="fechar" title="Fechar a mini tela"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4Z"/></svg></button>
    </div>`;
  const v = d.querySelector("video");
  v.srcObject = video.srcObject;
  v.play().catch(() => {});
  d.getElementById("fechar").onclick = fecharMiniJanela;
  d.getElementById("voltar").onclick = () => { fecharMiniJanela(); programa.mostrar(); };
  // A tela de quem eu assistia acabou (ou trocou): a mini tela fecha sozinha.
  const vigia = setInterval(() => {
    if (!miniAberta() || janelaMini !== w) return clearInterval(vigia);
    if (!bloco.isConnected || !video.srcObject || video.srcObject !== v.srcObject) { clearInterval(vigia); fecharMiniJanela(); }
  }, 1000);
}

// Programa do PC: minimizou (ou mandou para perto do relógio) assistindo alguém = abre
// a mini tela sozinho; voltou para a janela = a mini tela fecha.
// Janela escondida (minimizada, perto do relógio ou aba em segundo plano): as animações param.
// Só o visual: a transmissão, o som e o chat continuam iguais.
function marcarEscondido(sim) { document.documentElement.classList.toggle("escondido", !!sim); }
document.addEventListener("visibilitychange", () => marcarEscondido(document.hidden));
window.aoEsconder = () => marcarEscondido(true);
window.aoMostrar = () => marcarEscondido(false);
window.aoMinimizar = () => {
  if (miniSemFechar() || ler("astra.miniAuto") === "0" || estado.semAssistir || document.pictureInPictureElement || miniAberta()) return;
  if (blocosDosOutros().length) miniTelaPrincipal();
};
window.aoRestaurar = () => {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  fecharMiniJanela();
};

// O Android entrou ou saiu da mini tela: só a tela escolhida aparece.
function aoMiniTelaCelular(sim) {
  document.body.classList.toggle("mini", sim);
  for (const b of document.querySelectorAll(".bloco.no-mini")) b.classList.remove("no-mini");
  if (sim && blocoMini && blocoMini.isConnected) blocoMini.classList.add("no-mini");
  if (!sim) blocoMini = null;
}

function sairTelaCheia() {
  if (!blocoCheio) return;
  blocoCheio.classList.remove("cheia");
  blocoCheio = null;
  document.body.classList.remove("tem-cheia");
  programa.telaCheia(false, false);
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) { try { screen.orientation?.unlock?.(); } catch (_) {} }
});

// ---------- assistir relaxado ----------
function ligarRelaxado(sim) {
  estado.relaxado = sim;
  $("bt-relaxado").classList.toggle("ligado", sim);
  $("bt-relaxado").querySelector("span").textContent = sim ? "Relaxando..." : "Assista relaxado";
  $("faixa-relaxado").hidden = !sim;
  $("app").classList.toggle("cinema", sim && !document.documentElement.classList.contains("v5-ver-inicio"));
  programa?.relaxado(sim);   // no PC: não deixa a tela apagar
}

$("bt-relaxado").addEventListener("click", () => {
  const sim = !estado.relaxado;
  ligarRelaxado(sim);
  enviar({ t: "relaxado", sim });
  desenharSala();
  if (sim) {
    const aoVivo = [...estado.pares.values()].filter((p) => p.transmitindo).map((p) => p.nome);
    aviso({
      titulo: "Modo relaxado ligado",
      texto: aoVivo.length ? `Avisamos ${aoVivo.join(", ")} que você está curtindo de longe.`
                           : "Quando alguém transmitir, vai saber que você está curtindo de longe.",
      imagem: "relaxado.png",
    });
  }
});
$("bt-sair-relaxado").addEventListener("click", () => $("bt-relaxado").click());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && estado.relaxado && $("seletor").hidden) $("bt-relaxado").click();
});

// ---------- modo Acorde ----------
// Quem transmite toca a campainha; quem assiste vê o aviso na tela, ouve o
// "ding-dong" e responde "Tô vendo!".
let fecharCampainha = null;

$("bt-acorde").addEventListener("click", () => {
  enviar({ t: "acorde" });
  const bt = $("bt-acorde");
  bt.disabled = true;
  bt.querySelector("span").textContent = "Campainha tocada!";
  setTimeout(() => { bt.disabled = false; bt.querySelector("span").textContent = "Acorde!"; }, 8000);
  const relaxados = [...estado.pares.values()].filter((p) => p.relaxado).map((p) => p.nome);
  aviso({
    titulo: "Campainha tocada!",
    texto: relaxados.length ? `${relaxados.join(", ")} estava relaxando. Agora vai ver.` : "Avisamos todo mundo da sala.",
    imagem: "acorde.png",
  });
});

// Quem não quer ser chamado pode desligar o Acorde (fica guardado neste aparelho).
const acordeLigado = () => ler("astra.acorde") !== "0";
const ICONE_CAMPAINHA = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg>';
const ICONE_CAMPAINHA_NAO = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" opacity=".55"/><path fill="currentColor" d="M4.2 2.8 21.2 19.8l-1.4 1.4L2.8 4.2Z"/></svg>';
function desenharBotaoAcorde() {
  const sim = acordeLigado();
  const bt = $("bt-campainha");
  bt.innerHTML = sim ? ICONE_CAMPAINHA : ICONE_CAMPAINHA_NAO;
  bt.classList.toggle("desligado", !sim);
  bt.setAttribute("aria-pressed", String(sim));
  bt.title = sim ? "Acorde (campainha de quem transmite): ligado (clique para desligar)"
                 : "Acorde (campainha de quem transmite): desligado (clique para ligar)";
  bt.setAttribute("aria-label", bt.title);
}
function mudarAcorde(sim) {
  guardar("astra.acorde", sim ? "1" : "0");
  desenharBotaoAcorde();
  aviso({ titulo: sim ? "Acorde ligado" : "Acorde desligado",
          texto: sim ? "Quem transmite pode tocar a campainha para você." : "A campainha não toca mais para você. Ligue de novo no botão ao lado do sininho do chat.",
          tempo: 4000 });
}
$("bt-campainha").addEventListener("click", () => mudarAcorde(!acordeLigado()));
$("bt-sem-acorde").addEventListener("click", () => { if (fecharCampainha) fecharCampainha(false); mudarAcorde(false); });
desenharBotaoAcorde();

function tocarCampainha(m) {
  if (!acordeLigado()) return;
  if (fecharCampainha) fecharCampainha();
  $("campainha-texto").textContent = `${m.nome} quer que você veja uma jogada agora!`;
  $("campainha").hidden = false;
  programa?.acorde(m.nome);   // no PC: traz a janela para a frente e pisca na barra
  dingDong();
  const repetir = setInterval(dingDong, 3500);
  const fim = setTimeout(() => fechar(false), 15000);
  function fechar(vi) {
    clearInterval(repetir);
    clearTimeout(fim);
    $("campainha").hidden = true;
    fecharCampainha = null;
    if (vi) enviar({ t: "acordei", para: m.id });
  }
  fecharCampainha = fechar;
  $("bt-to-vendo").onclick = () => fechar(true);
  $("bt-to-vendo").focus();
}

// "Ding-dong" de campainha, feito na hora (sem arquivo de som).
function dingDong() {
  try {
    if (!somLiberado()) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notas = [[659.25, 0], [523.25, 0.45]];   // mi e dó
    for (const [freq, quando] of notas) {
      for (const [mult, vol] of [[1, 0.35], [2, 0.12], [3, 0.05]]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        const t0 = ctx.currentTime + quando;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.3);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 1.4);
      }
    }
    setTimeout(() => ctx.close(), 2200);
  } catch (_) {}
}

// Se existir um acorde.gif (animado) na pasta do site, ele é usado no lugar do .png.
// Para ligar: coloque o acorde.gif na pasta web e <meta name="astra-acorde-gif" content="1"> no index.html.
// (Antes ele era testado em toda abertura e, sem o arquivo, gerava um erro 404 no console.)
(function () {
  if (!document.querySelector('meta[name="astra-acorde-gif"]')) return;
  const teste = new Image();
  teste.onload = () => {
    for (const img of document.querySelectorAll('img[src="acorde.png"]')) img.src = "acorde.gif";
    $("campainha-img").src = "acorde.gif";
  };
  teste.src = "acorde.gif";
})();

// ---------- transmitir a minha tela ----------
// Navegador de celular (não o app Android): Chrome, Firefox e Samsung Internet no Android têm a
// função getDisplayMedia, mas ela sempre recusa com "NotAllowedError" (não existe captura de tela
// no navegador do Android). Antes isso era tratado como "a pessoa cancelou" e a transmissão
// fechava sem aviso nenhum. Agora: tenta de verdade (se um dia o navegador passar a deixar,
// funciona) e, se recusar, explica a limitação.
const navegadorCelular = !programa && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.userAgentData && navigator.userAgentData.mobile)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));   // iPad "modo computador"
const podeTransmitir = celular || !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
if (!podeTransmitir) {
  $("bt-tela").hidden = true;
  $("aviso-celular").hidden = false;
} else if (!programa) {
  $("sel-qualidade").hidden = !!navegadorCelular;   // no site do PC, a qualidade fica ao lado do botão
}
function avisarSemCaptura(detalhe) {
  const android = /Android/i.test(navigator.userAgent);
  aviso({
    titulo: "Este navegador não transmite a tela",
    texto: (android
      ? "O navegador do Android não deixa sites capturarem a tela. Para transmitir do celular, use o app Android da Astra; no PC, use o programa ou o Chrome/Edge."
      : "O navegador deste aparelho não deixa sites capturarem a tela. Para transmitir, use o programa no PC (ou o Chrome/Edge do computador).")
      + (detalhe ? ` (${detalhe})` : "") + " Assistir continua funcionando normalmente.",
    tempo: 15000,
  });
  $("aviso-celular").hidden = false;
}

let meuBloco = null;

$("bt-tela").addEventListener("click", () => {
  if (souAoVivo()) return pararTela();
  // No programa (e no app Android), primeiro abre a janela "Transmitir tela"
  // (desktop.js ou celular.js).
  if (programa) return window.astraSeletor.abrir();
  iniciarTela({ qualidade: $("sel-qualidade").value, modo: "motion", som: "navegador" });
});

// opcoes: {qualidade, modo ("motion"/"detail"), som ("sem-discord"/"janela"/"tudo"/"nenhum"/"navegador")}
async function iniciarTela(opcoes) {
  const q = QUALIDADES[opcoes.qualidade] || QUALIDADES.auto;
  estado.semNotif = opcoes.notif !== "mostrar";
  estado.mostrarTeclas = false;   // 3.0.20: "mostrar teclas" foi removido (ninguém manda nem mostra mais)
  if (celular) {
    // No Android quem captura e manda a tela é o Java (celular.js avisa quando começou).
    programa.iniciarCelular(opcoes, estado.ice);
    return;
  }
  let stream;
  const pediuEm = performance.now();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: q.largura }, height: { max: q.altura }, frameRate: { ideal: q.qps, max: q.qps } },
      // Áudio do PC sem filtros de voz (música e jogo ficam naturais).
      // restrictOwnAudio: no site, o Chrome deixa de fora o som da própria aba (a música da sala).
      audio: opcoes.som === "nenhum" ? false : { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    });
  } catch (e) {
    // Navegadores de celular que aceitam a captura (ex.: Safari mais novo) podem recusar as opções
    // de PC (áudio do sistema, limites de tamanho): tenta mais uma vez só com o vídeo.
    if (navegadorCelular && (e.name === "TypeError" || e.name === "OverconstrainedError" || e.name === "NotSupportedError")) {
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); } catch (e2) { e = e2; }
    }
    if (!stream) {
      const instantaneo = performance.now() - pediuEm < 900;   // recusou sem mostrar escolha nenhuma
      if (navegadorCelular && (e.name !== "NotAllowedError" || instantaneo)) avisarSemCaptura();
      else if (e.name !== "NotAllowedError" && e.name !== "AbortError") aviso({ titulo: "Não consegui capturar a tela.", texto: e.message });
      return;   // NotAllowedError depois de a pessoa ver a escolha = ela cancelou: nada a avisar
    }
  }
  if (!stream.getVideoTracks().length || stream.getVideoTracks()[0].readyState === "ended") {
    for (const f of stream.getTracks()) f.stop();
    avisarSemCaptura("a captura terminou logo ao começar");
    return;
  }

  // No programa do PC o som vem do capturador do Windows (desktop.js), que deixa de
  // fora o próprio AstraScreenShare: a música da sala e as telas dos amigos não
  // voltam pela transmissão (sem eco). "Todo o som" usa o som do Windows como
  // reserva se o capturador não abrir (Windows antigo).
  if (programa && (opcoes.som === "sem-discord" || opcoes.som === "janela" || opcoes.som === "tudo")) {
    const r = await window.astraSom.iniciar();
    const reserva = stream.getAudioTracks();
    if (r.faixa) {
      for (const f of reserva) { f.stop(); stream.removeTrack(f); }
      stream.addTrack(r.faixa);
    } else {
      // 3.0.20: o capturador (astra-audio) falhou. Avisa a equipe (log) e a pessoa: a reserva é o som do
      // Windows inteiro, que NÃO separa o Discord nem a janela.
      try {
        enviar({ t: "erro-app", msg: ("Som (" + opcoes.som + "): astra-audio falhou: " + (r.erro || "?")).slice(0, 200), onde: "astra-audio",
          pilha: reserva.length ? "usando o som do Windows (reserva)" : "sem som", versao: (programa && programa.versao) || "site" });
      } catch { /* sem conexão */ }
      if (!reserva.length) aviso({ titulo: "Transmitindo sem som", texto: r.erro, tempo: 9000 });
      else if (opcoes.som !== "tudo") aviso({ titulo: "Som do PC inteiro", texto: "Não consegui separar o som (" + (r.erro || "capturador não abriu") + "). Quem assiste ouve todo o som do PC, inclusive o Discord.", tempo: 9000 });
    }
  } else if (opcoes.som !== "nenhum" && !stream.getAudioTracks().length) {
    aviso({ titulo: "Transmitindo sem som", texto: "Para mandar o som, marque \"Compartilhar áudio\" ao escolher a tela." });
  }

  const video = stream.getVideoTracks()[0];
  video.contentHint = opcoes.modo || "motion";
  video.onended = () => pararTela();   // botão "Parar de compartilhar" do navegador
  estado.tela = stream;
  estado.qualidade = q;
  estado.hw = opcoes.hw !== "nao";   // aceleração por hardware (no site, sempre ligada)
  meuBloco = criarBloco(null, stream);
  // No site, transmitindo a tela inteira ou uma janela, a minha prévia apareceria dentro
  // da própria live (efeito de espelho): ela fica escondida, com um botão para mostrar.
  estado.superficie = (video.getSettings && video.getSettings().displaySurface) || "";
  if (!programa && estado.superficie !== "browser") esconderPrevia(true);
  atualizarPrevia();
  // Modo leve (opção do programa do PC): a tela vai uma vez só para a ponte da VPS.
  estado.leve = !celular && ((!!programa && opcoes.leve === "sim") || salaGrande());   // 2 ou mais na sala: ponte sozinha (3.0.11)
  if (estado.leve) {
    const ok = await publicarNaPonte();
    if (estado.tela !== stream) return;   // parou enquanto ligava
    if (!ok) {
      estado.leve = false;
      aviso({ titulo: "Modo leve indisponível", texto: "Não consegui ligar na ponte da VPS: transmitindo do jeito normal.", tempo: 8000 });
    }
  }
  aoComecarTransmissao();
  for (const par of estado.pares.values()) if (!(estado.ponte && par.ponteOk)) enviarTela(par);
}
window.iniciarTela = iniciarTela;
// 3.0.17: o "Parar transmissão" do ícone perto do relógio já desligou tudo no programa; aqui só a página
// acompanha (botões, sala e avisar o servidor).
window.pararTelaPeloIcone = () => { if (souAoVivo()) pararTela(); };

// O app Android começou a transmitir (o Java já está capturando a tela).
function aoComecarCelular(telaId) {
  estado.telaNativa = telaId;
  meuBloco = criarBlocoCelular();
  aoComecarTransmissao();
  for (const par of estado.pares.values()) programa.novoParCelular(par.id);
}

// Link de assistir: quem abre só digita um nome e vê a tela (página assistir.html).
// Vale enquanto a sala estiver aberta.
function linkAssistir() {
  // 2.7.42: sempre pelo domínio (antes saía pelo endereço com o IP da VPS antiga, que não existe mais).
  // A página /app/v/ pede os arquivos com caminho relativo, então funciona dentro do /app/.
  return "https://astrascreenshare.com/app/v/" + encodeURIComponent(estado.convite);
}
function copiarLinkAssistir() {
  if (estado.convite) copiar(linkAssistir(), "Link copiado! Cole para quem vai assistir.");
}
$("bt-link").addEventListener("click", copiarLinkAssistir);

// O que muda na tela quando eu começo a transmitir (PC, site ou celular).
function aoComecarTransmissao() {
  estado.pausado = false;
  $("bt-pausa").hidden = false;
  desenharPausa();
  if (estado.mostrarTeclas && programa && programa.teclas) programa.teclas(true);
  $("bt-tela").classList.add("ao-vivo");
  $("bt-tela").querySelector("span").textContent = "Parar transmissão";
  $("sel-qualidade").disabled = true;
  $("bt-acorde").hidden = false;
  $("bt-link").hidden = !estado.convite;
  if (estado.convite) {
    aviso({ titulo: "Você está ao vivo", texto: "Mande o link: quem abrir só digita um nome e assiste.",
            botoes: [{ texto: "Copiar link", classe: "primario", acao: copiarLinkAssistir }], tempo: 10000 });
  }
  $("bt-relaxado").hidden = true;
  if (estado.relaxado) { ligarRelaxado(false); enviar({ t: "relaxado", sim: false }); }

  enviarEstado();
  programa?.transmitindo(true);
  if (estado.semNotif && !celular) {
    // 3.0.20: PC: status "Não perturbe" da conta (notificações do Astra) + Não perturbe do Windows (outros programas)
    estado.escondendoNaLive = true;
    statusDaLive(true);
    programa?.silencio?.(true);
  } else if (estado.semNotif && programa && programa.silencio && programa.silencio(true) === false) {
    // Android: o "Não perturbe" precisa de uma permissão dada uma vez nas configurações.
    aviso({
      titulo: "As notificações vão aparecer na live",
      texto: "Para escondê-las, deixe o Astra usar o \"Não perturbe\".",
      botoes: [{ texto: "Permitir", classe: "primario", acao: () => programa.pedirSilencio() }],
      tempo: 12000,
    });
  }
  desenharSala();
}

// No celular não dá para mostrar a própria tela dentro dela mesma: fica um cartão.
function criarBlocoCelular() {
  const bloco = document.createElement("div");
  bloco.className = "bloco meu-celular";
  const txt = document.createElement("div");
  txt.className = "celular-ao-vivo";
  txt.innerHTML = '<span class="pilula">AO VIVO</span><b>Você está transmitindo a tela do celular</b><small>Pode sair do app e abrir o jogo. Para parar, volte aqui ou use a notificação.</small>';
  const plateia = document.createElement("div");
  plateia.className = "plateia";
  bloco.append(txt, plateia);
  $("palco").append(bloco);
  atualizarPalco();
  return bloco;
}

// Recados do Java (app Android).
if (celular) {
  programa.aoEventoCelular((ev) => {
    if (ev.tipo === "iniciada") aoComecarCelular(ev.telaId);
    else if (ev.tipo === "parada") pararTela();
    else if (ev.tipo === "erro") aviso({ titulo: "Não deu para transmitir", texto: ev.msg, tempo: 9000 });
    else if (ev.tipo === "sinal") enviar({ t: "sinal", para: ev.para, dados: ev.dados });
    else if (ev.tipo === "sair-tela-cheia") sairTelaCheia();   // botão "voltar" do Android
    else if (ev.tipo === "mini-tela") aoMiniTelaCelular(ev.sim);
  });
}

function enviarTela(par) {
  if (par.envios.length) return;   // já está mandando
  const q = estado.qualidade || QUALIDADES["1080-60"];
  for (let faixa of estado.tela.getTracks()) {
    if (faixa.kind === "video" && estado.recorte) faixa = estado.recorte.faixa;   // só com o recorte ligado
    const enc = faixa.kind === "video"
      ? { maxBitrate: q.bitrate, maxFramerate: q.qps }
      : { maxBitrate: 128_000 };
    const t = par.pc.addTransceiver(faixa, { direction: "sendonly", streams: [estado.tela], sendEncodings: [enc] });
    t.sender._tipo = faixa.kind;
    par.envios.push(t.sender);
    if (estado.pausado) t.sender.replaceTrack(null).catch(() => {});   // entrou com a live pausada
    if (faixa.kind === "video" && estado.hw) preferirH264(t);
    if (faixa.kind === "video") {
      // Automática: "balanced" (quando aperta, o WebRTC divide a perda entre resolução e quadros).
      // 2.7.11: qualidade escolhida à mão (1080p etc.) = a resolução fica travada; se a internet
      // ou o PC apertarem, caem os quadros por segundo, nunca a resolução.
      const p = t.sender.getParameters();
      p.degradationPreference = q.auto ? "balanced" : "maintain-resolution";
      t.sender.setParameters(p).catch(() => {});
    }
  }
}

// ---------- câmera ----------
// Vai direto para cada pessoa da sala (pequena: 640x360, 30 qps), junto com a tela ou
// sozinha. Só imagem: a voz continua no Discord. A tela não muda em nada.
async function ligarCamera(sim) {
  if (!sim) {
    if (!estado.camera) return;
    for (const f of estado.camera.getTracks()) f.stop();
    for (const par of estado.pares.values()) {
      for (const s of par.enviosCam || []) { try { par.pc.removeTrack(s); } catch (_) {} }
      par.enviosCam = [];
    }
    estado.camera = null;
    $("palco").querySelector(".minha-camera")?.remove();
    $("bt-camera").classList.remove("camera-ligada");
    $("bt-camera").querySelector("span").textContent = "Câmera";
    atualizarPalco();
    return;
  }
  if (estado.camera) return;
  try {
    estado.camera = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } }, audio: false,
    });
  } catch (e) {
    aviso({ titulo: "Não consegui ligar a câmera", texto: e.name === "NotFoundError" ? "Nenhuma câmera encontrada neste aparelho." : e.message, tempo: 7000 });
    return;
  }
  estado.camera.getVideoTracks()[0].onended = () => ligarCamera(false);
  const bloco = document.createElement("div");
  bloco.className = "bloco minha-camera";
  const video = document.createElement("video");
  video.autoplay = true; video.playsInline = true; video.muted = true;
  video.srcObject = estado.camera;
  const rotulo = document.createElement("div");
  rotulo.className = "rotulo";
  rotulo.innerHTML = '<span class="pilula">CÂMERA</span><span>Você</span>';
  bloco.append(video, rotulo);
  $("palco").append(bloco);
  $("bt-camera").classList.add("camera-ligada");
  $("bt-camera").querySelector("span").textContent = "Desligar câmera";
  for (const par of estado.pares.values()) enviarCamera(par);
  atualizarPalco();
}

function enviarCamera(par) {
  if (!estado.camera || (par.enviosCam && par.enviosCam.length)) return;
  const faixa = estado.camera.getVideoTracks()[0];
  const t = par.pc.addTransceiver(faixa, { direction: "sendonly", streams: [estado.camera],
                                          sendEncodings: [{ maxBitrate: 800_000, maxFramerate: 30 }] });
  par.enviosCam = [t.sender];
}

$("bt-camera").addEventListener("click", () => ligarCamera(!estado.camera));
if (celular) $("bt-camera").hidden = true;   // no app do celular ainda não

function enviarEstado() {
  enviar({ t: "estado", transmitindo: true, telaId: meuTelaId(), pausado: !!estado.pausado, ponte: !!estado.ponte });
}

// ---------- Modo leve (ponte na VPS) ----------
// Do jeito normal, a tela vai separada para cada pessoa: o PC codifica a imagem uma
// vez por pessoa. No Modo leve ela vai uma vez só para a ponte da VPS, que repassa a
// MESMA imagem (mesmos quadros, resolução e codec) para todo mundo. Quem está numa
// versão sem a ponte continua recebendo direto, do jeito de sempre.
const esperasPonte = new Map();   // "publicar" ou "assistir:<id>" -> quem espera a resposta

function pedirPonte(chave, msg) {
  return new Promise((resolver) => {
    esperasPonte.get(chave)?.({ erro: "pedido repetido" });
    esperasPonte.set(chave, resolver);
    enviar({ t: "ponte", ...msg });
    setTimeout(() => {
      if (esperasPonte.get(chave) !== resolver) return;
      esperasPonte.delete(chave);
      resolver({ erro: "A ponte não respondeu." });
    }, 20000);
  });
}

TRATAR.ponte = (m) => {
  const chave = m.acao === "publicar" ? "publicar" : "assistir:" + m.emissor;
  const resolver = esperasPonte.get(chave);
  if (resolver) { esperasPonte.delete(chave); resolver(m); }
};

function esperarConectar(pc, ms) {
  return new Promise((resolver) => {
    const fim = (ok) => { clearTimeout(relogio); pc.removeEventListener("connectionstatechange", ver); resolver(ok); };
    const ver = () => {
      if (pc.connectionState === "connected") fim(true);
      else if (pc.connectionState === "failed" || pc.connectionState === "closed") fim(false);
    };
    const relogio = setTimeout(() => fim(false), ms);
    pc.addEventListener("connectionstatechange", ver);
  });
}

// Liga a minha transmissão na ponte. A ponte entra na lista de envios como se fosse
// mais uma pessoa (pausar, recortar e a qualidade automática valem para ela também).
async function publicarNaPonte() {
  fecharPonteDoEmissor();
  const ponte = { id: "ponte", nome: "Ponte da VPS", envios: [], pc: new RTCPeerConnection({ iceServers: estado.ice }) };
  estado.ponte = ponte;
  enviarTela(ponte);
  try {
    await ponte.pc.setLocalDescription();
    const r = await pedirPonte("publicar", { acao: "publicar", sdp: ponte.pc.localDescription.sdp });
    if (estado.ponte !== ponte) return false;
    if (r.erro || !r.sdp) throw new Error(r.erro || "sem resposta");
    const conectou = esperarConectar(ponte.pc, 10000);
    await ponte.pc.setRemoteDescription({ type: "answer", sdp: r.sdp });
    if (!(await conectou)) throw new Error("não conectou na porta da ponte");
    if (estado.ponte !== ponte) return false;
    ponte.pc.onconnectionstatechange = () => {
      const st = ponte.pc.connectionState;
      if ((st === "failed" || st === "closed") && estado.ponte === ponte) caiuPonte();
    };
    return true;
  } catch (e) {
    console.warn("ponte", e);
    if (estado.ponte === ponte) fecharPonteDoEmissor();
    return false;
  }
}

function fecharPonteDoEmissor() {
  if (!estado.ponte) return;
  try { estado.ponte.pc.close(); } catch (_) {}
  estado.ponte = null;
}

// A ponte caiu no meio da live: tenta de novo; não deu, segue do jeito normal.
async function caiuPonte() {
  if (!souAoVivo()) return;
  const ok = await publicarNaPonte();
  if (!souAoVivo()) return;
  if (!ok) usarSemPonte("A ponte da VPS caiu");
  enviarEstado();
}

function usarSemPonte(motivo) {
  fecharPonteDoEmissor();
  estado.leve = false;
  if (estado.tela) for (const par of estado.pares.values()) enviarTela(par);
  aviso({ titulo: "Modo leve desligado", texto: `${motivo}: transmitindo do jeito normal.`, tempo: 8000 });
}

// ---------- salas grandes: ponte automática ----------
// Até 8 pessoas a tela vai direto para cada uma. Passou disso, mandar uma cópia por pessoa
// pesa demais no PC e na internet de quem transmite: a tela passa a ir uma vez só para a
// ponte da VPS (mesma imagem, mesma qualidade), mesmo com o Modo leve desligado.
// v5.1 tinha baixado para 3 pessoas, mas aí quase toda live passava pela VPS (longe, nos EUA)
// e a imagem quadriculava quando a internet apertava. 2.7.20 (pedido do dono): a ponte só
// liga sozinha com mais de 8 pessoas na sala; até 8 a tela vai sempre direto.
// 3.0.11: era 8. Com a captura em janela separada (3.0), cada espectador direto custa mais uma
// codificação 1080p60 no PC de quem transmite: passou do limite da placa, cai no processador (CPU 100%,
// tela branca). Agora a partir de 2 espectadores a tela vai UMA vez só para a ponte da VPS.
const PONTE_AUTO_ACIMA = 2;
function salaGrande() { return estado.pares.size + 1 > PONTE_AUTO_ACIMA; }
let ligandoPonteAuto = false;
async function ponteAutomatica() {
  if (!souAoVivo() || celular || !estado.tela || estado.ponte || ligandoPonteAuto || !salaGrande()) return;
  ligandoPonteAuto = true;
  const tela = estado.tela;
  const ok = await publicarNaPonte();
  ligandoPonteAuto = false;
  if (!ok || estado.tela !== tela) return;
  estado.leve = true;
  enviarEstado();
  aviso({ titulo: "Transmissão pela ponte", texto: "Mais de uma pessoa assistindo: a tela vai uma vez só para a VPS, na mesma qualidade (menos peso no seu PC).", tempo: 6000 });
  // Dá um tempo para todo mundo ligar na ponte e só então para de mandar direto
  // (quem está numa versão sem a ponte continua recebendo direto).
  setTimeout(() => {
    if (!estado.ponte || estado.tela !== tela) return;
    for (const par of estado.pares.values()) {
      if (!par.ponteOk || !par.envios.length) continue;
      for (const s of par.envios) { try { par.pc.removeTrack(s); } catch (_) {} }
      par.envios = [];
    }
  }, 5000);
}

// Para onde a minha tela vai: a ponte (se ligada) e quem recebe direto.
function canaisDeEnvio() {
  return estado.ponte ? [estado.ponte, ...estado.pares.values()] : [...estado.pares.values()];
}

// Assistir uma tela que está no Modo leve: uma conexão com a ponte da VPS.
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
    if (pc.connectionState === "failed" || pc.connectionState === "closed") tentarPonteDeNovo(par);
  };
  try {
    await pc.setLocalDescription();
    const r = await pedirPonte("assistir:" + par.id, { acao: "assistir", emissor: par.id, sdp: pc.localDescription.sdp });
    if (par.pcP !== pc) return;
    if (r.erro || !r.sdp) throw new Error(r.erro || "sem resposta");
    await pc.setRemoteDescription({ type: "answer", sdp: r.sdp });
  } catch (e) {
    console.warn("ponte", e);
    if (par.pcP === pc) tentarPonteDeNovo(par);
  }
}

function tentarPonteDeNovo(par) {
  fecharPonte(par);
  par.tentativasPonte = (par.tentativasPonte || 0) + 1;
  if (par.tentativasPonte > 5) {
    aviso({ titulo: `Não consegui abrir a tela de ${par.nome}`, tempo: 9000,
            texto: "A ponte da VPS não respondeu. Peça para a pessoa transmitir sem o Modo leve." });
    return;
  }
  setTimeout(() => {
    if (estado.pares.get(par.id) === par && par.ponte) assistirPonte(par);
  }, 1500 * par.tentativasPonte);
}

function fecharPonte(par) {
  if (!par.pcP) return;
  par.pcP.close();
  par.pcP = null;
  removerBloco(par, "astra-" + par.id);   // a ponte usa este nome para a tela de cada pessoa
}

// H.264 primeiro: no Windows ele é feito pela placa de vídeo (NVIDIA, AMD ou Intel), e
// o processador fica livre para o jogo. O VP8 (o padrão) é feito todo no processador.
// Os outros codecs continuam na lista, para quem não tiver H.264.
// 08/11: o perfil 42e0 (Constrained Baseline) NÃO vai para a placa no Chromium/Electron 38:
// cai no OpenH264 (processador) e a live travava em ~30 qps. Medido numa GTX 1650, 1080p60:
// 42e0 = OpenH264 ~34 qps; 4d (Main) = placa de vídeo ~55 qps e menos processador.
// O Main existe também no codificador do processador: se a placa falhar, a live continua.
function preferirH264(transceptor) {
  try {
    const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities("video");
    if (!caps || !transceptor.setCodecPreferences) return;
    const nota = (c) => {
      if (c.mimeType !== "video/H264") return 9;
      const f = c.sdpFmtpLine || "";
      if (!/packetization-mode=1/.test(f)) return 8;
      if (/profile-level-id=4d/.test(f)) return 0;     // Main: placa de vídeo
      if (/profile-level-id=4200/.test(f)) return 1;   // Baseline: placa de vídeo
      if (/profile-level-id=64/.test(f)) return 2;     // High: placa de vídeo (só quando ela existe)
      if (/profile-level-id=42e0/.test(f)) return 3;   // Constrained Baseline: processador (Firefox etc.)
      return 4;
    };
    const lista = [...caps.codecs].sort((a, b) => nota(a) - nota(b));
    if (lista[0] && lista[0].mimeType === "video/H264") transceptor.setCodecPreferences(lista);
  } catch (e) { console.warn("H.264", e); }
}

// A minha prévia (a minha própria tela na janela) só é desenhada com a janela na frente.
// Escondida, minimizada ou com outro programa em foco (o jogo), ela fica parada na
// última imagem: poupa processador e placa de vídeo. Só a prévia para; a transmissão
// continua igual para os amigos.
function atualizarPrevia() {
  const v = meuBloco && meuBloco.querySelector("video");
  if (!v) return;
  const escondida = meuBloco.classList.contains("sem-previa");
  const ver = !escondida && !document.hidden && document.hasFocus();
  meuBloco.classList.toggle("previa-parada", !ver && !escondida);
  if (ver) v.play().catch(() => {}); else v.pause();
}
document.addEventListener("visibilitychange", atualizarPrevia);
window.addEventListener("focus", atualizarPrevia);
window.addEventListener("blur", atualizarPrevia);

// Qualidade automática: a cada 2 s olha cada pessoa que está assistindo. Se o envio
// está limitado (internet ou processador) e os quadros caíram, baixa um degrau da
// resolução para aquela pessoa; se ficou folgado por um tempo, sobe um degrau.
setInterval(async () => {
  const q = estado.qualidade;
  if (!estado.tela || !q || !q.auto) return;
  for (const par of canaisDeEnvio()) {
    for (const s of par.envios) {
      if (!s.track || s.track.kind !== "video") continue;
      let saida = null;
      try { (await s.getStats()).forEach((r) => { if (r.type === "outbound-rtp") saida = r; }); } catch (_) {}
      if (!saida) continue;
      s.auto = s.auto || { nivel: 0, ruim: 0, bom: 0 };
      const limitado = saida.qualityLimitationReason === "bandwidth" || saida.qualityLimitationReason === "cpu";
      const qps = saida.framesPerSecond || 0;
      s.auto.ruim = limitado && qps < q.qps * 0.75 ? s.auto.ruim + 1 : 0;
      s.auto.bom = !limitado ? s.auto.bom + 1 : 0;
      let novo = s.auto.nivel;
      if (s.auto.ruim >= 3 && novo < NIVEIS_AUTO.length - 1) novo++;
      else if (s.auto.bom >= 8 && novo > 0) novo--;
      if (novo === s.auto.nivel) continue;
      s.auto = { nivel: novo, ruim: 0, bom: 0 };
      const p = s.getParameters();
      if (!p.encodings || !p.encodings[0]) continue;
      p.encodings[0].scaleResolutionDownBy = NIVEIS_AUTO[novo];
      s.setParameters(p).catch(() => {});
    }
  }
}, 2000);

function pararTela() {
  if (!souAoVivo()) return;
  if (estado.telaNativa) { programa.pararCelular(); estado.telaNativa = ""; }
  desligarRecorte(false);
  if (estado.tela) for (const f of estado.tela.getTracks()) f.stop();
  window.astraSom?.parar();
  fecharPonteDoEmissor();
  for (const par of estado.pares.values()) {
    for (const s of par.envios) { try { par.pc.removeTrack(s); } catch (_) {} }
    par.envios = [];
  }
  estado.tela = null;
  if (meuBloco) { meuBloco.remove(); meuBloco = null; }
  atualizarPalco();
  $("bt-tela").classList.remove("ao-vivo");
  $("bt-tela").querySelector("span").textContent = "Transmitir tela";
  $("sel-qualidade").disabled = false;
  $("bt-acorde").hidden = true;
  $("bt-link").hidden = true;
  $("bt-relaxado").hidden = false;
  enviar({ t: "estado", transmitindo: false });
  programa?.transmitindo(false);
  programa?.silencio?.(false);
  estado.escondendoNaLive = false;
  statusDaLive(false);
  programa?.teclas?.(false);
  estado.pausado = false;
  $("bt-pausa").hidden = true;
  desenharSala();
}

// ---------- recortar: transmitir só uma parte da tela ----------
// Só funciona quando a pessoa escolhe recortar. Sem recorte, a faixa que sai é a
// mesma de sempre (a transmissão não muda nada). Com recorte, cada quadro da tela
// vira um quadro menor (VideoFrame com visibleRect, sem redesenhar a imagem) e a
// faixa nova entra no lugar da antiga (replaceTrack, sem renegociar).
const podeRecortar = !celular && "MediaStreamTrackProcessor" in window && "MediaStreamTrackGenerator" in window && "VideoFrame" in window;

function par2(n) { return Math.max(0, Math.round(n / 2) * 2); }

function ligarRecorte(r) {
  const original = estado.tela && estado.tela.getVideoTracks()[0];
  if (!original) return;
  if (estado.recorte) { estado.recorte.r = r; return; }
  const proc = new MediaStreamTrackProcessor({ track: original });
  const gerador = new MediaStreamTrackGenerator({ kind: "video" });
  gerador.contentHint = original.contentHint;
  const rc = { r, faixa: gerador, parar: false };
  estado.recorte = rc;
  (async () => {
    const leitor = proc.readable.getReader();
    const escritor = gerador.writable.getWriter();
    try {
      for (;;) {
        const { value: q, done } = await leitor.read();
        if (done) break;
        if (rc.parar) { q.close(); break; }
        const v = q.visibleRect;
        const w = Math.max(64, par2(rc.r.w * v.width)), h = Math.max(64, par2(rc.r.h * v.height));
        const x = Math.min(v.x + par2(rc.r.x * v.width), v.x + v.width - w);
        const y = Math.min(v.y + par2(rc.r.y * v.height), v.y + v.height - h);
        let novo = null;
        try { novo = new VideoFrame(q, { visibleRect: { x: Math.max(v.x, x), y: Math.max(v.y, y), width: Math.min(w, v.width), height: Math.min(h, v.height) } }); } catch (_) {}
        q.close();
        if (novo) await escritor.write(novo);
      }
    } catch (e) { console.warn("recorte", e); }
    leitor.cancel().catch(() => {});
    escritor.close().catch(() => {});
  })();
  trocarFaixaDeVideo(gerador);
}

function desligarRecorte(trocar = true) {
  const rc = estado.recorte;
  if (!rc) return;
  estado.recorte = null;
  rc.parar = true;
  if (trocar && estado.tela) trocarFaixaDeVideo(estado.tela.getVideoTracks()[0]);
  rc.faixa.stop();
}

function trocarFaixaDeVideo(faixa) {
  if (!estado.pausado) {   // pausada: a faixa nova entra quando voltar
    for (const par of canaisDeEnvio()) {
      for (const s of par.envios) if (s.track && s.track.kind === "video") s.replaceTrack(faixa).catch(() => {});
    }
  }
  // A minha prévia mostra o que os amigos estão vendo.
  const v = meuBloco && meuBloco.querySelector("video");
  if (v) v.srcObject = faixa === estado.tela.getVideoTracks()[0] ? estado.tela : new MediaStream([faixa]);
  atualizarPrevia();
}

let selecaoRecorte = null;   // {x, y, w, h} de 0 a 1, na tela inteira

function abrirRecorte() {
  if (!estado.tela) return;
  const v = $("recorte-video");
  v.srcObject = estado.tela;
  v.play().catch(() => {});
  selecaoRecorte = estado.recorte ? { ...estado.recorte.r } : null;
  desenharSelecao();
  $("modal-recorte").hidden = false;
}

function fecharRecorte() {
  $("modal-recorte").hidden = true;
  $("recorte-video").srcObject = null;
}

function desenharSelecao() {
  const sel = $("recorte-sel");
  $("recorte-ok").disabled = !selecaoRecorte;
  const a = areaDoVideo($("recorte-video"));
  if (!selecaoRecorte || !a) { sel.hidden = true; return; }
  const caixa = $("recorte-area").getBoundingClientRect();
  sel.hidden = false;
  sel.style.left = `${a.x - caixa.left + selecaoRecorte.x * a.w}px`;
  sel.style.top = `${a.y - caixa.top + selecaoRecorte.y * a.h}px`;
  sel.style.width = `${selecaoRecorte.w * a.w}px`;
  sel.style.height = `${selecaoRecorte.h * a.h}px`;
}

(function () {
  const area = $("recorte-area");
  let inicio = null;
  const ponto = (e) => {
    const a = areaDoVideo($("recorte-video"));
    if (!a) return null;
    return [Math.min(1, Math.max(0, (e.clientX - a.x) / a.w)), Math.min(1, Math.max(0, (e.clientY - a.y) / a.h))];
  };
  area.addEventListener("pointerdown", (e) => {
    inicio = ponto(e);
    if (inicio) area.setPointerCapture(e.pointerId);
  });
  area.addEventListener("pointermove", (e) => {
    if (!inicio) return;
    const p = ponto(e);
    if (!p) return;
    const x = Math.min(inicio[0], p[0]), y = Math.min(inicio[1], p[1]);
    const w = Math.abs(p[0] - inicio[0]), h = Math.abs(p[1] - inicio[1]);
    selecaoRecorte = w > 0.03 && h > 0.03 ? { x, y, w, h } : null;
    desenharSelecao();
  });
  const soltar = () => { inicio = null; };
  area.addEventListener("pointerup", soltar);
  area.addEventListener("pointercancel", soltar);
  $("recorte-video").addEventListener("loadedmetadata", desenharSelecao);
  window.addEventListener("resize", () => { if (!$("modal-recorte").hidden) desenharSelecao(); });
  $("recorte-ok").onclick = () => {
    if (selecaoRecorte) ligarRecorte(selecaoRecorte);
    fecharRecorte();
  };
  $("recorte-inteira").onclick = () => { desligarRecorte(); fecharRecorte(); };
  $("recorte-cancelar").onclick = fecharRecorte;
})();

// ---------- desenhar na tela de quem transmite ----------
// Quem assiste liga o lápis no vídeo e risca por cima. Os pontos vão (de 0 a 1,
// fração do vídeo) para a sala: todo mundo vê o risco por cima do vídeo, e o
// programa de quem transmite desenha por cima do monitor dele. Somem em 3 s.
const RISCO_FICA = 2000, RISCO_SOME = 1000;

// Onde a imagem do vídeo fica dentro do elemento (o vídeo pode ter faixas pretas).
function areaDoVideo(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const r = video.getBoundingClientRect();
  const esc = Math.min(r.width / vw, r.height / vh);
  const w = vw * esc, h = vh * esc;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
}

function prepararRiscos(bloco, video, par) {
  const tela = document.createElement("canvas");
  tela.className = "riscos";
  video.after(tela);
  bloco.riscos = { tela, video, mapa: new Map(), rodando: false };
  if (!par) return;   // na minha prévia só aparecem os riscos dos amigos
  let atual = null;
  const ponto = (e) => {
    const a = areaDoVideo(video);
    if (!a) return null;
    return [Math.min(1, Math.max(0, (e.clientX - a.x) / a.w)), Math.min(1, Math.max(0, (e.clientY - a.y) / a.h))];
  };
  const mandar = () => {
    if (!atual || !atual.fila.length) return;
    enviar({ t: "risco", para: par.id, id: atual.id, cor: atual.cor, pts: atual.fila.splice(0, 64) });
  };
  tela.addEventListener("pointerdown", (e) => {
    if (!bloco.classList.contains("riscando")) return;
    e.preventDefault();
    tela.setPointerCapture(e.pointerId);
    atual = { id: Math.random().toString(36).slice(2, 10), cor: bloco.classList.contains("apagando") ? "borracha" : corDoLapis(), fila: [] };
    atual.timer = setInterval(mandar, 40);
    const p = ponto(e);
    if (p) { atual.fila.push(p); desenharRisco(bloco, { id: "eu-" + atual.id, cor: atual.cor, pts: [p] }); }
  });
  tela.addEventListener("pointermove", (e) => {
    if (!atual) return;
    const p = ponto(e);
    if (!p) return;
    atual.fila.push(p);
    desenharRisco(bloco, { id: "eu-" + atual.id, cor: atual.cor, pts: [p] });
  });
  const soltar = () => {
    if (!atual) return;
    mandar();
    clearInterval(atual.timer);
    atual = null;
  };
  tela.addEventListener("pointerup", soltar);
  tela.addEventListener("pointercancel", soltar);
}

// Cor do lápis: escolhida nas bolinhas que aparecem ao lado do lápis ligado.
const CORES_LAPIS = ["#ff4d6d", "#ffffff", "#f0b232", "#23a55a", "#00a8fc", "#9b59b6", "#eb459e", "#111111"];
function corDoLapis() {
  const c = ler("astra.corLapis");
  return /^#[0-9a-f]{6}$/i.test(c) ? c : ((perfilDe(estado.meuId) || {}).c || corDe(estado.meuId));
}
function coresDoLapis() {
  const caixa = document.createElement("span");
  caixa.className = "cores-lapis";
  for (const cor of CORES_LAPIS) {
    const bt = document.createElement("button");
    bt.type = "button";
    bt.title = "Cor do lápis";
    bt.style.background = cor;
    bt.dataset.cor = cor;
    bt.onclick = (e) => {
      e.stopPropagation();
      guardar("astra.corLapis", cor);
      for (const b of document.querySelectorAll(".cores-lapis button")) b.classList.toggle("ativa", b.dataset.cor === cor);
    };
    bt.classList.toggle("ativa", cor === corDoLapis());
    caixa.append(bt);
  }
  return caixa;
}

function ligarLapis(bloco, sim, borracha = false) {
  const jaRiscava = bloco.classList.contains("riscando");
  bloco.classList.toggle("riscando", sim);
  bloco.classList.toggle("apagando", sim && borracha);
  if (sim && !jaRiscava) aviso(borracha
    ? { titulo: "Borracha ligada", texto: "Passe por cima dos riscos: some para todo mundo que assiste. Esc para parar.", tempo: 3500 }
    : { titulo: "Lápis ligado", texto: "Risque por cima da tela. Clique no lápis de novo (ou Esc) para parar.", tempo: 3500 });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") for (const b of document.querySelectorAll(".bloco.riscando")) b.classList.remove("riscando", "apagando");
});

function chegouRisco(m) {
  // 2.7.33: risco torto (sem pontos, ponto que não é número, cor estranha) é jogado fora aqui,
  // antes de quebrar a camada de desenho.
  if (!m || !Array.isArray(m.pts) || !m.pts.length || m.pts.length > 64) return;
  if (!(m.cor === "borracha" || /^#[0-9a-fA-F]{6}$/.test(String(m.cor)))) return;
  if (!m.pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return;
  m.pts = m.pts.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
  if (m.para === estado.conexao) {
    // Riscaram a minha tela: aparece na minha prévia e por cima do meu monitor.
    if (meuBloco && meuBloco.riscos) desenharRisco(meuBloco, m);
    if (programa && programa.risco) {
      const r = estado.recorte && estado.recorte.r;
      const pts = r ? m.pts.map(([x, y]) => [r.x + x * r.w, r.y + y * r.h]) : m.pts;
      programa.risco({ id: m.id, cor: m.cor, pts });
    }
    return;
  }
  const par = estado.pares.get(m.para);
  if (par) for (const b of par.blocos.values()) desenharRisco(b, m);
}

// ---------- tecla de emergência: apaga todos os rabiscos ----------
// Quem transmite: some da prévia, do monitor (main.js) e de quem assiste (VPS manda
// "limpar-riscos"). Quem assiste: some só da tela dele.
function limparRiscos(paraId) {
  const blocos = [];
  if (paraId === undefined) { if (meuBloco) blocos.push(meuBloco); for (const p of estado.pares.values()) if (p.blocos) blocos.push(...p.blocos.values()); }
  else if (paraId === estado.conexao) { if (meuBloco) blocos.push(meuBloco); }
  else { const par = estado.pares.get(paraId); if (par && par.blocos) blocos.push(...par.blocos.values()); }
  for (const b of blocos) {
    const k = b.riscos;
    if (!k) continue;
    k.mapa.clear();
    k.tela.getContext("2d").clearRect(0, 0, k.tela.width, k.tela.height);
  }
}
function emergenciaRiscos() {
  limparRiscos();
  if (souAoVivo()) enviar({ t: "limpar-riscos" });
  aviso({ titulo: "Rabiscos apagados", texto: souAoVivo() ? "Sumiram da sua tela e da de quem assiste." : "", tempo: 2500 });
}
if (programa && programa.aoEmergencia) programa.aoEmergencia(emergenciaRiscos);

function desenharRisco(bloco, m) {
  const k = bloco.riscos;
  if (!k) return;
  let r = k.mapa.get(m.id);
  if (!r) { r = { cor: m.cor, pts: [] }; k.mapa.set(m.id, r); }
  for (const p of m.pts) r.pts.push(p);
  r.t = performance.now();
  if (!k.rodando) { k.rodando = true; requestAnimationFrame((t) => quadroRiscos(k, t)); }
}

function quadroRiscos(k, agora) {
  const { tela, video } = k;
  if (!tela.isConnected) { k.rodando = false; return; }
  const dpr = window.devicePixelRatio || 1;
  const caixa = tela.getBoundingClientRect();
  const w = Math.round(caixa.width * dpr), h = Math.round(caixa.height * dpr);
  if (tela.width !== w || tela.height !== h) { tela.width = w; tela.height = h; }
  const ctx = tela.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const a = areaDoVideo(video);
  if (a) {
    const ox = (a.x - caixa.left) * dpr, oy = (a.y - caixa.top) * dpr, aw = a.w * dpr, ah = a.h * dpr;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, Math.min(6, aw / 300)) * dpr;
    const fino = ctx.lineWidth;
    // Primeiro os riscos, depois a borracha por cima: a borracha sempre ganha da caneta
    // (apaga até o que for riscado depois, enquanto ela estiver valendo).
    for (const vez of [false, true]) {
      ctx.globalCompositeOperation = vez ? "destination-out" : "source-over";
      ctx.lineWidth = vez ? fino * 8 : fino;
      for (const [id, r] of k.mapa) {
        if ((r.cor === "borracha") !== vez) continue;
        const idade = agora - r.t;
        if (idade > RISCO_FICA + RISCO_SOME) { k.mapa.delete(id); continue; }
        ctx.globalAlpha = vez || idade < RISCO_FICA ? 1 : 1 - (idade - RISCO_FICA) / RISCO_SOME;
        ctx.strokeStyle = vez ? "#000" : r.cor;
        ctx.beginPath();
        r.pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * aw, oy + y * ah) : ctx.moveTo(ox + x * aw, oy + y * ah)));
        if (r.pts.length === 1) ctx.lineTo(ox + r.pts[0][0] * aw + 0.1, oy + r.pts[0][1] * ah);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  } else k.mapa.clear();
  if (k.mapa.size) requestAnimationFrame((t) => quadroRiscos(k, t));
  else { ctx.clearRect(0, 0, w, h); k.rodando = false; }
}

// ---------- sem efeito de espelho ----------
function esconderPrevia(sim) {
  if (!meuBloco) return;
  meuBloco.classList.toggle("sem-previa", sim);
  let aviso = meuBloco.querySelector(".previa-escondida");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.className = "previa-escondida";
    const p = document.createElement("p");
    p.textContent = "Você está ao vivo. A sua prévia fica escondida para não aparecer dentro da própria live (efeito de espelho).";
    const bt = document.createElement("button");
    bt.className = "bt pequeno";
    bt.type = "button";
    bt.textContent = "Mostrar a prévia mesmo assim";
    bt.onclick = () => esconderPrevia(false);
    aviso.append(p, bt);
    meuBloco.append(aviso);
  }
  aviso.hidden = !sim;
  atualizarPrevia();
}

// A página do link (/v/...) aberta neste mesmo navegador esconde a imagem enquanto
// eu transmito a tela inteira ou uma janela (senão ela entra na live).
let canalAoVivo = null;
try { canalAoVivo = new BroadcastChannel("astra-ao-vivo"); } catch (_) {}
setInterval(() => {
  if (canalAoVivo && !programa && estado.tela && estado.superficie !== "browser") canalAoVivo.postMessage(1);
}, 1500);

// ---------- pausar a live ("volto já") ----------
// A transmissão não fecha: as faixas só deixam de mandar imagem e som (replaceTrack(null))
// e voltam na hora. Quem assiste vê a última imagem com o aviso por cima.
function pausarLive(sim) {
  if (!souAoVivo() || estado.pausado === sim) return;
  estado.pausado = sim;
  if (estado.telaNativa) programa.pausarCelular?.(sim);
  else if (estado.tela) {
    const video = estado.recorte ? estado.recorte.faixa : estado.tela.getVideoTracks()[0];
    const som = estado.tela.getAudioTracks()[0] || null;
    for (const par of canaisDeEnvio()) {
      for (const s of par.envios) {
        const faixa = (s._tipo || (s.track && s.track.kind)) === "video" ? video : som;
        s.replaceTrack(sim ? null : faixa).catch(() => {});
      }
    }
  }
  enviarEstado();
  desenharPausa();
}

function desenharPausa() {
  const bt = $("bt-pausa");
  bt.classList.toggle("pausado", !!estado.pausado);
  bt.querySelector("span").textContent = estado.pausado ? "Voltar à live" : "Pausar";
  bt.title = estado.pausado ? "Os amigos voltam a ver a sua tela" : "Congela a sua live com o aviso \"volto já\", sem encerrar";
  if (meuBloco) marcarPausa(meuBloco, !!estado.pausado, null);
}

function marcarPausa(bloco, sim, nome) {
  const aviso = bloco.querySelector(".pausa-live");
  if (!aviso) return;
  aviso.hidden = !sim;
  aviso.textContent = nome ? `${nome} pausou · volta já` : "Live pausada · os amigos veem \"volto já\"";
}
$("bt-pausa").addEventListener("click", () => pausarLive(!estado.pausado));

// ---------- teclas apertadas (opção de quem transmite, só no programa do PC) ----------
if (programa && programa.aoTeclas) {
  programa.aoTeclas((lista) => {
    return;   // 3.0.20: removido
    if (!souAoVivo()) return;
    enviar({ t: "teclas", lista });
    if (meuBloco) mostrarTeclas(meuBloco, lista);
  });
}

function chegouTeclas(m) {
  return;   // 3.0.20: removido; ignora quem ainda manda (versões antigas)
  const par = estado.pares.get(m.id);
  if (par) for (const b of par.blocos.values()) mostrarTeclas(b, m.lista || []);
}

function mostrarTeclas(bloco, lista) {
  const el = bloco.querySelector(".teclas-live");
  if (!el) return;
  clearTimeout(el._some);
  if (lista.length) {
    el.innerHTML = "";
    lista.forEach((t, i) => {
      if (i) el.append(" + ");
      const k = document.createElement("kbd");
      k.textContent = t;
      el.append(k);
    });
    el.hidden = false;
    el.classList.remove("sumindo");
  }
  // Soltou tudo: fica 1,5 s e some.
  el._some = setTimeout(() => { el.classList.add("sumindo"); el._some = setTimeout(() => { el.hidden = true; }, 300); }, lista.length ? 4000 : 1500);
}

// ---------- GIFs ----------
// Colar o link de um GIF do Tenor ou do Giphy (os mesmos do Discord) manda o GIF.
// O botão GIF abre a busca (se a VPS tiver a chave do Tenor). O GIF passa pela VPS
// e é apagado quando a sala fecha, como as imagens.
const LINK_GIF = /^https:\/\/(?:www\.)?(?:klipy\.com\/|static\d*\.klipy\.com\/|tenor\.com\/|giphy\.com\/(?:gifs|stickers)\/|(?:media\d*|c)\.tenor\.com\/|(?:media\d*|i)\.giphy\.com\/)\S+$/i;
let gifProxima = "";
let gifTimer = null;

function abrirGifs(sim) {
  const p = $("painel-gif");
  p.hidden = !sim;
  if (!sim) return;
  trocarAbaGif(gifFavs.size ? "fav" : "busca");
}
$("gif-aba-fav").addEventListener("click", () => trocarAbaGif("fav"));
$("gif-aba-busca").addEventListener("click", () => trocarAbaGif("busca"));
$("bt-gif").addEventListener("click", () => abrirGifs($("painel-gif").hidden));
$("in-gif").addEventListener("input", () => {
  clearTimeout(gifTimer);
  gifTimer = setTimeout(() => {
    $("lista-gif").innerHTML = "";
    $("gif-msg").textContent = "Procurando...";
    enviar({ t: "gif-busca", q: $("in-gif").value.trim() });
  }, 400);
});
$("gif-mais").addEventListener("click", () => {
  if (gifProxima) enviar({ t: "gif-busca", q: $("in-gif").value.trim(), pos: gifProxima });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("painel-gif").hidden) abrirGifs(false); });
document.addEventListener("click", (e) => {
  if (!$("painel-gif").hidden && !$("painel-gif").contains(e.target) && !$("bt-gif").contains(e.target)) abrirGifs(false);
});

function mostrarGifs(m) {
  if ($("painel-gif").hidden || gifAba !== "busca" || m.q !== $("in-gif").value.trim()) return;
  const lista = $("lista-gif");
  if (!m.mais) lista.innerHTML = "";
  if (m.semChave) {
    $("gif-msg").textContent = "A busca de GIFs ainda não foi ligada na VPS. Enquanto isso, cole no chat o link de um GIF ou use seus favoritos.";
  } else if (m.erro) {
    $("gif-msg").textContent = m.erro;
  } else {
    $("gif-msg").textContent = m.itens.length || m.mais ? "" : "Nenhum GIF encontrado.";
  }
  for (const g of m.itens || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = g.nome || "GIF";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = g.nome || "GIF";
    img.src = enderecoImagem(g.previa);
    b.append(img);
    b.onclick = () => { enviar({ t: "gif", url: g.url }); abrirGifs(false); };
    lista.append(b);
  }
  gifProxima = m.proxima || "";
  $("gif-mais").hidden = !gifProxima || !(m.itens || []).length;
}

// ---------- extras e minigames (opcionais) ----------
// A VPS diz quais minigames existem. Cada pessoa escolhe em "Extras" se quer instalar;
// quem não instala não baixa nada. O código de um minigame instalado vem da VPS
// (modulos/<nome>/modulo.js) e usa a window.astraExtras abaixo.
let extrasDisponiveis = [];
const extrasCarregados = new Map();   // nome -> {ganchos}
const comandosDeExtras = [];          // {prefixo, fn}

// 2.7.33: código do aparelho, usado só para banimentos. O programa de PC manda um resumo (hash) do
// ID do Windows e da placa-mãe; o celular, o do app; o navegador, um código aleatório guardado nele.
// O servidor embaralha de novo (HMAC) antes de guardar: o número real nunca sai daqui.
function aparelhosDoAstra() {
  const l = [];
  try { const pc = programa && typeof programa.aparelho === "string" ? programa.aparelho : ""; if (/^[0-9a-f]{64}$/.test(pc)) l.push("pc:" + pc); } catch (_) {}
  try { const n = String(window.astraAparelhoNativo || ""); if (/^(and|ios):[0-9a-f]{16,64}$/.test(n)) l.push(n); } catch (_) {}
  let w = ler("astra.ap");
  if (!/^[0-9a-f]{32}$/.test(w)) {
    try { const b = new Uint8Array(16); crypto.getRandomValues(b); w = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); guardar("astra.ap", w); } catch (_) { w = ""; }
  }
  if (w) l.push("web:" + w);
  return l;
}

function extrasInstalados() {
  try { const l = JSON.parse(ler("astra.extras") || "[]"); return Array.isArray(l) ? l.slice(0, 20) : []; } catch (_) { return []; }
}

function chegouModulos(m) {
  extrasDisponiveis = m.disponiveis || [];
  // 2.7.33: só carrega o que VOCÊ instalou neste aparelho (antes valia a lista que a VPS mandava)
  const meus = extrasInstalados();
  for (const nome of m.instalados || []) if (meus.includes(nome)) carregarExtra(nome);
  if (!$("modal-extras").hidden || $("lista-extras").offsetParent || ($("pg-jogos") && !$("pg-jogos").hidden)) desenharExtras();
  // o script do minigame chega depois: redesenha quando ele se registrar
  setTimeout(() => { if ($("pg-jogos") && !$("pg-jogos").hidden) desenharExtras(); }, 1500);
}

function carregarExtra(nome) {
  if (extrasCarregados.has(nome)) return;
  const info = extrasDisponiveis.find((x) => x.id === nome);
  if (!info) return;
  extrasCarregados.set(nome, { ganchos: {} });
  const endereco = enderecoImagem(`modulos/${encodeURIComponent(nome)}/modulo.js?v=${encodeURIComponent(info.versao || "")}`);
  if (programa && programa.modulosAssinados) { carregarExtraAssinado(nome, endereco); return; }
  const s = document.createElement("script");
  s.src = endereco;
  s.onerror = () => { extrasCarregados.delete(nome); console.warn("extra não carregou", nome); };
  document.body.append(s);
}

// 2.7.33 (programa de PC): a janela do programa tem acesso à captura de tela, então o código de
// um minigame só roda se a assinatura dele conferir com a chave da Astra (a mesma das
// atualizações; a chave que assina não fica na VPS). Sem assinatura válida, o minigame não abre.
async function carregarExtraAssinado(nome, endereco) {
  try {
    const sigUrl = enderecoImagem(`modulos/${encodeURIComponent(nome)}/modulo.js.sig?t=${Date.now()}`);
    const [r1, r2] = await Promise.all([fetch(endereco, { cache: "no-store" }), fetch(sigUrl, { cache: "no-store" })]);
    if (!r1.ok || !r2.ok) throw new Error("sem assinatura");
    const texto = await r1.text();
    if (!(await programa.conferirModulo(nome, texto, (await r2.text()).trim()))) throw new Error("assinatura não confere");
    const url = URL.createObjectURL(new Blob([texto], { type: "text/javascript" }));
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => URL.revokeObjectURL(url);
    s.onerror = () => { URL.revokeObjectURL(url); extrasCarregados.delete(nome); };
    document.body.append(s);
  } catch (e) {
    extrasCarregados.delete(nome);
    console.warn("extra bloqueado", nome, e && e.message);
    aviso({ titulo: "Minigame não abriu", texto: "A assinatura de segurança dele não conferiu. Tente de novo mais tarde.", tempo: 6000 });
  }
}

// Como cada minigame se abre: pelo comando que ele mesmo registrou (astraExtras.comando).
const ABRIR_EXTRA = {
  mywaifu: { comando: "/waifu", aberto: () => { const c = document.getElementById("mw-carteira"); return !!c && !c.hidden; } },
  astrapet: { comando: "/pet", aberto: () => { const c = document.getElementById("ap-caixa"); return !!c && !c.hidden; } },
  astrahotel: { comando: "/hotel", aberto: () => { const c = document.getElementById("ah-caixa"); return !!c && !c.hidden; } },
};
const ICONE_EXTRA = {
  mywaifu: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  astrapet: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  astrahotel: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
};
function abrirExtra(id) {
  const jeito = ABRIR_EXTRA[id];
  const x = extrasCarregados.get(id);
  if (!jeito || !x) return false;
  if (!jeito.aberto()) comandoDeExtra(jeito.comando);
  return jeito.aberto();
}

// A mesma lista aparece na janela Extras e na página Jogos (com o botão Abrir).
function desenharExtras() {
  $("extras-vazio").hidden = extrasDisponiveis.length > 0;
  desenharListaExtras($("lista-extras"), false);
  if ($("jogos-lista")) desenharListaExtras($("jogos-lista"), true);
}

function desenharListaExtras(ul, pagina) {
  ul.innerHTML = "";
  const meus = extrasInstalados();
  for (const x of extrasDisponiveis) {
    const li = document.createElement("li");
    const tem = meus.includes(x.id);
    if (pagina) {
      li.className = "jogo-cartao" + (tem ? " instalado" : "");
      const ic = document.createElement("span");
      ic.className = "jogo-ic";
      ic.innerHTML = iconeLinha(ICONE_EXTRA[x.id] || '<rect x="3" y="3" width="18" height="18" rx="4"/>', 22);
      li.append(ic);
    }
    const info = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = x.nome + (x.versao ? ` · ${x.versao}` : "");
    const p = document.createElement("small");
    // o tamanho aparece sozinho, a não ser que a descrição já diga quanto pesa
    p.textContent = [x.descricao, x.tamanho && !/\bKB\b|\bMB\b/.test(x.descricao || "") ? `${Math.max(1, Math.round(x.tamanho / 1024))} KB` : ""].filter(Boolean).join(" · ");
    info.append(b, p);
    if (pagina) {
      const st = document.createElement("span");
      st.className = "jogo-status";
      st.textContent = !tem ? "Não instalado" : extrasCarregados.has(x.id) ? "Instalado" : "Carregando…";
      info.append(st);
    }
    const acoes = document.createElement("div");
    acoes.className = "jogo-acoes";
    if (pagina && tem && ABRIR_EXTRA[x.id]) {
      const abrir = document.createElement("button");
      abrir.type = "button";
      abrir.className = "bt pequeno primario";
      abrir.textContent = "Abrir";
      abrir.onclick = () => {
        if (abrirExtra(x.id)) window.astraNav?.ir("inicio");
        else aviso({ titulo: `${x.nome} ainda está carregando`, texto: "Tente de novo em alguns segundos.", tempo: 4000 });
      };
      acoes.append(abrir);
    }
    const bt = document.createElement("button");
    bt.type = "button";
    bt.className = "bt pequeno " + (tem ? "secundario" : "primario");
    bt.textContent = tem ? "Remover" : "Instalar";
    bt.onclick = () => {
      const lista = extrasInstalados().filter((y) => y !== x.id);
      if (!tem) lista.push(x.id);
      guardar("astra.extras", JSON.stringify(lista));
      enviar({ t: "modulos", lista });
      if (tem && extrasCarregados.has(x.id)) aviso({ titulo: `${x.nome} removido`, texto: "Feche e abra o programa para ele sair de vez.", tempo: 6000 });
      desenharExtras();
    };
    acoes.append(bt);
    li.append(info, acoes);
    ul.append(li);
  }
}
// O botão "Extras" foi tirado da tela (pedido do usuário); a janela continua pronta para os minigames.
$("bt-extras")?.addEventListener("click", () => { desenharExtras(); $("modal-extras").hidden = false; enviar({ t: "modulos", lista: extrasInstalados() }); });
$("extras-fechar").addEventListener("click", () => { $("modal-extras").hidden = true; });
$("modal-extras").addEventListener("click", (e) => { if (e.target === $("modal-extras")) $("modal-extras").hidden = true; });

function mensagemDeExtra(m) {
  const x = extrasCarregados.get(m.mod);
  if (x && x.ganchos.aoMensagem) {
    try { x.ganchos.aoMensagem(m.dados, m.de ? { id: m.de, astraId: m.astraId, nome: m.nome } : null); }
    catch (e) { console.warn("extra", m.mod, e); }
  }
}

function comandoDeExtra(texto) {
  for (const c of comandosDeExtras) {
    if (texto.startsWith(c.prefixo)) {
      try { if (c.fn(texto) !== false) return true; } catch (e) { console.warn("extra", e); }
    }
  }
  return false;
}

window.astraExtras = {
  // Um minigame se apresenta: astraExtras.registrar("mudae", { aoMensagem(dados, de) {...} })
  registrar(nome, ganchos) { const x = extrasCarregados.get(nome); if (x) x.ganchos = ganchos || {}; },
  // Manda dados para a parte do servidor do minigame (ou para quem tem ele na sala).
  enviar(nome, dados) { enviar({ t: "mod", mod: nome, dados }); },
  // Linhas do chat que começam com o prefixo (ex.: "$") vão para o minigame em vez do chat.
  comando(prefixo, fn) { if (prefixo) comandosDeExtras.push({ prefixo: String(prefixo), fn }); },
  // Linha no chat só para você (sem mandar para ninguém).
  noChat(texto) { adicionarMensagem({ astraId: "extra", nome: "Extras", texto: String(texto), quando: Date.now() }); },
  aviso,
  eu: () => ({ nome: meuNome(), astraId: estado.meuId }),
  sala: () => (estado.sala ? { id: estado.sala, nome: estado.nomeSala } : null),
  endereco: (nome, arquivo) => enderecoImagem(`modulos/${encodeURIComponent(nome)}/${arquivo}`),
};

// ---------- app instalável (celular) ----------
if (!programa && location.protocol === "https:" && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

prepararIdentidade();
desenharOnline();
if (estado.nome) conectar();

// ---------- painel de desempenho (só no programa do PC) ----------
// Mostra quanto o Astra e o PC estão usando de CPU, RAM e placa de vídeo.
// Começa fechado e só mede aberto, com a janela à vista: medir a placa de vídeo
// também gasta processador.
(function () {
  if (!programa || !programa.desempenho) return;
  const painel = $("painel-desempenho");
  painel.hidden = false;
  const aberto = () => ler("astra.desempenho") === "1";
  const pct = (v) => (v === null || v === undefined ? "–" : `${v}%`);
  const gb = (mb) => (mb / 1024).toFixed(1).replace(".", ",");

  function desenharAberto() {
    painel.classList.toggle("aberto", aberto());
    $("conexao-sala").classList.toggle("des-aberto", aberto());
    $("desempenho-corpo").hidden = !aberto();
    $("bt-desempenho").setAttribute("aria-expanded", String(aberto()));
    if (!aberto()) $("desempenho-resumo").textContent = "clique para medir";
  }
  // 2.7.11: na sala, o Desempenho fica junto do "Conectado": clicar nele abre e fecha.
  $("conexao-sala").addEventListener("click", (e) => {
    if (e.target.closest("#bt-conexao")) return;
    $("bt-desempenho").click();
  });
  $("bt-desempenho").addEventListener("click", () => {
    guardar("astra.desempenho", aberto() ? "0" : "1");
    desenharAberto();
    ligar();
  });

  // Verde até 60%, amarelo até 85%, vermelho acima (igual para todos os números).
  const nivel = (v) => (v === null || v === undefined ? "" : v >= 85 ? "alto" : v >= 60 ? "medio" : "ok");
  // "Astra" (padrão) mostra só o programa; "PC inteiro" mostra o computador todo.
  let ver = ler("astra.des-ver") === "pc" ? "pc" : "astra";
  let ultimo = null;
  const historico = { astra: { cpu: [], gpu: [] }, pc: { cpu: [], gpu: [] } };

  function anel(n, v, texto, legenda, titulo) {
    const el = $("des-anel-" + n);
    el.querySelector(".valor").style.strokeDasharray = `${Math.max(0, Math.min(100, v || 0))} 100`;
    el.querySelector("b").textContent = texto;
    el.querySelector("small").textContent = legenda;
    el.dataset.nivel = nivel(v);
    el.title = titulo;
  }
  function guardarPonto(h, v) { h.push(Math.max(0, Math.min(100, v || 0))); if (h.length > 60) h.shift(); }
  // Gráfico do último minuto: o ponto mais novo fica na direita.
  function grafico(qual, h, v) {
    const svg = $("des-graf-" + qual);
    if (!h.length) return;
    const pontos = h.map((y, i) => `${((60 - h.length + i) / 59 * 100).toFixed(1)},${(19 - y * 0.18).toFixed(1)}`);
    svg.querySelector(".linha").setAttribute("d", "M" + pontos.join(" L"));
    svg.querySelector(".area").setAttribute("d", `M${pontos[0].split(",")[0]},20 L${pontos.join(" L")} L100,20 Z`);
    svg.dataset.nivel = nivel(v);
    $(`des-graf-${qual}-n`).textContent = pct(v);
  }
  function desenhar() {
    document.querySelectorAll(".des-op").forEach((b) => { b.classList.toggle("ativo", b.dataset.ver === ver); b.setAttribute("aria-selected", String(b.dataset.ver === ver)); });
    const d = ultimo;
    if (!d) return;
    const ramPc = d.pc.ramTotal ? Math.round((d.pc.ramUsada * 100) / d.pc.ramTotal) : null;
    if (ver === "astra") {
      // RAM do Astra: o anel mostra quanto ele ocupa da memória do PC
      const ramAstra = d.pc.ramTotal ? Math.max(1, Math.round((d.app.ram * 100) / d.pc.ramTotal)) : null;
      anel(1, d.app.cpu, pct(d.app.cpu), "CPU", `Processador usado pelo Astra: ${pct(d.app.cpu)}`);
      anel(2, ramAstra, d.app.ram >= 1024 ? `${gb(d.app.ram)}G` : `${d.app.ram}M`, "RAM", `Memória do Astra: ${d.app.ram} MB (${pct(ramAstra)} do PC)`);
      anel(3, d.app.gpu, pct(d.app.gpu), "GPU", `Placa de vídeo usada pelo Astra: ${pct(d.app.gpu)} · ${d.app.ramGpu} MB`);
    } else {
      anel(1, d.pc.cpu, pct(d.pc.cpu), "CPU", `Processador do PC: ${pct(d.pc.cpu)}`);
      anel(2, ramPc, pct(ramPc), d.pc.ramTotal ? `${gb(d.pc.ramUsada)} GB` : "RAM", `Memória: ${gb(d.pc.ramUsada)} de ${gb(d.pc.ramTotal)} GB`);
      anel(3, d.pc.gpu, pct(d.pc.gpu), "GPU", `Placa de vídeo do PC: ${pct(d.pc.gpu)}`);
    }
    const h = historico[ver], atual = ver === "astra" ? d.app : d.pc;
    grafico("cpu", h.cpu, atual.cpu);
    grafico("gpu", h.gpu, atual.gpu);
  }
  document.querySelectorAll(".des-op").forEach((b) => b.addEventListener("click", () => {
    ver = b.dataset.ver; guardar("astra.des-ver", ver); desenhar();
  }));

  programa.aoDesempenho((d) => {
    if (!aberto()) return;
    ultimo = d;
    $("desempenho-resumo").textContent = `Astra: CPU ${pct(d.app.cpu)} · ${d.app.ram} MB`;
    guardarPonto(historico.astra.cpu, d.app.cpu); guardarPonto(historico.astra.gpu, d.app.gpu);
    guardarPonto(historico.pc.cpu, d.pc.cpu); guardarPonto(historico.pc.gpu, d.pc.gpu);
    desenhar();
  });
  desenhar();

  function ligar() { programa.desempenho(aberto() && document.visibilityState === "visible"); }
  document.addEventListener("visibilitychange", ligar);
  desenharAberto();
  ligar();
})();

// Recados da música ("Colocando na fila...", "Achando as 38 músicas...") somem depois de alguns
// segundos, para a aba não ficar poluída.
(() => {
  const el = $("musica-msg");
  let t = 0;
  new MutationObserver(() => {
    clearTimeout(t);
    if (el.textContent && !/\.\.\.$/.test(el.textContent)) t = setTimeout(() => { el.textContent = ""; }, 6000);
    else if (el.textContent) t = setTimeout(() => { el.textContent = ""; }, 20000);
  }).observe(el, { childList: true, characterData: true, subtree: true });
})();

// Resposta da VPS ao "Fale com o dono" e novidades publicadas (o resto está perto do "livre").
TRATAR.relato = (m) => {
  $("relato-enviar").disabled = false;
  if (m.erro) { $("relato-msg").textContent = m.erro; return; }
  $("relato-texto").value = "";
  fecharRelato();
  aviso({ titulo: "Obrigado!", texto: "Sua mensagem foi para o dono do Astra.", tempo: 4000 });
};
TRATAR.novidades = (m) => mostrarNovidades(m.itens);

// ---------- Recado do Astra: o dono escreve na página dele e aparece para todos na hora ----------
let recadoSome = null;
function mostrarRecado(r, aoVivo) {
  const caixa = $("recado-astra");
  clearTimeout(recadoSome);
  if (!r || !r.texto) { caixa.hidden = true; return; }
  // some sozinho 9 h depois de publicado (a VPS manda quanto tempo ele dura)
  if (r.dura) {
    const falta = (r.quando + r.dura) * 1000 - Date.now();
    if (falta <= 0) { caixa.hidden = true; return; }
    recadoSome = setTimeout(() => { caixa.hidden = true; }, Math.min(falta, 2 ** 31 - 1));
  }
  $("recado-texto").textContent = r.texto;
  const d = new Date((r.quando || 0) * 1000);
  const hoje = new Date().toDateString() === d.toDateString();
  $("recado-hora").textContent = hoje ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  caixa.hidden = false;
  if (aoVivo) { caixa.classList.remove("novo"); void caixa.offsetWidth; caixa.classList.add("novo"); }
}
TRATAR.recado = (m) => mostrarRecado(m.recado, true);
TRATAR.insignias = (m) => { estado.meusExtras = Array.isArray(m.ix) ? m.ix : []; estado.minhaPrincipal = m.ip || ""; if (m.fv && typeof m.fv === "object") fixasVer = m.fv; mostrarMeuNome(); desenharOnline(); if (estado.sala) desenharSala(); };
TRATAR.apoiador = (m) => { estado.apoiador = !!m.sim; mostrarMeuNome(); if (estado.vitrineLista) mostrarVitrine(estado.vitrineLista); };

// ---------- Vitrine da tela inicial: o perfil de todo mundo passando, "obrigado por usarem" ----------
function mostrarVitrine(lista) {
  estado.vitrineLista = lista;
  const caixa = $("vitrine"), trilha = $("vitrine-trilha");
  // 3.0.21: a área "Obrigado por fazer parte da Astra" saiu da tela inicial (pedido do dono)
  if (!caixa || !trilha) return;
  trilha.textContent = "";
  if (!Array.isArray(lista) || !lista.length) { caixa.hidden = true; return; }
  // Destaque da comunidade: rostos lado a lado (sobrepostos), sem carrossel. O nome aparece ao
  // passar o mouse (ou no leitor de tela); no celular cabem menos rostos.
  const pessoas = [];
  for (const u of lista) {
    const id = String(u.id || "");
    if (!/^\d{9}$/.test(id) || !u.n || pessoas.some((p) => p.id === id)) continue;
    if (!estado.perfis.has(id) && u.p && typeof u.p === "object") guardarPerfilDe(id, u.p);
    if (u.f && !estado.fotos.has(id)) estado.fotos.set(id, u.f);
    pessoas.push({ id, nome: id === estado.meuId ? meuNome() : String(u.n).slice(0, 24) });
  }
  if (!pessoas.length) { caixa.hidden = true; return; }
  // v5: carrossel infinito de cartõezinhos (v5.js); o resto abaixo fica de reserva
  if (window.astraV5) { astraV5.comunidade(pessoas); caixa.hidden = false; return; }
  const MOSTRA = 9;
  for (const [i, p] of pessoas.slice(0, MOSTRA).entries()) {
    const av = avatar(p.nome, p.id, false);
    av.classList.add("comunidade-rosto");
    av.setAttribute("role", "listitem");
    av.setAttribute("aria-label", p.nome);
    av.title = p.nome;
    av.style.setProperty("--i", i);
    trilha.append(av);
  }
  if (pessoas.length > MOSTRA) {
    const mais = document.createElement("span");
    mais.className = "comunidade-mais";
    mais.setAttribute("role", "listitem");
    mais.textContent = `+${pessoas.length - MOSTRA}`;
    mais.title = `e mais ${pessoas.length - MOSTRA} pessoas`;
    trilha.append(mais);
  }
  caixa.hidden = false;
}

// ---------- doar AstraDoll para quem está ao vivo ----------
// Igual alerta de doação de live: a sala toda vê o cartão, ouve um "plim" e a voz lendo o recado.
// O dinheiro é a carteira de AstraDoll do servidor (a mesma dos minigames). Nada disso mexe na transmissão.
let doarPara = null, doarValor = 25, doarVoz = ler("astra.doarVoz") || "padrao";
// Estilos de voz: mesma voz do aparelho com tom e velocidade diferentes (tom 0 a 2, velocidade 0.5 a 2).
const VOZES = {
  padrao:  { nome: "Padrão",     tom: 0.85, vel: 1.0,  homem: true },
  esquilo: { nome: "Esquilo",    tom: 2,    vel: 1.7 },
  esponja: { nome: "Esponjinha", tom: 2,    vel: 1.2,  homem: true },   // voz de desenho: homem bem agudo e animado
};
if (!VOZES[doarVoz]) doarVoz = "padrao";
(function montarVozes() {
  const caixa = $("doar-vozes");
  for (const [id, v] of Object.entries(VOZES)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "doar-voz"; b.dataset.voz = id; b.textContent = v.nome;
    b.setAttribute("role", "radio");
    b.onclick = () => { doarVoz = id; guardar("astra.doarVoz", id); pintarVozes(); pararVoz(); falar(`${meuNome() || "Você"} doou ${doarValor} AstraDoll`, () => {}, id); };
    caixa.append(b);
  }
  pintarVozes();
})();
function pintarVozes() {
  document.querySelectorAll(".doar-voz").forEach((b) => { const sim = b.dataset.voz === doarVoz; b.classList.toggle("ativo", sim); b.setAttribute("aria-checked", sim); });
}
const filaDoacoes = [];
let mostrandoDoacao = false;

TRATAR.carteira = (m) => {
  const antes = estado.moedas;
  estado.moedas = m.moedas;
  const b = $("doar-saldo"); if (b) b.textContent = Number(m.moedas).toLocaleString("pt-BR");
  pintarCarteira(antes);
};

// ---------- carteira no rodapé: saldo de AstraDoll ----------
function saldoCurto(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
  if (n >= 1e5) return Math.floor(n / 1e3).toLocaleString("pt-BR") + " mil";
  return n.toLocaleString("pt-BR");
}
function pintarCarteira(antes) {
  const bt = $("bt-carteira");
  if (!bt || estado.moedas == null) return;
  bt.hidden = false;
  $("carteira-saldo").textContent = saldoCurto(estado.moedas);
  $("carteira-grande").textContent = `${Number(estado.moedas).toLocaleString("pt-BR")} AstraDoll`;
  if (antes != null && estado.moedas !== antes) {
    bt.classList.remove("mudou"); void bt.offsetWidth; bt.classList.add(estado.moedas > antes ? "mudou" : "mudou-menos");
  }
}
$("bt-carteira").addEventListener("mouseenter", () => enviar({ t: "carteira" }));   // saldo fresquinho ao passar o mouse

// Ganhou AstraDoll por tempo assistindo/transmitindo: aviso discreto e o saldo pisca.
TRATAR.ganhou = (m) => {
  const oque = m.tipo === "transmitir" ? "por transmitir" : m.tipo === "conversar" ? "por conversar na sala" : "por assistir";
  aviso({ titulo: `+${m.valor} AstraDoll ${oque}`, texto: m.hoje >= m.limite ? "Você chegou no limite de hoje. Amanhã tem mais!" : `Hoje: ${m.hoje} de ${m.limite}`,
          imagem: "astradoll.svg", tempo: 3500 });
};

// Bônus diário com sequência de dias seguidos (2.7.40: marcos de 7, 14, 30 e 60 dias).
TRATAR.bonus = (m) => {
  const fmt = (v) => Number(v).toLocaleString("pt-BR");
  let texto = m.seq > 1 ? `${m.seq} dias seguidos! Amanhã: +${fmt(m.amanha)}` : `Volte amanhã para ganhar +${fmt(m.amanha)}`;
  if (m.marco) texto = `${m.seq} dias seguidos! Inclui +${fmt(m.marco)} de prêmio da sequência.`;
  else if (m.proxMarco) texto += ` · Faltam ${m.proxMarco - m.seq} dia(s) para +${fmt(m.proxMarcoValor)}`;
  aviso({ titulo: `Bônus diário: +${fmt(m.valor)} AstraDoll`, texto, imagem: "astradoll.svg", tempo: m.marco ? 9000 : 6000 });
  tocarPlim();
  if (window.chuvaDeMoedas) chuvaDeMoedas(m.marco ? 22 : 10);
};

// 3.0.20: a dica da carteira fica solta na tela (position: fixed) logo abaixo do botão, sem sair pelas bordas.
// Antes ela ficava presa na coluna do meio (overflow: hidden) e, estreita, o prêmio e as barras vazavam.
(() => {
  const bt = $("bt-carteira"), dica = bt && bt.querySelector(".carteira-dica");
  if (!dica) return;
  const posicionar = () => {
    const r = bt.getBoundingClientRect();
    dica.classList.add("solta");
    dica.style.left = "auto";
    dica.style.top = Math.round(r.bottom + 8) + "px";
    let direita = Math.max(8, Math.round(innerWidth - r.right));
    dica.style.right = direita + "px";
    const larg = dica.offsetWidth;
    if (innerWidth - direita - larg < 8) dica.style.right = Math.max(8, Math.round(innerWidth - 8 - larg)) + "px";
  };
  for (const ev of ["mouseenter", "focusin", "touchstart"]) bt.addEventListener(ev, posicionar, { passive: true });
  addEventListener("resize", posicionar, { passive: true });
})();

// 2.7.40: missões do dia (aparecem na dica da carteira)
TRATAR.missoes = (m) => {
  const caixa = $("carteira-missoes");
  if (!caixa || !Array.isArray(m.lista)) return;
  caixa.replaceChildren();
  const tit = document.createElement("span");
  tit.className = "cm-titulo";
  tit.textContent = "Missões de hoje";
  caixa.append(tit);
  for (const x of m.lista) {
    const linha = document.createElement("span");
    linha.className = "cm-linha" + (x.pago ? " feita" : "");
    const nome = document.createElement("span");
    nome.textContent = (x.pago ? "✓ " : "") + x.nome;
    const premio = document.createElement("small");
    premio.textContent = x.pago ? "feita" : `${x.feito}/${x.meta} · +${x.premio}`;
    const barra = document.createElement("span");
    barra.className = "cm-barra";
    const i = document.createElement("i");
    i.style.width = Math.round(100 * Math.min(1, x.feito / x.meta)) + "%";
    barra.append(i);
    linha.append(nome, premio, barra);
    caixa.append(linha);
  }
  const todas = document.createElement("span");
  todas.className = "cm-todas";
  todas.textContent = m.todasPago ? "✓ Você fez todas hoje! Amanhã tem mais." : `Faça as três: +${m.todas} de extra`;
  caixa.append(todas);
  caixa.hidden = false;
};
TRATAR.missao = (m) => {
  aviso({ titulo: `Missão cumprida: +${m.premio} AstraDoll`, texto: m.extra ? `${m.nome} · Fez as três: +${m.extra} de extra!` : m.nome,
          imagem: "astradoll.svg", tempo: 6000 });
  tocarPlim();
  if (window.chuvaDeMoedas) chuvaDeMoedas(m.extra ? 16 : 8);
};

// Presente para todo mundo (ex.: 5 mil AstraDoll do larpinho): só um aviso no canto, com a chuvinha de moedas.
TRATAR.presente = (m) => {
  aviso({ titulo: `Presente do ${m.de}: +${Number(m.valor).toLocaleString("pt-BR")} AstraDoll`, texto: m.texto || "",
          imagem: "astradoll.svg", tempo: 8000 });
  tocarPlim();
  if (window.chuvaDeMoedas) chuvaDeMoedas(18);
};
TRATAR.doacao = (m) => { linhaDoacao(m); filaDoacoes.push(m); proximaDoacao(); };
TRATAR["doacao-erro"] = (m) => { $("doar-msg").textContent = m.msg; $("doar-enviar").disabled = false; };

function abrirDoar(par) {
  doarPara = par;
  $("doar-nome").textContent = par.nome;
  $("doar-saldo").textContent = estado.moedas != null ? Number(estado.moedas).toLocaleString("pt-BR") : "...";
  $("doar-msg").textContent = "";
  $("doar-outro").value = "";
  $("doar-enviar").disabled = false;
  escolherValor(doarValor);
  $("modal-doar").hidden = false;
  enviar({ t: "carteira" });
  setTimeout(() => $("doar-texto").focus(), 50);
}
function fecharDoar() { $("modal-doar").hidden = true; doarPara = null; }
function escolherValor(v) {
  doarValor = v;
  document.querySelectorAll(".doar-valor").forEach((b) => b.classList.toggle("ativo", +b.dataset.v === v && !$("doar-outro").value));
  $("doar-enviar").textContent = `Doar ${v.toLocaleString("pt-BR")}`;
}
document.querySelectorAll(".doar-valor").forEach((b) => b.addEventListener("click", () => { $("doar-outro").value = ""; escolherValor(+b.dataset.v); }));
$("doar-outro").addEventListener("input", () => { const v = Math.floor(+$("doar-outro").value); if (v > 0) escolherValor(v); });
$("doar-cancelar").addEventListener("click", fecharDoar);
$("modal-doar").addEventListener("click", (ev) => { if (ev.target === $("modal-doar")) fecharDoar(); });
$("form-doar").addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (!doarPara) return;
  const p = estado.pares.get(doarPara.id);
  if (!p || !p.transmitindo) { $("doar-msg").textContent = "Essa pessoa não está mais ao vivo."; return; }
  if (estado.moedas != null && doarValor > estado.moedas) { $("doar-msg").textContent = "Você não tem AstraDoll suficiente."; return; }
  $("doar-enviar").disabled = true;
  enviar({ t: "doar", para: doarPara.id, valor: doarValor, texto: $("doar-texto").value, voz: doarVoz });
});
// a doação chegou (a minha também): fecha a janela de quem doou
const _doacaoOriginal = TRATAR.doacao;
TRATAR.doacao = (m) => {
  if (m.astraId === estado.meuId && !$("modal-doar").hidden) { $("doar-texto").value = ""; fecharDoar(); }
  _doacaoOriginal(m);
};

function linhaDoacao(m) {
  const ul = $("chat-lista");
  const noFim = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 60;
  const d = m.doacao, li = document.createElement("li");
  li.className = "chat-doacao";
  li.dataset.autor = ""; li.dataset.quando = m.quando;
  const img = document.createElement("img"); img.src = "astradoll.svg"; img.alt = ""; img.width = 22; img.height = 22;
  const corpo = document.createElement("div");
  const topo = document.createElement("p");
  const quem = document.createElement("b"); quem.textContent = m.nome; quem.style.color = corDe(m.astraId);
  const valor = document.createElement("b"); valor.className = "valor"; valor.textContent = `${d.valor.toLocaleString("pt-BR")} AstraDoll`;
  topo.append(quem, " doou ", valor, ` para ${d.para}`);
  corpo.append(topo);
  if (d.texto) { const r = document.createElement("p"); r.className = "recado"; r.textContent = d.texto; corpo.append(r); }
  li.append(img, corpo);
  ul.append(li);
  while (ul.children.length > 200) ul.firstElementChild.remove();
  if (noFim || m.astraId === estado.meuId) rolarChat();
}

function vozLigada() { return ler("astra.vozDoacao") !== "0"; }
function proximaDoacao() {
  if (mostrandoDoacao || !filaDoacoes.length) return;
  mostrandoDoacao = true;
  const m = filaDoacoes.shift(), d = m.doacao;
  const card = document.createElement("div");
  card.className = "alerta-doacao";
  const img = document.createElement("img"); img.src = "astradoll.svg"; img.alt = "";
  const t = document.createElement("div"); t.className = "titulo";
  const quem = document.createElement("b"); quem.textContent = m.nome;
  t.append(quem, " doou ");
  const v = document.createElement("div"); v.className = "valor"; v.textContent = `${d.valor.toLocaleString("pt-BR")} AstraDoll`;
  const para = document.createElement("div"); para.className = "para"; para.textContent = `para ${d.para}`;
  card.append(img, t, v, para);
  if (d.texto) { const r = document.createElement("p"); r.className = "recado"; r.textContent = d.texto; card.append(r); }
  const mudo = document.createElement("button");
  mudo.type = "button"; mudo.className = "mudo";
  const pintarMudo = () => { mudo.textContent = vozLigada() ? "Silenciar voz" : "Ligar voz"; };
  pintarMudo();
  mudo.onclick = (ev) => { ev.stopPropagation(); guardar("astra.vozDoacao", vozLigada() ? "0" : "1"); pintarMudo(); if (!vozLigada()) pararVoz(); };
  card.append(mudo);
  $("alertas-doacao").append(card);
  tocarPlim();
  // quem recebeu e está jogando (janela do Astra escondida): pop-up do PC / aviso do Android
  if (d.paraId === estado.meuId && document.hidden) {
    const titulo = `${m.nome} doou ${d.valor} AstraDoll`;
    if (programa && programa.popupChat) {
      const foto = fotoDe(m.astraId);
      programa.popupChat({ nome: m.nome, texto: `doou ${d.valor} AstraDoll${d.texto ? ": " + d.texto : ""}`, cor: corDe(m.astraId),
        foto: /^https:/.test(foto) ? foto : "", tipo: "doacao" });
    }
    else if (celular) programa.aviso(titulo, d.texto || "");
  }
  let acabou = false;
  const fim = () => {
    if (acabou) return; acabou = true;
    card.classList.add("saindo");
    setTimeout(() => { card.remove(); mostrandoDoacao = false; proximaDoacao(); }, 400);
  };
  const minimo = Date.now() + 6000;
  const fala = `${m.nome} doou ${d.valor} AstraDoll${d.texto ? ". " + textoParaVoz(d.texto) : ""}`;
  // espera o "plim" e então fala; o cartão fica pelo menos 6 s (ou até a voz acabar, no máximo 25 s)
  setTimeout(() => {
    if (!vozLigada()) return setTimeout(fim, Math.max(0, minimo - Date.now()));
    const depois = () => setTimeout(fim, Math.max(800, minimo - Date.now()));
    // voz gerada no servidor (a mesma para todos); se não vier ou não tocar, a voz do aparelho
    if (d.audio) tocarAudioVoz(d.audio, depois, () => falar(fala, depois, d.voz));
    else falar(fala, depois, d.voz);
  }, 900);
  setTimeout(fim, 25000);
}
function textoParaVoz(t) {
  return t.replace(/https?:\/\/\S+/gi, "link").replace(/(.)\1{3,}/g, "$1$1$1").slice(0, 140);
}
let vozEscolhida = null;
let vozHomem = null;
const NOMES_HOMEM = /daniel|antonio|antônio|ricardo|fabio|fábio|humberto|male|masculin/i;
function vozesBR() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^pt(-|_)BR/i.test(v.lang) || /portugu[eê]s.*brasil/i.test(v.name));
}
function escolherVoz() {
  const vozes = vozesBR();
  vozHomem = vozes.find((v) => NOMES_HOMEM.test(v.name)) || null;
  return vozes.find((v) => /google/i.test(v.name)) || vozes.find((v) => /francisca|thalita/i.test(v.name)) ||
         vozes.find((v) => /maria/i.test(v.name)) || vozes[0] || null;
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => { vozEscolhida = escolherVoz(); };
function falar(texto, aoAcabar, estilo) {
  if (estado.surdo) return aoAcabar();
  const e = VOZES[estilo] || VOZES.padrao;
  // celular: a voz do próprio Android (Ponte.falar). PC e navegador: a voz do sistema.
  if (programa && programa.falar) {
    try { programa.falar(texto, e.tom, e.vel); } catch (_) {}
    return setTimeout(aoAcabar, Math.min(20000, 1500 + texto.length * 75 / e.vel));
  }
  if (!("speechSynthesis" in window)) return aoAcabar();
  const u = new SpeechSynthesisUtterance(texto);
  vozEscolhida = vozEscolhida || escolherVoz();
  // "voz de homem": usa uma voz masculina se o aparelho tiver; se não, a mesma voz mais grave
  const voz = e.homem && vozHomem ? vozHomem : vozEscolhida;
  if (voz) u.voice = voz;
  u.lang = "pt-BR"; u.rate = e.vel; u.pitch = e.homem && vozHomem ? Math.min(2, e.tom + 0.15) : e.tom; u.volume = e.volume || 1;
  u.onend = u.onerror = () => aoAcabar();
  speechSynthesis.speak(u);
}
let audioVoz = null;
function tocarAudioVoz(caminho, aoAcabar, seFalhar) {
  if (estado.surdo) return aoAcabar();
  const base = programa && programa.site ? programa.site.replace(/\/?$/, "/") : "./";
  let foi = false;
  const falhou = () => { if (!foi) { foi = true; seFalhar(); } };
  try {
    audioVoz = new Audio(base + caminho);
    audioVoz.onended = () => { foi = true; aoAcabar(); };
    audioVoz.onerror = falhou;
    audioVoz.play().catch(falhou);
  } catch (_) { falhou(); }
}
function pararVoz() {
  if (audioVoz) { try { audioVoz.pause(); } catch (_) {} }
  if (programa && programa.calar) { try { programa.calar(); } catch (_) {} }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
let audioPlim = null;
function tocarPlim() {
  try {
    if (!somLiberado()) return;
    audioPlim = audioPlim || new (window.AudioContext || window.webkitAudioContext)();
    const a = audioPlim, t0 = a.currentTime;
    // "plim-plim" de caixinha: duas notas com brilho
    [[1318.5, 0], [1760, 0.13], [2637, 0.26]].forEach(([f, d]) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.6);
      o.connect(g).connect(a.destination); o.start(t0 + d); o.stop(t0 + d + 0.65);
    });
  } catch (_) {}
}

// Status: clicar no "Online" (embaixo do nome) ou na bolinha do avatar abre o menu.
$("txt-meu-status").addEventListener("click", abrirMenuStatus);
$("meu-avatar").addEventListener("click", (ev) => { if (ev.target.classList.contains("bolinha")) { ev.stopImmediatePropagation(); abrirMenuStatus(ev); } }, true);


// ---------- 2.7.20: desativar o áudio (fone do Discord) ----------
// Cala o app todo só neste aparelho: telas, câmeras, música, alertas e vozes das doações.
// Não muda nada para os outros nem na transmissão. Ao ligar de novo, cada tela volta como estava.
estado.surdo = ler("astra.surdo") === "1";
const mudoAntesDoSurdo = new WeakMap();
function aplicarSurdo() {
  const surdo = estado.surdo;
  for (const m of document.querySelectorAll("video, audio")) {
    if (surdo) { if (!mudoAntesDoSurdo.has(m)) mudoAntesDoSurdo.set(m, m.muted); m.muted = true; }
    else if (mudoAntesDoSurdo.has(m)) { m.muted = mudoAntesDoSurdo.get(m); mudoAntesDoSurdo.delete(m); }
  }
  if (audioVoz && surdo) { try { audioVoz.pause(); } catch (_) {} }
  if (surdo) pararVoz();
  mandarVolume();
  const bt = $("trilho-surdo");
  if (bt) {
    const txt = surdo ? "Ativar áudio" : "Desativar áudio";
    bt.setAttribute("aria-pressed", String(surdo));
    bt.setAttribute("aria-label", txt); bt.dataset.rotulo = txt; bt.title = txt + " (Ctrl+Shift+D)";
  }
  document.documentElement.classList.toggle("surdo", surdo);
}
function alternarSurdo() {
  estado.surdo = !estado.surdo;
  guardar("astra.surdo", estado.surdo ? "1" : "0");
  aplicarSurdo();
}
// Tela nova que aparece ou algo que tenta ligar o som enquanto está desativado: continua mudo.
for (const ev of ["play", "volumechange", "loadedmetadata"]) {
  document.addEventListener(ev, (e) => {
    const m = e.target;
    if (!estado.surdo || !(m instanceof HTMLMediaElement) || m.muted) return;
    if (!mudoAntesDoSurdo.has(m) || ev === "volumechange") mudoAntesDoSurdo.set(m, false);
    m.muted = true;
  }, true);
}
if ($("trilho-surdo")) $("trilho-surdo").addEventListener("click", alternarSurdo);
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); alternarSurdo(); }
});
aplicarSurdo();
