// Tudo o que fala direto com o Windows: registro, iniciar com o Windows, código do aparelho,
// clique de verdade, processos do programa, desempenho, tela acordada, avisos, estilos de janela.
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HWND};
use windows::Win32::System::Registry::*;

// ---------- registro ----------
pub fn ler_registro(raiz: HKEY, chave: &str, valor: &str) -> Option<String> {
    let mut buf = vec![0u16; 2048];
    let mut tam = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(raiz, &HSTRING::from(chave), &HSTRING::from(valor), RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ,
                     None, Some(buf.as_mut_ptr() as *mut _), Some(&mut tam))
    };
    if r.is_err() {
        return None;
    }
    let n = (tam as usize / 2).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..n.min(buf.len())]))
}

fn gravar_registro(chave: &str, valor: &str, dado: Option<&str>) {
    unsafe {
        let mut h = HKEY::default();
        if RegCreateKeyW(HKEY_CURRENT_USER, &HSTRING::from(chave), &mut h).is_err() {
            return;
        }
        match dado {
            Some(d) => {
                let w: Vec<u16> = d.encode_utf16().chain(std::iter::once(0)).collect();
                let bytes = std::slice::from_raw_parts(w.as_ptr() as *const u8, w.len() * 2);
                let _ = RegSetValueExW(h, &HSTRING::from(valor), None, REG_SZ, Some(bytes));
            }
            None => {
                let _ = RegDeleteValueW(h, &HSTRING::from(valor));
            }
        }
        let _ = RegCloseKey(h);
    }
}

// ---------- iniciar com o Windows ----------
// O mesmo nome que o programa antigo (Electron) usava, para a escolha da pessoa continuar valendo.
const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const NOME_RUN: &str = "com.astra.screenshare";

fn comando_iniciar() -> String {
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    format!("\"{}\" --oculto", exe)
}

pub fn iniciar_com_windows() -> bool {
    ler_registro(HKEY_CURRENT_USER, RUN, NOME_RUN).map(|v| v == comando_iniciar()).unwrap_or(false)
}

pub fn definir_iniciar_com_windows(sim: bool) {
    if sim { gravar_registro(RUN, NOME_RUN, Some(&comando_iniciar())) } else { gravar_registro(RUN, NOME_RUN, None) }
}

// Veio do programa antigo com "Iniciar com o Windows" ligado: aponta para este programa.
pub fn migrar_iniciar_com_windows() {
    if let Some(v) = ler_registro(HKEY_CURRENT_USER, RUN, NOME_RUN) {
        if v != comando_iniciar() && v.to_lowercase().contains("astrascreenshare") {
            definir_iniciar_com_windows(true);
        }
    }
}

