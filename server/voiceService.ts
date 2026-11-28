import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import {
  VOICE_FUNCTION_DECLARATIONS,
  buildMarathiAssistantSystemInstruction,
  type VoiceWorkspaceContext,
} from './voiceTools.ts';

const GEMINI_CONVERSE_MODEL = 'gemini-4-hydrogen';
const GEMINI_CONVERSE_FAST_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_CONVERSE_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const DEFAULT_ELEVENLABS_MODEL_ID: ElevenLabsModelId = 'eleven_flash_v2_5';
const GEMINI_FAST_TIMEOUT_MS = 9_000;
const GEMINI_HEAVY_TIMEOUT_MS = 22_000;
const GEMINI_TRANSCRIBE_TIMEOUT_MS = 12_000;
const SARVAM_TTS_TIMEOUT_MS = 5_000;

export type ElevenLabsModelId = 'eleven_flash_v2_5' | 'eleven_v3' | 'eleven_multilingual_v2';
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
export type ElevenLabsHttpErrorKind =
  | 'library_voice_paid_only'
  | 'free_tier_ip_blocked'
  | 'auth_rejected'
  | 'quota_exceeded'
  | 'voice_error';

const ALLOWED_ELEVENLABS_MODELS: readonly ElevenLabsModelId[] = [
  'eleven_flash_v2_5',
  'eleven_v3',
  'eleven_multilingual_v2',
];
export const ELEVENLABS_STREAM_OUTPUT_FORMAT = 'mp3_22050_32';
export const ELEVENLABS_OPTIMIZE_STREAMING_LATENCY = 3;

export type VoiceTtsProvider = 'sarvam' | 'elevenlabs';
export type SarvamHealthStatus =
  | 'ready'
  | 'missing_key'
  | 'auth_rejected'
  | 'quota_cooldown'
  | 'voice_error';

export const SARVAM_TTS_ENDPOINT = 'https://api.sarvam.ai/text-to-speech';
export const DEFAULT_SARVAM_MODEL_ID = 'bulbul:v3';
export const DEFAULT_SARVAM_SPEAKER = 'mrunal';
export const SARVAM_TARGET_LANGUAGE_CODE = 'mr-IN';
export const SARVAM_DEFAULT_PACE = 1.0;

type CachedSpeechBufferEntry =
  | {
      provider: 'elevenlabs';
      mimeType: string;
      buffer: Buffer;
      modelUsed: ElevenLabsModelId;
      voiceId: string;
    }
  | {
      provider: 'sarvam';
      mimeType: string;
      buffer: Buffer;
      modelUsed: string;
      voiceId: string;
    };

let cachedClient: GoogleGenAI | null = null;
let cachedKey = '';
let primaryConverseCooldownUntil = 0;
let elevenLabsCooldownUntil = 0;
let freeTierIpBlockedCooldownUntil = 0;
let invalidElevenLabsKeyCached = '';
let paidOnlyVoiceIdCached = '';
let sarvamCooldownUntil = 0;
let invalidSarvamKeyCached = '';
let sarvamLearnedLegacyInputs = false;
let sarvamLearnedSpeakerOverride = '';
const ttsAudioCache = new Map<string, CachedSpeechBufferEntry>();
const MAX_TTS_CACHE_ITEMS = 120;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function isPlausibleElevenLabsApiKey(key: string): boolean {
  if (!key) return false;
  // Modern ElevenLabs keys start with "sk_"; legacy keys are 32-char lowercase hex.
  // Reject 20-char Voice IDs or API Key IDs immediately so they never trigger HTTP 400 auth errors.
  return /^sk_[a-zA-Z0-9_]{20,120}$/.test(key) || /^[a-f0-9]{32}$/i.test(key);
}

/**
 * Strictly validates the owner's selected ELEVENLABS_VOICE_ID from Render Environment Variables.
 * Never substitutes any alternate/premade voice ID.
 */
export function sanitizeElevenLabsVoiceId(raw: string | undefined): {
  voiceId: string;
  isCustom: boolean;
} {
  const trimmed = (raw || '').trim();
  if (trimmed && /^[a-zA-Z0-9_-]{8,64}$/.test(trimmed)) {
    return {
      voiceId: trimmed,
      isCustom: true,
    };
  }
  return {
    voiceId: '',
    isCustom: false,
  };
}

/**
 * Accurately classifies ElevenLabs HTTP error responses so Free-Tier Library Voice restrictions
 * (HTTP 402 `payment_required`) or shared-IP blocks (`detected_unusual_activity`) are NEVER
 * mislabeled as "quota exhausted".
 */
export function classifyElevenLabsHttpError(
  httpStatus: number,
  rawBody: string,
): ElevenLabsHttpErrorKind {
  const lower = (rawBody || '').toLowerCase();

  // 1. Free-tier shared cloud IP / anti-abuse block (common on Render shared IPs)
  if (
    lower.includes('detected_unusual_activity') ||
    lower.includes('unusual activity') ||
    lower.includes('free tier usage disabled')
  ) {
    return 'free_tier_ip_blocked';
  }

  // 2. Genuine credit / character quota exhaustion or rate throttling
  if (
    lower.includes('quota_exceeded') ||
    lower.includes('character_limit') ||
    lower.includes('insufficient_credits') ||
    lower.includes('credit_limit') ||
    httpStatus === 429
  ) {
    return 'quota_exceeded';
  }

  // 3. Community / Voice Library voice blocked on Free Plan (HTTP 402 payment_required / paid_plan_required)
  if (
    lower.includes('paid_plan_required') ||
    lower.includes('library voice') ||
    lower.includes('library_voice') ||
    lower.includes('voice_not_found') ||
    (httpStatus === 402 && !lower.includes('quota')) ||
    lower.includes('payment_required')
  ) {
    return 'library_voice_paid_only';
  }

  // 4. Invalid / missing-permission API key
  if (
    httpStatus === 401 ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication_error') ||
    lower.includes('missing_permissions')
  ) {
    return 'auth_rejected';
  }

  return 'voice_error';
}

