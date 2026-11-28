import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import {
  VOICE_FUNCTION_DECLARATIONS,
  buildMarathiAssistantSystemInstruction,
  type VoiceWorkspaceContext,
} from './voiceTools.ts';

const GEMINI_CONVERSE_MODEL = 'gemini-4-hydrogen';
const GEMINI_CONVERSE_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const DEFAULT_ELEVENLABS_MODEL_ID: ElevenLabsModelId = 'eleven_flash_v2_5';

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

interface CachedSpeechBufferEntry {
  provider: 'elevenlabs';
  mimeType: string;
  buffer: Buffer;
  modelUsed: ElevenLabsModelId;
  voiceId: string;
}

let cachedClient: GoogleGenAI | null = null;
let cachedKey = '';
let primaryConverseCooldownUntil = 0;
let elevenLabsCooldownUntil = 0;
let freeTierIpBlockedCooldownUntil = 0;
let invalidElevenLabsKeyCached = '';
let paidOnlyVoiceIdCached = '';
const ttsAudioCache = new Map<string, CachedSpeechBufferEntry>();
const MAX_TTS_CACHE_ITEMS = 80;

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
  elevenLabsConfigured: boolean;
  elevenLabsOnly: true;
  elevenLabsStatus: ElevenLabsHealthStatus;
  elevenLabsVoiceId: string;
  elevenLabsVoiceIdCustom: boolean;
  elevenLabsModelId: ElevenLabsModelId;
  statusMessageMr?: string;
  ttsPrimaryProvider: 'elevenlabs';
}

export function getVoiceCapabilitiesStatus(): VoiceCapabilitiesStatus {
  const geminiConfigured = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const el = resolveElevenLabsConfig(process.env);
  const elevenLabsConfigured = el.status === 'ready';
  return {
    geminiConfigured,
    elevenLabsConfigured,
    elevenLabsOnly: true,
    elevenLabsStatus: el.status,
    elevenLabsVoiceId: el.voiceId,
    elevenLabsVoiceIdCustom: el.voiceIdIsCustom,
    elevenLabsModelId: el.primaryModelId,
    ...(el.status !== 'ready' ? { statusMessageMr: getElevenLabsErrorMessageMr(el.status) } : {}),
    ttsPrimaryProvider: 'elevenlabs',
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
      await sleep(450);
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
  return `${elConfig.voiceId}::${elConfig.primaryModelId}::${ELEVENLABS_STREAM_OUTPUT_FORMAT}::${cleanText}`;
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
    if (cached) {
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
      timeoutMs: modelId === 'eleven_flash_v2_5' ? 6500 : modelId === 'eleven_v3' ? 9000 : 8000,
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


