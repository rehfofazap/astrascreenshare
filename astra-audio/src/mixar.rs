//! Modo "mixar": o som de cada programa que está tocando, MENOS o próprio Astra (e os filhos dele) e os nomes
//! da lista (o app manda Discord.exe, DiscordPTB.exe, DiscordCanary.exe). Cada programa é capturado à parte
//! (process loopback, "incluir" a árvore dele) e as capturas são somadas num fluxo só, no ritmo do relógio
//! (48 000 quadros por segundo), para o som não acelerar nem atrasar quando um programa para de tocar.
//!
//! Regras importantes (teste de 17/11):
//! - capturar um programa pega TODOS os filhos dele. Por isso um programa cuja árvore tem o Astra ou o Discord
//!   (ex.: explorer.exe, que abre quase tudo) NUNCA é capturado; senão a voz do Discord e o eco do Astra vazam;
//! - o Windows reaproveita números de processo: um "pai" só vale se ele nasceu antes do filho;
//! - procurar programas novos leva tempo (lista de processos, sessões de som, abrir captura): isso roda numa
//!   thread separada, para a thread que lê e mistura o som nunca atrasar (atraso = estalo).
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::Media::Audio::*;
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::core::Interface;

use crate::captura::{self, Captura, TAXA};
use crate::{avisar, erro};

const RELER_LISTA: Duration = Duration::from_millis(1000); // de quanto em quanto procura programas novos
const BUFFER_MIXAR: i64 = 2_000_000; // 200 ms de buffer em cada captura (o Windows guarda se a leitura atrasar)
const FOLGA: usize = TAXA as usize * 2 * 40 / 1000; // 40 ms juntados antes de um programa entrar na mistura (amostras)
const FILA_MAX: usize = (TAXA as usize * 2) * 250 / 1000; // até 250 ms guardados por programa (amostras)
const PASSO_MAX: u64 = TAXA as u64 / 10; // nunca escreve mais que 100 ms de uma vez (depois de um travamento)

struct Programa {
    cap: Captura,
    fila: VecDeque<i16>,
    bytes: Vec<u8>,
    pronto: bool, // já juntou folga suficiente para tocar sem falhas
}

// As capturas são objetos COM criados numa thread MTA; passar para outra thread MTA é permitido.
struct Enviavel(Programa);
unsafe impl Send for Enviavel {}

enum Aviso {
    Novo(u32, Enviavel),
    Fechar(u32),
}

struct Proc {
    pai: u32,
    nome: String,
    nasceu: u64, // FILETIME de criação (0 = não deu para ler)
}

fn nasceu(pid: u32) -> u64 {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return 0 };
        let (mut c, mut e, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        let r = GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u);
        let _ = CloseHandle(h);
        if r.is_ok() { ((c.dwHighDateTime as u64) << 32) | c.dwLowDateTime as u64 } else { 0 }
    }
}

fn processos() -> HashMap<u32, Proc> {
    let mut m = HashMap::new();
    unsafe {
        let Ok(foto) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return m };
        let mut p = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(foto, &mut p).is_ok() {
            loop {
                let fim = p.szExeFile.iter().position(|&c| c == 0).unwrap_or(p.szExeFile.len());
                m.insert(p.th32ProcessID, Proc {
                    pai: p.th32ParentProcessID,
                    nome: String::from_utf16_lossy(&p.szExeFile[..fim]).to_lowercase(),
                    nasceu: nasceu(p.th32ProcessID),
                });
                if Process32NextW(foto, &mut p).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(foto);
    }
    m
}

/// Pai verdadeiro de `pid`: existe, não é ele mesmo e nasceu antes dele (senão é um número reaproveitado).
fn pai_de(pid: u32, procs: &HashMap<u32, Proc>) -> Option<u32> {
    let eu = procs.get(&pid)?;
    let pai = procs.get(&eu.pai)?;
    if eu.pai == 0 || eu.pai == pid || (pai.nasceu != 0 && eu.nasceu != 0 && pai.nasceu > eu.nasceu) {
        return None;
    }
    Some(eu.pai)
}

/// `pid` é `ancestral` ou descende dele? (sobe no máximo 64 níveis)
fn descende_de(mut pid: u32, ancestral: u32, procs: &HashMap<u32, Proc>) -> bool {
    for _ in 0..64 {
        if pid == ancestral {
            return true;
        }
        match pai_de(pid, procs) {
            Some(p) => pid = p,
            None => return false,
        }
    }
    false
}

/// Pids dos programas com sessão de som em QUALQUER saída ativa (não só a padrão: com Voicemeeter e afins,
/// o Spotify e o Discord tocam numa saída virtual).
fn com_som() -> Vec<u32> {
    let mut v = Vec::new();
    unsafe {
        let Ok(en): windows::core::Result<IMMDeviceEnumerator> = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return v };
        let Ok(saidas) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return v };
        let total = saidas.GetCount().unwrap_or(0);
        for d in 0..total {
            let Ok(disp) = saidas.Item(d) else { continue };
            let Ok(gerente): windows::core::Result<IAudioSessionManager2> = disp.Activate(CLSCTX_ALL, None) else { continue };
            let Ok(lista) = gerente.GetSessionEnumerator() else { continue };
            let n = lista.GetCount().unwrap_or(0);
            for i in 0..n {
                let Ok(s) = lista.GetSession(i) else { continue };
                let Ok(s2) = s.cast::<IAudioSessionControl2>() else { continue };
                if let Ok(pid) = s2.GetProcessId() {
                    if pid != 0 && !v.contains(&pid) {
                        v.push(pid);
                    }
                }
            }
        }
    }
    v
}

