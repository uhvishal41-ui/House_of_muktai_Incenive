import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import {
  VOICE_FUNCTION_DECLARATIONS,
  buildMarathiAssistantSystemInstruction,
  type VoiceWorkspaceContext,
} from './voiceTools.ts';

const GEMINI_CONVERSE_MODEL = 'gemini-4-hydrogen';
const GEMINI_CONVERSE_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const GEMINI_TTS_FALLBACK_MODEL = 'gemini-3.8-flash-tts';
const DEFAULT_ELEVENLABS_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

let cachedClient: GoogleGenAI | null = null;
let cachedKey = '';
let cachedBetaClient: GoogleGenAI | null = null;
let cachedBetaKey = '';
let primaryConverseCooldownUntil = 0;
let elevenLabsCooldownUntil = 0;
let invalidElevenLabsKeyCached = '';
let geminiTtsCooldownUntil = 0;
const ttsAudioCache = new Map<string, SynthesizedSpeechResult>();
const MAX_TTS_CACHE_ITEMS = 40;

function isPlausibleElevenLabsApiKey(key: string): boolean {
  if (!key) return false;
  // Modern ElevenLabs keys start with "sk_"; legacy keys are 32-char lowercase hex.
  // Reject 20-char Voice IDs or API Key IDs immediately so they never trigger HTTP 400 auth errors.
  return /^sk_[a-zA-Z0-9_]{20,120}$/.test(key) || /^[a-f0-9]{32}$/i.test(key);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOrQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('500') ||
    msg.includes('not found') ||
    msg.includes('404')
  );
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in server environment variables or Settings > Secrets.',
    );
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedKey = apiKey;
  }
  return cachedClient;
}

/**
 * Gemini 3.8 TTS (`speechConfig` and `speechMetadata`) requires the `v1beta` endpoint;
 * `@google/genai` v3+ defaults to `v1`, which rejects those fields with HTTP 400.
 */
function getGeminiBetaClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please set GEMINI_API_KEY in server environment variables or Settings > Secrets.',
    );
  }
  if (!cachedBetaClient || cachedBetaKey !== apiKey) {
    cachedBetaClient = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedBetaKey = apiKey;
  }
  return cachedBetaClient;
}

export function getVoiceCapabilitiesStatus(): {
  geminiConfigured: boolean;
  elevenLabsConfigured: boolean;
  ttsPrimaryProvider: 'elevenlabs' | 'gemini' | 'browser';
} {
  const geminiConfigured = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const rawElevenKey = (process.env.ELEVENLABS_API_KEY || '').trim();
  const elevenLabsConfigured =
    isPlausibleElevenLabsApiKey(rawElevenKey) && rawElevenKey !== invalidElevenLabsKeyCached;
  return {
    geminiConfigured,
    elevenLabsConfigured,
    ttsPrimaryProvider: elevenLabsConfigured
      ? 'elevenlabs'
      : geminiConfigured
        ? 'gemini'
        : 'browser',
  };
}

export async function transcribeMarathiVoiceAudio(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<{ transcript: string }> {
  const ai = getGeminiClient();
  const cleanMime = params.mimeType.split(';')[0].trim() || 'audio/webm';

  const requestContents = {
    parts: [
      {
        inlineData: {
          mimeType: cleanMime,
          data: params.audioBase64,
        },
      },
      {
        text:
          'Transcribe this office voice command accurately. The speaker may speak Marathi, Hindi, English, or mixed Marathi-English (Minglish) containing employee numbers (like 1136), branch names (Baramati, Dharashiv, Beed, Solapur, Satara, Latur, Karad, etc.), departments (Saree, Ladies Wear, Kids Wear, Mens Wear, Non Apparels), dates/months (Oct-2026), and filenames. Return ONLY the clean spoken transcript text without commentary.',
      },
    ],
  };

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_TRANSCRIBE_MODEL,
      contents: requestContents,
    });
    return { transcript: (response.text || '').trim() };
  } catch (err) {
    if (!isRetryableOrQuotaError(err)) throw err;
    const fallback = await ai.models.generateContent({
      model: GEMINI_CONVERSE_FALLBACK_MODEL,
      contents: requestContents,
    });
    return { transcript: (fallback.text || '').trim() };
  }
}

