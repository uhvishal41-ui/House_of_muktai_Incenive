export function formatINRFromPaise(paise: number): string {
  const rupees = (paise || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function formatRupeesPlain(paise: number): string {
  return ((paise || 0) / 100).toFixed(2);
}

export function parseAmountToPaise(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) return null;
    return Math.round(val * 100);
  }
  const cleaned = String(val)
    .replace(/[₹,\s]/g, '')
    .trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function parseOptionalAmountToPaise(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'string' && val.trim() === '') return 0;
  return parseAmountToPaise(val);
}

export function parseOptionalQty(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) return null;
    return Math.round(val * 100) / 100;
  }
  const cleaned = String(val).replace(/[,\s]/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

export function formatQty(qty: number | undefined | null): string {
  const safe = qty || 0;
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(safe);
}

export function normalizeBusinessDate(val: string | number | null | undefined): string | null {
  if (val === null || val === undefined) return null;

  if (typeof val === 'number' && val > 20000 && val < 80000) {
    // Excel serial date number (1900 epoch)
    const utcMs = Math.round((val - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // DD/MM/YYYY or DD-MM-YYYY (common in India)
  const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(parsed);
  }

  return null;
}

export function getTodayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function getCurrentMonthKeyIST(): string {
  return getTodayIST().slice(0, 7);
}

export function getPreviousMonthKey(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  let y = Number(yStr);
  let m = Number(mStr) - 1;
  if (m <= 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const d = new Date(Number(yStr), Number(mStr) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function formatShortDate(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function sanitizeId(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_');
}

export function generateRecordId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}_${Date.now()}_${rand}`;
}
