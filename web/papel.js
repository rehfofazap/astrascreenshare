// Papel de parede: uma foto atrás do programa, só para quem colocou.
// Nada vai para a VPS nem para os amigos: a foto e o ajuste ficam no IndexedDB do aparelho.
// A foto é desenhada uma vez (sem efeitos animados por cima), então não pesa na transmissão.
(() => {
  "use strict";
  const PADRAO = { x: 50, y: 50, zoom: 100, blur: 0, brilho: 70, painel: 75 };
  let banco = null, atual = null, rascunho = null, urlAtual = "", urlRascunho = "";

  function abrirBanco() {
    return new Promise((ok) => {
      try {
        const r = indexedDB.open("astra-papel", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ok(null);
      } catch (_) { ok(null); }
    });
  }
  async function lerPapel() {
    banco = banco || await abrirBanco();
    if (!banco) return null;
    return new Promise((ok) => {
      try {
        const r = banco.transaction("kv").objectStore("kv").get("papel");
        r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null);
      } catch (_) { ok(null); }
    });
  }
  function gravarPapel(v) {
    if (!banco) return;
    try {
      const os = banco.transaction("kv", "readwrite").objectStore("kv");
      if (v) os.put(v, "papel"); else os.delete("papel");
    } catch (_) {}
  }

  // Foto grande demais vira JPEG de até 2560 px (GIF fica como está, para continuar mexendo).
  async function prepararFoto(arquivo) {
    if (arquivo.type === "image/gif") {
      if (arquivo.size > 15 * 1024 * 1024) throw new Error("GIF muito grande (máximo 15 MB).");
      return arquivo;
    }
    const img = await createImageBitmap(arquivo);
    const escala = Math.min(1, 2560 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
  }

  // Desenha a foto num ".papel-fundo" (o de verdade ou o da prévia).
  function pintar(fundo, url, cfg) {
    const img = fundo.querySelector("img");
    if (img.getAttribute("src") !== url) img.src = url;
    img.style.objectPosition = `${cfg.x}% ${cfg.y}%`;
    img.style.transformOrigin = `${cfg.x}% ${cfg.y}%`;
    img.style.transform = `scale(${cfg.zoom / 100})`;
    img.style.filter = `blur(${cfg.blur}px) brightness(${cfg.brilho / 100})`;
    fundo.hidden = false;
  }

  function aplicar(url, cfg) {
    const raiz = document.documentElement;
    if (!url) {
      $("papel-fundo").hidden = true;
      raiz.classList.remove("com-papel");
      return;
    }
    pintar($("papel-fundo"), url, cfg);
    raiz.classList.add("com-papel");
    raiz.style.setProperty("--papel-painel", cfg.painel + "%");
  }

  function desenharMini() {
    const mini = $("papel-mini");
    mini.style.backgroundImage = urlAtual ? `url("${urlAtual}")` : "";
    mini.classList.toggle("tem", !!urlAtual);
    $("papel-ajustar").hidden = !urlAtual;
    $("papel-tirar").hidden = !urlAtual;
  }

  // ---------- editor ----------
  let voltarConfig = false;
  function abrirEditor(cfg, url) {
    rascunho = { ...PADRAO, ...cfg };
    urlRascunho = url;
    for (const k of ["zoom", "blur", "brilho", "painel"]) $("pp-" + k).value = rascunho[k];
    $("modal-tema").hidden = true;
    // Aberto pelas Configurações: some com elas enquanto ajusta e volta depois.
    voltarConfig = !!$("modal-config") && !$("modal-config").hidden;
    if (voltarConfig) $("modal-config").hidden = true;
    $("papel-editor").hidden = false;
    atualizarEditor();
  }
  function atualizarEditor() {
    pintar($("papel-previa").querySelector(".papel-fundo"), urlRascunho, rascunho);
    $("papel-previa").style.setProperty("--papel-painel", rascunho.painel + "%");
    aplicar(urlRascunho, rascunho);   // o programa inteiro mostra como vai ficar
  }
  function fecharEditor(salvar) {
    $("papel-editor").hidden = true;
    if (salvar) {
      if (urlAtual && urlAtual !== urlRascunho) URL.revokeObjectURL(urlAtual);
      urlAtual = urlRascunho;
      atual = { ...rascunho };
      gravarPapel(atual);
      aviso({ titulo: "Papel de parede salvo", texto: "Só você vê." });
    } else {
      if (urlRascunho && urlRascunho !== urlAtual) URL.revokeObjectURL(urlRascunho);
      aplicar(urlAtual, atual || PADRAO);
    }
    urlRascunho = "";
    desenharMini();
    if (voltarConfig) { voltarConfig = false; $("modal-config").hidden = false; }
  }

  for (const k of ["zoom", "blur", "brilho", "painel"]) {
    $("pp-" + k).addEventListener("input", (ev) => { rascunho[k] = Number(ev.target.value); atualizarEditor(); });
  }
  // Arrastar a foto (na prévia) muda o lugar; a rodinha aproxima.
  const previa = $("papel-previa");
  previa.addEventListener("pointerdown", (ev) => {
    previa.setPointerCapture(ev.pointerId);
    const ini = { px: ev.clientX, py: ev.clientY, x: rascunho.x, y: rascunho.y };
    const r = previa.getBoundingClientRect();
    const mover = (e) => {
      // arrastar para a direita mostra mais da esquerda da foto (como arrastar um papel)
      const fator = 100 / (rascunho.zoom / 100);
      rascunho.x = Math.max(0, Math.min(100, ini.x - (e.clientX - ini.px) / r.width * fator));
      rascunho.y = Math.max(0, Math.min(100, ini.y - (e.clientY - ini.py) / r.height * fator));
      atualizarEditor();
    };
    const soltar = () => { previa.removeEventListener("pointermove", mover); previa.removeEventListener("pointerup", soltar); };
    previa.addEventListener("pointermove", mover);
    previa.addEventListener("pointerup", soltar);
  });
  previa.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    rascunho.zoom = Math.max(100, Math.min(300, rascunho.zoom - Math.sign(ev.deltaY) * 10));
    $("pp-zoom").value = rascunho.zoom;
    atualizarEditor();
  }, { passive: false });

  async function escolheu(arquivo) {
    if (!arquivo || !arquivo.type.startsWith("image/")) return;
    try {
      const foto = await prepararFoto(arquivo);
      const url = URL.createObjectURL(foto);
      const base = $("papel-editor").hidden ? (atual || PADRAO) : rascunho;
      if (!$("papel-editor").hidden && urlRascunho && urlRascunho !== urlAtual) URL.revokeObjectURL(urlRascunho);
      abrirEditor({ ...base, x: 50, y: 50, zoom: 100, foto }, url);
    } catch (e) {
      aviso({ titulo: "Não deu para usar essa foto", texto: e.message || "Tente outra imagem.", tempo: 7000 });
    }
  }

  $("papel-escolher").addEventListener("click", () => $("papel-arquivo").click());
  $("pp-trocar").addEventListener("click", () => $("papel-arquivo").click());
  $("papel-arquivo").addEventListener("change", (ev) => { escolheu(ev.target.files[0]); ev.target.value = ""; });
  $("papel-ajustar").addEventListener("click", () => { if (atual) abrirEditor(atual, urlAtual); });
  $("papel-tirar").addEventListener("click", () => {
    if (urlAtual) URL.revokeObjectURL(urlAtual);
    urlAtual = ""; atual = null;
    gravarPapel(null);
    aplicar("", PADRAO);
    desenharMini();
  });
  $("pp-salvar").addEventListener("click", () => fecharEditor(true));
  $("pp-cancelar").addEventListener("click", () => fecharEditor(false));
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("papel-editor").hidden) { ev.preventDefault(); fecharEditor(false); } });

  // Ao abrir o programa
  lerPapel().then((p) => {
    if (!p || !p.foto) return;
    atual = { ...PADRAO, ...p };
    urlAtual = URL.createObjectURL(p.foto);
    aplicar(urlAtual, atual);
    desenharMini();
  });
})();
