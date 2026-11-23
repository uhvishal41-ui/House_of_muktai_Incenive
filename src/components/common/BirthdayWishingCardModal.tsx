import React, { useEffect, useState } from 'react';
import { Cake, Download, FileDown, Heart, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  downloadOfficialBirthdayCardPdf,
  downloadOfficialBirthdayCardPng,
  type BirthdayCardInput,
} from '../../lib/birthdayCardGenerator';
import { formatBirthMonthDayLabel, getTodayIstParts } from '../../lib/birthdayEngine';
import { COMPANY_BRAND } from '../../lib/companyBrand';
import { BrandLogo } from './BrandLogo';

interface BirthdayWishingCardModalProps {
  open: boolean;
  onClose: () => void;
  card: BirthdayCardInput | null;
  isMr?: boolean;
  receivedWishesCount?: number;
  onViewWishes?: () => void;
}

const CONFETTI_PIECES = Array.from({ length: 24 }, (_, idx) => ({
  id: idx,
  leftPct: (idx * 17 + 7) % 96,
  delay: (idx % 6) * 0.14,
  duration: 2.2 + (idx % 4) * 0.45,
  size: idx % 3 === 0 ? 8 : 6,
  color: idx % 3 === 0 ? '#DFC27D' : idx % 3 === 1 ? '#F8FAFC' : '#B8923A',
  rotate: idx % 2 === 0 ? 180 : -180,
}));