export function resolveElevenLabsModelChain(rawModelId?: string): ElevenLabsModelId[] {
  const trimmed = (rawModelId || '').trim() as ElevenLabsModelId;
  const primary: ElevenLabsModelId = ALLOWED_ELEVENLABS_MODELS.includes(trimmed)
    ? trimmed
    : DEFAULT_ELEVENLABS_MODEL_ID;
  const ordered: ElevenLabsModelId[] = [primary];
  for (const fallbackModel of ALLOWED_ELEVENLABS_MODELS) {
    if (!ordered.includes(fallbackModel)) {
      ordered.push(fallbackModel);
    }
  }
  return ordered;
}

export function resolveElevenLabsConfig(env: NodeJS.ProcessEnv = process.env): {
  apiKey: string;
  voiceId: string;
  voiceIdIsCustom: boolean;
  primaryModelId: ElevenLabsModelId;
  modelChain: ElevenLabsModelId[];
  status: ElevenLabsHealthStatus;
} {
  const apiKey = (env.ELEVENLABS_API_KEY || '').trim();
  const { voiceId, isCustom: voiceIdIsCustom } = sanitizeElevenLabsVoiceId(env.ELEVENLABS_VOICE_ID);
  const modelChain = resolveElevenLabsModelChain(env.ELEVENLABS_MODEL_ID);
  const primaryModelId = modelChain[0];

  let status: ElevenLabsHealthStatus = 'ready';

  if (!apiKey) {
    status = 'missing_key';
  } else if (!isPlausibleElevenLabsApiKey(apiKey)) {
    status = 'invalid_key_format';
  } else if (!voiceId) {
    status = 'missing_voice_id';
  } else if (apiKey === invalidElevenLabsKeyCached) {
    status = 'auth_rejected';
  } else if (paidOnlyVoiceIdCached && paidOnlyVoiceIdCached === voiceId) {
    status = 'voice_paid_plan_required';
  } else if (Date.now() < freeTierIpBlockedCooldownUntil) {
    status = 'free_tier_ip_blocked';
  } else if (Date.now() < elevenLabsCooldownUntil) {
    status = 'quota_cooldown';
  }

  return {
    apiKey,
    voiceId,
    voiceIdIsCustom,
    primaryModelId,
    modelChain,
    status,
  };
}

export function buildElevenLabsStreamUrl(
  voiceId: string,
  modelId: ElevenLabsModelId,
): string {
  const query =
    modelId === 'eleven_v3'
      ? `?output_format=${ELEVENLABS_STREAM_OUTPUT_FORMAT}`
      : `?output_format=${ELEVENLABS_STREAM_OUTPUT_FORMAT}&optimize_streaming_latency=${ELEVENLABS_OPTIMIZE_STREAMING_LATENCY}`;
  return `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream${query}`;
}

export function buildElevenLabsRequestPayload(params: {
  text: string;
  modelId: ElevenLabsModelId;
}): Record<string, unknown> {
  if (params.modelId === 'eleven_v3') {
    // eleven_v3 natively supports Marathi ("mr") across 70+ languages.
    return {
      text: params.text,
      model_id: 'eleven_v3',
      language_code: 'mr',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    };
  }
  // Do NOT pass language_code to eleven_flash_v2_5 or eleven_multilingual_v2 (Marathi is not in their enum).
  // Keep style at 0.0 for lowest ElevenLabs inference latency.
  return {
    text: params.text,
    model_id: params.modelId,
    voice_settings: {
      stability: 0.48,
      similarity_boost: 0.8,
      style: 0.0,
      use_speaker_boost: true,
    },
  };
}

export function resetElevenLabsRuntimeStateForTest(): void {
  elevenLabsCooldownUntil = 0;
  freeTierIpBlockedCooldownUntil = 0;
  invalidElevenLabsKeyCached = '';
  paidOnlyVoiceIdCached = '';
  ttsAudioCache.clear();
}

export function resetSarvamRuntimeStateForTest(): void {
  sarvamCooldownUntil = 0;
  invalidSarvamKeyCached = '';
  sarvamLearnedLegacyInputs = false;
  sarvamLearnedSpeakerOverride = '';
  ttsAudioCache.clear();
}

export function resolveSarvamConfig(env: NodeJS.ProcessEnv = process.env): {
  apiKey: string;
  modelId: string;
  speaker: string;
  languageCode: string;
  pace: number;
  status: SarvamHealthStatus;
} {
  const apiKey = (env.SARVAM_API_KEY || '').trim();
  const modelId = (env.SARVAM_MODEL_ID || '').trim() || DEFAULT_SARVAM_MODEL_ID;
  const speaker = (env.SARVAM_SPEAKER || '').trim() || DEFAULT_SARVAM_SPEAKER;

  let status: SarvamHealthStatus = 'ready';
  if (!apiKey) {
    status = 'missing_key';
  } else if (apiKey === invalidSarvamKeyCached) {
    status = 'auth_rejected';
  } else if (Date.now() < sarvamCooldownUntil) {
    status = 'quota_cooldown';
  }

  return {
    apiKey,
    modelId,
    speaker,
    languageCode: SARVAM_TARGET_LANGUAGE_CODE,
    pace: SARVAM_DEFAULT_PACE,
    status,
  };
}

