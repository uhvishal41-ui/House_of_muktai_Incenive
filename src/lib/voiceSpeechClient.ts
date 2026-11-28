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

export type VoiceTtsProvider = 'sarvam' | 'elevenlabs';
export type SarvamHealthStatus =
  | 'ready'
  | 'missing_key'
  | 'auth_rejected'
  | 'quota_cooldown'
  | 'voice_error';
export type ElevenLabsHealthStatus =
  | 'ready'
  | 'missing_key'
  | 'invalid_key_format'
  | 'missing_voice_id'
  | 'auth_rejected'
  | 'voice_paid_plan_required'
  | 'free_tier_ip_blocked'
  | 'quota_cooldown';
export type ElevenLabsFallbackReason =
  | 'missing_key'
  | 'invalid_key_format'
  | 'missing_voice_id'
  | 'auth_rejected'
  | 'voice_paid_plan_required'
  | 'free_tier_ip_blocked'
  | 'quota_cooldown'
  | 'voice_error';

export const TTS_PROVIDER_STORAGE_KEY = 'hom_voice_tts_provider';

export function getSavedTtsProvider(): VoiceTtsProvider {
  if (typeof window === 'undefined') return 'sarvam';
  try {
    const raw = window.localStorage.getItem(TTS_PROVIDER_STORAGE_KEY);
    return raw === 'elevenlabs' ? 'elevenlabs' : 'sarvam';
  } catch {
    return 'sarvam';
  }
}

export function saveTtsProvider(provider: VoiceTtsProvider): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TTS_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // ignore storage restrictions
  }
}

export interface VoiceCapabilitiesStatus {
  geminiConfigured: boolean;
  defaultProvider: VoiceTtsProvider;
  availableProviders: VoiceTtsProvider[];
  sarvamConfigured: boolean;
  sarvamStatus: SarvamHealthStatus;
  sarvamModelId: string;
  sarvamSpeaker: string;
  sarvamStatusMessageMr?: string;
  elevenLabsConfigured: boolean;
  elevenLabsOnly: boolean;
  elevenLabsStatus: ElevenLabsHealthStatus;
  elevenLabsVoiceId: string;
  elevenLabsVoiceIdCustom: boolean;
  elevenLabsModelId: 'eleven_flash_v2_5' | 'eleven_v3' | 'eleven_multilingual_v2';
  statusMessageMr?: string;
  ttsPrimaryProvider: VoiceTtsProvider;
}

export interface SpeechPlaybackMeta {
  provider: VoiceTtsProvider;
  requestedProvider?: VoiceTtsProvider;
  fallbackUsed?: boolean;
  modelUsed?: string;
  voiceId?: string;
  cacheHit?: boolean;
  streamed?: boolean;
}

export interface TtsUnavailableDetails {
  requestedProvider: VoiceTtsProvider;
  sarvamStatus?: SarvamHealthStatus;
  elevenLabsStatus?: ElevenLabsFallbackReason;
  errorMessage: string;
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
let activeStreamAbortController: AbortController | null = null;
let playbackGeneration = 0;

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
  playbackGeneration += 1;

  if (activeStreamAbortController) {
    try {
      activeStreamAbortController.abort();
    } catch {
      // ignore
    }
    activeStreamAbortController = null;
  }

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
      activeAudioElement.onended = null;
      activeAudioElement.onerror = null;
      activeAudioElement.onplay = null;
      activeAudioElement.pause();
      activeAudioElement.removeAttribute('src');
      activeAudioElement.load();
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

function normalizeClientCacheKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 900);
}

export function buildClientTtsCacheKey(provider: VoiceTtsProvider, text: string): string {
  return `${provider}::${normalizeClientCacheKey(text)}`;
}

interface CachedTtsAudio {
  provider: VoiceTtsProvider;
  mimeType: string;
  bytes: Uint8Array;
  modelUsed?: string;
  voiceId?: string;
}

const MAX_CLIENT_TTS_CACHE_ITEMS = 64;
const clientTtsAudioCache = new Map<string, CachedTtsAudio>();

function readClientTtsCache(key: string): CachedTtsAudio | null {
  const hit = clientTtsAudioCache.get(key);
  if (!hit) return null;
  // Refresh LRU recency so repeated Marathi phrases never re-spend credits on either engine
  clientTtsAudioCache.delete(key);
  clientTtsAudioCache.set(key, hit);
  return hit;
}

