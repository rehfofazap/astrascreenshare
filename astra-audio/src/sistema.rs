//! Modos que não são de som: "Não perturbe" e uso da placa de vídeo; e achar o programa de uma janela.
use std::collections::HashMap;
use std::io::{Read, Write};

use windows::core::{s, w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::System::Performance::*;
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::{avisar, erro};

/// Espera o app fechar o stdin (é assim que ele diz "pode parar").
fn esperar_stdin_fechar() {
    let mut buf = [0u8; 64];
    let mut entrada = std::io::stdin().lock();
    while let Ok(n) = entrada.read(&mut buf) {
        if n == 0 {
            break;
        }
    }
}

// ---------------------------------------------------------------- Não perturbe
// O Windows não tem função pública para isso. Como o antigo, usa o estado WNF do "Assistente de foco"
// (WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED): 0 = desligado, 1 = só prioridade, 2 = só alarmes.
const WNF_NAO_PERTURBE: u64 = 0x0D83_063E_A3BF_1C75;
type NtQuery = unsafe extern "system" fn(*const u64, *const u8, *const u8, *mut u32, *mut u8, *mut u32) -> i32;
type NtUpdate = unsafe extern "system" fn(*const u64, *const u8, u32, *const u8, *const u8, u32, u32) -> i32;

/// Windows 10: estado WNF do Assistente de foco em "só alarmes". Devolve o valor de antes (para voltar no fim).
fn wnf_ligar(diag: &mut Vec<String>) -> Option<u32> {
    unsafe {
        let Ok(ntdll) = GetModuleHandleW(w!("ntdll.dll")) else { diag.push("wnf=sem-ntdll".into()); return None };
        let (Some(q), Some(u)) = (GetProcAddress(ntdll, s!("NtQueryWnfStateData")), GetProcAddress(ntdll, s!("NtUpdateWnfStateData"))) else {
            diag.push("wnf=sem-funcao".into());
            return None;
        };
        let consultar: NtQuery = std::mem::transmute(q);
        let mudar: NtUpdate = std::mem::transmute(u);
        let nome = WNF_NAO_PERTURBE;
        let mut antes: u32 = 0;
        let mut tamanho: u32 = 4;
        let mut carimbo: u32 = 0;
        let r = consultar(&nome, std::ptr::null(), std::ptr::null(), &mut carimbo, &mut antes as *mut u32 as *mut u8, &mut tamanho);
        if r < 0 || antes > 2 {
            antes = 0;
        }
        let so_alarmes: u32 = 2;
        let r = mudar(&nome, &so_alarmes as *const u32 as *const u8, 4, std::ptr::null(), std::ptr::null(), 0, 0);
        if r < 0 {
            diag.push(format!("wnf=erro:0x{:08x}", r as u32));
            return None;
        }
        diag.push(format!("wnf=ok(antes {})", antes));
        Some(antes)
    }
}

fn wnf_voltar(antes: u32) {
    unsafe {
        let Ok(ntdll) = GetModuleHandleW(w!("ntdll.dll")) else { return };
        let Some(u) = GetProcAddress(ntdll, s!("NtUpdateWnfStateData")) else { return };
        let mudar: NtUpdate = std::mem::transmute(u);
        let nome = WNF_NAO_PERTURBE;
        let _ = mudar(&nome, &antes as *const u32 as *const u8, 4, std::ptr::null(), std::ptr::null(), 0, 0);
    }
}

// ---------- chave geral das notificações do Windows (Configurações > Notificações) ----------
// O teste 7 da 3.0.20 desligava HKCU\...\PushNotifications\ToastEnabled durante a live e guardava o valor de antes em
// HKCU\Software\AstraScreenShare\ToastEnabledAntes. Não desliga mais; só devolve o que tiver sobrado.
const PUSH: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications");
const NOSSA: PCWSTR = w!("Software\\AstraScreenShare");

fn ler_dword(chave: PCWSTR, nome: PCWSTR) -> Option<u32> {
    use windows::Win32::System::Registry::*;
    let mut v: u32 = 0;
    let mut tam: u32 = 4;
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, chave, nome, RRF_RT_REG_DWORD, None, Some(&mut v as *mut u32 as *mut _), Some(&mut tam)) };
    (r.0 == 0).then_some(v)
}

