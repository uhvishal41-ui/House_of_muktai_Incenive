import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Ear,
  ExternalLink,
  FolderCheck,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  blobToBase64,
  callVoiceConverseApi,
  callVoiceTranscribeApi,
  fetchVoiceCapabilitiesStatus,
  getSavedTtsProvider,
  saveTtsProvider,
  speakNaturalMarathi,
  stopMarathiSpeechPlayback,
  unlockVoiceAudioPlayback,
  warmUpVoiceServer,
  type SpeechPlaybackMeta,
  type TtsUnavailableDetails,
  type VoiceCapabilitiesStatus,
  type VoiceContentMessage,
  type VoiceTtsProvider,
} from '../../lib/voiceSpeechClient';
import {
  describeVoiceToolStepMr,
  extractWakeWordCommand,
  isMultiStepVoiceCommand,
  matchInstantLocalVoiceCommand,
  playWakeActivationChime,
  type VoiceActionCard,
  type VoiceExecutionStep,
} from '../../lib/voiceProHelpers';
import {
  buildVoiceClientContext,
  executeVoiceToolCall,
  type VoicePendingConfirmation,
  type VoiceToolExecutionEnv,
} from '../../services/voiceToolExecutor';

type AssistantPhase = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

interface Props {
  activeTab: string;
  actorLabel: string;
  env: VoiceToolExecutionEnv;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

const MAX_HISTORY_MESSAGES = 6;
const MAX_TOOL_LOOPS = 10;
const SILENCE_AUTO_SUBMIT_MS = 850;
const NO_SPEECH_IDLE_TIMEOUT_MS = 5500;
const MAX_LISTEN_DURATION_MS = 10000;
const WAKE_MIC_HANDOFF_DELAY_MS = 180;
const WAKE_WORD_STORAGE_KEY = 'hom_voice_wake_word_enabled';

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function toFriendlyMarathiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (lower.includes('api_key') || lower.includes('api key') || lower.includes('not configured')) {
    return 'सर्व्हरवर व्हॉइस असिस्टंटची API Key सेट केलेली नाही. कृपया Settings > Secrets मध्ये API Key जोडून पुन्हा प्रयत्न करा.';
  }
  if (lower.includes('not-allowed') || lower.includes('permission denied') || lower.includes('notallowederror')) {
    return 'मायक्रोफोनची परवानगी बंद आहे. कृपया ब्राउझरमध्ये मायक्रोफोन Allow करा किंवा खालील बॉक्समध्ये मराठीत टाईप करा.';
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return 'इंटरनेट किंवा सर्व्हरशी संपर्क तुटला आहे. कृपया कनेक्शन तपासून पुन्हा प्रयत्न करा.';
  }
  if (lower.includes('aborted') || lower.includes('abort') || lower.includes('timed out') || lower.includes('timeout')) {
    return 'सर्व्हरकडून उत्तर यायला थोडा जास्त वेळ लागला. कृपया पुन्हा एकदा प्रयत्न करा.';
  }
  if (lower.includes('429') || lower.includes('resource_exhausted')) {
    return 'सध्या व्हॉइस सर्व्हिसवर जास्त लोड आहे. कृपया काही सेकंदांनी पुन्हा प्रयत्न करा.';
  }
  return 'तांत्रिक अडचणीमुळे ही कमांड पूर्ण होऊ शकली नाही. कृपया पुन्हा एकदा स्पष्टपणे सांगा किंवा प्रयत्न करा.';
}