function storeClientTtsCache(key: string, entry: CachedTtsAudio): void {
  if (!entry.bytes || entry.bytes.byteLength === 0) return;
  if (entry.bytes.byteLength > 600 * 1024) return;
  if (clientTtsAudioCache.has(key)) {
    clientTtsAudioCache.delete(key);
  } else if (clientTtsAudioCache.size >= MAX_CLIENT_TTS_CACHE_ITEMS) {
    const oldestKey = clientTtsAudioCache.keys().next().value;
    if (oldestKey) clientTtsAudioCache.delete(oldestKey);
  }
  clientTtsAudioCache.set(key, entry);
}

export function clearClientTtsAudioCache(): void {
  clientTtsAudioCache.clear();
}

function concatUint8Arrays(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function playAudioBufferViaWebAudio(
  bytes: Uint8Array,
  gen: number,
  onStart?: () => void,
): Promise<boolean> {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => setTimeout(resolve, 600)),
      ]);
    }
    if (ctx.state !== 'running' || gen !== playbackGeneration) {
      return false;
    }
    const arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await ctx.decodeAudioData(arrayBuf as ArrayBuffer);
    if (gen !== playbackGeneration) return true;

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

async function playAudioBytes(
  bytes: Uint8Array,
  mimeType: string,
  gen: number,
  onStart?: () => void,
): Promise<boolean> {
  if (gen !== playbackGeneration) return true;

  // Method 1: Unlocked Web Audio API (immune to iframe/async HTMLAudio autoplay blocks)
  const playedViaWebAudio = await playAudioBufferViaWebAudio(bytes, gen, onStart);
  if (playedViaWebAudio) {
    return true;
  }
  if (gen !== playbackGeneration) return true;

  // Method 2: HTMLAudioElement with Blob URL (pure ElevenLabs MP3 audio)
  const ownedBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ownedBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  activeAudioObjectUrl = url;
  const audio = new Audio(url);
  activeAudioElement = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onplay = () => onStart?.();
    audio.onended = () => {
      if (gen === playbackGeneration) stopMarathiSpeechPlayback();
      resolve();
    };
    audio.onerror = () => {
      if (gen === playbackGeneration) stopMarathiSpeechPlayback();
      reject(new Error('Audio element playback failed.'));
    };
    audio.play().catch((playErr) => {
      if (gen === playbackGeneration) stopMarathiSpeechPlayback();
      reject(playErr);
    });
  });

  return true;
}

function supportsStreamingMpegMse(): boolean {
  if (typeof window === 'undefined' || typeof MediaSource === 'undefined') return false;
  try {
    return typeof MediaSource.isTypeSupported === 'function' && MediaSource.isTypeSupported('audio/mpeg');
  } catch {
    return false;
  }
}

/**
 * Progressive streaming playback using MediaSource (`audio/mpeg`):
 * Starts playing as soon as the very first MP3 chunk arrives from ElevenLabs `/stream`,
 * while buffering chunks in parallel so the completed clip is stored in client LRU cache.
 * If iframe autoplay blocks `HTMLAudioElement.play()`, seamlessly drains the stream and plays
 * through the gesture-unlocked Web Audio API context with zero silent failures.
 */