export interface VoiceConverseResult {
  text: string;
  functionCalls: Array<{
    id?: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  modelContent: Content | null;
  usedModel: string;
}

function hasFunctionCallParts(contents: Content[]): boolean {
  return contents.some(
    (msg) =>
      Array.isArray(msg.parts) &&
      msg.parts.some(
        (p) =>
          p &&
          typeof p === 'object' &&
          ('functionCall' in (p as Record<string, unknown>) ||
            'functionResponse' in (p as Record<string, unknown>)),
      ),
  );
}

/**
 * When failing over mid-tool-loop to a DIFFERENT Gemini model (where thoughtSignature from Model A
 * cannot be validated by Model B), convert the prior tool calls & results into a clean, lossless
 * user prompt turn so Model B can seamlessly invoke the next tool or compose the final Marathi reply
 * without EVER triggering a `missing thought_signature` 400 error.
 */
function flattenToolLoopForCrossModelFallback(contents: Content[]): Content[] {
  const cleanContents: Content[] = [];
  const toolTraceLines: string[] = [];

  for (const msg of contents) {
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    const plainTextParts: string[] = [];
    for (const p of parts) {
      if (!p || typeof p !== 'object') continue;
      const obj = p as Record<string, unknown>;
      if (obj.thought === true) continue;
      if (typeof obj.text === 'string' && obj.text.trim()) {
        plainTextParts.push(obj.text.trim());
      } else if (obj.functionCall && typeof obj.functionCall === 'object') {
        const fc = obj.functionCall as { name?: string; args?: unknown };
        toolTraceLines.push(`Tool Called: ${fc.name || 'unknown'}(${JSON.stringify(fc.args ?? {})})`);
      } else if (obj.functionResponse && typeof obj.functionResponse === 'object') {
        const fr = obj.functionResponse as { name?: string; response?: unknown };
        toolTraceLines.push(
          `Tool Result (${fr.name || 'unknown'}): ${JSON.stringify(fr.response ?? {}).slice(0, 3500)}`,
        );
      }
    }

    if (plainTextParts.length > 0 && (msg.role === 'user' || msg.role === 'model')) {
      cleanContents.push({
        role: msg.role,
        parts: [{ text: plainTextParts.join('\n') }],
      });
    }
  }

  if (toolTraceLines.length > 0) {
    const continuationNote =
      `Already executed tool steps in this turn:\n${toolTraceLines.join('\n')}\n\n` +
      `Continue fulfilling the user's latest request: call any remaining required tool(s) now, or if all steps are complete, give the final natural Marathi reply.`;
    const last = cleanContents[cleanContents.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.parts) && typeof last.parts[0]?.text === 'string') {
      last.parts[0].text = `${last.parts[0].text}\n\n${continuationNote}`;
    } else {
      cleanContents.push({ role: 'user', parts: [{ text: continuationNote }] });
    }
  }

  return cleanContents.length > 0 ? cleanContents : contents;
}

