// Idioma do app: Português (original), English e Español.
// Troca os textos da tela pelo dicionário abaixo, sem recarregar. Só textos inteiros e conhecidos são
// trocados (nada de conteúdo das pessoas: chat, nicks, nomes de sala ficam como estão).
(() => {
  "use strict";
  const CHAVE = "astra.idioma";
  const IDIOMAS = { pt: "Português", en: "English", es: "Español" };
  // "texto em português": ["english", "español"]
  const D = {
    "Desenvolvido por:": ["Developed by:", "Desarrollado por:"],
    "Carregando Astra...": ["Loading Astra...", "Cargando Astra..."],
    "Carregando a Astra": ["Loading Astra", "Cargando Astra"],
    "Não consegui conectar ao servidor.": ["Couldn't connect to the server.", "No pude conectar al servidor."],
    "Tentar novamente": ["Try again", "Intentar de nuevo"],
    "usuários online": ["users online", "usuarios en línea"],
    "usando o Astra": ["using Astra", "usando Astra"],
    "Recolher ou expandir a barra lateral": ["Collapse or expand the sidebar", "Contraer o expandir la barra lateral"],
    "Início": ["Home", "Inicio"], "Sala": ["Room", "Sala"], "Salas": ["Rooms", "Salas"], "Jogos": ["Games", "Juegos"],
    "Música": ["Music", "Música"], "Mensagens": ["Messages", "Mensajes"], "Grupos": ["Groups", "Grupos"],
    "Sugestões": ["Suggestions", "Sugerencias"], "Áudio": ["Audio", "Audio"], "Tema": ["Theme", "Tema"],
    "Configurações": ["Settings", "Ajustes"], "livre": ["free", "libre"], "Na sala": ["In the room", "En la sala"],
    "Recado do Astra": ["Message from Astra", "Aviso de Astra"], "Desempenho": ["Performance", "Rendimiento"],
    "PC inteiro": ["Whole PC", "PC completo"], "Conectado": ["Connected", "Conectado"], "Online": ["Online", "En línea"],
    "Caixa de correio": ["Mailbox", "Buzón"], "Responder": ["Reply", "Responder"], "Minha carteira": ["My wallet", "Mi billetera"],
    "Baixar": ["Download", "Descargar"], "Sair da sala": ["Leave room", "Salir de la sala"], "Olá!": ["Hi!", "¡Hola!"],
    "Bem-vindo à Astra": ["Welcome to Astra", "Bienvenido a Astra"],
    "Crie sua sala, chame a galera e transmita sua tela em segundos.": ["Create your room, call your friends and stream your screen in seconds.", "Crea tu sala, llama a tus amigos y transmite tu pantalla en segundos."],
    "1080p 60 grátis": ["1080p 60 free", "1080p 60 gratis"], "Assista sem instalar": ["Watch without installing", "Mira sin instalar"],
    "Sem anúncio": ["No ads", "Sin anuncios"], "IP escondido nas salas públicas": ["IP hidden in public rooms", "IP oculta en salas públicas"],
    "Criar sala": ["Create room", "Crear sala"], "Explorar salas": ["Explore rooms", "Explorar salas"],
    "online agora": ["online now", "en línea ahora"], "salas abertas": ["open rooms", "salas abiertas"],
    "Salas ativas": ["Active rooms", "Salas activas"], "Ver todas": ["See all", "Ver todas"],
    "Obrigado por fazer parte da Astra": ["Thanks for being part of Astra", "Gracias por ser parte de Astra"],
    "Cada sala aberta faz a Astra crescer.": ["Every open room helps Astra grow.", "Cada sala abierta hace crecer a Astra."],
    "Salas abertas agora. Clique para entrar.": ["Rooms open now. Click to join.", "Salas abiertas ahora. Haz clic para entrar."],
    "Nenhuma sala aberta agora.": ["No rooms open right now.", "No hay salas abiertas ahora."],
    "Nenhuma sala aberta agora": ["No rooms open right now", "No hay salas abiertas ahora"],
    "Crie a sua e chame os amigos.": ["Create yours and invite your friends.", "Crea la tuya e invita a tus amigos."],
    "Ninguém está transmitindo": ["Nobody is streaming", "Nadie está transmitiendo"],
    "Quando alguém da sala entrar ao vivo, a tela aparece aqui.": ["When someone in the room goes live, their screen shows up here.", "Cuando alguien de la sala esté en vivo, su pantalla aparece aquí."],
    "Modo relaxado: quem transmite sabe que você está curtindo de longe.": ["Relaxed mode: the streamer knows you're watching from afar.", "Modo relajado: quien transmite sabe que estás mirando de lejos."],
    "Voltar": ["Back", "Volver"], "Transmitir tela": ["Share screen", "Transmitir pantalla"], "Câmera": ["Camera", "Cámara"],
    "Pausar": ["Pause", "Pausar"], "Copiar link": ["Copy link", "Copiar enlace"], "Acorde!": ["Wake up!", "¡Despierta!"],
    "Assista relaxado": ["Watch relaxed", "Mira relajado"], "Parar de assistir": ["Stop watching", "Dejar de mirar"],
    "Este navegador não deixa compartilhar a tela. Aqui dá para assistir; para transmitir, use o programa no PC ou o app Android.": ["This browser can't share the screen. You can watch here; to stream, use the PC program or the Android app.", "Este navegador no permite compartir la pantalla. Aquí puedes mirar; para transmitir, usa el programa de PC o la app de Android."],
    "Minigames opcionais da Astra. Ganhos em AstraDoll, na sua carteira.": ["Optional Astra minigames. Winnings in AstraDoll, in your wallet.", "Minijuegos opcionales de Astra. Ganancias en AstraDoll, en tu billetera."],
    "Ouça sozinho ou numa Jam com os amigos, sem precisar de sala.": ["Listen alone or in a Jam with friends, no room needed.", "Escucha solo o en una Jam con amigos, sin necesitar sala."],
    "Começar": ["Start", "Empezar"], "Ouvir sozinho": ["Listen alone", "Escuchar solo"],
    "Só você escuta. Dá para chamar alguém depois.": ["Only you listen. You can invite someone later.", "Solo tú escuchas. Puedes invitar a alguien después."],
    "Criar uma Jam": ["Create a Jam", "Crear una Jam"],
    "Todo mundo ouve a mesma música, no mesmo tempo.": ["Everyone hears the same song, at the same time.", "Todos escuchan la misma canción, al mismo tiempo."],
    "Pública": ["Public", "Pública"], "Só com link": ["Link only", "Solo con enlace"], "Criar Jam": ["Create Jam", "Crear Jam"],
    "Entrar": ["Join", "Entrar"], "Jams abertas": ["Open Jams", "Jams abiertas"], "Convidar": ["Invite", "Invitar"],
    "Aparecer na lista de Jams abertas": ["Show in the open Jams list", "Aparecer en la lista de Jams abiertas"],
    "Só eu controlo a música": ["Only I control the music", "Solo yo controlo la música"],
    "Gerar um link novo (o antigo para de valer)": ["Make a new link (the old one stops working)", "Generar un enlace nuevo (el anterior deja de valer)"],
    "Sair da Jam": ["Leave Jam", "Salir de la Jam"], "Nada tocando ainda": ["Nothing playing yet", "Nada sonando todavía"],
    "Escolha ouvir sozinho, crie uma Jam ou entre numa. Funciona com YouTube, Spotify e SoundCloud.": ["Listen alone, create a Jam or join one. Works with YouTube, Spotify and SoundCloud.", "Escucha solo, crea una Jam o únete a una. Funciona con YouTube, Spotify y SoundCloud."],
    "Chat da sala": ["Room chat", "Chat de la sala"], "Favoritos": ["Favorites", "Favoritos"], "★ Favoritos": ["★ Favorites", "★ Favoritos"],
    "Procurar": ["Search", "Buscar"], "Mais": ["More", "Más"], "Música da sala": ["Room music", "Música de la sala"],
    "Nenhuma música tocando.": ["No music playing.", "No hay música sonando."],
    "Coloque uma aqui embaixo: todo mundo da sala ouve junto.": ["Add one below: everyone in the room listens together.", "Pon una aquí abajo: toda la sala escucha junta."],
    "Clique para ouvir": ["Click to listen", "Haz clic para escuchar"], "Tocando agora": ["Now playing", "Sonando ahora"],
    "Ouvir junto, sem Premium": ["Listen together, no Premium", "Escuchar juntos, sin Premium"],
    "Não precisa de Spotify Premium.": ["No Spotify Premium needed.", "No necesitas Spotify Premium."],
    "Cole o nome, o link ou a playlist: todo mundo ouve no mesmo tempo.": ["Paste the name, link or playlist: everyone listens in sync.", "Pega el nombre, el enlace o la playlist: todos escuchan a la vez."],
    "Podem acontecer bugs, ainda estamos em beta. Obrigado pela paciência!": ["Bugs may happen, we're still in beta. Thanks for your patience!", "Puede haber errores, todavía estamos en beta. ¡Gracias por la paciencia!"],
    "Próximas": ["Up next", "Siguientes"], "Ajustar papel de parede": ["Adjust wallpaper", "Ajustar fondo"],
    "Arraste a foto para mudar o lugar. Use a rodinha do mouse para aproximar.": ["Drag the photo to move it. Use the mouse wheel to zoom.", "Arrastra la foto para moverla. Usa la rueda del ratón para acercar."],
    "Desfoque": ["Blur", "Desenfoque"], "Brilho": ["Brightness", "Brillo"], "Painéis": ["Panels", "Paneles"],
    "transparente ↔ sólido": ["transparent ↔ solid", "transparente ↔ sólido"], "Trocar foto": ["Change photo", "Cambiar foto"],
    "Cancelar": ["Cancel", "Cancelar"], "Salvar": ["Save", "Guardar"], "Editar perfil": ["Edit profile", "Editar perfil"],
    "Conta": ["Account", "Cuenta"], "Minha conta": ["My account", "Mi cuenta"], "Mensagens privadas": ["Private messages", "Mensajes privados"],
    "Aparência": ["Appearance", "Apariencia"], "Notificações": ["Notifications", "Notificaciones"], "Voz e áudio": ["Voice & audio", "Voz y audio"],
    "Teclas": ["Keys", "Teclas"], "Extras e minigames": ["Extras & minigames", "Extras y minijuegos"], "Fale com o dono": ["Contact the owner", "Habla con el dueño"],
    "Sobre o Astra": ["About Astra", "Acerca de Astra"], "Idioma": ["Language", "Idioma"], "Perfil": ["Profile", "Perfil"],
    "Foto, capa, cor, recado e Conectar com o Discord.": ["Photo, cover, color, status message and Connect with Discord.", "Foto, portada, color, estado y Conectar con Discord."],
    "Nome": ["Name", "Nombre"], "Mudar nome": ["Change name", "Cambiar nombre"], "Status": ["Status", "Estado"],
    "Conversas criptografadas entre os aparelhos: o servidor só repassa. Elas ficam salvas neste aparelho. A trava de tela com PIN e o botão CL ficam dentro da janela do privado.": ["Chats encrypted between devices: the server only relays them. They are saved on this device. The PIN screen lock and the CL button are inside the private window.", "Chats cifrados entre los dispositivos: el servidor solo los reenvía. Se guardan en este dispositivo. El bloqueo de pantalla con PIN y el botón CL están dentro de la ventana privada."],
    "Abrir as conversas": ["Open chats", "Abrir conversaciones"], "Nenhuma mensagem nova.": ["No new messages.", "No hay mensajes nuevos."],
    "Abrir": ["Open", "Abrir"], "Tema e papel de parede": ["Theme & wallpaper", "Tema y fondo"],
    "All black, foto de fundo, desfoque e transparência dos painéis.": ["All black, background photo, blur and panel transparency.", "Todo negro, foto de fondo, desenfoque y transparencia de los paneles."],
    "Pop-up das mensagens": ["Message pop-up", "Ventana de mensajes"],
    "As mensagens do chat aparecem por cima do jogo.": ["Chat messages show on top of the game.", "Los mensajes del chat aparecen sobre el juego."],
    "Esconder o chat enquanto transmito": ["Hide chat while I stream", "Ocultar el chat mientras transmito"],
    "Ao vivo, as mensagens não aparecem por cima do jogo. (Quem assiste nunca vê esse chat: ele fica fora da transmissão.)": ["While live, messages don't show on top of the game. (Viewers never see this chat: it stays out of the stream.)", "En vivo, los mensajes no aparecen sobre el juego. (Quien mira nunca ve este chat: queda fuera de la transmisión.)"],
    "Acorde": ["Wake-up bell", "Despertador"],
    "Quem transmite pode tocar a campainha para chamar você.": ["The streamer can ring the bell to call you.", "Quien transmite puede tocar el timbre para llamarte."],
    "Mini tela automática": ["Automatic mini screen", "Minipantalla automática"],
    "Ao minimizar assistindo alguém, a tela continua numa janelinha.": ["When you minimize while watching, the stream keeps playing in a small window.", "Al minimizar mientras miras, la pantalla sigue en una ventanita."],
    "No status": ["With status", "Con el estado"], "Não perturbe": ["Do not disturb", "No molestar"],
    "o Windows não mostra notificações do Astra.": ["Windows won't show Astra notifications.", "Windows no muestra notificaciones de Astra."],
    "Tecla de emergência": ["Panic key", "Tecla de emergencia"],
    "Apaga na hora todos os rabiscos da tela. Se você está transmitindo, some para todo mundo que assiste. Funciona até com o jogo na frente.": ["Instantly clears all drawings on the screen. If you're streaming, they disappear for everyone watching. Works even with the game in front.", "Borra al instante todos los dibujos de la pantalla. Si estás transmitiendo, desaparecen para todos. Funciona incluso con el juego delante."],
    "Escolher tecla": ["Choose key", "Elegir tecla"], "Tirar": ["Remove", "Quitar"],
    "MyWaifu e outros extras": ["MyWaifu and other extras", "MyWaifu y otros extras"],
    "Tudo opcional. Ligue só o que quiser.": ["All optional. Turn on only what you want.", "Todo opcional. Activa solo lo que quieras."],
    "Microfone": ["Microphone", "Micrófono"], "Qual microfone a voz das salas usa.": ["Which microphone room voice uses.", "Qué micrófono usa la voz de las salas."],
    "Onde ouvir": ["Output", "Salida"], "Fone ou caixa de som em que você ouve a voz.": ["Headphones or speakers where you hear voice.", "Auriculares o altavoces donde escuchas la voz."],
    "Volume da voz": ["Voice volume", "Volumen de voz"],
    "Volume geral de quem fala. Para mudar o de uma pessoa, clique no nome dela na barra da voz.": ["Overall volume of speakers. To change one person's, click their name in the voice bar.", "Volumen general de quien habla. Para cambiar el de una persona, haz clic en su nombre en la barra de voz."],
    "Como o microfone liga": ["How the mic turns on", "Cómo se activa el micrófono"], "Modo": ["Mode", "Modo"],
    "Detecção de voz liga sozinho quando você fala. Apertar para falar só manda o som segurando a tecla (com o site aberto na frente).": ["Voice activity turns on by itself when you talk. Push to talk only sends sound while holding the key (with the app in front).", "La detección de voz se activa sola cuando hablas. Pulsar para hablar solo envía sonido mientras mantienes la tecla (con la app al frente)."],
    "Detecção de voz": ["Voice activity", "Detección de voz"], "Apertar para falar": ["Push to talk", "Pulsar para hablar"],
    "Tecla": ["Key", "Tecla"], "Clique e aperte a tecla que você quer usar.": ["Click and press the key you want to use.", "Haz clic y pulsa la tecla que quieres usar."],
    "Sensibilidade e teste": ["Sensitivity & test", "Sensibilidad y prueba"],
    "Arraste a marca: abaixo dela o microfone fica fechado.": ["Drag the marker: below it the mic stays closed.", "Arrastra la marca: por debajo, el micrófono queda cerrado."],
    "Testar": ["Test", "Probar"], "Supressão de ruído": ["Noise suppression", "Supresión de ruido"],
    "Tira ventilador, teclado e barulho de fundo.": ["Removes fans, keyboard and background noise.", "Quita ventiladores, teclado y ruido de fondo."],
    "Cancelamento de eco": ["Echo cancellation", "Cancelación de eco"],
    "Evita que os outros se escutem de volta quando você usa caixa de som.": ["Stops others hearing themselves back when you use speakers.", "Evita que los demás se escuchen de vuelta cuando usas altavoces."],
    "Atalho: Ctrl+Shift+M liga/desliga o microfone durante a chamada.": ["Shortcut: Ctrl+Shift+M toggles the mic during the call.", "Atajo: Ctrl+Shift+M activa/desactiva el micrófono durante la llamada."],
    "Ideias e problemas": ["Ideas & problems", "Ideas y problemas"],
    "Sua mensagem vai direto para o dono do Astra.": ["Your message goes straight to Astra's owner.", "Tu mensaje va directo al dueño de Astra."],
    "Escrever": ["Write", "Escribir"], "Versão": ["Version", "Versión"], "Por que é livre": ["Why it's free", "Por qué es libre"],
    "Banner da sala": ["Room banner", "Banner de la sala"], "(opcional)": ["(optional)", "(opcional)"], "Tirar o banner": ["Remove banner", "Quitar banner"],
    "Nome da sala": ["Room name", "Nombre de la sala"], "Jogatina": ["Gaming", "Partida"], "Filme": ["Movie", "Película"], "Só de boa": ["Just chilling", "Tranqui"],
    "Quem pode entrar": ["Who can join", "Quién puede entrar"], "Com senha": ["Password", "Con contraseña"], "Aprovação": ["Approval", "Aprobación"],
    "Aparece na lista e qualquer pessoa entra na hora.": ["Shows in the list and anyone can join right away.", "Aparece en la lista y cualquiera entra al instante."],
    "Qual vai ser o seu nick?": ["What's your nickname?", "¿Cuál será tu nick?"],
    "É assim que os amigos te acham. Cada nick é de uma pessoa só. Dá para trocar quando quiser clicando nele.": ["It's how friends find you. Each nickname belongs to one person. You can change it anytime by clicking it.", "Así te encuentran tus amigos. Cada nick es de una sola persona. Puedes cambiarlo cuando quieras haciendo clic."],
    "Pronto": ["Done", "Listo"], "Feito para uso livre. O código do programa de PC é publicado.": ["Made to be free. The PC app's source code is published.", "Hecho para uso libre. El código del programa de PC es público."],
    "A sua tela não é gravada. Em sala pública e no Modo leve ela passa pelo servidor da Astra.": ["Your screen is not recorded. In public rooms and Light mode it goes through Astra's server.", "Tu pantalla no se graba. En salas públicas y en Modo ligero pasa por el servidor de Astra."],
    "Mensagens e imagens somem quando todos saem da sala.": ["Messages and images vanish when everyone leaves the room.", "Mensajes e imágenes desaparecen cuando todos salen de la sala."],
    "rejeite as big techs.": ["reject big tech.", "rechaza a las big tech."], "Fechar": ["Close", "Cerrar"], "📝 Atualização": ["📝 Update", "📝 Actualización"],
    "Obrigado por ajudar a melhorar o Astra 💜": ["Thanks for helping improve Astra 💜", "Gracias por ayudar a mejorar Astra 💜"],
    "Mande uma ideia ou avise de um problema: vai direto para o dono do Astra. Quando a sua ideia virar novidade, o seu nome aparece nela.": ["Send an idea or report a problem: it goes straight to Astra's owner. When your idea becomes a feature, your name shows on it.", "Envía una idea o avisa de un problema: va directo al dueño de Astra. Cuando tu idea se vuelva novedad, tu nombre aparece en ella."],
    "💡 Ideia": ["💡 Idea", "💡 Idea"], "✨ Sugestão": ["✨ Suggestion", "✨ Sugerencia"], "⚠️ Problema": ["⚠️ Problem", "⚠️ Problema"], "Enviar": ["Send", "Enviar"],
    "Muda só as cores do programa. A transmissão continua igual.": ["Only changes the app colors. The stream stays the same.", "Solo cambia los colores del programa. La transmisión sigue igual."],
    "Escuro": ["Dark", "Oscuro"], "All black": ["All black", "Todo negro"], "Claro": ["Light", "Claro"], "Papel de parede": ["Wallpaper", "Fondo de pantalla"],
    "Sem papel de parede": ["No wallpaper", "Sin fondo"], "Escolher foto": ["Choose photo", "Elegir foto"], "Ajustar": ["Adjust", "Ajustar"],
    "Tirar papel de parede": ["Remove wallpaper", "Quitar fondo"], "Só você vê. Fica guardado só neste aparelho.": ["Only you see it. Saved only on this device.", "Solo tú lo ves. Se guarda solo en este dispositivo."],
    "Minigames e extras são opcionais: só baixa quem instalar.": ["Minigames and extras are optional: only downloaded if you install them.", "Minijuegos y extras son opcionales: solo se descargan si los instalas."],
    "Nenhum extra ainda. Quando tiver, ele aparece aqui.": ["No extras yet. They'll show up here.", "Aún no hay extras. Aparecerán aquí."],
    "Recortar a tela": ["Crop the screen", "Recortar la pantalla"],
    "Arraste por cima da imagem para marcar o pedaço que os amigos vão ver.": ["Drag over the image to mark the part your friends will see.", "Arrastra sobre la imagen para marcar la parte que verán tus amigos."],
    "Tela inteira": ["Full screen", "Pantalla completa"], "Recortar": ["Crop", "Recortar"], "Meu perfil": ["My profile", "Mi perfil"],
    "Tudo aqui é opcional. Os amigos veem na lista e ao passar o mouse no seu nome.": ["Everything here is optional. Friends see it in the list and when hovering your name.", "Todo aquí es opcional. Tus amigos lo ven en la lista y al pasar el ratón por tu nombre."],
    "Servidor do Discord": ["Discord server", "Servidor de Discord"], "Foto (pode ser GIF)": ["Photo (GIF allowed)", "Foto (puede ser GIF)"],
    "Escolher foto ou GIF": ["Choose photo or GIF", "Elegir foto o GIF"], "Capa (foto, GIF ou degradê)": ["Cover (photo, GIF or gradient)", "Portada (foto, GIF o degradado)"],
    "Arraste para ajustar a posição": ["Drag to adjust the position", "Arrastra para ajustar la posición"], "ou": ["or", "o"], "Sem capa": ["No cover", "Sin portada"],
    "Força da capa na lista": ["Cover strength in the list", "Intensidad de la portada en la lista"], "suave": ["soft", "suave"], "forte": ["strong", "fuerte"],
    "Cor da moldura e do nick": ["Frame and nickname color", "Color del marco y del nick"], "Recado (aparece embaixo do nick)": ["Status message (shows under your nickname)", "Estado (aparece debajo del nick)"],
    "Não some": ["Never clears", "No se borra"], "Some em 1 hora": ["Clears in 1 hour", "Se borra en 1 hora"], "Some em 4 horas": ["Clears in 4 hours", "Se borra en 4 horas"],
    "Some em 8 horas": ["Clears in 8 hours", "Se borra en 8 horas"], "Some em 1 dia": ["Clears in 1 day", "Se borra en 1 día"],
    "Como os outros te veem": ["How others see you", "Cómo te ven los demás"], "Com o mouse em cima": ["On hover", "Al pasar el ratón"], "Salvar perfil": ["Save profile", "Guardar perfil"],
    "Baixar o AstraScreenShare": ["Download AstraScreenShare", "Descargar AstraScreenShare"], "PC (Windows)": ["PC (Windows)", "PC (Windows)"], "Celular (Android)": ["Phone (Android)", "Celular (Android)"],
    "Telas": ["Screens", "Pantallas"], "Janelas": ["Windows", "Ventanas"], "Qualidade": ["Quality", "Calidad"], "1080p · 60 qps (recomendada)": ["1080p · 60 fps (recommended)", "1080p · 60 fps (recomendada)"],
    "720p · 30 qps": ["720p · 30 fps", "720p · 30 fps"], "1080p · 30 qps": ["1080p · 30 fps", "1080p · 30 fps"], "1080p · 60 qps": ["1080p · 60 fps", "1080p · 60 fps"],
    "Original · 60 qps": ["Original · 60 fps", "Original · 60 fps"], "4K · 60 qps (upload bom)": ["4K · 60 fps (good upload)", "4K · 60 fps (buena subida)"],
    "Som": ["Sound", "Sonido"], "Som do PC, sem as vozes do Discord": ["PC sound, without Discord voices", "Sonido del PC, sin las voces de Discord"],
    "Só o som da janela escolhida": ["Only the chosen window's sound", "Solo el sonido de la ventana elegida"], "Todo o som do PC": ["All PC sound", "Todo el sonido del PC"],
    "Sem som": ["No sound", "Sin sonido"], "Conteúdo": ["Content", "Contenido"], "Fluido (jogos e vídeos)": ["Smooth (games and videos)", "Fluido (juegos y videos)"],
    "Nítido (textos)": ["Sharp (text)", "Nítido (textos)"], "Esconder durante a live": ["Hide while live", "Ocultar en vivo"], "Mostrar": ["Show", "Mostrar"],
    "Mostrar teclas apertadas": ["Show pressed keys", "Mostrar teclas pulsadas"], "Não": ["No", "No"], "Sim (não use ao digitar senhas)": ["Yes (don't use while typing passwords)", "Sí (no lo uses al escribir contraseñas)"],
    "Aceleração por hardware": ["Hardware acceleration", "Aceleración por hardware"], "Ligada (placa de vídeo)": ["On (graphics card)", "Activada (tarjeta de video)"],
    "Desligada (processador)": ["Off (processor)", "Desactivada (procesador)"], "Modo leve": ["Light mode", "Modo ligero"], "Desligado": ["Off", "Desactivado"], "Ligado": ["On", "Activado"],
    "Esconder o mouse em jogos": ["Hide the mouse in games", "Ocultar el ratón en juegos"], "Entrar ao vivo": ["Go live", "Entrar en vivo"],
    "ACORDA!": ["WAKE UP!", "¡DESPIERTA!"], "Tô vendo!": ["I'm watching!", "¡Estoy mirando!"],
    "Não quero mais receber o Acorde": ["Stop sending me wake-up bells", "No quiero recibir más el despertador"],
    "Doar para": ["Donate to", "Donar a"], "Você tem": ["You have", "Tienes"], "Voz": ["Voice", "Voz"], "Doar": ["Donate", "Donar"],
    "Sala com senha": ["Password-protected room", "Sala con contraseña"], "Vale a partir de agora. Quem já está na sala continua.": ["Applies from now on. People already in the room stay.", "Vale desde ahora. Quien ya está en la sala sigue."],
    "Estatísticas da Astra": ["Astra stats", "Estadísticas de Astra"], "Navegação": ["Navigation", "Navegación"], "Mostrar os jogos": ["Show games", "Mostrar juegos"],
    "Sugestões e melhorias": ["Suggestions & improvements", "Sugerencias y mejoras"], "Mande uma sugestão ou melhoria para o Astra": ["Send a suggestion or improvement to Astra", "Envía una sugerencia o mejora a Astra"],
    "Desativar áudio": ["Mute audio", "Silenciar audio"], "Desativar áudio (Ctrl+Shift+D)": ["Mute audio (Ctrl+Shift+D)", "Silenciar audio (Ctrl+Shift+D)"],
    "Alternar tema claro ou escuro": ["Toggle light or dark theme", "Alternar tema claro u oscuro"], "Mostrar ou esconder os números": ["Show or hide the numbers", "Mostrar u ocultar los números"],
    "O que medir": ["What to measure", "Qué medir"], "Atraso da tela": ["Screen delay", "Retraso de pantalla"], "Mudar o nome que os amigos veem": ["Change the name friends see", "Cambiar el nombre que ven tus amigos"],
    "Mudar o status": ["Change status", "Cambiar estado"], "Fale com o dono (ideias e problemas)": ["Contact the owner (ideas & problems)", "Habla con el dueño (ideas y problemas)"],
    "Fale com o dono: ideias e problemas": ["Contact the owner: ideas & problems", "Habla con el dueño: ideas y problemas"], "Tema: Escuro ou All black": ["Theme: Dark or All black", "Tema: Oscuro o Todo negro"],
    "Escolher o tema": ["Choose theme", "Elegir tema"], "Extras e minigames (MyWaifu)": ["Extras & minigames (MyWaifu)", "Extras y minijuegos (MyWaifu)"],
    "Mensagens privadas (criptografadas)": ["Private messages (encrypted)", "Mensajes privados (cifrados)"], "Esconder a coluna da sala": ["Hide the room column", "Ocultar la columna de la sala"],
    "Baixar a versão mais nova do AstraScreenShare": ["Download the latest AstraScreenShare", "Descargar la versión más nueva de AstraScreenShare"],
    "Esconder chat e música": ["Hide chat and music", "Ocultar chat y música"], "Pessoas da comunidade": ["Community members", "Personas de la comunidad"],
    "Mostra a sua câmera para a sala (junto com a tela ou sozinha)": ["Shows your camera to the room (with the screen or alone)", "Muestra tu cámara a la sala (con la pantalla o sola)"],
    "Copia um link: quem abrir só digita um nome e assiste a sua tela": ["Copies a link: whoever opens it just types a name and watches your screen", "Copia un enlace: quien lo abra solo escribe un nombre y mira tu pantalla"],
    "Chama quem está assistindo para ver uma jogada agora": ["Calls viewers to see a play right now", "Llama a quien está mirando para ver una jugada ahora"],
    "Avisa quem transmite que você está assistindo deitado ou de longe": ["Tells the streamer you're watching lying down or from afar", "Avisa a quien transmite que miras acostado o de lejos"],
    "Esconde as telas e o som delas, sem sair da sala": ["Hides the screens and their sound, without leaving the room", "Oculta las pantallas y su sonido, sin salir de la sala"],
    "Nome da Jam": ["Jam name", "Nombre de la Jam"], "Quem vê a Jam": ["Who sees the Jam", "Quién ve la Jam"], "Recebeu um convite? Cole o link aqui": ["Got an invite? Paste the link here", "¿Recibiste una invitación? Pega el enlace aquí"],
    "Link de convite da Jam": ["Jam invite link", "Enlace de invitación de la Jam"], "Quem está na Jam": ["Who's in the Jam", "Quién está en la Jam"],
    "Dar CL: apaga o chat da sala para todo mundo": ["Clear: deletes the room chat for everyone", "Limpiar: borra el chat de la sala para todos"],
    "Procurar GIFs": ["Search GIFs", "Buscar GIFs"], "Mandar imagem (ou cole com Ctrl+V)": ["Send image (or paste with Ctrl+V)", "Enviar imagen (o pega con Ctrl+V)"],
    "Mandar imagem": ["Send image", "Enviar imagen"], "Mensagem": ["Message", "Mensaje"], "Pausar para todos": ["Pause for everyone", "Pausar para todos"],
    "Pular para a próxima": ["Skip to next", "Saltar a la siguiente"], "Silenciar só para você": ["Mute just for you", "Silenciar solo para ti"],
    "Volume (só para você)": ["Volume (just for you)", "Volumen (solo para ti)"], "Volume": ["Volume", "Volumen"], "Nome, link ou playlist": ["Name, link or playlist", "Nombre, enlace o playlist"],
    "Procurar pelo nick": ["Search by nickname", "Buscar por nick"], "Mensagem privada": ["Private message", "Mensaje privado"], "Seções": ["Sections", "Secciones"],
    "Fechar (Esc)": ["Close (Esc)", "Cerrar (Esc)"], "Sensibilidade do microfone": ["Microphone sensitivity", "Sensibilidad del micrófono"],
    "Escolher um banner (opcional)": ["Choose a banner (optional)", "Elegir un banner (opcional)"], "Ex.: Jogatina": ["E.g.: Gaming", "Ej.: Partida"],
    "Sugestões de nome": ["Name suggestions", "Sugerencias de nombre"], "Senha da sala (mín. 4 caracteres)": ["Room password (min. 4 characters)", "Contraseña de la sala (mín. 4 caracteres)"],
    "Senha da sala": ["Room password", "Contraseña de la sala"], "Mostrar a senha": ["Show password", "Mostrar contraseña"], "Tipo": ["Type", "Tipo"],
    "Escreva aqui...": ["Write here...", "Escribe aquí..."], "Ex.: jogando de boa": ["E.g.: just gaming", "Ej.: jugando tranqui"], "Quando o recado some": ["When the status clears", "Cuándo se borra el estado"],
    "Valor": ["Amount", "Monto"], "Outro": ["Other", "Otro"], "Outro valor": ["Other amount", "Otro monto"], "Recado (a sala ouve em voz alta)": ["Message (the room hears it out loud)", "Mensaje (la sala lo escucha en voz alta)"],
    "Música tocando": ["Music playing", "Música sonando"], "Abrir a música": ["Open music", "Abrir la música"], "Senha": ["Password", "Contraseña"],
    "Nova senha (mín. 4 caracteres)": ["New password (min. 4 characters)", "Nueva contraseña (mín. 4 caracteres)"], "Nova senha": ["New password", "Nueva contraseña"],
    // textos que o app monta na hora
    "Disponível": ["Available", "Disponible"], "Ausente": ["Away", "Ausente"], "Invisível": ["Invisible", "Invisible"],
    "Ao vivo": ["Live", "En vivo"], "AO VIVO": ["LIVE", "EN VIVO"], "Com aprovação": ["Approval", "Con aprobación"], "Protegida": ["Protected", "Protegida"],
    "Pedir": ["Request", "Pedir"], "Assistindo": ["Watching", "Mirando"], "Transmitindo": ["Streaming", "Transmitiendo"],
    "Assistindo relaxado": ["Watching relaxed", "Mirando relajado"], "Assistindo pelo link": ["Watching via link", "Mirando por enlace"],
    "Apoiador": ["Supporter", "Colaborador"], "você": ["you", "tú"], "Você": ["You", "Tú"],
    "Entrar na call": ["Join call", "Entrar a la llamada"], "Sair da voz": ["Leave voice", "Salir de la voz"], "Pessoas na voz": ["People in voice", "Personas en la voz"],
    "Voz da sala": ["Room voice", "Voz de la sala"], "Ligar o microfone": ["Turn mic on", "Activar micrófono"], "Desligar o microfone": ["Turn mic off", "Desactivar micrófono"],
    "Parar de ouvir": ["Deafen", "Dejar de escuchar"], "Voltar a ouvir": ["Undeafen", "Volver a escuchar"], "Conexão boa": ["Good connection", "Buena conexión"],
    "Conexão instável": ["Unstable connection", "Conexión inestable"], "Conexão ruim": ["Bad connection", "Mala conexión"], "Conectando…": ["Connecting…", "Conectando…"],
    "Padrão do sistema": ["System default", "Predeterminado del sistema"], "Parar": ["Stop", "Detener"], "Aperte uma tecla…": ["Press a key…", "Pulsa una tecla…"],
    "Sem acesso ao microfone": ["No microphone access", "Sin acceso al micrófono"],
    "Falar e ouvir com quem está na sala": ["Talk and listen with people in the room", "Hablar y escuchar con quien está en la sala"],
    "Falar e ouvir com quem está na call": ["Talk and listen with people in the call", "Hablar y escuchar con quien está en la llamada"],
    "Clique em Testar e fale para ver se o microfone pega.": ["Click Test and speak to check your mic.", "Haz clic en Probar y habla para ver si el micrófono funciona."],
    "Nova versão do Astra": ["New Astra version", "Nueva versión de Astra"], "Atualizar": ["Update", "Actualizar"],
    "Leva 2 segundos e você volta para onde estava.": ["Takes 2 seconds and you're back where you were.", "Tarda 2 segundos y vuelves a donde estabas."],
    "Escolha o idioma do app. Fica guardado neste aparelho.": ["Choose the app language. Saved on this device.", "Elige el idioma de la app. Se guarda en este dispositivo."],
    "Idioma do app": ["App language", "Idioma de la app"],
    "Código de recuperação": ["Recovery code", "Código de recuperación"], "Gerar código": ["Generate code", "Generar código"],
    "Já tenho conta": ["I already have an account", "Ya tengo cuenta"], "Usar código": ["Use code", "Usar código"],
    "Recuperar conta": ["Recover account", "Recuperar cuenta"], "Já guardei": ["Saved it", "Ya lo guardé"], "Copiar": ["Copy", "Copiar"],
    "Já tenho conta (formatei ou troquei de PC)": ["I already have an account (new or formatted PC)", "Ya tengo cuenta (formateé o cambié de PC)"],
    "Se formatar o PC, é com ele que a sua conta volta.": ["If you format your PC, this is how your account comes back.", "Si formateas el PC, así vuelve tu cuenta."],
    "Tem um código de outra conta? Cole aqui para voltar para ela.": ["Have a code from another account? Paste it here to go back to it.", "¿Tienes un código de otra cuenta? Pégalo aquí para volver a ella."],
    "Proteja a sua conta": ["Protect your account", "Protege tu cuenta"],
    "Conta verificada pelo Discord": ["Account verified through Discord", "Cuenta verificada con Discord"],
    "Trocar de conta": ["Switch account", "Cambiar de cuenta"], "Sair da conta": ["Sign out", "Cerrar sesión"], "Sair": ["Sign out", "Salir"],
    "Tem o código de outra conta? Cole aqui para entrar nela.": ["Have another account's code? Paste it here to sign in to it.", "¿Tienes el código de otra cuenta? Pégalo aquí para entrar en ella."],
    "Tira esta conta deste aparelho. Para voltar depois, use o código de recuperação.": ["Removes this account from this device. To come back later, use the recovery code.", "Quita esta cuenta de este dispositivo. Para volver después, usa el código de recuperación."],
    "Sair mesmo assim": ["Sign out anyway", "Salir de todos modos"], "Gerar código antes": ["Generate code first", "Generar código antes"],
    "Entrar em outra conta": ["Sign in to another account", "Entrar en otra cuenta"], "Entrar na conta": ["Sign in", "Entrar en la cuenta"],
  };
  // textos com partes que mudam (números, nomes)
  const SAUDACAO = { "Bom dia": ["Good morning", "Buenos días"], "Boa tarde": ["Good afternoon", "Buenas tardes"], "Boa noite": ["Good evening", "Buenas noches"], "Boa madrugada": ["Good night", "Buenas madrugadas"] };
  const REGRAS = [
    [/^(\d+) participantes?$/, (m, i) => i ? `${m[1]} participante${m[1] === "1" ? "" : "s"}` : `${m[1]} participant${m[1] === "1" ? "" : "s"}`],
    [/^(Online|ONLINE) — (\d+)$/, (m, i) => `${["Online", "En línea"][i]} — ${m[2]}`],
    [/^Ao vivo em (.+)$/, (m, i) => `${["Live in", "En vivo en"][i]} ${m[1]}`],
    [/^(\d+) salas abertas agora\. Clique para entrar\.$/, (m, i) => i ? `${m[1]} salas abiertas ahora. Haz clic para entrar.` : `${m[1]} rooms open now. Click to join.`],
    [/^1 sala aberta agora\. Clique para entrar\.$/, (m, i) => ["1 room open now. Click to join.", "1 sala abierta ahora. Haz clic para entrar."][i]],
    [/^Entrar na call · (\d+)$/, (m, i) => `${["Join call", "Entrar a la llamada"][i]} · ${m[1]}`],
    [/^(\d+) AstraDolls?$/, (m) => `${m[1]} AstraDoll`],
    [/^(Bom dia|Boa tarde|Boa noite|Boa madrugada)([,!].*)?$/i, (m, i) => {
      const k = Object.keys(SAUDACAO).find((x) => x.toLowerCase() === m[1].toLowerCase());
      let t = SAUDACAO[k][i] + (m[2] || "");
      return m[1] === m[1].toUpperCase() ? t.toUpperCase() : t;
    }],
  ];
  // onde nunca traduz: conteúdo escrito pelas pessoas
  const PULAR = "script,style,textarea,input,code,[contenteditable],[data-sem-traducao],#chat-lista,.chat-lista,.chat-msgs,#chat-msgs,.msg-texto,.mensagem,.pv-conversa,.recado-texto";
  const ATRS = ["placeholder", "title", "aria-label"];
  const OBS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRS };
  const ORIG = new WeakMap();      // nó de texto -> texto original em português
  const ORIG_ATR = new WeakMap();  // elemento -> {atributo: original}
  let lingua = "pt", idx = -1;
  try { lingua = localStorage.getItem(CHAVE) || "pt"; } catch (_) {}
  if (!IDIOMAS[lingua]) lingua = "pt";

  // procura ignorando maiúsculas (o CSS às vezes deixa em caixa alta, mas o texto pode vir assim também)
  const MAIUSC = new Map(Object.keys(D).map((k) => [k.toUpperCase(), k]));
  function traduzir(pt) {
    if (idx < 0) return pt;
    const t = pt.trim();
    if (!t) return pt;
    let v = D[t] && D[t][idx];
    if (!v) { const k = MAIUSC.get(t.toUpperCase()); if (k && t === t.toUpperCase()) v = D[k][idx].toUpperCase(); }
    if (!v) for (const [re, fn] of REGRAS) { const m = t.match(re); if (m) { v = fn(m, idx); break; } }
    if (!v) return pt;
    return pt.replace(t, v);
  }
  const pular = (el) => !el || (el.closest && el.closest(PULAR));

  function texto(no) {
    if (pular(no.parentElement)) return;
    const atual = no.nodeValue;
    let o = ORIG.get(no);
    // o app trocou o texto depois da última tradução: o novo é o original
    if (o === undefined || (atual !== o.pt && atual !== o.tr)) { o = { pt: atual, tr: null }; ORIG.set(no, o); }
    const novo = idx < 0 ? o.pt : traduzir(o.pt);
    o.tr = novo;
    if (atual !== novo) no.nodeValue = novo;
  }
  function atributos(el) {
    if (pular(el)) return;
    let o = ORIG_ATR.get(el);
    for (const a of ATRS) {
      if (!el.hasAttribute(a)) continue;
      const atual = el.getAttribute(a);
      if (!o) { o = {}; ORIG_ATR.set(el, o); }
      if (!o[a] || (atual !== o[a].pt && atual !== o[a].tr)) o[a] = { pt: atual, tr: null };
      const novo = idx < 0 ? o[a].pt : traduzir(o[a].pt);
      o[a].tr = novo;
      if (atual !== novo) el.setAttribute(a, novo);
    }
  }
  function percorrer(raiz) {
    if (raiz.nodeType === 3) return texto(raiz);
    if (raiz.nodeType !== 1 || pular(raiz)) return;
    atributos(raiz);
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && pular(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) texto(n); else atributos(n); }
  }

  // mudanças que o app faz na tela: traduz em lote, uma vez por quadro
  const fila = new Set();
  let agendado = false;
  const obs = new MutationObserver((ms) => {
    if (idx < 0) return;
    for (const m of ms) {
      if (m.type === "childList") m.addedNodes.forEach((n) => fila.add(n));
      else fila.add(m.target);
    }
    if (!agendado) { agendado = true; requestAnimationFrame(esvaziar); }
  });
  function esvaziar() {
    agendado = false;
    const lista = [...fila];
    fila.clear();
    for (const n of lista) if (n.isConnected) percorrer(n);
  }

  function aplicar(l) {
    lingua = IDIOMAS[l] ? l : "pt";
    idx = { pt: -1, en: 0, es: 1 }[lingua];
    try { localStorage.setItem(CHAVE, lingua); } catch (_) {}
    document.documentElement.lang = { pt: "pt-BR", en: "en", es: "es" }[lingua];
    percorrer(document.body);
    // em português não precisa vigiar a tela (é o texto original): zero custo para quem não troca
    if (idx >= 0) obs.observe(document.body, OBS); else obs.disconnect();
    const sel = document.getElementById("cfg-idioma");
    if (sel && sel.value !== lingua) sel.value = lingua;
  }

  // seção "Idioma" nas configurações
  function montarConfig() {
    const sel = document.getElementById("cfg-idioma");
    if (!sel) return;
    sel.textContent = "";
    for (const [k, nome] of Object.entries(IDIOMAS)) { const o = document.createElement("option"); o.value = k; o.textContent = nome; sel.append(o); }
    sel.setAttribute("data-sem-traducao", "");
    sel.value = lingua;
    sel.addEventListener("change", () => aplicar(sel.value));
  }

  function iniciar() {
    montarConfig();
    if (lingua !== "pt") aplicar(lingua);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
  window.astraIdioma = { aplicar, atual: () => lingua };
})();
