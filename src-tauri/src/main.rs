// AstraScreenShare - programa de PC (Tauri).
//
// Fica rodando perto do relógio (bandeja do Windows), fica online para os amigos acharem você,
// volta sozinho para a última sala e avisa quando alguém começa a transmitir. A janela é o mesmo
// site da pasta web/. Substitui o programa em Electron (main.js/preload.js da 2.7.36): as mesmas
// funções, as mesmas regras de segurança e a mesma atualização assinada.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ambiguidade;
mod atualizar;
mod electron;
mod fontes;
mod janelas;
mod sistema;
mod som;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{PageLoadEvent, PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

// Endereços fixos no programa instalado (2.7.33). Só a versão de teste (feature "teste") aceita
// ASTRA_SITE/ASTRA_SERVIDOR, para apontar para o staging.
fn site() -> String {
    #[cfg(feature = "teste")]
    if let Ok(s) = std::env::var("ASTRA_SITE") {
        return s;
    }
    "https://astrascreenshare.com/app/".into()
}
fn servidor() -> String {
    #[cfg(feature = "teste")]
    if let Ok(s) = std::env::var("ASTRA_SERVIDOR") {
        return s;
    }
    "wss://astrascreenshare.com/ws".into()
}
const ORIGEM: &str = "http://tauri.localhost";
const TOQUE_VALE: Duration = Duration::from_secs(20);
// 3.0.27: depois de a pessoa liberar o microfone com um clique, a call pode voltar sozinha (internet caiu
// e voltou) sem clicar de novo durante este tempo.
const MIC_VOLTA_VALE: Duration = Duration::from_secs(30 * 60);

#[derive(Clone)]
pub struct Escolha {
    pub fonte: fontes::Fonte,
    pub som: String,
    pub em: Instant,
}

#[derive(Default)]
pub struct Capturando {
    pub tela: String,
    pub som: bool,
    pub teclas: bool,
}

pub struct Estado {
    eventos: Mutex<Option<Channel<Value>>>,
    capturando: Mutex<Capturando>,
    transmitindo: AtomicBool,
    captura_em: Mutex<Option<Instant>>,
    escolha: Mutex<Option<Escolha>>,
    ultimo_som: Mutex<Option<Escolha>>,
    ultimas_fontes: Mutex<Vec<fontes::Fonte>>,
    ultima_lista: Mutex<Option<Instant>>,
    pub tela_da_live: Mutex<Option<(i32, i32, i32, i32)>>,
    pub protegido: AtomicBool,
    pub visor_aberto: AtomicBool,
    toque_bandeja: Mutex<Option<Instant>>,
    mic_liberado: Mutex<Option<Instant>>,
    avisou_segundo_plano: AtomicBool,
    saindo: AtomicBool,
    minimizada: AtomicBool,
    maximizada: AtomicBool,
    pub focada: AtomicBool,
    tecla_emergencia: Mutex<String>,
    riscos: Mutex<(Option<Instant>, u32)>,
    vez_desempenho: AtomicU64,
    atualizando: AtomicBool,
    perguntando: AtomicBool,
    sem_mouse: bool,
    aparelho: String,
    pasta: PathBuf,
    pub janelas: janelas::Janelas,
}

static ESTADO: OnceLock<Estado> = OnceLock::new();
// 3.0.21: abriu escondido (--oculto, partida com o Windows) e a janela ainda não apareceu.
static OCULTO_DESDE_INICIO: AtomicBool = AtomicBool::new(false);
// A página principal terminou de carregar (volta a false quando começa a recarregar).
static PAGINA_CARREGOU: AtomicBool = AtomicBool::new(false);
pub fn estado(_app: &AppHandle) -> &'static Estado {
    ESTADO.get().expect("estado")
}

fn principal(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("principal")
}

fn hwnd(w: &WebviewWindow) -> Option<windows::Win32::Foundation::HWND> {
    w.hwnd().ok().map(|h| windows::Win32::Foundation::HWND(h.0 as _))
}

// ---------- 2.7.33: quem pode pedir o quê ----------
// Só a página do próprio programa (web/index.html), na janela principal, pode pedir.
fn eh_principal(w: &WebviewWindow) -> bool {
    w.label() == "principal" && pagina_local(w, &["/", "/index.html"])
}

// 3.0.17 (ASTRA-014): origem EXATA do programa: http://tauri.localhost sem porta, só nas páginas dadas.
pub fn origem_exata(u: &tauri::Url, caminhos: &[&str]) -> bool {
    u.scheme() == "http" && u.host_str() == Some("tauri.localhost") && u.port().is_none() && caminhos.contains(&u.path())
}
pub fn pagina_local(w: &WebviewWindow, caminhos: &[&str]) -> bool {
    w.url().map(|u| origem_exata(&u, caminhos)).unwrap_or(false)
}

// Clique ou tecla de verdade há pouco, com o Astra na frente (ou um clique no menu do ícone).
fn tocou_agora(app: &AppHandle) -> bool {
    let st = estado(app);
    if teste() && std::env::var("ASTRA_TESTE_TOQUE").is_ok() {
        return true;   // só na versão de teste: o script de teste não tem mouse de verdade
    }
    if st.toque_bandeja.lock().unwrap().map(|t| t.elapsed() < TOQUE_VALE).unwrap_or(false) {
        return true;
    }
    let Some(h) = principal(app).as_ref().and_then(hwnd) else { return false };
    sistema::janela_da_frente_eh(h) && sistema::ms_desde_ultima_entrada() < TOQUE_VALE.as_millis() as u64
}

// Transmissão de verdade = o programa liberou uma captura de tela (não basta a página dizer).
fn captura_recente(app: &AppHandle) -> bool {
    let st = estado(app);
    !st.capturando.lock().unwrap().tela.is_empty()
        && (st.transmitindo.load(SeqCst) || st.captura_em.lock().unwrap().map(|t| t.elapsed() < Duration::from_secs(60)).unwrap_or(false))
}

// ---------- 3.0.13: vigia da linha principal ----------
// "Não está respondendo" = a linha principal da janela ficou presa. A cada segundo ela recebe um
// "ping"; se demorar mais de 3 s, anota (em travou.txt) quanto tempo e qual foi o último comando da
// página. Se o Windows fechar o programa, o aviso vai para o erros-app na próxima vez que abrir.
static ULTIMO_CMD: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn com_registro<R: tauri::Runtime>(
    h: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |inv| {
        let nome = inv.message.command().to_string();
        if nome != "plugin:__TAURI_CHANNEL__|fetch" {
            *ULTIMO_CMD.lock().unwrap() = Some((nome, Instant::now()));
        }
        h(inv)
    }
}

// 3.0.14: "foto" da pilha da linha principal na hora da trava (módulo+deslocamento de cada chamada).
static LINHA_PRINCIPAL: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static PILHA_TOPO: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn pilha_da_principal() -> String {
    use windows::Win32::System::Diagnostics::Debug::*;
    use windows::Win32::System::Threading::*;
    let tid = LINHA_PRINCIPAL.load(SeqCst);
    let mut end = [0u64; 48];
    let mut n = 0usize;
    unsafe {
        let Ok(h) = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, false, tid) else {
            return "sem-acesso".into();
        };
        let mut ctx: Box<CONTEXT> = Box::new(std::mem::zeroed());
        ctx.ContextFlags = CONTEXT_CONTROL_AMD64 | CONTEXT_INTEGER_AMD64;
        // 3.0.14b: congela só para ler os registradores e solta na hora. Procurar as tabelas do Windows com a
        // linha congelada podia esperar uma trava que ela mesma segura (= app preso para sempre).
        let mut ok = false;
        if SuspendThread(h) != u32::MAX {
            ok = GetThreadContext(h, &mut *ctx).is_ok();
            ResumeThread(h);
        }
        let _ = windows::Win32::Foundation::CloseHandle(h);
        if !ok {
            return "sem-contexto".into();
        }
        // Ela está presa há 3 s, então a pilha fica parada. Mesmo assim só lê entre o Rsp e o topo da pilha.
        let (ini, topo) = (ctx.Rsp, PILHA_TOPO.load(SeqCst));
        let dentro = |a: u64| topo != 0 && a >= ini && a.saturating_add(256) <= topo;
        while n < end.len() && ctx.Rip != 0 && dentro(ctx.Rsp) {
            end[n] = ctx.Rip;
            n += 1;
            let antes = ctx.Rsp;
            let mut base = 0u64;
            let f = RtlLookupFunctionEntry(ctx.Rip, &mut base, None);
            if f.is_null() {
                ctx.Rip = *(ctx.Rsp as *const u64);
                ctx.Rsp += 8;
            } else {
                let mut dados = std::ptr::null_mut();
                let mut quadro = 0u64;
                let _ = RtlVirtualUnwind(UNW_FLAG_NHANDLER, base, ctx.Rip, f, &mut *ctx, &mut dados, &mut quadro, None);
            }
            if ctx.Rsp <= antes {
                break;
            }
        }
    }
    // Junta chamadas seguidas do mesmo módulo do sistema; as do próprio app ficam com o endereço.
    let mut partes: Vec<(String, String)> = Vec::new();
    for &a in &end[..n] {
        let (m, off) = modulo_de(a);
        let curto = m.trim_end_matches(".dll").trim_end_matches(".DLL").to_string();
        let eh_app = curto.eq_ignore_ascii_case("AstraScreenShare.exe");
        if !eh_app {
            let n_partes = partes.len();
            if let Some(ult) = partes.last_mut() {
                if ult.0 == curto && n_partes > 1 { if !ult.1.ends_with('*') { ult.1.push('*'); } continue; }
            }
        }
        partes.push((if eh_app { "A".into() } else { curto }, format!("{:x}", off)));
    }
    partes.iter().map(|(m, o)| format!("{}+{}", m, o)).collect::<Vec<_>>().join(" ")
}

