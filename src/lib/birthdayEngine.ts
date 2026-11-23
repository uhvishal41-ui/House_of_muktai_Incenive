import type { BirthdayProfile, Employee } from '../types/incentive';
import { sanitizeId } from './format';

export interface IstDateParts {
  year: number;
  month: number;
  day: number;
  monthDay: string; // MM-DD
  isoDate: string; // YYYY-MM-DD
}

const MONTH_SHORT_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_SHORT_MR = [
  'जाने', 'फेब्रु', 'मार्च', 'एप्रिल', 'मे', 'जून',
  'जुलै', 'ऑगस्ट', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें',
];

export const BIRTHDAY_WISH_PRESETS: Array<{ id: string; lang: 'en' | 'mr'; text: string }> = [
  {
    id: 'mr_1',
    lang: 'mr',
    text: 'वाढदिवसाच्या मनःपूर्वक शुभेच्छा! तुम्हाला उत्तम आरोग्य, आनंद आणि भरघोस यश लाभो.',
  },
  {
    id: 'mr_2',
    lang: 'mr',
    text: 'हाऊस ऑफ मुक्ताई परिवाराकडून वाढदिवसाच्या खूप खूप शुभेच्छा! नववर्ष सुख-समृद्धीचे जावो.',
  },
  {
    id: 'en_1',
    lang: 'en',
    text: 'Happy Birthday! Wishing you good health, happiness, and great success ahead.',
  },
  {
    id: 'en_2',
    lang: 'en',
    text: 'Many many happy returns of the day! Have a joyful and memorable birthday.',
  },
];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Returns the current date components strictly in Asia/Kolkata (IST).
 */
export function getTodayIstParts(now: Date = new Date()): IstDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value || '2026');
  const month = Number(parts.find((p) => p.type === 'month')?.value || '1');
  const day = Number(parts.find((p) => p.type === 'day')?.value || '1');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    year,
    month,
    day,
    monthDay: `${mm}-${dd}`,
    isoDate: `${year}-${mm}-${dd}`,
  };
}

/**
 * Normalizes a Date of Birth input (YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, Excel Date)
 * into strict ISO YYYY-MM-DD or returns '' if empty / invalid.
 */
export function parseDobToIso(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const parts = getTodayIstParts(raw);
    if (parts.year < 1940 || parts.year > 2015) return '';
    return parts.isoDate;
  }

  const text = String(raw).trim();
  if (!text) return '';

  let year = 0;
  let month = 0;
  let day = 0;

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    // DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
    const dmyMatch = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmyMatch) {
      day = Number(dmyMatch[1]);
      month = Number(dmyMatch[2]);
      year = Number(dmyMatch[3]);
    } else {
      return '';
    }
  }

  if (year < 1940 || year > 2015) return '';
  if (month < 1 || month > 12) return '';
  const maxDay = getDaysInMonth(year, month);
  if (day < 1 || day > maxDay) return '';

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Extracts privacy-safe MM-DD + numeric month/day from an ISO YYYY-MM-DD date or MM-DD string.
 */
export function extractMonthDayFromDob(
  dob?: string | null,
): { birthMonthDay: string; birthMonth: number; birthDay: number } | null {
  const clean = (dob || '').trim();
  if (!clean) return null;

  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > getDaysInMonth(year, month)) return null;
    return {
      birthMonthDay: `${isoMatch[2]}-${isoMatch[3]}`,
      birthMonth: month,
      birthDay: day,
    };
  }

  const mdMatch = clean.match(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/);
  if (mdMatch) {
    const month = Number(mdMatch[1]);
    const day = Number(mdMatch[2]);
    if (day > getDaysInMonth(2024, month)) return null;
    return {
      birthMonthDay: clean,
      birthMonth: month,
      birthDay: day,
    };
  }

  return null;
}

/**
 * Returns true if the employee's birthday falls on today's IST date.
 * Handles Feb 29 leap-year birthdays on Feb 28 in non-leap years.
 */
export function isBirthdayToday(dobOrMonthDay: string | undefined | null, now: Date = new Date()): boolean {
  const extracted = extractMonthDayFromDob(dobOrMonthDay);
  if (!extracted) return false;
  const today = getTodayIstParts(now);
  if (extracted.birthMonthDay === today.monthDay) return true;
  if (extracted.birthMonthDay === '02-29' && !isLeapYear(today.year) && today.monthDay === '02-28') {
    return true;
  }
  return false;
}

/**
 * Computes exact days remaining (0 = today, 1..365 = upcoming) in Asia/Kolkata calendar days.
 */
