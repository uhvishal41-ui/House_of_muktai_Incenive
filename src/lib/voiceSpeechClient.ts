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

export type VoiceTtsProvider = 'elevenlabs';
export type ElevenLabsHealthStatus =
  | 'ready'
  | 'premade_fallback_active'
  | 'missing_key'
  | 'invalid_key_format'
  | 'auth_rejected'
  | 'free_tier_ip_blocked'
  | 'quota_cooldown';
export type ElevenLabsFallbackReason =
  | 'missing_key'
  | 'invalid_key_format'
  | 'auth_rejected'
  | 'free_tier_ip_blocked'
  | 'quota_cooldown'
  | 'voice_error';

export interface VoiceCapabilitiesStatus {
  geminiConfigured: boolean;
  elevenLabsConfigured: boolean;
  elevenLabsOnly: true;
  elevenLabsStatus: ElevenLabsHealthStatus;
  elevenLabsVoiceId: string;
  elevenLabsVoiceIdCustom: boolean;
  elevenLabsModelId: 'eleven_v3' | 'eleven_flash_v2_5' | 'eleven_multilingual_v2';
  activeVoiceLabel?: string;
  ttsPrimaryProvider: VoiceTtsProvider;
}

export interface SpeechPlaybackMeta {
  provider: VoiceTtsProvider;
  modelUsed?: string;
  voiceId?: string;
  voiceLabel?: string;
  usedPremadeFallback?: boolean;
  fallbackReason?: ElevenLabsFallbackReason;
}

async function getAdminAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Admin login session expired. Please sign in again.');
  }
  return user.getIdToken();
}

export async function fetchVoiceCapabilitiesStatus(): Promise<VoiceCapabilitiesStatus | null> {
  try {
    const token = await getAdminAuthToken();
    const resp = await fetch('/api/v1/voice/status', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as VoiceCapabilitiesStatus;
  } catch {
    return null;
  }
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
 * so Chrome/Safari/iframe autoplay policies allow ElevenLabs audio playback
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

interface CachedElevenLabsAudio {
  text: string;
  provider: 'elevenlabs';
  mimeType: string;
  bytes: Uint8Array;
  modelUsed?: string;
  voiceId?: string;
  voiceLabel?: string;
  usedPremadeFallback?: boolean;
}

type FetchElevenLabsTtsResult =
  | {
      ok: true;
      audio: Omit<CachedElevenLabsAudio, 'text'>;
    }
  | {
      ok: false;
      fallbackReason?: ElevenLabsFallbackReason;
      errorMessage?: string;
    };

let lastCachedSpeech: CachedElevenLabsAudio | null = null;

async function fetchElevenLabsTtsAudio(
  cleanText: string,
  options?: { forceRefresh?: boolean },
): Promise<FetchElevenLabsTtsResult> {
  if (!options?.forceRefresh && lastCachedSpeech && lastCachedSpeech.text === cleanText) {
    return {
      ok: true,
      audio: {
        provider: 'elevenlabs',
        mimeType: lastCachedSpeech.mimeType,
        bytes: lastCachedSpeech.bytes,
        modelUsed: lastCachedSpeech.modelUsed,
        voiceId: lastCachedSpeech.voiceId,
        voiceLabel: lastCachedSpeech.voiceLabel,
        usedPremadeFallback: lastCachedSpeech.usedPremadeFallback,
      },
    };
  }

  const token = await getAdminAuthToken();
  let lastReason: ElevenLabsFallbackReason = 'voice_error';
  let lastErrorMessage = 'ElevenLabs आवाज सध्या उपलब्ध नाही.';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 700));
    }
    const resp = await fetch('/api/v1/voice/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: cleanText.slice(0, 900),
        ...(options?.forceRefresh ? { forceRefresh: true } : {}),
      }),
    });

    if (resp.ok) {
      const data = (await resp.json()) as {
        provider?: 'elevenlabs';
        mimeType?: string;
        audioBase64?: string;
        modelUsed?: string;
        voiceId?: string;
        voiceLabel?: string;
        usedPremadeFallback?: boolean;
      };
      if (data.audioBase64 && data.mimeType) {
        const bytes = base64ToUint8Array(data.audioBase64);
        lastCachedSpeech = {
          text: cleanText,
          provider: 'elevenlabs',
          mimeType: data.mimeType,
          bytes,
          modelUsed: data.modelUsed,
          voiceId: data.voiceId,
          voiceLabel: data.voiceLabel,
          usedPremadeFallback: data.usedPremadeFallback,
        };
        return {
          ok: true,
          audio: {
            provider: 'elevenlabs',
            mimeType: data.mimeType,
            bytes,
            modelUsed: data.modelUsed,
            voiceId: data.voiceId,
            voiceLabel: data.voiceLabel,
            usedPremadeFallback: data.usedPremadeFallback,
          },
        };
      }
    } else {
      const errJson = (await resp.json().catch(() => ({}))) as {
        error?: string;
        elevenLabsStatus?: ElevenLabsFallbackReason;
      };
      if (errJson.elevenLabsStatus) {
        lastReason = errJson.elevenLabsStatus;
      }
      if (errJson.error) {
        lastErrorMessage = errJson.error;
      }
      console.warn(
        `[Voice TTS Client] ElevenLabs attempt ${attempt + 1} HTTP ${resp.status}:`,
        lastErrorMessage,
      );
      // Do not retry non-transient configuration/quota/auth rejections
      if (
        lastReason === 'missing_key' ||
        lastReason === 'invalid_key_format' ||
        lastReason === 'auth_rejected' ||
        lastReason === 'free_tier_ip_blocked' ||
        lastReason === 'quota_cooldown'
      ) {
        break;
      }
    }
  }
  return {
    ok: false,
    fallbackReason: lastReason,
    errorMessage: lastErrorMessage,
  };
}