async function playStreamedMpegResponse(params: {
  response: Response;
  cacheKey: string;
  mimeType: string;
  meta: SpeechPlaybackMeta;
  gen: number;
  onStart?: () => void;
}): Promise<boolean> {
  const { response, cacheKey, mimeType, meta, gen, onStart } = params;
  const body = response.body;
  if (!body) return false;

  const reader = body.getReader();
  const collectedChunks: Uint8Array[] = [];
  let totalBytes = 0;

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const audio = new Audio(objectUrl);
  activeAudioObjectUrl = objectUrl;
  activeAudioElement = audio;

  let started = false;
  let mseAbortedForFallback = false;

  const triggerStartOnce = () => {
    if (!started && gen === playbackGeneration) {
      started = true;
      onStart?.();
    }
  };

  const waitForSourceOpen = new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      mediaSource.removeEventListener('sourceopen', onOpen);
      resolve();
    };
    mediaSource.addEventListener('sourceopen', onOpen, { once: true });
    setTimeout(() => reject(new Error('MediaSource open timeout')), 1500);
  });

  const audioEndedPromise = new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
  });

  try {
    await waitForSourceOpen;
    if (gen !== playbackGeneration) {
      await reader.cancel().catch(() => {});
      return true;
    }

    const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');

    const appendChunk = (chunk: Uint8Array): Promise<void> =>
      new Promise((resolve, reject) => {
        const doAppend = () => {
          if (gen !== playbackGeneration || mediaSource.readyState !== 'open') {
            resolve();
            return;
          }
          const onDone = () => {
            sourceBuffer.removeEventListener('updateend', onDone);
            sourceBuffer.removeEventListener('error', onErr);
            resolve();
          };
          const onErr = () => {
            sourceBuffer.removeEventListener('updateend', onDone);
            sourceBuffer.removeEventListener('error', onErr);
            reject(new Error('SourceBuffer append error'));
          };
          sourceBuffer.addEventListener('updateend', onDone, { once: true });
          sourceBuffer.addEventListener('error', onErr, { once: true });
          try {
            const copy = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
            sourceBuffer.appendBuffer(copy as ArrayBuffer);
          } catch (err) {
            sourceBuffer.removeEventListener('updateend', onDone);
            sourceBuffer.removeEventListener('error', onErr);
            reject(err);
          }
        };

        if (sourceBuffer.updating) {
          sourceBuffer.addEventListener('updateend', doAppend, { once: true });
        } else {
          doAppend();
        }
      });

    let playInitiated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (gen !== playbackGeneration) {
        await reader.cancel().catch(() => {});
        return true;
      }
      if (!value || value.byteLength === 0) continue;

      collectedChunks.push(value);
      totalBytes += value.byteLength;

      if (!mseAbortedForFallback) {
        try {
          await appendChunk(value);
          if (!playInitiated) {
            playInitiated = true;
            try {
              await audio.play();
              triggerStartOnce();
            } catch {
              // Autoplay blocked on HTMLAudioElement in iframe -> switch seamlessly to unlocked WebAudio after stream drains
              mseAbortedForFallback = true;
              try {
                audio.pause();
              } catch {
                // ignore
              }
            }
          }
        } catch {
          mseAbortedForFallback = true;
        }
      }
    }

    if (totalBytes > 0) {
      const fullBytes = concatUint8Arrays(collectedChunks, totalBytes);
      storeClientTtsCache(cacheKey, {
        provider: meta.provider,
        mimeType,
        bytes: fullBytes,
        modelUsed: meta.modelUsed,
        voiceId: meta.voiceId,
      });

      if (mseAbortedForFallback) {
        if (gen !== playbackGeneration) return true;
        try {
          audio.pause();
          audio.removeAttribute('src');
        } catch {
          // ignore
        }
        return playAudioBytes(fullBytes, mimeType, gen, triggerStartOnce);
      }
    }

    if (!mseAbortedForFallback && mediaSource.readyState === 'open') {
      if (sourceBuffer.updating) {
        await new Promise<void>((resolve) =>
          sourceBuffer.addEventListener('updateend', () => resolve(), { once: true }),
        );
      }
      try {
        if (mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      } catch {
        // ignore
      }
    }

    if (!playInitiated && totalBytes > 0 && !mseAbortedForFallback) {
      try {
        await audio.play();
        triggerStartOnce();
      } catch {
        const fullBytes = concatUint8Arrays(collectedChunks, totalBytes);
        return playAudioBytes(fullBytes, mimeType, gen, triggerStartOnce);
      }
    }

    if (!mseAbortedForFallback && gen === playbackGeneration) {
      await audioEndedPromise;
    }

    return totalBytes > 0;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    if (gen === playbackGeneration) {
      if (activeAudioElement === audio) activeAudioElement = null;
      if (activeAudioObjectUrl === objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
        activeAudioObjectUrl = null;
      }
    }
  }
}

/**
 * Dual-Engine Marathi TTS Playback (Sarvam AI "मृणाल" + ElevenLabs) with Smart Auto-Fallback.
 * - Audio is cached strictly by `provider + text` so repeated Marathi replies never re-spend credits.
 * - NEVER falls back to robotic browser TTS.
 * - If both engines fail, invokes `onUnavailable` so the UI shows a clean Marathi error banner.
 */
