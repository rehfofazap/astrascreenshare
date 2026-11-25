//! astra-audio.exe: ajudante do AstraScreenShare no Windows (código aberto; substitui o binário antigo sem fonte).
//!
//! O app (src-tauri/src/som.rs) abre este programa com um modo e conversa pelo stdin/stdout/stderr.
//! O protocolo é o MESMO do astra-audio.exe antigo, para o app não precisar mudar:
//!
//!   som (stdout = PCM 16 bits, 48 kHz, estéreo, sem cabeçalho; stderr = "OK ..." ou "ERRO ..."):
//!     excluir-pid <pid>              todo o som do PC menos o do programa <pid> (e dos filhos dele)
//!     excluir-nome <nome.exe>        idem, achando o programa pelo nome
//!     incluir-pid <pid>              só o som do programa <pid> (e dos filhos)
//!     incluir-janela <hwnd> [pid]    só o som do programa dono da janela (pid = reserva se a janela sumiu)
//!     mixar <pid> [nome.exe ...]     soma o som de cada programa tocando, menos <pid> e os nomes da lista
//!   silencio     liga o "Não perturbe" (só alarmes) enquanto o stdin estiver aberto; depois volta como estava
//!   desempenho   "GPU <total> <pid>:<uso> ..." no stdout a cada segundo
//!
//! Nada é gravado em disco e nada sai pela rede: tudo vai só para o processo que abriu este programa.
#![allow(non_snake_case)]

mod captura;
mod mixar;
mod sistema;

use std::io::Write;
use windows::Win32::Media::Audio::{PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE};

pub const USO: &str = "uso: astra-audio.exe excluir-nome|excluir-pid|incluir-janela|incluir-pid <valor> [pid-reserva]";

/// "ERRO <texto> (0xHHHHHHHH)" no stderr e sai com código 1 (o app mostra o texto para a pessoa).
pub fn erro(texto: &str, codigo: i32) -> ! {
    let mut e = std::io::stderr().lock();
    if codigo != 0 {
        let _ = writeln!(e, "ERRO {} (0x{:08x})", texto, codigo as u32);
    } else {
        let _ = writeln!(e, "ERRO {}", texto);
    }
    let _ = e.flush();
    std::process::exit(1);
}

/// Linha de aviso no stderr ("OK ...").
pub fn avisar(texto: &str) {
    let mut e = std::io::stderr().lock();
    let _ = writeln!(e, "{}", texto);
    let _ = e.flush();
}

fn num(s: Option<&String>) -> u32 {
    s.and_then(|x| x.trim().parse::<u32>().ok()).unwrap_or(0)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let modo = args.get(1).map(String::as_str).unwrap_or("");
    match modo {
        "silencio" => sistema::silencio(),
        // devolve a chave das notificações se uma live terminou no meio (o app chama ao abrir)
        "restaurar" => {
            sistema::restaurar_toasts();
            std::process::exit(0);
        }
        // "teclas" (mostrar teclas apertadas para quem assiste) foi REMOVIDO em 17/11/2026 a pedido do dono.
        "teclas" => erro("funcao removida", 0),
        "desempenho" => sistema::desempenho(),
        "mixar" => {
            let pid = num(args.get(2));
            if pid == 0 {
                erro(USO, 0);
            }
            let nomes: Vec<String> = args.iter().skip(3).map(|n| n.to_lowercase()).collect();
            captura::preparar_thread();
            mixar::mixar(pid, &nomes);
        }
        "excluir-pid" | "incluir-pid" | "excluir-nome" | "incluir-janela" => {
            let valor = args.get(2).unwrap_or_else(|| erro(USO, 0));
            let pid = match modo {
                "excluir-nome" => sistema::pid_pelo_nome(valor).unwrap_or(std::process::id()),
                "incluir-janela" => {
                    let p = sistema::pid_da_janela(valor.trim().parse::<u64>().unwrap_or(0));
                    if p != 0 { p } else { num(args.get(3)) }
                }
                _ => num(Some(valor)),
            };
            if pid == 0 {
                erro("programa nao encontrado", 0);
            }
            let incluir = modo.starts_with("incluir");
            captura::preparar_thread();
            captura::um_programa(pid, if incluir { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE } else { PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE });
        }
        _ => erro(USO, 0),
    }
}