export function MarathiVoiceAssistant({ activeTab, actorLabel, env }: Props) {
  const [phase, setPhase] = useState<AssistantPhase>('idle');
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [liveAction, setLiveAction] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [errorNote, setErrorNote] = useState('');
  const [textCommand, setTextCommand] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<VoicePendingConfirmation | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<VoiceTtsProvider>(() =>
    getSavedTtsProvider(),
  );
  const [ttsBadge, setTtsBadge] = useState<VoiceTtsProvider | null>(null);
  const [ttsFallbackUsed, setTtsFallbackUsed] = useState(false);
  const [voiceCaps, setVoiceCaps] = useState<VoiceCapabilitiesStatus | null>(null);
  const [ttsUnavailable, setTtsUnavailable] = useState<TtsUnavailableDetails | null>(null);
  const [testingVoice, setTestingVoice] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(WAKE_WORD_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<VoiceExecutionStep[]>([]);
  const [actionCard, setActionCard] = useState<VoiceActionCard | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const historyRef = useRef<VoiceContentMessage[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const finalTranscriptRef = useRef<string>('');
  const accumulatedSegmentsRef = useRef<string[]>([]);
  const currentSessionTextRef = useRef<string>('');
  const isListeningSessionRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(muted);
  const selectedProviderRef = useRef<VoiceTtsProvider>(selectedProvider);
  const envRef = useRef(env);
  const phaseRef = useRef<AssistantPhase>(phase);
  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  const lastWakeTriggerAtRef = useRef<number>(0);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    selectedProviderRef.current = selectedProvider;
    saveTtsProvider(selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    envRef.current = env;
  }, [env]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(WAKE_WORD_STORAGE_KEY, wakeWordEnabled ? 'true' : 'false');
      } catch {
        // ignore storage restrictions
      }
    }
  }, [wakeWordEnabled]);

  const stopWakeWordListener = useCallback(() => {
    if (wakeRestartTimerRef.current) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
    if (wakeRecognitionRef.current) {
      try {
        wakeRecognitionRef.current.onresult = null;
        wakeRecognitionRef.current.onerror = null;
        wakeRecognitionRef.current.onend = null;
        wakeRecognitionRef.current.abort();
      } catch {
        // ignore
      }
      wakeRecognitionRef.current = null;
    }
    setWakeWordActive(false);
  }, []);

  // Keep server warm (avoids 40-60s Render Free cold-start lag on first "हे मुक्ताई" command)
  useEffect(() => {
    void warmUpVoiceServer();
    const keepWarmInterval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void warmUpVoiceServer();
      }
    }, 9 * 60_000);
    return () => clearInterval(keepWarmInterval);
  }, []);

  // Cleanup voice/mic handles on unmount (zero robotic browser TTS used — Sarvam AI + ElevenLabs only)
  useEffect(() => {
    return () => {
      isListeningSessionRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
      if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (wakeHandoffTimerRef.current) clearTimeout(wakeHandoffTimerRef.current);
      stopWakeWordListener();
      stopMarathiSpeechPlayback();
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stopWakeWordListener]);

  const refreshVoiceCaps = useCallback(async () => {
    const caps = await fetchVoiceCapabilitiesStatus();
    if (caps) {
      setVoiceCaps(caps);
      if (caps.sarvamConfigured || caps.elevenLabsConfigured) {
        setTtsUnavailable(null);
      }
    }
  }, []);

  useEffect(() => {
    if (overlayOpen) {
      void refreshVoiceCaps();
    }
  }, [overlayOpen, refreshVoiceCaps]);

  const handleSelectProvider = useCallback((nextProvider: VoiceTtsProvider) => {
    unlockVoiceAudioPlayback();
    stopMarathiSpeechPlayback();
    setSelectedProvider(nextProvider);
    selectedProviderRef.current = nextProvider;
    saveTtsProvider(nextProvider);
    setTtsUnavailable(null);
    setTtsFallbackUsed(false);
    setPhase((cur) => (cur === 'speaking' ? 'idle' : cur));
  }, []);

  const speakReply = useCallback(
    async (
      replyText: string,
      options?: {
        provider?: VoiceTtsProvider;
        forceRefresh?: boolean;
        showUnavailableInReplyBox?: boolean;
      },
    ) => {
      if (!replyText.trim()) {
        setPhase('idle');
        return;
      }
      if (mutedRef.current) {
        setPhase('idle');
        return;
      }
      const activeProvider = options?.provider || selectedProviderRef.current;
      setPhase('speaking');
      try {
        const result = await speakNaturalMarathi(replyText, {
          provider: activeProvider,
          muted: mutedRef.current,
          forceRefresh: options?.forceRefresh,
          onStart: (p, meta?: SpeechPlaybackMeta) => {
            setTtsBadge(p);
            setTtsFallbackUsed(Boolean(meta?.fallbackUsed));
            setTtsUnavailable(null);
          },
          onUnavailable: (details) => {
            setTtsBadge(null);
            setTtsFallbackUsed(false);
            setTtsUnavailable(details);
            if (options?.showUnavailableInReplyBox) {
              setAssistantReply(details.errorMessage);
              setErrorNote(details.errorMessage);
            }
          },
        });
        if (result === 'sarvam' || result === 'elevenlabs') {
          setTtsBadge(result);
        }
      } catch {
        // Strictly never fall back to robotic browser TTS
      } finally {
        setPhase((cur) => (cur === 'speaking' ? 'idle' : cur));
      }
    },
    [],
  );

  const handleTestVoice = useCallback(async () => {
    if (testingVoice || phase === 'processing') return;
    unlockVoiceAudioPlayback();
    setTestingVoice(true);
    setErrorNote('');
    const needsLiveRecoveryCheck = Boolean(
      ttsUnavailable ||
        (selectedProvider === 'sarvam'
          ? !voiceCaps?.sarvamConfigured
          : !voiceCaps?.elevenLabsConfigured),
    );
    try {
      await speakReply(
        'नमस्कार! मी मुक्ताई, तुमची मराठी व्हॉइस असिस्टंट. सांगा, मी तुमची काय मदत करू शकते?',
        {
          provider: selectedProvider,
          forceRefresh: needsLiveRecoveryCheck,
          showUnavailableInReplyBox: true,
        },
      );
      if (needsLiveRecoveryCheck) {
        void refreshVoiceCaps();
      }
    } finally {
      setTestingVoice(false);
    }
  }, [phase, refreshVoiceCaps, selectedProvider, speakReply, testingVoice, ttsUnavailable, voiceCaps]);

  const processUserCommand = useCallback(
    async (spokenText: string) => {
      const trimmed = spokenText.trim();
      if (!trimmed) {
        setPhase('idle');
        return;
      }

      stopWakeWordListener();
      stopMarathiSpeechPlayback();
      setOverlayOpen(true);
      setErrorNote('');
      setUserTranscript(trimmed);
      setExecutionSteps([]);
      setActionCard(null);
      setLiveAction('तुमची कमांड समजून घेत आहे...');
      setPhase('processing');

      const multiStepRequested = isMultiStepVoiceCommand(trimmed);
      const nextHistory: VoiceContentMessage[] = [
        ...historyRef.current.slice(-MAX_HISTORY_MESSAGES),
        { role: 'user', parts: [{ text: trimmed }] },
      ];

      const execEnv: VoiceToolExecutionEnv = {
        ...envRef.current,
        onLiveStatus: (msg) => setLiveAction(msg),
        onPendingConfirmation: (pending) => setPendingConfirm(pending),
        onActionCard: (card) => setActionCard(card),
      };

      const buildCtx = () =>
        buildVoiceClientContext({
          activeTab,
          isMainOwner: envRef.current.isMainOwner,
          actorLabel,
          branches: envRef.current.branches,
          employees: envRef.current.employees,
          monthlySummaries: envRef.current.monthlySummaries,
          salarySlips: envRef.current.salarySlips,
          payrollLockSettings: envRef.current.payrollLockSettings,
          linkedFolder: envRef.current.linkedFolder,
        });

      try {
        // 0ms Instant Local Shortcut for greetings, executive briefing, and direct tab navigation
        const instantShortcut = matchInstantLocalVoiceCommand(trimmed);
        if (instantShortcut) {
          let instantReply = '';
          if (instantShortcut.kind === 'reply') {
            instantReply = instantShortcut.replyMr;
          } else {
            const labelMr = describeVoiceToolStepMr(instantShortcut.toolName, instantShortcut.args);
            const stepId = `instant_${instantShortcut.toolName}`;
            setExecutionSteps([
              { id: stepId, toolName: instantShortcut.toolName, labelMr, status: 'running' },
            ]);
            const toolResult = await executeVoiceToolCall(
              instantShortcut.toolName,
              instantShortcut.args,
              execEnv,
            );
            const succeeded = toolResult.ok === true;
            setExecutionSteps([
              {
                id: stepId,
                toolName: instantShortcut.toolName,
                labelMr,
                status: succeeded ? 'done' : 'error',
              },
            ]);
            instantReply =
              typeof toolResult.directReplyMr === 'string' && toolResult.directReplyMr.trim()
                ? toolResult.directReplyMr.trim()
                : succeeded
                  ? 'तुम्ही दिलेला टास्क पूर्ण झाला आहे.'
                  : '';
          }

          if (instantReply) {
            const updatedHistory: VoiceContentMessage[] = [
              ...historyRef.current,
              { role: 'user', parts: [{ text: trimmed }] },
              { role: 'model', parts: [{ text: instantReply }] },
            ];
            historyRef.current = updatedHistory.slice(-MAX_HISTORY_MESSAGES);
            setLiveAction('');
            setAssistantReply(instantReply);
            await speakReply(instantReply);
            return;
          }
        }

        let workingHistory = [...nextHistory];
        let finalReplyText = '';
        let stepCounter = 0;
        let pinnedModel: string | undefined;
        const completedToolReplies: string[] = [];

        for (let step = 0; step < MAX_TOOL_LOOPS; step += 1) {
          let resp;
          try {
            resp = await callVoiceConverseApi({
              contents: workingHistory,
              context: buildCtx(),
              ...(pinnedModel ? { preferredModel: pinnedModel } : {}),
              ...(multiStepRequested ? { multiStep: true } : {}),
            });
          } catch (loopErr) {
            // If earlier tool(s) in a multi-step command ALREADY succeeded, speak their real results instead of failing!
            if (completedToolReplies.length > 0) {
              finalReplyText = completedToolReplies.join(' ');
              break;
            }
            throw loopErr;
          }

          if (resp.usedModel) {
            pinnedModel = resp.usedModel;
          }

          if (resp.modelContent) {
            workingHistory.push(resp.modelContent);
          }

          if (!resp.functionCalls || resp.functionCalls.length === 0) {
            finalReplyText =
              resp.text ||
              (completedToolReplies.length > 0
                ? completedToolReplies.join(' ')
                : 'तुम्ही दिलेला टास्क पूर्ण झाला आहे.');
            break;
          }

          // Execute every requested tool call and track live step-by-step progress
          const responseParts: Array<Record<string, unknown>> = [];
          let directInstantReply = '';
          let allCallsDirectReady = true;

          for (const fc of resp.functionCalls) {
            stepCounter += 1;
            const stepId = `step_${stepCounter}_${fc.name}`;
            const labelMr = describeVoiceToolStepMr(fc.name, fc.args);
            setExecutionSteps((prev) => [
              ...prev,
              { id: stepId, toolName: fc.name, labelMr, status: 'running' },
            ]);

            const toolResult = await executeVoiceToolCall(fc.name, fc.args, execEnv);
            const succeeded = toolResult.ok === true;
            setExecutionSteps((prev) =>
              prev.map((s) =>
                s.id === stepId
                  ? {
                      ...s,
                      status: succeeded ? 'done' : 'error',
                      detailMr:
                        !succeeded && typeof toolResult.error === 'string'
                          ? toolResult.error.slice(0, 70)
                          : undefined,
                    }
                  : s,
              ),
            );

            // Keep functionResponse compact so Step 2 Gemini summary stays ultra-fast
            const rawClean = JSON.parse(JSON.stringify(toolResult)) as Record<string, unknown>;
            const serialized = JSON.stringify(rawClean);
            const cleanResponseObj: Record<string, unknown> =
              serialized.length > 3600
                ? {
                    ok: rawClean.ok,
                    ...(typeof rawClean.directReplyMr === 'string'
                      ? { directReplyMr: rawClean.directReplyMr }
                      : {}),
                    ...(typeof rawClean.error === 'string' ? { error: rawClean.error } : {}),
                    summaryTruncated: serialized.slice(0, 2400),
                  }
                : rawClean;

            responseParts.push({
              functionResponse: {
                ...(fc.id ? { id: fc.id } : {}),
                name: fc.name,
                response: cleanResponseObj,
              },
            });
            const maybeDirect =
              typeof toolResult.directReplyMr === 'string' ? toolResult.directReplyMr.trim() : '';
            if (maybeDirect) {
              directInstantReply = maybeDirect;
              if (!completedToolReplies.includes(maybeDirect)) {
                completedToolReplies.push(maybeDirect);
              }
            } else {
              allCallsDirectReady = false;
            }
          }

          workingHistory.push({
            role: 'user',
            parts: responseParts,
          });

          // Skip redundant 2nd Gemini round-trip ONLY for simple single-step commands (never short-circuit multi-step chains!)
          const canShortCircuit =
            !multiStepRequested &&
            resp.functionCalls.length === 1 &&
            step === 0 &&
            allCallsDirectReady &&
            Boolean(directInstantReply);

          if (canShortCircuit) {
            finalReplyText = directInstantReply;
            workingHistory.push({
              role: 'model',
              parts: [{ text: directInstantReply }],
            });
            break;
          }
        }

        if (!finalReplyText) {
          finalReplyText =
            completedToolReplies.length > 0
              ? completedToolReplies.join(' ')
              : 'तुम्ही दिलेला टास्क पूर्ण झाला आहे.';
        }

        // Persist ONLY clean user/model text pairs across turns so history slicing can never orphan
        // a functionCall/functionResponse turn or carry cross-model thoughtSignatures.
        const updatedHistory: VoiceContentMessage[] = [
          ...historyRef.current,
          { role: 'user', parts: [{ text: trimmed }] },
          { role: 'model', parts: [{ text: finalReplyText }] },
        ];
        historyRef.current = updatedHistory.slice(-MAX_HISTORY_MESSAGES);
        setLiveAction('');
        setAssistantReply(finalReplyText);
        await speakReply(finalReplyText);
      } catch (err) {
        const rawErr = err instanceof Error ? err.message : String(err || '');
        console.warn('[MarathiVoiceAssistant] Command error:', rawErr);
        const isQuotaErr =
          rawErr.includes('429') ||
          rawErr.toLowerCase().includes('resource_exhausted') ||
          rawErr.toLowerCase().includes('quota');
        const friendly = toFriendlyMarathiError(err);
        setLiveAction('');
        setErrorNote(friendly);
        setAssistantReply(friendly);
        setPhase('error');
        // Avoid triggering another TTS call when quota is already rate-limited
        if (!isQuotaErr) {
          await speakReply(friendly);
        }
      }
    },
    [activeTab, actorLabel, speakReply],
  );

  const clearListeningTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (noSpeechTimerRef.current) {
      clearTimeout(noSpeechTimerRef.current);
      noSpeechTimerRef.current = null;
    }
    if (maxListenTimerRef.current) {
      clearTimeout(maxListenTimerRef.current);
      maxListenTimerRef.current = null;
    }
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (wakeHandoffTimerRef.current) {
      clearTimeout(wakeHandoffTimerRef.current);
      wakeHandoffTimerRef.current = null;
    }
  }, []);

  const cleanupRecordingHandles = useCallback(() => {
    isListeningSessionRef.current = false;
    clearListeningTimers();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }, [clearListeningTimers]);

  const stopListeningAndProcess = useCallback(async () => {
    if (!isListeningSessionRef.current && !recognitionRef.current && !mediaRecorderRef.current) {
      return;
    }
    isListeningSessionRef.current = false;
    clearListeningTimers();

    const rec = recognitionRef.current;
    const mr = mediaRecorderRef.current;

    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    // Flush MediaRecorder cleanly so we get the full noise-suppressed Marathi audio clip
    if (mr && mr.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const safeTimeout = setTimeout(() => resolve(), 250);
        mr.onstop = () => {
          clearTimeout(safeTimeout);
          resolve();
        };
        try {
          mr.stop();
        } catch {
          clearTimeout(safeTimeout);
          resolve();
        }
      });
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;

    const capturedLiveSpeech = [
      ...accumulatedSegmentsRef.current,
      currentSessionTextRef.current,
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || finalTranscriptRef.current.trim();

    const chunks = audioChunksRef.current;
    audioChunksRef.current = [];

    // Priority 1: Immediate live browser Marathi speech when already captured cleanly
    // (saves a 1.5-2s audio upload + transcription round-trip on every voice command)
    if (capturedLiveSpeech.length >= 2) {
      setUserTranscript(capturedLiveSpeech);
      await processUserCommand(capturedLiveSpeech);
      return;
    }

    // Priority 2: High-accuracy server audio transcription fallback (when browser speech is unsupported/silent)
    if (chunks.length > 0) {
      const mime = chunks[0]?.type || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      if (blob.size > 1400) {
        setPhase('processing');
        setLiveAction('तुमचा मराठी आवाज अचूक समजून घेत आहे...');
        try {
          const base64 = await blobToBase64(blob);
          const { transcript } = await callVoiceTranscribeApi({
            audioBase64: base64,
            mimeType: mime,
          });
          if (transcript && transcript.trim().length > 0) {
            setUserTranscript(transcript.trim());
            await processUserCommand(transcript.trim());
            return;
          }
        } catch {
          // Gracefully show friendly retry message below
        }
      }
    }

    setLiveAction('');
    setAssistantReply('तुमचा आवाज स्पष्ट ऐकू आला नाही. कृपया माईक दाबून पुन्हा स्पष्टपणे बोला.');
    setPhase('idle');
  }, [clearListeningTimers, processUserCommand]);

  const startListening = useCallback(async () => {
    stopWakeWordListener();
    unlockVoiceAudioPlayback();
    stopMarathiSpeechPlayback();
    clearListeningTimers();

    isListeningSessionRef.current = true;
    accumulatedSegmentsRef.current = [];
    currentSessionTextRef.current = '';
    finalTranscriptRef.current = '';
    audioChunksRef.current = [];

    setOverlayOpen(true);
    setErrorNote('');
    setLiveAction('ऐकत आहे... आरामात पूर्ण वाक्य बोला (थांबल्यावर आपोआप पाठवले जाईल)');
    setUserTranscript('');
    setPhase('listening');

    const scheduleSilenceAutoSubmit = () => {
      if (noSpeechTimerRef.current) {
        clearTimeout(noSpeechTimerRef.current);
        noSpeechTimerRef.current = null;
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      silenceTimerRef.current = setTimeout(() => {
        if (isListeningSessionRef.current) {
          void stopListeningAndProcess();
        }
      }, SILENCE_AUTO_SUBMIT_MS);
    };

    // Fast idle timeout if user wakes with "हे मुक्ताई" and doesn't speak anything
    noSpeechTimerRef.current = setTimeout(() => {
      if (isListeningSessionRef.current && !finalTranscriptRef.current.trim()) {
        void stopListeningAndProcess();
      }
    }, NO_SPEECH_IDLE_TIMEOUT_MS);

    // Tight 10s safety cap so mic NEVER gets stuck for 35 seconds
    maxListenTimerRef.current = setTimeout(() => {
      if (isListeningSessionRef.current) {
        void stopListeningAndProcess();
      }
    }, MAX_LISTEN_DURATION_MS);

    // 1. Start continuous browser SpeechRecognition for instant zero-upload Marathi speech capture
    const SpeechCtor = getSpeechRecognitionCtor();
    let speechRecognitionStarted = false;
    const launchRecognition = () => {
      if (!SpeechCtor || !isListeningSessionRef.current) return;
      try {
        const recognition = new SpeechCtor();
        recognition.lang = 'mr-IN';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
          if (!isListeningSessionRef.current) return;
          let sessionCombined = '';
          for (let i = 0; i < event.results.length; i += 1) {
            sessionCombined += event.results[i][0]?.transcript || '';
          }
          const cleanSession = sessionCombined.trim();
          currentSessionTextRef.current = cleanSession;

          const fullText = [...accumulatedSegmentsRef.current, cleanSession]
            .filter(Boolean)
            .join(' ')
            .trim();
          if (fullText) {
            finalTranscriptRef.current = fullText;
            setUserTranscript(fullText);
            // Crisp 850ms silence auto-submit on every word for instant turnaround
            scheduleSilenceAutoSubmit();
          }
        };

        recognition.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            cleanupRecordingHandles();
            const friendly = toFriendlyMarathiError(new Error('not-allowed'));
            setLiveAction('');
            setErrorNote(friendly);
            setAssistantReply(friendly);
            setPhase('error');
          }
        };

        recognition.onend = () => {
          if (!isListeningSessionRef.current) return;
          if (currentSessionTextRef.current) {
            accumulatedSegmentsRef.current.push(currentSessionTextRef.current);
            currentSessionTextRef.current = '';
          }
          // If we already captured words and SpeechRecognition ended cleanly, submit immediately!
          if (finalTranscriptRef.current.trim().length >= 2) {
            void stopListeningAndProcess();
            return;
          }
          restartTimerRef.current = setTimeout(() => {
            if (isListeningSessionRef.current) {
              launchRecognition();
            }
          }, 120);
        };

        recognitionRef.current = recognition;
        recognition.start();
        speechRecognitionStarted = true;
      } catch {
        speechRecognitionStarted = false;
      }
    };

    launchRecognition();

    // 2. Only open MediaRecorder when browser SpeechRecognition is unavailable (prevents Chrome mic lock fights & slow audio uploads)
    if (
      !speechRecognitionStarted &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!isListeningSessionRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const mimeCandidate = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';
        const recorder = mimeCandidate
          ? new MediaRecorder(stream, { mimeType: mimeCandidate })
          : new MediaRecorder(stream);
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
          }
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
      } catch (micErr) {
        if (!SpeechCtor) {
          cleanupRecordingHandles();
          const friendly = toFriendlyMarathiError(micErr);
          setLiveAction('');
          setErrorNote(friendly);
          setAssistantReply(friendly);
          setPhase('error');
        }
      }
    }
  }, [clearListeningTimers, cleanupRecordingHandles, stopListeningAndProcess, stopWakeWordListener]);

  // Background "हे मुक्ताई" Hands-Free Wake-Word Listener (only active when idle & enabled)
  useEffect(() => {
    if (!wakeWordEnabled || phase !== 'idle' || pendingConfirm) {
      stopWakeWordListener();
      return;
    }
    const SpeechCtor = getSpeechRecognitionCtor();
    if (!SpeechCtor) {
      return;
    }

    let cancelled = false;
    const armWakeListener = () => {
      if (cancelled || !wakeWordEnabledRef.current || phaseRef.current !== 'idle') return;
      try {
        const rec = new SpeechCtor();
        rec.lang = 'mr-IN';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onresult = (event) => {
          if (cancelled || phaseRef.current !== 'idle') return;
          let latestText = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            latestText += ` ${event.results[i][0]?.transcript || ''}`;
          }
          const match = extractWakeWordCommand(latestText);
          if (!match.triggered) return;

          const now = Date.now();
          if (now - lastWakeTriggerAtRef.current < 1500) return;
          lastWakeTriggerAtRef.current = now;

          stopWakeWordListener();
          playWakeActivationChime();
          unlockVoiceAudioPlayback();

          if (match.commandText && match.commandText.length >= 3) {
            const lastRes = event.results[event.results.length - 1];
            if (lastRes?.isFinal || match.commandText.split(/\s+/).length >= 2) {
              void processUserCommand(match.commandText);
              return;
            }
          }

          // Clean 180ms mic handoff delay so Chrome releases wake-word mic lock cleanly before starting command listener
          setOverlayOpen(true);
          setLiveAction('हो, बोला... ऐकत आहे...');
          wakeHandoffTimerRef.current = setTimeout(() => {
            wakeHandoffTimerRef.current = null;
            if (phaseRef.current === 'idle') {
              void startListening();
            }
          }, WAKE_MIC_HANDOFF_DELAY_MS);
        };

        rec.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            setWakeWordEnabled(false);
            stopWakeWordListener();
          }
        };

        rec.onend = () => {
          setWakeWordActive(false);
          if (cancelled || !wakeWordEnabledRef.current || phaseRef.current !== 'idle') return;
          wakeRestartTimerRef.current = setTimeout(() => {
            armWakeListener();
          }, 420);
        };

        wakeRecognitionRef.current = rec;
        rec.start();
        setWakeWordActive(true);
      } catch {
        setWakeWordActive(false);
      }
    };

    const initialTimer = setTimeout(() => {
      armWakeListener();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      stopWakeWordListener();
    };
  }, [wakeWordEnabled, phase, pendingConfirm, processUserCommand, startListening, stopWakeWordListener]);

  const handleToggleWakeWord = () => {
    unlockVoiceAudioPlayback();
    setWakeWordEnabled((prev) => {
      const next = !prev;
      if (next) {
        playWakeActivationChime();
      } else {
        stopWakeWordListener();
      }
      return next;
    });
  };

  const handleCopyWhatsAppText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId((cur) => (cur === key ? null : cur)), 1800);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleMicToggle = () => {
    unlockVoiceAudioPlayback();
    if (phase === 'listening') {
      void stopListeningAndProcess();
      return;
    }
    if (phase === 'speaking') {
      stopMarathiSpeechPlayback();
      setPhase('idle');
      return;
    }
    if (phase === 'processing') {
      return;
    }
    void startListening();
  };

  const handleConfirmPending = async (approve: boolean) => {
    unlockVoiceAudioPlayback();
    if (!pendingConfirm) return;
    const confirmedAction = pendingConfirm;
    if (!approve) {
      setPendingConfirm(null);
      const cancelMsg = 'ठीक आहे, डिलीट करण्याची क्रिया रद्द केली आहे.';
      setAssistantReply(cancelMsg);
      await speakReply(cancelMsg);
      return;
    }
    // Execute confirmed destructive tool directly without an extra Gemini round-trip
    setPendingConfirm(null);
    setPhase('processing');
    setLiveAction('पुष्टीनंतर क्रिया पूर्ण करत आहे...');
    const execEnv: VoiceToolExecutionEnv = {
      ...envRef.current,
      onLiveStatus: (msg) => setLiveAction(msg),
      onPendingConfirmation: (pending) => setPendingConfirm(pending),
    };
    try {
      const res = await executeVoiceToolCall(confirmedAction.toolName, confirmedAction.args, execEnv);
      const reply =
        typeof res.directReplyMr === 'string' && res.directReplyMr.trim()
          ? res.directReplyMr.trim()
          : res.ok
            ? 'तुमच्या पुष्टीनुसार डिलीट करण्याची क्रिया पूर्ण झाली आहे.'
            : toFriendlyMarathiError(new Error(String(res.error || 'Action failed')));
      setLiveAction('');
      setAssistantReply(reply);
      if (!res.ok) setErrorNote(reply);
      await speakReply(reply);
    } catch (err) {
      const friendly = toFriendlyMarathiError(err);
      setLiveAction('');
      setErrorNote(friendly);
      setAssistantReply(friendly);
      setPhase('error');
      await speakReply(friendly);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockVoiceAudioPlayback();
    const cmd = textCommand.trim();
    if (!cmd || phase === 'processing') return;
    setTextCommand('');
    void processUserCommand(cmd);
  };

  const handleResetSession = () => {
    stopWakeWordListener();
    stopMarathiSpeechPlayback();
    cleanupRecordingHandles();
    historyRef.current = [];
    setPendingConfirm(null);
    setExecutionSteps([]);
    setActionCard(null);
    setUserTranscript('');
    setLiveAction('');
    setAssistantReply('');
    setErrorNote('');
    setPhase('idle');
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {/* Compact, Non-Intrusive Pro Live Status Overlay */}
      <AnimatePresence>
        {overlayOpen && (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto w-[355px] sm:w-[410px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white/98 backdrop-blur-md border border-slate-200/95 shadow-2xl overflow-hidden"
          >
            {/* Header Strip */}
            <div className="px-3.5 py-2.5 bg-[#0F1F3D] text-white flex items-center justify-between gap-2 border-b border-[#B8923A]/40">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    phase === 'listening'
                      ? 'bg-rose-400 animate-ping'
                      : phase === 'processing'
                        ? 'bg-[#DFC27D] animate-pulse'
                        : phase === 'speaking'
                          ? 'bg-emerald-400 animate-pulse'
                          : phase === 'error'
                            ? 'bg-amber-400'
                            : wakeWordActive
                              ? 'bg-emerald-400 animate-pulse'
                              : 'bg-emerald-400'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold tracking-tight truncate flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#DFC27D] shrink-0" />
                    <span>मुक्ताई मराठी व्हॉइस Pro</span>
                  </p>
                  <p className="text-[10px] text-slate-300 truncate">
                    {phase === 'listening'
                      ? 'ऐकत आहे... बोलणे संपल्यावर थांबा किंवा पाठवा दाबा'
                      : phase === 'processing'
                        ? 'मल्टी-स्टेप कृती सुरू आहे...'
                        : phase === 'speaking'
                          ? `बोलत आहे · ${
                              ttsBadge === 'elevenlabs' ? 'ElevenLabs' : 'Sarvam AI (मृणाल)'
                            }${ttsFallbackUsed ? ' · ऑटो-बॅकअप' : ''}`
                          : wakeWordEnabled
                            ? 'हँड्स-फ्री चालू · “हे मुक्ताई...” म्हणून बोला'
                            : 'बोलण्यासाठी माईक दाबा किंवा खाली टाईप करा'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleWakeWord}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors border ${
                    wakeWordEnabled
                      ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50 hover:bg-emerald-500/30'
                      : 'bg-white/5 text-slate-300 border-white/15 hover:bg-white/10 hover:text-white'
                  }`}
                  title='“हे मुक्ताई” Hands-Free वेक-वर्ड मोड चालू/बंद करा'
                >
                  <Ear className="w-3 h-3" />
                  <span>हे मुक्ताई</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextMuted = !muted;
                    setMuted(nextMuted);
                    if (nextMuted) stopMarathiSpeechPlayback();
                  }}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
                  title={muted ? 'Unmute Marathi Voice' : 'Mute Voice'}
                >
                  {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={handleResetSession}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
                  title="Reset Conversation"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayOpen(false)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
                  aria-label="Minimize voice overlay"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-3.5 space-y-2.5 max-h-[420px] overflow-y-auto">
              {/* Dual Voice Engine Switcher (Sarvam AI मृणाल <-> ElevenLabs) + 1-Click Voice Test */}
              <div className="rounded-xl border border-slate-200/90 bg-slate-50/90 p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px] font-bold text-[#0F1F3D]">
                    आवाज इंजिन निवडा (Auto-Backup सक्रिय)
                  </span>
                  <button
                    type="button"
                    disabled={testingVoice || phase === 'processing'}
                    onClick={() => void handleTestVoice()}
                    className="shrink-0 h-6 px-2 rounded-md bg-white hover:bg-[#FDF8EC] border border-slate-200/90 text-[#0F1F3D] text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60"
                    title="निवडलेला मराठी आवाज लगेच तपासा"
                  >
                    {testingVoice ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Volume2 className="w-3 h-3" />
                    )}
                    <span>आवाज तपासा</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Voice TTS Engine">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedProvider === 'sarvam'}
                    onClick={() => handleSelectProvider('sarvam')}
                    className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedProvider === 'sarvam'
                        ? 'bg-[#0F1F3D] text-white border-[#0F1F3D] shadow-sm'
                        : 'bg-white text-[#0F1F3D] border-slate-200 hover:border-[#B8923A]/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold truncate">Sarvam AI (मृणाल)</span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          voiceCaps
                            ? voiceCaps.sarvamConfigured
                              ? 'bg-emerald-400'
                              : 'bg-amber-400'
                            : 'bg-slate-300'
                        }`}
                      />
                    </div>
                    <p
                      className={`text-[9.5px] truncate mt-0.5 ${
                        selectedProvider === 'sarvam' ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {voiceCaps?.sarvamConfigured
                        ? 'तयार · bulbul:v3 (मराठी)'
                        : voiceCaps?.sarvamStatus === 'missing_key'
                          ? 'SARVAM_API_KEY सेट करा'
                          : voiceCaps?.sarvamStatus === 'quota_cooldown'
                            ? 'कोटा मर्यादा · बॅकअप चालू'
                            : 'डिफॉल्ट मराठी आवाज'}
                    </p>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedProvider === 'elevenlabs'}
                    onClick={() => handleSelectProvider('elevenlabs')}
                    className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedProvider === 'elevenlabs'
                        ? 'bg-[#0F1F3D] text-white border-[#0F1F3D] shadow-sm'
                        : 'bg-white text-[#0F1F3D] border-slate-200 hover:border-[#B8923A]/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold truncate">ElevenLabs</span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          voiceCaps
                            ? voiceCaps.elevenLabsConfigured
                              ? 'bg-emerald-400'
                              : 'bg-amber-400'
                            : 'bg-slate-300'
                        }`}
                      />
                    </div>
                    <p
                      className={`text-[9.5px] truncate mt-0.5 ${
                        selectedProvider === 'elevenlabs' ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {voiceCaps?.elevenLabsConfigured
                        ? `तयार · ID …${voiceCaps.elevenLabsVoiceId.slice(-4)}`
                        : voiceCaps?.elevenLabsStatus === 'voice_paid_plan_required'
                          ? 'Paid Plan आवश्यक · बॅकअप चालू'
                          : voiceCaps?.elevenLabsStatus === 'quota_cooldown'
                            ? 'कोटा संपला · बॅकअप चालू'
                            : voiceCaps?.elevenLabsStatus === 'free_tier_ip_blocked'
                              ? 'IP ब्लॉक · बॅकअप चालू'
                              : 'निवडलेला Voice ID'}
                    </p>
                  </button>
                </div>

                {ttsFallbackUsed && ttsBadge && !ttsUnavailable && (
                  <div className="rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1.5 text-[10.5px] text-sky-900 font-medium flex items-center justify-between gap-2">
                    <span className="truncate">
                      स्वयंचलित बॅकअप:{' '}
                      <strong>
                        {ttsBadge === 'sarvam' ? 'Sarvam AI (मृणाल)' : 'ElevenLabs'}
                      </strong>{' '}
                      मधून आवाज प्ले केला.
                    </span>
                  </div>
                )}
              </div>

              {/* Clean Marathi Error Toast/Banner when BOTH Sarvam AI and ElevenLabs fail (zero robotic fallback) */}
              {ttsUnavailable && (
                <div
                  role="alert"
                  className="rounded-xl px-3 py-2.5 border bg-rose-50 border-rose-300 text-rose-950 flex items-start justify-between gap-2 text-xs"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-bold leading-snug">
                        सध्या दोन्ही व्हॉइस इंजिन उपलब्ध नाहीत
                      </p>
                      <p className="text-[11px] leading-relaxed opacity-90">
                        {ttsUnavailable.errorMessage}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTtsUnavailable(null)}
                    className="p-0.5 rounded text-rose-500 hover:text-rose-800 cursor-pointer shrink-0"
                    aria-label="Close voice error"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Linked Folder Status Bar */}
              {env.linkedFolder.linked && (
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200/80 text-[11px] text-emerald-900">
                  <span className="inline-flex items-center gap-1.5 font-medium truncate">
                    <FolderCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span className="truncate">
                      फोल्डर जोडले: <strong>{env.linkedFolder.folderName}</strong>
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-emerald-700 shrink-0">
                    {env.linkedFolder.files.length} files
                  </span>
                </div>
              )}

              {/* What User Said */}
              {userTranscript && (
                <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
                    तुम्ही म्हणालात
                  </p>
                  <p className="text-xs font-medium text-[#0F1F3D] leading-relaxed">
                    “{userTranscript}”
                  </p>
                </div>
              )}

              {/* Live Action Progress Indicator */}
              {liveAction && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#FDF8EC] border border-[#B8923A]/45 text-xs font-semibold text-[#0F1F3D]">
                  <div className="flex items-center gap-2 min-w-0">
                    {phase === 'listening' ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping shrink-0" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 text-[#9A7625] animate-spin shrink-0" />
                    )}
                    <span className="leading-snug">{liveAction}</span>
                  </div>
                  {phase === 'listening' && (
                    <button
                      type="button"
                      onClick={() => void stopListeningAndProcess()}
                      className="shrink-0 h-7 px-2.5 rounded-lg bg-[#0F1F3D] hover:bg-[#1E3A5F] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Send className="w-3 h-3" />
                      पाठवा
                    </button>
                  )}
                </div>
              )}

              {/* Multi-Step Live Progress Checklist */}
              {executionSteps.length > 0 && (
                <div className="rounded-xl bg-slate-50/90 border border-slate-200/85 px-3 py-2 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                    <span>
                      {executionSteps.length > 1
                        ? `मल्टी-स्टेप कृती (${executionSteps.filter((s) => s.status === 'done').length}/${executionSteps.length})`
                        : 'कृती स्थिती'}
                    </span>
                  </p>
                  <div className="space-y-1">
                    {executionSteps.map((step, idx) => (
                      <div key={step.id} className="flex items-center gap-2 text-[11.5px]">
                        {step.status === 'running' ? (
                          <Loader2 className="w-3.5 h-3.5 text-[#9A7625] animate-spin shrink-0" />
                        ) : step.status === 'done' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        )}
                        <span
                          className={`truncate font-medium ${
                            step.status === 'error'
                              ? 'text-amber-800'
                              : step.status === 'done'
                                ? 'text-[#0F1F3D]'
                                : 'text-[#9A7625]'
                          }`}
                        >
                          {idx + 1}. {step.labelMr}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assistant Reply */}
              {assistantReply && (
                <div
                  className={`rounded-xl px-3 py-2.5 border text-xs leading-relaxed ${
                    errorNote
                      ? 'bg-amber-50/90 border-amber-200 text-amber-950'
                      : 'bg-[#0F1F3D]/[0.04] border-[#0F1F3D]/15 text-[#0F1F3D]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#9A7625] inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      मदतनीस उत्तर
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          unlockVoiceAudioPlayback();
                          void speakReply(assistantReply);
                        }}
                        className="text-[10px] font-semibold text-[#1E3A5F] hover:underline cursor-pointer inline-flex items-center gap-1"
                      >
                        <Volume2 className="w-3 h-3" />
                        पुन्हा ऐका
                      </button>
                      {phase === 'idle' && (
                        <button
                          type="button"
                          onClick={() => void startListening()}
                          className="text-[10px] font-semibold text-emerald-700 hover:underline cursor-pointer inline-flex items-center gap-0.5"
                        >
                          <Mic className="w-3 h-3" />
                          पुढील कमांड
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="font-medium text-[13px] leading-relaxed">{assistantReply}</p>
                </div>
              )}

              {/* PRO ACTION CARD 1: WHATSAPP QUICK-SEND DISPATCH */}
              {actionCard?.type === 'whatsapp' && (
                <div className="rounded-xl bg-emerald-50/90 border border-emerald-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MessageCircle className="w-4 h-4 text-emerald-700 shrink-0" />
                      <p className="text-xs font-bold text-emerald-950 truncate">
                        {actionCard.titleMr}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-800 shrink-0">
                      {actionCard.monthLabel}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-[175px] overflow-y-auto pr-0.5">
                    {actionCard.items.map((item) => (
                      <div
                        key={`${item.employeeId}_${item.docType}`}
                        className="rounded-lg bg-white border border-emerald-200/80 px-2.5 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-[11.5px] font-bold text-[#0F1F3D] truncate">
                            {item.employeeName}{' '}
                            <span className="font-mono text-[10px] text-slate-500">
                              #{item.employeeId}
                            </span>
                          </p>
                          <p className="text-[10.5px] text-slate-600 truncate">
                            {item.docType === 'SALARY_SLIP' ? 'सॅलरी स्लिप' : 'इन्सेंटिव्ह'} ·{' '}
                            <strong className="text-emerald-800">{item.amountLabel}</strong>
                            {!item.hasPhone && (
                              <span className="ml-1 text-amber-700 font-semibold">(नंबर नाही)</span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyWhatsAppText(item.employeeId, item.messageText)
                            }
                            className="h-7 px-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                            title="मेसेज कॉपी करा"
                          >
                            {copiedId === item.employeeId ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                          <a
                            href={item.waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-semibold inline-flex items-center gap-1 transition-colors"
                          >
                            <span>पाठवा</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                  {actionCard.totalMatched > actionCard.items.length && (
                    <p className="text-[10px] text-emerald-800 font-medium">
                      पहिले {actionCard.items.length} दाखवले आहेत (एकूण {actionCard.totalMatched}{' '}
                      कर्मचारी).
                    </p>
                  )}
                </div>
              )}

              {/* PRO ACTION CARD 2: EXECUTIVE MORNING BUSINESS BRIEFING */}
              {actionCard?.type === 'briefing' && (
                <div className="rounded-xl bg-[#0F1F3D] text-white border border-[#B8923A]/50 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <BarChart3 className="w-4 h-4 text-[#DFC27D] shrink-0" />
                      <p className="text-xs font-bold truncate">
                        बिझनेस ब्रीफिंग · {actionCard.monthLabel}
                      </p>
                    </div>
                    <span className="text-[10px] text-[#DFC27D] font-semibold shrink-0">
                      {actionCard.branchScopeLabel}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded-lg bg-white/8 px-2.5 py-1.5 border border-white/10">
                      <p className="text-[9.5px] text-slate-300">एकूण विक्री</p>
                      <p className="text-xs font-bold text-white tabular-nums">
                        {actionCard.totalSalesLabel}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/8 px-2.5 py-1.5 border border-white/10">
                      <p className="text-[9.5px] text-slate-300">एकूण इन्सेंटिव्ह</p>
                      <p className="text-xs font-bold text-[#DFC27D] tabular-nums">
                        {actionCard.totalIncentiveLabel}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/8 px-2.5 py-1.5 border border-white/10">
                      <p className="text-[9.5px] text-slate-300">निव्वळ पगार</p>
                      <p className="text-xs font-bold text-emerald-300 tabular-nums">
                        {actionCard.totalSalaryNetLabel}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/8 px-2.5 py-1.5 border border-white/10">
                      <p className="text-[9.5px] text-slate-300">
                        प्रलंबित पेआउट ({actionCard.pendingPayoutCount})
                      </p>
                      <p className="text-xs font-bold text-amber-300 tabular-nums">
                        {actionCard.pendingPayoutLabel}
                      </p>
                    </div>
                  </div>

                  {actionCard.topBranches.length > 0 && (
                    <div className="space-y-1 pt-0.5">
                      <p className="text-[10px] font-semibold text-[#DFC27D] flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        <span>टॉप शाखा</span>
                      </p>
                      {actionCard.topBranches.map((b, i) => (
                        <div
                          key={b.branchName}
                          className="flex items-center justify-between text-[11px] bg-white/5 rounded-md px-2 py-1"
                        >
                          <span className="truncate font-medium">
                            {i + 1}. {b.branchName}
                          </span>
                          <span className="font-mono text-[10.5px] text-emerald-200 shrink-0 ml-2">
                            {b.salesLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10 text-[10px] text-slate-300">
                    <span>ओपन शंका: <strong className="text-white">{actionCard.openQueriesCount}</strong></span>
                    <span>•</span>
                    <span>सेल ड्रॉप अलर्ट: <strong className="text-amber-300">{actionCard.coachingAlertsCount}</strong></span>
                    <span>•</span>
                    <span>हाय-LOP: <strong className="text-rose-300">{actionCard.highLopCount}</strong></span>
                  </div>
                </div>
              )}

              {/* Destructive Action Confirmation Box */}
              {pendingConfirm && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 space-y-2">
                  <div className="flex items-start gap-2 text-xs text-rose-950 font-semibold">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{pendingConfirm.summaryMr}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={phase === 'processing'}
                      onClick={() => void handleConfirmPending(true)}
                      className="flex-1 h-8 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 transition-colors"
                    >
                      हो, खात्रीने करा
                    </button>
                    <button
                      type="button"
                      disabled={phase === 'processing'}
                      onClick={() => void handleConfirmPending(false)}
                      className="flex-1 h-8 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold cursor-pointer transition-colors"
                    >
                      रद्द करा
                    </button>
                  </div>
                </div>
              )}

              {/* Helpful Pro Quick Examples when empty */}
              {!userTranscript && !assistantReply && !liveAction && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-500">
                    Pro कमांड्स (बोलून किंवा क्लिक करून वापरून पहा):
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {[
                      'आजचा बिझनेस रिपोर्ट मराठीत सांग',
                      'शोभा लोंढे यांची सॅलरी स्लिप WhatsApp वर पाठव',
                      'धाराशिव शाखेतील सर्व कर्मचारी दाखवा आणि टॉप ५ परफॉर्मर सांगा',
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => {
                          unlockVoiceAudioPlayback();
                          void processUserCommand(sample);
                        }}
                        className="text-left px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-[#FDF8EC] border border-slate-200/80 hover:border-[#B8923A]/50 text-[11.5px] text-[#0F1F3D] font-medium cursor-pointer transition-colors"
                      >
                        “{sample}”
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Compact Text Command Bar */}
            <form
              onSubmit={handleTextSubmit}
              className="px-3 py-2 bg-slate-50 border-t border-slate-200/80 flex items-center gap-2"
            >
              <input
                type="text"
                value={textCommand}
                onChange={(e) => setTextCommand(e.target.value)}
                placeholder="मराठी / English कमांड टाईप करा..."
                disabled={phase === 'processing'}
                className="flex-1 h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-xs text-[#0F1F3D] placeholder:text-slate-400 focus:outline-none focus:border-[#B8923A]"
              />
              <button
                type="submit"
                disabled={!textCommand.trim() || phase === 'processing'}
                aria-label="Send command"
                className="h-8 w-8 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-[#DFC27D] inline-flex items-center justify-center cursor-pointer disabled:opacity-45 transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sleek Floating Mic Button */}
      <div className="pointer-events-auto relative flex items-center gap-2">
        {!overlayOpen && wakeWordEnabled && phase === 'idle' && (
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-950/90 text-emerald-100 border border-emerald-400/50 shadow-lg text-[11px] font-semibold hover:bg-emerald-900 cursor-pointer transition-colors"
            title='Hands-Free मोड चालू आहे — “हे मुक्ताई” म्हणून बोला'
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>“हे मुक्ताई” सक्रिय</span>
          </button>
        )}
        {!overlayOpen && !wakeWordEnabled && assistantReply && (
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            className="hidden sm:inline-flex max-w-[240px] px-3 py-1.5 rounded-xl bg-white/95 border border-slate-200 shadow-lg text-xs font-medium text-[#0F1F3D] truncate hover:border-[#B8923A] cursor-pointer transition-colors"
            title="Show Voice Assistant overlay"
          >
            {assistantReply}
          </button>
        )}

        <div className="relative">
          {phase === 'listening' && (
            <>
              <span className="absolute inset-0 rounded-full bg-rose-500/35 animate-ping" />
              <span className="absolute -inset-2 rounded-full border-2 border-rose-400/50 animate-pulse" />
            </>
          )}
          {phase === 'speaking' && (
            <span className="absolute -inset-1.5 rounded-full border-2 border-emerald-400/70 animate-pulse" />
          )}
          {phase === 'idle' && wakeWordActive && (
            <span className="absolute -inset-1.5 rounded-full border-2 border-emerald-400/60 animate-pulse" />
          )}

          <button
            type="button"
            onClick={handleMicToggle}
            aria-label={
              phase === 'listening'
                ? 'Stop listening and run Marathi voice command'
                : 'Start Marathi Voice Assistant'
            }
            title="मुक्ताई मराठी व्हॉइस Pro (House of Muktai AI)"
            className={`relative w-14 h-14 rounded-full shadow-xl border-2 flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
              phase === 'listening'
                ? 'bg-rose-600 hover:bg-rose-700 border-rose-300 text-white'
                : phase === 'processing'
                  ? 'bg-[#1E3A5F] border-[#DFC27D] text-[#DFC27D]'
                  : phase === 'speaking'
                    ? 'bg-emerald-700 hover:bg-emerald-800 border-emerald-300 text-white'
                    : 'bg-[#0F1F3D] hover:bg-[#162B50] border-[#B8923A] text-[#DFC27D]'
            }`}
          >
            {phase === 'processing' ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : phase === 'listening' ? (
              <MicOff className="w-6 h-6" />
            ) : phase === 'speaking' ? (
              <Volume2 className="w-6 h-6" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