export function buildSarvamRequestPayload(params: {
  text: string;
  modelId?: string;
  speaker?: string;
  useLegacyInputsArray?: boolean;
}): Record<string, unknown> {
  const model = (params.modelId || DEFAULT_SARVAM_MODEL_ID).trim() || DEFAULT_SARVAM_MODEL_ID;
  const speaker = (params.speaker || DEFAULT_SARVAM_SPEAKER).trim() || DEFAULT_SARVAM_SPEAKER;
  if (params.useLegacyInputsArray) {
    return {
      inputs: [params.text],
      target_language_code: SARVAM_TARGET_LANGUAGE_CODE,
      speaker,
      model,
      pace: SARVAM_DEFAULT_PACE,
    };
  }
  return {
    text: params.text,
    target_language_code: SARVAM_TARGET_LANGUAGE_CODE,
    speaker,
    model,
    pace: SARVAM_DEFAULT_PACE,
  };
}

export function getSarvamErrorMessageMr(reason: SarvamHealthStatus): string {
  switch (reason) {
    case 'missing_key':
      return 'Sarvam AI API Key सेट केलेली नाही. कृपया Settings > Secrets किंवा Environment Variables मध्ये SARVAM_API_KEY अ‍ॅड करा.';
    case 'auth_rejected':
      return 'Sarvam AI ने ही API Key नाकारली आहे. कृपया वैध SARVAM_API_KEY तपासा.';
    case 'quota_cooldown':
      return 'Sarvam AI चा आजचा कोटा किंवा मर्यादा संपली आहे. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.';
    default:
      return 'Sarvam AI आवाज सध्या उपलब्ध नाही. कृपया काही सेकंदांनी पुन्हा प्रयत्न करा.';
  }
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
  elevenLabsModelId: ElevenLabsModelId;
  statusMessageMr?: string;
  ttsPrimaryProvider: VoiceTtsProvider;
}

export function getVoiceCapabilitiesStatus(): VoiceCapabilitiesStatus {
  const geminiConfigured = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const sarvam = resolveSarvamConfig(process.env);
  const el = resolveElevenLabsConfig(process.env);
  const sarvamConfigured = sarvam.status === 'ready';
  const elevenLabsConfigured = el.status === 'ready';
  return {
    geminiConfigured,
    defaultProvider: 'sarvam',
    availableProviders: ['sarvam', 'elevenlabs'],
    sarvamConfigured,
    sarvamStatus: sarvam.status,
    sarvamModelId: sarvam.modelId,
    sarvamSpeaker: sarvam.speaker,
    ...(sarvam.status !== 'ready'
      ? { sarvamStatusMessageMr: getSarvamErrorMessageMr(sarvam.status) }
      : {}),
    elevenLabsConfigured,
    elevenLabsOnly: false,
    elevenLabsStatus: el.status,
    elevenLabsVoiceId: el.voiceId,
    elevenLabsVoiceIdCustom: el.voiceIdIsCustom,
    elevenLabsModelId: el.primaryModelId,
    ...(el.status !== 'ready' ? { statusMessageMr: getElevenLabsErrorMessageMr(el.status) } : {}),
    ttsPrimaryProvider: sarvamConfigured ? 'sarvam' : 'elevenlabs',
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
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_TRANSCRIBE_MODEL,
        contents: requestContents,
      }),
      GEMINI_TRANSCRIBE_TIMEOUT_MS,
      'Gemini transcribe',
    );
    return { transcript: (response.text || '').trim() };
  } catch (err) {
    if (!isRetryableOrQuotaError(err) && !String(err).includes('timed out')) throw err;
    const fallback = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_CONVERSE_FALLBACK_MODEL,
        contents: requestContents,
      }),
      GEMINI_FAST_TIMEOUT_MS,
      'Gemini transcribe fallback',
    );
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
  multiStep?: boolean;
}): Promise<VoiceConverseResult> {
  const ai = getGeminiClient();
  const systemInstruction = buildMarathiAssistantSystemInstruction(params.context);

  const invokeModel = async (modelName: string, contentsToSend: Content[]) =>
    withTimeout(
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
      }),
      modelName === GEMINI_CONVERSE_FAST_MODEL ? GEMINI_FAST_TIMEOUT_MS : GEMINI_HEAVY_TIMEOUT_MS,
      `Gemini voice (${modelName})`,
    );

  const now = Date.now();
  const hasToolsInHistory = hasFunctionCallParts(params.contents);
  const pinnedModel =
    params.preferredModel === GEMINI_CONVERSE_MODEL ||
    params.preferredModel === GEMINI_CONVERSE_FAST_MODEL
      ? params.preferredModel
      : undefined;

  // Smart routing:
  // - Complex multi-step commands go straight to gemini-4-hydrogen (ThinkingLevel.LOW) for reliable 1-turn parallel tool calling
  // - Single-step commands go to ultra-fast gemini-3.1-flash-lite (~1s) with automatic failover to gemini-4-hydrogen
  const firstModel =
    pinnedModel ||
    (params.multiStep || now < primaryConverseCooldownUntil
      ? GEMINI_CONVERSE_MODEL
      : GEMINI_CONVERSE_FAST_MODEL);
  const secondModel =
    firstModel === GEMINI_CONVERSE_FAST_MODEL ? GEMINI_CONVERSE_MODEL : GEMINI_CONVERSE_FAST_MODEL;

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

    if (firstModel === GEMINI_CONVERSE_FAST_MODEL) {
      const lowerErr = errMsg.toLowerCase();
      if (lowerErr.includes('404') || lowerErr.includes('not found') || lowerErr.includes('unsupported')) {
        primaryConverseCooldownUntil = Date.now() + 10 * 60_000;
      } else if (isRetryableOrQuotaError(firstErr) || lowerErr.includes('timed out')) {
        primaryConverseCooldownUntil = Date.now() + 45_000;
      }
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
      await sleep(300);
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
  provider: 'elevenlabs';
  mimeType: string;
  audioBase64: string;
  modelUsed?: string;
  voiceId?: string;
}

