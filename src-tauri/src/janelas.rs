// As janelas além da principal:
//  - captura (cap-a / cap-b): escondida, num WebView2 próprio, nasce com a fonte escolhida e manda a
//    imagem para a principal por WebRTC dentro do PC (ver web/astra-captura.js e src/ponte.js);
//  - mini tela: a janelinha do vídeo (window.open do app.js), fora do Alt+Tab e sem tirar o foco;
//  - pop-up do chat por cima do jogo, e os desenhos dos amigos por cima da tela transmitida.
use crate::{estado, sistema};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
pub struct Janelas {
    pub captura_atual: Mutex<Option<String>>,
    vez_captura: AtomicU32,
    perfis: Mutex<HashMap<String, Vec<u32>>>, // navegador do WebView2 de cada janela de captura
    pub minis: Mutex<Vec<String>>,
    vez_mini: AtomicU32,
    popup_fila: Mutex<Vec<String>>,
    popup_pronto: AtomicBool,
    vez_popup: AtomicU64,
    desenho_fila: Mutex<Vec<String>>,
    desenho_pronto: AtomicBool,
    vez_desenho: AtomicU64,
}

fn hwnd(w: &WebviewWindow) -> Option<windows::Win32::Foundation::HWND> {
    w.hwnd().ok().map(|h| windows::Win32::Foundation::HWND(h.0 as _))
}

fn principal(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("principal")
}

// ---------- captura ----------
pub fn pasta_perfil(app: &AppHandle, rotulo: &str) -> std::path::PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join(format!("captura-{}", rotulo))
}

// Cria a janela de captura (escondida) para a fonte `selecao`. Roda fora da thread da janela.
pub fn abrir_captura(app: &AppHandle, selecao: &str, sem_mouse: bool, largura: u32, altura: u32, qps: u32) -> Result<String, String> {
    let j = &estado(app).janelas;
    // A anterior (se sobrou) fecha antes.
    // 3.0.19: pega e SOLTA a trava antes de fechar (o fechar_captura pede a mesma trava).
    let velha = j.captura_atual.lock().unwrap().take();
    if let Some(velha) = velha {
        fechar_captura(app, &velha);
    }
    let rotulo = if j.vez_captura.fetch_add(1, SeqCst) % 2 == 0 { "cap-a" } else { "cap-b" }.to_string();
    if let Some(w) = app.get_webview_window(&rotulo) {
        let _ = w.destroy();
    }
    // O WebView2 só aceita argumentos novos quando o navegador antigo do mesmo perfil já saiu.
    let sobras = j.perfis.lock().unwrap().remove(&rotulo).unwrap_or_default();
    for pid in sobras {
        sistema::esperar_ou_encerrar(pid, 3000);
    }
    // --lang=pt-BR: o nome das telas ("Tela inteira", "Tela 1") depende do idioma, e é por ele que a
    // fonte é escolhida. AllowWgcScreenCapturer desligado = captura antiga, que esconde o mouse em jogos.
    let desligar = format!("msWebOOUI,msPdfOOUI,msSmartScreenProtection,WebRtcHideLocalIpsWithMdns,SpareRendererForSitePerProcess,Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,CalculateNativeWinOcclusion{}",
        if sem_mouse { ",AllowWgcScreenCapturer" } else { "" });
    let args = format!("--disable-features={} --lang=pt-BR --auto-select-desktop-capture-source=\"{}\"", desligar, selecao.replace('"', ""));
    let pagina = format!("astra-captura.html?l={}&a={}&q={}", largura.min(4096), altura.min(4096), qps.clamp(1, 240));
    let antes = sistema::navegadores_filhos();
    let (tx, rx) = std::sync::mpsc::channel();
    let (app2, r2, pasta) = (app.clone(), rotulo.clone(), pasta_perfil(app, &rotulo));
    app.run_on_main_thread(move || {
        let r = WebviewWindowBuilder::new(&app2, &r2, WebviewUrl::App(pagina.into()))
            .title("Astra captura")
            .inner_size(320.0, 180.0)
            .visible(false)
            .skip_taskbar(true)
            .focused(false)
            .data_directory(pasta)
            .additional_browser_args(&args)
            .on_navigation(|u| crate::origem_exata(u, &["/astra-captura.html"]))
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .build()
            .map(|w| {
                if let Some(h) = hwnd(&w) {
                    sistema::janela_ferramenta(h, true);
                }
            })
            .map_err(|e| e.to_string());
        let _ = tx.send(r);
    }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())??;
    let novos: Vec<u32> = sistema::navegadores_filhos().into_iter().filter(|p| !antes.contains(p)).collect();
    j.perfis.lock().unwrap().insert(rotulo.clone(), novos);
    *j.captura_atual.lock().unwrap() = Some(rotulo.clone());
    // 3.0.1: some com a barra "está compartilhando sua tela" do WebView2 enquanto esta captura existir.
    // Só olha os navegadores que nasceram com ela (o da janela principal já existia antes).
    let (app3, r3) = (app.clone(), rotulo.clone());
    std::thread::spawn(move || {
        let inicio = std::time::Instant::now();
        loop {
            let rapido = inicio.elapsed().as_secs() < 8;   // a barra aparece logo no começo
            std::thread::sleep(std::time::Duration::from_millis(if rapido { 60 } else { 400 }));
            if app3.get_webview_window(&r3).is_none() {
                break;
            }
            let pids: Vec<u32> = sistema::navegadores_filhos().into_iter().filter(|p| !antes.contains(p)).collect();
            sistema::esconder_janelas_de(&pids);
        }
    });
    Ok(rotulo)
}

