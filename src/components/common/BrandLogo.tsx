import React, { useState } from 'react';
import { COMPANY_BRAND } from '../../lib/companyBrand';

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  framed?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'w-8 h-8',
  sm: 'w-10 h-10',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
  xl: 'w-20 h-20',
};

export function BrandLogo({ size = 'sm', framed = true, className = '' }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);
  const dim = SIZE_CLASSES[size];

  return (
    <div
      className={`${dim} shrink-0 overflow-hidden bg-white inline-flex items-center justify-center ${
        framed ? 'rounded-xl border border-slate-200/90 shadow-xs p-0.5' : 'rounded-lg'
      } ${className}`}
    >
      {failed ? (
        <span className="font-bold text-[#0F1F3D] text-xs tracking-tight select-none">HM</span>
      ) : (
        <img
          src={COMPANY_BRAND.logoWebpPath}
          alt={`${COMPANY_BRAND.brandName} — ${COMPANY_BRAND.legalName}`}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-contain"
        />
      )}
    </div>
  );
}

interface CompanyLetterheadProps {
  documentTitle: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}

export function CompanyLetterhead({
  documentTitle,
  subtitle,
  rightSlot,
}: CompanyLetterheadProps) {
  return (
    <div className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-2xs">
      <div className="h-1 w-full bg-gradient-to-r from-[#0F1F3D] via-[#1E3A5F] to-[#B8923A]" />
      <div className="px-4 py-3.5 sm:px-5 sm:py-4 flex flex-col md:flex-row md:items-center justify-between gap-3.5">
        <div className="flex items-center gap-3.5 min-w-0">
          <BrandLogo size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-[#0F1F3D]">
                {COMPANY_BRAND.brandName}
              </h2>
              <span className="text-[11px] font-semibold tracking-wide text-[#9A7625]">
                {COMPANY_BRAND.legalName}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-800">{documentTitle}</span>
              {subtitle && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{subtitle}</span>
                </>
              )}
            </div>
            <p className="hidden print:block text-[11px] text-slate-600 mt-1">
              {COMPANY_BRAND.fullAddress}
            </p>
          </div>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </div>
  );
}

export function CompanyFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`border-t border-slate-200/80 text-slate-500 ${
        compact ? 'pt-3 text-[11px]' : 'mt-8 pt-4 pb-3 text-xs'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BrandLogo size="xs" framed={false} className="border border-slate-200" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-700 truncate text-xs">
              {COMPANY_BRAND.brandName} · {COMPANY_BRAND.legalName}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {COMPANY_BRAND.addressLine2}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
          {COMPANY_BRAND.branchCountLabel}
        </p>
      </div>
    </footer>
  );
}