export function BirthdayWishingCardModal({
  open,
  onClose,
  card,
  isMr = false,
  receivedWishesCount = 0,
  onViewWishes,
}: BirthdayWishingCardModalProps) {
  const prefersReduced = useReducedMotion();
  const [downloadingPng, setDownloadingPng] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !card) return null;

  const year = card.celebrationYear || getTodayIstParts().year;
  const dateLabel = `${formatBirthMonthDayLabel(card.birthMonthDay, isMr ? 'mr' : 'en')} ${year}`;
  const initials = (() => {
    const parts = card.fullName.trim().split(/\s+/);
    return ((parts[0]?.[0] || 'H') + (parts[1]?.[0] || parts[0]?.[1] || 'M')).toUpperCase();
  })();

  const handlePng = async () => {
    setDownloadError(null);
    setDownloadingPng(true);
    try {
      await downloadOfficialBirthdayCardPng(card);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Unable to download PNG card.');
    } finally {
      setDownloadingPng(false);
    }
  };

  const handlePdf = async () => {
    setDownloadError(null);
    setDownloadingPdf(true);
    try {
      await downloadOfficialBirthdayCardPdf(card);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Unable to download PDF card.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="House of Muktai Official Birthday Wishing Card"
        className="fixed inset-0 z-50 bg-[#050B17]/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-lg my-auto rounded-3xl bg-gradient-to-b from-[#09142A] via-[#0F1F3D] to-[#162C54] text-white border-2 border-[#DFC27D]/70 shadow-2xl overflow-hidden"
        >
          {/* Subtle Gold Confetti Celebration Layer */}
          {!prefersReduced && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              {CONFETTI_PIECES.map((piece) => (
                <motion.span
                  key={piece.id}
                  initial={{ y: -24, opacity: 0.9, rotate: 0 }}
                  animate={{ y: 560, opacity: [0.9, 0.85, 0], rotate: piece.rotate }}
                  transition={{
                    duration: piece.duration,
                    delay: piece.delay,
                    ease: 'easeOut',
                  }}
                  style={{
                    left: `${piece.leftPct}%`,
                    width: `${piece.size}px`,
                    height: `${piece.size}px`,
                    backgroundColor: piece.color,
                  }}
                  className="absolute top-0 rounded-xs"
                />
              ))}
            </div>
          )}

          {/* Inner Ornamental Gold Hairline Frame */}
          <div className="relative m-2.5 sm:m-3.5 rounded-2xl border border-[#DFC27D]/35 px-4 sm:px-6 pt-5 pb-6">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close birthday wishing card"
              className="absolute top-3 right-3 h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white inline-flex items-center justify-center cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Company Crest */}
            <div className="flex flex-col items-center text-center">
              <BrandLogo size="md" className="border-[#DFC27D]/60 shadow-md" />
              <p className="mt-3 text-sm font-bold tracking-wider text-white uppercase">
                {COMPANY_BRAND.brandName}
              </p>
              <p className="text-[11px] font-medium text-[#DFC27D] mt-0.5">
                {COMPANY_BRAND.legalName}
              </p>

              <div className="my-3.5 h-px w-36 bg-gradient-to-r from-transparent via-[#DFC27D]/60 to-transparent" />

              {/* Bilingual Headline */}
              <div className="inline-flex items-center gap-1.5 text-[#F3DFAA]">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span className="text-xs font-semibold tracking-wide">
                  {dateLabel}
                </span>
                <Sparkles className="w-4 h-4 shrink-0" />
              </div>

              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-[#F3DFAA] font-serif">
                Happy Birthday
              </h2>
              <p className="mt-0.5 text-sm sm:text-base font-semibold text-slate-100">
                वाढदिवसाच्या मनःपूर्वक शुभेच्छा!
              </p>

              {/* Employee Gold-Rimmed Portrait */}
              <div className="mt-4 relative">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full p-1 bg-gradient-to-tr from-[#B8923A] via-[#F3DFAA] to-[#B8923A] shadow-lg">
                  {card.photoDataUrl ? (
                    <img
                      src={card.photoDataUrl}
                      alt={card.fullName}
                      className="w-full h-full rounded-full object-cover bg-[#1E3A5F]"
                    />
                  ) : (
                    <div className="w-full h-full rounded-full bg-[#1E3A5F] text-[#DFC27D] text-2xl font-bold flex items-center justify-center">
                      {initials}
                    </div>
                  )}
                </div>
                <div
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#DFC27D] text-[#0F1F3D] flex items-center justify-center shadow-md border-2 border-[#0F1F3D]"
                  aria-hidden="true"
                >
                  <Cake className="w-4 h-4" />
                </div>
              </div>

              <h3 className="mt-3.5 text-lg sm:text-xl font-bold text-white leading-snug">
                {card.fullName}
              </h3>
              <p className="text-xs text-[#DFC27D] font-medium mt-0.5">
                {[card.designation || 'Team Member', card.branchName, card.departmentName]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              {/* Heartfelt Company Greeting Panel */}
              <div className="mt-4 w-full rounded-2xl bg-white/[0.06] border border-[#DFC27D]/30 px-4 py-3.5 space-y-2.5 text-center">
                <p className="text-xs sm:text-[13px] text-slate-100 leading-relaxed">
                  Wishing you wonderful health, happiness, and continued success. Thank you for
                  being a valued member of the House of Muktai family.
                </p>
                <div className="h-px w-24 mx-auto bg-[#DFC27D]/30" />
                <p className="text-xs sm:text-[13px] text-[#F3DFAA] leading-relaxed">
                  तुम्हाला उत्तम आरोग्य, आनंद आणि उज्ज्वल यश लाभो. हाऊस ऑफ मुक्ताई परिवारातील
                  तुमच्या योगदानाबद्दल मनःपूर्वक आभार!
                </p>
              </div>

              <p className="mt-3.5 text-[11px] font-medium text-slate-300">
                Warm Regards · House of Muktai Management &amp; 12-Branch Family
              </p>

              {downloadError && (
                <p className="mt-2 text-xs text-red-300">{downloadError}</p>
              )}

              {/* Action Controls */}
              <div className="mt-5 w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handlePng}
                  disabled={downloadingPng || downloadingPdf}
                  className="h-11 px-4 rounded-xl bg-[#DFC27D] hover:bg-[#ebd397] active:scale-[0.98] text-[#0F1F3D] text-xs font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>
                    {downloadingPng
                      ? isMr
                        ? 'डाउनलोड होत आहे...'
                        : 'Preparing PNG...'
                      : isMr
                        ? 'कार्ड डाउनलोड (PNG)'
                        : 'Download Card (PNG)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handlePdf}
                  disabled={downloadingPng || downloadingPdf}
                  className="h-11 px-4 rounded-xl bg-white/10 hover:bg-white/20 active:scale-[0.98] border border-white/20 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  <FileDown className="w-4 h-4 text-[#DFC27D] shrink-0" />
                  <span>
                    {downloadingPdf
                      ? isMr
                        ? 'PDF तयार होत आहे...'
                        : 'Preparing PDF...'
                      : isMr
                        ? 'PDF सेव्ह करा'
                        : 'Download PDF'}
                  </span>
                </button>
              </div>

              {onViewWishes && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onViewWishes();
                  }}
                  className="mt-3 h-10 px-4 rounded-xl text-xs font-semibold text-[#DFC27D] hover:bg-white/10 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Heart className="w-3.5 h-3.5 fill-current" />
                  <span>
                    {isMr
                      ? `तुम्हाला आलेल्या शुभेच्छा पहा (${receivedWishesCount})`
                      : `View Received Wishes (${receivedWishesCount})`}
                  </span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