fn modulo_de(a: u64) -> (String, u64) {
    use windows::Win32::System::LibraryLoader::*;
    unsafe {
        let mut hm = windows::Win32::Foundation::HMODULE::default();
        if GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            windows::core::PCWSTR(a as *const u16), &mut hm).is_err() {
            return ("?".into(), a);
        }
        let mut buf = [0u16; 260];
        let k = GetModuleFileNameW(Some(hm), &mut buf) as usize;
        let nome = String::from_utf16_lossy(&buf[..k]);
        (nome.rsplit('\\').next().unwrap_or("?").to_string(), a - hm.0 as u64)
    }
}

fn vigia_linha_principal(app: &AppHandle) {
    if let Ok(t) = std::fs::read_to_string(arquivo(app, "travou-pilha.txt")) {
        let _ = std::fs::remove_file(arquivo(app, "travou-pilha.txt"));
        *janelas::PILHA_PENDENTE.lock().unwrap() = Some(t);
    }
    LINHA_PRINCIPAL.store(unsafe { windows::Win32::System::Threading::GetCurrentThreadId() }, SeqCst);
    {
        let (mut baixo, mut alto) = (0usize, 0usize);
        unsafe { windows::Win32::System::Threading::GetCurrentThreadStackLimits(&mut baixo, &mut alto) };
        PILHA_TOPO.store(alto as u64, SeqCst);
    }
    let arq = arquivo(app, "travou.txt");
    if let Ok(t) = std::fs::read_to_string(&arq) {
        let _ = std::fs::remove_file(&arq);
        let mut p = janelas::FALHA_PENDENTE.lock().unwrap();
        if p.is_none() && !t.trim().is_empty() {
            *p = Some(t.trim().chars().take(180).collect());
        }
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        if estado(&app).saindo.load(SeqCst) {
            break;
        }
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let inicio = Instant::now();
        if app.run_on_main_thread(move || { let _ = tx.send(()); }).is_err() {
            break;
        }
        if rx.recv_timeout(Duration::from_secs(3)).is_ok() {
            continue;
        }
        let ultimo = || ULTIMO_CMD.lock().unwrap().as_ref()
            .map(|(n, t)| format!("{} (há {:.1} s)", n, inicio.duration_since(*t).as_secs_f32()))
            .unwrap_or_else(|| "nenhum".into());
        let st = estado(&app);
        let contexto = format!("{}{}", if st.transmitindo.load(SeqCst) { "ao vivo" } else { "parado" },
            if st.capturando.try_lock().map(|c| c.som).unwrap_or(false) { " com som" } else { "" });
        let antes = ultimo();
        let pilha1 = pilha_da_principal();
        let _ = std::fs::write(&arq, format!("Linha principal presa +3 s ({}); último comando: {}", contexto, antes));
        // espera voltar (até 5 min) para anotar quanto durou
        // segunda foto depois de 8 s presa: mostra se continua no mesmo lugar
        let mut voltou = rx.recv_timeout(Duration::from_secs(5)).is_ok();
        let pilha2 = if voltou { String::new() } else { pilha_da_principal() };
        if !voltou { voltou = rx.recv_timeout(Duration::from_secs(295)).is_ok(); }
        *janelas::PILHA_PENDENTE.lock().unwrap() = Some(if pilha2.is_empty() || pilha2 == pilha1 { pilha1.clone() } else { format!("{} || {}", pilha1, pilha2) });
        janelas::diario(&format!("pilha: {} || {}", pilha1, pilha2));
        let msg = format!("Linha principal presa {:.1} s ({}){}; último comando antes: {}",
            inicio.elapsed().as_secs_f32(), contexto, if voltou { "" } else { ", não voltou" }, antes);
        janelas::diario(&msg);
        if voltou {
            let _ = std::fs::remove_file(&arq);
            {
                let mut p = janelas::FALHA_PENDENTE.lock().unwrap();
                if p.is_none() { *p = Some(msg); }
            }
            if let Some(w) = principal(&app) {
                janelas::avisar_falha(&w);
            }
        } else {
            let _ = std::fs::write(&arq, msg);
            if let Some(pl) = janelas::PILHA_PENDENTE.lock().unwrap().take() { let _ = std::fs::write(arquivo(&app, "travou-pilha.txt"), pl); }
        }
    });
}

fn enviar(app: &AppHandle, t: &str, v: Value) {
    if let Some(c) = estado(app).eventos.lock().unwrap().as_ref() {
        let _ = c.send(json!({ "t": t, "v": v }));
    }
}

fn arquivo(app: &AppHandle, nome: &str) -> PathBuf {
    estado(app).pasta.join(nome)
}

// ---------- aviso do próprio programa (a página não consegue esconder) ----------
fn atualizar_indicador(app: &AppHandle) {
    let txt = {
        let c = estado(app).capturando.lock().unwrap();
        let partes: Vec<&str> = [(!c.tela.is_empty(), "tela"), (c.som, "som"), (c.teclas, "teclas")].iter().filter(|x| x.0).map(|x| x.1).collect();
        if partes.is_empty() { String::new() } else { format!("● Capturando: {}", partes.join(", ")) }
    };
    if let Some(w) = principal(app) {
        let _ = w.set_title(&if txt.is_empty() { "AstraScreenShare".to_string() } else { format!("AstraScreenShare ({})", txt) });
    }
    atualizar_bandeja(app, &txt);
}

// 3.0.20: chave geral das notificações do Windows mandadas pelo Astra (o teste 5 desligou tudo; no teste 6 voltam,
// mas caladas durante a live com "Esconder notificações": o silencio liga logo depois que a captura começa).
const NOTIFICACOES_DO_WINDOWS: bool = true;

fn avisar(app: &AppHandle, titulo: &str, texto: &str, sempre: bool) {
    if !NOTIFICACOES_DO_WINDOWS {
        return;
    }
    if !sempre && som::silencio_ligado() {
        return;   // ao vivo com as notificações escondidas
    }
    let app = app.clone();
    let (titulo, texto) = (titulo.to_string(), texto.to_string());
    std::thread::spawn(move || {
        if !sempre {
            // o "Não perturbe" da live liga logo depois da captura começar: espera um pouco e confere de novo
            std::thread::sleep(Duration::from_millis(2500));
            if som::silencio_ligado() {
                return;
            }
        }
        let a2 = app.clone();
        let _ = tauri_winrt_notification::Toast::new(&app.config().identifier)
            .title(&titulo)
            .text1(&texto)
            .on_activated(move |_| {
                let a3 = a2.clone();
                let _ = a2.run_on_main_thread(move || mostrar(&a3));
                Ok(())
            })
            .show();
    });
}

// ---------- janela principal ----------
fn ganchos(app: &AppHandle, escondeu: bool) {
    if let Some(w) = principal(app) {
        let js = if escondeu {
            "window.aoEsconder&&aoEsconder();window.aoMinimizar&&aoMinimizar();"
        } else {
            "window.aoMostrar&&aoMostrar();window.aoRestaurar&&aoRestaurar();"
        };
        let _ = w.eval(js);
    }
    if !escondeu {
        janelas::fechar_minis(app);   // 3.0.3: voltou para a janela = nenhuma mini tela sobra (nem preta)
    }
}

fn mostrar(app: &AppHandle) {
    let Some(w) = principal(app) else { return };
    let estava = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    if !estava {
        estado(app).minimizada.store(false, SeqCst);
        ganchos(app, false);
        acordar_pagina(app, OCULTO_DESDE_INICIO.swap(false, SeqCst));
    }
}

// ---------- 3.0.21: tela branca depois de abrir com o Windows ----------
// Na partida com o Windows o programa abre escondido (--oculto) com o PC ainda ocupado; ao mostrar a
// janela pela 1ª vez, o WebView2 às vezes ficava branco até a pessoa abrir de novo pelo atalho.
// Agora, ao aparecer: a pintura do WebView2 é religada e, na 1ª vez depois da partida escondida, a
// página é recarregada (igual ao que o atalho resolvia), menos quando a pessoa já está numa sala ou
// ao vivo. Se a página não responde, recarrega sempre.
fn cutucar_webview(w: &WebviewWindow) {
    let _ = w.with_webview(|wv| unsafe {
        let c = wv.controller();
        let _ = c.SetIsVisible(false);
        let _ = c.SetIsVisible(true);
        let _ = c.NotifyParentWindowPositionChanged();
    });
}

