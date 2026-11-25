// Login e configurações do programa antigo (Electron), lidos direto do banco do Chromium dele:
// %APPDATA%\AstraScreenShare\Local Storage\leveldb. Serve para TODO mundo, inclusive quem vem de
// uma versão antiga que não gravava o migracao-dados.json (antes da 2.7.36) e nunca anotou o ID
// ou a chave. Só lê (numa cópia da pasta, para não brigar com o programa antigo se ele estiver aberto).
//
// Formato do Chromium: chave = "_" + origem + "\0" + tipo + nome; valor = 1 byte de tipo
// (0 = UTF-16LE, 1 = Latin-1) + o texto. A página do Electron é aberta com loadFile, origem "file://".
use rusty_leveldb::{LdbIterator, Options, DB};
use serde_json::{Map, Value};
use std::path::Path;

const PREFIXO: &[u8] = b"_file://\x00";

fn texto(v: &[u8]) -> Option<String> {
    let (tipo, resto) = v.split_first()?;
    match tipo {
        0 => {
            if resto.len() % 2 != 0 {
                return None;
            }
            let u: Vec<u16> = resto.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            String::from_utf16(&u).ok()
        }
        1 => Some(resto.iter().map(|&b| b as char).collect()),
        _ => None,
    }
}

fn copiar_pasta(de: &Path, para: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(para)?;
    for e in std::fs::read_dir(de)? {
        let e = e?;
        let nome = e.file_name();
        if nome == "LOCK" || !e.file_type()?.is_file() {
            continue;
        }
        std::fs::copy(e.path(), para.join(&nome))?;
    }
    Ok(())
}

pub fn ler_local_storage(pasta_antiga: &Path) -> Option<Map<String, Value>> {
    let banco = pasta_antiga.join("Local Storage").join("leveldb");
    if !banco.join("CURRENT").exists() {
        return None;
    }
    let copia = std::env::temp_dir().join(format!("astra-migracao-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&copia);
    let resultado = (|| {
        copiar_pasta(&banco, &copia).ok()?;
        let mut opt = Options::default();
        opt.create_if_missing = false;
        opt.paranoid_checks = false;
        let mut db = DB::open(&copia, opt).ok()?;
        let mut it = db.new_iter().ok()?;
        let mut dados = Map::new();
        while it.advance() {
            let Some((k, v)) = it.current() else { continue };
            // O nome também tem o byte de tipo na frente (1 = Latin-1, 0 = UTF-16LE).
            let Some(nome) = k.strip_prefix(PREFIXO).and_then(texto) else { continue };
            if let Some(t) = texto(&v) {
                dados.insert(nome, Value::String(t));
            }
        }
        Some(dados)
    })();
    let _ = std::fs::remove_dir_all(&copia);
    resultado.filter(|d| !d.is_empty())
}
