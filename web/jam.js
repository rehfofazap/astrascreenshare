// Música sem sala: ouvir sozinho e Jams (públicas ou só com link), na página Música.
// Reaproveita tudo da música da sala: o mesmo painel (busca, fila, tocar/pausar/pular, volume),
// o mesmo player e a mesma sincronia (o servidor manda {t:"musica", fonte:"jam"}).
// Só uma música toca por vez aqui: numa Jam, a música da sala fica guardada (app.js, trocarFonteMusica).
// O player fica fixo (#musica-motor): navegar entre as páginas não interrompe nada.
(function () {
  const $ = (id) => document.getElementById(id);
  const pagina = $("pg-musica"), painel = $("painel-musica"), vaga = $("pg-musica-player");
  const lugarOriginal = { pai: painel.parentElement, antes: $("painel-online") };
  let jam = null;
  let novaPublica = true;
  const CHAVE = "astra.jam";
  const conectado = () => !!(estado.ws && estado.ws.readyState === WebSocket.OPEN);

  // ---------- link de convite ----------
  function baseApp() {
    if (programa) return programa.site.replace(/\/?$/, "/");
    return location.origin + location.pathname.replace(/[^/]*$/, "");
  }
  const linkJam = (codigo) => `${baseApp()}?jam=${encodeURIComponent(codigo)}`;
  function codigoDoTexto(t) {
    t = String(t || "").trim();
    const m = t.match(/[?&]jam=([A-Za-z0-9_-]{6,32})/) || t.match(/^([A-Za-z0-9_-]{8,32})$/);
    return m ? m[1] : "";
  }
  // Abriu um link de convite (?jam=...): guarda e entra assim que conectar.
  (function () {
    const q = new URLSearchParams(location.search).get("jam");
    if (q && /^[A-Za-z0-9_-]{6,32}$/.test(q)) {
      guardar(CHAVE, q);
      estado.jamDoLink = true;
      try { history.replaceState(null, "", location.pathname + location.hash); } catch (_) {}
    }
  })();

  function msg(t) { $("jam-msg").textContent = t || ""; }
  function mandar(m) {
    if (!conectado()) { msg("Sem conexão com o servidor agora. Tentando de novo..."); return false; }
    enviar({ t: "jam", ...m });
    return true;
  }

  // ---------- mensagens do servidor ----------
  TRATAR.jam = (m) => {
    if (!m.id) {   // saí (ou fui tirado)
      jam = null;
      guardar(CHAVE, "");
      fontesMusica.jam = null;
      trocarFonteMusica("sala");
    } else {
      const entrou = !jam || jam.id !== m.id;
      jam = m;
      guardar(CHAVE, m.codigo);
      if (entrou) {
        msg("");
        trocarFonteMusica("jam");
        if (estado.jamDoLink) {
          estado.jamDoLink = false;
          aviso({ titulo: `Você entrou na Jam "${m.nome}"`, texto: "A música toca para todo mundo junto.", tempo: 5000 });
          window.astraNav?.ir("musica");
        }
      }
    }
    desenhar();
  };
  TRATAR["jam-erro"] = (m) => {
    if (m.fim) {
      guardar(CHAVE, "");
      if (jam && m.silencioso) {   // voltou a conexão e a Jam já tinha acabado
        jam = null; fontesMusica.jam = null; trocarFonteMusica("sala"); desenhar();
      }
    }
    if (m.silencioso) return;
    msg(m.msg);
    if (!m.leve && (pagina.hidden || document.hidden)) aviso({ titulo: m.msg, tempo: 6000 });
  };
  const prontoAntes = TRATAR.pronto;
  TRATAR.pronto = function (m) {
    prontoAntes.call(this, m);
    const codigo = ler(CHAVE);
    if (codigo) enviar({ t: "jam", acao: "entrar", codigo, silencioso: !estado.jamDoLink });   // volta para a Jam (queda ou recarregou)
  };
  window.aoMudarJams = () => { if (!pagina.hidden) desenharLista(); };

  // ---------- página ----------
  function desenhar() {
    $("jam-fora").hidden = !!jam;
    $("jam-dentro").hidden = !jam;
    if (jam) desenharDentro(); else desenharLista();
    desenharPainel();
  }

  function desenharLista() {
    const ul = $("jam-lista");
    const lista = (estado.jams || []).filter((j) => !jam || j.id !== jam.id);
    ul.innerHTML = "";
    $("jam-qtd").textContent = lista.length ? String(lista.length) : "";
    if (!conectado() && !lista.length) {
      const li = document.createElement("li"); li.className = "vazia"; li.textContent = "Conectando...";
      ul.append(li); return;
    }
    if (!lista.length) {
      const li = document.createElement("li"); li.className = "vazia";
      li.textContent = "Nenhuma Jam aberta agora. Crie a primeira.";
      ul.append(li); return;
    }
    for (const j of lista) {
      const li = document.createElement("li");
      const rostos = document.createElement("span"); rostos.className = "rostos";
      for (const p of (j.membros || []).slice(0, 3)) rostos.append(avatar(p.nome, p.astraId, false));
      const txt = document.createElement("span"); txt.className = "jam-item-txt";
      const b = document.createElement("b"); b.textContent = j.nome;
      const s = document.createElement("small");
      s.textContent = [j.pessoas === 1 ? "1 pessoa" : `${j.pessoas} pessoas`, j.tocando ? `♪ ${j.tocando}` : "em silêncio"].join(" · ");
      txt.append(b, s);
      const bt = document.createElement("button");
      bt.type = "button"; bt.className = "bt secundario pequeno"; bt.textContent = "Entrar";
      bt.setAttribute("aria-label", `Entrar na Jam ${j.nome}`);
      bt.onclick = () => { if (mandar({ acao: "entrar", id: j.id })) msg("Entrando..."); };
      li.append(rostos, txt, bt);
      ul.append(li);
    }
  }

  const sozinho = () => jam && !jam.publica && jam.membros.length === 1;
  function desenharDentro() {
    $("jam-nome").textContent = jam.nome;
    $("jam-selo").textContent = sozinho() ? "Ouvindo sozinho" : jam.publica ? "Jam pública" : "Jam só com link";
    const dono = jam.membros.find((p) => p.astraId === jam.dono);
    $("jam-quem").textContent = sozinho() ? "Só você escuta. Use Convidar para chamar alguém."
      : `${jam.membros.length} ${jam.membros.length === 1 ? "pessoa" : "pessoas"}${dono ? ` · dono: ${dono.astraId === estado.meuId ? "você" : dono.nome}` : ""}${jam.controle === "dono" ? " · só o dono controla" : ""}`;
    const ul = $("jam-membros");
    ul.innerHTML = "";
    for (const p of jam.membros) {
      const li = document.createElement("li");
      if (p.foto) estado.fotos.set(p.astraId, p.foto);
      const av = avatar(p.nome, p.astraId, false);
      const nome = document.createElement("span"); nome.className = "jam-membro-nome";
      const b = document.createElement("b"); b.textContent = p.nome + (p.astraId === estado.meuId ? " (você)" : "");
      nome.append(b);
      if (p.astraId === jam.dono) {
        const c = document.createElement("small"); c.textContent = "dono"; nome.append(c);
      }
      li.append(av, nome);
      if (typeof seloDispositivo === "function") li.append(seloDispositivo(p));
      if (jam.souDono && p.astraId !== estado.meuId) {
        const tirar = document.createElement("button");
        tirar.type = "button"; tirar.className = "bt-icone jam-tirar";
        tirar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
        tirar.title = `Tirar ${p.nome} da Jam`;
        tirar.setAttribute("aria-label", tirar.title);
        tirar.onclick = () => mandar({ acao: "tirar", id: p.astraId });
        li.append(tirar);
      }
      ul.append(li);
    }
    $("jam-dono-opcoes").hidden = !jam.souDono;
    $("jam-publica").checked = !!jam.publica;
    $("jam-so-dono").checked = jam.controle === "dono";
    $("jam-sair").textContent = sozinho() ? "Parar de ouvir" : "Sair da Jam";
  }

  // ---------- o painel de música (o mesmo da sala) ----------
  function fonteAtual() { return jam ? "jam" : estado.sala ? "sala" : ""; }
  function desenharPainel() {
    const f = fonteAtual();
    $("musica-h3").textContent = f === "jam" ? (sozinho() ? "Sua música" : "Música da Jam") : "Música da sala";
    $("musica-vazia").innerHTML = f === "jam"
      ? (sozinho() ? "Nada tocando.<br>Coloque o nome, o link ou a playlist aqui embaixo." : "Nada tocando na Jam.<br>Coloque uma aqui embaixo: todo mundo da Jam ouve junto.")
      : "Nenhuma música tocando.<br>Coloque uma aqui embaixo: todo mundo da sala ouve junto.";
    $("musica-pausar").dataset.fonte = f;
    if (!pagina.hidden) {
      $("musica-sem-fonte").hidden = !!f;
      if (f) {
        if (painel.parentElement !== vaga) {
          if (abaDireita === "musica") mostrarAbaDireita("chat");   // o painel não fica em dois lugares
          vaga.append(painel);
        }
        painel.hidden = false;
      } else devolverPainel();
      $("pg-musica-sub").textContent = f === "jam" ? (sozinho() ? "Só você escuta. Coloque o nome, o link ou a playlist."
        : "Todo mundo da Jam ouve junto, no mesmo tempo.")
        : f === "sala" ? "Você está numa sala: esta é a música da sala. Crie uma Jam para ouvir separado."
        : "Ouça sozinho ou numa Jam com os amigos, sem precisar de sala.";
    } else devolverPainel();
    desenharMini();
  }
  function devolverPainel() {
    if (painel.parentElement === lugarOriginal.pai) return;
    lugarOriginal.pai.insertBefore(painel, lugarOriginal.antes);
    if (estado.sala) mostrarAbaDireita(abaDireita);   // volta a obedecer às abas da sala
    else painel.hidden = true;                        // fora da sala a coluna mostra só quem está online
  }
  new MutationObserver(desenhar).observe(pagina, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(desenhar).observe($("sala"), { attributes: true, attributeFilter: ["hidden"] });
  // Na sala, clicou na aba Música com a página aberta: fecha a página (o painel volta para a aba).
  $("abas-direita").addEventListener("click", (ev) => {
    if (ev.target.closest('[data-aba="musica"]') && !pagina.hidden) {
      window.astraNav?.ir("inicio");
      setTimeout(() => mostrarAbaDireita("musica"), 0);
    }
  }, true);

  // ---------- ações ----------
  $("jam-sozinho").onclick = () => { if (mandar({ acao: "criar", nome: `Música de ${meuNome() || "você"}`, publica: false })) msg("Abrindo..."); };
  $("jam-nova-bt").onclick = () => {
    const f = $("form-jam");
    f.hidden = !f.hidden;
    $("jam-nova-bt").setAttribute("aria-expanded", String(!f.hidden));
    if (!f.hidden) $("in-jam-nome").focus();
  };
  document.querySelector(".privacidade-2").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-jam-acesso]");
    if (!b) return;
    novaPublica = b.dataset.jamAcesso === "publica";
    marcarRadios(document.querySelector(".privacidade-2"), b.dataset.jamAcesso, "data-jam-acesso");
  });
  $("form-jam").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const nome = $("in-jam-nome").value.trim() || `Jam de ${meuNome() || "você"}`;
    if (mandar({ acao: "criar", nome, publica: novaPublica })) {
      msg("Criando a Jam...");
      $("in-jam-nome").value = "";
      $("form-jam").hidden = true;
      $("jam-nova-bt").setAttribute("aria-expanded", "false");
    }
  });
  $("form-jam-link").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const codigo = codigoDoTexto($("in-jam-link").value);
    if (!codigo) { msg("Esse link não parece um convite de Jam."); return; }
    if (mandar({ acao: "entrar", codigo })) { msg("Entrando..."); $("in-jam-link").value = ""; }
  });
  $("jam-convidar").onclick = () => {
    if (!jam) return;
    copiar(linkJam(jam.codigo), jam.publica ? "Link da Jam copiado." : "Link copiado. Só entra quem tiver este link.");
    document.dispatchEvent(new Event("astra:convidou"));
  };
  $("jam-sair").onclick = () => { if (mandar({ acao: "sair" })) msg(""); };
  $("jam-publica").onchange = () => mandar({ acao: "config", publica: $("jam-publica").checked });
  $("jam-so-dono").onchange = () => mandar({ acao: "config", controle: $("jam-so-dono").checked ? "dono" : "todos" });
  $("jam-novo-link").onclick = () => { if (mandar({ acao: "config", novoLink: true })) aviso({ titulo: "Link novo gerado", texto: "O link antigo não vale mais.", tempo: 4000 }); };

  // ---------- miniplayer ----------
  const mini = $("mini-player");
  const ICONE_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
  const ICONE_PAUSA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>';
  function lugarDoMini() {
    const topo = document.querySelector(".barra-topo");
    const noCelular = matchMedia("(max-width: 860px)").matches;
    if (noCelular && mini.parentElement !== document.body) document.body.append(mini);
    else if (!noCelular && mini.parentElement !== topo) topo.insertBefore(mini, $("bt-correio"));
  }
  matchMedia("(max-width: 860px)").addEventListener("change", lugarDoMini);
  lugarDoMini();
  function desenharMini() {
    const a = musica.atual;
    const mostrar = !!a && !musicaVisivel() && !document.querySelector(".app.cinema");
    mini.hidden = !mostrar;
    document.body.classList.toggle("com-mini", mostrar);
    if (!a) return;
    $("mini-titulo").textContent = a.titulo;
    $("mini-onde").textContent = musicaFonte === "jam" ? (sozinho() ? "Sua música" : `Jam · ${jam ? jam.nome : ""}`) : "Música da sala";
    const capa = a.sc ? (a.capa || "icone-192.png") : `https://i.ytimg.com/vi/${a.video}/mqdefault.jpg`;
    if ($("mini-capa").getAttribute("src") !== capa) $("mini-capa").src = capa;
    const pausado = a.pausadoEm != null;
    $("mini-pausar").innerHTML = pausado ? ICONE_PLAY : ICONE_PAUSA;
    $("mini-pausar").setAttribute("aria-label", pausado ? "Tocar" : "Pausar");
    mini.classList.toggle("pausado", pausado);
    const controla = !(jam && jam.controle === "dono" && !jam.souDono) || musicaFonte !== "jam";
    $("mini-pausar").disabled = !controla;
    $("mini-pular").disabled = !controla;
  }
  window.aoDesenharMusica = desenharMini;
  window.jamSoDonoBloqueia = () => !!(musicaFonte === "jam" && jam && jam.controle === "dono" && !jam.souDono);
  $("mini-pausar").onclick = () => $("musica-pausar").click();
  $("mini-pular").onclick = () => $("musica-pular").click();
  $("mini-abrir").onclick = () => window.astraNav?.ir("musica");
  setInterval(() => {   // barrinha de progresso e "o painel apareceu/sumiu da tela"
    desenharMini();
    if (mini.hidden || !musica.atual || !(musica.duracao > 0)) { $("mini-andou").style.width = "0"; return; }
    const seg = Math.min(musica.duracao, Math.max(0, segundoEsperado()));
    $("mini-andou").style.width = `${(seg / musica.duracao) * 100}%`;
  }, 1000);
  document.addEventListener("visibilitychange", desenharMini);

  desenhar();
  window.astraJam = { estado: () => jam, desenhar };
})();
