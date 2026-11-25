// 2026-11-17: "Ver no Astra" do Astra Perfil (astrascreenshare.com/<nome>).
// https://astrascreenshare.com/app/?perfil-de=<nome do perfil> -> abre o cartão do Astra da conta ligada àquele perfil,
// desenhado pelo próprio app (montarCartao), numa janelinha no meio da tela. Não manda nada para o servidor do Astra:
// os dados vêm de /perfil/api/p/<nome>/astra (só existe se a pessoa deixou o botão "Ver no Astra" ligado no perfil).
(() => {
  "use strict";
  if (typeof montarCartao !== "function" || typeof visualDe !== "function") return;
  let slug = "";
  try {
    const q = new URLSearchParams(location.search);
    slug = (q.get("perfil-de") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
    if (q.has("perfil-de")) {
      q.delete("perfil-de");
      const resto = q.toString();
      history.replaceState(null, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
    }
  } catch (_) {}
  if (!slug) return;

  // o CSP do app não aceita <style> no meio da página: o estilo vem do perfil-link.css (index.html)

  function abrir(d) {
    const id = String(d.id || "");
    if (!/^\d{9}$/.test(id)) return;
    if (d.foto && /^[0-9a-f]+$/.test(d.foto) && id !== estado.meuId) estado.fotos.set(id, d.foto);
    if (id !== estado.meuId && d.perfil && typeof d.perfil === "object") guardarPerfilDe(id, d.perfil);
    const v = visualDe(id, String(d.nome || "").slice(0, 32) || "Astra");
    const fundo = document.createElement("div");
    fundo.className = "perfil-link-fundo";
    fundo.setAttribute("role", "dialog");
    fundo.setAttribute("aria-modal", "true");
    fundo.setAttribute("aria-label", "Perfil de " + v.nome);
    const caixa = document.createElement("div");
    caixa.className = "perfil-link-caixa";
    const cartao = montarCartao(v);
    const fechar = document.createElement("button");
    fechar.type = "button"; fechar.className = "perfil-link-fechar"; fechar.textContent = "Fechar";
    const sair = () => { fundo.remove(); removeEventListener("keydown", esc); };
    const esc = (e) => { if (e.key === "Escape") sair(); };
    fechar.onclick = sair;
    fundo.addEventListener("click", (e) => { if (e.target === fundo) sair(); });
    addEventListener("keydown", esc);
    caixa.append(cartao, fechar);
    fundo.append(caixa);
    document.body.append(fundo);
    fechar.focus();
  }

  fetch("/perfil/api/p/" + encodeURIComponent(slug) + "/astra", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r)))
    .then((d) => {
      // espera a tela do app ficar pronta (escolher o nick na 1ª vez vem antes)
      const inicio = Date.now();
      const tentar = () => {
        const nomeAberto = document.getElementById("modal-nome") && !document.getElementById("modal-nome").hidden;
        if (nomeAberto && Date.now() - inicio < 5 * 60e3) return void setTimeout(tentar, 500);
        abrir(d);
      };
      setTimeout(tentar, 400);
    })
    .catch(() => { try { aviso({ titulo: "Não deu para abrir esse perfil", texto: "O perfil não mostra a conta do Astra.", tempo: 5000 }); } catch (_) {} });
})();