export function daysUntilNextBirthday(birthMonthDay: string, now: Date = new Date()): number {
  const extracted = extractMonthDayFromDob(birthMonthDay);
  if (!extracted) return 999;

  const today = getTodayIstParts(now);
  if (isBirthdayToday(extracted.birthMonthDay, now)) return 0;

  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);

  const resolveCelebrationUtc = (targetYear: number): number => {
    const day =
      extracted.birthMonth === 2 && extracted.birthDay === 29 && !isLeapYear(targetYear)
        ? 28
        : extracted.birthDay;
    return Date.UTC(targetYear, extracted.birthMonth - 1, day);
  };

  let targetUtc = resolveCelebrationUtc(today.year);
  if (targetUtc < todayUtc) {
    targetUtc = resolveCelebrationUtc(today.year + 1);
  }

  return Math.round((targetUtc - todayUtc) / 86400000);
}

/**
 * Builds a privacy-isolated BirthdayProfile document from an Employee record.
 * Strictly strips birth year, phone, PAN, bank, email, and salary fields.
 * Returns null if employee is INACTIVE or has no valid DOB.
 */
export function buildBirthdayProfileFromEmployee(
  emp: Employee,
  updatedAt: string = new Date().toISOString(),
): BirthdayProfile | null {
  if (emp.status !== 'ACTIVE') return null;
  const extracted = extractMonthDayFromDob(emp.dateOfBirth);
  if (!extracted) return null;

  return {
    employeeId: sanitizeId(emp.employeeId).slice(0, 64),
    fullName: emp.fullName.trim().slice(0, 120),
    branchId: emp.branchId,
    branchName: emp.branchName.trim().slice(0, 120),
    ...(emp.departmentId ? { departmentId: emp.departmentId } : {}),
    ...(emp.departmentName ? { departmentName: emp.departmentName.trim().slice(0, 80) } : {}),
    designation: (emp.designation || 'Sales Executive').trim().slice(0, 80),
    ...(emp.photoDataUrl?.trim() ? { photoDataUrl: emp.photoDataUrl.trim().slice(0, 45000) } : {}),
    birthMonthDay: extracted.birthMonthDay,
    birthMonth: extracted.birthMonth,
    birthDay: extracted.birthDay,
    active: true,
    updatedAt,
  };
}

/**
 * Deterministic ID enforcing max 1 birthday wish per sender per recipient per calendar year.
 */
export function buildDeterministicWishId(
  celebrationYear: number,
  recipientEmployeeId: string,
  senderEmployeeId: string,
): string {
  const safeRecipient = sanitizeId(recipientEmployeeId).slice(0, 48);
  const safeSender = sanitizeId(senderEmployeeId).slice(0, 48);
  return `${celebrationYear}__${safeRecipient}__${safeSender}`;
}

export interface UpcomingBirthdayProfile extends BirthdayProfile {
  daysUntil: number;
}

/**
 * Splits active birthday profiles into Today's Birthdays and Upcoming Birthdays (within windowDays).
 */
export function partitionBirthdays(
  profiles: BirthdayProfile[],
  now: Date = new Date(),
  upcomingWindowDays = 7,
): {
  today: BirthdayProfile[];
  upcoming: UpcomingBirthdayProfile[];
} {
  const today: BirthdayProfile[] = [];
  const upcoming: UpcomingBirthdayProfile[] = [];

  for (const profile of profiles) {
    if (!profile.active) continue;
    const days = daysUntilNextBirthday(profile.birthMonthDay, now);
    if (days === 0) {
      today.push(profile);
    } else if (days > 0 && days <= upcomingWindowDays) {
      upcoming.push({ ...profile, daysUntil: days });
    }
  }

  today.sort((a, b) => {
    const branchCmp = a.branchName.localeCompare(b.branchName);
    return branchCmp !== 0 ? branchCmp : a.fullName.localeCompare(b.fullName);
  });

  upcoming.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    const branchCmp = a.branchName.localeCompare(b.branchName);
    return branchCmp !== 0 ? branchCmp : a.fullName.localeCompare(b.fullName);
  });

  return { today, upcoming };
}

export function formatBirthMonthDayLabel(monthDay: string, lang: 'en' | 'mr' = 'en'): string {
  const extracted = extractMonthDayFromDob(monthDay);
  if (!extracted) return monthDay;
  const monthNames = lang === 'mr' ? MONTH_SHORT_MR : MONTH_SHORT_EN;
  return `${extracted.birthDay} ${monthNames[extracted.birthMonth - 1] || ''}`.trim();
}

// =========================================================================
// BULK DATE-OF-BIRTH (DOB) CSV / EXCEL PARSER FOR ADMIN MASTER
// =========================================================================