export class ElevenLabsSpeechError extends Error {
  readonly reason: ElevenLabsFallbackReason;
  constructor(reason: ElevenLabsFallbackReason, message: string) {
    super(message);
    this.name = 'ElevenLabsSpeechError';
    this.reason = reason;
  }
}

export function getElevenLabsErrorMessageMr(reason: ElevenLabsFallbackReason): string {
  switch (reason) {
    case 'missing_key':
      return 'ElevenLabs API Key सेट केलेली नाही. कृपया Render Environment Variables मध्ये sk_ ने सुरू होणारी Secret Key अ‍ॅड करा.';
    case 'invalid_key_format':
      return 'ElevenLabs API Key चुकीच्या फॉरमॅटमध्ये आहे. कृपया API Key ID ऐवजी sk_ ने सुरू होणारी मूळ Secret Key टाका.';
    case 'missing_voice_id':
      return 'Render मध्ये तुमचा ELEVENLABS_VOICE_ID सेट केलेला नाही. कृपया तुमचा निवडलेला Voice ID Render Environment Variables मध्ये अ‍ॅड करा.';
    case 'auth_rejected':
      return 'ElevenLabs ने ही API Key नाकारली आहे. कृपया वैध sk_ Secret Key तपासा.';
    case 'voice_paid_plan_required':
      return 'तुम्ही निवडलेला Voice ID वापरण्यासाठी ElevenLabs चा Paid Plan आवश्यक आहे. इतर कोणताही आवाज वापरला गेला नाही.';
    case 'free_tier_ip_blocked':
      return 'Render च्या शेअर्ड सर्व्हर IP वर ElevenLabs Free Plan तात्पुरता ब्लॉक झाला आहे (Paid Plan वर हा प्रश्न येत नाही).';
    case 'quota_cooldown':
      return 'आजचा कोटा संपला आहे. कृपया उद्या किंवा ElevenLabs क्रेडिट्स रिचार्ज केल्यानंतर पुन्हा प्रयत्न करा.';
    default:
      return 'तुमचा निवडलेला ElevenLabs आवाज सध्या उपलब्ध नाही. कृपया काही सेकंदांनी पुन्हा प्रयत्न करा.';
  }
}

export interface OpenedMarathiSpeechStream {
  provider: 'elevenlabs';
  mimeType: string;
  modelUsed: ElevenLabsModelId;
  voiceId: string;
  cacheHit: boolean;
  buffer?: Buffer;
  stream?: ReadableStream<Uint8Array>;
  onCompleteBuffer?: (fullBuffer: Buffer) => void;
}

function normalizeTtsCacheText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 900);
}

function buildTtsCacheKey(
  elConfig: ReturnType<typeof resolveElevenLabsConfig>,
  cleanText: string,
): string {
  return `elevenlabs::${elConfig.voiceId}::${elConfig.primaryModelId}::${ELEVENLABS_STREAM_OUTPUT_FORMAT}::${cleanText}`;
}

function buildSarvamCacheKey(
  sarvamConfig: ReturnType<typeof resolveSarvamConfig>,
  cleanText: string,
): string {
  return `sarvam::${sarvamConfig.speaker}::${sarvamConfig.modelId}::${sarvamConfig.languageCode}::${cleanText}`;
}

function readTtsCache(key: string): CachedSpeechBufferEntry | null {
  const hit = ttsAudioCache.get(key);
  if (!hit) return null;
  // Refresh LRU recency so hot phrases stay permanently cached in RAM
  ttsAudioCache.delete(key);
  ttsAudioCache.set(key, hit);
  return hit;
}

function storeTtsCache(key: string, value: CachedSpeechBufferEntry): void {
  if (!value.buffer || value.buffer.byteLength === 0) return;
  // Guard Render 512MB RAM against unusually huge clips (>350KB)
  if (value.buffer.byteLength > 350 * 1024) return;
  if (ttsAudioCache.has(key)) {
    ttsAudioCache.delete(key);
  } else if (ttsAudioCache.size >= MAX_TTS_CACHE_ITEMS) {
    const oldestKey = ttsAudioCache.keys().next().value;
    if (oldestKey) ttsAudioCache.delete(oldestKey);
  }
  ttsAudioCache.set(key, value);
}

