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

export interface VoiceCapabilitiesStatus {
  geminiConfigured: boolean;
  elevenLabsConfigured: boolean;
  elevenLabsOnly: true;
  elevenLabsStatus: ElevenLabsHealthStatus;
  elevenLabsVoiceId: string;
  elevenLabsVoiceIdCustom: boolean;
  elevenLabsModelId: 'eleven_flash_v2_5' | 'eleven_v3' | 'eleven_multilingual_v2';
  statusMessageMr?: string;
  ttsPrimaryProvider: VoiceTtsProvider;
}

export interface SpeechPlaybackMeta {
  provider: VoiceTtsProvider;
  modelUsed?: string;
  voiceId?: string;
  cacheHit?: boolean;
  streamed?: boolean;
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

interface CachedElevenLabsAudio {
  provider: 'elevenlabs';
  mimeType: string;
  bytes: Uint8Array;
  modelUsed?: string;
  voiceId?: string;
}

const MAX_CLIENT_TTS_CACHE_ITEMS = 48;
const clientTtsAudioCache = new Map<string, CachedElevenLabsAudio>();

function readClientTtsCache(key: string): CachedElevenLabsAudio | null {
  const hit = clientTtsAudioCache.get(key);
  if (!hit) return null;
  // Refresh LRU recency so hot phrases ("आवाज तपासा", confirmations) stay instant
  clientTtsAudioCache.delete(key);
  clientTtsAudioCache.set(key, hit);
  return hit;
}

function storeClientTtsCache(key: string, entry: CachedElevenLabsAudio): void {
  if (!entry.bytes || entry.bytes.byteLength === 0) return;
  if (entry.bytes.byteLength > 350 * 1024) return;
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
        provider: 'elevenlabs',
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
 * Strictly plays ONLY the owner's selected ElevenLabs voice (from Render ELEVENLABS_VOICE_ID).
 * Zero alternate voices and zero robotic OS / browser TTS fallback are ever used.
 *
 * Ultra-low-latency path:
 * 1. Client in-memory LRU cache -> <10ms instant playback (0 network calls).
 * 2. Streaming binary `/api/v1/voice/tts/stream` (ElevenLabs `/stream` + `eleven_flash_v2_5` +
 *    `optimize_streaming_latency=3` + `mp3_22050_32`) -> plays on first audio chunk via MediaSource,
 *    with instant WebAudio fallback for server cache HITs or iframe autoplay policies.
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
  const cleanText = normalizeClientCacheKey(text);
  if (!cleanText || options?.muted) return 'muted';

  stopMarathiSpeechPlayback();
  const gen = playbackGeneration;

  try {
    // 1. Instant client in-memory LRU cache hit (zero API delay)
    if (!options?.forceRefresh) {
      const cached = readClientTtsCache(cleanText);
      if (cached) {
        const meta: SpeechPlaybackMeta = {
          provider: 'elevenlabs',
          modelUsed: cached.modelUsed,
          voiceId: cached.voiceId,
          cacheHit: true,
          streamed: false,
        };
        await playAudioBytes(cached.bytes, cached.mimeType, gen, () =>
          options?.onStart?.('elevenlabs', meta),
        );
        return 'elevenlabs';
      }
    }

    // 2. Direct binary streaming request to server proxy (ElevenLabs `/stream`)
    const token = await getAdminAuthToken();
    if (gen !== playbackGeneration) return 'elevenlabs';

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
        ...(options?.forceRefresh ? { forceRefresh: true } : {}),
      }),
      signal: abortController.signal,
    });

    if (gen !== playbackGeneration) return 'elevenlabs';

    if (!resp.ok) {
      const errJson = (await resp.json().catch(() => ({}))) as {
        error?: string;
        elevenLabsStatus?: ElevenLabsFallbackReason;
      };
      const reason: ElevenLabsFallbackReason = errJson.elevenLabsStatus || 'voice_error';
      const errorMessage =
        errJson.error || 'तुमचा निवडलेला ElevenLabs आवाज सध्या उपलब्ध नाही.';
      options?.onUnavailable?.(reason, errorMessage);
      return 'unavailable';
    }

    const mimeType = resp.headers.get('Content-Type') || 'audio/mpeg';
    const modelUsed = resp.headers.get('X-Voice-Model') || undefined;
    const voiceId = resp.headers.get('X-Voice-Id') || undefined;
    const serverCacheHit = resp.headers.get('X-Voice-Cache') === 'HIT';

    const meta: SpeechPlaybackMeta = {
      provider: 'elevenlabs',
      modelUsed,
      voiceId,
      cacheHit: serverCacheHit,
      streamed: !serverCacheHit,
    };

    // For live upstream ElevenLabs streams, start progressive chunk-by-chunk playback immediately via MSE
    if (!serverCacheHit && resp.body && supportsStreamingMpegMse()) {
      const played = await playStreamedMpegResponse({
        response: resp,
        cacheKey: cleanText,
        mimeType,
        meta,
        gen,
        onStart: () => options?.onStart?.('elevenlabs', meta),
      });
      if (played) {
        return 'elevenlabs';
      }
      if (gen !== playbackGeneration) return 'elevenlabs';
    }

    // For server cache HITs or browsers without audio/mpeg MSE: read raw binary MP3 directly (no base64 overhead!)
    const arrayBuf = await resp.arrayBuffer();
    if (gen !== playbackGeneration) return 'elevenlabs';
    if (arrayBuf.byteLength === 0) {
      options?.onUnavailable?.(
        'voice_error',
        'तुमचा निवडलेला ElevenLabs आवाज सध्या उपलब्ध नाही.',
      );
      return 'unavailable';
    }

    const bytes = new Uint8Array(arrayBuf);
    storeClientTtsCache(cleanText, {
      provider: 'elevenlabs',
      mimeType,
      bytes,
      modelUsed,
      voiceId,
    });

    await playAudioBytes(bytes, mimeType, gen, () => options?.onStart?.('elevenlabs', meta));
    return 'elevenlabs';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'elevenlabs';
    }
    if (gen !== playbackGeneration) {
      return 'elevenlabs';
    }
    console.warn('[Voice TTS Client] ElevenLabs playback unavailable (robotic fallback disabled):', err);
    options?.onUnavailable?.('voice_error', 'ElevenLabs आवाज प्ले होऊ शकला नाही.');
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
