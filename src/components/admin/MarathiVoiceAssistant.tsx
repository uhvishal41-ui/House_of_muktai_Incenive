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
  speakNaturalMarathi,
  stopMarathiSpeechPlayback,
  unlockVoiceAudioPlayback,
  type ElevenLabsFallbackReason,
  type SpeechPlaybackMeta,
  type VoiceCapabilitiesStatus,
  type VoiceContentMessage,
  type VoiceTtsProvider,
} from '../../lib/voiceSpeechClient';
import {
  describeVoiceToolStepMr,
  extractWakeWordCommand,
  isMultiStepVoiceCommand,
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
const SILENCE_AUTO_SUBMIT_MS = 2600;
const MAX_LISTEN_DURATION_MS = 35000;
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
  const [ttsBadge, setTtsBadge] = useState<VoiceTtsProvider | null>(null);
  const [voiceCaps, setVoiceCaps] = useState<VoiceCapabilitiesStatus | null>(null);
  const [lastFallbackReason, setLastFallbackReason] = useState<ElevenLabsFallbackReason | null>(null);
  const [lastVoiceLabel, setLastVoiceLabel] = useState<string>('');
  const [usedPremadeFallback, setUsedPremadeFallback] = useState(false);
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
  const maxListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(muted);
  const envRef = useRef(env);
  const phaseRef = useRef<AssistantPhase>(phase);
  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  const lastWakeTriggerAtRef = useRef<number>(0);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

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

  // Cleanup voice/mic handles on unmount (zero browser speechSynthesis used — ElevenLabs only)
  useEffect(() => {
    return () => {
      isListeningSessionRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (maxListenTimerRef.current) clearTimeout(maxListenTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
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
      if (caps.elevenLabsStatus === 'ready' || caps.elevenLabsStatus === 'premade_fallback_active') {
        setLastFallbackReason(null);
      }
      if (caps.elevenLabsStatus === 'premade_fallback_active') {
        setUsedPremadeFallback(true);
        if (caps.activeVoiceLabel) setLastVoiceLabel(caps.activeVoiceLabel);
      }
    }
  }, []);

  useEffect(() => {
    if (overlayOpen) {
      void refreshVoiceCaps();
    }
  }, [overlayOpen, refreshVoiceCaps]);

  const speakReply = useCallback(
    async (replyText: string, options?: { forceRefresh?: boolean }) => {
      if (!replyText.trim()) {
        setPhase('idle');
        return;
      }
      if (mutedRef.current) {
        setPhase('idle');
        return;
      }
      setPhase('speaking');
      try {
        const result = await speakNaturalMarathi(replyText, {
          muted: mutedRef.current,
          forceRefresh: options?.forceRefresh,
          onStart: (p, meta?: SpeechPlaybackMeta) => {
            setTtsBadge(p);
            setLastFallbackReason(null);
            setUsedPremadeFallback(Boolean(meta?.usedPremadeFallback));
            setLastVoiceLabel(meta?.voiceLabel || '');
          },
          onUnavailable: (reason) => {
            setTtsBadge(null);
            setLastFallbackReason(reason);
            setUsedPremadeFallback(false);
          },
        });
        if (result === 'elevenlabs') {
          setTtsBadge('elevenlabs');
        }
      } catch {
        // Strict ElevenLabs-only: never fall back to robotic browser voice
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
    try {
      await speakReply(
        'नमस्कार! मी मुक्ताई, तुमची मराठी व्हॉइस असिस्टंट. सांगा, मी तुमची काय मदत करू शकते?',
        {
          forceRefresh: true,
        },
      );
      await refreshVoiceCaps();
    } finally {
      setTestingVoice(false);
    }
  }, [phase, refreshVoiceCaps, speakReply, testingVoice]);

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
        let workingHistory = [...nextHistory];
        let finalReplyText = '';
        let stepCounter = 0;
        let pinnedModel: string | undefined;

        for (let step = 0; step < MAX_TOOL_LOOPS; step += 1) {
          const resp = await callVoiceConverseApi({
            contents: workingHistory,
            context: buildCtx(),
            ...(pinnedModel ? { preferredModel: pinnedModel } : {}),
          });
          if (resp.usedModel) {
            pinnedModel = resp.usedModel;
          }

          if (resp.modelContent) {
            workingHistory.push(resp.modelContent);
          }

          if (!resp.functionCalls || resp.functionCalls.length === 0) {
            finalReplyText =
              resp.text ||
              'तुम्ही दिलेला टास्क मी पूर्ण केला आहे. आणखी काही मदत हवी असेल तर सांगा, मी तयार आहे.';
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

            const cleanResponseObj = JSON.parse(JSON.stringify(toolResult)) as Record<string, unknown>;
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
          finalReplyText = 'तुम्ही दिलेला टास्क पूर्ण झाला आहे.';
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
        // Avoid triggering another Gemini TTS call when quota is already rate-limited
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
    if (maxListenTimerRef.current) {
      clearTimeout(maxListenTimerRef.current);
      maxListenTimerRef.current = null;
    }
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
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
        const safeTimeout = setTimeout(() => resolve(), 600);
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

    // Priority 1: High-accuracy Gemini Marathi/Minglish audio transcription on recorded audio
    // (dramatically more accurate than browser mr-IN for numbers, branches, and mixed English terms)
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
          // Gracefully fall back to live browser transcript below if audio transcribe fails
        }
      }
    }

    // Priority 2: Accumulated continuous live browser speech transcript
    if (capturedLiveSpeech) {
      await processUserCommand(capturedLiveSpeech);
      return;
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
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      silenceTimerRef.current = setTimeout(() => {
        if (isListeningSessionRef.current) {
          void stopListeningAndProcess();
        }
      }, SILENCE_AUTO_SUBMIT_MS);
    };

    // Safety cap so mic never stays open forever
    maxListenTimerRef.current = setTimeout(() => {
      if (isListeningSessionRef.current) {
        void stopListeningAndProcess();
      }
    }, MAX_LISTEN_DURATION_MS);

    // 1. Start continuous browser SpeechRecognition for live Marathi caption + smart silence detection
    const SpeechCtor = getSpeechRecognitionCtor();
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
            // Reset 2.6s silence timer on every word so mid-sentence pauses NEVER cut off the user
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
          // Ignore transient 'no-speech' / 'aborted' / 'network' errors while recording continues
        };

        recognition.onend = () => {
          if (!isListeningSessionRef.current) return;
          // Preserve spoken words and seamlessly restart Chrome SpeechRecognition if it paused mid-sentence
          if (currentSessionTextRef.current) {
            accumulatedSegmentsRef.current.push(currentSessionTextRef.current);
            currentSessionTextRef.current = '';
          }
          restartTimerRef.current = setTimeout(() => {
            if (isListeningSessionRef.current) {
              launchRecognition();
            }
          }, 120);
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch {
        // MediaRecorder below still captures full HD audio cleanly
      }
    };

    launchRecognition();

    // 2. Simultaneously record clean noise-suppressed audio in parallel for studio-grade Marathi/Minglish transcription
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
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
          if (now - lastWakeTriggerAtRef.current < 1800) return;
          lastWakeTriggerAtRef.current = now;

          stopWakeWordListener();
          playWakeActivationChime();
          unlockVoiceAudioPlayback();

          if (match.commandText && match.commandText.length >= 4) {
            // Inline command spoken right after "हे मुक्ताई" (wait briefly if still interim)
            const lastRes = event.results[event.results.length - 1];
            if (lastRes?.isFinal || match.commandText.split(/\s+/).length >= 3) {
              void processUserCommand(match.commandText);
              return;
            }
          }
          void startListening();
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
                          ? `बोलत आहे${
                              ttsBadge === 'elevenlabs'
                                ? ` · ElevenLabs${lastVoiceLabel ? ` (${lastVoiceLabel})` : ''}`
                                : ''
                            }`
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
              {/* Compact Voice Engine Readiness & 1-Click Voice Test Strip */}
              {voiceCaps && (
                <div
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] ${
                    voiceCaps.elevenLabsConfigured && !lastFallbackReason
                      ? 'bg-emerald-50/90 border-emerald-200/80 text-emerald-950'
                      : 'bg-amber-50/90 border-amber-200/90 text-amber-950'
                  }`}
                  title={
                    voiceCaps.elevenLabsStatus === 'premade_fallback_active' || usedPremadeFallback
                      ? 'तुमचा Custom Library Voice Free Plan वर बंद असल्याने मोफत Premade महिला आवाज आपोआप सुरू आहे.'
                      : undefined
                  }
                >
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        voiceCaps.elevenLabsConfigured && !lastFallbackReason
                          ? 'bg-emerald-600'
                          : 'bg-amber-500'
                      }`}
                    />
                    <span className="truncate font-medium">
                      {voiceCaps.elevenLabsConfigured && !lastFallbackReason
                        ? voiceCaps.elevenLabsStatus === 'premade_fallback_active' ||
                          usedPremadeFallback
                          ? `ElevenLabs (${lastVoiceLabel || voiceCaps.activeVoiceLabel || 'Sarah'} · मोफत महिला आवाज)`
                          : `ElevenLabs (${voiceCaps.activeVoiceLabel || voiceCaps.elevenLabsModelId}) · ID …${voiceCaps.elevenLabsVoiceId.slice(-4)}`
                        : (lastFallbackReason || voiceCaps.elevenLabsStatus) === 'invalid_key_format'
                          ? 'ElevenLabs Key चुकीची (sk_... हवी) · आवाज बंद'
                          : (lastFallbackReason || voiceCaps.elevenLabsStatus) === 'auth_rejected'
                            ? 'ElevenLabs Key नाकारली · आवाज बंद'
                            : (lastFallbackReason || voiceCaps.elevenLabsStatus) ===
                                'free_tier_ip_blocked'
                              ? 'Render IP वर ElevenLabs फ्री ब्लॉक · आवाज बंद'
                              : (lastFallbackReason || voiceCaps.elevenLabsStatus) ===
                                  'quota_cooldown'
                                ? 'ElevenLabs क्रेडिट्स संपले · आवाज बंद'
                                : 'ElevenLabs Key सेट नाही · आवाज बंद'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={testingVoice || phase === 'processing'}
                    onClick={() => void handleTestVoice()}
                    className="shrink-0 h-6 px-2 rounded-md bg-white/90 hover:bg-white border border-slate-200/90 text-[#0F1F3D] text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60"
                    title="ElevenLabs मराठी महिला आवाज लगेच तपासा"
                  >
                    {testingVoice ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Volume2 className="w-3 h-3" />
                    )}
                    <span>आवाज तपासा</span>
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
