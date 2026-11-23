import React from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { COMPANY_BRAND } from '../../lib/companyBrand';

interface ContinuousAnimatedBrandNameProps {
  text?: string;
  tone?: 'dark' | 'light';
  className?: string;
}

/**
 * Continuously animated "House of Muktai" wordmark.
 * Each letter hops, tilts playfully, and catches a warm golden shimmer wave in an endless smooth loop.
 */
export function ContinuousAnimatedBrandName({
  text = COMPANY_BRAND.brandName,
  tone = 'light',
  className = '',
}: ContinuousAnimatedBrandNameProps) {
  const prefersReducedMotion = useReducedMotion();
  const letters = Array.from(text);

  if (prefersReducedMotion) {
    return (
      <span
        className={`font-bold tracking-tight ${
          tone === 'light' ? 'text-white' : 'text-[#0F1F3D]'
        } ${className}`}
      >
        {text}
      </span>
    );
  }

  const baseColor = tone === 'light' ? '#FFFFFF' : '#0F1F3D';
  const peakColor = tone === 'light' ? '#DFC27D' : '#B8923A';

  return (
    <span
      className={`inline-flex flex-wrap items-baseline font-bold tracking-tight select-none ${className}`}
      aria-label={text}
    >
      {letters.map((char, idx) => {
        if (char === ' ') {
          return (
            <span key={`space-${idx}`} className="inline-block w-[0.28em]" aria-hidden="true">
              &nbsp;
            </span>
          );
        }
        const tiltDir = idx % 2 === 0 ? -1 : 1;
        return (
          <motion.span
            key={`${char}-${idx}`}
            aria-hidden="true"
            animate={{
              y: [0, -6, 1.5, -2, 0, 0],
              rotate: [0, tiltDir * 7, -tiltDir * 4, tiltDir * 2, 0, 0],
              scaleY: [1, 1.14, 0.92, 1.04, 1, 1],
              scaleX: [1, 0.94, 1.06, 0.98, 1, 1],
              color: [baseColor, peakColor, peakColor, baseColor, baseColor, baseColor],
            }}
            transition={{
              duration: 2.6,
              times: [0, 0.16, 0.3, 0.42, 0.56, 1],
              delay: idx * 0.075,
              repeat: Infinity,
              repeatDelay: 0.45,
              ease: 'easeInOut',
            }}
            className="inline-block origin-bottom will-change-transform"
          >
            {char}
          </motion.span>
        );
      })}
    </span>
  );
}

interface AutoMixGoogleButtonProps {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  busyLabel?: string;
  variant?: 'primary' | 'secondary';
}

/**
 * "Continue with Google" CTA button with continuous fluid auto-mixing multi-color blends.
 * Overlapping radial color clouds smoothly drift, cross-fade, and auto-mix across rich shades
 * while maintaining high-contrast white text legibility at every frame.
 */
export function AutoMixGoogleButton({
  onClick,
  disabled = false,
  busy = false,
  label = 'Continue with Google',
  busyLabel = 'Authenticating...',
  variant = 'primary',
}: AutoMixGoogleButtonProps) {
  const prefersReducedMotion = useReducedMotion();
  const isPrimary = variant === 'primary';

  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.99 }}
      className={`relative w-full overflow-hidden rounded-xl font-semibold text-white inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 shadow-sm border border-white/15 transition-shadow hover:shadow-md ${
        isPrimary ? 'h-12 px-4 text-sm' : 'h-10 px-4 text-xs'
      }`}
    >
      {/* Base continuously morphing deep canvas */}
      <motion.span
        aria-hidden="true"
        animate={
          prefersReducedMotion
            ? { backgroundColor: '#0F1F3D' }
            : {
                backgroundColor: [
                  '#0F1F3D',
                  '#1D4ED8',
                  '#0F766E',
                  '#B45309',
                  '#7E22CE',
                  '#BE123C',
                  '#0F1F3D',
                ],
              }
        }
        transition={{
          duration: 14,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="absolute inset-0 pointer-events-none"
      />

      {/* Overlapping liquid auto-mixing color clouds */}
      {!prefersReducedMotion && (
        <>
          <motion.span
            aria-hidden="true"
            animate={{
              x: ['-28%', '32%', '-10%', '26%', '-28%'],
              y: ['-25%', '22%', '18%', '-22%', '-25%'],
              scale: [1, 1.35, 1.1, 1.3, 1],
              opacity: [0.82, 0.65, 0.85, 0.7, 0.82],
            }}
            transition={{ duration: 9.5, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -inset-6 rounded-full blur-xl pointer-events-none mix-blend-screen"
            style={{
              background:
                'radial-gradient(circle at 30% 40%, rgba(56, 189, 248, 0.85), rgba(37, 99, 235, 0.45) 50%, transparent 72%)',
            }}
          />

          <motion.span
            aria-hidden="true"
            animate={{
              x: ['30%', '-25%', '18%', '-30%', '30%'],
              y: ['20%', '-24%', '-12%', '24%', '20%'],
              scale: [1.15, 0.95, 1.32, 1.05, 1.15],
              opacity: [0.75, 0.88, 0.68, 0.84, 0.75],
            }}
            transition={{ duration: 11.2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -inset-6 rounded-full blur-xl pointer-events-none mix-blend-screen"
            style={{
              background:
                'radial-gradient(circle at 70% 55%, rgba(245, 158, 11, 0.85), rgba(244, 63, 94, 0.5) 52%, transparent 74%)',
            }}
          />

          <motion.span
            aria-hidden="true"
            animate={{
              x: ['0%', '28%', '-28%', '10%', '0%'],
              y: ['28%', '-18%', '12%', '-26%', '28%'],
              scale: [1.05, 1.3, 0.96, 1.25, 1.05],
              opacity: [0.68, 0.82, 0.78, 0.62, 0.68],
            }}
            transition={{ duration: 12.8, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -inset-6 rounded-full blur-xl pointer-events-none mix-blend-screen"
            style={{
              background:
                'radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.82), rgba(168, 85, 247, 0.55) 55%, transparent 76%)',
            }}
          />

          {/* Subtle silk sheen sweep */}
          <motion.span
            aria-hidden="true"
            animate={{ x: ['-130%', '160%'] }}
            transition={{ duration: 4.6, repeat: Infinity, repeatDelay: 1.8, ease: 'easeInOut' }}
            className="absolute inset-y-0 w-1/3 -skew-x-20 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none"
          />
        </>
      )}

      {/* Measured contrast scrim so white text stays razor-sharp across every color blend */}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-[#0F1F3D]/28 pointer-events-none"
      />

      {/* Crisp Foreground Label */}
      <span className="relative z-10 inline-flex items-center justify-center gap-2 drop-shadow-[0_1px_1px_rgba(15,31,61,0.45)]">
        {isPrimary && <KeyRound className="w-4 h-4 text-[#FFF3C4] shrink-0" />}
        <span>{busy ? busyLabel : label}</span>
        {isPrimary && <ArrowRight className="w-4 h-4 shrink-0" />}
      </span>
    </motion.button>
  );
}