export async function runMarathiVoiceTurn(params: {
  contents: Content[];
  context: VoiceWorkspaceContext;
  preferredModel?: string;
}): Promise<VoiceConverseResult> {
  const ai = getGeminiClient();
  const systemInstruction = buildMarathiAssistantSystemInstruction(params.context);

  const invokeModel = async (modelName: string, contentsToSend: Content[]) =>
    ai.models.generateContent({
      model: modelName,
      contents: contentsToSend,
      config: {
        systemInstruction,
        ...(modelName === GEMINI_CONVERSE_MODEL
          ? {
              // Per Gemini 4 spec: ThinkingLevel.LOW is the lowest-latency level supported on gemini-4-hydrogen
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
            }
          : {}),
        tools: [
          {
            functionDeclarations: VOICE_FUNCTION_DECLARATIONS,
          },
        ],
      },
    });

  const now = Date.now();
  const hasToolsInHistory = hasFunctionCallParts(params.contents);
  const pinnedModel =
    params.preferredModel === GEMINI_CONVERSE_MODEL ||
    params.preferredModel === GEMINI_CONVERSE_FALLBACK_MODEL
      ? params.preferredModel
      : undefined;

  // Choose initial model: stay pinned to the same model mid-tool-loop so thoughtSignature stays 100% valid!
  const firstModel =
    pinnedModel ||
    (now < primaryConverseCooldownUntil ? GEMINI_CONVERSE_FALLBACK_MODEL : GEMINI_CONVERSE_MODEL);
  const secondModel =
    firstModel === GEMINI_CONVERSE_MODEL ? GEMINI_CONVERSE_FALLBACK_MODEL : GEMINI_CONVERSE_MODEL;

  let response;
  let usedModel = firstModel;

  try {
    // Always pass exact unmodified params.contents (preserving thoughtSignature!) to the initial/pinned model
    response = await invokeModel(firstModel, params.contents);
    usedModel = firstModel;
  } catch (firstErr) {
    const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr || '');
    const isAuthOrKeyErr =
      errMsg.toLowerCase().includes('api_key') ||
      errMsg.toLowerCase().includes('api key') ||
      errMsg.toLowerCase().includes('permission_denied') ||
      errMsg.toLowerCase().includes('403');
    if (isAuthOrKeyErr) {
      throw firstErr;
    }

    if (firstModel === GEMINI_CONVERSE_MODEL && isRetryableOrQuotaError(firstErr)) {
      primaryConverseCooldownUntil = Date.now() + 60_000;
    }

    // If switching models mid-tool-loop, flatten prior tool call/result into clean prompt text
    // so mismatched cross-model thoughtSignatures NEVER cause an HTTP 400 error.
    const crossModelContents = hasToolsInHistory
      ? flattenToolLoopForCrossModelFallback(params.contents)
      : params.contents;

    try {
      response = await invokeModel(secondModel, crossModelContents);
      usedModel = secondModel;
    } catch (secondErr) {
      if (!isRetryableOrQuotaError(secondErr)) throw secondErr;
      await sleep(1600);
      response = await invokeModel(secondModel, crossModelContents);
      usedModel = secondModel;
    }
  }

  const modelContent = response.candidates?.[0]?.content ?? null;
  const rawCalls = response.functionCalls ?? [];
  const functionCalls = rawCalls
    .filter((fc) => typeof fc.name === 'string' && fc.name.length > 0)
    .map((fc) => ({
      ...(fc.id ? { id: fc.id } : {}),
      name: fc.name as string,
      args: (fc.args && typeof fc.args === 'object' ? fc.args : {}) as Record<string, unknown>,
    }));

  return {
    text: (response.text || '').trim(),
    functionCalls,
    modelContent,
    usedModel,
  };
}

export interface SynthesizedSpeechResult {
  provider: 'elevenlabs' | 'gemini';
  mimeType: string;
  audioBase64: string;
}

/**
 * Ensures Gemini 24kHz 16-bit mono PCM audio always has a valid 44-byte RIFF WAV header
 * so browser `<audio>` and `AudioContext.decodeAudioData` never fail and drop to robotic OS TTS.
 */
function ensurePlayableWavBuffer(rawBuffer: Buffer, mimeType?: string): Buffer {
  if (
    rawBuffer.length >= 12 &&
    rawBuffer.toString('ascii', 0, 4) === 'RIFF' &&
    rawBuffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return rawBuffer;
  }
  const rateMatch = (mimeType || '').match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = rawBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, rawBuffer]);
}

