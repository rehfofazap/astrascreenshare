<div align="center">

<img src="icone.png" width="120" alt="Astra" />

# Astra

compartilha a tela com os amigos com som do jogo, chat, música junto e um monte de coisa a mais 🌙

[![Baixar](https://img.shields.io/badge/baixar-Windows-7c5cff?style=for-the-badge&logo=windows)](https://github.com/rehfofazap/astrascreenshare/releases/latest)
[![Versão](https://img.shields.io/github/v/release/rehfofazap/astrascreenshare?style=for-the-badge&color=a68bff&label=vers%C3%A3o)](https://github.com/rehfofazap/astrascreenshare/releases)
[![Site](https://img.shields.io/badge/site-astrascreenshare.com-1f1f2e?style=for-the-badge)](https://astrascreenshare.com)
[![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-a3acbd?style=for-the-badge)](LICENSE)

</div>

## o que é

o astra é um app pra transmitir a tela pros amigos numa sala, tipo uma call só que feita pra isso. esse repositório é o **app de PC (windows)**. o site e o servidor ficam fora daqui.

## o que dá pra fazer

- **transmitir a tela** (inteira ou uma janela) com o som do PC, e escolher se o som de um programa entra ou não
- **salas** públicas, com senha ou só pra amigos
- **chat da sala**, mensagens privadas e lista de amigos
- **música junto**: todo mundo da sala ouve a mesma fila (youtube, soundcloud...)
- **mini tela**: assistir a transmissão numa janelinha por cima do jogo
- **riscar na tela** de quem tá transmitindo e recortar pedaços da tela
- voz com redução de ruído
- perfil, insígnias, temas, papel de parede e minigames
- atualiza sozinho

## como instalar

1. baixa o instalador na aba [releases](https://github.com/rehfofazap/astrascreenshare/releases/latest) ou no [site](https://astrascreenshare.com)
2. abre e instala. se o windows reclamar ("o windows protegeu o computador"), clica em **mais informações** e depois **executar assim mesmo**
3. escolhe seu nome de usuário e pronto

**conferir o download:** cada release tem o sha256 do instalador nas notas. no PowerShell: `Get-FileHash .\AstraScreenShare-Instalador-x.x.x.exe` e compara.

## como é feito

| pasta | o que tem |
|---|---|
| `src-tauri/` | o app em si, em rust com tauri v2: janelas, mini tela, captura, atalhos, atualização |
| `web/` | a interface (html/css/js), a mesma do site |
| `astra-audio/` | ajudante em rust que pega o som de cada programa do windows separado (wasapi) |

## compilar

precisa de [rust](https://rustup.rs), node 18+ e o build tools do visual studio (c++).

```bash
npm install

# ajudante de áudio (só se mexer nele; já vai pronto em src-tauri/som)
cd astra-audio && cargo build --release && cd ..

npx tauri build   # gera o instalador em src-tauri/target/release/bundle
```

o app confere a assinatura das atualizações com a chave pública que está em `src-tauri/src/atualizar.rs`. build feito por outra pessoa funciona normal, só não recebe atualização automática.

quer ajudar? dá uma olhada no [CONTRIBUTING](CONTRIBUTING.md). bug ou ideia: [abre uma issue](https://github.com/rehfofazap/astrascreenshare/issues/new/choose).

## segurança

as contas, senhas e salas são conferidas no servidor, não no app. se achar alguma falha, avisa pelo [relato privado de vulnerabilidade](https://github.com/rehfofazap/astrascreenshare/security/advisories/new) em vez de abrir issue pública. mais detalhes no [SECURITY](SECURITY.md).

---

<div align="center">by <b>@rehfofazap</b> 💜</div>