// ---------- código do aparelho (igual ao do programa antigo, para os banimentos) ----------
pub fn aparelho() -> String {
    let limpar = |s: Option<String>| s.unwrap_or_default().trim().replace(['{', '}'], "").to_lowercase();
    let guid = limpar(ler_registro(HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Cryptography", "MachineGuid"));
    let uuid = limpar(ler_registro(HKEY_LOCAL_MACHINE, "SYSTEM\\HardwareConfig", "LastConfig"));
    if guid.is_empty() && uuid.is_empty() {
        return String::new();
    }
    hex(&Sha256::digest(format!("astra-aparelho-v1|{}|{}", guid, uuid).as_bytes()))
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

// ---------- depurador ----------
// Programa aberto com depurador remoto (outro programa lendo o login): não abre. Vale para os
// argumentos e também para as variáveis e políticas do Windows que o WebView2 lê sozinho.
pub fn com_depurador() -> bool {
    let ruim = |s: &str| {
        let s = s.to_lowercase();
        s.contains("remote-debugging") || s.contains("--inspect") || s.contains("js-flags") || s.contains("remote-allow-origins")
    };
    if std::env::args().skip(1).any(|a| ruim(&a)) {
        return true;
    }
    let exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).unwrap_or_default();
    for raiz in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for nome in [exe.as_str(), "*"] {
            for pol in ["AdditionalBrowserArguments", "BrowserExecutableFolder", "ReleaseChannelPreference"] {
                if let Some(v) = ler_registro(raiz, &format!("Software\\Policies\\Microsoft\\Edge\\WebView2\\{}", pol), nome) {
                    if pol != "AdditionalBrowserArguments" || ruim(&v) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

// O WebView2 obedece variáveis WEBVIEW2_*: tira todas antes de abrir qualquer janela.
pub fn limpar_variaveis_webview2() {
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_uppercase().starts_with("WEBVIEW2_") {
            std::env::remove_var(k);
        }
    }
}

// ---------- clique de verdade ----------
// O Windows guarda a hora do último clique/tecla do usuário (script nenhum consegue mudar).
// Junto com "a janela da frente é a do Astra", é o mesmo que o Electron chamava de input-event.
pub fn ms_desde_ultima_entrada() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe {
        if !GetLastInputInfo(&mut li).as_bool() {
            return u64::MAX;
        }
        GetTickCount().wrapping_sub(li.dwTime) as u64
    }
}

pub fn janela_da_frente_eh(hwnd: HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};
    unsafe {
        let f = GetForegroundWindow();
        !f.0.is_null() && (f == hwnd || GetAncestor(f, GA_ROOT) == hwnd)
    }
}

// ---------- processos ----------
pub struct Processo {
    pub pid: u32,
    pub pai: u32,
    pub nome: String,
}

pub fn processos() -> Vec<Processo> {
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    let mut v = Vec::new();
    unsafe {
        let Ok(foto) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return v };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(foto, &mut e).is_ok();
        while ok {
            let fim = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            v.push(Processo { pid: e.th32ProcessID, pai: e.th32ParentProcessID, nome: String::from_utf16_lossy(&e.szExeFile[..fim]) });
            ok = Process32NextW(foto, &mut e).is_ok();
        }
        let _ = CloseHandle(foto);
    }
    v
}

// Este programa e todos os processos abertos por ele (WebView2, astra-audio...).
pub fn arvore() -> Vec<u32> {
    let todos = processos();
    let mut ids = vec![std::process::id()];
    let mut i = 0;
    while i < ids.len() {
        let p = ids[i];
        for x in &todos {
            if x.pai == p && !ids.contains(&x.pid) && x.pid != 0 {
                ids.push(x.pid);
            }
        }
        i += 1;
    }
    ids
}

pub fn navegadores_filhos() -> Vec<u32> {
    let meu = std::process::id();
    processos().into_iter().filter(|p| p.pai == meu && p.nome.eq_ignore_ascii_case("msedgewebview2.exe")).map(|p| p.pid).collect()
}

// Espera o processo sair sozinho; se passar do tempo, encerra.
pub fn esperar_ou_encerrar(pid: u32, ms: u32) -> &'static str {
    use windows::Win32::System::Threading::*;
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, false, pid) else { return "já tinha saído" };
        let txt = if WaitForSingleObject(h, ms) == windows::Win32::Foundation::WAIT_OBJECT_0 {
            "saiu sozinho"
        } else {
            let _ = TerminateProcess(h, 0);
            let _ = WaitForSingleObject(h, 2000);
            "encerrado"
        };
        let _ = CloseHandle(h);
        txt
    }
}

// ---------- desempenho ----------
fn ft(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

struct Antes {
    quando: std::time::Instant,
    procs: HashMap<u32, u64>,
    sistema: Option<(u64, u64)>, // (ocioso, total)
}
static ANTES: Mutex<Option<Antes>> = Mutex::new(None);

pub fn nucleos() -> u32 {
    std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1)
}

// (cpu % do programa, RAM do programa em MB, cpu % do PC, RAM usada MB, RAM total MB)
pub fn medir(pids: &[u32]) -> (Option<u32>, u64, Option<u32>, u64, u64) {
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX};
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::*;
    let mut tempos = HashMap::new();
    let mut ram: u64 = 0;
    for &pid in pids {
        unsafe {
            let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { continue };
            let (mut c, mut s, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
            if GetProcessTimes(h, &mut c, &mut s, &mut k, &mut u).is_ok() {
                tempos.insert(pid, ft(k) + ft(u));
            }
            let mut m = PROCESS_MEMORY_COUNTERS_EX { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32, ..Default::default() };
            if GetProcessMemoryInfo(h, &mut m as *mut _ as *mut PROCESS_MEMORY_COUNTERS, m.cb).is_ok() {
                ram += m.PrivateUsage as u64;
            }
            let _ = CloseHandle(h);
        }
    }
    let (mut oc, mut kn, mut us) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    let sistema = unsafe { windows::Win32::System::Threading::GetSystemTimes(Some(&mut oc), Some(&mut kn), Some(&mut us)) }
        .ok()
        .map(|_| (ft(oc), ft(kn) + ft(us)));
    let agora = std::time::Instant::now();
    let mut a = ANTES.lock().unwrap();
    let (mut cpu_app, mut cpu_pc) = (None, None);
    if let Some(ant) = a.as_ref() {
        let dt = agora.duration_since(ant.quando).as_nanos() as f64 / 100.0; // em unidades de 100 ns
        if dt > 0.0 {
            let mut gasto = 0u64;
            for (pid, t) in &tempos {
                if let Some(t0) = ant.procs.get(pid) {
                    gasto += t.saturating_sub(*t0);
                }
            }
            cpu_app = Some(((gasto as f64 * 100.0) / (dt * nucleos() as f64)).round().min(100.0) as u32);
        }
        if let (Some((o1, t1)), Some((o0, t0))) = (sistema, ant.sistema) {
            let tot = t1.saturating_sub(t0);
            if tot > 0 {
                cpu_pc = Some((((tot - o1.saturating_sub(o0).min(tot)) as f64 * 100.0) / tot as f64).round() as u32);
            }
        }
    }
    *a = Some(Antes { quando: agora, procs: tempos, sistema });
    let mut mem = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    let _ = unsafe { GlobalMemoryStatusEx(&mut mem) };
    let total = mem.ullTotalPhys / 1_048_576;
    let livre = mem.ullAvailPhys / 1_048_576;
    (cpu_app, ram / 1_048_576, cpu_pc, total.saturating_sub(livre), total)
}

