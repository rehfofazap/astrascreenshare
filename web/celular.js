// Parte que só funciona dentro do app Android. O Java coloca o objeto
// window.AstraNativo na página; aqui ele vira um window.astra parecido com o
// do programa de PC, para o app.js funcionar igual nos dois.
//
// No celular, quem captura e manda a tela é o Java (MediaProjection + WebRTC
// nativo). O app.js só faz a ponte das mensagens "sinal" com o servidor.
// No navegador comum e no programa de PC este arquivo não faz nada.
"use strict";
(function () {
  const N = window.AstraNativo;
  if (!N) return;
  const $ = (id) => document.getElementById(id);
  let aoEvento = null;

  window.astra = {
    celular: true,
    servidor: N.servidor(),
    site: N.site(),
    versao: N.versao ? N.versao() : "",
    usuario: N.usuario(),
    aviso: (titulo, texto) => N.aviso(String(titulo || ""), String(texto || "")),
    transmitindo: (sim) => N.transmitindo(!!sim),
    relaxado: (sim) => N.relaxado(!!sim),
    telaCheia: (sim, deitado) => N.telaCheia(!!sim, !!deitado),
    miniTela: N.miniTela ? (deitado) => N.miniTela(!!deitado) : null,
    silencio: N.silencio ? (sim) => N.silencio(!!sim) : null,
    pausarCelular: (sim) => N.pausarTransmissao && N.pausarTransmissao(!!sim),
    pedirSilencio: () => N.pedirSilencio && N.pedirSilencio(),
    acorde: (nome) => N.acorde(String(nome || "")),
    // voz das doações: o leitor de texto do próprio Android (a mesma voz do Google)
    falar: N.falar ? (texto, tom, vel) => N.falar(String(texto || ""), +tom || 1, +vel || 1) : null,
    calar: N.calar ? () => N.calar() : null,
    mostrar: () => {},
    protegerTela: N.protegerTela ? (sim) => N.protegerTela(!!sim) : null,
    // Transmissão pelo Java
    iniciarCelular: (opcoes, ice) => N.iniciarTransmissao(JSON.stringify({ opcoes, ice })),
    pararCelular: () => N.pararTransmissao(),
    novoParCelular: (id) => N.novoPar(String(id)),
    removerParCelular: (id) => N.removerPar(String(id)),
    sinalCelular: (id, dados) => N.sinal(String(id), JSON.stringify(dados)),
    aoEventoCelular: (cb) => { aoEvento = cb; },
  };

  // O Java chama window.astraCelular.receber("{...}") para avisar a página.
  window.astraCelular = {
    receber(json) {
      try { if (aoEvento) aoEvento(JSON.parse(json)); } catch (e) { console.warn("astraCelular", e); }
    },
  };

  // ---------- janela "Transmitir tela" do celular ----------
  // O próprio Android pergunta se é a tela toda ou um app; aqui só escolhemos
  // a qualidade e o som.
  document.addEventListener("DOMContentLoaded", () => {
    $("seletor").querySelector(".abas").hidden = true;
    $("seletor-lista").hidden = true;
    $("op-hw-caixa").hidden = true;
    $("op-leve-caixa").hidden = true;   // o celular transmite pelo Java, sem a ponte
    $("op-teclas-caixa").hidden = true;   // no celular não tem teclado para mostrar   // o Android já usa o codificador de vídeo do próprio aparelho
    $("op-qualidade").innerHTML =
      '<option value="auto" selected>Automática (recomendada)</option>' +
      '<option value="720-30">720p · 30 qps (economiza bateria)</option>' +
      '<option value="1080-30">1080p · 30 qps</option>' +
      '<option value="1080-60">1080p · 60 qps</option>';
    $("op-som").innerHTML =
      '<option value="celular" selected>Som do celular (sem vozes de chamadas)</option>' +
      '<option value="nenhum">Sem som</option>';
    const aviso = document.createElement("p");
    aviso.className = "sub";
    aviso.textContent = "Ao tocar em \"Entrar ao vivo\", o Android pergunta o que você quer mostrar. " +
      "As vozes do Discord e de outras chamadas nunca entram na transmissão.";
    $("seletor-lista").after(aviso);
    $("seletor-ok").disabled = false;
    $("seletor-ok").addEventListener("click", () => {
      const opcoes = { qualidade: $("op-qualidade").value, som: $("op-som").value, modo: $("op-modo").value, notif: $("op-notif").value };
      try {
        localStorage.setItem("astra.cel.qualidade", opcoes.qualidade);
        localStorage.setItem("astra.cel.som", opcoes.som);
        localStorage.setItem("astra.cel.notif", opcoes.notif);
      } catch (_) {}
      $("seletor").hidden = true;
      window.iniciarTela(opcoes);
    });
    $("seletor-cancelar").addEventListener("click", () => { $("seletor").hidden = true; });
  });

  window.astraSeletor = {
    abrir() {
      try {
        $("op-qualidade").value = localStorage.getItem("astra.cel.qualidade") || "auto";
        $("op-som").value = localStorage.getItem("astra.cel.som") || "celular";
        $("op-notif").value = localStorage.getItem("astra.cel.notif") || "esconder";
      } catch (_) {}
      $("seletor").hidden = false;
    },
  };
})();
