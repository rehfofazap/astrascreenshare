# astra-audio

Ajudante do AstraScreenShare no Windows, em Rust. Substitui o `astra-audio.exe` antigo (C++, sem código-fonte
publicado) mantendo o mesmo protocolo com o app (`src-tauri/src/som.rs`):

| Modo | O que faz | Saída |
|---|---|---|
| `excluir-pid <pid>` | todo o som do PC menos o programa `<pid>` e filhos | PCM 16 bits, 48 kHz, estéreo no stdout |
| `incluir-janela <hwnd> [pid]` | só o som do programa dono da janela | idem |
| `mixar <pid> [nome.exe ...]` | soma o som de cada programa tocando, menos `<pid>` e os nomes | idem |
| `excluir-nome`, `incluir-pid` | variações (o app não usa hoje) | idem |
| `silencio` | "Não perturbe" (só alarmes) enquanto o stdin estiver aberto | `OK silencio <antes>` no stderr |
| `teclas` | removido na 3.0.20 (responde só "ERRO funcao removida") | - |
| `desempenho` | uso da placa de vídeo por programa | `GPU <total> <pid>:<uso> ...` a cada 1 s |

Não grava nada em disco e não usa rede. Precisa do Windows 10 versão 2004 (build 19041) ou mais novo para o som.

Compilar (na VPS, cruzado):

    cargo xwin build --release --target x86_64-pc-windows-msvc
    cp target/x86_64-pc-windows-msvc/release/astra-audio.exe ../src-tauri/som/astra-audio.exe
