export interface LinkedFolderFileEntry {
  name: string;
  relativePath: string;
  extension: 'xlsx' | 'csv';
  getFile: () => Promise<File>;
}

export interface LinkedLocalFolderState {
  linked: boolean;
  folderName: string;
  mode: 'fs-access' | 'directory-input' | 'none';
  directoryHandle?: FileSystemDirectoryHandle;
  files: LinkedFolderFileEntry[];
  linkedAt: string;
}

export const EMPTY_LINKED_FOLDER: LinkedLocalFolderState = {
  linked: false,
  folderName: '',
  mode: 'none',
  files: [],
  linkedAt: '',
};

interface DirectoryHandleWithEntries {
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

function getSpreadsheetExtension(fileName: string): 'xlsx' | 'csv' | null {
  const lower = fileName.trim().toLowerCase();
  if (!lower || lower.startsWith('~$') || lower.startsWith('.')) return null;
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv')) return 'csv';
  return null;
}

async function scanDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  prefix = '',
  depth = 0,
): Promise<LinkedFolderFileEntry[]> {
  const out: LinkedFolderFileEntry[] = [];
  const iterable = handle as unknown as DirectoryHandleWithEntries;
  if (typeof iterable.entries !== 'function') return out;

  for await (const [entryName, entryHandle] of iterable.entries()) {
    if (out.length >= 250) break;
    if (entryHandle.kind === 'file') {
      const ext = getSpreadsheetExtension(entryName);
      if (!ext) continue;
      const fileHandle = entryHandle as FileSystemFileHandle;
      out.push({
        name: entryName,
        relativePath: prefix ? `${prefix}/${entryName}` : entryName,
        extension: ext,
        getFile: () => fileHandle.getFile(),
      });
    } else if (entryHandle.kind === 'directory' && depth < 1) {
      // Scan 1 subfolder deep (e.g., Desktop/Incentives/...) without crawling huge trees
      const lowerDir = entryName.toLowerCase();
      if (lowerDir === 'node_modules' || lowerDir.startsWith('.')) continue;
      try {
        const nested = await scanDirectoryHandle(
          entryHandle as FileSystemDirectoryHandle,
          prefix ? `${prefix}/${entryName}` : entryName,
          depth + 1,
        );
        out.push(...nested);
      } catch {
        // Ignore unreadable subfolder
      }
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function refreshLinkedDirectoryHandle(
  state: LinkedLocalFolderState,
): Promise<LinkedLocalFolderState> {
  if (state.mode !== 'fs-access' || !state.directoryHandle) {
    return state;
  }
  const files = await scanDirectoryHandle(state.directoryHandle);
  return {
    ...state,
    files,
    linkedAt: new Date().toISOString(),
  };
}

export function buildLinkedFolderFromFileList(fileList: FileList | File[]): LinkedLocalFolderState {
  const arr = Array.from(fileList);
  const entries: LinkedFolderFileEntry[] = [];
  let folderName = 'Linked Folder';

  for (const file of arr) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (folderName === 'Linked Folder' && rel.includes('/')) {
      folderName = rel.split('/')[0] || 'Linked Folder';
    }
    const ext = getSpreadsheetExtension(file.name);
    if (!ext) continue;
    entries.push({
      name: file.name,
      relativePath: rel,
      extension: ext,
      getFile: async () => file,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    linked: true,
    folderName,
    mode: 'directory-input',
    files: entries,
    linkedAt: new Date().toISOString(),
  };
}

export type FolderLinkResult =
  | { status: 'LINKED'; state: LinkedLocalFolderState }
  | { status: 'CANCELLED' }
  | { status: 'NEEDS_FALLBACK_INPUT'; reason: string };

export async function requestLocalFolderAccess(): Promise<FolderLinkResult> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;

  if (typeof picker !== 'function') {
    return {
      status: 'NEEDS_FALLBACK_INPUT',
      reason: 'Browser does not expose showDirectoryPicker; using folder file input.',
    };
  }

  try {
    const handle = await picker({ mode: 'read' });
    const files = await scanDirectoryHandle(handle);
    return {
      status: 'LINKED',
      state: {
        linked: true,
        folderName: handle.name || 'Local Folder',
        mode: 'fs-access',
        directoryHandle: handle,
        files,
        linkedAt: new Date().toISOString(),
      },
    };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name || '';
    if (name === 'AbortError') {
      return { status: 'CANCELLED' };
    }
    // In cross-origin iframes (like AI Studio preview), Chrome throws SecurityError -> seamlessly use directory input fallback
    return {
      status: 'NEEDS_FALLBACK_INPUT',
      reason: err instanceof Error ? err.message : 'Directory picker blocked in iframe.',
    };
  }
}

const MONTH_TOKEN_SYNONYMS: Record<string, string[]> = {
  jan: ['jan', 'january', '01'],
  feb: ['feb', 'february', '02'],
  mar: ['mar', 'march', '03'],
  apr: ['apr', 'april', '04'],
  may: ['may', '05'],
  jun: ['jun', 'june', '06'],
  jul: ['jul', 'july', '07'],
  aug: ['aug', 'august', '08'],
  sep: ['sep', 'sept', 'september', '09'],
  oct: ['oct', 'october', '10'],
  nov: ['nov', 'november', '11'],
  dec: ['dec', 'december', '12'],
};

function normalizeTokens(raw: string): string[] {
  const cleaned = raw
    .toLowerCase()
    .replace(/\.(xlsx|csv|xls)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter(Boolean);
}

function expandMonthToken(token: string): string[] {
  for (const aliases of Object.values(MONTH_TOKEN_SYNONYMS)) {
    if (aliases.includes(token)) return aliases;
  }
  return [token];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function scoreSpreadsheetFileMatch(query: string, fileName: string): number {
  const normQuery = query
    .toLowerCase()
    .replace(/\.(xlsx|csv|xls)$/i, '')
    .replace(/[^a-z0-9]+/g, '');
  const normFile = fileName
    .toLowerCase()
    .replace(/\.(xlsx|csv|xls)$/i, '')
    .replace(/[^a-z0-9]+/g, '');

  if (!normQuery || !normFile) return 0;
  if (normQuery === normFile) return 1.0;

  let score = 0;
  if (normFile.includes(normQuery)) {
    score = Math.max(score, 0.86 + 0.1 * (normQuery.length / normFile.length));
  } else if (normQuery.includes(normFile) && normFile.length >= 4) {
    score = Math.max(score, 0.78);
  }

  const qTokens = normalizeTokens(query);
  const fTokens = normalizeTokens(fileName);
  if (qTokens.length > 0 && fTokens.length > 0) {
    let matchedWeight = 0;
    for (const qt of qTokens) {
      const expanded = expandMonthToken(qt);
      let bestTokenScore = 0;
      for (const ft of fTokens) {
        if (expanded.includes(ft)) {
          bestTokenScore = 1;
          break;
        }
        if (ft.includes(qt) || (qt.length >= 3 && qt.includes(ft) && ft.length >= 3)) {
          bestTokenScore = Math.max(bestTokenScore, 0.85);
        } else {
          const maxLen = Math.max(qt.length, ft.length);
          const dist = levenshtein(qt, ft);
          if (maxLen >= 4 && dist <= 1) {
            bestTokenScore = Math.max(bestTokenScore, 0.8);
          } else if (maxLen >= 6 && dist <= 2) {
            bestTokenScore = Math.max(bestTokenScore, 0.65);
          }
        }
      }
      matchedWeight += bestTokenScore;
    }
    const tokenScore = matchedWeight / qTokens.length;
    score = Math.max(score, tokenScore * 0.92);
  }

  const maxCompact = Math.max(normQuery.length, normFile.length);
  if (maxCompact > 0) {
    const editSim = 1 - levenshtein(normQuery, normFile) / maxCompact;
    if (editSim > 0.62) {
      score = Math.max(score, editSim * 0.85);
    }
  }

  return Math.round(score * 1000) / 1000;
}

export type SpreadsheetMatchResult =
  | {
      status: 'MATCHED';
      entry: LinkedFolderFileEntry;
      score: number;
      suggestions: string[];
    }
  | {
      status: 'AMBIGUOUS';
      candidates: Array<{ entry: LinkedFolderFileEntry; score: number }>;
    }
  | {
      status: 'NOT_FOUND';
      suggestions: string[];
    };

export function findBestMatchingSpreadsheetFile(
  query: string,
  files: LinkedFolderFileEntry[],
): SpreadsheetMatchResult {
  if (files.length === 0) {
    return { status: 'NOT_FOUND', suggestions: [] };
  }

  const scored = files
    .map((entry) => ({
      entry,
      score: scoreSpreadsheetFileMatch(query, entry.name),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];

  if (!top || top.score < 0.42) {
    return {
      status: 'NOT_FOUND',
      suggestions: scored.slice(0, 6).map((s) => s.entry.name),
    };
  }

  if (
    second &&
    second.score >= 0.65 &&
    top.score < 0.98 &&
    top.score - second.score <= 0.06
  ) {
    return {
      status: 'AMBIGUOUS',
      candidates: scored.filter((s) => top.score - s.score <= 0.08).slice(0, 4),
    };
  }

  return {
    status: 'MATCHED',
    entry: top.entry,
    score: top.score,
    suggestions: scored.slice(1, 5).map((s) => s.entry.name),
  };
}