// Fecha no fundo: o navegador dela tem 5 s para sair sozinho.
pub fn fechar_captura(app: &AppHandle, rotulo: &str) {
    if !rotulo.starts_with("cap-") {
        return;
    }
    {
        let mut atual = estado(app).janelas.captura_atual.lock().unwrap();
        if atual.as_deref() == Some(rotulo) {
            atual.take();
        }
    }
    let (app, rotulo) = (app.clone(), rotulo.to_string());
    std::thread::spawn(move || {
        if let Some(v) = app.get_webview_window(&rotulo) {
            let (tx, rx) = std::sync::mpsc::channel();
            let _ = v.with_webview(move |wv| {
                let _ = tx.send(unsafe { wv.controller().Close() }.is_ok());
            });
            let _ = rx.recv_timeout(Duration::from_secs(2));
            let _ = v.destroy();
        }
        let j = &estado(&app).janelas;
        let pids = j.perfis.lock().unwrap().get(&rotulo).cloned().unwrap_or_default();
        for pid in &pids {
            sistema::esperar_ou_encerrar(*pid, 5000);
        }
        let mut p = j.perfis.lock().unwrap();
        if p.get(&rotulo) == Some(&pids) {
            p.remove(&rotulo);
        }
    });
}

pub fn fechar_todas_capturas(app: &AppHandle) {
    for r in ["cap-a", "cap-b"] {
        if app.get_webview_window(r).is_some() {
            fechar_captura(app, r);
        }
    }
}

pub fn sinal_para_captura(app: &AppHandle, msg: &str) {
    let Some(r) = estado(app).janelas.captura_atual.lock().unwrap().clone() else { return };
    if let Some(w) = app.get_webview_window(&r) {
        let _ = w.eval(format!("window.__sinal && window.__sinal({})", serde_json::to_string(msg).unwrap_or_default()));
    }
}

// ---------- mini tela ----------
// O app.js abre "about:blank" e põe o vídeo nela (precisa ser do mesmo WebView2: o opener mexe no
// documento dela). Qualquer outro window.open: links da web abrem no navegador, o resto não abre.
pub fn nova_janela(app: &AppHandle, url: tauri::Url, recursos: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    if url.as_str() != "about:blank" {
        sistema::abrir_no_navegador(url.as_str());
        return NewWindowResponse::Deny;
    }
    let j = &estado(app).janelas;
    let rotulo = format!("mini-{}", j.vez_mini.fetch_add(1, SeqCst));
    let (x, y, l, a, esc) = sistema::area_do_monitor(false);
    let (largura, altura) = (480.0, 270.0);
    let px = (x as f64 / esc) + (l as f64 / esc) - largura - 16.0;
    let py = (y as f64 / esc) + (a as f64 / esc) - altura - 16.0;
    let construida = WebviewWindowBuilder::new(app, &rotulo, WebviewUrl::External("about:blank".parse().unwrap()))
        .window_features(recursos)
        .title("Mini tela")
        .inner_size(largura, altura)
        .min_inner_size(240.0, 135.0)
        .position(px, py)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(false)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .on_navigation(|u| u.as_str() == "about:blank")   // 2.7.33: a mini tela fica em about:blank
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
        .build();
    match construida {
        Ok(w) => {
            if let Some(h) = hwnd(&w) {
                sistema::janela_ferramenta(h, false);
                if estado(app).protegido.load(SeqCst) {
                    sistema::proteger(h, true);
                }
                sistema::mostrar_sem_foco(h);   // aparece sem tirar o foco do jogo
            }
            j.minis.lock().unwrap().push(rotulo.clone());
            fechar_no_close(app, &w, &rotulo);
            let app2 = app.clone();
            w.on_window_event(move |e| {
                if let tauri::WindowEvent::Destroyed = e {
                    estado(&app2).janelas.minis.lock().unwrap().retain(|r| *r != rotulo);
                }
            });
            NewWindowResponse::Create { window: w }
        }
        Err(_) => NewWindowResponse::Deny,
    }
}

