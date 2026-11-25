// 2.7.42: sala oculta (não aparece na lista de salas) + "Copiar link da sala" para mandar aos amigos.
// O link é https://astrascreenshare.com/app/?sala=<código secreto da sala>: quem abre entra na sala
// (seguindo a regra dela: pública entra na hora, com senha pede a senha, aprovação pede para o dono).
(() => {
  "use strict";
  if (typeof TRATAR === "undefined") return;
  const $id = (i) => document.getElementById(i);
  const BASE = "https://astrascreenshare.com/app/";
  const ICONE_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  const ICONE_OCULTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';
  const ICONE_LISTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  let oculta = false;

  // ---- botões ao lado de "Pública / Com senha / Aprovação" ----
  const btAcesso = $id("bt-acesso");
  if (!btAcesso) return;
  const btLink = document.createElement("button");
  btLink.type = "button"; btLink.id = "bt-link-sala"; btLink.className = "bt-acesso"; btLink.hidden = true;
  btLink.innerHTML = ICONE_LINK + "<span>Link</span>";
  btLink.title = "Copiar o link da sala para mandar aos amigos";
  btLink.setAttribute("aria-label", "Copiar o link da sala");
  const btOculta = document.createElement("button");
  btOculta.type = "button"; btOculta.id = "bt-oculta"; btOculta.className = "bt-acesso"; btOculta.hidden = true;
  const linha = document.createElement("div");
  linha.className = "sala-botoes";
  btAcesso.before(linha);
  linha.append(btAcesso, btLink, btOculta);

  const souDono = () => estado.dono && estado.dono === estado.conexao;
  function desenhar() {
    const naSala = !!(estado.sala && estado.acessoSala);   // a sala do Discord não tem link nem fica oculta
    btLink.hidden = !naSala || !estado.convite;
    const dono = souDono();
    btOculta.hidden = !naSala || (!dono && !oculta);   // quem não é dono só vê o aviso quando está oculta
    btOculta.disabled = !dono;
    btOculta.innerHTML = (oculta ? ICONE_OCULTA + "<span>Oculta</span>" : ICONE_LISTA + "<span>Na lista</span>");
    btOculta.classList.toggle("ligado", oculta);
    btOculta.title = !dono ? "A sala não aparece na lista: só entra quem tem o link"
      : oculta ? "A sala está oculta (só entra quem tem o link). Clique para ela voltar a aparecer na lista"
      : "A sala aparece na lista de salas. Clique para ocultar (só entra quem tiver o link)";
    btOculta.setAttribute("aria-pressed", String(oculta));
  }
  const desenharAntes = window.desenharAcessoSala;
  if (typeof desenharAntes === "function") {
    window.desenharAcessoSala = function () { desenharAntes.apply(this, arguments); desenhar(); };
  }

  btLink.onclick = () => {
    if (!estado.convite) return;
    copiar(BASE + "?sala=" + encodeURIComponent(estado.convite),
      oculta ? "Link da sala copiado! Mande para os seus amigos: a sala está oculta, só entra quem tiver o link."
             : "Link da sala copiado! Mande para os seus amigos: quem abrir entra na sala.");
  };
  btOculta.onclick = () => {
    if (!souDono()) return;
    enviar({ t: "sala-oculta", oculta: !oculta });
  };

  // ---- ao criar a sala: "Ocultar da lista" ----
  const dica = $id("privacidade-dica");
  if (dica) {
    const rot = document.createElement("label");
    rot.className = "opcao-oculta";
    const cx = document.createElement("input");
    cx.type = "checkbox"; cx.id = "in-oculta-criar";
    cx.checked = ler("astra.ocultaSala") === "1";
    cx.onchange = () => guardar("astra.ocultaSala", cx.checked ? "1" : "0");
    rot.append(cx, " Ocultar da lista de salas (só entra quem tiver o link)");
    dica.after(rot);
  }

  // ---- mensagens do servidor ----
  const bemvindoAntes = TRATAR.bemvindo;
  TRATAR.bemvindo = function (m) {
    oculta = !!m.oculta;
    linkPendente = "";
    bemvindoAntes.call(this, m);
    desenhar();
  };
  TRATAR.oculta = (m) => {
    oculta = !!m.oculta;
    if (souDono()) {
      guardar("astra.ocultaSala", oculta ? "1" : "0");
      aviso({ titulo: oculta ? "Sala oculta" : "A sala voltou para a lista",
        texto: oculta ? "Ela não aparece mais na lista. Use o botão \"Link\" para chamar os amigos." : "", tempo: 4000 });
    }
    desenhar();
  };

  // ---- abriu o site por um link de sala (?sala=...) ----
  let linkPendente = "";
  try {
    const q = new URLSearchParams(location.search);
    const c = (q.get("sala") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    if (c) {
      linkPendente = c;
      q.delete("sala");
      const resto = q.toString();
      history.replaceState(null, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
    }
  } catch (_) {}
  const prontoAntes = TRATAR.pronto;
  TRATAR.pronto = function (m) {
    prontoAntes.call(this, m);
    entrarPeloLink();
  };
  // o servidor pode responder antes deste arquivo carregar: se já está conectado, entra agora
  if (estado.conexao) entrarPeloLink();
  function entrarPeloLink() {
    if (!linkPendente) return;
    // quem abre o link pela 1ª vez ainda escolhe o nick: entra na sala depois de escolher
    const c = linkPendente, inicio = Date.now();
    const tentar = () => {
      if (linkPendente !== c || Date.now() - inicio > 5 * 60e3) return;
      const nomeAberto = $id("modal-nome") && !$id("modal-nome").hidden;
      if (nomeAberto || !estado.ws || estado.ws.readyState !== 1) return void setTimeout(tentar, 500);
      enviar({ t: "entrar", convite: c });
    };
    setTimeout(tentar, 600);
  };
  const erroAntes = TRATAR.erro;
  TRATAR.erro = function (m) {
    if (linkPendente && !m.silencioso) linkPendente = "";   // link velho: não fica tentando
    return erroAntes ? erroAntes.call(this, m) : undefined;
  };
  window.astraSalaLink = { desenhar };
})();
