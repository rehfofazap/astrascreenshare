//! Captura do som de um programa (ou de todos menos um) pela API "process loopback" do Windows 10 2004+.
//! Formato pedido ao Windows: PCM 16 bits, 48 kHz, estéreo (o Windows converte com AUTOCONVERTPCM).
use std::io::Write;
use std::sync::Mutex;

use windows::core::{implement, Interface, IUnknown, Ref, Result as WinResult, HRESULT, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{CoInitializeEx, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Threading::*;
use windows::Win32::System::Variant::VT_BLOB;
use windows::core::{s, w};

use crate::{avisar, erro};

pub const TAXA: u32 = 48_000;
pub const CANAIS: u16 = 2;
pub const BYTES_QUADRO: u32 = 4; // 2 canais x 16 bits
/// 100 ms de buffer (o antigo usava 20 ms: qualquer atraso na leitura perdia som e virava estalo).
pub const BUFFER_PADRAO: i64 = 1_000_000;
const WINDOWS_2004: u32 = 19041;

/// Uma captura aberta. Fecha sozinha (Stop + CloseHandle) quando sai de escopo.
pub struct Captura {
    cliente: IAudioClient,
    leitor: IAudioCaptureClient,
    pub evento: HANDLE,
}

impl Drop for Captura {
    fn drop(&mut self) {
        unsafe {
            let _ = self.cliente.Stop();
            let _ = CloseHandle(self.evento);
        }
    }
}

// ---------- ativação assíncrona (o Windows chama ActivateCompleted numa thread dele) ----------
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Conclusao {
    evento: HANDLE,
    resultado: Mutex<Option<(HRESULT, Option<IUnknown>)>>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Conclusao_Impl {
    fn ActivateCompleted(&self, operacao: Ref<'_, IActivateAudioInterfaceAsyncOperation>) -> WinResult<()> {
        let mut hr = HRESULT(0);
        let mut obj: Option<IUnknown> = None;
        let r = match operacao.as_ref() {
            Some(op) => unsafe { op.GetActivateResult(&mut hr, &mut obj) },
            None => Err(windows::core::Error::from_hresult(HRESULT(0x80004003u32 as i32))),
        };
        if let Err(e) = r {
            hr = e.code();
        }
        *self.resultado.lock().unwrap() = Some((hr, obj));
        unsafe {
            let _ = SetEvent(self.evento);
        }
        Ok(())
    }
}

/// Número do build do Windows (RtlGetVersion não mente sobre a versão, ao contrário do GetVersionEx).
pub fn build_do_windows() -> u32 {
    #[repr(C)]
    struct Info {
        tamanho: u32,
        maior: u32,
        menor: u32,
        build: u32,
        plataforma: u32,
        csd: [u16; 128],
    }
    unsafe {
        let ntdll = match windows::Win32::System::LibraryLoader::GetModuleHandleW(w!("ntdll.dll")) {
            Ok(h) => h,
            Err(_) => return 0,
        };
        let Some(f) = GetProcAddress(ntdll, s!("RtlGetVersion")) else { return 0 };
        let f: extern "system" fn(*mut Info) -> i32 = std::mem::transmute(f);
        let mut i: Info = std::mem::zeroed();
        i.tamanho = std::mem::size_of::<Info>() as u32;
        if f(&mut i) == 0 { i.build } else { 0 }
    }
}

/// Prioridade de áudio para esta thread (como o antigo: processo acima do normal + MMCSS "Pro Audio").
pub fn preparar_thread() {
    unsafe {
        let _ = SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);
        if let Ok(avrt) = LoadLibraryW(w!("avrt.dll")) {
            if let Some(f) = GetProcAddress(avrt, s!("AvSetMmThreadCharacteristicsW")) {
                let f: extern "system" fn(PCWSTR, *mut u32) -> HANDLE = std::mem::transmute(f);
                let mut tarefa = 0u32;
                let _ = f(w!("Pro Audio"), &mut tarefa);
            }
        }
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    if build_do_windows() != 0 && build_do_windows() < WINDOWS_2004 {
        erro("Windows antigo: precisa do Windows 10 versao 2004 ou mais novo", 0);
    }
}

/// Abre a captura do programa `pid` (incluir: só ele e os filhos; excluir: todo o PC menos ele e os filhos).
/// Erro: (etapa, código) — as etapas têm os mesmos nomes do antigo (ativacao, Initialize, ...).
pub fn abrir(pid: u32, modo: PROCESS_LOOPBACK_MODE, buffer_100ns: i64) -> std::result::Result<Captura, (&'static str, i32)> {
    unsafe {
        let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS { TargetProcessId: pid, ProcessLoopbackMode: modo },
            },
        };
        let prop = PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_BLOB,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        blob: BLOB {
                            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                            pBlobData: &mut params as *mut _ as *mut u8,
                        },
                    },
                }),
            },
        };
        let evento = CreateEventW(None, false, false, None).map_err(|e| ("ativacao", e.code().0))?;
        let objeto = windows_core::ComObject::new(Conclusao { evento, resultado: Mutex::new(None) });
        let conclusao: IActivateAudioInterfaceCompletionHandler = objeto.to_interface();
        let r = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&prop), &conclusao);
        // o PROPVARIANT aponta para `params` (na pilha): não deixar o Drop dele tentar liberar nada
        std::mem::forget(prop);
        let _op = match r {
            Ok(op) => op,
            Err(e) => {
                let _ = CloseHandle(evento);
                return Err(("ativacao", e.code().0));
            }
        };
        let espera = WaitForSingleObject(evento, 10_000);
        let _ = CloseHandle(evento);
        if espera != WAIT_OBJECT_0 {
            return Err(("ativacao", 0x8000_000Au32 as i32)); // E_PENDING: o Windows não respondeu em 10 s
        }
        let (hr, obj) = objeto.resultado.lock().unwrap().take().unwrap_or((HRESULT(0x80004005u32 as i32), None));
        if hr.is_err() {
            return Err(("ativacao", hr.0));
        }
        let cliente: IAudioClient = obj.and_then(|o| o.cast().ok()).ok_or(("ativacao", 0x80004002u32 as i32))?;

        let formato = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: CANAIS,
            nSamplesPerSec: TAXA,
            nAvgBytesPerSec: TAXA * BYTES_QUADRO,
            nBlockAlign: BYTES_QUADRO as u16,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        cliente
            .Initialize(AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                        buffer_100ns, 0, &formato, None)
            .map_err(|e| ("Initialize", e.code().0))?;
        let evento = CreateEventW(None, false, false, None).map_err(|e| ("SetEventHandle", e.code().0))?;
        if let Err(e) = cliente.SetEventHandle(evento) {
            let _ = CloseHandle(evento);
            return Err(("SetEventHandle", e.code().0));
        }
        let leitor: IAudioCaptureClient = match cliente.GetService() {
            Ok(l) => l,
            Err(e) => {
                let _ = CloseHandle(evento);
                return Err(("GetService", e.code().0));
            }
        };
        let cap = Captura { cliente, leitor, evento };
        cap.cliente.Start().map_err(|e| ("Start", e.code().0))?;
        Ok(cap)
    }
}