fn recarregar_pagina(w: &WebviewWindow) {
    let _ = w.with_webview(|wv| unsafe {
        if let Ok(core) = wv.controller().CoreWebView2() {
            let _ = core.Reload();
        }
    });
}

fn acordar_pagina(app: &AppHandle, primeira_vez: bool) {
    let Some(w) = principal(app) else { return };
    cutucar_webview(&w);
    let st = estado(app);
    let ao_vivo = st.transmitindo.load(SeqCst) || !st.capturando.lock().unwrap().tela.is_empty();
    if !PAGINA_CARREGOU.load(SeqCst) {
        recarregar_pagina(&w);
        return;
    }
    if primeira_vez && !ao_vivo {
        // pergunta à página se a pessoa está numa sala; sem resposta em 2 s = página travada/branca
        let respondeu = std::sync::Arc::new(AtomicBool::new(false));
        let r2 = respondeu.clone();
        let w2 = w.clone();
        let _ = w.with_webview(move |wv| unsafe {
            let Ok(core) = wv.controller().CoreWebView2() else { return };
            let js = windows::core::HSTRING::from(
                "(function(){try{return (typeof estado!=='undefined'&&estado&&estado.sala)?'sala':'livre'}catch(e){return 'livre'}})()");
            let w3 = w2.clone();
            let h = webview2_com::ExecuteScriptCompletedHandler::create(Box::new(move |_erro, resposta| {
                r2.store(true, SeqCst);
                if !resposta.contains("sala") {
                    recarregar_pagina(&w3);
                }
                Ok(())
            }));
            let _ = core.ExecuteScript(&js, &h);
        });
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(2000));
            if !respondeu.load(SeqCst) {
                let a = app2.clone();
                let _ = app2.run_on_main_thread(move || {
                    if let Some(w) = principal(&a) { recarregar_pagina(&w); }
                });
            }
        });
    }
    // e religa a pintura mais duas vezes enquanto o Windows termina de abrir
    let app2 = app.clone();
    std::thread::spawn(move || {
        for ms in [700u64, 2500] {
            std::thread::sleep(Duration::from_millis(ms));
            let a = app2.clone();
            let _ = app2.run_on_main_thread(move || {
                if let Some(w) = principal(&a) {
                    if w.is_visible().unwrap_or(false) { cutucar_webview(&w); }
                }
            });
        }
    });
}

// Partida escondida: se a página não terminou de carregar em 40 s (PC ainda lento ou sem rede),
// recarrega uma vez para ela estar pronta quando a pessoa abrir.
fn vigiar_partida(app: &AppHandle) {
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(40));
        if !PAGINA_CARREGOU.load(SeqCst) {
            let a = app2.clone();
            let _ = app2.run_on_main_thread(move || {
                if let Some(w) = principal(&a) { recarregar_pagina(&w); }
            });
        }
    });
}

fn sair(app: &AppHandle) {
    estado(app).saindo.store(true, SeqCst);
    som::parar_tudo();
    sistema::manter_tela_acordada(false);
    janelas::fechar_todas_capturas(app);
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    app.exit(0);
}

// ---------- bandeja (ícone perto do relógio) ----------
fn atualizar_bandeja(app: &AppHandle, txt: &str) {
    let Some(b) = app.tray_by_id("bandeja") else { return };
    let transmitindo = estado(app).transmitindo.load(SeqCst);
    let dica = if !txt.is_empty() { format!("AstraScreenShare: {}", txt) } else if transmitindo { "AstraScreenShare: transmitindo".into() } else { "AstraScreenShare".into() };
    let _ = b.set_tooltip(Some(&dica));
    let menu = (|| -> tauri::Result<Menu<tauri::Wry>> {
        let m = Menu::new(app)?;
        if !txt.is_empty() {
            m.append(&MenuItem::with_id(app, "status", txt, false, None::<&str>)?)?;
            m.append(&PredefinedMenuItem::separator(app)?)?;
        }
        m.append(&MenuItem::with_id(app, "abrir", "Abrir AstraScreenShare", true, None::<&str>)?)?;
        m.append(&MenuItem::with_id(app, "tela", if transmitindo { "Parar transmissão" } else { "Transmitir tela" }, true, None::<&str>)?)?;
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&CheckMenuItem::with_id(app, "iniciar", "Iniciar com o Windows", true, sistema::iniciar_com_windows(), None::<&str>)?)?;
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?)?;
        Ok(m)
    })();
    if let Ok(m) = menu {
        let _ = b.set_menu(Some(m));
    }
}

fn criar_bandeja(app: &AppHandle) -> tauri::Result<()> {
    let icone = app.default_window_icon().cloned().ok_or(tauri::Error::InvalidIcon(std::io::Error::other("sem ícone")))?;
    TrayIconBuilder::with_id("bandeja")
        .icon(icone)
        .tooltip("AstraScreenShare")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|b, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = e {
                mostrar(b.app_handle());
            }
        })
        .on_menu_event(|app, e| match e.id().as_ref() {
            "abrir" => mostrar(app),
            "tela" => {
                let st = estado(app);
                let ao_vivo = st.transmitindo.load(SeqCst) || !st.capturando.lock().unwrap().tela.is_empty();
                if ao_vivo {
                    // 3.0.17 (ASTRA-004): "Parar transmissão" para tudo AQUI, no programa, mesmo com a
                    // página travada. Depois só avisa a página para arrumar os botões.
                    encerrar_captura(app);
                    if let Some(w) = principal(app) {
                        let _ = w.eval("try{if(window.pararTelaPeloIcone)pararTelaPeloIcone();}catch(e){}");
                    }
                    avisar(app, "Transmissão encerrada", "A Astra parou de capturar a tela, o som e as teclas.", true);
                    return;
                }
                // Clique de verdade no menu do ícone (o Windows que mandou).
                *st.toque_bandeja.lock().unwrap() = Some(Instant::now());
                mostrar(app);
                if let Some(w) = principal(app) {
                    let _ = w.eval("document.getElementById('bt-tela') && document.getElementById('bt-tela').click()");
                }
            }
            "iniciar" => {
                let ligado = !sistema::iniciar_com_windows();
                iniciar_com_windows(app, ligado);
            }
            "sair" => sair(app),
            _ => {}
        })
        .build(app)?;
    atualizar_indicador(app);
    Ok(())
}

// ---------- iniciar com o Windows (pergunta uma vez) ----------
fn iniciar_com_windows(app: &AppHandle, sim: bool) {
    if teste() {
        return;   // testando: não mexe no "Iniciar com o Windows" de verdade
    }
    sistema::definir_iniciar_com_windows(sim);
    let _ = std::fs::write(arquivo(app, "configurado"), "1");
    atualizar_indicador(app);
}

fn perguntou_iniciar(app: &AppHandle) -> bool {
    arquivo(app, "perguntou-iniciar").exists()
}

fn perguntar_iniciar_com_windows(app: &AppHandle) {
    let st = estado(app);
    if teste() || perguntou_iniciar(app) || st.perguntando.swap(true, SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        let dono = principal(&app).as_ref().and_then(hwnd);
        let sim = sistema::perguntar(dono, "AstraScreenShare",
            "Abrir a Astra junto com o Windows?\n\nAssim ela fica perto do relógio e você recebe os convites dos amigos na hora.\n\n\
             Dá para mudar quando quiser: clique com o botão direito no ícone perto do relógio.");
        iniciar_com_windows(&app, sim);
        let _ = std::fs::write(arquivo(&app, "perguntou-iniciar"), if sim { "0" } else { "1" });
        estado(&app).perguntando.store(false, SeqCst);
    });
}

fn teste() -> bool {
    cfg!(feature = "teste") && std::env::var("ASTRA_TESTE").is_ok()
}

// Testando, a página e os arquivos ficam em pastas só do teste: o teste nunca encosta no login de
// verdade (em 2026-11-14 um teste marcou "migrado" na pasta real e o login do Electron não veio).
pub fn perfil_teste(app: &AppHandle) -> Option<PathBuf> {
    if !teste() {
        return None;
    }
    app.path().app_local_data_dir().ok().map(|p| p.join("teste-EBWebView"))
}

// ---------- comandos da página ----------
#[tauri::command]
fn ponte_eventos(app: AppHandle, w: WebviewWindow, canal: Channel<Value>) {
    if !eh_principal(&w) {
        return;
    }
    let max = w.is_maximized().unwrap_or(false);
    *estado(&app).eventos.lock().unwrap() = Some(canal);
    enviar(&app, "max", json!(max));
}

#[tauri::command]
fn aviso(app: AppHandle, w: WebviewWindow, titulo: String, texto: String) {
    if !eh_principal(&w) || !NOTIFICACOES_DO_WINDOWS {
        return;
    }
    // Só avisa no Windows se a janela não estiver na frente.
    if w.is_visible().unwrap_or(false) && estado(&app).focada.load(SeqCst) {
        return;
    }
    // 3.0.17 (ASTRA-019): no máximo 8 avisos a cada 30 s pedidos pela página.
    {
        static AVISOS: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
        let mut v = AVISOS.lock().unwrap();
        v.retain(|t| t.elapsed() < Duration::from_secs(30));
        if v.len() >= 8 {
            return;
        }
        v.push(Instant::now());
    }
    avisar(&app, &titulo.chars().take(200).collect::<String>(), &texto.chars().take(500).collect::<String>(), false);
}