// 3.0.3: o close() do JavaScript (app.js: janelaMini.close()) chega no WebView2 como WindowCloseRequested.
// O wry só destrói a janelinha de DENTRO (a do WebView); a janela de verdade ficava aberta, PRETA, por
// cima de tudo. Aqui a janela inteira fecha junto.
fn fechar_no_close(app: &AppHandle, w: &WebviewWindow, rotulo: &str) {
    let (app2, r2) = (app.clone(), rotulo.to_string());
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let core: ICoreWebView2 = core;
        let mut token = Default::default();
        let _ = core.add_WindowCloseRequested(
            &webview2_com::WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                let (a, r) = (app2.clone(), r2.clone());
                let _ = app2.run_on_main_thread(move || {
                    if let Some(j) = a.get_webview_window(&r) {
                        let _ = j.destroy();
                    }
                });
                Ok(())
            })),
            &mut token,
        );
    });
}

// Fecha todas as mini telas (comando fechar_mini da página e ao restaurar a janela principal).
pub fn fechar_minis(app: &AppHandle) {
    let rotulos: Vec<String> = estado(app).janelas.minis.lock().unwrap().clone();
    for r in rotulos {
        if let Some(w) = app.get_webview_window(&r) {
            let _ = w.destroy();
        }
    }
    for (r, w) in app.webview_windows() {
        if r.starts_with("mini-") {
            let _ = w.destroy();
        }
    }
}

// Transmitindo um monitor inteiro: as janelas do Astra ficam de fora da captura (sem efeito de espelho).
pub fn proteger_janelas(app: &AppHandle) {
    let st = estado(app);
    let sim = st.protegido.load(SeqCst);
    if let Some(h) = principal(app).as_ref().and_then(hwnd) {
        sistema::proteger(h, sim || st.visor_aberto.load(SeqCst));
    }
    for r in st.janelas.minis.lock().unwrap().iter() {
        if let Some(h) = app.get_webview_window(r).as_ref().and_then(hwnd) {
            sistema::proteger(h, sim);
        }
    }
    if let Some(h) = app.get_webview_window("popup").as_ref().and_then(hwnd) {
        sistema::proteger(h, sim || crate::som::silencio_ligado());
    }
}

// Diário só da versão de teste (%TEMP%\astra-tauri.txt).
pub fn diario(linha: &str) {
    if cfg!(feature = "teste") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("astra-tauri.txt")) {
            let _ = writeln!(f, "{:?} {}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0), linha);
        }
    }
}

