// Recuperar a conta (2.7.28). A conta fica guardada no aparelho (ID + chave); quem formata o PC perdia tudo.
//  - Configurações → Minha conta → "Código de recuperação": gera um código para a pessoa guardar.
//  - "Já tenho conta" (na tela do nick e nas Configurações): cola o código e a conta antiga volta.
//  - Quem não tem Discord ligado nem código recebe um lembrete discreto (no máximo a cada 3 dias).
(() => {
  "use strict";
  if (typeof TRATAR === "undefined") return;
  const $id = (i) => document.getElementById(i);
  const modal = $id("modal-conta");
  if (!modal) return;
  const tit = $id("conta-titulo"), sub = $id("conta-sub"), caixaCod = $id("conta-codigo"), txtCod = $id("conta-codigo-txt"),
    entrada = $id("conta-in"), msg = $id("conta-msg"), btOk = $id("conta-ok"), btCopiar = $id("conta-copiar");
  const btExtra = $id("conta-extra");
  let modo = "", esperando = false, protegida = true;
  // tudo o que é da conta e fica guardado neste aparelho (preferências do app, como tema e idioma, ficam)
  const DA_CONTA = ["astra.id", "astra.chave", "astra.nome", "astra.foto", "astra.fotogif", "astra.capa", "astra.capagif", "astra.perfil", "astra.status",
    "astra.ultimaSala", "astra.nomeSala", "astra.acessoSala", "astra.bannerSala", "astra.jam", "astra.relatoChave", "astra.codigoGuardado", "astra.lembreteConta"];
  function limparConta() { for (const k of DA_CONTA) { try { localStorage.removeItem(k); } catch (_) {} } }
  function sairDaConta() {
    limparConta();
    try { window.astra?.esquecerConta?.(); } catch (_) {}   // 3.0.20: a cópia fora do WebView2 não pode trazer a conta de volta
    tit.textContent = modo === "protegida" ? "Criando uma conta nova" : "Você saiu da conta";
    sub.textContent = "O Astra vai recarregar.";
    btOk.hidden = true; if (btExtra) btExtra.hidden = true;
    setTimeout(() => location.reload(), 900);
  }

  function abrir(m) {
    modo = m; esperando = false;
    msg.textContent = ""; btOk.disabled = false;
    caixaCod.hidden = true; entrada.hidden = m !== "usar" && m !== "protegida"; btOk.hidden = false;
    if (btExtra) { btExtra.hidden = true; delete btExtra.dataset.certeza; btExtra.textContent = rotuloExtra(); }
    if (m === "protegida") {
      // 2.7.41: o navegador tem o ID da conta mas não a chave (trocou de endereço, limpou parte dos dados...).
      // Antes só mandava para o entrar.html, que não ajuda quem não tem conta do site.
      tit.textContent = "Esta conta tem senha";
      sub.textContent = "Este navegador não tem mais a chave da sua conta. Para voltar para ela, cole o código de recuperação "
        + "(gerado em Configurações → Minha conta no aparelho em que ela ainda funciona, ou peça um no Discord do Astra). "
        + "A conta não foi apagada: continua com nick, perfil e AstraDoll. Se ligou o Discord, também dá para ";
      const a = document.createElement("a");
      a.href = "https://astrascreenshare.com/entrar.html"; a.textContent = "entrar com o Discord"; a.target = "_blank"; a.rel = "noopener";
      sub.append(a, ".");
      btOk.textContent = "Entrar na conta";
      entrada.value = "";
      if (btExtra) btExtra.hidden = false;
    } else if (m === "sair") {
      tit.textContent = "Sair da conta";
      if (protegida) {
        sub.textContent = "Esta conta sai deste aparelho. Para voltar, use o seu código de recuperação ou entre com o Discord. Se estiver transmitindo, a transmissão para.";
        btOk.textContent = "Sair da conta";
      } else {
        sub.textContent = "Atenção: esta conta ainda não tem código de recuperação. Se sair agora, não tem como voltar para ela (nick, perfil e AstraDoll ficam para trás). Gere o código antes.";
        btOk.textContent = "Gerar código antes";
        if (btExtra) btExtra.hidden = false;
      }
    } else if (m === "gerar") {
      tit.textContent = "Código de recuperação";
      sub.textContent = "Guarde este código num lugar seguro (bloco de notas, foto, Discord). Se formatar o PC ou trocar de aparelho, é com ele que a sua conta volta. Gerar um novo cancela o anterior.";
      btOk.textContent = "Gerar código";
    } else {
      tit.textContent = "Entrar em outra conta";
      sub.textContent = "Cole o código de recuperação da conta. Ela volta com nick, perfil, foto e AstraDoll." + (protegida ? "" : " Atenção: a conta em que você está agora não tem código; gere um antes se quiser voltar para ela.");
      btOk.textContent = "Entrar na conta";
      entrada.value = "";
    }
    modal.hidden = false;
    (entrada.hidden ? btOk : entrada).focus();
  }
  function rotuloExtra() { return modo === "protegida" ? "Criar conta nova" : "Sair mesmo assim"; }
  function fechar() { modal.hidden = true; }

  btOk.onclick = () => {
    if (esperando) return;
    if (modo === "sair") return protegida ? sairDaConta() : abrir("gerar");
    if (modo === "gerar") {
      if (!caixaCod.hidden) return fechar();
      esperando = true; btOk.disabled = true;
      enviar({ t: "codigo-recuperacao" });
    } else {
      const c = entrada.value.trim();
      if (c.replace(/[^a-z0-9]/gi, "").length < 16) { msg.textContent = "Esse código está incompleto."; return; }
      esperando = true; btOk.disabled = true; msg.textContent = "";
      // por HTTP: funciona mesmo antes de conectar (logo depois de formatar ainda não tem nick)
      fetch(siteBase() + "conta/recuperar", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ codigo: c }), cache: "no-store" })
        .then((r) => r.json())
        .then((j) => TRATAR.recuperar(j))
        .catch(() => TRATAR.recuperar({ ok: false, erro: "Sem conexão com o servidor. Tente de novo em instantes." }));
    }
  };
  entrada.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); btOk.click(); } });
  $id("conta-fechar").onclick = fechar;
  if (btExtra) btExtra.onclick = () => {   // sair sem código: pede uma segunda confirmação
    if (btExtra.dataset.certeza) return sairDaConta();
    btExtra.dataset.certeza = "1";
    btExtra.textContent = modo === "protegida" ? "Certeza? Clique de novo" : "Tenho certeza: sair";
    setTimeout(() => { delete btExtra.dataset.certeza; btExtra.textContent = rotuloExtra(); }, 4000);
  };
  modal.addEventListener("click", (e) => { if (e.target === modal) fechar(); });
  modal.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
  btCopiar.onclick = async () => {
    try { await navigator.clipboard.writeText(txtCod.textContent); btCopiar.textContent = "Copiado!"; }
    catch (_) { const r = document.createRange(); r.selectNodeContents(txtCod); getSelection().removeAllRanges(); getSelection().addRange(r); btCopiar.textContent = "Ctrl+C"; }
    setTimeout(() => (btCopiar.textContent = "Copiar"), 1800);
  };

  TRATAR["codigo-recuperacao"] = (m) => {
    esperando = false; btOk.disabled = false;
    txtCod.textContent = m.codigo || "";
    caixaCod.hidden = false;
    btOk.textContent = "Já guardei";
    try { localStorage.setItem("astra.codigoGuardado", String(Date.now())); } catch (_) {}
    estadoProtegida(true);
  };
  TRATAR.recuperar = (m) => {
    esperando = false; btOk.disabled = false;
    if (!m.ok) { msg.textContent = m.erro || "Não deu certo. Tente de novo."; return; }
    limparConta();   // a foto e o perfil da conta anterior não podem ir parar na que voltou
    guardar("astra.id", m.id);
    guardar("astra.chave", m.chave);
    try { window.astra?.lembrarConta?.(m.id, m.chave); } catch (_) {}   // 3.0.20
    if (m.nome) guardar("astra.nome", m.nome);
    tit.textContent = "Conta recuperada!";
    sub.textContent = `Bem-vindo de volta${m.nome ? ", " + m.nome : ""}. O Astra vai recarregar.`;
    entrada.hidden = true; btOk.hidden = true;
    setTimeout(() => location.reload(), 1400);
  };

  // lembrete para quem ainda pode perder a conta
  function estadoProtegida(sim) {
    protegida = !!sim;
    const s = $id("cfg-recuperacao-txt");
    if (s) s.textContent = sim ? "Sua conta tem como voltar. Pode gerar outro código quando quiser."
      : "Se formatar o PC, a conta some. Gere um código e guarde.";
  }
  const prontoAntes = TRATAR.pronto;
  TRATAR.pronto = function (m) {
    prontoAntes.call(this, m);
    if (m.recuperavel === undefined) return;
    estadoProtegida(!!m.recuperavel);
    if (m.recuperavel) return;
    let ultima = 0;
    try { ultima = Number(localStorage.getItem("astra.lembreteConta")) || 0; } catch (_) {}
    if (Date.now() - ultima < 3 * 864e5) return;
    setTimeout(() => {
      try { localStorage.setItem("astra.lembreteConta", String(Date.now())); } catch (_) {}
      aviso({ titulo: "Proteja a sua conta", texto: "Se formatar o PC, a conta some. Clique aqui e gere um código de recuperação.", tempo: 12000, aoClicar: () => abrir("gerar") });
    }, 90000);
  };

  for (const [bt, m] of [["cfg-recuperacao", "gerar"], ["cfg-recuperar", "usar"], ["nome-ja-tenho", "usar"], ["cfg-sair", "sair"]]) {
    const b = $id(bt); if (b) b.onclick = (e) => { e.preventDefault(); abrir(m); };
  }
  // "Esta conta tem senha": abre a janela com o código e o botão de conta nova (em vez de só um aviso).
  const protegidaAntes = TRATAR["conta-protegida"];
  TRATAR["conta-protegida"] = function (m) {
    if (protegidaAntes) protegidaAntes.call(this, m);
    if (modal.hidden || modo !== "protegida") abrir("protegida");
  };
  window.astraConta = { abrir };
})();
