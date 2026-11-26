# segurança

## achou uma falha?

não abre issue pública. manda pelo [relato privado de vulnerabilidade](https://github.com/rehfofazap/astrascreenshare/security/advisories/new), só eu vejo.

conta o que dá pra fazer com a falha e como repetir. respondo assim que der.

## o que conta como falha

- entrar numa conta, sala ou transmissão sem ter permissão
- ver a tela, o microfone ou a câmera de alguém sem a pessoa ter liberado
- o app baixando ou rodando coisa que não devia (atualização falsa, por exemplo)
- vazar dado de outra pessoa (conversas, amigos, e-mail)

bug comum (tela travando, som que não sai, botão que não funciona) pode abrir [issue normal](https://github.com/rehfofazap/astrascreenshare/issues/new/choose).

## como o app cuida das coisas

- contas, senhas e salas são conferidas no servidor, não no app
- microfone, câmera e tela só ligam com clique de verdade, e a permissão não fica guardada
- toda atualização é assinada; o app confere a assinatura antes de instalar e recusa se não bater
- o sha256 de cada instalador fica nas notas da [release](https://github.com/rehfofazap/astrascreenshare/releases)

## versões

só a última versão recebe correção. o app atualiza sozinho.
