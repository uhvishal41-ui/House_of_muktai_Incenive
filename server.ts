import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  requireSuperAdmin,
  verifyFirebaseBearerToken,
  type AuthenticatedRequest,
} from './server/authMiddleware.ts';
import {
  buildDateColumnTemplateWorkbook,
  buildErrorReportWorkbook,
  buildManagementReportWorkbook,
  formatDateIST,
  parseExcelBuffer,
} from './server/excelEngine.ts';
import {
  ElevenLabsSpeechError,
  getVoiceCapabilitiesStatus,
  openMarathiSpeechStream,
  runMarathiVoiceTurn,
  synthesizeMarathiSpeech,
  transcribeMarathiVoiceAudio,
} from './server/voiceService.ts';
import type { VoiceWorkspaceContext } from './server/voiceTools.ts';
import type { Content } from '@google/genai';
import {
  authorizeEmployeeStatusChange,
  validateImportBatch,
} from './src/lib/incentiveEngine.ts';
import type {
  Branch,
  Employee,
  ExcelColumnMapping,
  ParsedExcelRow,
  PublishedIncentive,
  RowResolution,
} from './src/types/incentive.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTRA_ENV_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [
  'https://houseofmuktai.co.in',
  'https://www.houseofmuktai.co.in',
  'https://staff.houseofmuktai.co.in',
  'https://admin.houseofmuktai.co.in',
  'https://homfash.com',
  'https://www.homfash.com',
  'https://admin.homfash.com',
  'https://staff.homfash.com',
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:3000',
  process.env.APP_URL || '',
  ...EXTRA_ENV_ORIGINS,
].filter(Boolean);

function isOriginAllowed(origin: string | undefined, requestHost: string | undefined): boolean {
  if (!origin) return true;
  if (requestHost) {
    const normalizedHost = requestHost.toLowerCase();
    if (
      origin.toLowerCase() === `https://${normalizedHost}` ||
      origin.toLowerCase() === `http://${normalizedHost}`
    ) {
      return true;
    }
  }
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (
    origin.startsWith('https://') &&
    (origin.endsWith('.houseofmuktai.co.in') ||
      origin.endsWith('.homfash.com') ||
      origin.endsWith('.onrender.com') ||
      origin.endsWith('.run.app') ||
      origin.endsWith('.pages.dev'))
  ) {
    return true;
  }
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB safety cap for 512MB Render Free RAM
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx') {
      cb(new Error('Only .xlsx Excel workbooks are permitted.'));
      return;
    }
    cb(null, true);
  },
});

const errorReportSchema = z.object({
  rows: z.array(
    z.object({
      rowNumber: z.number().int().min(1),
      businessDate: z.string().max(40),
      employeeId: z.string().max(64),
      branchCode: z.string().max(64),
      component1Rupees: z.string().max(32),
      component2Rupees: z.string().max(32),
      component3Rupees: z.string().max(32),
      validationStatus: z.string().max(40),
      errorMessage: z.string().max(400),
    }),
  ).max(5000),
});

const sampleTemplateSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rows: z.array(
    z.object({
      employeeId: z.string().max(64),
      employeeName: z.string().max(120).optional(),
      branchName: z.string().max(120),
    }),
  ).max(50).optional(),
});

