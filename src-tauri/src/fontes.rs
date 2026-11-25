// Lista de telas e janelas com miniatura, feita pelo próprio programa (Windows GDI), para a janela
// "Transmitir tela" do Astra. O campo `selecao` é o nome que o WebView2 (em pt-BR) dá à fonte:
// é ele que vai no --auto-select-desktop-capture-source quando o WebView2 é recriado.
use base64::Engine;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::*;

const MINI_L: i32 = 320;
const MINI_A: i32 = 180;

#[derive(serde::Serialize, Clone)]
pub struct Fonte {
    pub id: String,
    pub tela: bool,
    pub nome: String,
    pub selecao: String,
    pub miniatura: String,
    // Monitor (x, y, largura, altura) em pixels de verdade; só nas telas (para os desenhos por cima).
    #[serde(skip)]
    pub retangulo: Option<(i32, i32, i32, i32)>,
}

// 3.0.17 (ASTRA-002): a escolha `f` é ambígua se o pedaço que vai para o WebView2 aparece no nome
// de outra fonte da mesma lista (o WebView2 pegaria a primeira que tiver o pedaço).
pub fn selecao_ambigua(f: &Fonte, lista: &[Fonte]) -> bool {
    crate::ambiguidade::ambigua(&f.selecao, lista.iter().filter(|g| g.id != f.id).map(|g| g.nome.as_str()))
}

// `sem_mouse` = a captura vai sem o WGC (opção "esconder o mouse em jogos", padrão). Ela muda a ORDEM em
// que o WebView2 numera as telas, e o nome "Tela N" daqui tem que bater com o dele.
pub fn listar(sem_mouse: bool) -> Vec<Fonte> {
    let mut lista = Vec::new();
    let monitores = monitores(sem_mouse);
    let varios = monitores.len() > 1;
    for (i, r) in monitores.iter().enumerate() {
        let nome = if varios { format!("Tela {}", i + 1) } else { "Tela inteira".to_string() };
        lista.push(Fonte {
            id: format!("tela:{}", i),
            tela: true,
            selecao: nome.clone(),
            nome,
            miniatura: unsafe { miniatura_da_tela(r) }.unwrap_or_default(),
            retangulo: Some((r.left, r.top, r.right - r.left, r.bottom - r.top)),
        });
    }
    for (hwnd, titulo) in janelas() {
        lista.push(Fonte {
            id: format!("janela:{}", hwnd.0 as isize),
            tela: false,
            selecao: pedaco_seguro(&titulo),
            nome: titulo,
            miniatura: unsafe { miniatura_da_janela(hwnd) }.unwrap_or_default(),
            retangulo: None,
        });
    }
    lista
}

// O WebView2 acha a fonte procurando um PEDAÇO do título. Acentos, "・", emojis e aspas se perdem
// na linha de comando, então vai o maior trecho só com letras comuns (ex.: "regras | LoL BR - Discord").
fn pedaco_seguro(titulo: &str) -> String {
    let mut melhor = "";
    for trecho in titulo.split(|c: char| !(c.is_ascii_graphic() || c == ' ') || c == '"' || c == '\\') {
        let t = trecho.trim();
        if t.len() > melhor.len() {
            melhor = t;
        }
    }
    if melhor.is_empty() { titulo.to_string() } else { melhor.to_string() }
}

// 3.0.19: TELAS INVERTIDAS. O WebView2 chama de "Tela 1, Tela 2..." na ordem dele, e a escolha vai pelo
// nome. Sem o WGC (padrão: esconder o mouse), o capturador dele (GDI/DirectX) numera na ordem dos
// dispositivos do Windows (EnumDisplayDevices: \\.\DISPLAY1, 2...). Com o WGC, na ordem do
// EnumDisplayMonitors. Antes daqui saía sempre a ordem do EnumDisplayMonitors -> com o mouse escondido, a
// "Tela 1" daqui podia ser a "Tela 2" dele.
fn monitores(sem_mouse: bool) -> Vec<RECT> {
    unsafe extern "system" fn cada(m: HMONITOR, _dc: HDC, r: *mut RECT, l: LPARAM) -> BOOL {
        let v = &mut *(l.0 as *mut Vec<(HMONITOR, RECT)>);
        v.push((m, *r));
        BOOL(1)
    }
    let mut v: Vec<(HMONITOR, RECT)> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(cada), LPARAM(&mut v as *mut _ as isize));
    }
    if !sem_mouse {
        return v.into_iter().map(|(_, r)| r).collect();
    }
    let ordem = ordem_dos_dispositivos();
    let mut com_posicao: Vec<(usize, RECT)> = v.into_iter().enumerate().map(|(i, (m, r))| {
        let pos = nome_do_monitor(m).and_then(|n| ordem.iter().position(|o| *o == n)).unwrap_or(1000 + i);
        (pos, r)
    }).collect();
    com_posicao.sort_by_key(|x| x.0);   // estável: sem nome conhecido, fica na ordem de antes
    com_posicao.into_iter().map(|x| x.1).collect()
}

fn texto_w(w: &[u16]) -> String {
    let n = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..n])
}

// "\\.\DISPLAY2" do monitor.
fn nome_do_monitor(m: HMONITOR) -> Option<String> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    let ok = unsafe { GetMonitorInfoW(m, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) }.as_bool();
    ok.then(|| texto_w(&info.szDevice))
}

