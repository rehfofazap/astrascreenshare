// Trava com PIN: pede um PIN para abrir o chat privado quando
// outra pessoa usar o seu PC. O PIN não fica guardado: só um "resumo" dele (PBKDF2),
// que não dá para desfazer. Fica só neste aparelho.
//
// A trava volta sozinha ao abrir o programa e quando ele fica escondido/minimizado por
// mais de 1 minuto. Esquecer o PIN apaga as conversas privadas deste aparelho.
// Liga e desliga só dentro do chat privado.
(() => {
  "use strict";
  const sutil = window.crypto && window.crypto.subtle;
  const CHAVE = "astra.trava";
  let destravado = false, escondidoEm = 0, depois = null, erros = 0, esperaAte = 0, digitado = "";

  function config() {
    try { const c = JSON.parse(localStorage.getItem(CHAVE) || "null"); return c && c.hash ? c : null; } catch (_) { return null; }
  }
  async function resumo(pin, sal) {
    const base = await sutil.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await sutil.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(atob(sal), (c) => c.charCodeAt(0)), iterations: 150000 }, base, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  }
  const precisa = () => !!config() && !destravado;

  // ---------- tela do PIN ----------
  const tela = document.createElement("div");
  tela.id = "trava";
  tela.className = "trava";
  tela.hidden = true;
  tela.innerHTML = `
    <div class="trava-caixa" role="dialog" aria-label="Digite o PIN">
      <div class="trava-cadeado"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3Z"/></svg></div>
      <b class="trava-titulo">Digite o PIN</b>
      <small class="trava-sub"></small>
      <div class="trava-pontos"></div>
      <p class="trava-erro" role="alert"></p>
      <div class="trava-teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join("")}
        <button type="button" class="trava-cancelar" data-acao="cancelar">Fechar</button><button type="button" data-n="0">0</button><button type="button" class="trava-apagar" data-acao="apagar" aria-label="Apagar">⌫</button></div>
      <button type="button" class="link-discreto trava-esqueci">Esqueci o PIN</button>
    </div>`;
  document.body.append(tela);
  const $t = (s) => tela.querySelector(s);

  let modoTela = null;   // {tipo: "entrar"|"criar"|"confirmar", ...}
  function mostrar(m) {
    modoTela = m;
    digitado = "";
    tela.hidden = false;
    tela.classList.toggle("tudo", m.tipo === "entrar" && m.tudo);
    document.documentElement.classList.toggle("travado", m.tipo === "entrar" && !!m.tudo);
    $t(".trava-titulo").textContent = m.titulo;
    $t(".trava-sub").textContent = m.sub || "";
    $t(".trava-erro").textContent = "";
    $t(".trava-esqueci").hidden = m.tipo !== "entrar";
    $t(".trava-cancelar").style.visibility = m.tudo ? "hidden" : "";
    desenharPontos();
  }
  function fecharTela() {
    tela.hidden = true; modoTela = null; digitado = "";
    document.documentElement.classList.remove("travado");
  }
  function desenharPontos() {
    const tam = modoTela && modoTela.tipo === "entrar" ? (config() || {}).tam || 4 : Math.max(4, digitado.length);
    $t(".trava-pontos").innerHTML = "";
    for (let i = 0; i < Math.max(tam, digitado.length); i++) {
      const p = document.createElement("i");
      if (i < digitado.length) p.className = "cheio";
      $t(".trava-pontos").append(p);
    }
    // ao criar o PIN: 4 a 6 números, o botão "Pronto" aparece no lugar do "Fechar"
    if (modoTela && modoTela.tipo !== "entrar") {
      const bt = $t(".trava-cancelar");
      bt.textContent = digitado.length >= 4 ? "Pronto" : "Fechar";
      bt.dataset.acao = digitado.length >= 4 ? "pronto" : "cancelar";
    } else {
      $t(".trava-cancelar").textContent = "Fechar";
      $t(".trava-cancelar").dataset.acao = "cancelar";
    }
  }
  function errou(msg) {
    $t(".trava-erro").textContent = msg;
    $t(".trava-pontos").classList.remove("tremer"); void $t(".trava-pontos").offsetWidth; $t(".trava-pontos").classList.add("tremer");
    digitado = "";
    desenharPontos();
  }

  async function conferir() {
    const c = config();
    if (Date.now() < esperaAte) return errou(`Muitas tentativas. Espere ${Math.ceil((esperaAte - Date.now()) / 1000)} s.`);
    if ((await resumo(digitado, c.sal)) === c.hash) {
      erros = 0; destravado = true;
      const fazer = modoTela.depois;
      fecharTela();
      if (fazer) fazer();
      return;
    }
    erros++;
    if (erros >= 5) { esperaAte = Date.now() + 30000; erros = 0; return errou("PIN errado. Espere 30 s para tentar de novo."); }
    errou("PIN errado.");
  }

  async function apertou(n) {
    if (!modoTela) return;
    if (digitado.length >= 6) return;
    digitado += n;
    $t(".trava-erro").textContent = "";
    desenharPontos();
    if (modoTela.tipo === "entrar" && digitado.length === ((config() || {}).tam || 4)) await conferir();
    else if (modoTela.tipo === "confirmar" && digitado.length === modoTela.pin.length) await terminarCriar();
  }
  async function pronto() {
    if (modoTela.tipo === "criar" && digitado.length >= 4) {
      mostrar({ tipo: "confirmar", titulo: "Digite o PIN de novo", sub: "Para ter certeza.", pin: digitado, modo: modoTela.modo });
    }
  }
  async function terminarCriar() {
    if (digitado !== modoTela.pin) { const m = modoTela; mostrar({ tipo: "criar", titulo: "Crie um PIN", sub: "4 a 6 números.", modo: m.modo }); return errou("Os PINs não bateram. Comece de novo."); }
    const sal = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const hash = await resumo(digitado, sal);
    localStorage.setItem(CHAVE, JSON.stringify({ modo: modoTela.modo, sal, hash, tam: digitado.length }));
    destravado = true;
    fecharTela();
    aviso({ titulo: "Trava com PIN ligada", texto: "O chat privado pede o PIN quando o Astra fica escondido por mais de 1 minuto." });
    if (aoTerminar) { const f = aoTerminar; aoTerminar = null; f(); }
  }

  tela.addEventListener("click", (ev) => {
    const bt = ev.target.closest("button");
    if (!bt) return;
    if (bt.dataset.n) apertou(bt.dataset.n);
    else if (bt.dataset.acao === "apagar") { digitado = digitado.slice(0, -1); desenharPontos(); }
    else if (bt.dataset.acao === "pronto") pronto();
    else if (bt.dataset.acao === "cancelar") fecharTela();
    else if (bt.classList.contains("trava-esqueci")) esqueci();
  });
  document.addEventListener("keydown", (ev) => {
    if (tela.hidden) return;
    if (/^[0-9]$/.test(ev.key)) { ev.preventDefault(); apertou(ev.key); }
    else if (ev.key === "Backspace") { ev.preventDefault(); digitado = digitado.slice(0, -1); desenharPontos(); }
    else if (ev.key === "Enter") { ev.preventDefault(); pronto(); }
    else if (ev.key === "Escape" && !tela.classList.contains("tudo")) fecharTela();
  }, true);

  function esqueci() {
    aviso({ titulo: "Esqueceu o PIN?", texto: "Para tirar a trava, as conversas privadas deste aparelho são apagadas.", tempo: 15000,
      botoes: [{ texto: "Apagar e tirar a trava", acao: () => {
        // apaga só as conversas: a chave do aparelho fica (sem ela, os amigos não conseguiriam mais falar com você)
        try {
          const r = indexedDB.open("astra-privado", 1);
          r.onsuccess = () => { try { r.result.transaction("kv", "readwrite").objectStore("kv").delete("conversas"); } catch (_) {} };
        } catch (_) {}
        localStorage.removeItem(CHAVE);
        destravado = true;
        fecharTela();
        setTimeout(() => location.reload(), 300);
      } }, { texto: "Cancelar" }] });
  }

  // ---------- quando pedir ----------
  function pedir(fazer) {
    const c = config();
    mostrar({ tipo: "entrar", titulo: "Digite o PIN", sub: "Para abrir o chat privado.", depois: fazer });
  }
  function travar() {
    if (!config()) return;
    destravado = false;
    if (!$("privado").hidden) $("privado").hidden = true;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") escondidoEm = Date.now();
    else if (escondidoEm && Date.now() - escondidoEm > 60000) travar();
  });

  // ---------- ligar e desligar (só pelo chat privado) ----------
  function ligar(pronto) {
    if (!sutil || config()) return;
    aoTerminar = pronto;
    mostrar({ tipo: "criar", titulo: "Crie um PIN", sub: "4 a 6 números. Ele vai ser pedido para abrir o chat privado.", modo: "privado" });
  }
  function desligar(pronto) {
    if (!config()) return;
    mostrar({ tipo: "entrar", titulo: "Digite o PIN", sub: "Para desligar a trava.", depois: () => {
      localStorage.removeItem(CHAVE);
      aviso({ titulo: "Trava com PIN desligada" });
      if (pronto) pronto();
    } });
  }
  let aoTerminar = null;

  window.astraTrava = { precisa, pedir, ligar, desligar, ativa: () => !!config() };
})();