fn gravar_dword(chave: PCWSTR, nome: PCWSTR, v: u32) -> bool {
    use windows::Win32::System::Registry::*;
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, chave, nome, REG_DWORD.0, Some(&v as *const u32 as *const _), 4).0 == 0 }
}

fn avisar_mudanca() {
    unsafe {
        let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(w!("Notifications").as_ptr() as isize),
                                    SMTO_ABORTIFHUNG, 500, None);
    }
}

/// Devolve a chave das notificações como estava (se ficou guardada). Também roda na abertura do app.
pub fn restaurar_toasts() {
    if let Some(antes) = ler_dword(NOSSA, w!("ToastEnabledAntes")) {
        gravar_dword(PUSH, w!("ToastEnabled"), antes);
        unsafe {
            let _ = windows::Win32::System::Registry::RegDeleteKeyValueW(windows::Win32::System::Registry::HKEY_CURRENT_USER, NOSSA, w!("ToastEnabledAntes"));
        }
        avisar_mudanca();
    }
}

pub fn silencio() -> ! {
    // 3.0.20: no Windows 11 (build 26200, teste de 17/11) NENHUM caminho funciona para um app comum: a sessão de foco
    // dá "acesso negado" (recurso reservado pela Microsoft), o estado WNF e a chave ToastEnabled são gravados mas o
    // Windows ignora enquanto roda. Fica só o WNF (funciona no Windows 10); no Windows 11 o app pede para a pessoa
    // ligar o Não perturbe (Win+N). O teste 7 desligava a chave ToastEnabled: restaurar_toasts() devolve o que sobrou.
    let mut diag = vec![format!("build={}", crate::captura::build_do_windows())];
    restaurar_toasts();
    let wnf = wnf_ligar(&mut diag);
    avisar(&format!("OK silencio {}", diag.join(" ")));
    esperar_stdin_fechar();
    if let Some(antes) = wnf {
        wnf_voltar(antes);
    }
    std::process::exit(0);
}

// ---------------------------------------------------------------- placa de vídeo
// Contador "\GPU Engine(*)\Utilization Percentage" (o mesmo do Gerenciador de Tarefas). Cada instância se chama
// "pid_1234_luid_..._engtype_3D". Por programa: soma por tipo de motor e fica com o maior. Total: soma de todos
// os programas por tipo de motor e fica com o maior.
pub fn desempenho() -> ! {
    unsafe {
        let mut consulta = PDH_HQUERY::default();
        if PdhOpenQueryW(PCWSTR::null(), 0, &mut consulta) != 0 {
            erro("este Windows nao mede a placa de video", 0);
        }
        let mut contador = PDH_HCOUNTER::default();
        if PdhAddEnglishCounterW(consulta, w!("\\GPU Engine(*)\\Utilization Percentage"), 0, &mut contador) != 0 {
            erro("este Windows nao mede a placa de video", 0);
        }
        let _ = PdhCollectQueryData(consulta);
        avisar("OK desempenho");
        let mut saida = std::io::stdout().lock();
        let mut memoria: Vec<u8> = Vec::new();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            if PdhCollectQueryData(consulta) != 0 {
                continue;
            }
            let linha = ler_gpu(contador, &mut memoria).unwrap_or_else(|| "GPU 0".to_string());
            if writeln!(saida, "{}", linha).is_err() || saida.flush().is_err() {
                std::process::exit(0);
            }
        }
    }
}