export interface BulkDobParseRow {
  rowNumber: number;
  employeeId: string;
  employeeName: string;
  branchName: string;
  rawDob: string;
  normalizedDob: string;
  status: 'VALID' | 'ERROR';
  errorMessage?: string;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function buildBulkDobCsvTemplate(employees: Employee[]): string {
  const header = 'Employee ID,Employee Name,Branch,Date of Birth (YYYY-MM-DD)';
  const rows = [...employees]
    .filter((e) => e.status === 'ACTIVE')
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.fullName.localeCompare(b.fullName))
    .map((e) => {
      const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      return [
        esc(e.employeeId),
        esc(e.fullName),
        esc(e.branchName),
        esc(e.dateOfBirth || ''),
      ].join(',');
    });
  return [header, ...rows].join('\n');
}

export function parseBulkDobRows(
  rows: Array<Record<string, unknown>>,
  employees: Employee[],
): BulkDobParseRow[] {
  const empById = new Map<string, Employee>();
  const empByLogin = new Map<string, Employee>();
  for (const e of employees) {
    empById.set(e.employeeId.trim().toUpperCase(), e);
    empByLogin.set(e.loginId.trim().toUpperCase(), e);
  }

  const parsed: BulkDobParseRow[] = [];

  rows.forEach((rawRow, idx) => {
    const normMap = new Map<string, unknown>();
    for (const [k, v] of Object.entries(rawRow)) {
      normMap.set(normalizeHeader(k), v);
    }

    const pick = (keys: string[]): unknown => {
      for (const k of keys) {
        if (normMap.has(k) && normMap.get(k) !== undefined && String(normMap.get(k)).trim() !== '') {
          return normMap.get(k);
        }
      }
      for (const [nk, nv] of normMap.entries()) {
        if (nv === undefined || String(nv).trim() === '') continue;
        if (keys.some((k) => k.length >= 4 && nk.includes(k))) return nv;
      }
      return '';
    };

    const rawEmpId = String(
      pick(['employeeid', 'empid', 'salesmanno', 'salesmanid', 'loginid', 'code']),
    ).trim();
    const rawDobVal = pick(['dateofbirth', 'dob', 'birthdate', 'birthday']);
    const rawDobStr = rawDobVal instanceof Date ? parseDobToIso(rawDobVal) : String(rawDobVal || '').trim();

    if (!rawEmpId && !rawDobStr) return;

    const cleanKey = rawEmpId.toUpperCase();
    const matched =
      empById.get(cleanKey) ||
      empByLogin.get(cleanKey) ||
      empById.get(cleanKey.replace(/^HOM/, ''));

    if (!matched) {
      parsed.push({
        rowNumber: idx + 2,
        employeeId: rawEmpId || '—',
        employeeName: String(pick(['employeename', 'fullname', 'name']) || 'Unknown'),
        branchName: String(pick(['branch', 'branchname']) || '—'),
        rawDob: rawDobStr,
        normalizedDob: '',
        status: 'ERROR',
        errorMessage: `Employee ID "${rawEmpId}" not found in Employee Master.`,
      });
      return;
    }

    if (!rawDobStr) {
      return; // Skip rows where HR left DOB blank in template
    }

    const normalizedDob = parseDobToIso(rawDobVal);
    if (!normalizedDob) {
      parsed.push({
        rowNumber: idx + 2,
        employeeId: matched.employeeId,
        employeeName: matched.fullName,
        branchName: matched.branchName,
        rawDob: rawDobStr,
        normalizedDob: '',
        status: 'ERROR',
        errorMessage: `Invalid Date of Birth "${rawDobStr}". Use YYYY-MM-DD or DD-MM-YYYY (year 1940–2015).`,
      });
      return;
    }

    parsed.push({
      rowNumber: idx + 2,
      employeeId: matched.employeeId,
      employeeName: matched.fullName,
      branchName: matched.branchName,
      rawDob: rawDobStr,
      normalizedDob,
      status: 'VALID',
    });
  });

  return parsed;
}

export function parseBulkDobCsvText(csvText: string, employees: Employee[]): BulkDobParseRow[] {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const cols = parseCsvLine(lines[i]).map(normalizeHeader);
    if (
      cols.some((c) => c.includes('employee') || c.includes('salesman') || c === 'empid') &&
      cols.some((c) => c.includes('birth') || c === 'dob')
    ) {
      headerIdx = i;
      break;
    }
  }

  const headers = parseCsvLine(lines[headerIdx]);
  const objects: Array<Record<string, unknown>> = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = cells[idx] ?? '';
    });
    objects.push(row);
  }
  return parseBulkDobRows(objects, employees);
}