async function callElevenLabsModel(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: 'eleven_flash_v2_5' | 'eleven_multilingual_v2';
  timeoutMs: number;
}): Promise<{
  result: SynthesizedSpeechResult | null;
  invalidKey: boolean;
  quotaOrAuthFailed: boolean;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}` +
      '?output_format=mp3_44100_128&optimize_streaming_latency=3';
    // NOTE: Do NOT pass language_code='mr' to eleven_flash_v2_5 (Marathi is not in flash_v2_5's
    // language_code enum and causes HTTP 400). Both models auto-detect Devanagari script cleanly.
    const bodyPayload: Record<string, unknown> = {
      text: params.text,
      model_id: params.modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.25,
        use_speaker_boost: true,
      },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': params.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = (await resp.text().catch(() => '')).toLowerCase();
      const invalidKey =
        resp.status === 401 ||
        errBody.includes('invalid_api_key') ||
        errBody.includes('authentication_error');
      const quotaOrAuthFailed =
        invalidKey ||
        resp.status === 402 ||
        resp.status === 429 ||
        errBody.includes('quota_exceeded');
      return { result: null, invalidKey, quotaOrAuthFailed };
    }

    const arrayBuf = await resp.arrayBuffer();
    if (arrayBuf.byteLength === 0) {
      return { result: null, invalidKey: false, quotaOrAuthFailed: false };
    }

    return {
      result: {
        provider: 'elevenlabs',
        mimeType: 'audio/mpeg',
        audioBase64: Buffer.from(arrayBuf).toString('base64'),
      },
      invalidKey: false,
      quotaOrAuthFailed: false,
    };
  } catch {
    return { result: null, invalidKey: false, quotaOrAuthFailed: false };
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeViaElevenLabs(text: string): Promise<SynthesizedSpeechResult | null> {
  const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
  if (!isPlausibleElevenLabsApiKey(apiKey)) return null;
  if (apiKey === invalidElevenLabsKeyCached) return null;
  if (Date.now() < elevenLabsCooldownUntil) return null;

  const rawVoiceId = (process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID).trim();
  const safeVoiceId = /^[a-zA-Z0-9_-]{8,64}$/.test(rawVoiceId)
    ? rawVoiceId
    : DEFAULT_ELEVENLABS_VOICE_ID;

  // Priority 1A: Fast Eleven Flash v2.5 (auto-detects Devanagari cleanly without invalid language_code)
  const fastAttempt = await callElevenLabsModel({
    apiKey,
    voiceId: safeVoiceId,
    text,
    modelId: 'eleven_flash_v2_5',
    timeoutMs: 8000,
  });
  if (fastAttempt.result) return fastAttempt.result;
  if (fastAttempt.invalidKey) {
    invalidElevenLabsKeyCached = apiKey;
    return null;
  }
  if (fastAttempt.quotaOrAuthFailed) {
    elevenLabsCooldownUntil = Date.now() + 5 * 60_000;
    return null;
  }

  // Priority 1B: Eleven Multilingual v2 fallback
  const multiAttempt = await callElevenLabsModel({
    apiKey,
    voiceId: safeVoiceId,
    text,
    modelId: 'eleven_multilingual_v2',
    timeoutMs: 10000,
  });
  if (multiAttempt.invalidKey) {
    invalidElevenLabsKeyCached = apiKey;
    return null;
  }
  if (multiAttempt.quotaOrAuthFailed) {
    elevenLabsCooldownUntil = Date.now() + 5 * 60_000;
  }
  return multiAttempt.result;
}

async function callGeminiTtsModel(params: {
  ai: GoogleGenAI;
  model: string;
  text: string;
  includeStyleMetadata: boolean;
}): Promise<SynthesizedSpeechResult> {
  const ttsConfig = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: 'Kore' },
      },
    },
  };

  const parts = params.includeStyleMetadata
    ? [
        {
          text: params.text,
          speechMetadata: {
            style:
              'Warm, expressive, natural conversational Marathi (Maharashtra) office assistant speaking smoothly and humanly at normal pace',
          },
        },
      ]
    : [{ text: params.text }];

  const response = await params.ai.models.generateContent({
    model: params.model,
    contents: [{ role: 'user', parts }],
    config: ttsConfig,
  });

  const inlinePart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const rawBase64 = inlinePart?.inlineData?.data;
  const rawMime = inlinePart?.inlineData?.mimeType || 'audio/wav';
  if (!rawBase64) {
    throw new Error(`Gemini TTS (${params.model}) returned no audio data.`);
  }

  const rawBuf = Buffer.from(rawBase64, 'base64');
  const playableWav = ensurePlayableWavBuffer(rawBuf, rawMime);

  return {
    provider: 'gemini',
    mimeType: 'audio/wav',
    audioBase64: playableWav.toString('base64'),
  };
}

/**
 * Splits Marathi text into <= 185-character sentence chunks without breaking formatted numbers
 * (like ₹१६,४५० or 16,450) so each chunk can be synthesized into a seamless CBR MP3 stream.
 */
function splitMarathiTextIntoTtsChunks(text: string, maxLen = 185): string[] {
  const sentences = text
    .split(/(?<=[।.?!\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const pushWords = (segment: string) => {
    const words = segment.split(/\s+/).filter(Boolean);
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = word.slice(0, maxLen);
      }
    }
  };

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current);
        current = '';
      }
      if (sentence.length <= maxLen) {
        current = sentence;
      } else {
        pushWords(sentence);
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

/**
 * Free, zero-quota Server-Side Google Neural Marathi (`mr-IN`) MP3 synthesizer used automatically
 * whenever ElevenLabs is unconfigured/invalid and Gemini TTS free-tier quota is temporarily exhausted (HTTP 429).
 * Ensures the user ALWAYS hears a natural human Marathi voice instead of robotic OS SpeechSynthesis.
 */
async function synthesizeViaGoogleNeuralMarathiTts(
  text: string,
): Promise<SynthesizedSpeechResult | null> {
  try {
    const chunks = splitMarathiTextIntoTtsChunks(text, 185);
    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=mr&client=tw-ob`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      if (!resp.ok) return null;
      const arr = await resp.arrayBuffer();
      if (arr.byteLength === 0) return null;
      buffers.push(Buffer.from(arr));
    }
    if (buffers.length === 0) return null;
    const combinedMp3 = Buffer.concat(buffers);
    return {
      provider: 'gemini',
      mimeType: 'audio/mpeg',
      audioBase64: combinedMp3.toString('base64'),
    };
  } catch {
    return null;
  }
}

