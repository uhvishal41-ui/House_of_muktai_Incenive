import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * 1. Published Incentive — Calm, slow-breathing gold bar spectrum (for dark navy executive card).
 */
export function PublishedIncentiveGraphic() {
  const prefersReduced = useReducedMotion();
  const bars = [
    { x: 4, baseH: 14, maxScale: 1.32, delay: 0 },
    { x: 14, baseH: 22, maxScale: 1.24, delay: 0.55 },
    { x: 24, baseH: 18, maxScale: 1.35, delay: 1.1 },
    { x: 34, baseH: 28, maxScale: 1.18, delay: 1.65 },
    { x: 44, baseH: 34, maxScale: 1.15, delay: 2.2 },
  ];

  return (
    <svg
      viewBox="0 0 56 44"
      className="w-14 h-11 shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="homGoldBarGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F3DC9E" />
          <stop offset="100%" stopColor="#B8923A" stopOpacity="0.65" />
        </linearGradient>
      </defs>
      <line x1="2" y1="41" x2="54" y2="41" stroke="rgba(223,194,125,0.28)" strokeWidth="1" />
      {bars.map((b, idx) => (
        <motion.rect
          key={idx}
          x={b.x}
          y={40 - b.baseH}
          width="6.5"
          height={b.baseH}
          rx="2"
          fill="url(#homGoldBarGrad)"
          style={{ originY: '40px' }}
          initial={{ scaleY: 0.75, opacity: 0.7 }}
          animate={
            prefersReduced
              ? { scaleY: 1, opacity: 0.92 }
              : {
                  scaleY: [0.85, b.maxScale, 0.85],
                  opacity: [0.72, 1, 0.72],
                }
          }
          transition={{
            duration: 5.2,
            delay: b.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </svg>
  );
}

/**
 * 2. Total Sale Amount — Slow-flowing revenue wave & soft floating gold trend marker.
 */
export function SaleAmountWaveGraphic() {
  const prefersReduced = useReducedMotion();

  return (
    <svg
      viewBox="0 0 72 44"
      className="w-[72px] h-11 shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="homSaleAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F1F3D" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0F1F3D" stopOpacity="0.01" />
        </linearGradient>
        <linearGradient id="homSaleStrokeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1E3A5F" />
          <stop offset="65%" stopColor="#0F1F3D" />
          <stop offset="100%" stopColor="#B8923A" />
        </linearGradient>
      </defs>

      <motion.path
        d="M3 36 C 14 34, 18 22, 29 24 C 39 26, 45 14, 55 15 C 61 15.5, 65 9, 69 7 L 69 40 L 3 40 Z"
        fill="url(#homSaleAreaGrad)"
        initial={{ opacity: 0.5 }}
        animate={prefersReduced ? { opacity: 0.85 } : { opacity: [0.55, 0.95, 0.55] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.path
        d="M3 36 C 14 34, 18 22, 29 24 C 39 26, 45 14, 55 15 C 61 15.5, 65 9, 69 7"
        fill="none"
        stroke="url(#homSaleStrokeGrad)"
        strokeWidth="2.2"
        strokeLinecap="round"
        initial={{ pathLength: prefersReduced ? 1 : 0.25, opacity: 0.9 }}
        animate={prefersReduced ? { pathLength: 1 } : { pathLength: [0.68, 1, 0.68] }}
        transition={{ duration: 6.4, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.circle
        cx="69"
        cy="7"
        r="3.2"
        fill="#B8923A"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        animate={
          prefersReduced
            ? { scale: 1 }
            : {
                scale: [1, 1.28, 1],
                opacity: [0.85, 1, 0.85],
              }
        }
        transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </svg>
  );
}

/**
 * 3. Total Sale Qty — Slow undulating unit-stack pillars symbolizing retail volume.
 */
export function SaleQtyPillarsGraphic() {
  const prefersReduced = useReducedMotion();
  const stacks = [
    { x: 6, blocks: 2, delay: 0 },
    { x: 20, blocks: 3, delay: 0.65 },
    { x: 34, blocks: 4, delay: 1.3 },
    { x: 48, blocks: 3, delay: 1.95 },
  ];

  return (
    <svg
      viewBox="0 0 64 44"
      className="w-16 h-11 shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <line x1="3" y1="41" x2="61" y2="41" stroke="#E2E8F0" strokeWidth="1" />
      {stacks.map((col, colIdx) => (
        <motion.g
          key={colIdx}
          animate={
            prefersReduced
              ? { y: 0 }
              : {
                  y: [0, -2.5, 0],
                }
          }
          transition={{
            duration: 5.4,
            delay: col.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {Array.from({ length: col.blocks }).map((_, bIdx) => {
            const y = 34 - bIdx * 8.5;
            const isTop = bIdx === col.blocks - 1;
            return (
              <rect
                key={bIdx}
                x={col.x}
                y={y}
                width="10"
                height="6"
                rx="1.8"
                fill={isTop ? '#B8923A' : '#1E3A5F'}
                fillOpacity={isTop ? 0.92 : 0.22 + bIdx * 0.24}
              />
            );
          })}
        </motion.g>
      ))}
    </svg>
  );
}

/**
 * 4. Incentive Ratio (% of Sale) — Precision animated radial gauge arc.
 */
export function IncentiveRatioGaugeGraphic({ ratioPct }: { ratioPct: number }) {
  const prefersReduced = useReducedMotion();
  // Map typical retail incentive ratio (0%–5%) visually across the arc, clamped cleanly
  const clampedNorm = Math.min(1, Math.max(0.08, ratioPct / 5));
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference * (1 - clampedNorm);

  return (
    <svg
      viewBox="0 0 46 46"
      className="w-12 h-12 shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="homRatioArcGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0F1F3D" />
          <stop offset="100%" stopColor="#B8923A" />
        </linearGradient>
      </defs>

      {/* Outer subtle breathing halo */}
      <motion.circle
        cx="23"
        cy="23"
        r="21"
        fill="none"
        stroke="#B8923A"
        strokeWidth="1"
        strokeDasharray="3 4"
        animate={
          prefersReduced
            ? { opacity: 0.35 }
            : {
                rotate: [0, 360],
                opacity: [0.22, 0.5, 0.22],
              }
        }
        style={{ originX: '23px', originY: '23px' }}
        transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
      />

      {/* Base track */}
      <circle
        cx="23"
        cy="23"
        r={radius}
        fill="none"
        stroke="#E2E8F0"
        strokeWidth="4"
      />

      {/* Active ratio arc */}
      <motion.circle
        cx="23"
        cy="23"
        r={radius}
        fill="none"
        stroke="url(#homRatioArcGrad)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        transform="rotate(-90 23 23)"
        initial={{ strokeDashoffset: prefersReduced ? targetOffset : circumference }}
        animate={{ strokeDashoffset: targetOffset }}
        transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Center percentage symbol */}
      <text
        x="23"
        y="26.5"
        textAnchor="middle"
        className="fill-[#0F1F3D] text-[10px] font-mono font-bold"
      >
        %
      </text>
    </svg>
  );
}
