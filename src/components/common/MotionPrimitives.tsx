import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { COMPANY_BRAND } from '../../lib/companyBrand';
import { formatINRFromPaise } from '../../lib/format';
import { BrandLogo } from './BrandLogo';

/**
 * Smooth, lightweight number counter for KPI cards.
 * Respects prefers-reduced-motion and renders exact final value immediately if reduced motion is on.
 */
interface AnimatedCounterProps {
  value: number;
  mode?: 'paise' | 'integer' | 'decimal' | 'percent';
  durationMs?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  mode = 'integer',
  durationMs = 520,
  className = '',
}: AnimatedCounterProps) {
  const prefersReduced = useReducedMotion();
  const [displayValue, setDisplayValue] = useState<number>(value);
  const previousRef = useRef<number>(value);

  useEffect(() => {
    if (prefersReduced || durationMs <= 0) {
      setDisplayValue(value);
      previousRef.current = value;
      return;
    }

    const startVal = previousRef.current;
    const delta = value - startVal;
    if (delta === 0) {
      setDisplayValue(value);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      // Smooth executive quartic ease-out
      const eased = 1 - Math.pow(1 - progress, 4);
      const rawNext = startVal + delta * eased;
      const next =
        mode === 'decimal' || mode === 'percent'
          ? Math.round(rawNext * 100) / 100
          : Math.round(rawNext);
      setDisplayValue(next);
      if (progress < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        setDisplayValue(value);
        previousRef.current = value;
      }
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
      previousRef.current = value;
    };
  }, [value, mode, durationMs, prefersReduced]);

  const formatted =
    mode === 'paise'
      ? formatINRFromPaise(displayValue)
      : mode === 'percent'
        ? `${displayValue.toFixed(2)}%`
        : mode === 'decimal'
          ? displayValue.toLocaleString('en-IN', {
              minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
              maximumFractionDigits: 2,
            })
          : displayValue.toLocaleString('en-IN');

  return <span className={`font-mono tabular-nums ${className}`}>{formatted}</span>;
}

/**
 * Fast, compositor-only page / tab entrance transition (<= 200ms).
 */
export function PageTransition({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Executive Brand Splash Screen for App Launch & Auth Loading.
 */
export function BrandSplashScreen({
  subtitle = 'Employee Incentive Management System',
  compact = false,
}: {
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`${
        compact ? 'min-h-[60vh]' : 'min-h-[100dvh]'
      } w-full bg-[#0F1F3D] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden`}
    >
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />

      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center text-center max-w-xs w-full"
      >
        <div className="relative">
          <div className="absolute -inset-2 rounded-2xl bg-[#B8923A]/20 blur-md" aria-hidden="true" />
          <BrandLogo size="xl" className="relative border-[#B8923A]/40 shadow-lg" />
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5 text-xl font-bold tracking-tight text-white"
        >
          {COMPANY_BRAND.brandName}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.28, delay: 0.14 }}
          className="mt-1 text-[11px] font-semibold tracking-wider text-[#DFC27D]"
        >
          {COMPANY_BRAND.legalName}
        </motion.p>

        <p className="mt-2.5 text-xs text-slate-300">{subtitle}</p>

        {/* Subtle progress track */}
        <div className="mt-6 w-40 h-1 rounded-full bg-white/10 overflow-hidden">
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{
              repeat: Infinity,
              duration: 1.15,
              ease: 'easeInOut',
            }}
            className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-[#DFC27D] to-transparent"
          />
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Clean workspace skeleton loader for lazy-loaded Admin & Staff tabs.
 */
export function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading view">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className="h-28 bg-white border border-slate-200/90 rounded-xl p-5 flex flex-col justify-between animate-pulse"
          >
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-7 w-32 bg-slate-200 rounded" />
            <div className="h-2.5 w-20 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
      <div className="h-72 bg-white border border-slate-200/90 rounded-xl p-6 space-y-4 animate-pulse">
        <div className="h-4 w-44 bg-slate-200 rounded" />
        <div className="space-y-2.5">
          {[1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="h-9 w-full bg-slate-100 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