// ---------- tela acordada (modo relaxado) ----------
static ACORDADA: Mutex<Option<std::sync::mpsc::Sender<()>>> = Mutex::new(None);

pub fn manter_tela_acordada(sim: bool) {
    use windows::Win32::System::Power::*;
    let mut a = ACORDADA.lock().unwrap();
    if sim && a.is_none() {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
            let _ = rx.recv();
            SetThreadExecutionState(ES_CONTINUOUS);
        });
        *a = Some(tx);
    } else if !sim {
        a.take();
    }
}

// ---------- estilos de janela ----------
// Janela de ferramenta: fora do Alt+Tab e da barra de tarefas. `sem_foco`: um clique nela não tira o
// foco do jogo. `atravessar`: os cliques passam para o que está atrás.
pub fn janela_ferramenta(hwnd: HWND, sem_foco: bool) {
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let mut ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        ex |= WS_EX_TOOLWINDOW.0;
        ex &= !WS_EX_APPWINDOW.0;
        if sem_foco {
            ex |= WS_EX_NOACTIVATE.0;
        }
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex as i32);
    }
}

// Aparece sem tirar o foco de quem está na frente, e por cima de tudo.
pub fn mostrar_sem_foco(hwnd: HWND) {
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

// 3.0.1: o WebView2 da janela de captura abre a barra "http://tauri.localhost está compartilhando sua
// tela" (janela solta do navegador dele). Esconde toda janela visível de primeiro nível desses processos:
// a janela de captura em si é do nosso processo, e a página dela fica numa janela-filha.
pub fn esconder_janelas_de(pids: &[u32]) -> usize {
    use windows::core::BOOL;
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::UI::WindowsAndMessaging::*;
    struct Busca<'a> { pids: &'a [u32], escondidas: usize }
    unsafe extern "system" fn cada(h: HWND, l: LPARAM) -> BOOL {
        let b = unsafe { &mut *(l.0 as *mut Busca) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        if pid != 0 && b.pids.contains(&pid) && unsafe { IsWindowVisible(h) }.as_bool() {
            let _ = unsafe { ShowWindow(h, SW_HIDE) };
            b.escondidas += 1;
        }
        BOOL(1)
    }
    if pids.is_empty() {
        return 0;
    }
    let mut b = Busca { pids, escondidas: 0 };
    unsafe {
        let _ = EnumWindows(Some(cada), LPARAM(&mut b as *mut Busca as isize));
    }
    b.escondidas
}

// O Windows não deixa tirar print nem gravar a janela (a transmissão também não a vê).
pub fn proteger(hwnd: HWND, sim: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    unsafe {
        let _ = SetWindowDisplayAffinity(hwnd, if sim { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE });
    }
}

pub fn piscar(hwnd: HWND, sim: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{FlashWindowEx, FLASHWINFO, FLASHW_ALL, FLASHW_STOP, FLASHW_TIMERNOFG};
    let f = FLASHWINFO {
        cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
        hwnd,
        dwFlags: if sim { FLASHW_ALL | FLASHW_TIMERNOFG } else { FLASHW_STOP },
        uCount: 0,
        dwTimeout: 0,
    };
    unsafe {
        let _ = FlashWindowEx(&f);
    }
}

// Área de trabalho (sem a barra de tarefas) do monitor onde está o mouse, ou do principal.
pub fn area_do_monitor(do_mouse: bool) -> (i32, i32, i32, i32, f64) {
    use windows::Win32::Graphics::Gdi::*;
    unsafe {
        let mut p = windows::Win32::Foundation::POINT::default();
        if do_mouse {
            let _ = windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut p);
        }
        let m = MonitorFromPoint(p, if do_mouse { MONITOR_DEFAULTTONEAREST } else { MONITOR_DEFAULTTOPRIMARY });
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(m, &mut info);
        let r = info.rcWork;
        let mut dx = 96u32;
        let mut dy = 96u32;
        let _ = windows::Win32::UI::HiDpi::GetDpiForMonitor(m, windows::Win32::UI::HiDpi::MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        (r.left, r.top, r.right - r.left, r.bottom - r.top, dx as f64 / 96.0)
    }
}

// ---------- abrir link no navegador ----------
pub fn abrir_no_navegador(url: &str) {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return;
    }
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    unsafe {
        ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(url), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
    }
}

// ---------- caixinha Sim/Não ----------
pub fn perguntar(dono: Option<HWND>, titulo: &str, texto: &str) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe { MessageBoxW(dono, &HSTRING::from(texto), &HSTRING::from(titulo), MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND) == IDYES }
}
