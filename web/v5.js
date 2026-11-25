// Astra v5: página inicial nova (faixa, salas ativas em cards, comunidade em carrossel),
// barra lateral com nomes (o logo recolhe/expande), submenu de Jogos, página Salas,
// janela Criar sala com banner opcional e a música no centro quando ninguém transmite.
// Só usa o que já existe no app.js (estado, enviar, entrarNaSala, musica...): nada é simulado.
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const raiz = document.documentElement;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const ic = (d, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${d}</svg>`;
  const IC = {
    globo: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    cadeado: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    aprova: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
    pessoas: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    entrar: '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    discord: '<path d="M9 12h.01M15 12h.01"/><path d="M7.5 7.5c3-1 6-1 9 0M7 16.5c3.3 1.3 6.7 1.3 10 0"/><path d="M15.5 17c0 1 1.5 3 2 3 1.5 0 2.83-1.67 3.5-3 .67-1.67.5-5.83-1.5-11.5-1.457-1.015-3-1.34-4.5-1.5l-.972 1.923a11.913 11.913 0 0 0-4.053 0L9 4c-1.5.16-3.043.485-4.5 1.5-2 5.667-2.167 9.833-1.5 11.5.667 1.333 2 3 3.5 3 .5 0 2-2 2-3"/>',
    tocar: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pausar: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    pular: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
    som: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    mudo: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    nota: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    jogo: '<rect x="3" y="3" width="18" height="18" rx="4"/>',
  };
  const naSala = () => !$("sala").hidden;
  const conectado = () => !!(estado.ws && estado.ws.readyState === WebSocket.OPEN);
  const celular = () => matchMedia("(max-width: 860px)").matches;

  // ---------- barra lateral: o seu perfil no pé, a versão no topo ----------
  const trilho = $("trilho");
  const rodape = document.querySelector(".painel-usuario");
  // no PC o rodapé (avatar, nick, status, configurações) vai para o pé da barra; no celular fica na coluna
  const lateral = $("lateral");
  function lugarDoRodape() {
    if (!trilho || !rodape) return;
    if (celular()) { if (rodape.parentElement !== lateral) lateral.append(rodape); }
    else if (rodape.parentElement !== trilho) trilho.insertBefore(rodape, $("trilho-voce"));
  }
  matchMedia("(max-width: 860px)").addEventListener("change", lugarDoRodape);
  lugarDoRodape();
  // versão no topo da barra: a do programa no PC; no navegador, "versão web"
  const versao = $("trilho-versao");
  if (versao) versao.textContent = MINHA_VERSAO ? `v${MINHA_VERSAO}` : "versão web";

  // dentro da sala a coluna da sala (membros, desempenho, conexão) aparece; fora, o início ocupa tudo
  const recado = $("recado-astra");
  function lugarDoRecado() {
    const sala = naSala();
    raiz.classList.toggle("v5-na-sala", sala);
    if (!recado) return;
    if (sala) { const info = $("info-sala"); if (recado.previousElementSibling !== info) info.after(recado); }
    else if (recado.parentElement !== $("v5-recado-casa")) $("v5-recado-casa").append(recado);
  }
  new MutationObserver(lugarDoRecado).observe($("sala"), { attributes: true, attributeFilter: ["hidden"] });
  lugarDoRecado();

  // botão da barra que esconde/mostra a coluna da sala (membros, desempenho, conexão); fica lembrado
  const btColuna = $("trilho-coluna");
  function pintarColuna() {
    const sem = raiz.classList.contains("v5-sem-sala");
    btColuna.hidden = !naSala() || celular();
    btColuna.setAttribute("aria-pressed", String(sem));
    const rot = sem ? "Mostrar a coluna da sala" : "Esconder a coluna da sala";
    btColuna.setAttribute("aria-label", rot); btColuna.dataset.rotulo = rot; btColuna.title = rot;
    btColuna.classList.toggle("ativo-suave", sem);
  }
  try { if (localStorage.getItem("astra.semColunaSala") === "1") raiz.classList.add("v5-sem-sala"); } catch (_) {}
  btColuna.addEventListener("click", () => {
    const sem = !raiz.classList.contains("v5-sem-sala");
    raiz.classList.toggle("v5-sem-sala", sem);
    try { localStorage.setItem("astra.semColunaSala", sem ? "1" : "0"); } catch (_) {}
    pintarColuna();
  });
  new MutationObserver(pintarColuna).observe($("sala"), { attributes: true, attributeFilter: ["hidden"] });
  pintarColuna();

  // ---------- submenu de Jogos (os minigames que existem; abre o que já está instalado) ----------
  const subJogos = $("trilho-jogos"), abreJogos = $("trilho-jogos-abre");
  function desenharSubJogos() {
    subJogos.textContent = "";
    const meus = extrasInstalados();
    for (const x of extrasDisponiveis) {
      const li = el("li");
      const b = el("button", "trilho-sub-bt");
      b.type = "button";
      const tem = meus.includes(x.id);
      b.innerHTML = ic(ICONE_EXTRA[x.id] || IC.jogo, 16);
      b.append(el("span", "", x.nome), el("small", "", tem ? "" : "instalar"));
      b.onclick = () => {
        if (tem && ABRIR_EXTRA[x.id] && abrirExtra(x.id)) return;
        astraNav.ir("jogos");
      };
      li.append(b);
      subJogos.append(li);
    }
    const li = el("li");
    const todos = el("button", "trilho-sub-bt trilho-sub-todos", "Ver todos os jogos");
    todos.type = "button";
    todos.onclick = () => astraNav.ir("jogos");
    li.append(todos);
    subJogos.append(li);
  }
  function abrirSubJogos(sim) {
    abreJogos.setAttribute("aria-expanded", String(sim));
    abreJogos.setAttribute("aria-label", sim ? "Esconder os jogos" : "Mostrar os jogos");
    subJogos.hidden = !sim;
    $("trilho-grupo-jogos").classList.toggle("aberto", sim);
    if (!sim) return;
    desenharSubJogos();
    if (!extrasDisponiveis.length && conectado()) {
      enviar({ t: "modulos", lista: extrasInstalados() });
      setTimeout(() => { if (!subJogos.hidden) desenharSubJogos(); }, 1200);
    }
  }
  abreJogos.addEventListener("click", (e) => { e.stopPropagation(); abrirSubJogos(subJogos.hidden); });
  // barra recolhida: o submenu não cabe; fecha
  new MutationObserver(() => { if (raiz.classList.contains("nav-recolhida")) abrirSubJogos(false); })
    .observe(raiz, { attributes: true, attributeFilter: ["class"] });

  // ---------- cards das salas ----------
  // Banners padrão (monocromáticos), escolhidos pelo ID da sala para cada sala ter sempre o mesmo.
  const CENAS = [
    // lua sobre as montanhas
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2b30"/><stop offset="1" stop-color="#0c0c0e"/></linearGradient><radialGradient id="l" cx=".72" cy=".3" r=".3"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="480" height="200" fill="url(#c)"/><rect width="480" height="200" fill="url(#l)"/><circle cx="345" cy="62" r="24" fill="#e9e9ec"/><circle cx="335" cy="56" r="22" fill="#2b2b30" opacity=".18"/><path d="M0 150 90 92 150 128 230 70 320 136 400 98 480 140V200H0Z" fill="#1c1c20"/><path d="M0 172 120 128 210 160 300 120 390 164 480 138V200H0Z" fill="#111114"/><g fill="#fff" opacity=".7"><circle cx="60" cy="40" r="1"/><circle cx="140" cy="24" r="1.2"/><circle cx="210" cy="50" r=".8"/><circle cx="420" cy="30" r="1"/><circle cx="270" cy="22" r=".9"/></g></svg>',
    // templo com lanternas
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3f"/><stop offset="1" stop-color="#101012"/></linearGradient></defs><rect width="480" height="200" fill="url(#c)"/><circle cx="120" cy="58" r="40" fill="#fff" opacity=".07"/><g fill="#18181b"><path d="M150 70h180l-22 14H172Z"/><rect x="176" y="84" width="128" height="8"/><path d="M168 104h144l-16 10H184Z"/><rect x="196" y="114" width="12" height="62"/><rect x="272" y="114" width="12" height="62"/><rect x="224" y="124" width="32" height="52"/><path d="M0 176h480v24H0Z"/></g><g fill="#f4f4f5"><ellipse cx="186" cy="132" rx="6" ry="8" opacity=".85"/><ellipse cx="294" cy="132" rx="6" ry="8" opacity=".85"/></g><g fill="#fff" opacity=".18"><circle cx="186" cy="132" r="18"/><circle cx="294" cy="132" r="18"/></g></svg>',
    // árvore sob o céu estrelado
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f2f34"/><stop offset="1" stop-color="#0b0b0d"/></linearGradient></defs><rect width="480" height="200" fill="url(#c)"/><g fill="#fff"><circle cx="40" cy="30" r="1.2" opacity=".8"/><circle cx="110" cy="62" r=".9" opacity=".6"/><circle cx="190" cy="20" r="1.1" opacity=".7"/><circle cx="380" cy="44" r="1.3" opacity=".8"/><circle cx="440" cy="16" r=".8" opacity=".6"/><circle cx="300" cy="70" r="1" opacity=".5"/></g><path d="M0 168c80-14 160-14 240-6s160 6 240-4v42H0Z" fill="#161619"/><g fill="#0f0f11"><rect x="300" y="110" width="9" height="62"/><circle cx="304" cy="96" r="30"/><circle cx="282" cy="110" r="20"/><circle cx="328" cy="108" r="22"/></g></svg>',
  ];
  const urlCena = (i) => `url("data:image/svg+xml,${encodeURIComponent(CENAS[i % CENAS.length])}")`;
  const numeroDe = (id) => [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  let meuBanner = "";
  try { meuBanner = localStorage.getItem("astra.bannerSala") || ""; } catch (_) {}
  // 2.7.33: banner só como imagem de verdade (base64 de webp/jpeg/png/gif). Antes bastava começar com
  // "data:image/" e dava para enfiar um segundo endereço no CSS e pegar o IP de quem via a lista.
  const BANNER_OK = /^data:image\/(webp|jpeg|png|gif);base64,[A-Za-z0-9+/=]+$/;
  function bannerDe(s) {
    if (s.banner && typeof s.banner === "string" && s.banner.length < 3_000_000) {
      if (BANNER_OK.test(s.banner)) return `url("${s.banner}")`;
      if (/^[\w\/.?=&-]+$/.test(s.banner)) return `url("${enderecoImagem(s.banner)}")`;
    }
    if (s.id === estado.meuId && BANNER_OK.test(meuBanner)) return `url("${meuBanner}")`;   // a sua: o servidor ainda não guarda o banner
    // 2.7.23: sala sem banner próprio usa a capa do perfil de quem criou (se tiver)
    const dono = (s.membros || []).find((m) => m && m.nome === s.dono);
    const pd = dono && perfilDe(dono.astraId);
    const capa = pd && urlMidia("capa", dono.astraId, pd.k);
    if (capa) return `url("${capa}")`;
    return urlCena(numeroDe(s.id));
  }
  const ACESSO = {
    publica: { nome: "Pública", ic: IC.globo },
    senha: { nome: "Protegida", ic: IC.cadeado },
    aprovacao: { nome: "Com aprovação", ic: IC.aprova },
  };
  function cardSala(s) {
    const li = el("li", "v5-card");
    const bt = el("button", "v5-card-bt");
    bt.type = "button";
    const banner = el("span", "v5-card-banner");
    banner.style.backgroundImage = bannerDe(s);
    if (s.aoVivo) {
      const vivo = el("span", "v5-vivo", "AO VIVO");
      vivo.title = s.aoVivo === 1 ? "1 pessoa ao vivo" : `${s.aoVivo} pessoas ao vivo`;
      banner.append(vivo);
    }
    const corpo = el("span", "v5-card-corpo");
    const topo = el("span", "v5-card-topo");
    const nome = el("b", "v5-card-nome", s.nome);
    nome.title = s.nome;
    const a = s.fixa ? { nome: "Discord", ic: IC.discord } : ACESSO[s.acesso] || ACESSO.publica;
    const priv = el("span", "v5-priv");
    priv.innerHTML = ic(a.ic, 13);
    priv.append(a.nome);
    topo.append(nome, priv);
    const pe = el("span", "v5-card-pe");
    const rostos = el("span", "v5-rostos");
    for (const p of (s.membros || []).slice(0, 4)) rostos.append(avatar(p.nome, p.astraId, false));
    const qtd = el("span", "v5-qtd");
    qtd.innerHTML = ic(IC.pessoas, 14);
    qtd.append(s.pessoas === 0 ? "vazia" : s.pessoas === 1 ? "1 participante" : `${s.pessoas} participantes`);
    const entrar = el("span", "v5-entrar");
    let rot = "Entrar";
    if (s.id === estado.sala) { rot = "Voltar"; li.classList.add("aqui"); }
    else if (estado.esperando === s.id) { rot = "Esperando..."; bt.disabled = true; }
    else if (s.id === estado.meuId) rot = "Voltar";
    else if (!s.fixa && s.acesso === "aprovacao") rot = "Pedir";
    entrar.innerHTML = ic(IC.entrar, 15);
    entrar.prepend(rot);
    pe.append(rostos, qtd, entrar);
    corpo.append(topo, pe);
    bt.append(banner, corpo);
    bt.setAttribute("aria-label", `${s.nome}, ${a.nome}, ${qtd.textContent}${s.aoVivo ? ", ao vivo" : ""}. ${rot}`);
    bt.onclick = () => (s.id === estado.sala ? astraNav.ir("sala") : entrarNaSala(s.id));
    li.dataset.sala = s.id; li.dataset.salaNome = s.nome; if (s.fixa) li.dataset.salaFixa = "1";   // botão direito (amigos.js)
    li.append(bt);
    return li;
  }
  function vazioSalas(todas) {
    const li = el("li", "v5-card v5-card-vazio");
    const b = el("button", "v5-card-bt");
    b.type = "button";
    b.innerHTML = ic('<path d="M5 12h14"/><path d="M12 5v14"/>', 22);
    b.append(el("b", "", "Nenhuma sala aberta agora"), el("small", "", todas ? "Crie a primeira e chame os amigos." : "Crie a sua e chame os amigos."));
    b.onclick = abrirCriar;
    li.append(b);
    return li;
  }
  function desenharCards(salas) {
    const casa = $("v5-salas-ativas"), todas = $("v5-salas-todas");
    casa.textContent = ""; todas.textContent = "";
    for (const s of salas.slice(0, 4)) casa.append(cardSala(s));
    for (const s of salas) todas.append(cardSala(s));
    if (!salas.length) { casa.append(vazioSalas(false)); todas.append(vazioSalas(true)); }
    $("v5-ver-todas").hidden = salas.length <= 3;
    const q = $("trilho-salas-qtd");
    q.hidden = !salas.length;
    q.textContent = salas.length > 99 ? "99+" : String(salas.length || "");
    $("pg-salas-sub").textContent = !salas.length ? "Nenhuma sala aberta agora."
      : salas.length === 1 ? "1 sala aberta agora. Clique para entrar." : `${salas.length} salas abertas agora. Clique para entrar.`;
  }

  // ---------- comunidade: cartõezinhos de perfil passando sem parar ----------
  function cartaoPessoa(p) {
    const v = visualDe(p.id, p.nome);
    const c = el("span", "v5-pessoa");
    c.setAttribute("role", "listitem");
    if (v.capa) c.style.setProperty("--capa", v.capa);
    if (v.cor) c.style.setProperty("--cor", v.cor);
    const av = avatar(p.nome, p.id, false);
    const txt = el("span", "v5-pessoa-txt");
    const b = el("b", "", p.nome);
    txt.append(b);
    if (v.recado) txt.append(el("small", "", v.recado));
    else if (v.apoiador) txt.append(el("small", "", "Apoiador"));
    c.append(av, txt);
    c.title = p.nome;
    return c;
  }
  function desenharComunidade(pessoas) {
    const trilha = $("vitrine-trilha");
    trilha.textContent = "";
    const lista = pessoas.slice(0, 40);
    // repete até encher bem a faixa e duplica: a animação anda metade e volta sem emenda
    let volta = [...lista];
    while (volta.length < 10) volta = volta.concat(lista);
    for (const p of volta) trilha.append(cartaoPessoa(p));
    for (const p of volta) { const c = cartaoPessoa(p); c.setAttribute("aria-hidden", "true"); trilha.append(c); }
    trilha.style.setProperty("--dur", `${Math.max(24, volta.length * 3.2)}s`);
  }

  // ---------- janela Criar sala ----------
  const modal = $("modal-criar");
  let antesDeAbrir = null;
  function abrirCriar() {
    antesDeAbrir = document.activeElement;
    $("criar-msg").textContent = "";
    modal.hidden = false;
    setTimeout(() => $("in-nome-sala").focus(), 30);
  }
  function fecharCriar() {
    modal.hidden = true;
    if (antesDeAbrir && antesDeAbrir.focus) antesDeAbrir.focus();
  }
  $("v5-criar").onclick = abrirCriar;
  $("v5-criar-2").onclick = abrirCriar;
  $("v5-explorar").onclick = () => astraNav.ir("salas");
  $("v5-ver-todas").onclick = () => astraNav.ir("salas");
  $("criar-fechar").onclick = fecharCriar;
  $("criar-cancelar").onclick = fecharCriar;
  modal.addEventListener("click", (e) => { if (e.target === modal) fecharCriar(); });
  modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); fecharCriar(); } });
  // os avisos do criar (senha curta, sem conexão, erro do servidor) aparecem também na janela
  new MutationObserver(() => { if (!modal.hidden) $("criar-msg").textContent = $("msg-inicio").textContent; })
    .observe($("msg-inicio"), { childList: true, characterData: true, subtree: true });
  // entrou na sala: fecha a janela
  new MutationObserver(() => { if (naSala() && !modal.hidden) fecharCriar(); })
    .observe($("sala"), { attributes: true, attributeFilter: ["hidden"] });

  // banner opcional: reduzido aqui mesmo (960x360, WebP) para ficar leve
  let bannerNovo = "";
  const inBanner = $("in-banner-sala");
  function mostrarBanner() {
    const img = $("criar-banner-img");
    img.style.backgroundImage = bannerNovo ? `url("${bannerNovo}")` : urlCena(numeroDe(estado.meuId || "0"));
    $("criar-banner").classList.toggle("com-banner", !!bannerNovo);
    $("criar-banner-tirar").hidden = !bannerNovo;
  }
  $("criar-banner").onclick = () => inBanner.click();
  $("criar-banner-tirar").onclick = () => { bannerNovo = ""; inBanner.value = ""; mostrarBanner(); };
  inBanner.addEventListener("change", () => {
    const f = inBanner.files && inBanner.files[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { $("criar-msg").textContent = "Imagem grande demais (máx. 15 MB)."; return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const L = 960, A = 360;
      const cv = document.createElement("canvas");
      cv.width = L; cv.height = A;
      const g = cv.getContext("2d");
      const esc = Math.max(L / img.naturalWidth, A / img.naturalHeight);
      const w = img.naturalWidth * esc, h = img.naturalHeight * esc;
      g.drawImage(img, (L - w) / 2, (A - h) / 2, w, h);
      URL.revokeObjectURL(url);
      let q = .82, d = cv.toDataURL("image/webp", q);
      while (d.length > 180_000 && q > .4) { q -= .12; d = cv.toDataURL("image/webp", q); }
      if (!/^data:image\/webp/.test(d)) d = cv.toDataURL("image/jpeg", .8);
      bannerNovo = d;
      $("criar-msg").textContent = "";
      mostrarBanner();
    };
    img.onerror = () => { URL.revokeObjectURL(url); $("criar-msg").textContent = "Não deu para abrir essa imagem."; };
    img.src = url;
  });
  mostrarBanner();
  // O banner vai junto do pedido de criar (o servidor novo guarda e mostra para todos; o antigo
  // simplesmente ignora o campo). A sua cópia fica neste aparelho para o seu card.
  const enviarAntes = window.enviar;
  window.enviar = function (m) {
    if (m && m.t === "criar" && !m.volta && !modal.hidden) {
      meuBanner = bannerNovo;
      try { if (bannerNovo) localStorage.setItem("astra.bannerSala", bannerNovo); else localStorage.removeItem("astra.bannerSala"); } catch (_) {}
      if (bannerNovo) m.banner = bannerNovo;
    }
    return enviarAntes.apply(this, arguments);
  };

  // ---------- música no centro (quando ninguém está transmitindo) ----------
  const palco = $("palco"), vazio = $("vazio");
  const mc = el("div", "v5-musica-centro");
  mc.id = "v5-musica-centro";
  mc.hidden = true;
  mc.setAttribute("role", "region");
  mc.setAttribute("aria-label", "Música tocando");
  mc.innerHTML = `
    <span class="v5-mc-fundo" aria-hidden="true"></span>
    <div class="v5-mc-capa"><img alt="" id="v5-mc-capa"><span class="v5-mc-capa-vazia" aria-hidden="true">${ic(IC.nota, 46)}</span></div>
    <div class="v5-mc-info">
      <span class="v5-mc-onde" id="v5-mc-onde"></span>
      <b class="v5-mc-titulo" id="v5-mc-titulo"></b>
      <span class="v5-mc-artista" id="v5-mc-artista"></span>
      <div class="v5-mc-tempo"><span id="v5-mc-t1">0:00</span><span class="v5-mc-trilha"><i id="v5-mc-andou"></i></span><span id="v5-mc-t2">0:00</span></div>
      <div class="v5-mc-controles">
        <button type="button" class="v5-mc-bt v5-mc-tocar" id="v5-mc-pausar" aria-label="Pausar"></button>
        <button type="button" class="v5-mc-bt" id="v5-mc-pular" aria-label="Pular para a próxima">${ic(IC.pular, 18)}</button>
        <span class="v5-mc-som">
          <button type="button" class="v5-mc-bt v5-mc-mudo" id="v5-mc-mudo" aria-label="Silenciar só para você"></button>
          <input type="range" min="0" max="100" step="1" id="v5-mc-volume" aria-label="Volume (só para você)">
        </span>
      </div>
    </div>`;
  palco.append(mc);
  const mm = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function desenharCentro() {
    const a = musica.atual;
    const mostrar = !!a && naSala() && !vazio.hidden;
    mc.hidden = !mostrar;
    palco.classList.toggle("v5-com-musica", mostrar);
    document.body.classList.toggle("v5-musica-no-centro", mostrar);
    if (!mostrar) return;
    // 2.7.33: capa só de endereço https limpo (sem aspas/parênteses que escapem do url() do CSS)
    const capaLimpa = (u) => (typeof u === "string" && /^https:\/\/[^\s"'()\\<>]+$/i.test(u) ? u : "");
    const capa = !a.sc ? (/^[\w-]{6,20}$/.test(a.video || "") ? `https://i.ytimg.com/vi/${a.video}/hqdefault.jpg` : "") : capaLimpa(a.capa);
    const img = $("v5-mc-capa");
    if (img.getAttribute("src") !== capa) {
      img.hidden = true;
      if (capa) { img.onload = () => { img.hidden = false; }; img.onerror = () => { img.hidden = true; }; img.src = capa; }
      else img.removeAttribute("src");
      mc.querySelector(".v5-mc-fundo").style.backgroundImage = capa ? `url("${capa}")` : "";
    }
    $("v5-mc-titulo").textContent = a.titulo || "";
    $("v5-mc-artista").textContent = a.canal || "";
    const pausado = a.pausadoEm != null;
    $("v5-mc-onde").textContent = (pausado ? "Pausada · " : "Tocando agora · ") + (musicaFonte === "jam" ? "Jam" : "música da sala");
    mc.classList.toggle("pausada", pausado);
    const bp = $("v5-mc-pausar");
    bp.innerHTML = ic(pausado ? IC.tocar : IC.pausar, 20);
    bp.setAttribute("aria-label", pausado ? "Tocar para todos" : "Pausar para todos");
    const mudo = musica.mudo || musica.volume === 0;
    const bm = $("v5-mc-mudo");
    bm.innerHTML = ic(mudo ? IC.mudo : IC.som, 18);
    bm.setAttribute("aria-label", mudo ? "Tirar o silêncio" : "Silenciar só para você");
    bm.classList.toggle("ligado", mudo);
    const vol = $("v5-mc-volume");
    if (document.activeElement !== vol) vol.value = mudo ? 0 : musica.volume;
    vol.style.setProperty("--cheio", `${mudo ? 0 : musica.volume}%`);
    // quem controla: na Jam com "só o dono" e você não é o dono, os botões ficam travados
    const j = window.astraJam && astraJam.estado();
    const controla = musicaFonte !== "jam" || !(j && j.controle === "dono" && !j.souDono);
    bp.disabled = !controla; $("v5-mc-pular").disabled = !controla;
    const dur = musica.duracao || 0, seg = Math.min(dur || Infinity, Math.max(0, segundoEsperado()));
    $("v5-mc-t1").textContent = mm(seg);
    $("v5-mc-t2").textContent = dur ? mm(dur) : "--:--";
    $("v5-mc-andou").style.width = dur ? `${(seg / dur) * 100}%` : "0";
  }
  $("v5-mc-pausar").onclick = () => $("musica-pausar").click();
  $("v5-mc-pular").onclick = () => $("musica-pular").click();
  $("v5-mc-mudo").onclick = () => {
    // volume 0 conta como mudo: tirar o mudo assim volta para um volume audível
    if (!musica.mudo && musica.volume === 0) { const v = $("musica-volume"); v.value = 50; v.dispatchEvent(new Event("input")); }
    else $("musica-mudo").click();
    desenharCentro();
  };
  $("v5-mc-volume").addEventListener("input", (e) => {
    const v = $("musica-volume");
    v.value = e.target.value;
    v.dispatchEvent(new Event("input"));   // o mesmo caminho da barra do painel (guarda e manda para o player; 0 = mudo)
    desenharCentro();
  });
  const desenharMiniAntes = window.aoDesenharMusica;
  window.aoDesenharMusica = function () { if (desenharMiniAntes) desenharMiniAntes(); desenharCentro(); };
  new MutationObserver(desenharCentro).observe(vazio, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(desenharCentro).observe($("sala"), { attributes: true, attributeFilter: ["hidden"] });
  setInterval(() => { if (!mc.hidden || musica.atual) desenharCentro(); }, 1000);

  // ---------- pronto: liga com o app.js e desenha o que já chegou ----------
  window.astraV5 = { salas: desenharCards, comunidade: desenharComunidade, abrirCriar };
  desenharCards([...estado.salas].sort((a, b) => (b.fixa - a.fixa) || (b.aoVivo - a.aoVivo) || (b.pessoas - a.pessoas) || a.nome.localeCompare(b.nome)));
  if (estado.vitrineLista) mostrarVitrine(estado.vitrineLista);
  desenharCentro();
})();