#[tauri::command]
fn transmitindo(app: AppHandle, w: WebviewWindow, sim: bool) {
    if !eh_principal(&w) {
        return;
    }
    if !sim {
        encerrar_captura(&app);
        return;
    }
    let st = estado(&app);
    // 3.0.20: a janela dos desenhos é criada antes do 1º risco (criar no meio da live prendia o app 5-10 s)
    let app_d = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(6));
        if estado(&app_d).transmitindo.load(SeqCst) {
            janelas::garantir_desenho(&app_d);
        }
    });
    st.transmitindo.store(true, SeqCst);
    st.protegido.store(st.tela_da_live.lock().unwrap().is_some(), SeqCst);
    janelas::proteger_janelas(&app);
    atualizar_indicador(&app);
}

// 3.0.17 (ASTRA-003/004): UMA rotina, no Rust, que desliga tudo da live: tela, som, teclas, silêncio,
// desenhos e a escolha pendente. Pode ser chamada várias vezes (idempotente). Vale para: a página
// parar, a página recarregar ou travar, a captura acabar, e o "Parar transmissão" do ícone (que não
// depende mais da página responder).
fn encerrar_captura(app: &AppHandle) {
    let st = estado(app);
    st.transmitindo.store(false, SeqCst);
    st.protegido.store(false, SeqCst);
    ligar_silencio(app, false);
    janelas::fechar_desenho(app);
    ligar_teclas(app, false);
    parar_som(app);
    st.capturando.lock().unwrap().tela.clear();
    *st.captura_em.lock().unwrap() = None;
    *st.escolha.lock().unwrap() = None;
    *st.ultimo_som.lock().unwrap() = None;
    *st.tela_da_live.lock().unwrap() = None;
    // 3.0.19: copia ANTES e solta a trava (o "if let" segurava a trava e o fechar_captura pedia a mesma:
    // a linha principal travava ao parar a transmissão).
    let atual = st.janelas.captura_atual.lock().unwrap().clone();
    if let Some(r) = atual {
        janelas::fechar_captura(app, &r);
    }
    janelas::proteger_janelas(app);
    atualizar_indicador(app);
}

#[tauri::command]
fn relaxado(app: AppHandle, w: WebviewWindow, sim: bool) {
    if !eh_principal(&w) {
        return;
    }
    // Assistindo relaxado: a tela não apaga sozinha e a janela ocupa a tela toda.
    let _ = app;
    sistema::manter_tela_acordada(sim);
    let _ = w.set_fullscreen(sim);
}

// Modo Acorde: alguém tocou a campainha. A janela vem para a frente sem roubar o foco e pisca.
#[tauri::command]
fn acorde(app: AppHandle, w: WebviewWindow, nome: String) {
    if !eh_principal(&w) {
        return;
    }
    let estava_na_frente = w.is_visible().unwrap_or(false) && estado(&app).focada.load(SeqCst);
    let _ = w.unminimize();
    if let Some(h) = hwnd(&w) {
        sistema::mostrar_sem_foco(h);
        sistema::piscar(h, true);
    }
    let w2 = w.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(6));
        if !w2.is_fullscreen().unwrap_or(false) {
            let _ = w2.set_always_on_top(false);
        }
        if let Some(h) = hwnd(&w2) {
            sistema::piscar(h, false);
        }
    });
    if !estava_na_frente {
        avisar(&app, "ACORDA! 🔔", &format!("{} quer que você veja uma jogada agora!", nome.chars().take(40).collect::<String>()), false);
    }
}

#[tauri::command]
fn mostrar_janela(app: AppHandle, w: WebviewWindow) {
    if eh_principal(&w) {
        mostrar(&app);
    }
}

// Botões do canto da janela (desenhados pelo Astra) e o F11.
#[tauri::command]
fn janela(app: AppHandle, w: WebviewWindow, acao: String) {
    if !eh_principal(&w) {
        return;
    }
    match acao.as_str() {
        "min" => { let _ = w.minimize(); }
        "max" => { if w.is_maximized().unwrap_or(false) { let _ = w.unmaximize(); } else { let _ = w.maximize(); } }
        "fechar" => fechar_principal(&app, &w),
        "tela-cheia" => { let _ = w.set_fullscreen(!w.is_fullscreen().unwrap_or(false)); }
        // 3.0.16: arrastar pela barra (a página não usa mais -webkit-app-region)
        "arrastar" => { let _ = w.start_dragging(); }
        _ => {}
    }
}

// Fechar a janela só esconde: o programa continua perto do relógio.
fn fechar_principal(app: &AppHandle, w: &WebviewWindow) {
    let _ = w.hide();
    ganchos(app, true);
    if !estado(app).avisou_segundo_plano.swap(true, SeqCst) {
        avisar(app, "AstraScreenShare continua ligado",
            "Ele fica aqui perto do relógio. Para fechar de vez, clique com o botão direito no ícone e em Sair.", false);
    }
}

// Mensagem que some aberta: o Windows não deixa tirar print nem gravar a janela.
#[tauri::command]
fn proteger_tela(app: AppHandle, w: WebviewWindow, sim: bool) {
    if !eh_principal(&w) {
        return;
    }
    estado(&app).visor_aberto.store(sim, SeqCst);
    janelas::proteger_janelas(&app);
}

// O gravador da NVIDIA (Instant Replay) copia a imagem direto da placa e NÃO respeita a proteção.
#[tauri::command]
fn gravador_nvidia(w: WebviewWindow) -> String {
    if !eh_principal(&w) {
        return String::new();
    }
    const GRAVADORES: [&str; 4] = ["nvidia overlay.exe", "nvidia share.exe", "nvsphelper64.exe", "nvsphelper.exe"];
    let nomes: Vec<String> = sistema::processos().into_iter().map(|p| p.nome.to_lowercase()).collect();
    GRAVADORES.iter().find(|g| nomes.iter().any(|n| n == *g)).map(|g| g.to_string()).unwrap_or_default()
}

#[tauri::command]
async fn popup_chat(app: AppHandle, w: WebviewWindow, m: Value) {
    if !eh_principal(&w) || !m.is_object() {
        return;
    }
    let limpo = json!({
        "nome": m["nome"].as_str().unwrap_or("").chars().take(60).collect::<String>(),
        "texto": m["texto"].as_str().unwrap_or("").chars().take(500).collect::<String>(),
        "cor": m["cor"].as_str().unwrap_or("").chars().take(16).collect::<String>(),
        "foto": m["foto"].as_str().unwrap_or("").chars().take(1000).collect::<String>(),
        "imagem": m["imagem"].as_str().unwrap_or("").chars().take(1000).collect::<String>(),
        "gif": m["gif"].as_bool().unwrap_or(false),
        "tipo": m["tipo"].as_str().unwrap_or("").chars().take(16).collect::<String>(),
    });
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || janelas::mostrar_no_popup(&app2, limpo));
}

// 3.0.3: a página fecha a mini tela de verdade (o close() do JavaScript sozinho deixava a janela preta).
#[tauri::command]
fn fechar_mini(app: AppHandle, w: WebviewWindow) {
    if !eh_principal(&w) {
        return;
    }
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || janelas::fechar_minis(&app2));
}

#[tauri::command]
fn popup_vazio(app: AppHandle, w: WebviewWindow) {
    if w.label() == "popup" && pagina_local(&w, &["/astra-popup.html"]) {
        janelas::popup_vazio(&app);
    }
}

// ---------- escolher a tela ----------
// 2.7.33: a lista (com miniaturas) só sai logo depois de um clique de verdade, no máximo a cada 2 s.
#[tauri::command]
async fn listar_fontes(app: AppHandle, w: WebviewWindow) -> Vec<fontes::Fonte> {
    let st = estado(&app);
    if !eh_principal(&w) || !tocou_agora(&app) {
        return vec![];
    }
    {
        let mut u = st.ultima_lista.lock().unwrap();
        if u.map(|t| t.elapsed() < Duration::from_secs(2)).unwrap_or(false) {
            return vec![];
        }
        *u = Some(Instant::now());
    }
    let sem_mouse = st.sem_mouse;
    let lista = tauri::async_runtime::spawn_blocking(move || fontes::listar(sem_mouse)).await.unwrap_or_default();
    *st.ultimas_fontes.lock().unwrap() = lista.clone();
    lista
}

