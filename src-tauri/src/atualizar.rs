// Atualização ASSINADA (igual à do programa antigo, 2.7.32+): o instalador baixado só roda se a
// assinatura Ed25519 dele bater com a chave pública abaixo (a chave privada não fica no servidor).
// Mensagem assinada: "<nome do arquivo>\n<sha256 do arquivo>". Só aceita versão MAIS NOVA (2.7.33).
// Os minigames usam a mesma chave: "modulo:<nome>\n<sha256 do texto>".
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

// MCowBQYDK2VwAyEATmEmLbLFobUtr8QqqxcZiNiJ7pBiHZ7p5fNdRuRQ0ws= (SPKI): os 32 bytes do fim.
const CHAVE_SPKI: &str = "MCowBQYDK2VwAyEATmEmLbLFobUtr8QqqxcZiNiJ7pBiHZ7p5fNdRuRQ0ws=";

fn chave() -> VerifyingKey {
    let der = base64::engine::general_purpose::STANDARD.decode(CHAVE_SPKI).expect("chave");
    let bytes: [u8; 32] = der[der.len() - 32..].try_into().expect("chave");
    VerifyingKey::from_bytes(&bytes).expect("chave")
}

pub fn assinatura_confere(mensagem: &[u8], assinatura_b64: &str) -> bool {
    let Ok(sig) = base64::engine::general_purpose::STANDARD.decode(assinatura_b64.trim()) else { return false };
    let Ok(sig) = <[u8; 64]>::try_from(sig.as_slice()) else { return false };
    chave().verify(mensagem, &Signature::from_bytes(&sig)).is_ok()
}

pub fn conferir_modulo(nome: &str, texto: &str, assinatura: &str) -> bool {
    let nome_ok = !nome.is_empty() && nome.len() <= 32 && nome.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if !nome_ok || texto.len() > 2_000_000 {
        return false;
    }
    let hash = crate::sistema::hex(&Sha256::digest(texto.as_bytes()));
    assinatura_confere(format!("modulo:{}\n{}", nome, hash).as_bytes(), assinatura)
}

pub fn comparar_versoes(a: &str, b: &str) -> i64 {
    let p = |s: &str| s.split('.').map(|x| x.parse::<i64>().unwrap_or(0)).collect::<Vec<_>>();
    let (pa, pb) = (p(a), p(b));
    for i in 0..3 {
        let (x, y) = (pa.get(i).copied().unwrap_or(0), pb.get(i).copied().unwrap_or(0));
        if x != y {
            return x - y;
        }
    }
    0
}

// "AstraScreenShare-Instalador-1.2.3.exe" -> "1.2.3"
fn versao_do_nome(nome: &str) -> Option<String> {
    let v = nome.strip_prefix("AstraScreenShare-Instalador-")?.strip_suffix(".exe")?;
    let partes: Vec<&str> = v.split('.').collect();
    if partes.len() == 3 && partes.iter().all(|p| !p.is_empty() && p.len() <= 3 && p.chars().all(|c| c.is_ascii_digit())) {
        Some(v.to_string())
    } else {
        None
    }
}

// O instalador tem ~3,5 MB; 300 MB é folga de sobra e impede encher o disco.
const TETO: u64 = 300 * 1024 * 1024;

fn sha256_do_arquivo(c: &std::path::Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(c)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(crate::sistema::hex(&h.finalize()))
}