async function openElevenLabsModelStream(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: ElevenLabsModelId;
  timeoutMs: number;
}): Promise<{
  response: Response | null;
  errorKind?: ElevenLabsHttpErrorKind;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const url = buildElevenLabsStreamUrl(params.voiceId, params.modelId);
    const bodyPayload = buildElevenLabsRequestPayload({
      text: params.text,
      modelId: params.modelId,
    });

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
      const errBody = await resp.text().catch(() => '');
      return {
        response: null,
        errorKind: classifyElevenLabsHttpError(resp.status, errBody),
      };
    }

    return { response: resp };
  } catch {
    return { response: null, errorKind: 'voice_error' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * STRICT SINGLE SELECTED VOICE STREAMING ENGINE:
 * Connects directly to ElevenLabs `/v1/text-to-speech/{voice_id}/stream` with
 * `eleven_flash_v2_5` primary, `optimize_streaming_latency=3`, and `mp3_22050_32`.
 * Never switches to Sarah, Rachel, Alice, Laura, or any other voice.
 */
export async function openMarathiSpeechStream(
  text: string,
  options?: { forceRefresh?: boolean },
): Promise<OpenedMarathiSpeechStream> {
  const cleanText = normalizeTtsCacheText(text);
  if (!cleanText) {
    throw new ElevenLabsSpeechError('voice_error', 'बोलण्यासाठी मजकूर उपलब्ध नाही.');
  }

  if (options?.forceRefresh) {
    // Allow explicit "आवाज तपासा" recovery checks to re-verify ElevenLabs cleanly
    elevenLabsCooldownUntil = 0;
    freeTierIpBlockedCooldownUntil = 0;
    paidOnlyVoiceIdCached = '';
    invalidElevenLabsKeyCached = '';
  }

  const config = resolveElevenLabsConfig(process.env);
  if (config.status !== 'ready') {
    throw new ElevenLabsSpeechError(config.status, getElevenLabsErrorMessageMr(config.status));
  }

  const cacheKey = buildTtsCacheKey(config, cleanText);
  if (!options?.forceRefresh) {
    const cached = readTtsCache(cacheKey);
    if (cached && cached.provider === 'elevenlabs') {
      return {
        provider: 'elevenlabs',
        mimeType: cached.mimeType,
        modelUsed: cached.modelUsed,
        voiceId: cached.voiceId,
        cacheHit: true,
        buffer: cached.buffer,
      };
    }
  }

  for (const modelId of config.modelChain) {
    const attempt = await openElevenLabsModelStream({
      apiKey: config.apiKey,
      voiceId: config.voiceId,
      text: cleanText,
      modelId,
      timeoutMs: modelId === 'eleven_flash_v2_5' ? 4000 : 5000,
    });

    if (attempt.response) {
      if (attempt.response.body) {
        return {
          provider: 'elevenlabs',
          mimeType: 'audio/mpeg',
          modelUsed: modelId,
          voiceId: config.voiceId,
          cacheHit: false,
          stream: attempt.response.body,
          onCompleteBuffer: (fullBuffer: Buffer) => {
            storeTtsCache(cacheKey, {
              provider: 'elevenlabs',
              mimeType: 'audio/mpeg',
              buffer: fullBuffer,
              modelUsed: modelId,
              voiceId: config.voiceId,
            });
          },
        };
      }

      const arrayBuf = await attempt.response.arrayBuffer();
      if (arrayBuf.byteLength > 0) {
        const buffer = Buffer.from(arrayBuf);
        storeTtsCache(cacheKey, {
          provider: 'elevenlabs',
          mimeType: 'audio/mpeg',
          buffer,
          modelUsed: modelId,
          voiceId: config.voiceId,
        });
        return {
          provider: 'elevenlabs',
          mimeType: 'audio/mpeg',
          modelUsed: modelId,
          voiceId: config.voiceId,
          cacheHit: false,
          buffer,
        };
      }
      continue;
    }

    if (attempt.errorKind === 'library_voice_paid_only') {
      paidOnlyVoiceIdCached = config.voiceId;
      throw new ElevenLabsSpeechError(
        'voice_paid_plan_required',
        getElevenLabsErrorMessageMr('voice_paid_plan_required'),
      );
    }

    if (attempt.errorKind === 'free_tier_ip_blocked') {
      freeTierIpBlockedCooldownUntil = Date.now() + 5 * 60_000;
      throw new ElevenLabsSpeechError(
        'free_tier_ip_blocked',
        getElevenLabsErrorMessageMr('free_tier_ip_blocked'),
      );
    }

    if (attempt.errorKind === 'auth_rejected') {
      invalidElevenLabsKeyCached = config.apiKey;
      throw new ElevenLabsSpeechError('auth_rejected', getElevenLabsErrorMessageMr('auth_rejected'));
    }

    if (attempt.errorKind === 'quota_exceeded') {
      elevenLabsCooldownUntil = Date.now() + 5 * 60_000;
      throw new ElevenLabsSpeechError(
        'quota_cooldown',
        getElevenLabsErrorMessageMr('quota_cooldown'),
      );
    }
    // Otherwise 'voice_error': try next model in modelChain on the EXACT SAME selected voiceId
  }

  throw new ElevenLabsSpeechError('voice_error', getElevenLabsErrorMessageMr('voice_error'));
}

/**
 * STRICT ELEVENLABS-ONLY Marathi female voice synthesis (buffered JSON compatibility wrapper).
 * Shares the exact same streaming endpoint, single-voice lock, and LRU in-memory buffer cache.
 * Never falls back to Gemini TTS, Google Translate TTS, or robotic browser speech.
 */
export async function synthesizeMarathiSpeech(
  text: string,
  options?: { forceRefresh?: boolean },
): Promise<SynthesizedSpeechResult> {
  const opened = await openMarathiSpeechStream(text, options);

  if (opened.buffer) {
    return {
      provider: 'elevenlabs',
      mimeType: opened.mimeType,
      audioBase64: opened.buffer.toString('base64'),
      modelUsed: opened.modelUsed,
      voiceId: opened.voiceId,
    };
  }

  if (opened.stream) {
    const reader = opened.stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          totalBytes += value.byteLength;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (totalBytes === 0) {
      throw new ElevenLabsSpeechError('voice_error', getElevenLabsErrorMessageMr('voice_error'));
    }

    const fullBuffer = Buffer.concat(chunks, totalBytes);
    opened.onCompleteBuffer?.(fullBuffer);
    return {
      provider: 'elevenlabs',
      mimeType: opened.mimeType,
      audioBase64: fullBuffer.toString('base64'),
      modelUsed: opened.modelUsed,
      voiceId: opened.voiceId,
    };
  }

  throw new ElevenLabsSpeechError('voice_error', getElevenLabsErrorMessageMr('voice_error'));
}

export class SarvamSpeechError extends Error {
  readonly reason: SarvamHealthStatus;
  constructor(reason: SarvamHealthStatus, message: string) {
    super(message);
    this.name = 'SarvamSpeechError';
    this.reason = reason;
  }
}

export class DualTtsUnavailableError extends Error {
  readonly requestedProvider: VoiceTtsProvider;
  readonly sarvamStatus: SarvamHealthStatus;
  readonly elevenLabsStatus: ElevenLabsFallbackReason;
  constructor(params: {
    message: string;
    requestedProvider: VoiceTtsProvider;
    sarvamStatus: SarvamHealthStatus;
    elevenLabsStatus: ElevenLabsFallbackReason;
  }) {
    super(params.message);
    this.name = 'DualTtsUnavailableError';
    this.requestedProvider = params.requestedProvider;
    this.sarvamStatus = params.sarvamStatus;
    this.elevenLabsStatus = params.elevenLabsStatus;
  }
}

function detectAudioMimeFromBuffer(buf: Buffer): string {
  if (buf.byteLength >= 4) {
    // RIFF....WAVE header
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
      return 'audio/wav';
    }
    // ID3 tag or MPEG frame sync
    if (
      (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
      (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
    ) {
      return 'audio/mpeg';
    }
  }
  return 'audio/wav';
}

function classifySarvamHttpError(httpStatus: number, rawBody: string): SarvamHealthStatus {
  const lower = (rawBody || '').toLowerCase();
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized') ||
    lower.includes('subscription')
  ) {
    return 'auth_rejected';
  }
  if (
    httpStatus === 429 ||
    httpStatus === 402 ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient') ||
    lower.includes('credit')
  ) {
    return 'quota_cooldown';
  }
  return 'voice_error';
}

async function callSarvamTtsHttp(params: {
  apiKey: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<{
  ok: boolean;
  status: number;
  audioBase64?: string;
  rawError?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const resp = await fetch(SARVAM_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-subscription-key': params.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, rawError: errBody };
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('audio/')) {
      const ab = await resp.arrayBuffer();
      if (ab.byteLength > 0) {
        return { ok: true, status: resp.status, audioBase64: Buffer.from(ab).toString('base64') };
      }
      return { ok: false, status: 502, rawError: 'Empty audio response' };
    }

    const json = (await resp.json().catch(() => ({}))) as {
      audios?: unknown;
      audio?: unknown;
    };
    const firstAudio =
      Array.isArray(json.audios) && typeof json.audios[0] === 'string'
        ? json.audios[0]
        : typeof json.audio === 'string'
          ? json.audio
          : '';
    if (!firstAudio) {
      return { ok: false, status: 502, rawError: 'Missing audio data in Sarvam response' };
    }
    return { ok: true, status: resp.status, audioBase64: firstAudio };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      rawError: err instanceof Error ? err.message : 'Sarvam request failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface OpenedDualSpeechResult {
  provider: VoiceTtsProvider;
  requestedProvider: VoiceTtsProvider;
  fallbackUsed: boolean;
  primaryFailureReason?: string;
  mimeType: string;
  modelUsed: string;
  voiceId: string;
  cacheHit: boolean;
  buffer?: Buffer;
  stream?: ReadableStream<Uint8Array>;
  onCompleteBuffer?: (fullBuffer: Buffer) => void;
}

export async function openSarvamSpeechBuffer(
  text: string,
  options?: { forceRefresh?: boolean },
): Promise<{
  provider: 'sarvam';
  mimeType: string;
  modelUsed: string;
  voiceId: string;
  cacheHit: boolean;
  buffer: Buffer;
}> {
  const cleanText = normalizeTtsCacheText(text);
  if (!cleanText) {
    throw new SarvamSpeechError('voice_error', 'बोलण्यासाठी मजकूर उपलब्ध नाही.');
  }

  if (options?.forceRefresh) {
    sarvamCooldownUntil = 0;
    invalidSarvamKeyCached = '';
    sarvamLearnedLegacyInputs = false;
    sarvamLearnedSpeakerOverride = '';
  }

  const config = resolveSarvamConfig(process.env);
  if (config.status !== 'ready') {
    throw new SarvamSpeechError(config.status, getSarvamErrorMessageMr(config.status));
  }

  const cacheKey = buildSarvamCacheKey(config, cleanText);
  if (!options?.forceRefresh) {
    const cached = readTtsCache(cacheKey);
    if (cached && cached.provider === 'sarvam') {
      return {
        provider: 'sarvam',
        mimeType: cached.mimeType,
        modelUsed: cached.modelUsed,
        voiceId: cached.voiceId,
        cacheHit: true,
        buffer: cached.buffer,
      };
    }
  }

  // Attempt 1: Exact requested settings (or cached learned compatibility format so we never waste a retry round-trip)
  let usedSpeaker = sarvamLearnedSpeakerOverride || config.speaker;
  let attempt = await callSarvamTtsHttp({
    apiKey: config.apiKey,
    payload: buildSarvamRequestPayload({
      text: cleanText,
      modelId: config.modelId,
      speaker: usedSpeaker,
      useLegacyInputsArray: sarvamLearnedLegacyInputs,
    }),
    timeoutMs: SARVAM_TTS_TIMEOUT_MS,
  });

  // Compatibility retry if Sarvam REST API version expects `inputs: [...]` or a built-in bulbul:v3 Marathi female speaker
  if (!attempt.ok && (attempt.status === 400 || attempt.status === 422)) {
    const errLower = (attempt.rawError || '').toLowerCase();
    const needsInputsArray = errLower.includes('inputs') && errLower.includes('required');
    const unsupportedSpeaker = errLower.includes('speaker');

    if (needsInputsArray || unsupportedSpeaker) {
      const retrySpeaker = unsupportedSpeaker && usedSpeaker.toLowerCase() === 'mrunal' ? 'shruti' : usedSpeaker;
      const retryAttempt = await callSarvamTtsHttp({
        apiKey: config.apiKey,
        payload: buildSarvamRequestPayload({
          text: cleanText,
          modelId: config.modelId,
          speaker: retrySpeaker,
          useLegacyInputsArray: needsInputsArray || sarvamLearnedLegacyInputs,
        }),
        timeoutMs: SARVAM_TTS_TIMEOUT_MS,
      });
      if (retryAttempt.ok) {
        attempt = retryAttempt;
        usedSpeaker = retrySpeaker;
        if (needsInputsArray) sarvamLearnedLegacyInputs = true;
        if (unsupportedSpeaker) sarvamLearnedSpeakerOverride = retrySpeaker;
      }
    }
  }

  if (!attempt.ok || !attempt.audioBase64) {
    const errKind = classifySarvamHttpError(attempt.status, attempt.rawError || '');
    if (errKind === 'auth_rejected') {
      invalidSarvamKeyCached = config.apiKey;
    } else if (errKind === 'quota_cooldown') {
      sarvamCooldownUntil = Date.now() + 5 * 60_000;
    }
    throw new SarvamSpeechError(errKind, getSarvamErrorMessageMr(errKind));
  }

  const buffer = Buffer.from(attempt.audioBase64, 'base64');
  if (buffer.byteLength === 0) {
    throw new SarvamSpeechError('voice_error', getSarvamErrorMessageMr('voice_error'));
  }

  const mimeType = detectAudioMimeFromBuffer(buffer);
  storeTtsCache(cacheKey, {
    provider: 'sarvam',
    mimeType,
    buffer,
    modelUsed: config.modelId,
    voiceId: usedSpeaker,
  });

  return {
    provider: 'sarvam',
    mimeType,
    modelUsed: config.modelId,
    voiceId: usedSpeaker,
    cacheHit: false,
    buffer,
  };
}

/**
 * Dual-Engine Marathi TTS with Smart Auto-Fallback (Sarvam AI <-> ElevenLabs).
 * Default provider is "sarvam". If the chosen provider fails (missing key, quota, IP block, or API error),
 * automatically attempts the other engine before returning an error. Never uses browser robotic speech.
 */
export async function openDualProviderSpeechStream(params: {
  text: string;
  provider?: VoiceTtsProvider;
  forceRefresh?: boolean;
}): Promise<OpenedDualSpeechResult> {
  const requestedProvider: VoiceTtsProvider =
    params.provider === 'elevenlabs' ? 'elevenlabs' : 'sarvam';
  const secondaryProvider: VoiceTtsProvider =
    requestedProvider === 'sarvam' ? 'elevenlabs' : 'sarvam';

  let primaryError: unknown = null;
  let sarvamErrStatus: SarvamHealthStatus = resolveSarvamConfig(process.env).status;
  let elevenLabsErrStatus: ElevenLabsFallbackReason = resolveElevenLabsConfig(process.env).status === 'ready'
    ? 'voice_error'
    : (resolveElevenLabsConfig(process.env).status as ElevenLabsFallbackReason);

  const tryEngine = async (engine: VoiceTtsProvider): Promise<OpenedDualSpeechResult> => {
    if (engine === 'sarvam') {
      const res = await openSarvamSpeechBuffer(params.text, {
        forceRefresh: params.forceRefresh,
      });
      return {
        provider: 'sarvam',
        requestedProvider,
        fallbackUsed: engine !== requestedProvider,
        mimeType: res.mimeType,
        modelUsed: res.modelUsed,
        voiceId: res.voiceId,
        cacheHit: res.cacheHit,
        buffer: res.buffer,
      };
    }

    const res = await openMarathiSpeechStream(params.text, {
      forceRefresh: params.forceRefresh,
    });
    return {
      provider: 'elevenlabs',
      requestedProvider,
      fallbackUsed: engine !== requestedProvider,
      mimeType: res.mimeType,
      modelUsed: res.modelUsed,
      voiceId: res.voiceId,
      cacheHit: res.cacheHit,
      buffer: res.buffer,
      stream: res.stream,
      onCompleteBuffer: res.onCompleteBuffer,
    };
  };

  try {
    return await tryEngine(requestedProvider);
  } catch (err) {
    primaryError = err;
    if (err instanceof SarvamSpeechError) {
      sarvamErrStatus = err.reason;
    } else if (err instanceof ElevenLabsSpeechError) {
      elevenLabsErrStatus = err.reason;
    }
  }

  // Smart Auto-Fallback to the alternate engine before reporting any error
  try {
    const fallbackResult = await tryEngine(secondaryProvider);
    const primaryReason =
      primaryError instanceof SarvamSpeechError
        ? primaryError.reason
        : primaryError instanceof ElevenLabsSpeechError
          ? primaryError.reason
          : 'voice_error';
    return {
      ...fallbackResult,
      fallbackUsed: true,
      primaryFailureReason: primaryReason,
    };
  } catch (fallbackErr) {
    if (fallbackErr instanceof SarvamSpeechError) {
      sarvamErrStatus = fallbackErr.reason;
    } else if (fallbackErr instanceof ElevenLabsSpeechError) {
      elevenLabsErrStatus = fallbackErr.reason;
    }

    const primaryDetail =
      primaryError instanceof Error ? primaryError.message : 'निवडलेले व्हॉइस इंजिन उपलब्ध नाही.';
    const secondaryDetail =
      fallbackErr instanceof Error ? fallbackErr.message : 'बॅकअप व्हॉइस इंजिन उपलब्ध नाही.';
    const combinedMessage =
      requestedProvider === 'sarvam'
        ? `Sarvam AI आणि ElevenLabs दोन्ही आवाज सध्या उपलब्ध नाहीत. Sarvam AI: ${primaryDetail} | बॅकअप (ElevenLabs): ${secondaryDetail}`
        : `ElevenLabs आणि Sarvam AI दोन्ही आवाज सध्या उपलब्ध नाहीत. ElevenLabs: ${primaryDetail} | बॅकअप (Sarvam AI): ${secondaryDetail}`;

    throw new DualTtsUnavailableError({
      message: combinedMessage,
      requestedProvider,
      sarvamStatus: sarvamErrStatus,
      elevenLabsStatus: elevenLabsErrStatus,
    });
  }
}

export interface DualSynthesizedSpeechResult {
  provider: VoiceTtsProvider;
  requestedProvider: VoiceTtsProvider;
  fallbackUsed: boolean;
  primaryFailureReason?: string;
  mimeType: string;
  audioBase64: string;
  modelUsed?: string;
  voiceId?: string;
  cacheHit?: boolean;
}

export async function synthesizeDualProviderSpeech(params: {
  text: string;
  provider?: VoiceTtsProvider;
  forceRefresh?: boolean;
}): Promise<DualSynthesizedSpeechResult> {
  const opened = await openDualProviderSpeechStream(params);

  if (opened.buffer) {
    return {
      provider: opened.provider,
      requestedProvider: opened.requestedProvider,
      fallbackUsed: opened.fallbackUsed,
      ...(opened.primaryFailureReason ? { primaryFailureReason: opened.primaryFailureReason } : {}),
      mimeType: opened.mimeType,
      audioBase64: opened.buffer.toString('base64'),
      modelUsed: opened.modelUsed,
      voiceId: opened.voiceId,
      cacheHit: opened.cacheHit,
    };
  }

  if (opened.stream) {
    const reader = opened.stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          totalBytes += value.byteLength;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (totalBytes === 0) {
      throw new DualTtsUnavailableError({
        message: 'Sarvam AI आणि ElevenLabs दोन्ही आवाज सध्या उपलब्ध नाहीत.',
        requestedProvider: opened.requestedProvider,
        sarvamStatus: resolveSarvamConfig(process.env).status,
        elevenLabsStatus: 'voice_error',
      });
    }

    const fullBuffer = Buffer.concat(chunks, totalBytes);
    opened.onCompleteBuffer?.(fullBuffer);
    return {
      provider: opened.provider,
      requestedProvider: opened.requestedProvider,
      fallbackUsed: opened.fallbackUsed,
      ...(opened.primaryFailureReason ? { primaryFailureReason: opened.primaryFailureReason } : {}),
      mimeType: opened.mimeType,
      audioBase64: fullBuffer.toString('base64'),
      modelUsed: opened.modelUsed,
      voiceId: opened.voiceId,
      cacheHit: opened.cacheHit,
    };
  }

  throw new DualTtsUnavailableError({
    message: 'Sarvam AI आणि ElevenLabs दोन्ही आवाज सध्या उपलब्ध नाहीत.',
    requestedProvider: opened.requestedProvider,
    sarvamStatus: resolveSarvamConfig(process.env).status,
    elevenLabsStatus: 'voice_error',
  });
}