unsafe fn ler_gpu(contador: PDH_HCOUNTER, memoria: &mut Vec<u8>) -> Option<String> {
    let mut tamanho: u32 = 0;
    let mut quantos: u32 = 0;
    let formato = PDH_FMT(PDH_FMT_DOUBLE.0 | 0x8000); // 0x8000 = PDH_FMT_NOCAP100 (passa de 100 se vários motores)
    let r = PdhGetFormattedCounterArrayW(contador, formato, &mut tamanho, &mut quantos, None);
    if r != PDH_MORE_DATA || tamanho == 0 {
        return None;
    }
    memoria.clear();
    memoria.resize(tamanho as usize + 16, 0);
    let itens = memoria.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
    if PdhGetFormattedCounterArrayW(contador, formato, &mut tamanho, &mut quantos, Some(itens)) != 0 {
        return None;
    }
    let mut por_pid: HashMap<u32, HashMap<String, f64>> = HashMap::new();
    for i in 0..quantos as usize {
        let item = &*itens.add(i);
        let valor = item.FmtValue.Anonymous.doubleValue;
        if !(valor > 0.0) {
            continue;
        }
        let nome = item.szName.to_string().unwrap_or_default();
        let Some(depois_pid) = nome.find("pid_").map(|p| &nome[p + 4..]) else { continue };
        let Ok(pid) = depois_pid.split('_').next().unwrap_or("").parse::<u32>() else { continue };
        let tipo = nome.rfind("engtype_").map(|p| nome[p + 8..].to_string()).unwrap_or_default();
        *por_pid.entry(pid).or_default().entry(tipo).or_insert(0.0) += valor;
    }
    let mut por_tipo: HashMap<&str, f64> = HashMap::new();
    let mut partes: Vec<(u32, u32)> = Vec::new();
    for (pid, tipos) in &por_pid {
        let mut maior: f64 = 0.0;
        for (t, v) in tipos {
            maior = maior.max(*v);
            *por_tipo.entry(t.as_str()).or_insert(0.0) += v;
        }
        let uso = (maior.min(100.0) + 0.5) as u32;
        if uso > 0 {
            partes.push((*pid, uso));
        }
    }
    partes.sort_unstable();
    let total = (por_tipo.values().cloned().fold(0.0, f64::max).min(100.0) + 0.5) as u32;
    let mut linha = format!("GPU {}", total);
    for (pid, uso) in partes {
        linha.push_str(&format!(" {}:{}", pid, uso));
    }
    Some(linha)
}

// ---------------------------------------------------------------- achar programas
pub fn pid_da_janela(hwnd: u64) -> u32 {
    if hwnd == 0 {
        return 0;
    }
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(HWND(hwnd as usize as *mut _), Some(&mut pid));
    }
    pid
}

pub fn pid_pelo_nome(nome: &str) -> Option<u32> {
    let alvo = nome.trim().to_lowercase();
    unsafe {
        let foto = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut p = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut achado = None;
        if Process32FirstW(foto, &mut p).is_ok() {
            loop {
                let fim = p.szExeFile.iter().position(|&c| c == 0).unwrap_or(p.szExeFile.len());
                if String::from_utf16_lossy(&p.szExeFile[..fim]).to_lowercase() == alvo {
                    achado = Some(p.th32ProcessID);
                    break;
                }
                if Process32NextW(foto, &mut p).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(foto);
        achado
    }
}

/// Nome do .exe de um pid (para o diagnóstico "OK incluir 1234 chrome.exe").
pub fn nome_do_pid(pid: u32) -> String {
    unsafe {
        let Ok(foto) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return String::new() };
        let mut p = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut achado = String::new();
        if Process32FirstW(foto, &mut p).is_ok() {
            loop {
                if p.th32ProcessID == pid {
                    let fim = p.szExeFile.iter().position(|&c| c == 0).unwrap_or(p.szExeFile.len());
                    achado = String::from_utf16_lossy(&p.szExeFile[..fim]).to_lowercase();
                    break;
                }
                if Process32NextW(foto, &mut p).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(foto);
        achado
    }
}