// Baixa, confere e abre o instalador. `progresso` recebe a porcentagem (ou -1 = "instalando").
// Devolve o caminho do instalador já conferido; quem chama abre ele e fecha o programa.
pub fn baixar_e_conferir(site: &str, versao_atual: &str, progresso: impl Fn(i64)) -> Result<std::path::PathBuf, String> {
    let base = site.trim_end_matches('/').to_string() + "/";
    // 3.0.17 (ASTRA-013): tempo máximo, só HTTPS (inclusive nos redirecionamentos) e teto de tamanho.
    let so_https = !cfg!(feature = "teste");
    let agente = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(60))
        .timeout(std::time::Duration::from_secs(20 * 60))
        .https_only(so_https)
        .redirects(3)
        .build();
    let resp = agente.get(&format!("{}baixar/pc", base)).set("Cache-Control", "no-store").call()
        .map_err(|e| format!("o servidor respondeu {}", e))?;
    let cd = resp.header("content-disposition").unwrap_or("").to_string();
    let nome = cd.split("filename=").nth(1).map(|s| s.trim().trim_matches('"').split(';').next().unwrap_or("").trim_matches('"').trim().to_string()).unwrap_or_default();
    let versao = versao_do_nome(&nome).ok_or("o servidor não disse qual versão está mandando")?;
    if comparar_versoes(&versao, versao_atual) <= 0 {
        return Err("o servidor ofereceu uma versão que não é mais nova que a sua".into());
    }
    let total: u64 = resp.header("content-length").and_then(|x| x.parse().ok()).unwrap_or(0);
    if total > TETO {
        return Err("o instalador oferecido é grande demais".into());
    }
    // Pasta nova e aleatória a cada atualização.
    let aleatorio = format!("{:x}{:x}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let pasta = std::env::temp_dir().join(format!("astra-atualizacao-{}", aleatorio));
    std::fs::create_dir(&pasta).map_err(|e| e.to_string())?;
    let destino = pasta.join("AstraScreenShare-atualizacao.exe");
    let resultado = (|| -> Result<(), String> {
        let mut arquivo = std::fs::File::create(&destino).map_err(|e| e.to_string())?;
        let mut leitor = resp.into_reader();
        let mut resumo = Sha256::new();
        let mut buf = vec![0u8; 1 << 16];
        let (mut recebido, mut ultimo) = (0u64, -1i64);
        loop {
            let n = leitor.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            resumo.update(&buf[..n]);
            arquivo.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            recebido += n as u64;
            if recebido > TETO {
                return Err("o instalador oferecido é grande demais".into());
            }
            let pct = if total > 0 { (recebido * 100 / total) as i64 } else { 0 };
            if pct != ultimo {
                ultimo = pct;
                progresso(pct);
            }
        }
        arquivo.flush().map_err(|e| e.to_string())?;
        drop(arquivo);
        // Tem que ser um programa do Windows inteiro ("MZ" no começo e o tamanho certo).
        let mut inicio = [0u8; 2];
        std::fs::File::open(&destino).and_then(|mut f| f.read_exact(&mut inicio)).map_err(|e| e.to_string())?;
        if &inicio != b"MZ" || (total > 0 && recebido != total) {
            return Err("o arquivo baixado veio incompleto".into());
        }
        let hash = crate::sistema::hex(&resumo.finalize());
        // Igual a new URL("../assinaturas/<nome>.sig", SITE): a pasta acima da do site.
        let pai = base.trim_end_matches('/').rsplit_once('/').map(|(a, _)| a).unwrap_or(&base).to_string();
        let url_sig = format!("{}/assinaturas/{}.sig", pai, nome);
        let sig = agente.get(&url_sig).set("Cache-Control", "no-store").call()
            .map_err(|_| "a versão nova ainda não tem assinatura; tente de novo mais tarde".to_string())?
            .into_string().map_err(|e| e.to_string())?;
        if !assinatura_confere(format!("{}\n{}", nome, hash).as_bytes(), &sig) {
            return Err("a assinatura do instalador não confere, por segurança ele não foi aberto".into());
        }
        // Confere de novo o arquivo do disco, logo antes de abrir (ninguém trocou no meio).
        if sha256_do_arquivo(&destino).map_err(|e| e.to_string())? != hash {
            return Err("o arquivo mudou depois de baixado, por segurança ele não foi aberto".into());
        }
        Ok(())
    })();
    match resultado {
        Ok(()) => Ok(destino),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&pasta);
            Err(e)
        }
    }
}

#[cfg(test)]
mod testes {
    #[test]
    fn versoes() {
        assert!(super::comparar_versoes("2.8.0", "2.7.36") > 0);
        assert!(super::comparar_versoes("2.7.36", "2.8.0") < 0);
        assert_eq!(super::versao_do_nome("AstraScreenShare-Instalador-2.8.0.exe").as_deref(), Some("2.8.0"));
        assert_eq!(super::versao_do_nome("AstraScreenShare-Instalador-2.8.exe"), None);
        assert!(!super::assinatura_confere(b"x", "AAAA"));
    }
}