// ---------- janelas transparentes por cima de tudo (pop-up e desenhos) ----------
fn criar_sobreposta(app: &AppHandle, rotulo: &str, pagina: &str, pronto: impl Fn(&AppHandle) + Send + Sync + 'static) -> Option<WebviewWindow> {
    let app2 = app.clone();
    let r2 = rotulo.to_string();
    let mut b = WebviewWindowBuilder::new(app, rotulo, WebviewUrl::App(pagina.into()));
    if let Some(p) = crate::perfil_teste(app) {
        b = b.data_directory(p);   // mesmo perfil da principal (o WebView2 exige)
    }
    let w = b
        .title(if rotulo == "popup" { "AstraScreenShare - mensagens" } else { "AstraScreenShare - desenhos" })
        .inner_size(300.0, 300.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .additional_browser_args(&crate::args_principal())
        .on_navigation(|u| u.host_str() == Some("tauri.localhost"))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
        .on_page_load(move |_, p| {
            diario(&format!("{} carregou: {:?} {}", r2, p.event(), p.url()));
            if p.event() == tauri::webview::PageLoadEvent::Finished {
                pronto(&app2);
            }
        })
        .build();
    diario(&format!("{} criada: {:?}", rotulo, w.as_ref().map(|_| ()).map_err(|e| e.to_string())));
    let w = w.ok()?;
    let _ = w.set_ignore_cursor_events(true);
    if let Some(h) = hwnd(&w) {
        sistema::janela_ferramenta(h, true);
    }
    Some(w)
}

// ---------- pop-up do chat ----------
// O pop-up é desenhado para uma tela de 670 px de largura e aumenta na proporção da tela de verdade.
// 3.0.15: cada mexida (posição, tamanho, zoom) numa janela do WebView2 espera o processo do navegador dele;
// com o jogo pesando, isso prendia a janela inteira. Só mexe quando a tela mudou.
static POPUP_POS: Mutex<Option<(i32, i32, i32, i32, u64)>> = Mutex::new(None);

fn posicionar_popup(w: &WebviewWindow) {
    let (x, y, l, a, esc) = sistema::area_do_monitor(true);
    {
        let chave = (x, y, l as i32, a as i32, esc.to_bits());
        let mut g = POPUP_POS.lock().unwrap();
        if *g == Some(chave) {
            return;
        }
        *g = Some(chave);
    }
    let largura_dip = l as f64 / esc;
    let zoom = (largura_dip / 670.0).max(1.0);
    let lp = (200.0 * zoom * esc).round() as i32;
    let ap = (a as f64 * 0.6).round() as i32;
    let _ = w.set_position(PhysicalPosition::new(x + l - lp - (12.0 * esc) as i32, y + (12.0 * esc) as i32));
    let _ = w.set_size(PhysicalSize::new(lp as u32, ap as u32));
    let _ = w.set_zoom(zoom);
}

fn enviar_popup(app: &AppHandle, m: String) {
    diario(&format!("enviar_popup existe={}", app.get_webview_window("popup").is_some()));
    let Some(w) = app.get_webview_window("popup") else { return };
    if !w.is_visible().unwrap_or(false) {
        posicionar_popup(&w);
        if let Some(h) = hwnd(&w) {
            sistema::mostrar_sem_foco(h);
        }
    }
    let _ = w.eval(format!("window.receber && window.receber({})", m));
}

pub fn mostrar_no_popup(app: &AppHandle, m: serde_json::Value) {
    diario(&format!("popup pedido: visivel={:?} focada={}", principal(app).map(|p| p.is_visible()), estado(app).focada.load(SeqCst)));
    if let Some(p) = principal(app) {
        if p.is_visible().unwrap_or(false) && estado(app).focada.load(SeqCst) {
            return;   // a janela já está na frente
        }
    }
    let tem_texto = m.get("texto").and_then(|t| t.as_str()).map(|t| !t.is_empty()).unwrap_or(false);
    let existe = app.get_webview_window("popup");
    if !tem_texto && !existe.as_ref().map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false) {
        return;
    }
    let j = &estado(app).janelas;
    j.vez_popup.fetch_add(1, SeqCst);
    let txt = m.to_string();
    if existe.is_none() {
        *POPUP_POS.lock().unwrap() = None;   // janela nova: posiciona de novo
        j.popup_pronto.store(false, SeqCst);
        j.popup_fila.lock().unwrap().push(txt);
        let protegido = estado(app).protegido.load(SeqCst) || crate::som::silencio_ligado();
        let w = criar_sobreposta(app, "popup", "astra-popup.html", |app| {
            let j = &estado(app).janelas;
            j.popup_pronto.store(true, SeqCst);
            let fila: Vec<String> = j.popup_fila.lock().unwrap().drain(..).collect();
            for m in fila {
                enviar_popup(app, m);
            }
        });
        if let (Some(w), true) = (w, protegido) {
            if let Some(h) = hwnd(&w) {
                sistema::proteger(h, true);   // ao vivo: o pop-up não entra na transmissão
            }
        }
        return;
    }
    if !j.popup_pronto.load(SeqCst) {
        j.popup_fila.lock().unwrap().push(txt);
        return;
    }
    enviar_popup(app, txt);
}

