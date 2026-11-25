// 3.0.17 (ASTRA-002): a escolha da tela vai para o WebView2 como um PEDAÇO do nome
// (--auto-select-desktop-capture-source), e ele pega a PRIMEIRA fonte cujo nome contém esse pedaço.
// Se outra janela/tela também contém o pedaço, ele poderia transmitir a errada. Aqui a regra pura
// (sem Windows), para dar para testar em qualquer lugar.

/// Pedaço muito curto: casa com quase tudo.
pub const MINIMO: usize = 3;

/// `selecao` = o pedaço que vai para o WebView2; `outros` = o nome de TODAS as outras fontes da lista.
/// Comparação sem diferenciar maiúsculas (mais cautelosa que a do WebView2).
pub fn ambigua<'a>(selecao: &str, outros: impl IntoIterator<Item = &'a str>) -> bool {
    let s = selecao.trim();
    if s.chars().count() < MINIMO {
        return true;
    }
    let s = s.to_lowercase();
    outros.into_iter().any(|nome| nome.to_lowercase().contains(&s))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn nome_unico_passa() {
        assert!(!ambigua("YouTube - Google Chrome", ["Gmail - Google Chrome", "Tela 1", "Tela 2", "Discord"]));
        assert!(!ambigua("Tela 1", ["Tela 2", "League of Legends"]));
        assert!(!ambigua("Tela inteira", ["Discord", "Valorant"]));
    }

    #[test]
    fn nome_contido_em_outro_recusa() {
        // escolher "Discord" quando existe "#geral | LoL BR - Discord"
        assert!(ambigua("Discord", ["#geral | LoL BR - Discord", "Tela inteira"]));
        // monitor "Tela 1" e uma janela com "Tela 1" no título
        assert!(ambigua("Tela 1", ["Tela 2", "Tela 1 - Bloco de Notas"]));
        // duas janelas com o mesmo título
        assert!(ambigua("Nova guia - Google Chrome", ["Nova guia - Google Chrome"]));
    }

    #[test]
    fn maiusculas_nao_enganam() {
        assert!(ambigua("discord", ["Discord"]));
    }

    #[test]
    fn pedaco_curto_recusa() {
        assert!(ambigua("ab", ["xyz"]));
        assert!(ambigua("  ", []));
        assert!(!ambigua("LoL", ["Valorant"]));
    }

    #[test]
    fn lista_vazia_passa() {
        assert!(!ambigua("Minecraft 1.21", []));
    }
}
