import { auth } from './firebase';

export interface VoiceClientContext {
  activeTab: string;
  isMainOwner: boolean;
  actorLabel: string;
  todayIst: string;
  currentMonthKey: string;
  branches: Array<{ branchId: string; branchCode: string; branchName: string }>;
  departments: Array<{ id: string; name: string }>;
  nonSalesDepartments: string[];
  employeeCount: number;
  activeEmployeeCount: number;
  availableIncentiveMonths: string[];
  availableSalaryMonths: string[];
  lockedMonths: string[];
  folderLinked: boolean;
  folderName: string;
  folderFiles: string[];
}

export interface VoiceContentMessage {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

export interface VoiceConverseResponse {
  text: string;
  functionCalls: Array<{
    id?: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  modelContent: VoiceContentMessage | null;
  usedModel?: string;
}

async function getAdminAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Admin login session expired. Please sign in again.');
  }
  return user.getIdToken();
}

export async function callVoiceTranscribeApi(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<{ transcript: string }> {
  const token = await getAdminAuthToken();
  const resp = await fetch('/api/v1/voice/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });
  const data = (await resp.json().catch(() => ({}))) as { transcript?: string; error?: string };
  if (!resp.ok) {
    throw new Error(data.error || 'Voice transcription failed.');
  }
  return { transcript: (data.transcript || '').trim() };
}

export async function callVoiceConverseApi(params: {
  contents: VoiceContentMessage[];
  context: VoiceClientContext;
  preferredModel?: string;
}): Promise<VoiceConverseResponse> {
  const token = await getAdminAuthToken();
  const resp = await fetch('/api/v1/voice/converse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });
  const data = (await resp.json().catch(() => ({}))) as Partial<VoiceConverseResponse> & {
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Voice assistant request failed.');
  }
  return {
    text: data.text || '',
    functionCalls: Array.isArray(data.functionCalls) ? data.functionCalls : [],
    modelContent: data.modelContent || null,
    usedModel: typeof data.usedModel === 'string' ? data.usedModel : undefined,
  };
}

let activeAudioElement: HTMLAudioElement | null = null;
let activeAudioObjectUrl: string | null = null;
let sharedAudioContext: AudioContext | null = null;
let activeBufferSource: AudioBufferSourceNode | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new Ctor();
  }
  return sharedAudioContext;
}

/**
 * Must be called synchronously inside a user click/tap handler (Mic button, Send, Confirm)
 * so Chrome/Safari/iframe autoplay policies allow natural ElevenLabs/Gemini audio playback
 * after async API calls complete.
 */
export function unlockVoiceAudioPlayback(): void {
  try {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
    if (ctx) {
      const silentBuf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = silentBuf;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch {
    // ignore unlock failures
  }
  // Pre-warm browser voices list in case fallback is ever needed
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.getVoices();
    } catch {
      // ignore
    }
  }
}

export function stopMarathiSpeechPlayback(): void {
  if (activeBufferSource) {
    try {
      activeBufferSource.onended = null;
      activeBufferSource.stop();
      activeBufferSource.disconnect();
    } catch {
      // ignore
    }
    activeBufferSource = null;
  }
  if (activeAudioElement) {
    try {
      activeAudioElement.pause();
      activeAudioElement.currentTime = 0;
    } catch {
      // ignore
    }
    activeAudioElement = null;
  }
  if (activeAudioObjectUrl) {
    try {
      URL.revokeObjectURL(activeAudioObjectUrl);
    } catch {
      // ignore
    }
    activeAudioObjectUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function playAudioBufferViaWebAudio(
  bytes: Uint8Array,
  onStart?: () => void,
): Promise<boolean> {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    if (ctx.state !== 'running') {
      return false;
    }
    // Slice an owned ArrayBuffer copy because decodeAudioData detaches the buffer
    const arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await ctx.decodeAudioData(arrayBuf as ArrayBuffer);

    await new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);
      activeBufferSource = source;
      source.onended = () => {
        if (activeBufferSource === source) {
          activeBufferSource = null;
        }
        resolve();
      };
      onStart?.();
      source.start(0);
    });
    return true;
  } catch (err) {
    console.warn('[Voice Audio] WebAudio decode/play failed; trying HTMLAudio:', err);
    return false;
  }
}

function pickBestMarathiBrowserVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Prefer neural / Google / Microsoft Marathi (mr-IN) voices first, then hi-IN neural, then any mr/IN voice
  const scored = voices
    .map((v) => {
      const lang = (v.lang || '').toLowerCase();
      const name = (v.name || '').toLowerCase();
      let score = 0;
      if (lang === 'mr-in' || lang.startsWith('mr')) score += 100;
      else if (lang === 'hi-in' || lang.startsWith('hi')) score += 45;
      else if (lang.endsWith('-in')) score += 10;

      if (name.includes('natural') || name.includes('neural') || name.includes('online')) {
        score += 40;
      }
      if (name.includes('google') || name.includes('microsoft') || name.includes('aarohi') || name.includes('manohar')) {
        score += 25;
      }
      return { v, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.v || null;
}

function speakWithBrowserFallback(text: string): Promise<'browser'> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve('browser');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'mr-IN';
      utterance.rate = 0.98;
      utterance.pitch = 1.0;
      const bestVoice = pickBestMarathiBrowserVoice();
      if (bestVoice) {
        utterance.voice = bestVoice;
      }
      utterance.onend = () => resolve('browser');
      utterance.onerror = () => resolve('browser');
      window.speechSynthesis.speak(utterance);
    } catch {
      resolve('browser');
    }
  });
}

let lastCachedSpeech: {
  text: string;
  provider: 'elevenlabs' | 'gemini';
  mimeType: string;
  bytes: Uint8Array;
} | null = null;

async function fetchNaturalTtsAudio(
  cleanText: string,
): Promise<{ provider: 'elevenlabs' | 'gemini'; mimeType: string; bytes: Uint8Array } | null> {
  if (lastCachedSpeech && lastCachedSpeech.text === cleanText) {
    return {
      provider: lastCachedSpeech.provider,
      mimeType: lastCachedSpeech.mimeType,
      bytes: lastCachedSpeech.bytes,
    };
  }

  const token = await getAdminAuthToken();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 850));
    }
    const resp = await fetch('/api/v1/voice/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: cleanText.slice(0, 900) }),
    });

    if (resp.ok) {
      const data = (await resp.json()) as {
        provider?: 'elevenlabs' | 'gemini';
        mimeType?: string;
        audioBase64?: string;
      };
      if (data.audioBase64 && data.mimeType) {
        const provider = data.provider === 'elevenlabs' ? 'elevenlabs' : 'gemini';
        const bytes = base64ToUint8Array(data.audioBase64);
        lastCachedSpeech = { text: cleanText, provider, mimeType: data.mimeType, bytes };
        return { provider, mimeType: data.mimeType, bytes };
      }
    } else {
      const errJson = (await resp.json().catch(() => ({}))) as { error?: string };
      console.warn(
        `[Voice TTS Client] Attempt ${attempt + 1} HTTP ${resp.status}:`,
        errJson.error || 'TTS unavailable',
      );
    }
  }
  return null;
}

export async function speakNaturalMarathi(
  text: string,
  options?: { muted?: boolean; onStart?: (provider: 'elevenlabs' | 'gemini' | 'browser') => void },
): Promise<'elevenlabs' | 'gemini' | 'browser' | 'muted'> {
  const cleanText = text.trim();
  if (!cleanText || options?.muted) return 'muted';

  stopMarathiSpeechPlayback();

  try {
    const audioPayload = await fetchNaturalTtsAudio(cleanText);
    if (audioPayload) {
      const { provider, mimeType, bytes } = audioPayload;

      // Method 1: Unlocked Web Audio API (immune to iframe/async HTMLAudio autoplay blocks)
      const playedViaWebAudio = await playAudioBufferViaWebAudio(bytes, () =>
        options?.onStart?.(provider),
      );
      if (playedViaWebAudio) {
        return provider;
      }

      // Method 2: HTMLAudioElement fallback with Blob URL
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      activeAudioObjectUrl = url;
      const audio = new Audio(url);
      activeAudioElement = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onplay = () => options?.onStart?.(provider);
        audio.onended = () => {
          stopMarathiSpeechPlayback();
          resolve();
        };
        audio.onerror = () => {
          stopMarathiSpeechPlayback();
          reject(new Error('Audio element playback failed.'));
        };
        audio.play().catch((playErr) => {
          stopMarathiSpeechPlayback();
          reject(playErr);
        });
      });

      return provider;
    }
  } catch (err) {
    console.warn('[Voice TTS Client] Falling back to browser speech:', err);
  }

  options?.onStart?.('browser');
  return speakWithBrowserFallback(cleanText);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to encode audio recording.'));
    reader.readAsDataURL(blob);
  });
}
