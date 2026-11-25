// Player do YouTube da "Música da sala" (roda dentro de player.html, num quadro).
// A página de fora manda: {musica: "carregar", video, segundo, pausado}, {musica: "pausar"},
// {musica: "tocar", segundo}, {musica: "ir", segundo}, {musica: "volume", valor 0-100, mudo},
// {musica: "parar"}. Este quadro responde: {musica: "pronto"}, {musica: "tempo", segundo,
// tocando}, {musica: "fim", video}, {musica: "bloqueado"} (o navegador não deixou tocar som)
// e {musica: "erro", video, codigo}.
// Se o vídeo não abre aqui, pergunta à VPS antes de avisar a página de fora (que pularia a
// música para a sala inteira): se ele toca fora do YouTube, o problema é só neste aparelho;
// se não toca, a VPS manda outra versão da mesma música e ela toca aqui no lugar.
// Músicas do SoundCloud ({musica: "carregar", sc: endereço}) tocam no player oficial do
// SoundCloud (música inteira, sem login), com os mesmos comandos.
"use strict";
(function () {
  let player = null;
  let pronto = false;
  let pai = null;          // quem mandou o primeiro comando (a página de fora)
  let atual = "";          // o vídeo da sala (é o que vai nas mensagens para fora)
  let tocando = "";        // o vídeo que está no player (outra versão, se o da sala não abriu)
  let ultimoSegundo = 0;   // último segundo que a página de fora pediu
  let semJeito = false;    // não abre neste aparelho: para de tentar até a próxima música
  let saltos = [];         // quando foram os últimos "ir" (para não ficar pulando sem parar)
  let pendente = null;     // comando que chegou antes do player ficar pronto
  let volume = { valor: 80, mudo: false };
  let fonte = "yt";        // "yt" ou "sc" (SoundCloud)
  let sc = null;           // o player do SoundCloud (SC.Widget), quando a música é de lá
  const scEstado = { pronto: false, pos: 0, dur: 0, pausado: true, pendente: null };

  function contar(msg) {
    if (pai) pai.postMessage(Object.assign({ musica: "" }, msg), "*");
  }

  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.append(tag);

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("player", {
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, fs: 0,
                    origin: location.origin },
      events: {
        onReady() {
          pronto = true;
          aplicarVolume();
          contar({ musica: "pronto" });
          if (pendente) { const p = pendente; pendente = null; executar(p); }
        },
        onStateChange(e) {
          if (e.data === YT.PlayerState.ENDED) contar({ musica: "fim", video: atual });
          // garante o volume escolhido em cada música (o YouTube volta o volume/mudo que ele guardou)
          if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING || e.data === YT.PlayerState.CUED) aplicarVolume();
        },
        onError(e) { naoAbriu(e.data); },
        onAutoplayBlocked() { contar({ musica: "bloqueado" }); },
      },
    });
  };

  function aviso(texto) {
    // O quadro fica escondido atrás da capa: o aviso também vai para a página, que mostra embaixo.
    contar({ musica: "aviso", texto: texto || "" });
    let el = document.getElementById("aviso");
    if (!texto) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "aviso";
      document.body.append(el);
    }
    el.textContent = texto;
    // Some depois de alguns segundos para não cobrir os botões do YouTube (ex.: "Fazer login").
    clearTimeout(el.sumir);
    el.sumir = setTimeout(() => el.remove(), 6000);
  }

  async function naoAbriu(codigo) {
    const video = atual, falhou = tocando;
    if (!video || semJeito) return;
    // 100 = o vídeo não existe mais (ou é privado): não adianta procurar, pula.
    if (codigo === 100 && falhou === video) return contar({ musica: "erro", video, codigo });
    let r = null;
    try {
      const resp = await fetch("musica/outra?video=" + encodeURIComponent(video), { cache: "no-store" });
      if (resp.ok) r = await resp.json();
    } catch { r = null; }
    if (video !== atual) return;   // a música mudou enquanto perguntava
    if (!r) {
      // VPS sem resposta: só pula se for o caso conhecido de vídeo que não toca fora do YouTube.
      if ([101, 150].includes(codigo)) contar({ musica: "erro", video, codigo });
      else { semJeito = true; aviso("Esta música não abriu neste aparelho. Os outros continuam ouvindo."); }
      return;
    }
    if (r.local && /^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+(\/s-\w+)?$/.test(String(r.sc || ""))) {
      // O YouTube não tocou só aqui: a mesma música pelo SoundCloud, só para este aparelho.
      // Começa parada; a página de fora manda "tocar" no segundo certo da sala.
      const seg = Math.max(0, (pronto && player.getCurrentTime()) || ultimoSegundo);
      try { player.stopVideo(); } catch {}
      aviso("O YouTube não tocou aqui. Tocando a mesma música pelo SoundCloud.");
      abrirSC(r.sc, seg, true, video);
      return;
    }
    if (r.local) {
      semJeito = true;
      aviso("Não tocou aqui (erro " + codigo + "). Os outros continuam ouvindo.");
      return;
    }
    if (r.video && r.video !== falhou && /^[A-Za-z0-9_-]{11}$/.test(r.video)) {
      tocando = r.video;
      player.loadVideoById({ videoId: tocando, startSeconds: Math.max(0, player.getCurrentTime() || ultimoSegundo) });
      return;
    }
    contar({ musica: "erro", video, codigo });
  }

  function aplicarVolume() {
    if (!pronto) return;
    player.setVolume(volumeReal());
    if (volume.mudo || volumeReal() === 0) player.mute(); else player.unMute();   // barra no zero = mudo de verdade
  }

  // 09/11: o YouTube guarda o volume/mudo dele e às vezes volta a eles sozinho depois de carregar
  // a música (por cima do que a Astra pediu): a barra mexia e o som não mudava. A cada segundo
  // confere o volume de verdade e corrige se estiver diferente do escolhido.
  function conferirVolume() {
    if (fonte === "sc") { volumeSC(); return; }
    if (!pronto || !atual) return;
    try {
      const querMudo = volume.mudo || volumeReal() === 0;
      if (player.isMuted() !== querMudo || (!querMudo && Math.abs(player.getVolume() - volumeReal()) > 1)) aplicarVolume();
    } catch {}
  }
  setInterval(conferirVolume, 1000);

  // ---------- SoundCloud ----------
  let scApi = null;
  function carregarApiSC() {
    if (!scApi) scApi = new Promise((ok, falhou) => {
      const t = document.createElement("script");
      t.src = "https://w.soundcloud.com/player/api.js";
      t.onload = ok; t.onerror = falhou;
      document.head.append(t);
    });
    return scApi;
  }

  function fecharSC() {
    const q = document.getElementById("sc");
    if (q) q.remove();
    sc = null;
    scEstado.pronto = false;
  }

  // chave: o que a sala está tocando (normalmente o próprio link; na reserva do YouTube, o vídeo)
  async function abrirSC(url, seg, pausado, chave = url) {
    fonte = "sc";
    if (pronto) { try { player.stopVideo(); } catch {} }
    document.getElementById("player").style.visibility = "hidden";
    fecharSC();
    scEstado.pos = seg * 1000; scEstado.dur = 0; scEstado.pausado = true;
    scEstado.pendente = pausado ? null : "tocar";
    try { await carregarApiSC(); } catch { aviso("O SoundCloud não abriu aqui. Os outros continuam ouvindo."); return; }
    if (atual !== chave) return;   // trocou de música enquanto carregava
    const q = document.createElement("iframe");
    q.id = "sc";
    q.allow = "autoplay";
    q.src = "https://w.soundcloud.com/player/?url=" + encodeURIComponent(url) +
      "&auto_play=false&visual=true&hide_related=true&show_comments=false&show_reposts=false&show_teaser=false&buying=false&sharing=false&download=false";
    document.body.append(q);
    sc = SC.Widget(q);
    const E = SC.Widget.Events;
    sc.bind(E.READY, () => {
      scEstado.pronto = true;
      volumeSC();
      sc.getDuration((d) => { scEstado.dur = d || 0; });
      sc.seekTo(scEstado.pos);
      if (scEstado.pendente === "tocar") sc.play();
      scEstado.pendente = null;
    });
    sc.bind(E.PLAY_PROGRESS, (e) => { scEstado.pos = e.currentPosition; });
    sc.bind(E.PLAY, () => { scEstado.pausado = false; volumeSC(); });   // o SoundCloud às vezes volta o volume ao tocar
    sc.bind(E.PAUSE, () => { scEstado.pausado = true; });
    sc.bind(E.FINISH, () => contar({ musica: "fim", video: atual }));
    sc.bind(E.ERROR, () => { semJeito = true; aviso("Esta música do SoundCloud não abriu aqui. Os outros continuam ouvindo."); });
  }

  // 2.7.11: o ouvido não sente o volume em linha reta (30% ainda parecia alto). A barra usa
  // uma curva: 100 = 100, 50 = 25, 30 = 9, 10 = 1. Assim, baixar a barra baixa de verdade.
  function volumeReal() {
    const v = Math.min(100, Math.max(0, volume.valor)) / 100;
    return v > 0 ? Math.max(1, Math.round(v * v * 100)) : 0;
  }

  function volumeSC() {
    if (sc && scEstado.pronto) sc.setVolume(volume.mudo ? 0 : volumeReal());
  }

  function executarSC(m, seg) {
    if (!sc || !scEstado.pronto) {   // ainda abrindo: guarda o que fazer
      if (m.segundo != null) scEstado.pos = seg * 1000;
      if (m.musica === "tocar") scEstado.pendente = "tocar";
      if (m.musica === "pausar") scEstado.pendente = null;
      return;
    }
    switch (m.musica) {
      case "pausar": sc.pause(); if (m.segundo != null) sc.seekTo(seg * 1000); break;
      case "tocar": if (m.segundo != null) sc.seekTo(seg * 1000); sc.play(); break;
      case "ir": {
        const agora = Date.now();
        saltos = saltos.filter((t) => agora - t < 30000);
        if (saltos.length >= 3) break;
        saltos.push(agora);
        sc.seekTo(seg * 1000);
        break;
      }
    }
  }

  function executar(m) {
    const segSC = Math.max(0, Number(m.segundo) || 0);
    if (m.musica === "carregar" && /^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+(\/s-\w+)?$/.test(String(m.sc || ""))) {
      atual = tocando = m.sc;
      saltos = []; semJeito = false; aviso("");
      ultimoSegundo = segSC;
      abrirSC(m.sc, segSC, !!m.pausado);
      return;
    }
    if (fonte === "sc" && m.musica !== "carregar") {
      if (m.segundo != null) ultimoSegundo = segSC;
      if (m.musica === "parar") { atual = tocando = ""; aviso(""); fecharSC(); fonte = "yt"; return; }
      if (!semJeito) executarSC(m, segSC);
      return;
    }
    if (m.musica === "carregar" && fonte === "sc") {   // voltou para uma música do YouTube
      fecharSC();
      fonte = "yt";
      document.getElementById("player").style.visibility = "";
    }
    if (!pronto) { if (m.musica !== "volume") pendente = m; return; }
    const seg = Math.max(0, Number(m.segundo) || 0);
    if (m.segundo != null) ultimoSegundo = seg;
    if (semJeito && m.musica !== "carregar" && m.musica !== "parar") return;
    switch (m.musica) {
      case "carregar":
        if (!/^[A-Za-z0-9_-]{11}$/.test(String(m.video || ""))) return;
        atual = tocando = m.video;
        saltos = [];
        semJeito = false;
        aviso("");
        if (m.pausado) player.cueVideoById({ videoId: tocando, startSeconds: seg });
        else player.loadVideoById({ videoId: tocando, startSeconds: seg });
        break;
      case "pausar": player.pauseVideo(); if (m.segundo != null) player.seekTo(seg, true); break;
      case "tocar": if (m.segundo != null) player.seekTo(seg, true); player.playVideo(); break;
      case "ir": {
        // Acertar o tempo no máximo 3 vezes a cada 30 s (um anúncio, por exemplo, faz o
        // tempo parecer errado; pular sem parar fazia a música voltar a cada 2 s).
        const agora = Date.now();
        saltos = saltos.filter((t) => agora - t < 30000);
        if (saltos.length >= 3) break;
        saltos.push(agora);
        player.seekTo(seg, true);
        break;
      }
      case "parar": atual = tocando = ""; aviso(""); player.stopVideo(); break;
    }
  }

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || typeof m !== "object" || typeof m.musica !== "string") return;
    if (!pai) pai = ev.source;
    if (ev.source !== pai) return;
    if (m.musica === "volume") {
      volume = { valor: Math.min(100, Math.max(0, Number(m.valor) || 0)), mudo: !!m.mudo };
      aplicarVolume();
      volumeSC();
      return;
    }
    executar(m);
  });

  // De tempos em tempos conta em que segundo está (a página de fora acerta se atrasou).
  setInterval(() => {
    if (fonte === "sc") {
      if (!atual || !scEstado.pronto || semJeito) return;
      contar({ musica: "tempo", segundo: scEstado.pos / 1000, duracao: scEstado.dur / 1000,
               tocando: !scEstado.pausado, esperando: false });
      return;
    }
    if (!pronto || !atual) return;
    const estado = player.getPlayerState();
    contar({ musica: "tempo", segundo: player.getCurrentTime() || 0, duracao: player.getDuration() || 0,
             tocando: estado === YT.PlayerState.PLAYING,
             esperando: estado === YT.PlayerState.BUFFERING || estado === -1,
             volReal: player.getVolume(), mudoReal: player.isMuted() });
  }, 2000);
})();