#[tauri::command]
fn definir_fonte(app: AppHandle, w: WebviewWindow, id: String, som: String) -> Value {
    let st = estado(&app);
    // 2.7.33: escolher a tela também precisa de um clique de verdade (no botão "Transmitir").
    if !eh_principal(&w) || !tocou_agora(&app) {
        *st.escolha.lock().unwrap() = None;
        return json!({ "ok": false });
    }
    let (fonte, ambigua) = {
        let lista = st.ultimas_fontes.lock().unwrap();
        let fonte = lista.iter().find(|f| f.id == id).cloned();
        let ambigua = fonte.as_ref().map(|f| fontes::selecao_ambigua(f, &lista)).unwrap_or(false);
        (fonte, ambigua)
    };
    // 3.0.17 (ASTRA-002): o WebView2 acha a fonte por um PEDAÇO do nome e pega a primeira que tiver
    // esse pedaço. Se outra janela/tela também tem, poderia transmitir a errada: aí recusa e explica.
    if ambigua {
        *st.escolha.lock().unwrap() = None;
        janelas::diario("definir_fonte: recusada (nome ambíguo)");
        return json!({ "ok": false, "motivo": "ambigua" });
    }
    // Transmitindo um monitor inteiro: os desenhos dos amigos aparecem por cima dele.
    *st.tela_da_live.lock().unwrap() = fonte.as_ref().and_then(|f| f.retangulo);
    let ok = fonte.is_some();
    *st.escolha.lock().unwrap() = fonte.map(|fonte| Escolha { fonte, som: som.chars().take(20).collect(), em: Instant::now() });
    st.ultimas_fontes.lock().unwrap().clear();   // solta as miniaturas da memória
    json!({ "ok": ok })
}

// O getDisplayMedia da página (ponte.js) chega aqui: abre a janela de captura da fonte escolhida.
#[tauri::command]
async fn captura_iniciar(app: AppHandle, w: WebviewWindow, largura: u32, altura: u32, qps: u32) -> Result<Value, String> {
    if !eh_principal(&w) {
        return Err("Só a página do programa pode transmitir.".into());
    }
    let st = estado(&app);
    // 2.7.33: só logo depois de escolher a tela (30 s), e a escolha vale uma vez.
    let escolha = st.escolha.lock().unwrap().take().filter(|e| e.em.elapsed() < Duration::from_secs(30))
        .ok_or("Escolha a tela na janela \"Transmitir tela\".")?;
    // 3.0.18 (ASTRA-001): confirmação NATIVA do Windows (a página não consegue clicar nela). Um clique
    // qualquer no Astra não basta mais para começar a capturar.
    if !(teste() && std::env::var("ASTRA_TESTE_TOQUE").is_ok()) {
        let (app_p, nome, tela) = (app.clone(), escolha.fonte.nome.clone(), escolha.fonte.tela);
        let sim = tauri::async_runtime::spawn_blocking(move || {
            let dono = principal(&app_p).as_ref().and_then(hwnd);
            sistema::perguntar(dono, "AstraScreenShare - transmitir",
                &format!("Começar a transmitir {} \"{}\"?\n\nQuem está na sala vai ver o que aparecer nela.",
                    if tela { "a tela" } else { "a janela" }, nome.chars().take(80).collect::<String>()))
        }).await.unwrap_or(false);
        if !sim {
            return Err("Transmissão cancelada.".into());
        }
    }
    let (selecao, sem_mouse) = (escolha.fonte.selecao.clone(), st.sem_mouse);
    let app2 = app.clone();
    let rotulo = tauri::async_runtime::spawn_blocking(move || janelas::abrir_captura(&app2, &selecao, sem_mouse, largura, altura, qps))
        .await.map_err(|e| e.to_string())??;
    *st.captura_em.lock().unwrap() = Some(Instant::now());
    st.capturando.lock().unwrap().tela = escolha.fonte.nome.clone();
    *st.ultimo_som.lock().unwrap() = Some(escolha.clone());
    atualizar_indicador(&app);
    avisar(&app, "A Astra começou a transmitir",
        &format!("Capturando: {}. Para parar, use \"Parar\" no Astra ou o menu do ícone perto do relógio.", escolha.fonte.nome), false);
    Ok(json!({ "rotulo": rotulo, "superficie": if escolha.fonte.tela { "monitor" } else { "window" }, "nome": escolha.fonte.nome }))
}

#[tauri::command]
fn captura_parar(app: AppHandle, w: WebviewWindow, rotulo: String) {
    if !eh_principal(&w) {
        return;
    }
    // 3.0.17 (ASTRA-003): a captura que está no ar acabou = som, teclas e silêncio acabam junto.
    // (Uma captura velha, que já não é a atual, só fecha a janela dela.)
    let atual = estado(&app).janelas.captura_atual.lock().unwrap().clone();
    if atual.as_deref() == Some(rotulo.as_str()) {
        encerrar_captura(&app);   // já fecha a janela desta captura
        return;
    }
    if atual.is_none() {
        encerrar_captura(&app);
    }
    janelas::fechar_captura(&app, &rotulo);
}

#[tauri::command]
fn sinal_principal(app: AppHandle, w: WebviewWindow, msg: String) {
    if eh_principal(&w) && msg.len() < 200_000 {
        janelas::sinal_para_captura(&app, &msg);
    }
}

#[tauri::command]
fn sinal_captura(app: AppHandle, w: WebviewWindow, msg: String) {
    let atual = estado(&app).janelas.captura_atual.lock().unwrap().clone();
    if atual.as_deref() == Some(w.label()) && pagina_local(&w, &["/astra-captura.html"]) && msg.len() < 200_000 {
        enviar(&app, "sinal", json!({ "de": w.label(), "msg": msg }));
    }
}

// ---------- som sem o Discord e sem o próprio programa (astra-audio.exe) ----------
fn parar_som(app: &AppHandle) {
    som::som_parar();
    let mudou = std::mem::replace(&mut estado(app).capturando.lock().unwrap().som, false);
    if mudou {
        atualizar_indicador(app);
    }
}

#[tauri::command]
async fn som_iniciar(app: AppHandle, w: WebviewWindow, canal: Channel<InvokeResponseBody>) -> Value {
    // 2.7.33: o som do PC só é capturado junto com uma transmissão que a pessoa começou.
    // 3.0.17 (ASTRA-015): confere ANTES de mexer em qualquer coisa (antes parava o som primeiro).
    if !eh_principal(&w) || !captura_recente(&app) {
        return json!({ "ok": false, "erro": "O som só é capturado durante uma transmissão." });
    }
    parar_som(&app);
    let pid = std::process::id().to_string();
    let args: Vec<String> = match estado(&app).ultimo_som.lock().unwrap().as_ref() {
        Some(e) if e.som == "janela" && !e.fonte.tela => vec!["incluir-janela".into(), e.fonte.id.trim_start_matches("janela:").to_string()],
        // Todo o som do PC menos o do próprio Astra (música da sala e telas dos amigos), senão faz eco.
        Some(e) if e.som == "tudo" => vec!["excluir-pid".into(), pid],
        // Sem o Discord e sem o próprio Astra.
        _ => vec!["mixar".into(), pid, "Discord.exe".into(), "DiscordPTB.exe".into(), "DiscordCanary.exe".into()],
    };
    estado(&app).capturando.lock().unwrap().som = true;
    atualizar_indicador(&app);
    let app2 = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        let app3 = app2.clone();
        som::som_iniciar(&app2, args, canal, move || {
            estado(&app3).capturando.lock().unwrap().som = false;
            atualizar_indicador(&app3);
        })
    }).await.unwrap_or_else(|e| Err(e.to_string()));
    match r {
        Ok(Some((porta, chave))) => json!({ "ok": true, "porta": porta, "chave": chave, "info": som::info() }),
        Ok(None) => json!({ "ok": true, "info": som::info() }),
        Err(e) => {
            parar_som(&app);
            json!({ "ok": false, "erro": e })
        }
    }
}

#[tauri::command]
fn som_parar(app: AppHandle, w: WebviewWindow) {
    if eh_principal(&w) {
        parar_som(&app);
    }
}

// ---------- esconder as notificações durante a live ----------
fn ligar_silencio(app: &AppHandle, sim: bool) {
    som::silencio(app, sim);
    janelas::proteger_janelas(app);
}

#[tauri::command]
fn info_silencio(w: WebviewWindow) -> String {
    if !eh_principal(&w) {
        return String::new();
    }
    som::info_silencio()
}

#[tauri::command]
fn silencio(app: AppHandle, w: WebviewWindow, sim: bool) {
    if !eh_principal(&w) {
        return;
    }
    // 3.0.17 (P0-3): o "Não perturbe" (esconder notificações) só liga durante uma transmissão de verdade.
    if sim && !captura_recente(&app) {
        return;
    }
    ligar_silencio(&app, sim);
}