/// Programas que tocam a MISTURA do som dos outros (inclusive do Discord). Capturar um deles = Discord vazando
/// e música duplicada (teste de 17/11 num PC com Voicemeeter). Os programas de verdade são capturados direto.
fn eh_mixer(nome: &str) -> bool {
    const MIXERS: [&str; 7] = ["voicemeeter", "vbvmaux", "voicemod", "steelseriessonar", "sonar", "nvidia broadcast", "obs64"];
    MIXERS.iter().any(|m| nome.contains(m))
}

/// Uma rodada da procura. `ativos` = pid -> quando o processo nasceu (para notar pid reaproveitado).
fn procurar(eu: u32, nomes: &[String], ativos: &mut HashMap<u32, u64>, tx: &Sender<Aviso>) {
    let procs = processos();
    // 1) programas que fecharam (ou cujo número agora é de outro programa)
    let fechados: Vec<u32> = ativos.iter().filter(|(pid, n)| procs.get(pid).map(|p| p.nasceu != **n).unwrap_or(true)).map(|(p, _)| *p).collect();
    for pid in fechados {
        ativos.remove(&pid);
        let _ = tx.send(Aviso::Fechar(pid));
    }
    // 2) quem NÃO pode aparecer: o Astra e os filhos dele, e os programas da lista (e os filhos deles)
    let proibido = |q: u32| -> bool {
        procs.get(&q).map(|p| eh_mixer(&p.nome)).unwrap_or(false) || descende_de(q, eu, &procs) || {
            let mut x = q;
            let mut achou = false;
            for _ in 0..64 {
                if procs.get(&x).map(|p| nomes.iter().any(|n| *n == p.nome)).unwrap_or(false) {
                    achou = true;
                    break;
                }
                match pai_de(x, &procs) {
                    Some(p) => x = p,
                    None => break,
                }
            }
            achou
        }
    };
    let proibidos: Vec<u32> = procs.keys().copied().filter(|&q| proibido(q)).collect();
    // 3) candidatos: tem som, não é proibido e a árvore dele não contém nada proibido
    let mut candidatos: Vec<u32> = com_som()
        .into_iter()
        .filter(|&p| procs.contains_key(&p) && !proibido(p) && !proibidos.iter().any(|&q| descende_de(q, p, &procs)))
        .collect();
    candidatos.sort_unstable();
    // 4) a captura "incluir" já pega os filhos: se o pai também toca (e é seguro), basta o pai
    let todos: HashSet<u32> = candidatos.iter().copied().chain(ativos.keys().copied()).collect();
    for pid in candidatos {
        if ativos.contains_key(&pid) || todos.iter().any(|&o| o != pid && descende_de(pid, o, &procs)) {
            continue;
        }
        let Ok(cap) = captura::abrir(pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, BUFFER_MIXAR) else { continue };
        let filhos: Vec<u32> = ativos.keys().copied().filter(|&a| a != pid && descende_de(a, pid, &procs)).collect();
        for f in filhos {
            ativos.remove(&f);
            let _ = tx.send(Aviso::Fechar(f));
        }
        ativos.insert(pid, procs.get(&pid).map(|p| p.nasceu).unwrap_or(0));
        let prog = Programa { cap, fila: VecDeque::with_capacity(FILA_MAX), bytes: Vec::with_capacity(32 * 1024), pronto: false };
        let _ = tx.send(Aviso::Novo(pid, Enviavel(prog)));
    }
}