const validateImportSchema = z.object({
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  rawBannerDateText: z.string().max(200).optional(),
  rawTotalRows: z.number().int().min(0),
  skippedBlankRows: z.number().int().min(0),
  skippedSummaryRows: z.number().int().min(0),
  mapping: z.object({
    businessDate: z.string().max(80),
    employeeId: z.string().max(80),
    saleId: z.string().max(80).optional(),
    employeeName: z.string().max(80),
    branchCode: z.string().max(80),
    component1: z.string().max(80),
    component2: z.string().max(80),
    component3: z.string().max(80),
    saleAmt1: z.string().max(80).optional(),
    saleQty1: z.string().max(80).optional(),
    saleAmt2: z.string().max(80).optional(),
    saleQty2: z.string().max(80).optional(),
    saleAmt3: z.string().max(80).optional(),
    saleQty3: z.string().max(80).optional(),
  }),
  rows: z
    .array(
      z
        .object({
          rowNumber: z.number().int().min(1),
          raw: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        })
        .passthrough(),
    )
    .max(5000),
  branches: z
    .array(
      z
        .object({
          branchId: z.string().min(1).max(64),
          branchCode: z.string().min(1).max(24),
          branchName: z.string().min(1).max(120),
        })
        .passthrough(),
    )
    .max(500),
  employees: z
    .array(
      z
        .object({
          employeeId: z.string().min(1).max(64),
          fullName: z.string().min(1).max(120),
          branchId: z.string().min(1).max(64),
        })
        .passthrough(),
    )
    .max(5000),
  publishedIncentives: z
    .array(
      z
        .object({
          recordId: z.string().min(1).max(128),
          employeeId: z.string().min(1).max(64),
          businessDate: z.string().min(1).max(20),
        })
        .passthrough(),
    )
    .max(20000),
  overlapResolutionMode: z.enum(['BLOCK', 'SKIP_OVERLAP', 'RECONCILE_SUPERSEDE']).optional(),
  overlapReconcileReason: z.string().max(240).optional(),
  overrides: z.record(
    z.string(),
    z.object({
      resolution: z.enum(['PUBLISH_NEW', 'SKIP', 'CORRECTION', 'SUPERSEDE_CONFLICTS']),
      correctionReason: z.string().max(240),
    }),
  ).optional(),
});

const statusAuthorizeSchema = z.object({
  employeeId: z.string().min(1).max(64),
  currentStatus: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  targetStatus: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().max(240).optional(),
});

const managementReportSchema = z.object({
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
  monthLabel: z.string().min(1).max(60),
  branchRows: z
    .array(
      z.object({
        branchName: z.string().max(120),
        staffCount: z.number().int().min(0),
        totalSaleAmtRupees: z.number(),
        totalSaleQty: z.number(),
        newItemsIncRupees: z.number(),
        oldItemsIncRupees: z.number(),
        otherItemsIncRupees: z.number(),
        grossIncentiveRupees: z.number(),
        incentivePctOfSale: z.number(),
        adjustmentsNetRupees: z.number(),
        netPayableRupees: z.number(),
        paidCount: z.number().int().min(0),
      }),
    )
    .max(500),
  employeeRows: z
    .array(
      z.object({
        branchName: z.string().max(120),
        employeeId: z.string().max(64),
        employeeName: z.string().max(120),
        saleAmt1Rupees: z.number(),
        saleQty1: z.number(),
        inc1Rupees: z.number(),
        saleAmt2Rupees: z.number(),
        saleQty2: z.number(),
        inc2Rupees: z.number(),
        saleAmt3Rupees: z.number(),
        saleQty3: z.number(),
        inc3Rupees: z.number(),
        totalSaleAmtRupees: z.number(),
        totalSaleQty: z.number(),
        grossIncentiveRupees: z.number(),
        adjustmentsNetRupees: z.number(),
        netPayableRupees: z.number(),
        payoutStatus: z.string().max(24),
        paymentMode: z.string().max(24),
        paymentReference: z.string().max(120),
      }),
    )
    .max(5000),
});

const voiceTranscribeSchema = z.object({
  audioBase64: z.string().min(16).max(5_500_000),
  mimeType: z
    .string()
    .regex(/^audio\/[a-zA-Z0-9.+-]+(;\s*codecs=[a-zA-Z0-9.,_-]+)?$/)
    .max(80),
});