// ---------- teclas apertadas (opção da live) ----------
fn ligar_teclas(app: &AppHandle, sim: bool) {
    let st = estado(app);
    if !sim {
        som::teclas(app, false, || false, |_| {}, || {});
        if std::mem::replace(&mut st.capturando.lock().unwrap().teclas, false) {
            atualizar_indicador(app);
        }
        return;
    }
    // 2.7.33: só durante uma transmissão que a pessoa começou.
    if !captura_recente(app) {
        return;
    }
    let (a1, a2, a3) = (app.clone(), app.clone(), app.clone());
    // 3.0.17 (ASTRA-022): transmitindo uma JANELA, as teclas só vão para a live quando ela está na
    // frente (antes iam com qualquer janela na frente, ex.: digitando no navegador). Tela inteira:
    // como antes (tudo menos o próprio Astra).
    let janela_da_live: Option<isize> = estado(app).ultimo_som.lock().unwrap().as_ref()
        .filter(|e| !e.fonte.tela)
        .and_then(|e| e.fonte.id.strip_prefix("janela:").and_then(|n| n.parse::<isize>().ok()));
    let ok = som::teclas(app, true,
        move || {
            // true = NÃO mandar esta tecla
            if estado(&a1).focada.load(SeqCst) {
                return true;
            }
            match janela_da_live {
                Some(h) => !sistema::janela_da_frente_eh(windows::Win32::Foundation::HWND(h as _)),
                None => false,
            }
        },
        move |lista| enviar(&a2, "teclas", json!(lista)),
        move || {
            estado(&a3).capturando.lock().unwrap().teclas = false;
            atualizar_indicador(&a3);
        });
    if ok {
        st.capturando.lock().unwrap().teclas = true;
        atualizar_indicador(app);
    }
}

#[tauri::command]
fn teclas(app: AppHandle, w: WebviewWindow, sim: bool) {
    // 3.0.20: "mostrar teclas apertadas" foi REMOVIDO a pedido do dono. O comando só desliga (página antiga pedindo).
    let _ = sim;
    if eh_principal(&w) {
        ligar_teclas(&app, false);
    }
}

// ---------- desenhos dos amigos ----------
// 2.7.33: o risco é conferido aqui: até 64 pontos de 0 a 1, 60 por segundo, cor #rrggbb ou "borracha".
fn risco_limpo(r: &Value) -> Option<Value> {
    let pts = r.get("pts")?.as_array()?;
    if pts.is_empty() || pts.len() > 64 {
        return None;
    }
    let cor = r.get("cor")?.as_str()?;
    let cor_ok = cor == "borracha" || (cor.len() == 7 && cor.starts_with('#') && cor[1..].chars().all(|c| c.is_ascii_hexdigit()));
    if !cor_ok {
        return None;
    }
    let mut limpos = Vec::with_capacity(pts.len());
    for p in pts {
        let p = p.as_array()?;
        let (x, y) = (p.first()?.as_f64()?, p.get(1)?.as_f64()?);
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        limpos.push(json!([x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)]));
    }
    let id = match r.get("id") {
        Some(Value::String(s)) => s.chars().take(40).collect::<String>(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    Some(json!({ "id": id, "cor": cor, "pts": limpos }))
}

#[tauri::command]
async fn risco(app: AppHandle, w: WebviewWindow, r: Value) {
    let st = estado(&app);
    janelas::diario(&format!("risco: principal={} transmitindo={} tela={:?}", eh_principal(&w), st.transmitindo.load(SeqCst), st.tela_da_live.lock().unwrap()));
    if !eh_principal(&w) || !st.transmitindo.load(SeqCst) || st.tela_da_live.lock().unwrap().is_none() {
        return;
    }
    {
        let mut g = st.riscos.lock().unwrap();
        if g.0.map(|t| t.elapsed() > Duration::from_secs(1)).unwrap_or(true) {
            *g = (Some(Instant::now()), 0);
        }
        g.1 += 1;
        if g.1 > 60 {
            return;
        }
    }
    let Some(r) = risco_limpo(&r) else { return };
    janelas::garantir_desenho(&app);   // 3.0.20: cria a janela aqui (fora da linha principal), se faltar
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || janelas::desenhar(&app2, r));
}

// Tecla de emergência: funciona até com o jogo na frente. Apaga os rabiscos e avisa a janela.
#[tauri::command]
fn tecla_emergencia(app: AppHandle, w: WebviewWindow, acel: String) -> bool {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    if !eh_principal(&w) {
        return false;
    }
    let st = estado(&app);
    let mut atual = st.tecla_emergencia.lock().unwrap();
    if !atual.is_empty() {
        let _ = app.global_shortcut().unregister(atual.as_str());
    }
    atual.clear();
    if acel.is_empty() {
        return true;
    }
    // 3.0.17 (ASTRA-019): atalho global só com Ctrl/Alt/Shift/Win, ou uma tecla F1..F24 sozinha.
    if !atalho_permitido(&acel) {
        return false;
    }
    let ok = app.global_shortcut().on_shortcut(acel.as_str(), |app, _, e| {
        if e.state == ShortcutState::Pressed {
            janelas::fechar_desenho(app);
            enviar(app, "emergencia", Value::Null);
        }
    }).is_ok();
    if ok {
        *atual = acel;
    }
    ok
}

fn atalho_permitido(acel: &str) -> bool {
    let partes: Vec<String> = acel.split('+').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect();
    if partes.is_empty() || partes.len() > 4 || acel.len() > 60 {
        return false;
    }
    const MODS: [&str; 9] = ["ctrl", "control", "alt", "shift", "super", "cmd", "command", "commandorcontrol", "cmdorctrl"];
    let tem_mod = partes.iter().any(|p| MODS.contains(&p.as_str()));
    let tecla_f = |p: &str| p.len() >= 2 && p.starts_with('f') && p[1..].parse::<u8>().map(|n| (1..=24).contains(&n)).unwrap_or(false);
    let so_mods = partes.iter().all(|p| MODS.contains(&p.as_str()));
    // As mesmas teclas que a página (config.js, SOZINHAS) deixa usar sozinhas.
    const SOZINHAS: [&str; 5] = ["insert", "home", "end", "pageup", "pagedown"];
    let sozinha_ok = |p: &str| tecla_f(p) || SOZINHAS.contains(&p);
    !so_mods && (tem_mod || (partes.len() == 1 && sozinha_ok(&partes[0])))
}

// ---------- painel de desempenho ----------
#[tauri::command]
fn desempenho(app: AppHandle, w: WebviewWindow, ligado: bool) {
    if !eh_principal(&w) {
        return;
    }
    let vez = estado(&app).vez_desempenho.fetch_add(1, SeqCst) + 1;
    som::medidor_gpu(&app, ligado);
    if !ligado {
        return;
    }
    std::thread::spawn(move || {
        let medir = || {
            let pids = sistema::arvore();
            let (cpu, ram, cpu_pc, ram_usada, ram_total) = sistema::medir(&pids);
            let (gpu_total, gpu_pids) = som::GPU_DADOS.lock().unwrap().clone();
            let gpu_app = gpu_pids.map(|m| pids.iter().map(|p| m.get(p).copied().unwrap_or(0)).sum::<u32>().min(100));
            json!({
                "app": { "cpu": cpu, "ram": ram, "gpu": if gpu_total.is_some() { json!(gpu_app) } else { Value::Null }, "ramGpu": 0 },
                "pc": { "cpu": cpu_pc, "ramUsada": ram_usada, "ramTotal": ram_total, "gpu": gpu_total },
            })
        };
        medir();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            if estado(&app).vez_desempenho.load(SeqCst) != vez {
                break;
            }
            enviar(&app, "desempenho", medir());
        }
    });
}

// ---------- minigames assinados e atualização ----------
#[tauri::command]
fn conferir_modulo(w: WebviewWindow, nome: String, texto: String, assinatura: String) -> bool {
    eh_principal(&w) && atualizar::conferir_modulo(&nome, &texto, &assinatura)
}

#[tauri::command]
async fn atualizar(app: AppHandle, w: WebviewWindow) -> Value {
    let st = estado(&app);
    if !eh_principal(&w) || st.atualizando.swap(true, SeqCst) {
        return json!({ "ok": false });
    }
    let versao = app.package_info().version.to_string();
    let app2 = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        atualizar::baixar_e_conferir(&site(), &versao, |p| enviar(&app2, "atualizar", json!(p)))
    }).await.unwrap_or_else(|e| Err(e.to_string()));
    match r {
        Ok(instalador) => {
            enviar(&app, "atualizar", json!("instalando"));
            let aberto = std::process::Command::new(&instalador).args(["/S", "--force-run"]).spawn();
            match aberto {
                Ok(_) => {
                    let app2 = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(800));
                        let a3 = app2.clone();
                        let _ = app2.run_on_main_thread(move || sair(&a3));
                    });
                    json!({ "ok": true })
                }
                Err(e) => {
                    st.atualizando.store(false, SeqCst);
                    json!({ "ok": false, "erro": e.to_string() })
                }
            }
        }
        Err(e) => {
            st.atualizando.store(false, SeqCst);
            json!({ "ok": false, "assinatura": e.contains("assinatura"), "erro": e })
        }
    }
}

#[tauri::command]
fn sem_mouse_salvar(app: AppHandle, w: WebviewWindow, sim: bool) {
    if !eh_principal(&w) {
        return;
    }
    let f = arquivo(&app, "mostrar-mouse");
    if sim { let _ = std::fs::remove_file(f); } else { let _ = std::fs::write(f, "1"); }
}

#[tauri::command]
fn reiniciar(app: AppHandle, w: WebviewWindow) {
    if eh_principal(&w) {
        som::parar_tudo();
        app.restart();
    }
}

