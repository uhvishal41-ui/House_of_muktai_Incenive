export interface WakeWordMatch {
  triggered: boolean;
  wakePhrase: string;
  commandText: string;
}

export interface VoiceExecutionStep {
  id: string;
  toolName: string;
  labelMr: string;
  status: 'running' | 'done' | 'error';
  detailMr?: string;
}

export interface VoiceWhatsAppRecipientItem {
  employeeId: string;
  employeeName: string;
  branchName: string;
  phone: string;
  hasPhone: boolean;
  monthLabel: string;
  docType: 'SALARY_SLIP' | 'INCENTIVE_SUMMARY';
  amountLabel: string;
  waUrl: string;
  messageText: string;
}

export interface VoiceWhatsAppActionCard {
  type: 'whatsapp';
  titleMr: string;
  monthLabel: string;
  items: VoiceWhatsAppRecipientItem[];
  totalMatched: number;
  missingPhoneCount: number;
}

export interface VoiceExecutiveBriefingCard {
  type: 'briefing';
  monthKey: string;
  monthLabel: string;
  branchScopeLabel: string;
  totalSalesLabel: string;
  totalIncentiveLabel: string;
  totalSalaryNetLabel: string;
  costToSalesPct: number;
  pendingPayoutCount: number;
  pendingPayoutLabel: string;
  openQueriesCount: number;
  activeLoansCount: number;
  activeLoansBalanceLabel: string;
  topBranches: Array<{
    branchName: string;
    salesLabel: string;
    incentiveLabel: string;
  }>;
  starPerformers: Array<{
    employeeName: string;
    branchName: string;
    streakMonths: number;
  }>;
  coachingAlertsCount: number;
  highLopCount: number;
}

export type VoiceActionCard = VoiceWhatsAppActionCard | VoiceExecutiveBriefingCard;

const WAKE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'हे मुक्ताई', regex: /(?:^|[\s,।!?])(?:हे|हॅलो|हाय|नमस्कार|ओके|अरे)\s*(?:मुक्ताई|मुकताई|मक्ताई|मुक्ता)(?:[\s,।:!?-]+|$)/i },
  { label: 'मुक्ताई', regex: /(?:^|[\s,।!?])(?:मुक्ताई|मुकताई|मक्ताई)(?:[\s,।:!?-]+|$)/i },
  { label: 'Hey Muktai', regex: /(?:^|[\s,.!?])(?:hey|he|hi|hello|ok|okay|namaskar|are)\s+mukt(?:a?i|ayi|ay|a)(?:[\s,.:!?-]+|$)/i },
  { label: 'Muktai', regex: /(?:^|[\s,.!?])mukt(?:ai|ayi|aai)(?:[\s,.:!?-]+|$)/i },
];

/**
 * Detects Marathi / Hindi / English wake phrases ("हे मुक्ताई", "Hey Muktai", "मुक्ताई")
 * and extracts any inline command spoken right after the wake phrase.
 */
export function extractWakeWordCommand(rawTranscript: string): WakeWordMatch {
  const clean = (rawTranscript || '').trim();
  if (!clean) {
    return { triggered: false, wakePhrase: '', commandText: '' };
  }

  for (const pat of WAKE_PATTERNS) {
    const m = pat.regex.exec(clean);
    if (m) {
      const afterIdx = m.index + m[0].length;
      const commandText = clean
        .slice(afterIdx)
        .replace(/^[\s,।:;\-–—]+/, '')
        .trim();
      return {
        triggered: true,
        wakePhrase: pat.label,
        commandText,
      };
    }
  }

  return { triggered: false, wakePhrase: '', commandText: '' };
}

const MULTI_STEP_CONNECTOR_REGEX =
  /(?:^|[\s,।])(आणि|आणखी|मग|त्यानंतर|नंतर|तसेच|व|सोबतच|त्याचबरोबर|and|then|also|after\s+that|plus|aur|phir|ani|mag)(?:[\s,।]|$)/i;

/**
 * Returns true when a user utterance likely contains chained multi-step instructions
 * (e.g. "धाराशिव शाखेचे पेआउट PAID करा आणि रिपोर्ट डाउनलोड करा") so the voice loop
 * never short-circuits before Gemini runs every chained tool.
 */
export function isMultiStepVoiceCommand(utterance: string): boolean {
  const clean = (utterance || '').trim();
  if (!clean) return false;
  if (clean.includes('+') || clean.includes('&') || clean.includes(';')) return true;
  return MULTI_STEP_CONNECTOR_REGEX.test(clean);
}

export function describeVoiceToolStepMr(toolName: string, args: Record<string, unknown>): string {
  const branch = typeof args.branch === 'string' && args.branch.trim() ? ` (${args.branch.trim()})` : '';
  const emp =
    typeof args.employeeIdentifier === 'string' && args.employeeIdentifier.trim()
      ? ` (${args.employeeIdentifier.trim()})`
      : typeof args.query === 'string' && args.query.trim()
        ? ` (${args.query.trim()})`
        : '';

  switch (toolName) {
    case 'navigate_to_section':
      return 'विभाग उघडणे';
    case 'filter_workspace':
      return `टेबल फिल्टर लागू करणे${branch}`;
    case 'search_employees':
      return `कर्मचारी माहिती शोधणे${emp || branch}`;
    case 'add_employee':
      return 'नवीन कर्मचारी नोंदणी';
    case 'update_employee':
      return `कर्मचारी माहिती अपडेट${emp}`;
    case 'delete_employee':
      return `कर्मचारी डिलीट पडताळणी${emp}`;
    case 'manage_incentive_adjustment':
      return `इन्सेंटिव्ह अ‍ॅडजस्टमेंट${emp}`;
    case 'manage_payout_status':
      return `पेआउट स्टेटस अपडेट${branch || emp}`;
    case 'manage_salary_slip':
      return `सॅलरी स्लिप अपडेट${emp || branch}`;
    case 'manage_incentive_batches_and_months':
      return 'इन्सेंटिव्ह बॅच/महिना व्यवस्थापन';
    case 'upload_excel_from_local_folder':
      return 'लोकल फोल्डरमधून एक्सेल अपलोड';
    case 'manage_branches_targets_loans':
      return 'शाखा / टार्गेट / लोन व्यवस्थापन';
    case 'get_analytics_summary':
      return `आकडेवारी विश्लेषण${branch}`;
    case 'download_report':
      return `रिपोर्ट डाउनलोड${branch || emp}`;
    case 'prepare_whatsapp_dispatch':
      return `WhatsApp स्लिप तयार करणे${emp || branch}`;
    case 'get_executive_briefing':
      return `मॅनेजमेंट बिझनेस ब्रीफिंग${branch}`;
    default:
      return 'कमांड पूर्ण करणे';
  }
}

/**
 * Plays a gentle, crisp two-tone Web Audio chime when "हे मुक्ताई" wakes up.
 */
export function playWakeActivationChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.075, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.01);
    };

    playTone(587.33, 0, 0.11); // D5
    playTone(880.0, 0.09, 0.15); // A5

    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 350);
  } catch {
    // ignore Web Audio restrictions if gesture not yet received
  }
}
