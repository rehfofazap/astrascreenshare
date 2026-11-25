// Janela de captura escondida (só no programa de PC, Tauri). O WebView2 dela já nasceu com a fonte
// que a pessoa escolheu (--auto-select-desktop-capture-source): o getDisplayMedia pega essa fonte
// sem seletor nenhum. A imagem vai por WebRTC, dentro do PC, para a janela principal (a sala).
// As mensagens passam pelo programa: sinal_captura (daqui para lá) e window.__sinal (de lá para cá).
"use strict";
(async () => {
  const chamar = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args || {});
  const enviar = (o) => chamar("sinal_captura", { msg: JSON.stringify(o) }).catch(() => {});
  const q = new URLSearchParams(location.search);
  const num = (k, d) => Math.max(1, Math.min(Number(q.get(k)) || d, 4096));
  const pc = new RTCPeerConnection({ iceServers: [] });

  // Dentro do PC não há rede no meio: começa e fica em bitrate alto (a principal recodifica para os amigos).
  // 3.0.11: era 15-40 Mbps fixo (até em 720p30): codificar e decodificar isso dentro do PC pesava
  // demais. Agora proporcional ao que foi escolhido (1080p60 ~ 12 Mbps, 4K60 até 30 Mbps).
  const kbps = Math.max(6000, Math.min(30000, Math.round(num("l", 1920) * num("a", 1080) * num("q", 60) / 10000)));
  const bitrateAlto = (sdp) => sdp.replace(/(a=fmtp:\d+ [^\r\n]*packetization-mode=1[^\r\n]*)/g,
    `$1;x-google-min-bitrate=${Math.round(kbps / 3)};x-google-start-bitrate=${Math.round(kbps * 0.8)};x-google-max-bitrate=${kbps}`);
  window.__sinal = async (texto) => {
    try {
      const m = JSON.parse(texto);
      if (m.sdp) await pc.setRemoteDescription({ type: m.sdp.type, sdp: bitrateAlto(m.sdp.sdp) });
    } catch (e) { enviar({ erro: "resposta recusada: " + e.message }); }
  };

  let s;
  try {
    s = await Promise.race([
      navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: num("l", 1920) }, height: { max: num("a", 1080) }, frameRate: { ideal: num("q", 60), max: num("q", 60) } },
        audio: false,
      }),
      new Promise((_, n) => setTimeout(() => n(new Error("a tela escolhida não apareceu")), 10000)),
    ]);
  } catch (e) {
    return enviar({ erro: "Não consegui capturar a tela: " + (e && e.message || e) });
  }
  const v = s.getVideoTracks()[0];
  v.contentHint = "motion";
  v.onended = () => enviar({ fim: true });   // a janela transmitida fechou
  const tr = pc.addTransceiver(v, { direction: "sendonly", streams: [s] });
  // H.264 (placa de vídeo) primeiro.
  const codecs = RTCRtpSender.getCapabilities("video").codecs;
  const h264 = (c) => /h264/i.test(c.mimeType) && /packetization-mode=1/.test(c.sdpFmtpLine || "");
  const alto = (c) => /profile-level-id=(4d|64)/i.test(c.sdpFmtpLine || "");
  tr.setCodecPreferences([...codecs.filter((c) => h264(c) && alto(c)), ...codecs.filter((c) => h264(c) && !alto(c)), ...codecs.filter((c) => !h264(c))]);
  const p = tr.sender.getParameters();
  p.encodings = [{ maxBitrate: kbps * 1000, maxFramerate: num("q", 60) }];
  p.degradationPreference = "maintain-resolution";
  await tr.sender.setParameters(p).catch(() => {});
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") enviar({ erro: "a conexão com a janela principal caiu" }); };
  await pc.setLocalDescription(await pc.createOffer());
  // Só candidatos do próprio PC: saem rápido e vão todos dentro da oferta.
  await new Promise((r) => {
    if (pc.iceGatheringState === "complete") return r();
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") r(); };
    setTimeout(r, 1500);
  });
  enviar({ sdp: pc.localDescription.toJSON() });
})();