// ---------- dados do programa antigo (Electron) ----------
// A 2.7.36 guardou uma cópia do localStorage em %APPDATA%\AstraScreenShare\migracao-dados.json.
// Na primeira vez, ela vai para a página (sem apagar nada que já exista nela): ninguém é deslogado.
fn pasta_antiga() -> Option<PathBuf> {
    if teste() {
        return std::env::var_os("ASTRA_PASTA_ANTIGA").map(PathBuf::from);   // testando: nunca o login de verdade
    }
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("AstraScreenShare"))
}

// Duas marcas na página:
//  - __astra_migrado: as configurações já vieram (só preenche o que estiver vazio);
//  - __astra_login_migrado: o LOGIN já veio. Na primeira vez a conta do programa antigo (ID + chave +
//    nomes + foto) SEMPRE ganha da que estiver na página: quem já entrava no PC continua na mesma conta,
//    mesmo que algo tenha criado uma conta nova antes (como o teste de 2026-11-14). Depois disso a
//    pessoa troca/sai de conta à vontade e nada é trazido de novo.
const CHAVES_DO_LOGIN: [&str; 7] = ["astra.id", "astra.chave", "astra.nome", "astra.exibicao", "astra.foto", "astra.capa", "astra.perfil"];

// Junta as duas fontes: a cópia migracao-dados.json (2.7.36+) e, por cima, o banco do próprio
// Electron (sempre o mais atual, e o único que existe para quem vem de antes da 2.7.36).
pub fn dados_antigos() -> Option<serde_json::Map<String, Value>> {
    let antiga = pasta_antiga()?;
    let mut dados = std::fs::read_to_string(antiga.join("migracao-dados.json")).ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|v| v.get("localStorage").and_then(|l| l.as_object()).cloned())
        .unwrap_or_default();
    if let Some(banco) = electron::ler_local_storage(&antiga) {
        dados.extend(banco);
    }
    if dados.is_empty() { None } else { Some(dados) }
}

fn script_migracao(app: &AppHandle) -> Option<String> {
    // 3.0.20: só na PRIMEIRA abertura do programa novo (antes de existir o arquivo "migrado"). Antes rodava em
    // toda abertura e dependia de uma marca no localStorage: quando o WebView2 zerava o localStorage (programa
    // fechado à força numa atualização), o login VELHO do Electron voltava por cima da conta atual e o servidor
    // recusava ("Entrada recusada numa conta com senha"), até depois de recuperar a conta com código.
    if arquivo(app, "migrado").exists() {
        return None;
    }
    let dados = dados_antigos()?;
    let limpo: serde_json::Map<String, Value> = dados.iter()
        .filter(|(k, _)| !k.starts_with("__astra_"))
        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), json!(s)))).collect();
    let tem_login = limpo.get("astra.id").and_then(|x| x.as_str()).map(|s| s.len() == 9 && s.bytes().all(|b| b.is_ascii_digit())).unwrap_or(false)
        && limpo.get("astra.chave").and_then(|x| x.as_str()).map(|s| (20..=100).contains(&s.len())).unwrap_or(false);
    Some(format!(
        "(function(){{try{{if(location.origin!=={o}||window.top!==window)return;var L=localStorage,d={d};\
         if(!L.getItem('__astra_migrado')){{for(var k in d)if(L.getItem(k)===null)L.setItem(k,d[k]);L.setItem('__astra_migrado','1');}}\
         if(!L.getItem('__astra_login_migrado')){{if({tem}){{var c={c};for(var i=0;i<c.length;i++){{if(c[i] in d)L.setItem(c[i],d[c[i]]);else L.removeItem(c[i]);}}}}\
         L.setItem('__astra_login_migrado','1');}}}}catch(e){{}}}})();",
        o = json!(ORIGEM), d = Value::Object(limpo), tem = tem_login, c = json!(CHAVES_DO_LOGIN)))
}

// ---------- 3.0.20: cópia da conta fora do WebView2 ----------
// O WebView2 às vezes perde o localStorage (programa fechado à força numa atualização). A conta (ID + chave) fica
// também em conta.dat, cifrada pelo Windows (DPAPI: só este usuário do Windows, neste PC, consegue abrir). Ao abrir,
// se a página estiver sem conta, ela volta sozinha. Sair da conta apaga a cópia.
fn dpapi(dados: &[u8], cifrar: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::*;
    unsafe {
        let entrada = CRYPT_INTEGER_BLOB { cbData: dados.len() as u32, pbData: dados.as_ptr() as *mut u8 };
        let mut saida = CRYPT_INTEGER_BLOB::default();
        let r = if cifrar {
            CryptProtectData(&entrada, windows::core::w!("AstraScreenShare"), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut saida)
        } else {
            CryptUnprotectData(&entrada, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut saida)
        };
        if r.is_err() || saida.pbData.is_null() {
            return None;
        }
        let v = std::slice::from_raw_parts(saida.pbData, saida.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(saida.pbData as _)));
        Some(v)
    }
}

fn conta_valida(id: &str, chave: &str) -> bool {
    id.len() == 9 && id.bytes().all(|b| b.is_ascii_digit())
        && (20..=100).contains(&chave.len()) && chave.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn conta_guardada(app: &AppHandle) -> Option<(String, String)> {
    let bruto = std::fs::read(arquivo(app, "conta.dat")).ok()?;
    let v: Value = serde_json::from_slice(&dpapi(&bruto, false)?).ok()?;
    let (id, chave) = (v["id"].as_str()?.to_string(), v["chave"].as_str()?.to_string());
    conta_valida(&id, &chave).then_some((id, chave))
}

#[tauri::command]
fn lembrar_conta(app: AppHandle, w: WebviewWindow, id: String, chave: String) {
    if !eh_principal(&w) || !conta_valida(&id, &chave) || conta_guardada(&app).as_ref() == Some(&(id.clone(), chave.clone())) {
        return;
    }
    if let Some(c) = dpapi(json!({ "id": id, "chave": chave }).to_string().as_bytes(), true) {
        let (tmp, fim) = (arquivo(&app, "conta.dat.novo"), arquivo(&app, "conta.dat"));
        if std::fs::write(&tmp, c).is_ok() {
            let _ = std::fs::rename(&tmp, &fim);
        }
    }
}

#[tauri::command]
fn esquecer_conta(app: AppHandle, w: WebviewWindow) {
    if eh_principal(&w) {
        let _ = std::fs::remove_file(arquivo(&app, "conta.dat"));
    }
}

// Se a página abrir sem conta (ou com o mesmo ID sem a chave), põe de volta a da cópia e marca "__astra_restaurado".
fn script_conta(app: &AppHandle) -> Option<String> {
    let (id, chave) = conta_guardada(app)?;
    Some(format!(
        "(function(){{try{{if(location.origin!=={o}||window.top!==window)return;var L=localStorage,i=L.getItem('astra.id');\
         if(!i||(i==={id}&&!L.getItem('astra.chave'))){{L.setItem('astra.id',{id});L.setItem('astra.chave',{c});\
         L.setItem('__astra_migrado','1');L.setItem('__astra_login_migrado','1');L.setItem('__astra_restaurado',String(Date.now()));}}}}catch(e){{}}}})();",
        o = json!(ORIGEM), id = json!(id), c = json!(chave)))
}

// Escolhas guardadas pelo programa antigo que continuam valendo.
fn trazer_escolhas_antigas(app: &AppHandle) {
    let Some(antiga) = pasta_antiga() else { return };
    for nome in ["perguntou-iniciar", "mostrar-mouse", "configurado"] {
        let (de, para) = (antiga.join(nome), arquivo(app, nome));
        if de.exists() && !para.exists() && !arquivo(app, "migrado").exists() {
            let _ = std::fs::copy(de, para);
        }
    }
}

// ---------- abrir ----------
// Argumentos do WebView2 da janela principal. O pop-up e os desenhos usam o mesmo perfil, e o
// WebView2 só aceita outra janela no mesmo perfil se os argumentos forem iguais.
pub fn args_principal() -> String {
    static ARGS: OnceLock<String> = OnceLock::new();
    ARGS.get_or_init(|| {
        let mut a = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,WebRtcHideLocalIpsWithMdns,SpareRendererForSitePerProcess,Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,CalculateNativeWinOcclusion --autoplay-policy=no-user-gesture-required");
        if teste() {
            if let Ok(p) = std::env::var("ASTRA_CDP") {
                a += &format!(" --remote-debugging-port={}", p.parse::<u16>().unwrap_or(9334));
            }
        }
        a
    }).clone()
}

fn criar_principal(app: &AppHandle, oculto: bool) -> tauri::Result<()> {
    let st = estado(app);
    let inicio = json!({
        "origem": ORIGEM, "servidor": servidor(), "site": site(), "versao": app.package_info().version.to_string(),
        "aparelho": st.aparelho, "semMouse": st.sem_mouse,
    });
    let ponte = format!("window.__ASTRA_INICIO__={};\n{}", inicio, include_str!("ponte.js"));
    let app_nova = app.clone();
    let app_carga = app.clone();
    let args = args_principal();
    let mut b = WebviewWindowBuilder::new(app, "principal", WebviewUrl::App("index.html".into()))
        .title("AstraScreenShare")
        .inner_size(1280.0, 780.0)
        .min_inner_size(400.0, 520.0)
        .visible(!oculto)
        .decorations(false)   // a janela é toda do Astra; min/max/fechar são botões do app.js
        .shadow(true)
        .background_color(tauri::window::Color(0x1e, 0x1f, 0x22, 255))
        .additional_browser_args(&args)
        .initialization_script(ponte)
        // 2.7.33: a janela só mostra a página do programa.
        .on_navigation(|u| origem_exata(u, &["/", "/index.html"]))
        .on_new_window(move |url, recursos| janelas::nova_janela(&app_nova, url, recursos))
        // Câmera e microfone (voz e câmera da sala) só para a página do programa; o resto é "não".
        .on_permission_request(|w, tipo| {
            // 3.0.17 (ASTRA-005/014): só a página principal exata (sem porta, só /index.html).
            let da_pagina = w.url().map(|u| origem_exata(&u, &["/", "/index.html"])).unwrap_or(false);
            if !da_pagina {
                return PermissionResponse::Deny;
            }
            match tipo {
                PermissionKind::Autoplay => PermissionResponse::Allow,
                // 3.0.27 (auditoria): microfone e câmera só logo depois de um clique/tecla de verdade com o
                // Astra na frente. Antes bastava a página pedir: um script injetado ligaria o mic sem ninguém ver.
                PermissionKind::Microphone | PermissionKind::Camera => {
                    let app = w.app_handle();
                    let mut mic = estado(app).mic_liberado.lock().unwrap();
                    if tocou_agora(app) {
                        if matches!(tipo, PermissionKind::Microphone) {
                            *mic = Some(Instant::now());
                        }
                        PermissionResponse::Allow
                    } else if matches!(tipo, PermissionKind::Microphone)
                        && mic.map(|t| t.elapsed() < MIC_VOLTA_VALE).unwrap_or(false)
                    {
                        PermissionResponse::Allow   // voltando sozinho para a call depois de a internet cair
                    } else {
                        PermissionResponse::Deny
                    }
                }
                _ => PermissionResponse::Deny,
            }
        })
        .on_page_load(move |_, p| {
            let app = &app_carga;
            match p.event() {
                // A página recarregou: as capturas abertas por ela não servem mais.
                // 3.0.17 (ASTRA-003): e o som, as teclas e o silêncio também (antes sobreviviam ao reload).
                PageLoadEvent::Started => {
                    PAGINA_CARREGOU.store(false, SeqCst);
                    encerrar_captura(app);
                    janelas::fechar_todas_capturas(app);
                }
                PageLoadEvent::Finished => {
                    PAGINA_CARREGOU.store(true, SeqCst);
                    if let Some(w) = principal(app) {
                        janelas::avisar_falha(&w);
                    }
                    if !arquivo(app, "migrado").exists() {
                        let _ = std::fs::write(arquivo(app, "migrado"), "1");
                    }
                    if !perguntou_iniciar(app) && principal(app).map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false) {
                        perguntar_iniciar_com_windows(app);
                    }
                }
            }
        });
    if let Some(m) = script_migracao(app) {
        b = b.initialization_script(m);
    }
    if let Some(c) = script_conta(app) {
        b = b.initialization_script(c);
    }
    if let Some(p) = perfil_teste(app) {
        b = b.data_directory(p);
    }
    let w = b.build()?;
    janelas::vigiar_processo(app, &w);
    janelas::permissoes_sem_lembrar(&w);
    let app2 = app.clone();
    w.on_window_event(move |e| {
        let st = estado(&app2);
        match e {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if !st.saindo.load(SeqCst) {
                    api.prevent_close();
                    if let Some(w) = principal(&app2) {
                        fechar_principal(&app2, &w);
                    }
                }
            }
            tauri::WindowEvent::Focused(f) => st.focada.store(*f, SeqCst),
            tauri::WindowEvent::Resized(_) => {
                let Some(w) = principal(&app2) else { return };
                // Minimizou assistindo alguém: o app.js abre a mini tela.
                let min = w.is_minimized().unwrap_or(false);
                if st.minimizada.swap(min, SeqCst) != min {
                    ganchos(&app2, min);
                    if !min && !perguntou_iniciar(&app2) {
                        perguntar_iniciar_com_windows(&app2);
                    }
                }
                let max = w.is_maximized().unwrap_or(false);
                if st.maximizada.swap(max, SeqCst) != max {
                    enviar(&app2, "max", json!(max));
                }
            }
            _ => {}
        }
    });
    Ok(())
}