/**
 * Strictly plays ONLY ElevenLabs audio (female Marathi voice).
 * Zero robotic OS / browser TTS fallback is ever used.
 */
export async function speakNaturalMarathi(
  text: string,
  options?: {
    muted?: boolean;
    forceRefresh?: boolean;
    onStart?: (provider: VoiceTtsProvider, meta?: SpeechPlaybackMeta) => void;
    onUnavailable?: (reason: ElevenLabsFallbackReason, errorMessage: string) => void;
  },
): Promise<VoiceTtsProvider | 'muted' | 'unavailable'> {
  const cleanText = text.trim();
  if (!cleanText || options?.muted) return 'muted';

  stopMarathiSpeechPlayback();

  try {
    const fetchResult = await fetchElevenLabsTtsAudio(cleanText, {
      forceRefresh: options?.forceRefresh,
    });
    if (!fetchResult.ok) {
      options?.onUnavailable?.(
        fetchResult.fallbackReason || 'voice_error',
        fetchResult.errorMessage || 'ElevenLabs आवाज सध्या उपलब्ध नाही.',
      );
      return 'unavailable';
    }

    const {
      provider,
      mimeType,
      bytes,
      modelUsed,
      voiceId,
      voiceLabel,
      usedPremadeFallback,
    } = fetchResult.audio;
    const meta: SpeechPlaybackMeta = {
      provider,
      modelUsed,
      voiceId,
      voiceLabel,
      usedPremadeFallback,
    };

    // Method 1: Unlocked Web Audio API (immune to iframe/async HTMLAudio autoplay blocks)
    const playedViaWebAudio = await playAudioBufferViaWebAudio(bytes, () =>
      options?.onStart?.(provider, meta),
    );
    if (playedViaWebAudio) {
      return provider;
    }

    // Method 2: HTMLAudioElement fallback with Blob URL (still pure ElevenLabs MP3 audio)
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    activeAudioObjectUrl = url;
    const audio = new Audio(url);
    activeAudioElement = audio;

    await new Promise<void>((resolve, reject) => {
      audio.onplay = () => options?.onStart?.(provider, meta);
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
  } catch (err) {
    console.warn('[Voice TTS Client] ElevenLabs playback unavailable (robotic fallback disabled):', err);
    options?.onUnavailable?.('voice_error', 'ElevenLabs आवाज प्ले होऊ शकला नाही.');
    return 'unavailable';
  }
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