// Os dispositivos de vídeo ATIVOS na ordem do Windows (a mesma que o capturador do WebView2 usa).
fn ordem_dos_dispositivos() -> Vec<String> {
    let mut v = Vec::new();
    for i in 0..64u32 {
        let mut dd = DISPLAY_DEVICEW::default();
        dd.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        if !unsafe { EnumDisplayDevicesW(windows::core::PCWSTR::null(), i, &mut dd, 0) }.as_bool() {
            break;
        }
        if dd.StateFlags.0 & DISPLAY_DEVICE_ACTIVE.0 != 0 {
            v.push(texto_w(&dd.DeviceName));
        }
    }
    v
}

fn janelas() -> Vec<(HWND, String)> {
    unsafe extern "system" fn cada(h: HWND, l: LPARAM) -> BOOL {
        let v = &mut *(l.0 as *mut Vec<HWND>);
        v.push(h);
        BOOL(1)
    }
    let mut todas: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(cada), LPARAM(&mut todas as *mut _ as isize));
    }
    let meu_pid = std::process::id();
    let mut saida = Vec::new();
    for h in todas {
        unsafe {
            if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
                continue;
            }
            let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
            if ex & WS_EX_TOOLWINDOW.0 != 0 {
                continue;
            }
            if GetWindow(h, GW_OWNER).map(|o| !o.0.is_null()).unwrap_or(false) {
                continue;
            }
            let mut escondida: u32 = 0;
            let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut escondida as *mut _ as *mut _, 4);
            if escondida != 0 {
                continue;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            if pid == meu_pid {
                continue;   // as janelas do próprio Astra não entram (efeito de espelho)
            }
            let n = GetWindowTextLengthW(h);
            if n <= 0 {
                continue;
            }
            let mut buf = vec![0u16; n as usize + 1];
            let lido = GetWindowTextW(h, &mut buf);
            let titulo = String::from_utf16_lossy(&buf[..lido as usize]);
            if titulo == "Program Manager" || titulo.trim().is_empty() {
                continue;
            }
            saida.push((h, titulo));
        }
    }
    saida
}

// Encaixa (largura x altura) dentro de 320x180 mantendo a proporção.
fn caber(l: i32, a: i32) -> (i32, i32) {
    if l <= 0 || a <= 0 {
        return (MINI_L, MINI_A);
    }
    let esc = f64::min(MINI_L as f64 / l as f64, MINI_A as f64 / a as f64);
    (((l as f64 * esc) as i32).max(1), ((a as f64 * esc) as i32).max(1))
}

unsafe fn miniatura_da_tela(r: &RECT) -> Option<String> {
    let (l, a) = (r.right - r.left, r.bottom - r.top);
    let tela = GetDC(None);
    let res = reduzir(tela, r.left, r.top, l, a);
    ReleaseDC(None, tela);
    res
}

unsafe fn miniatura_da_janela(h: HWND) -> Option<String> {
    let mut r = RECT::default();
    GetWindowRect(h, &mut r).ok()?;
    let (l, a) = (r.right - r.left, r.bottom - r.top);
    if l <= 0 || a <= 0 {
        return None;
    }
    // Desenha a janela inteira num bitmap do tamanho dela (PW_RENDERFULLCONTENT pega jogos e navegadores).
    let tela = GetDC(None);
    let dc = CreateCompatibleDC(Some(tela));
    let bmp = CreateCompatibleBitmap(tela, l, a);
    let antigo = SelectObject(dc, bmp.into());
    let ok = PrintWindow(h, dc, PRINT_WINDOW_FLAGS(2)).as_bool();
    let res = if ok { reduzir(dc, 0, 0, l, a) } else { None };
    SelectObject(dc, antigo);
    let _ = DeleteObject(bmp.into());
    let _ = DeleteDC(dc);
    ReleaseDC(None, tela);
    res
}

// Copia o pedaço (x, y, l, a) de `origem` reduzido para caber em 320x180 e devolve um JPEG em data URL.
unsafe fn reduzir(origem: HDC, x: i32, y: i32, l: i32, a: i32) -> Option<String> {
    let (ml, ma) = caber(l, a);
    let dc = CreateCompatibleDC(Some(origem));
    let bmp = CreateCompatibleBitmap(origem, ml, ma);
    let antigo = SelectObject(dc, bmp.into());
    SetStretchBltMode(dc, HALFTONE);
    let _ = SetBrushOrgEx(dc, 0, 0, None);
    let copiou = StretchBlt(dc, 0, 0, ml, ma, Some(origem), x, y, l, a, SRCCOPY).as_bool();
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: ml,
            biHeight: -ma, // de cima para baixo
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bgra = vec![0u8; (ml * ma * 4) as usize];
    SelectObject(dc, antigo);
    let linhas = GetDIBits(dc, bmp, 0, ma as u32, Some(bgra.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
    let _ = DeleteObject(bmp.into());
    let _ = DeleteDC(dc);
    if !copiou || linhas == 0 {
        return None;
    }
    let mut jpg = Vec::new();
    let enc = jpeg_encoder::Encoder::new(&mut jpg, 72);
    enc.encode(&bgra, ml as u16, ma as u16, jpeg_encoder::ColorType::Bgra).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&jpg)))
}