fn main() {
    // 2.7.36: com depurador remoto (outro programa controlando a janela e lendo o login) não abre.
    if sistema::com_depurador() {
        std::process::exit(0);
    }
    sistema::limpar_variaveis_webview2();
    // Só na versão de teste: confere a leitura do programa antigo e sai (não mostra a chave).
    if teste() && std::env::var("ASTRA_LER_ELECTRON").is_ok() {
        let banco = pasta_antiga().and_then(|p| electron::ler_local_storage(&p));
        let junto = dados_antigos();
        let s = |m: &Option<serde_json::Map<String, Value>>, k: &str| m.as_ref().and_then(|m| m.get(k)).and_then(|v| v.as_str()).map(|s| s.to_string());
        janelas::diario(&format!(
            "ler-electron: banco={} itens id={:?} nome={:?} exibicao={:?} chave_len={} | junto={} itens chave_igual={}",
            banco.as_ref().map(|b| b.len()).unwrap_or(0), s(&banco, "astra.id"), s(&banco, "astra.nome"), s(&banco, "astra.exibicao"),
            s(&banco, "astra.chave").map(|c| c.len()).unwrap_or(0), junto.as_ref().map(|b| b.len()).unwrap_or(0),
            s(&banco, "astra.chave") == s(&junto, "astra.chave")));
        std::process::exit(0);
    }
    let oculto = std::env::args().any(|a| a == "--oculto");

    tauri::Builder::default()
        // Só uma cópia do programa aberta; abrir de novo só mostra a janela.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| mostrar(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(com_registro(tauri::generate_handler![
            ponte_eventos, aviso, transmitindo, relaxado, acorde, mostrar_janela, janela, proteger_tela, gravador_nvidia,
            popup_chat, popup_vazio, fechar_mini, listar_fontes, definir_fonte, captura_iniciar, captura_parar, sinal_principal, sinal_captura,
            som_iniciar, som_parar, silencio, teclas, risco, tecla_emergencia, desempenho, conferir_modulo, atualizar,
            lembrar_conta, esquecer_conta, info_silencio,
            sem_mouse_salvar, reiniciar
        ]))
        .setup(move |app| {
            let mut pasta = app.path().app_data_dir()?;
            if teste() {
                pasta = pasta.join("teste");
            }
            std::fs::create_dir_all(&pasta)?;
            let h = app.handle().clone();
            // "Esconder o mouse em jogos" (2.7.11), ligado por padrão; vale ao abrir o programa.
            let sem_mouse = !pasta.join("mostrar-mouse").exists()
                && !pasta_antiga().map(|a| a.join("mostrar-mouse").exists() && !pasta.join("migrado").exists()).unwrap_or(false);
            let _ = ESTADO.set(Estado {
                eventos: Mutex::new(None),
                capturando: Mutex::new(Capturando::default()),
                transmitindo: AtomicBool::new(false),
                captura_em: Mutex::new(None),
                escolha: Mutex::new(None),
                ultimo_som: Mutex::new(None),
                ultimas_fontes: Mutex::new(vec![]),
                ultima_lista: Mutex::new(None),
                tela_da_live: Mutex::new(None),
                protegido: AtomicBool::new(false),
                visor_aberto: AtomicBool::new(false),
                toque_bandeja: Mutex::new(None),
                mic_liberado: Mutex::new(None),
                avisou_segundo_plano: AtomicBool::new(false),
                saindo: AtomicBool::new(false),
                minimizada: AtomicBool::new(false),
                maximizada: AtomicBool::new(false),
                focada: AtomicBool::new(false),
                tecla_emergencia: Mutex::new(String::new()),
                riscos: Mutex::new((None, 0)),
                vez_desempenho: AtomicU64::new(0),
                atualizando: AtomicBool::new(false),
                perguntando: AtomicBool::new(false),
                sem_mouse,
                aparelho: sistema::aparelho(),
                pasta,
                janelas: janelas::Janelas::default(),
            });
            trazer_escolhas_antigas(&h);
            som::restaurar_silencio(&h);   // 3.0.20: devolve as notificações do Windows se uma live terminou no meio
            if !teste() {
                sistema::migrar_iniciar_com_windows();
            }
            OCULTO_DESDE_INICIO.store(oculto, SeqCst);
            criar_principal(&h, oculto)?;
            if oculto {
                vigiar_partida(&h);
            }
            vigia_linha_principal(&h);
            criar_bandeja(&h)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao abrir o AstraScreenShare")
        .run(|app, e| match e {
            // Não fecha quando as janelas fecham: continua na bandeja.
            tauri::RunEvent::ExitRequested { api, code: None, .. } if !estado(app).saindo.load(SeqCst) => api.prevent_exit(),
            tauri::RunEvent::Exit => {
                som::parar_tudo();
                sistema::manter_tela_acordada(false);
            }
            _ => {}
        });
}
