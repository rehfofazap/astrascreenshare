// Parte que só funciona dentro do programa de PC (window.astra vem do preload
// do Electron). No navegador comum este arquivo não faz nada.
//
//  - window.astraSeletor: janela "Transmitir tela" (telas/janelas, qualidade, som);
//  - window.astraSom: som que vem do capturador do Windows (astra-audio.exe),
//    que consegue tirar o Discord do som ou pegar só o som de uma janela.
"use strict";
(function () {
  if (!window.astra || window.astra.celular) return;
  const $ = (id) => document.getElementById(id);
  const astra = window.astra;

  // ---------- janela "Transmitir tela" ----------
  let fontes = [];
  let tipo = "screen";
  let escolhida = null;

  function desenhar() {
    const lista = $("seletor-lista");
    lista.innerHTML = "";
    for (const f of fontes.filter((x) => (tipo === "screen") === x.tela)) {
      const b = document.createElement("button");
      b.type = "button";
      if (escolhida && escolhida.id === f.id) b.className = "escolhido";
      const img = document.createElement("img");
      img.src = f.miniatura;
      img.alt = "";
      const nome = document.createElement("span");
      nome.textContent = f.nome;
      b.append(img, nome);
      b.onclick = () => { escolhida = f; desenhar(); };
      b.ondblclick = () => { escolhida = f; confirmar(); };
      lista.append(b);
    }
    if (!lista.childElementCount) {
      lista.textContent = tipo === "screen" ? "Nenhuma tela encontrada." : "Nenhuma janela aberta.";
    }
    $("seletor-ok").disabled = !escolhida;
    // "Só o som da janela" só faz sentido quando se escolhe uma janela.
    const opJanela = $("op-som").querySelector('option[value="janela"]');
    opJanela.disabled = !(escolhida && !escolhida.tela);
    if (opJanela.disabled && $("op-som").value === "janela") $("op-som").value = "sem-discord";
    // Borda amarela/laranja: quem desenha é o Windows, em volta do que é capturado pela captura nova
    // (sempre numa janela; na tela inteira só com "Esconder o mouse" desligado). Não dá para tirar daqui.
    const dica = $("dica-borda");
    if (dica) dica.hidden = !(escolhida && (!escolhida.tela || ($("op-mouse-caixa") && !$("op-mouse-caixa").hidden && $("op-mouse").value === "nao")));
  }
  $("op-mouse").addEventListener("change", () => desenhar());

  for (const aba of document.querySelectorAll(".aba")) {
    aba.addEventListener("click", () => {
      document.querySelectorAll(".aba").forEach((a) => a.classList.toggle("ativa", a === aba));
      tipo = aba.dataset.tipo;
      desenhar();
    });
  }

  // v5: o seletor abre na hora; a lista de telas/janelas chega depois (com limite de tempo).
  // Antes ele esperava o Windows responder e, se demorasse ou desse erro, nada abria.
  let buscando = null;
  const comLimite = (p, ms) => Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error("demorou")), ms))]);
  async function buscarFontes() {
    const lista = $("seletor-lista");
    lista.textContent = "Procurando telas e janelas…";
    $("seletor-ok").disabled = true;
    try {
      fontes = await comLimite(astra.listarFontes(), 12000) || [];
    } catch (e) {
      fontes = [];
      lista.textContent = "";
      const p = document.createElement("p"); p.className = "sub";
      p.textContent = e && e.message === "demorou" ? "O Windows demorou para mostrar as telas." : "Não deu para listar as telas agora.";
      const b = document.createElement("button"); b.type = "button"; b.className = "bt secundario pequeno"; b.textContent = "Tentar de novo";
      b.onclick = () => { buscando = buscarFontes().finally(() => { buscando = null; }); };
      lista.append(p, b);
      return false;
    }
    return true;
  }
  async function abrir() {
    if (!$("seletor").hidden && buscando) return;   // já está abrindo
    escolhida = null; fontes = [];
    $("seletor").hidden = false;
    buscando = buscarFontes().finally(() => { buscando = null; });
    if (!(await buscando)) return;
    escolhida = fontes.find((f) => f.tela) || null;   // a tela principal já vem marcada
    tipo = "screen";
    document.querySelectorAll(".aba").forEach((a) => a.classList.toggle("ativa", a.dataset.tipo === "screen"));
    $("op-qualidade").value = (localStorage.getItem("astra.qualidade") || "1080-60").replace(/^auto$/, "1080-60");
    $("op-som").value = localStorage.getItem("astra.som") || "sem-discord";
    $("op-modo").value = localStorage.getItem("astra.modo") || "motion";
    $("op-hw").value = localStorage.getItem("astra.hw") || "sim";
    $("op-leve").value = localStorage.getItem("astra.leve") || "nao";
    $("op-notif").value = localStorage.getItem("astra.notif") || "esconder";
    $("op-teclas").value = "nao";   // 3.0.20: "mostrar teclas" foi removido
    if (astra.semMouse) {
      $("op-mouse-caixa").hidden = false;
      $("op-mouse").value = astra.semMouse.ligadoAgora ? "sim" : "nao";
    }
    if ($("op-qualidade").selectedIndex < 0) $("op-qualidade").value = "1080-60";
    desenhar();
  }

  // Esconder o mouse: o Windows só troca o jeito de capturar com o Astra reiniciando.
  $("op-mouse").addEventListener("change", () => {
    if (!astra.semMouse) return;
    const sim = $("op-mouse").value === "sim";
    astra.semMouse.salvar(sim);
    if (sim === astra.semMouse.ligadoAgora) return;
    aviso({ titulo: sim ? "Esconder o mouse: ligado" : "Esconder o mouse: desligado",
      texto: "Vale depois de reiniciar o Astra. Clique aqui para reiniciar agora.", tempo: 15000,
      aoClicar: () => astra.reiniciar() });
  });

  async function confirmar() {
    if (!escolhida) return;
    const opcoes = { qualidade: $("op-qualidade").value, som: $("op-som").value, modo: $("op-modo").value, hw: $("op-hw").value, leve: $("op-leve").value, notif: $("op-notif").value, teclas: "nao" };
    try {
      localStorage.setItem("astra.qualidade", opcoes.qualidade);
      localStorage.setItem("astra.som", opcoes.som);
      localStorage.setItem("astra.modo", opcoes.modo);
      localStorage.setItem("astra.hw", opcoes.hw);
      localStorage.setItem("astra.leve", opcoes.leve);
      localStorage.setItem("astra.notif", opcoes.notif);
      localStorage.setItem("astra.teclas", opcoes.teclas);
    } catch (_) {}
    $("seletor").hidden = true;
    try {
      const r = await comLimite(astra.definirFonte({ id: escolhida.id, som: opcoes.som }), 8000);
      // 3.0.17: outra janela/tela tem nome parecido; o Windows poderia transmitir a errada.
      if (r && r.motivo === "ambigua") {
        aviso({ titulo: "Tem outra janela com nome parecido",
                texto: "Para não transmitir a janela errada, feche a outra janela com o mesmo nome (ou escolha a Tela inteira) e tente de novo.",
                tempo: 12000 });
        return;
      }
      await window.iniciarTela(opcoes);
    } catch (e) {
      console.warn("transmitir falhou", e);
      aviso({ titulo: "Não deu para começar a transmissão", texto: "Tente de novo. Se continuar, escolha outra tela ou janela.", tempo: 7000 });
    }
  }

  function fechar() { $("seletor").hidden = true; }
  $("seletor-ok").addEventListener("click", confirmar);
  $("seletor-cancelar").addEventListener("click", fechar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("seletor").hidden) fechar(); });

  window.astraSeletor = { abrir };

  // ---------- som do capturador do Windows ----------
  // O astra-audio.exe manda PCM 16 bits, 48 kHz, estéreo. Aqui ele vira uma
  // faixa de áudio normal (MediaStreamTrack) que entra na transmissão.
  let contexto = null;
  let no = null;

  async function iniciar() {
    parar();
    const r = await astra.iniciarSom();
    if (!r.ok) return { erro: r.erro || "O capturador de som não abriu." };
    contexto = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    await contexto.audioWorklet.addModule("som-worklet.js");
    no = new AudioWorkletNode(contexto, "astra-som", { outputChannelCount: [2] });
    const destino = contexto.createMediaStreamDestination();
    destino.channelCount = 2;
    no.connect(destino);
    astra.aoReceberSom((pedaco) => {
      if (no) no.port.postMessage(pedaco, [pedaco.buffer]);
    });
    return { faixa: destino.stream.getAudioTracks()[0], info: r.info || "" };
  }

  function parar() {
    astra.pararSom();
    if (no) { no.disconnect(); no = null; }
    if (contexto) { contexto.close().catch(() => {}); contexto = null; }
  }

  window.astraSom = { iniciar, parar };
})();