// Sem mensagens: esconde, e depois de 1 minuto parado fecha de vez (libera a memória).
pub fn popup_vazio(app: &AppHandle) {
    let Some(w) = app.get_webview_window("popup") else { return };
    let _ = w.hide();
    let j = &estado(app).janelas;
    let vez = j.vez_popup.fetch_add(1, SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(600));
        if estado(&app).janelas.vez_popup.load(SeqCst) == vez {
            if let Some(w) = app.get_webview_window("popup") {
                if !w.is_visible().unwrap_or(true) {
                    *POPUP_POS.lock().unwrap() = None;
                    let _ = w.destroy();
                }
            }
        }
    });
}

// ---------- desenhos dos amigos ----------
fn enviar_desenho(app: &AppHandle, r: String) {
    let Some(w) = app.get_webview_window("desenho") else { return };
    if !w.is_visible().unwrap_or(false) {
        let tela = *estado(app).tela_da_live.lock().unwrap();
        if let Some((x, y, l, a)) = tela {
            let _ = w.set_position(PhysicalPosition::new(x, y));
            let _ = w.set_size(PhysicalSize::new(l as u32, a as u32));
        }
        if let Some(h) = hwnd(&w) {
            sistema::mostrar_sem_foco(h);
        }
    }
    let _ = w.eval(format!("window.desenhar && window.desenhar({})", r));
}

// 3.0.20: a janela dos desenhos é criada FORA da linha principal (o comando `risco` é assíncrono). Criar uma janela
// do WebView2 de dentro da linha principal (run_on_main_thread) prendia o app por 5 a 10 s no primeiro risco da
// live (erros-app: "Linha principal presa ... último comando: risco"); o próprio Tauri avisa que isso trava no Windows.
static CRIANDO_DESENHO: AtomicBool = AtomicBool::new(false);

pub fn garantir_desenho(app: &AppHandle) {
    if app.get_webview_window("desenho").is_some() || CRIANDO_DESENHO.swap(true, SeqCst) {
        return;
    }
    estado(app).janelas.desenho_pronto.store(false, SeqCst);
    let w = criar_sobreposta(app, "desenho", "astra-desenho.html", |app| {
        let j = &estado(app).janelas;
        j.desenho_pronto.store(true, SeqCst);
        let fila: Vec<String> = j.desenho_fila.lock().unwrap().drain(..).collect();
        for r in fila {
            enviar_desenho(app, r);
        }
    });
    if let Some(h) = w.as_ref().and_then(hwnd) {
        let h = h.0 as isize;
        // você vê; a transmissão não (os amigos veem por cima do vídeo)
        let _ = app.run_on_main_thread(move || sistema::proteger(windows::Win32::Foundation::HWND(h as _), true));
    }
    CRIANDO_DESENHO.store(false, SeqCst);
}

pub fn desenhar(app: &AppHandle, r: serde_json::Value) {
    diario("desenhar pedido");
    let j = &estado(app).janelas;
    let txt = r.to_string();
    if app.get_webview_window("desenho").is_none() || !j.desenho_pronto.load(SeqCst) {
        // a janela está sendo criada (garantir_desenho): o risco espera na fila e sai quando a página carregar
        let mut f = j.desenho_fila.lock().unwrap();
        if f.len() < 600 {
            f.push(txt);
        }
    } else if !j.desenho_pronto.load(SeqCst) {
        j.desenho_fila.lock().unwrap().push(txt);
    } else {
        enviar_desenho(app, txt);
    }
    // Os riscos somem em 3 s: depois esconde a janela, e com 1 minuto parada fecha de vez.
    let vez = j.vez_desenho.fetch_add(1, SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        if estado(&app).janelas.vez_desenho.load(SeqCst) != vez {
            return;
        }
        if let Some(w) = app.get_webview_window("desenho") {
            let _ = w.hide();
        }
        // 3.0.20: não destrói mais depois de 1 min parada (recriar no meio da live prendia o app)
    });
}

pub fn fechar_desenho(app: &AppHandle) {
    estado(app).janelas.vez_desenho.fetch_add(1, SeqCst);
    if let Some(w) = app.get_webview_window("desenho") {
        // 3.0.20: apaga e esconde em vez de destruir (recriar a janela do WebView2 prende o app por segundos)
        let _ = w.eval("window.limpar && window.limpar()");
        let _ = w.hide();
    }
}

