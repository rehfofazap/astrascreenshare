// Chat privado do Astra, criptografado de ponta a ponta.
//
// Cada aparelho cria um par de chaves (ECDH P-256). A chave privada nunca sai do
// aparelho (fica no IndexedDB e nem o próprio programa consegue exportá-la). Para cada
// amigo, as duas chaves geram um segredo que só os dois aparelhos conhecem, e cada
// mensagem vai embaralhada com AES-GCM 256. A VPS só vê "de quem para quem" e um monte
// de letras sem sentido. O histórico fica só no aparelho.
(() => {
  "use strict";
  const sutil = window.crypto && window.crypto.subtle;
  const P = {
    pronto: false, ok: true, eu: null,          // eu = { priv: CryptoKey, x, y }
    contatos: {},                               // id -> { x, y, nome } (chave fixada na 1ª conversa)
    segredos: new Map(),                        // id -> CryptoKey AES-GCM
    pedidos: new Map(),                         // id -> [resolve]
    conversas: {},                              // id -> { nome, msgs: [{id, eu, txt, em, estado}], naoLidas }
    aberta: null,                               // id da conversa na tela (null = lista)
    fotos: new Map(),                           // fotos já lidas do aparelho (id -> dataURL)
    banco: null,
    chegando: new Set(),                        // mensagens sendo abertas agora (evita contar duas vezes)
  };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ---------- guardar no aparelho (IndexedDB; se não der, só na memória) ----------
  function abrirBanco() {
    return new Promise((ok) => {
      try {
        const r = indexedDB.open("astra-privado", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ok(null);
      } catch (_) { ok(null); }
    });
  }
  function lerKv(chave) {
    return new Promise((ok) => {
      if (!P.banco) return ok(undefined);
      try {
        const r = P.banco.transaction("kv").objectStore("kv").get(chave);
        r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined);
      } catch (_) { ok(undefined); }
    });
  }
  function gravarKv(chave, valor) {
    if (!P.banco) return;
    try { P.banco.transaction("kv", "readwrite").objectStore("kv").put(valor, chave); } catch (_) {}
  }
  function apagarKv(chave) {
    if (!P.banco) return;
    try { P.banco.transaction("kv", "readwrite").objectStore("kv").delete(chave); } catch (_) {}
  }
  function apagarGuardados(c) {
    for (const x of c.msgs) { if (x.foto) { apagarKv("foto:" + x.id); P.fotos.delete(x.id); } if (x.modo && !x.eu) apagarKv("some:" + x.id); }
  }
  let gravarDepois = null;
  function gravarConversas() {
    clearTimeout(gravarDepois);
    gravarDepois = setTimeout(() => {
      for (const c of Object.values(P.conversas)) if (c.msgs.length > 500) c.msgs.splice(0, c.msgs.length - 500);
      gravarKv("conversas", P.conversas);
    }, 300);
  }

  // ---------- chaves ----------
  async function iniciar() {
    if (!sutil || P.iniciando) return;
    P.iniciando = true;
    try {
      if (!P.banco) P.banco = await abrirBanco();
      if (!P.eu) {
        let eu = await lerKv("eu:" + estado.meuId);
        if (!eu) {
          const par = await sutil.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
          const pub = await sutil.exportKey("jwk", par.publicKey);
          eu = { priv: par.privateKey, x: pub.x, y: pub.y };
          gravarKv("eu:" + estado.meuId, eu);
        }
        P.eu = eu;
        P.contatos = (await lerKv("contatos")) || {};
        P.conversas = (await lerKv("conversas")) || {};
      }
      P.pronto = true;
      enviar({ t: "pv-chave", x: P.eu.x, y: P.eu.y });   // a VPS manda o que chegou enquanto eu estava fora
      desenharContador();
      if (!$("privado").hidden) desenhar();
    } catch (e) {
      console.warn("chat privado", e);
    } finally {
      P.iniciando = false;
    }
  }

  function chaveDe(id) {
    return new Promise((ok) => {
      const lista = P.pedidos.get(id) || [];
      lista.push(ok);
      P.pedidos.set(id, lista);
      if (lista.length === 1) enviar({ t: "pv-pedir", id });
      setTimeout(() => { if (P.pedidos.get(id) === lista) { P.pedidos.delete(id); for (const f of lista) f(null); } }, 8000);
    });
  }

  // O segredo da conversa com "id". Na primeira vez a chave do amigo fica fixada:
  // se um dia ela mudar, o chat avisa e não manda nada (alguém tentando se passar por ele).
  async function segredoCom(id) {
    if (P.segredos.has(id)) return P.segredos.get(id);
    let ch = P.contatos[id];
    if (!ch) {
      const r = await chaveDe(id);
      if (!r || !r.chave) throw new Error("sem-chave");
      ch = P.contatos[id] = { x: r.chave.x, y: r.chave.y, nome: r.nome || "" };
      gravarKv("contatos", P.contatos);
    }
    const pub = await sutil.importKey("jwk", { kty: "EC", crv: "P-256", x: ch.x, y: ch.y, ext: true },
                                      { name: "ECDH", namedCurve: "P-256" }, false, []);
    const bits = await sutil.deriveBits({ name: "ECDH", public: pub }, P.eu.priv, 256);
    const base = await sutil.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    const sal = enc.encode([estado.meuId, id].sort().join(":"));
    const chave = await sutil.deriveKey({ name: "HKDF", hash: "SHA-256", salt: sal, info: enc.encode("astra-privado-v1") },
                                        base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    P.segredos.set(id, chave);
    return chave;
  }

  // Código de segurança: os dois veem o mesmo número. Se baterem (conferido pessoalmente
  // ou numa ligação), ninguém está no meio da conversa.
  async function codigoCom(id) {
    const ch = P.contatos[id];
    if (!ch || !P.eu) return "";
    const partes = [P.eu.x + P.eu.y, ch.x + ch.y].sort().join("|");
    const h = new Uint8Array(await sutil.digest("SHA-256", enc.encode(partes)));
    let n = "";
    for (let i = 0; i < 6; i++) n += String(((h[i * 2] << 8) | h[i * 2 + 1]) % 100000).padStart(5, "0");
    return n.match(/.{5}/g).join(" ");
  }

  // ---------- mandar e receber ----------
  function conversa(id, nome) {
    const c = P.conversas[id] || (P.conversas[id] = { nome: nome || "", msgs: [], naoLidas: 0 });
    if (nome) c.nome = nome;
    return c;
  }

  // CL: apaga a conversa inteira nos DOIS aparelhos. O pedido vai criptografado como
  // uma mensagem comum (a VPS não sabe que é um CL); se o amigo estiver offline, apaga
  // quando ele entrar.
  async function darCl(id) {
    if (!P.pronto) return;
    const c = conversa(id);
    try {
      await mandarCifrado(id, { cl: true, e: Date.now() }, "cl" + Math.random().toString(36).slice(2, 10));
    } catch (_) {
      aviso({ titulo: "Não deu para mandar o CL", texto: "Tente de novo daqui a pouco." });
      return;
    }
    apagarGuardados(c);
    c.msgs = [{ id: "cl", eu: true, sistema: true, txt: "Você deu CL: a conversa foi apagada nos dois aparelhos.", em: Date.now() }];
    c.naoLidas = 0;
    gravarConversas(); desenhar(); desenharContador();
  }

  async function cifrar(id, obj) {
    const chave = await segredoCom(id);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await sutil.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(estado.meuId + ">" + id) },
                                   chave, enc.encode(JSON.stringify(obj)));
    // 3.0.5: pk = para qual chave do amigo foi embaralhada. Se ele trocou de chave (atualizou o
    // Astra / trocou de aparelho), a VPS devolve a nova e a mensagem é refeita (ver "pv-erro").
    return { iv: b64(iv), ct: b64(ct), pk: P.contatos[id] ? P.contatos[id].x : undefined };
  }

  // 3.0.5: manda uma mensagem embaralhada e guarda o original por 1 minuto, para refazer se a
  // chave do amigo tiver mudado.
  const pendentes = new Map();   // id da mensagem -> { para, obj, extra }
  async function mandarCifrado(para, obj, mid, extra = {}) {
    const { iv, ct, pk } = await cifrar(para, obj);
    pendentes.set(mid, { para, obj, extra });
    setTimeout(() => pendentes.delete(mid), 60000);
    enviar({ t: "pv", para, iv, ct, id: mid, pk, ...extra });
  }

  // 3.0.5: a chave de um amigo mudou: fixa a nova e avisa na conversa (como o "código de
  // segurança mudou" do WhatsApp).
  function chaveMudou(id, nova, nome, antesDe) {
    if (!nova || !nova.x || !nova.y) return false;
    const antes = P.contatos[id];
    if (antes && antes.x === nova.x && antes.y === nova.y) return false;
    P.contatos[id] = { x: nova.x, y: nova.y, nome: nome || (antes && antes.nome) || "" };
    P.segredos.delete(id);
    gravarKv("contatos", P.contatos);
    if (antes) {
      const c = conversa(id, nome);
      const aviso = { id: "chave" + Date.now(), eu: false, sistema: true, em: Date.now(),
                      txt: `🔑 A chave de segurança de ${c.nome || "seu amigo"} mudou (atualizou o Astra ou trocou de aparelho).` };
      const i = antesDe ? c.msgs.findIndex((x) => x.eu && x.id === antesDe) : -1;
      if (i >= 0) { aviso.em = c.msgs[i].em; c.msgs.splice(i, 0, aviso); } else c.msgs.push(aviso);
      gravarConversas();
    }
    return true;
  }

  // 3.0.5: quem veio do programa antigo (Electron) para o 3.x ficou com uma chave nova e a VPS só
  // aceitava a primeira: as mensagens privadas não abriam mais. Agora o dono da conta pode passar
  // o chat privado para este aparelho (no app de PC acontece sozinho, uma vez).
  function usarEsteAparelho() {
    if (!P.eu) return;
    guardar("astra.pvTrocou." + estado.meuId, "1");
    enviar({ t: "pv-chave", x: P.eu.x, y: P.eu.y, trocar: true });
  }

  // Mensagens que somem: "1" e "2" = quantas vezes dá para abrir; "30" = 30 segundos abertas.
  const MODOS = { "": "Normal", "1": "Ver 1 vez", "2": "Ver 2 vezes", "30": "30 segundos" };

  // texto e/ou foto (dataURL JPEG). Mensagem que some não fica guardada no aparelho de quem manda.
  async function mandar(id, texto, foto = "", modo = "") {
    texto = (texto || "").trim().slice(0, 2000);
    if ((!texto && !foto) || !P.pronto) return;
    const c = conversa(id);
    const msg = { id: Math.random().toString(36).slice(2, 12), eu: true, txt: modo ? "" : texto, em: Date.now(), estado: "enviando" };
    if (modo) { msg.modo = modo; msg.tipo = foto ? "foto" : "texto"; }
    else if (foto) { msg.foto = true; gravarKv("foto:" + msg.id, foto); P.fotos.set(msg.id, foto); }
    c.msgs.push(msg);
    desenhar();
    try {
      await mandarCifrado(id, { x: texto, f: foto || undefined, v: modo || undefined, e: msg.em }, msg.id, foto ? { foto: 1 } : {});
      setTimeout(() => { if (msg.estado === "enviando") { msg.estado = "erro"; desenhar(); } }, foto ? 30000 : 10000);
    } catch (e) {
      msg.estado = e.message === "sem-chave" ? "sem-chave" : "erro";
    }
    gravarConversas();
    desenhar();
  }

  // Avisa quem mandou que a mensagem que some foi aberta (também criptografado).
  async function avisarAberta(id, mid, restam) {
    try { await mandarCifrado(id, { aberta: mid, restam }, "ab" + Math.random().toString(36).slice(2, 10)); } catch (_) {}
  }

  async function recebeu(m) {
    if (!P.pronto || !/^\d{9}$/.test(m.de || "")) return;
    const c = conversa(m.de, m.nome);
    if (c.msgs.some((x) => x.id === m.id && !x.eu)) return;
    // A mesma mensagem pode chegar duas vezes quase juntas (fila de entrega + ao vivo): sem isto,
    // as duas passavam pela checagem acima antes de abrir e o contador contava em dobro.
    const vista = m.de + ":" + m.id;
    if (P.chegando.has(vista)) return;
    P.chegando.add(vista);
    setTimeout(() => P.chegando.delete(vista), 60000);
    let txt = "", em = m.em, cl = false, d = {};
    const abrirMsg = async () => {
      const chave = await segredoCom(m.de);
      const claro = await sutil.decrypt({ name: "AES-GCM", iv: deB64(m.iv), additionalData: enc.encode(m.de + ">" + estado.meuId) },
                                        chave, deB64(m.ct));
      return JSON.parse(dec.decode(claro)) || {};
    };
    try {
      try {
        d = await abrirMsg();
      } catch (e1) {
        // 3.0.5: não abriu com a chave guardada: o amigo pode ter trocado de chave (atualizou o
        // Astra). Pergunta a chave dele de agora à VPS e tenta mais uma vez.
        const r = await chaveDe(m.de);
        if (!r || !chaveMudou(m.de, r.chave, m.nome)) throw e1;
        d = await abrirMsg();
      }
      txt = String(d.x || "").slice(0, 2000);
      cl = d.cl === true;
    } catch (e) {
      txt = "";   // não abriu: chave trocada ou mensagem mexida no caminho
    }
    if (d.aberta) {   // o amigo abriu uma mensagem que some que eu mandei
      const minha = c.msgs.find((x) => x.eu && x.id === String(d.aberta));
      if (minha) { minha.estado = d.restam > 0 ? "aberta1" : "aberta"; gravarConversas(); desenhar(); }
      return;
    }
    if (cl) {   // o amigo deu CL: some tudo deste lado também
      apagarGuardados(c);
      c.msgs = [{ id: m.id, eu: false, sistema: true, txt: `${c.nome || "Seu amigo"} deu CL: a conversa foi apagada.`, em }];
      c.naoLidas = 0;
      gravarConversas(); desenharContador(); desenhar();
      return;
    }
    const foto = typeof d.f === "string" && d.f.startsWith("data:image/jpeg;base64,") ? d.f : "";
    const modo = MODOS[d.v] && d.v ? d.v : "";
    if (modo) {
      // guardada à parte e apagada de vez quando acabarem as vezes
      gravarKv("some:" + m.id, { x: txt, f: foto });
      c.msgs.push({ id: m.id, eu: false, txt: "", em, modo, tipo: foto ? "foto" : "texto", restam: modo === "2" ? 2 : 1 });
    } else if (foto) {
      gravarKv("foto:" + m.id, foto); P.fotos.set(m.id, foto);
      c.msgs.push({ id: m.id, eu: false, txt, em, foto: true });
    } else {
      c.msgs.push({ id: m.id, eu: false, txt, em, falhou: !txt });
    }
    const vendo = !$("privado").hidden && P.aberta === m.de && document.hasFocus() && !document.hidden;
    if (!vendo) {
      c.naoLidas = (c.naoLidas || 0) + 1;
      const novas = c.msgs.slice(-c.naoLidas);
      for (const x of novas) if (!x.eu) x.nova = true;   // marca para aparecer diferente até ser vista
      // O aviso não mostra o texto: a mensagem é sigilosa.
      aviso({ titulo: `Mensagem privada de ${c.nome || "um amigo"}`, texto: "Clique para abrir.", windows: true,
              classe: "aviso-privado", aoClicar: () => { programa?.mostrar?.(); abrir(m.de); } });
    }
    gravarConversas();
    desenharContador();
    desenhar();
  }

  TRATAR.pv = recebeu;
  TRATAR["pv-ok"] = (m) => {
    pendentes.delete(m.id);
    for (const c of Object.values(P.conversas)) {
      const msg = c.msgs.find((x) => x.eu && x.id === m.id);
      if (msg) { msg.estado = m.entregue ? "entregue" : "esperando"; gravarConversas(); desenhar(); return; }
    }
  };
  TRATAR["pv-erro"] = async (m) => {
    // 3.0.5: a VPS recusou porque a chave do amigo mudou: fixa a nova e manda de novo (refeita).
    const p = pendentes.get(m.id);
    if (m.chave_nova && p && !p.refeita && chaveMudou(p.para, m.chave_nova, "", m.id)) {
      p.refeita = true;
      try {
        const { iv, ct, pk } = await cifrar(p.para, p.obj);
        enviar({ t: "pv", para: p.para, iv, ct, id: m.id, pk, ...p.extra });
        desenhar();
        return;
      } catch (_) {}
    }
    pendentes.delete(m.id);
    for (const c of Object.values(P.conversas)) {
      const msg = c.msgs.find((x) => x.eu && x.id === m.id);
      if (msg) { msg.estado = "erro"; msg.erro = m.msg; desenhar(); }
    }
  };
  TRATAR["pv-chave"] = (m) => {
    const lista = P.pedidos.get(m.id) || [];
    P.pedidos.delete(m.id);
    for (const f of lista) f(m);
  };
  TRATAR["pv-minha"] = (m) => {
    P.ok = !!m.ok;
    // 3.0.5: no app de PC (o aparelho principal de quase todo mundo) a chave nova passa a valer
    // sozinha, uma vez. No site e no celular aparece o botão "Usar o chat privado aqui".
    if (!P.ok && m.pode_trocar && typeof programa !== "undefined" && programa && programa.miniJanela
        && !ler("astra.pvTrocou." + estado.meuId)) usarEsteAparelho();
    if (!$("privado").hidden) desenhar();
  };
  const prontoAntes = TRATAR.pronto;
  TRATAR.pronto = function (m) { prontoAntes.call(this, m); iniciar(); };
  if (estado.conexao) iniciar();   // a VPS respondeu antes deste arquivo carregar

  // ---------- tela ----------
  const ICONE_BALAO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 4h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8l-4 3.5V15a2 2 0 0 1-1-1.7V6a2 2 0 0 1 2-2Zm16 4h1a2 2 0 0 1 2 2v7.3a2 2 0 0 1-1 1.7V22l-4-3.5h-6a2 2 0 0 1-1.7-1H15a4 4 0 0 0 4-4V8Z"/></svg>';
  const ICONE_CADEADO = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3Z"/></svg>';

  function infoOnline(id) { return estado.online.find((p) => p.astraId === id); }
  function hora(ms) {
    const d = new Date(ms), hoje = new Date();
    const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === hoje.toDateString() ? h : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + h;
  }

  function abrir(id, nome) {
    if (id === estado.meuId) return;
    if (window.astraTrava && astraTrava.precisa("privado")) { astraTrava.pedir(() => abrir(id, nome)); return; }
    if (id) { const c = conversa(id, nome); c.naoLidas = 0; gravarConversas(); }
    P.aberta = id || null;
    $("privado").hidden = false;
    desenharContador();
    desenhar();
    if (id) limparNovas(id);
    if (id) setTimeout(() => $("pv-texto")?.focus(), 30);
  }
  function fechar() { $("privado").hidden = true; P.aberta = null; }
  // Depois de vistas, as mensagens novas deixam de ser "novas" (o destaque some no próximo desenho).
  function limparNovas(id) {
    setTimeout(() => {
      const c = P.conversas[id];
      if (!c || P.aberta !== id || $("privado").hidden) return;
      let mudou = false;
      for (const x of c.msgs) if (x.nova) { delete x.nova; mudou = true; }
      if (mudou) gravarConversas();
    }, 2500);
  }
  // A conversa estava aberta, mas a janela sem foco (mensagem chegou e contou como não lida):
  // ao voltar para a janela com ela na tela, conta como vista.
  function viuAgora() {
    if (document.hidden || !document.hasFocus() || $("privado").hidden || !P.aberta) return;
    const c = P.conversas[P.aberta];
    if (!c || !c.naoLidas) return;
    c.naoLidas = 0;
    gravarConversas(); desenharContador(); desenhar();
    limparNovas(P.aberta);
  }
  window.addEventListener("focus", viuAgora);
  document.addEventListener("visibilitychange", viuAgora);

  function desenharContador() {
    const n = Object.values(P.conversas).reduce((s, c) => s + (c.naoLidas || 0), 0);
    const b = $("pv-contador");
    if (b) { b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n); }
  }

  // 2.7.33: os Grupos ficam dentro de Mensagens (abas "Conversas" e "Grupos", no mesmo lugar)
  function abasMensagens(atual) {
    const d = document.createElement("div");
    d.className = "msg-abas"; d.setAttribute("role", "tablist");
    const num = (e) => (e && !e.hidden ? (parseInt(e.textContent, 10) || 0) + (/\+/.test(e.textContent) ? 1 : 0) : 0);
    for (const [id, nome, n] of [["conversas", "Conversas", num($("pv-contador"))], ["grupos", "Grupos", num($("trilho-gr"))]]) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "msg-aba" + (id === atual ? " on" : "");
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(id === atual));
      b.textContent = nome;
      if (n && id !== atual) { const c = document.createElement("span"); c.className = "msg-aba-n"; c.textContent = n > 9 ? "9+" : String(n); b.append(c); }
      b.onclick = () => {
        if (id === atual) return;
        if (id === "grupos") window.astraGrupos?.abrir();
        else { window.astraGrupos?.fechar(); if ($("privado").hidden) $("bt-privado").click(); }
      };
      d.append(b);
    }
    return d;
  }
  window.abasMensagens = abasMensagens;

  function desenhar() {
    const caixa = $("privado");
    if (!caixa || caixa.hidden) return;
    const topo = $("pv-topo"), corpo = $("pv-corpo"), rodape = $("pv-form");
    topo.innerHTML = ""; corpo.innerHTML = "";
    const fecharBt = document.createElement("button");
    fecharBt.className = "pv-bt"; fecharBt.type = "button"; fecharBt.title = "Fechar"; fecharBt.textContent = "✕";
    fecharBt.onclick = fechar;

    if (!P.aberta) {
      // ----- lista de conversas -----
      topo.append(abasMensagens("conversas"), fecharBt);
      rodape.hidden = true;
      if (!sutil) { corpo.append(texto("pv-vazio", "Este aparelho não tem criptografia: o chat privado não funciona aqui.")); return; }
      corpo.append(caixaPrivacidade());
      const conversas = Object.entries(P.conversas).filter(([, c]) => c.msgs.length)
        .sort((a, b) => b[1].msgs[b[1].msgs.length - 1].em - a[1].msgs[a[1].msgs.length - 1].em);
      for (const [id, c] of conversas) corpo.append(itemConversa(id, c));
      // Amigos online para começar uma conversa nova
      const comConversa = new Set(conversas.map(([id]) => id));
      const online = estado.online.filter((p) => p.astraId !== estado.meuId && !comConversa.has(p.astraId));
      if (online.length) {
        const h = document.createElement("h4"); h.textContent = conversas.length ? "Começar com quem está online" : "Escolha um amigo para conversar";
        corpo.append(h);
        for (const p of online) corpo.append(itemConversa(p.astraId, { nome: p.nome, msgs: [] }));
      }
      if (!conversas.length && !online.length) corpo.append(texto("pv-vazio", "Ninguém online agora. Quando um amigo entrar, ele aparece aqui."));
      return;
    }

    // ----- uma conversa -----
    const id = P.aberta, c = conversa(id), p = infoOnline(id);
    const voltar = document.createElement("button");
    voltar.className = "pv-bt"; voltar.type = "button"; voltar.title = "Voltar"; voltar.textContent = "‹";
    voltar.onclick = () => { P.aberta = null; desenhar(); };
    const av = avatar(c.nome, id, false);
    if (p) pontoStatus(av, p.st);
    const nome = document.createElement("span"); nome.className = "pv-nome";
    const b = document.createElement("b"); b.textContent = c.nome || "Amigo";
    const s = document.createElement("small"); s.textContent = p ? (STATUS[p.st] || STATUS.on).nome : "Offline: recebe quando entrar";
    nome.append(b, s);
    const apagar = document.createElement("button");
    apagar.className = "pv-bt pv-cl"; apagar.type = "button"; apagar.textContent = "CL";
    apagar.title = "Dar CL: apaga a conversa inteira nos dois aparelhos";
    apagar.onclick = () => aviso({ titulo: `Dar CL na conversa com ${c.nome}?`, texto: "Apaga todas as mensagens no seu aparelho e no dele.", tempo: 10000,
      botoes: [{ texto: "Dar CL", acao: () => darCl(id) }, { texto: "Cancelar" }] });
    topo.append(voltar, av, nome, apagar, fecharBt);

    const selo = document.createElement("button");
    selo.type = "button"; selo.className = "pv-selo";
    selo.innerHTML = ICONE_CADEADO + "<span>Só vocês dois podem ler. O Astra não lê nem anota seu IP.</span>";
    selo.onclick = async () => {
      const cod = await codigoCom(id);
      aviso({ titulo: cod ? `Código de segurança: ${cod}` : "Código de segurança", tempo: 15000,
              texto: cod ? `Peça para ${c.nome} abrir o código também. Se for igual, a conversa é só de vocês.` : "Mande uma mensagem primeiro." });
    };
    corpo.append(selo);
    if (!P.ok) {
      const alerta = texto("pv-alerta", "Este aparelho tem uma chave nova e o chat privado desta conta está em outro lugar. As mensagens novas para você não abrem aqui. ");
      const usar = document.createElement("button");
      usar.type = "button"; usar.className = "pv-bt pv-usar"; usar.textContent = "Usar o chat privado neste aparelho";
      usar.onclick = () => aviso({ titulo: "Passar o chat privado para este aparelho?", tempo: 12000,
        texto: "As mensagens novas passam a abrir aqui. O outro aparelho (ou o programa antigo) para de abrir as novas. Seus amigos veem que a sua chave mudou.",
        botoes: [{ texto: "Usar aqui", acao: usarEsteAparelho }, { texto: "Cancelar" }] });
      alerta.append(usar);
      corpo.append(alerta);
    }
    let dia = "", marcouNovas = false;
    for (const msg of c.msgs) {
      const d = new Date(msg.em).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
      if (d !== dia) { dia = d; corpo.append(texto("pv-dia", d)); }
      if (msg.sistema) { corpo.append(texto("pv-sistema", msg.txt)); continue; }
      // Linha "Novas" antes das que chegaram enquanto você não estava olhando (some depois de vistas).
      if (msg.nova && !marcouNovas) { marcouNovas = true; corpo.append(texto("pv-novas", "Novas")); }
      const linha = document.createElement("div");
      linha.className = "pv-msg" + (msg.eu ? " minha" : "") + (msg.falhou ? " falhou" : "") + (msg.nova ? " nova" : "");
      const balao = document.createElement("div"); balao.className = "pv-balao";
      if (msg.modo) desenharSome(balao, msg, id);
      else if (msg.foto) desenharFoto(balao, msg);
      else balao.textContent = msg.falhou ? "Não deu para abrir esta mensagem (a chave não bate)." : msg.txt;
      if (msg.foto && msg.txt) { const t = document.createElement("div"); t.textContent = msg.txt; balao.append(t); }
      const info = document.createElement("small");
      info.textContent = hora(msg.em) + (msg.eu ? " · " + ({
        enviando: "enviando...", entregue: "entregue", esperando: "chega quando entrar", aberta: "aberta", aberta1: "aberta 1 vez",
        erro: msg.erro || "não foi, tente de novo", "sem-chave": "precisa atualizar o Astra" })[msg.estado || "entregue"] : "");
      linha.append(balao, info);
      corpo.append(linha);
    }
    if (!c.msgs.filter((x) => !x.sistema).length) corpo.append(texto("pv-vazio", `Diga oi para ${c.nome || "seu amigo"}.`));
    rodape.hidden = false;
    corpo.scrollTop = corpo.scrollHeight;
  }

  const ICONE_OLHO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 2.5A4.5 4.5 0 1 0 12 16.5 4.5 4.5 0 0 0 12 7.5Zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/></svg>';
  const ICONE_FOTO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9.6l3.5-3.5 3 3 4-4.5L19 15V6H5Zm4 1.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z"/></svg>';

  async function desenharFoto(balao, msg) {
    balao.classList.add("pv-com-foto");
    const img = document.createElement("img");
    img.alt = "Foto"; img.className = "pv-foto";
    balao.append(img);
    let url = P.fotos.get(msg.id);
    if (!url) { url = await lerKv("foto:" + msg.id); if (url) P.fotos.set(msg.id, url); }
    if (url) { img.src = url; img.onclick = () => verAgora({ f: url }, 0, null); }
    else img.replaceWith(texto("pv-sumiu", "Foto apagada"));
  }

  function desenharSome(balao, msg, conversaId) {
    balao.classList.add("pv-some");
    const rotulo = MODOS[msg.modo];
    const oque = msg.tipo === "foto" ? "Foto" : "Mensagem";
    if (msg.eu) {
      balao.innerHTML = ICONE_OLHO + "<span></span>";
      balao.querySelector("span").textContent = `${oque} · ${rotulo}`;
      return;
    }
    if (!msg.restam) {
      balao.classList.add("aberta");
      balao.innerHTML = ICONE_OLHO + "<span></span>";
      balao.querySelector("span").textContent = `${oque} aberta`;
      return;
    }
    const bt = document.createElement("button");
    bt.type = "button"; bt.className = "pv-abrir-some";
    bt.innerHTML = ICONE_OLHO + "<span><b></b><small></small></span>";
    bt.querySelector("b").textContent = `Toque para ver a ${oque.toLowerCase()}`;
    bt.querySelector("small").textContent = msg.modo === "30" ? "Fica aberta 30 segundos" : msg.restam === 2 ? "Dá para abrir 2 vezes" : "Dá para abrir 1 vez";
    bt.onclick = () => abrirSome(conversaId, msg);
    balao.append(bt);
  }

  // Gravador da NVIDIA ligado? Ele grava mesmo com o bloqueio do Windows, então não abre.
  async function nvidiaLigada() {
    if (!programa?.gravadorNvidia) return false;
    try { return !!(await programa.gravadorNvidia()); } catch (_) { return false; }
  }
  function avisoNvidia(tentar) {
    if (fecharVisor) fecharVisor();
    const v = document.createElement("div");
    v.className = "pv-visor pv-nvidia";
    v.innerHTML = '<div class="pv-visor-topo"><span></span><button type="button" class="pv-bt" title="Fechar">✕</button></div>'
      + '<div class="pv-visor-corpo"><p class="pv-visor-texto">Desligue o gravador da NVIDIA para abrir</p>'
      + '<p class="pv-nvidia-passos">O gravador da NVIDIA (Instant Replay, Alt+F9) consegue gravar mesmo com o bloqueio.<br>'
      + 'Abra o NVIDIA App, vá em <b>Configurações</b> e desligue a <b>Sobreposição NVIDIA</b>.<br>A mensagem não conta como vista.</p>'
      + '<button type="button" class="pv-nvidia-tentar">Já desliguei, abrir</button></div>';
    const fim = () => { v.remove(); fecharVisor = null; };
    fecharVisor = fim;
    v.querySelector(".pv-bt").onclick = fim;
    v.querySelector(".pv-nvidia-tentar").onclick = () => { fim(); tentar(); };
    document.body.append(v);
  }

  async function abrirSome(conversaId, msg) {
    if (await nvidiaLigada()) return avisoNvidia(() => abrirSome(conversaId, msg));
    const dados = await lerKv("some:" + msg.id);
    if (!dados) { msg.restam = 0; gravarConversas(); desenhar(); return; }
    verAgora(dados, msg.modo === "30" ? 30 : 0, () => {
      msg.restam = msg.modo === "30" ? 0 : Math.max(0, (msg.restam || 1) - 1);
      if (!msg.restam) apagarKv("some:" + msg.id);
      gravarConversas(); desenhar();
      avisarAberta(conversaId, msg.id, msg.restam);
    });
  }

  // Visualizador: tela cheia, sem print nem gravação (PC e celular) enquanto está aberto.
  let fecharVisor = null;
  function verAgora(dados, segundos, aoFechar) {
    if (fecharVisor) fecharVisor();
    const visor = document.createElement("div");
    visor.className = "pv-visor";
    visor.innerHTML = '<div class="pv-visor-topo"><span class="pv-visor-tempo"></span><button type="button" class="pv-bt" title="Fechar">✕</button></div><div class="pv-visor-corpo"></div><p class="pv-visor-aviso"></p>';
    const corpo = visor.querySelector(".pv-visor-corpo");
    if (dados.f) { const img = document.createElement("img"); img.src = dados.f; img.alt = ""; img.draggable = false; corpo.append(img); }
    if (dados.x) { const t = document.createElement("p"); t.className = "pv-visor-texto"; t.textContent = dados.x; corpo.append(t); }
    // nick de quem está vendo, apagadinho por cima: se alguém fotografar ou gravar, fica marcado
    const marca = document.createElement("div");
    marca.className = "pv-visor-marca"; marca.setAttribute("aria-hidden", "true");
    marca.textContent = ((estado.nome || "Astra") + "   ").repeat(160);
    visor.append(marca);
    visor.querySelector(".pv-visor-aviso").textContent = programa?.protegerTela
      ? "Print e gravação de tela bloqueados enquanto isto está aberto." : "";
    visor.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.append(visor);
    programa?.protegerTela?.(true);
    let relogio = 0;
    // ligou o gravador da NVIDIA com a mensagem aberta: fecha na hora
    const vigia = programa?.gravadorNvidia ? setInterval(async () => { if (await nvidiaLigada() && fecharVisor === fim) fim(); }, 2000) : 0;
    const fim = () => {
      clearInterval(relogio); clearInterval(vigia);
      visor.remove();
      fecharVisor = null;
      programa?.protegerTela?.(false);
      if (aoFechar) aoFechar();
    };
    fecharVisor = fim;
    visor.querySelector(".pv-bt").onclick = fim;
    visor.addEventListener("keydown", (e) => { if (e.key === "Escape") fim(); });
    const tempo = visor.querySelector(".pv-visor-tempo");
    if (segundos) {
      let resta = segundos;
      const pinta = () => { tempo.textContent = `Some em ${resta} s`; visor.style.setProperty("--resta", `${(resta / segundos) * 100}%`); };
      pinta();
      visor.classList.add("com-tempo");
      relogio = setInterval(() => { resta--; if (resta <= 0) fim(); else pinta(); }, 1000);
    } else if (aoFechar) {
      tempo.textContent = "Some quando fechar";
    }
    visor.tabIndex = -1; visor.focus();
  }
  // escondeu o programa com uma mensagem que some aberta: fecha (conta como vista)
  document.addEventListener("visibilitychange", () => { if (document.hidden && fecharVisor) fecharVisor(); });

  // ---------- escrever: foto e "some" ----------
  let modoAtual = "";
  const barra = document.createElement("div");
  barra.className = "pv-ferramentas";
  barra.innerHTML = `<button type="button" class="pv-ferr pv-bt-foto" title="Mandar foto">${ICONE_FOTO}</button>
    <button type="button" class="pv-ferr pv-bt-some" title="Mensagem que some">${ICONE_OLHO}<span></span></button>
    <input type="file" accept="image/*" hidden>`;
  $("pv-form").prepend(barra);
  const menuSome = document.createElement("div");
  menuSome.className = "pv-menu-some";
  menuSome.hidden = true;
  for (const [v, nome] of Object.entries(MODOS)) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.v = v;
    b.innerHTML = "<b></b><small></small>";
    b.querySelector("b").textContent = nome;
    b.querySelector("small").textContent = { "": "Fica na conversa", "1": "Some depois de aberta", "2": "Some depois da 2ª vez", "30": "Some 30 s depois de aberta" }[v];
    b.onclick = () => { modoAtual = v; menuSome.hidden = true; desenharModo(); $("pv-texto").focus(); };
    menuSome.append(b);
  }
  $("pv-form").append(menuSome);
  function desenharModo() {
    const bt = barra.querySelector(".pv-bt-some");
    bt.classList.toggle("ligado", !!modoAtual);
    bt.querySelector("span").textContent = { "": "", "1": "1x", "2": "2x", "30": "30s" }[modoAtual];
    $("pv-texto").placeholder = modoAtual ? `Some: ${MODOS[modoAtual].toLowerCase()}` : "Mensagem privada";
    menuSome.querySelectorAll("button").forEach((b) => b.classList.toggle("ativo", b.dataset.v === modoAtual));
  }
  barra.querySelector(".pv-bt-some").onclick = (e) => { e.stopPropagation(); menuSome.hidden = !menuSome.hidden; };
  document.addEventListener("click", (e) => { if (!menuSome.hidden && !menuSome.contains(e.target)) menuSome.hidden = true; });
  const arquivo = barra.querySelector("input");
  barra.querySelector(".pv-bt-foto").onclick = () => arquivo.click();
  arquivo.onchange = async () => {
    const f = arquivo.files[0]; arquivo.value = "";
    if (!f || !P.aberta) return;
    let foto;
    try { foto = await reduzirFoto(f); }
    catch (_) { aviso({ titulo: "Não deu para usar essa foto", texto: "Tente outra imagem." }); return; }
    previaFoto(P.aberta, foto);
  };

  // Prévia antes de mandar (igual ao WhatsApp): vê a foto, escolhe se some, escreve uma legenda e envia.
  function previaFoto(para, foto) {
    const velha = $("privado").querySelector(".pv-previa");
    if (velha) velha.remove();
    let modo = modoAtual;
    const tela = document.createElement("div");
    tela.className = "pv-previa";
    const topo = document.createElement("div");
    topo.className = "pv-previa-topo";
    const cancelar = document.createElement("button");
    cancelar.type = "button"; cancelar.className = "pv-previa-x"; cancelar.title = "Cancelar (Esc)"; cancelar.setAttribute("aria-label", "Cancelar");
    cancelar.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4Z"/></svg>';
    const tit = document.createElement("b"); tit.textContent = "Enviar foto";
    topo.append(cancelar, tit);
    const img = document.createElement("img");
    img.className = "pv-previa-img"; img.alt = "Prévia da foto"; img.src = foto;
    const modos = document.createElement("div");
    modos.className = "pv-previa-modos";
    modos.setAttribute("role", "radiogroup"); modos.setAttribute("aria-label", "Como a foto fica na conversa");
    const opcoes = [["", "Normal"], ["1", "1 vez"], ["2", "2 vezes"], ["30", "30 s"]];   // array: chaves "1","2" iriam na frente num objeto
    const dica = document.createElement("small");
    dica.className = "pv-previa-dica";
    const pintar = () => {
      modos.querySelectorAll("button").forEach((b) => { const sim = b.dataset.v === modo; b.classList.toggle("ativo", sim); b.setAttribute("aria-checked", String(sim)); });
      dica.textContent = modo ? "Some depois de aberta. Print e gravação ficam bloqueados no app." : "Fica guardada na conversa.";
      tela.classList.toggle("some", !!modo);
    };
    for (const [v, nome] of opcoes) {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.v = v; b.setAttribute("role", "radio");
      b.innerHTML = v ? ICONE_OLHO + "<span></span>" : "<span></span>";
      b.querySelector("span").textContent = nome;
      b.onclick = () => { modo = v; pintar(); };
      modos.append(b);
    }
    const baixo = document.createElement("div");
    baixo.className = "pv-previa-baixo";
    const legenda = document.createElement("input");
    legenda.className = "pv-previa-legenda"; legenda.maxLength = 500; legenda.placeholder = "Legenda (opcional)"; legenda.autocomplete = "off";
    const ir = document.createElement("button");
    ir.type = "button"; ir.className = "pv-enviar"; ir.title = "Enviar"; ir.setAttribute("aria-label", "Enviar");
    ir.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 20.5V14l9-2-9-2V3.5L22 12 3 20.5Z"/></svg>';
    baixo.append(legenda, ir);
    tela.append(topo, img, modos, dica, baixo);
    const fechar = () => { tela.remove(); document.removeEventListener("keydown", tecla, true); };
    const enviarJa = () => { fechar(); mandar(para, legenda.value.trim(), foto, modo); };
    const tecla = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(); }
      else if (e.key === "Enter" && !e.shiftKey && tela.contains(document.activeElement)) { e.preventDefault(); enviarJa(); }
    };
    document.addEventListener("keydown", tecla, true);
    cancelar.onclick = fechar;
    ir.onclick = enviarJa;
    pintar();
    $("privado").append(tela);
    legenda.focus();
  }
  // Foto vira JPEG de até 1600 px (cabe na mensagem criptografada).
  async function reduzirFoto(f) {
    const img = await createImageBitmap(f);
    for (const [lado, q] of [[1600, 0.82], [1280, 0.75], [960, 0.7], [720, 0.6]]) {
      const e = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * e); c.height = Math.round(img.height * e);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", q);
      if (url.length < 600000) return url;
    }
    throw new Error("grande");
  }
  desenharModo();

  // No topo da lista: o que a VPS (não) guarda e a trava com PIN, que só existe aqui.
  function caixaPrivacidade() {
    const caixa = document.createElement("div");
    caixa.className = "pv-privacidade";
    const linha = document.createElement("p");
    linha.innerHTML = ICONE_CADEADO + "<span>Criptografado entre os aparelhos: o servidor só repassa. As conversas ficam <b>salvas neste aparelho</b>.</span>";
    const trava = document.createElement("button");
    trava.type = "button";
    trava.className = "pv-trava";
    const ligada = !!(window.astraTrava && astraTrava.ativa());
    trava.innerHTML = `<span><b>Trava com PIN</b><small>${ligada ? "Pede o PIN para abrir este chat" : "Pede um PIN para abrir este chat"}</small></span><i class="pv-chave${ligada ? " ligada" : ""}" aria-hidden="true"></i>`;
    trava.setAttribute("role", "switch");
    trava.setAttribute("aria-checked", String(ligada));
    trava.onclick = () => {
      if (!window.astraTrava) return;
      if (astraTrava.ativa()) astraTrava.desligar(desenhar); else astraTrava.ligar(desenhar);
    };
    caixa.append(linha, trava);
    // Testar o bloqueio de print/gravação (OBS, NVIDIA, AMD, Xbox, Discord): abre um visor de teste.
    if (programa?.protegerTela) {
      const teste = document.createElement("button");
      teste.type = "button"; teste.className = "link-discreto pv-testar";
      teste.textContent = "Testar bloqueio de print e gravação";
      const testar = async () => {
        if (await nvidiaLigada()) return avisoNvidia(testar);
        verAgora({ x: "Teste do bloqueio. Grave ou tire print agora (AMD Ctrl+Shift+E, Xbox Win+Alt+R, OBS, Discord). No vídeo esta tela tem que sair preta." }, 30, null);
      };
      teste.onclick = testar;
      caixa.append(teste);
    }
    return caixa;
  }

  function texto(classe, t) { const el = document.createElement("p"); el.className = classe; el.textContent = t; return el; }

  function itemConversa(id, c) {
    const bt = document.createElement("button");
    bt.type = "button"; bt.className = "pv-item";
    const p = infoOnline(id);
    const av = avatar(c.nome, id, p && p.transmitindo);
    pontoStatus(av, p ? p.st : "inv");
    const nome = document.createElement("span"); nome.className = "pv-nome";
    const b = document.createElement("b"); b.textContent = c.nome || (p && p.nome) || "Amigo";
    const s = document.createElement("small");
    const ultima = c.msgs[c.msgs.length - 1];
    const resumo = (u) => u.modo ? (u.tipo === "foto" ? "Foto que some" : "Mensagem que some") : u.foto ? "Foto" : u.falhou ? "mensagem que não abriu" : u.txt;
    s.textContent = ultima ? (ultima.sistema ? ultima.txt : (ultima.eu ? "Você: " : "") + resumo(ultima)) : "Toque para conversar";
    nome.append(b, s);
    bt.append(av, nome);
    bt.classList.toggle("nao-lida", !!c.naoLidas);
    if (c.naoLidas) {
      const n = document.createElement("span"); n.className = "pv-nlidas";
      n.textContent = c.naoLidas > 9 ? "9+" : String(c.naoLidas);
      n.setAttribute("aria-label", `${c.naoLidas} não ${c.naoLidas === 1 ? "lida" : "lidas"}`);
      bt.append(n);
    }
    bt.onclick = () => abrir(id, c.nome || (p && p.nome));
    return bt;
  }

  // Balãozinho ao lado de cada amigo (lista de online e da sala).
  function botao(li, id, nome) {
    if (!id || id === estado.meuId || !sutil) return;
    const bt = document.createElement("button");
    bt.type = "button"; bt.className = "pv-abrir"; bt.title = `Mensagem privada para ${nome}`;
    bt.setAttribute("aria-label", bt.title);
    bt.innerHTML = ICONE_BALAO;
    bt.onclick = (ev) => { ev.stopPropagation(); abrir(id, nome); };
    li.append(bt);
  }

  $("pv-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const campo = $("pv-texto");
    if (P.aberta && campo.value.trim()) { mandar(P.aberta, campo.value, "", modoAtual); campo.value = ""; }
  });
  $("pv-texto").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $("pv-form").requestSubmit(); }
    if (ev.key === "Escape") fechar();
  });
  $("bt-privado").addEventListener("click", () => ($("privado").hidden ? abrir(null) : fechar()));
  // a lista muda quando alguém entra ou sai
  const onlineAntes = TRATAR.online;
  TRATAR.online = function (m) { onlineAntes.call(this, m); desenhar(); };

  window.astraPrivado = { botao, abrir };
})();