const voiceContextSchema = z.object({
  activeTab: z.string().max(60),
  isMainOwner: z.boolean(),
  actorLabel: z.string().max(200),
  todayIst: z.string().max(24),
  currentMonthKey: z.string().max(16),
  branches: z
    .array(
      z.object({
        branchId: z.string().max(80),
        branchCode: z.string().max(64),
        branchName: z.string().max(160),
      }),
    )
    .max(200),
  departments: z
    .array(
      z.object({
        id: z.string().max(60),
        name: z.string().max(100),
      }),
    )
    .max(50),
  nonSalesDepartments: z.array(z.string().max(100)).max(100),
  employeeCount: z.number().int().min(0),
  activeEmployeeCount: z.number().int().min(0),
  availableIncentiveMonths: z.array(z.string().max(16)).max(60),
  availableSalaryMonths: z.array(z.string().max(16)).max(60),
  lockedMonths: z.array(z.string().max(16)).max(60),
  folderLinked: z.boolean(),
  folderName: z.string().max(200),
  folderFiles: z.array(z.string().max(240)).max(200),
});

const voiceConverseSchema = z.object({
  contents: z.array(z.record(z.string(), z.unknown())).min(1).max(32),
  context: voiceContextSchema,
  preferredModel: z.enum(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']).optional(),
});

const voiceTtsSchema = z.object({
  text: z.string().min(1).max(900),
  forceRefresh: z.boolean().optional(),
});

export function createApiRouter(authMiddleware = verifyFirebaseBearerToken) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      service: 'house-of-muktai-incentive-api',
      timezone: 'Asia/Kolkata',
      businessDateToday: formatDateIST(new Date()),
      ok: true,
    });
  });

  router.post(
    '/excel/parse',
    authMiddleware,
    requireSuperAdmin,
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Please attach a valid .xlsx Excel file.' });
          return;
        }

        // Verify ZIP/XLSX magic header bytes (PK\x03\x04)
        const buf = req.file.buffer;
        if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
          res.status(400).json({ error: 'Uploaded file is not a valid .xlsx workbook.' });
          return;
        }

        const requestedSheet = typeof req.body?.sheetName === 'string' ? req.body.sheetName : undefined;
        const parsed = await parseExcelBuffer(buf, req.file.originalname, requestedSheet);
        res.json(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to parse Excel workbook.';
        res.status(400).json({ error: message });
      }
    },
  );

  // Server-side validation for Daily / Monthly / Custom Period, Overlap & Transfer detection
  router.post(
    '/excel/validate',
    authMiddleware,
    requireSuperAdmin,
    (req: AuthenticatedRequest, res) => {
      try {
        const body = validateImportSchema.parse(req.body ?? {});
        const numericOverrides: Record<
          number,
          { resolution: RowResolution; correctionReason: string }
        > = {};
        if (body.overrides) {
          for (const [k, v] of Object.entries(body.overrides)) {
            const num = Number(k);
            if (Number.isInteger(num)) {
              numericOverrides[num] = v;
            }
          }
        }

        const result = validateImportBatch({
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          rawBannerDateText: body.rawBannerDateText,
          rawTotalRows: body.rawTotalRows,
          skippedBlankRows: body.skippedBlankRows,
          skippedSummaryRows: body.skippedSummaryRows,
          mapping: body.mapping as ExcelColumnMapping,
          rows: body.rows as ParsedExcelRow[],
          branches: body.branches as unknown as Branch[],
          employees: body.employees as unknown as Employee[],
          publishedIncentives: body.publishedIncentives as unknown as PublishedIncentive[],
          overlapResolutionMode: body.overlapResolutionMode,
          overlapReconcileReason: body.overlapReconcileReason,
          overrides: numericOverrides,
        });

        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Excel validation failed.';
        res.status(400).json({ error: message });
      }
    },
  );

  // Backend-enforced Super Admin–only Employee Active/Inactive authorization endpoint
  router.post(
    '/admin/employees/authorize-status-change',
    authMiddleware,
    requireSuperAdmin,
    (req: AuthenticatedRequest, res) => {
      try {
        const body = statusAuthorizeSchema.parse(req.body ?? {});
        const actorRole = req.authUser?.role || 'EMPLOYEE';
        const decision = authorizeEmployeeStatusChange({
          actorRole,
          currentStatus: body.currentStatus,
          targetStatus: body.targetStatus,
        });

        if (!decision.allowed) {
          res.status(decision.statusCode).json({ error: decision.error });
          return;
        }

        res.json({
          authorized: true,
          employeeId: body.employeeId,
          targetStatus: body.targetStatus,
          auditAction: decision.auditAction,
          authorizedByEmail: req.authUser?.email || '',
          authorizedAt: new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Status authorization failed.';
        res.status(400).json({ error: message });
      }
    },
  );

  router.post(
    '/excel/sample-template',
    authMiddleware,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = sampleTemplateSchema.parse(req.body ?? {});
        const startStr = parsed.periodStart || parsed.businessDate || formatDateIST(new Date());
        const endStr = parsed.periodEnd || parsed.businessDate || startStr;
        const baseRows =
          parsed.rows && parsed.rows.length > 0
            ? parsed.rows.map((r, idx) => ({
                branchName: r.branchName.toUpperCase(),
                salesPersonName: r.employeeName || `EMPLOYEE ${r.employeeId}`,
                salesmanNo: r.employeeId,
                saleAmt1: 42000 + idx * 4500,
                saleQty1: 28 + idx * 3,
                component1: 650 + idx * 90,
                saleAmt2: 6500 + idx * 900,
                saleQty2: 5 + idx,
                component2: 45 + idx * 15,
                saleAmt3: 16000 + idx * 4000,
                saleQty3: 11 + idx * 2,
                component3: 80 + idx * 20,
              }))
            : [
                {
                  branchName: 'BARAMATI MIDC',
                  salesPersonName: 'ANITA POPAT SHINGADE',
                  salesmanNo: '459',
                  saleAmt1: 65000,
                  saleQty1: 42,
                  component1: 816,
                  saleAmt2: 4500,
                  saleQty2: 4,
                  component2: 12,
                  saleAmt3: 10200,
                  saleQty3: 8,
                  component3: 51,
                },
                {
                  branchName: 'BARAMATI MOTIBAGH',
                  salesPersonName: 'ASHA ABAJI CHAVAN',
                  salesmanNo: '355',
                  saleAmt1: 124500,
                  saleQty1: 86,
                  component1: 1713,
                  saleAmt2: 18900,
                  saleQty2: 15,
                  component2: 341,
                  saleAmt3: 25000,
                  saleQty3: 19,
                  component3: 125,
                },
                {
                  branchName: 'BEED',
                  salesPersonName: 'AMBRAPALI SHIVAJI VEER',
                  salesmanNo: '2432',
                  saleAmt1: 72400,
                  saleQty1: 51,
                  component1: 984,
                  saleAmt2: 2100,
                  saleQty2: 2,
                  component2: 5,
                  saleAmt3: 6400,
                  saleQty3: 5,
                  component3: 32,
                },
              ];

        const buffer = await buildDateColumnTemplateWorkbook(startStr, baseRows);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="house-of-muktai-incentive-template-${startStr}.xlsx"`,
        );
        res.send(buffer);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate sample template.';
        res.status(400).json({ error: message });
      }
    },
  );

  router.post(
    '/excel/error-report',
    authMiddleware,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = errorReportSchema.parse(req.body);
        const buffer = await buildErrorReportWorkbook(parsed.rows);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="import-validation-report-${formatDateIST(new Date())}.xlsx"`,
        );
        res.send(buffer);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to build error report.';
        res.status(400).json({ error: message });
      }
    },
  );

  router.post(
    '/excel/management-report',
    authMiddleware,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = managementReportSchema.parse(req.body);
        const buffer = await buildManagementReportWorkbook(parsed);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="house-of-muktai-management-report-${parsed.monthKey}.xlsx"`,
        );
        res.send(buffer);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to build management Excel report.';
        res.status(400).json({ error: message });
      }
    },
  );

  // --- MARATHI VOICE ASSISTANT ROUTES (Server-Side Gemini API + Optional ElevenLabs TTS) ---
  router.get(
    '/voice/status',
    authMiddleware,
    requireSuperAdmin,
    (_req: AuthenticatedRequest, res) => {
      res.json(getVoiceCapabilitiesStatus());
    },
  );

  router.post(
    '/voice/transcribe',
    authMiddleware,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = voiceTranscribeSchema.parse(req.body ?? {});
        const result = await transcribeMarathiVoiceAudio({
          audioBase64: parsed.audioBase64,
          mimeType: parsed.mimeType,
        });
        res.json(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to transcribe voice audio.';
        console.error('[Voice Transcribe Error]', message.slice(0, 260));
        res.status(400).json({ error: message });
      }
    },
  );

  router.post(
    '/voice/converse',
    authMiddleware,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = voiceConverseSchema.parse(req.body ?? {});
        const result = await runMarathiVoiceTurn({
          contents: parsed.contents as unknown as Content[],
          context: parsed.context as VoiceWorkspaceContext,
          preferredModel: parsed.preferredModel,
        });
        res.json(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to process voice assistant command.';
        console.error('[Voice Converse Error]', message.slice(0, 320));
        res.status(400).json({ error: message });
      }
    },
  );

  router.post(
    '/voice/tts',
    authMiddleware,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = voiceTtsSchema.parse(req.body ?? {});
        const result = await synthesizeMarathiSpeech(parsed.text, {
          forceRefresh: parsed.forceRefresh,
        });
        res.json(result);
      } catch (err) {
        if (err instanceof ElevenLabsSpeechError) {
          res.status(503).json({
            error: err.message,
            elevenLabsStatus: err.reason,
            elevenLabsOnly: true,
          });
          return;
        }
        const message =
          err instanceof Error ? err.message : 'ElevenLabs speech synthesis unavailable.';
        res.status(503).json({ error: message, elevenLabsOnly: true });
      }
    },
  );

  // Ultra-low-latency streaming MP3 audio proxy (ElevenLabs /stream -> browser chunk-by-chunk)
  router.post(
    '/voice/tts/stream',
    authMiddleware,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = voiceTtsSchema.parse(req.body ?? {});
        const opened = await openMarathiSpeechStream(parsed.text, {
          forceRefresh: parsed.forceRefresh,
        });

        res.status(200);
        res.setHeader('Content-Type', opened.mimeType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=600');
        res.setHeader('X-Voice-Provider', opened.provider);
        res.setHeader('X-Voice-Model', opened.modelUsed);
        res.setHeader('X-Voice-Id', opened.voiceId);
        res.setHeader('X-Voice-Cache', opened.cacheHit ? 'HIT' : 'MISS');

        if (opened.buffer) {
          res.setHeader('Content-Length', String(opened.buffer.byteLength));
          res.end(opened.buffer);
          return;
        }

        if (opened.stream) {
          res.flushHeaders?.();
          const reader = opened.stream.getReader();
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          let clientClosed = false;

          req.on('close', () => {
            clientClosed = true;
            void reader.cancel().catch(() => {});
          });

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength > 0) {
                chunks.push(value);
                totalBytes += value.byteLength;
                if (!clientClosed && !res.writableEnded) {
                  res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
                }
              }
            }
          } finally {
            reader.releaseLock();
          }

          if (!clientClosed && totalBytes > 0) {
            opened.onCompleteBuffer?.(Buffer.concat(chunks, totalBytes));
          }
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        res.status(503).json({
          error: 'तुमचा निवडलेला ElevenLabs आवाज सध्या उपलब्ध नाही.',
          elevenLabsStatus: 'voice_error',
          elevenLabsOnly: true,
        });
      } catch (err) {
        if (res.headersSent) {
          if (!res.writableEnded) res.end();
          return;
        }
        if (err instanceof ElevenLabsSpeechError) {
          res.status(503).json({
            error: err.message,
            elevenLabsStatus: err.reason,
            elevenLabsOnly: true,
          });
          return;
        }
        const message =
          err instanceof Error ? err.message : 'ElevenLabs speech synthesis unavailable.';
        res.status(503).json({ error: message, elevenLabsOnly: true });
      }
    },
  );

  return router;
}

export function createExpressApp(authMiddleware = verifyFirebaseBearerToken) {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      frameguard: false,
      // Send origin referrer to Google / Firebase Auth endpoints instead of stripping with no-referrer
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Allow Firebase Auth Google Sign-In popup to communicate back on HTTPS custom domains
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  app.use(
    cors((req, callback) => {
      const origin = req.header('Origin');
      const host = req.header('X-Forwarded-Host') || req.header('Host');
      if (isOriginAllowed(origin, host)) {
        callback(null, {
          origin: true,
          credentials: false,
          allowedHeaders: ['Content-Type', 'Authorization'],
          exposedHeaders: ['X-Voice-Provider', 'X-Voice-Model', 'X-Voice-Id', 'X-Voice-Cache'],
        });
        return;
      }
      callback(new Error('CORS origin not allowed'));
    }),
  );

  app.use(express.json({ limit: '15mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many API requests. Please wait a moment and try again.' },
  });

  app.use('/api/v1', apiLimiter);
  app.use('/api/v1', createApiRouter(authMiddleware));

  // Centralized Express error handler (accurate status codes for CORS, Payload Too Large, Multer, and malformed JSON)
  app.use((err: Error & { status?: number; statusCode?: number; type?: string; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === 'CORS origin not allowed') {
      res.status(403).json({ error: 'CORS origin not allowed.' });
      return;
    }
    if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE' || err.status === 413 || err.statusCode === 413) {
      res.status(413).json({ error: 'Request payload or uploaded file is too large. Please reduce the size and try again.' });
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON request body.' });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.message || 'File upload failed.' });
      return;
    }
    const explicitStatus = err.status || err.statusCode;
    if (typeof explicitStatus === 'number' && explicitStatus >= 400 && explicitStatus < 500) {
      res.status(explicitStatus).json({ error: err.message || 'Invalid request.' });
      return;
    }
    if (err.message && err.message.startsWith('Only .xlsx')) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Unexpected server error.' });
  });

  return app;
}

async function startServer() {
  const app = createExpressApp();
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const transformed = await vite.transformRequest('/@vite/client');
        if (!transformed) {
          next();
          return;
        }
        const safeClientCode = transformed.code.replace(
          'const createWebSocketModuleRunnerTransport = (options) => {',
          'const createWebSocketModuleRunnerTransport = (_options) => { return { connect() {}, disconnect() {}, send() {} };',
        );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(safeClientCode);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    const rawIndexHtml = fs.existsSync(indexHtmlPath)
      ? fs.readFileSync(indexHtmlPath, 'utf-8')
      : null;

    const buildStaffIndexHtml = (html: string): string => {
      let updated = html
        .replace(
          /<title>.*?<\/title>/i,
          '<title>House of Muktai — Staff Incentive App</title>',
        )
        .replace(
          /<meta\s+name="apple-mobile-web-app-title"\s+content="[^"]*"\s*\/?>/i,
          '<meta name="apple-mobile-web-app-title" content="Muktai Staff" />',
        );
      if (/<link\s+rel="manifest"[^>]*>/i.test(updated)) {
        updated = updated.replace(
          /<link\s+rel="manifest"[^>]*>/i,
          '<link rel="manifest" href="/staff-manifest.webmanifest" />',
        );
      } else {
        updated = updated.replace(
          '</head>',
          '    <link rel="manifest" href="/staff-manifest.webmanifest" />\n  </head>',
        );
      }
      return updated;
    };

    const staffIndexHtml = rawIndexHtml ? buildStaffIndexHtml(rawIndexHtml) : null;

    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          }
        },
      }),
    );
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'API route not found.' });
    });
    app.get('*', (req, res) => {
      const host = (req.header('X-Forwarded-Host') || req.header('Host') || '').toLowerCase();
      const isStaffRequest =
        host.startsWith('staff.') ||
        req.path === '/staff' ||
        req.path.startsWith('/staff/') ||
        req.query.portal === 'staff';

      if (isStaffRequest && staffIndexHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(staffIndexHtml);
        return;
      }
      if (rawIndexHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(rawIndexHtml);
        return;
      }
      res.sendFile(indexHtmlPath);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`House of Muktai Incentive Server listening on http://0.0.0.0:${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}