// 3.0.10: TELA BRANCA. Com jogo pesado aberto, o Windows/placa de vídeo pode matar o processo que
// desenha a página (renderer do WebView2). Sem isto a janela fica branca para sempre (só fechando).
// Agora: página morreu -> recarrega sozinha (no máx. 3 vezes em 2 min, para não ficar em laço);
// o navegador inteiro morreu -> reabre o programa. Depois que a página volta, avisa o dono (erro-app).
pub static FALHA_PENDENTE: Mutex<Option<String>> = Mutex::new(None);
static RECARGAS: Mutex<Vec<std::time::Instant>> = Mutex::new(Vec::new());

pub fn vigiar_processo(app: &AppHandle, w: &WebviewWindow) {
    let app2 = app.clone();
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let core: ICoreWebView2 = core;
        let mut token = Default::default();
        let _ = core.add_ProcessFailed(
            &webview2_com::ProcessFailedEventHandler::create(Box::new(move |quem, args| {
                let mut tipo = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(a) = &args {
                    let _ = a.ProcessFailedKind(&mut tipo);
                }
                let nome = if tipo == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED { "navegador" }
                    else if tipo == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED { "pagina" }
                    else if tipo == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE { "pagina-travada" }
                    else if tipo == COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED { "placa-de-video" }
                    else if tipo == COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED { "quadro" }
                    else { "outro" };
                // 3.0.12: o motivo e o código de saída (falta de memória? erro?) vão junto no aviso.
                let mut detalhe = String::new();
                if let Some(a) = &args {
                    if let Ok(a2) = windows::core::Interface::cast::<ICoreWebView2ProcessFailedEventArgs2>(a) {
                        let mut motivo = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
                        let mut codigo: i32 = 0;
                        let _ = a2.Reason(&mut motivo);
                        let _ = a2.ExitCode(&mut codigo);
                        let m = if motivo == COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY { "sem-memoria" }
                            else if motivo == COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED { "erro" }
                            else if motivo == COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE { "travou" }
                            else if motivo == COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED { "encerrado" }
                            else if motivo == COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED { "nao-abriu" }
                            else { "inesperado" };
                        detalhe = format!(" [{} 0x{:08X}]", m, codigo as u32);
                    }
                }
                diario(&format!("processo do WebView2 caiu: {} ({}){}", nome, tipo.0, detalhe));
                let mut acao = "nada";
                if tipo == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
                    let agora = std::time::Instant::now();
                    let mut r = RECARGAS.lock().unwrap();
                    r.retain(|t| agora.duration_since(*t) < Duration::from_secs(120));
                    if r.len() < 3 {
                        r.push(agora);
                        if let Some(c) = &quem {
                            let _ = c.Reload();
                            acao = "recarregou";
                        }
                    } else {
                        acao = "desistiu (muitas quedas)";
                    }
                } else if tipo == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                    // A janela não tem mais navegador: só abrindo o programa de novo.
                    let a = app2.clone();
                    let _ = app2.run_on_main_thread(move || { a.restart(); });
                    acao = "reabriu";
                }
                let mut p = FALHA_PENDENTE.lock().unwrap();
                if p.is_none() {
                    *p = Some(format!("WebView2 caiu: {}{} -> {}", nome, detalhe, acao));
                }
                Ok(())
            })),
            &mut token,
        );
    });
}

// Chamado quando a página principal termina de carregar: manda o aviso guardado (se houver).
pub static PILHA_PENDENTE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn avisar_falha(w: &WebviewWindow) {
    let Some(msg) = FALHA_PENDENTE.lock().unwrap().take() else { return };
    let pilha = PILHA_PENDENTE.lock().unwrap().take().unwrap_or_default();
    let js = format!(
        "setTimeout(()=>{{try{{enviar({{t:'erro-app',msg:{},onde:'webview2',pilha:{},versao:(typeof programa!=='undefined'&&programa&&programa.versao)||'pc'}})}}catch(e){{}}}},15000)",
        serde_json::to_string(&msg).unwrap_or_else(|_| "\"?\"".into()),
        serde_json::to_string(&pilha).unwrap_or_else(|_| "\"\"".into())
    );
    let _ = w.eval(js);
}