function storeTtsCache(key: string, value: SynthesizedSpeechResult): void {
  if (ttsAudioCache.size >= MAX_TTS_CACHE_ITEMS) {
    const oldestKey = ttsAudioCache.keys().next().value;
    if (oldestKey) ttsAudioCache.delete(oldestKey);
  }
  ttsAudioCache.set(key, value);
}

export async function synthesizeMarathiSpeech(text: string): Promise<SynthesizedSpeechResult> {
  const cleanText = text.trim().slice(0, 900);
  if (!cleanText) {
    throw new Error('Empty speech text.');
  }

  const cached = ttsAudioCache.get(cleanText);
  if (cached) {
    return cached;
  }

  // Priority 1: ElevenLabs (eleven_flash_v2_5 -> eleven_multilingual_v2) when a valid ELEVENLABS_API_KEY is set
  const eleven = await synthesizeViaElevenLabs(cleanText);
  if (eleven) {
    storeTtsCache(cleanText, eleven);
    return eleven;
  }

  // Priority 2: Gemini Native TTS via v1beta endpoint (skipped during 2-min 429 quota cooldown)
  if (Date.now() >= geminiTtsCooldownUntil) {
    try {
      const ai = getGeminiBetaClient();
      const attempts: Array<{ model: string; includeStyleMetadata: boolean; delayBeforeMs?: number }> = [
        { model: GEMINI_TTS_MODEL, includeStyleMetadata: true },
        { model: GEMINI_TTS_FALLBACK_MODEL, includeStyleMetadata: true, delayBeforeMs: 300 },
      ];

      for (const attempt of attempts) {
        if (attempt.delayBeforeMs) {
          await sleep(attempt.delayBeforeMs);
        }
        try {
          const result = await callGeminiTtsModel({
            ai,
            model: attempt.model,
            text: cleanText,
            includeStyleMetadata: attempt.includeStyleMetadata,
          });
          storeTtsCache(cleanText, result);
          return result;
        } catch (err) {
          if (isRetryableOrQuotaError(err)) {
            geminiTtsCooldownUntil = Date.now() + 2 * 60_000;
          }
        }
      }
    } catch {
      // Fall through to Priority 3 Server-Side Neural Marathi MP3
    }
  }

  // Priority 3: Free Server-Side Google Neural Marathi (mr-IN) MP3 stream (never hits 429 quota or robotic OS voice)
  const neuralMarathi = await synthesizeViaGoogleNeuralMarathiTts(cleanText);
  if (neuralMarathi) {
    storeTtsCache(cleanText, neuralMarathi);
    return neuralMarathi;
  }

  throw new Error('Speech synthesis temporarily unavailable.');
}