impl Captura {
    /// Lê tudo o que já chegou e põe no fim de `destino` (bytes PCM). Pacote marcado como silêncio vira zeros.
    pub fn ler(&self, destino: &mut Vec<u8>) -> bool {
        unsafe {
            loop {
                let n = match self.leitor.GetNextPacketSize() {
                    Ok(n) => n,
                    Err(_) => return false,
                };
                if n == 0 {
                    return true;
                }
                let mut dados: *mut u8 = std::ptr::null_mut();
                let mut quadros = 0u32;
                let mut marcas = 0u32;
                if self.leitor.GetBuffer(&mut dados, &mut quadros, &mut marcas, None, None).is_err() {
                    return false;
                }
                let bytes = (quadros * BYTES_QUADRO) as usize;
                if marcas & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || dados.is_null() {
                    destino.resize(destino.len() + bytes, 0);
                } else {
                    destino.extend_from_slice(std::slice::from_raw_parts(dados, bytes));
                }
                let _ = self.leitor.ReleaseBuffer(quadros);
            }
        }
    }
}

/// Modos de um programa só: manda o som direto para o stdout até o app fechar a leitura.
pub fn um_programa(pid: u32, modo: PROCESS_LOOPBACK_MODE) -> ! {
    let cap = abrir(pid, modo, BUFFER_PADRAO).unwrap_or_else(|(etapa, codigo)| erro(etapa, codigo));
    let nome = if modo == PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE { "incluir" } else { "excluir" };
    avisar(&format!("OK {} {} {}", nome, pid, crate::sistema::nome_do_pid(pid)));
    let mut saida = std::io::stdout().lock();
    let mut bloco: Vec<u8> = Vec::with_capacity(64 * 1024);
    loop {
        unsafe {
            WaitForSingleObject(cap.evento, 500);
        }
        bloco.clear();
        if !cap.ler(&mut bloco) {
            erro("leitura do som", 0);
        }
        if !bloco.is_empty() && (saida.write_all(&bloco).is_err() || saida.flush().is_err()) {
            // o app fechou a leitura: terminou
            std::process::exit(0);
        }
    }
}
