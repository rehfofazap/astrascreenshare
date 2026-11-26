# quer ajudar?

valeu! qualquer ajuda serve: achar bug, sugerir coisa, arrumar texto ou mexer no código.

## bug ou ideia

abre uma [issue](https://github.com/rehfofazap/astrascreenshare/issues/new/choose) e escolhe o modelo. fala a versão do app e o que aconteceu.

se for print da tela, confere se não aparece conversa ou dado de outra pessoa.

## mexer no código

precisa de [rust](https://rustup.rs), node 18+ e o build tools do visual studio (c++).

```bash
npm install
npx tauri dev
```

| pasta | o que tem |
|---|---|
| `src-tauri/` | o app em rust (tauri v2): janelas, mini tela, captura, atalhos, atualização |
| `web/` | a interface (html/css/js), a mesma do site |
| `astra-audio/` | ajudante que pega o som de cada programa do windows separado (wasapi) |

esse repositório é só o app de PC; o site e o servidor ficam fora daqui.

antes de mandar o pull request:

- `cargo check` dentro de `src-tauri` sem erro
- testa transmitindo de verdade (tela + som) se mexeu em captura ou áudio
- explica no PR o que mudou e por quê, com print se mexeu na tela