export async function speakNaturalMarathi(
  text: string,
  options?: {
    provider?: VoiceTtsProvider;
    muted?: boolean;
    forceRefresh?: boolean;
    onStart?: (provider: VoiceTtsProvider, meta?: SpeechPlaybackMeta) => void;
    onUnavailable?: (details: TtsUnavailableDetails) => void;
  },
): Promise<VoiceTtsProvider | 'muted' | 'unavailable'> {
  const cleanText = normalizeClientCacheKey(text);
  if (!cleanText || options?.muted) return 'muted';

  const requestedProvider: VoiceTtsProvider = options?.provider || getSavedTtsProvider();
  const requestedCacheKey = buildClientTtsCacheKey(requestedProvider, cleanText);

  stopMarathiSpeechPlayback();
  const gen = playbackGeneration;

  try {
    // 1. Instant client in-memory LRU cache hit keyed by `provider + text` (zero API credits spent)
    if (!options?.forceRefresh) {
      const cached = readClientTtsCache(requestedCacheKey);
      if (cached) {
        const meta: SpeechPlaybackMeta = {
          provider: cached.provider,
          requestedProvider,
          fallbackUsed: cached.provider !== requestedProvider,
          modelUsed: cached.modelUsed,
          voiceId: cached.voiceId,
          cacheHit: true,
          streamed: false,
        };
        await playAudioBytes(cached.bytes, cached.mimeType, gen, () =>
          options?.onStart?.(cached.provider, meta),
        );
        return cached.provider;
      }
    }

    // 2. Request audio from server proxy (supports both Sarvam AI WAV & ElevenLabs MP3 + Smart Auto-Fallback)
    const token = await getAdminAuthToken();
    if (gen !== playbackGeneration) return requestedProvider;

    const abortController = new AbortController();
    activeStreamAbortController = abortController;

    const resp = await fetch('/api/v1/voice/tts/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: cleanText,
        provider: requestedProvider,
        ...(options?.forceRefresh ? { forceRefresh: true } : {}),
      }),
      signal: abortController.signal,
    });

    if (gen !== playbackGeneration) return requestedProvider;

    if (!resp.ok) {
      const errJson = (await resp.json().catch(() => ({}))) as {
        error?: string;
        sarvamStatus?: SarvamHealthStatus;
        elevenLabsStatus?: ElevenLabsFallbackReason;
      };
      const errorMessage =
        errJson.error ||
        'Sarvam AI आणि ElevenLabs दोन्ही आवाज सध्या उपलब्ध नाहीत. कृपया API Key किंवा कोटा तपासा.';
      options?.onUnavailable?.({
        requestedProvider,
        sarvamStatus: errJson.sarvamStatus,
        elevenLabsStatus: errJson.elevenLabsStatus,
        errorMessage,
      });
      return 'unavailable';
    }

    const actualProvider: VoiceTtsProvider =
      resp.headers.get('X-Voice-Provider') === 'elevenlabs' ? 'elevenlabs' : 'sarvam';
    const fallbackUsed =
      resp.headers.get('X-Voice-Fallback') === '1' || actualProvider !== requestedProvider;
    const mimeType =
      resp.headers.get('Content-Type') ||
      (actualProvider === 'sarvam' ? 'audio/wav' : 'audio/mpeg');
    const modelUsed = resp.headers.get('X-Voice-Model') || undefined;
    const voiceId = resp.headers.get('X-Voice-Id') || undefined;
    const serverCacheHit = resp.headers.get('X-Voice-Cache') === 'HIT';
    const actualCacheKey = buildClientTtsCacheKey(actualProvider, cleanText);

    const meta: SpeechPlaybackMeta = {
      provider: actualProvider,
      requestedProvider,
      fallbackUsed,
      modelUsed,
      voiceId,
      cacheHit: serverCacheHit,
      streamed: !serverCacheHit && mimeType.toLowerCase().includes('mpeg'),
    };

    // Progressive MSE streaming applies ONLY to live audio/mpeg streams (ElevenLabs);
    // WAV audio (Sarvam AI) and cached clips play directly via WebAudio/Blob Audio.
    if (
      !serverCacheHit &&
      mimeType.toLowerCase().includes('mpeg') &&
      resp.body &&
      supportsStreamingMpegMse()
    ) {
      const played = await playStreamedMpegResponse({
        response: resp,
        cacheKey: actualCacheKey,
        mimeType,
        meta,
        gen,
        onStart: () => options?.onStart?.(actualProvider, meta),
      });
      if (played) {
        return actualProvider;
      }
      if (gen !== playbackGeneration) return actualProvider;
    }

    const arrayBuf = await resp.arrayBuffer();
    if (gen !== playbackGeneration) return actualProvider;
    if (arrayBuf.byteLength === 0) {
      options?.onUnavailable?.({
        requestedProvider,
        errorMessage: 'Sarvam AI आणि ElevenLabs दोन्ही आवाज सध्या उपलब्ध नाहीत.',
      });
      return 'unavailable';
    }

    const bytes = new Uint8Array(arrayBuf);
    storeClientTtsCache(actualCacheKey, {
      provider: actualProvider,
      mimeType,
      bytes,
      modelUsed,
      voiceId,
    });

    await playAudioBytes(bytes, mimeType, gen, () => options?.onStart?.(actualProvider, meta));
    return actualProvider;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return requestedProvider;
    }
    if (gen !== playbackGeneration) {
      return requestedProvider;
    }
    console.warn('[Voice TTS Client] Both voice engines unavailable (robotic fallback disabled):', err);
    options?.onUnavailable?.({
      requestedProvider,
      errorMessage:
        'व्हॉइस आवाज प्ले होऊ शकला नाही. Sarvam AI आणि ElevenLabs दोन्ही सध्या उपलब्ध नाहीत.',
    });
    return 'unavailable';
  } finally {
    if (gen === playbackGeneration) {
      activeStreamAbortController = null;
    }
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