/// "chrome.exe, spotify.exe" (para o app mostrar/registrar o que está sendo capturado)
fn nomes_dos(ativos: &HashMap<u32, u64>) -> String {
    let procs = processos();
    let mut v: Vec<String> = ativos.keys().map(|p| procs.get(p).map(|x| x.nome.clone()).unwrap_or_else(|| p.to_string())).collect();
    v.sort();
    v.join(", ")
}

fn vigia(eu: u32, nomes: Vec<String>, tx: Sender<Aviso>, pronto: Sender<(usize, String)>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let mut ativos: HashMap<u32, u64> = HashMap::new();
    procurar(eu, &nomes, &mut ativos, &tx);
    let mut antes = nomes_dos(&ativos);
    let _ = pronto.send((ativos.len(), antes.clone()));
    loop {
        std::thread::sleep(RELER_LISTA);
        procurar(eu, &nomes, &mut ativos, &tx);
        let agora = nomes_dos(&ativos);
        if agora != antes {
            avisar(&format!("INFO mixar {} programas: {}", ativos.len(), agora));
            antes = agora;
        }
    }
}

fn receber(rx: &Receiver<Aviso>, ativos: &mut HashMap<u32, Programa>) {
    while let Ok(a) = rx.try_recv() {
        match a {
            Aviso::Novo(pid, Enviavel(p)) => {
                ativos.insert(pid, p);
            }
            Aviso::Fechar(pid) => {
                ativos.remove(&pid);
            }
        }
    }
}

pub fn mixar(eu: u32, nomes: &[String]) -> ! {
    // Teste: este Windows consegue capturar por programa? (igual ao antigo, abre e fecha uma captura)
    match captura::abrir(eu, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, captura::BUFFER_PADRAO) {
        Ok(c) => drop(c),
        Err((etapa, codigo)) => erro(etapa, codigo),
    }
    let (tx, rx) = channel::<Aviso>();
    let (tx_pronto, rx_pronto) = channel::<(usize, String)>();
    let nomes_v = nomes.to_vec();
    std::thread::spawn(move || vigia(eu, nomes_v, tx, tx_pronto));
    let (quantos, lista) = rx_pronto.recv_timeout(Duration::from_secs(15)).unwrap_or((0, String::new()));
    avisar(&format!("OK mixar {} programas: {}", quantos, lista));

    unsafe {
        timeBeginPeriod(1);
    }
    let mut ativos: HashMap<u32, Programa> = HashMap::new();
    let mut saida = std::io::stdout().lock();
    let inicio = Instant::now();
    let mut escritos: u64 = 0;
    let mut mistura: Vec<i32> = Vec::new();
    let mut bytes: Vec<u8> = Vec::new();
    loop {
        std::thread::sleep(Duration::from_millis(5));
        receber(&rx, &mut ativos);
        // junta o que cada programa mandou
        for p in ativos.values_mut() {
            p.bytes.clear();
            p.cap.ler(&mut p.bytes);
            p.fila.extend(p.bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])));
            if p.fila.len() > FILA_MAX {
                let sobra = p.fila.len() - FILA_MAX;
                p.fila.drain(..sobra); // atrasou demais: joga fora o mais velho
            }
        }
        // quantos quadros o relógio pede agora
        let devido = inicio.elapsed().as_micros() as u64 * TAXA as u64 / 1_000_000;
        if devido <= escritos {
            continue;
        }
        let mut quadros = devido - escritos;
        if quadros > PASSO_MAX {
            // ficou parado (PC travou, suspensão): pula o buraco em vez de despejar tudo de uma vez
            escritos = devido - PASSO_MAX;
            quadros = PASSO_MAX;
        }
        let amostras = quadros as usize * 2;
        mistura.clear();
        mistura.resize(amostras, 0);
        for p in ativos.values_mut() {
            // Programa que começou a tocar agora (ou que esvaziou): espera juntar 40 ms antes de entrar na mistura,
            // senão cada pacote que atrasa vira um estalo.
            if !p.pronto {
                if p.fila.len() < FOLGA {
                    continue;
                }
                p.pronto = true;
            }
            if p.fila.len() < amostras {
                p.pronto = false;
            }
            let n = amostras.min(p.fila.len());
            for (m, s) in mistura.iter_mut().zip(p.fila.drain(..n)) {
                *m += s as i32;
            }
        }
        bytes.clear();
        bytes.reserve(amostras * 2);
        for &m in &mistura {
            bytes.extend_from_slice(&(m.clamp(-32768, 32767) as i16).to_le_bytes());
        }
        if saida.write_all(&bytes).is_err() || saida.flush().is_err() {
            unsafe {
                timeEndPeriod(1);
            }
            std::process::exit(0);
        }
        escritos += quadros;
    }
}
