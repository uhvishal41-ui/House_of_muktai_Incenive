import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Calendar, TrendingDown, TrendingUp } from 'lucide-react';
import { formatINRFromPaise, formatMonthLabel, formatQty } from '../../lib/format';
import type { AppLang, STAFF_COPY } from '../../lib/i18n';
import type { MonthlySummary } from '../../types/incentive';
import { AnimatedCounter } from '../common/MotionPrimitives';

interface MonthlyAggLike {
  monthKey: string;
  sourceType: MonthlySummary['sourceType'];
  publishedDaysCount: number;
  grandTotalPaise: number;
  component1TotalPaise: number;
  component2TotalPaise: number;
  component3TotalPaise: number;
  saleAmt1TotalPaise: number;
  saleQty1Total: number;
  saleAmt2TotalPaise: number;
  saleQty2Total: number;
  saleAmt3TotalPaise: number;
  saleQty3Total: number;
  totalSaleAmtPaise: number;
  totalSaleQty: number;
}

interface Props {
  monthlyHistory: MonthlyAggLike[];
  t: (typeof STAFF_COPY)[AppLang];
  isMr: boolean;
}

export function EmployeeReportsTab({ monthlyHistory, t, isMr }: Props) {
  const [chartStyle, setChartStyle] = useState<'bar' | 'trend'>('bar');

  // Chronological chart data (oldest -> newest, up to last 12 published months)
  const chartData = useMemo(() => {
    return [...monthlyHistory]
      .slice(0, 12)
      .reverse()
      .map((s) => ({
        monthKey: s.monthKey,
        label: formatMonthLabel(s.monthKey).replace(/\s+\d{4}$/, (m) => ` '${m.trim().slice(-2)}`),
        fullLabel: formatMonthLabel(s.monthKey),
        incentiveRupees: Math.round(s.grandTotalPaise / 100),
        incentivePaise: s.grandTotalPaise,
        saleRupees: Math.round(s.totalSaleAmtPaise / 100),
        salePaise: s.totalSaleAmtPaise,
      }));
  }, [monthlyHistory]);

  // Yearly Incentive Summary (grouped by Calendar Year, sorted newest first)
  const yearlySummary = useMemo(() => {
    const map = new Map<
      string,
      {
        year: string;
        monthsCount: number;
        totalIncentivePaise: number;
        totalSaleAmtPaise: number;
        totalSaleQty: number;
        bestMonthKey: string;
        bestMonthPaise: number;
      }
    >();

    for (const m of monthlyHistory) {
      const year = m.monthKey.slice(0, 4);
      const curr = map.get(year) || {
        year,
        monthsCount: 0,
        totalIncentivePaise: 0,
        totalSaleAmtPaise: 0,
        totalSaleQty: 0,
        bestMonthKey: m.monthKey,
        bestMonthPaise: -1,
      };
      curr.monthsCount += 1;
      curr.totalIncentivePaise += m.grandTotalPaise;
      curr.totalSaleAmtPaise += m.totalSaleAmtPaise;
      curr.totalSaleQty = Math.round((curr.totalSaleQty + m.totalSaleQty) * 100) / 100;
      if (m.grandTotalPaise > curr.bestMonthPaise) {
        curr.bestMonthPaise = m.grandTotalPaise;
        curr.bestMonthKey = m.monthKey;
      }
      map.set(year, curr);
    }

    return Array.from(map.values()).sort((a, b) => b.year.localeCompare(a.year));
  }, [monthlyHistory]);

  const maxHistoryPaise = useMemo(
    () => Math.max(1, ...monthlyHistory.map((s) => s.grandTotalPaise)),
    [monthlyHistory],
  );

  if (monthlyHistory.length === 0) {
    return (
      <section className="bg-white border border-slate-200/90 rounded-2xl p-8 text-center shadow-2xs">
        <BarChart3 className="w-8 h-8 text-slate-300 mx-auto mb-2.5" />
        <h2 className="text-sm font-semibold text-slate-900">{t.historyTitle}</h2>
        <p className="text-xs text-slate-500 mt-1">{t.historyEmpty}</p>
      </section>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Interactive Monthly Performance Chart */}
      <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-[#0F1F3D]">
              {t.monthlyChartTitle}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isMr
                ? `अलीकडील ${chartData.length} प्रकाशित महिन्यांचा इनसेंटिव्ह आलेख`
                : `Published incentive performance across ${chartData.length} month(s)`}
            </p>
          </div>

          <div
            role="group"
            aria-label="Chart style"
            className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/80 text-[11px]"
          >
            <button
              type="button"
              onClick={() => setChartStyle('bar')}
              className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                chartStyle === 'bar'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isMr ? 'स्तंभ' : 'Bar'}
            </button>
            <button
              type="button"
              onClick={() => setChartStyle('trend')}
              className={`h-7 px-2.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                chartStyle === 'trend'
                  ? 'bg-[#0F1F3D] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isMr ? 'कल (Trend)' : 'Trend'}
            </button>
          </div>
        </div>

        <div className="h-56 sm:h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartStyle === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={{ stroke: '#E2E8F0' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(15, 31, 61, 0.05)' }}
                  contentStyle={{
                    backgroundColor: '#0F1F3D',
                    border: '1px solid rgba(184, 146, 58, 0.35)',
                    borderRadius: '12px',
                    color: '#FFFFFF',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#DFC27D', fontWeight: 600, marginBottom: '4px' }}
                  formatter={(_value, _name, item) => {
                    const p = (item?.payload as { incentivePaise?: number })?.incentivePaise || 0;
                    return [formatINRFromPaise(p), isMr ? 'इनसेंटिव्ह' : 'Incentive'];
                  }}
                />
                <Bar
                  dataKey="incentiveRupees"
                  fill="#0F1F3D"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={42}
                />
              </BarChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="staffNavyGoldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0F1F3D" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0F1F3D" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={{ stroke: '#E2E8F0' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F1F3D',
                    border: '1px solid rgba(184, 146, 58, 0.35)',
                    borderRadius: '12px',
                    color: '#FFFFFF',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#DFC27D', fontWeight: 600, marginBottom: '4px' }}
                  formatter={(_value, _name, item) => {
                    const p = (item?.payload as { incentivePaise?: number })?.incentivePaise || 0;
                    return [formatINRFromPaise(p), isMr ? 'इनसेंटिव्ह' : 'Incentive'];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="incentiveRupees"
                  stroke="#0F1F3D"
                  strokeWidth={2.5}
                  fill="url(#staffNavyGoldGrad)"
                  activeDot={{ r: 5, fill: '#B8923A', stroke: '#0F1F3D', strokeWidth: 2 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </section>

      {/* Yearly Incentive Summary */}
      <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-2xs">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#B8923A] shrink-0" />
          <h2 className="text-sm sm:text-base font-semibold text-[#0F1F3D]">
            {t.yearlySummaryTitle}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {yearlySummary.map((yr) => (
            <div
              key={yr.year}
              className="rounded-xl border border-slate-200/90 bg-[#F8FAFC] p-4 space-y-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-[#0F1F3D] font-mono">{yr.year}</span>
                <span className="text-[11px] font-medium text-slate-500">
                  {yr.monthsCount} {t.activeMonthsLabel}
                </span>
              </div>

              <p className="text-xl font-bold text-[#0F1F3D]">
                <AnimatedCounter value={yr.totalIncentivePaise} mode="paise" />
              </p>

              <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 font-mono tabular-nums">
                <span>
                  {t.saleLabel}: {formatINRFromPaise(yr.totalSaleAmtPaise)}
                </span>
                <span>
                  {t.qtyLabel}: {formatQty(yr.totalSaleQty)}
                </span>
              </div>

              <p className="text-[11px] text-slate-500">
                {isMr ? 'सर्वोत्तम महिना:' : 'Best Month:'}{' '}
                <strong className="text-slate-800">{formatMonthLabel(yr.bestMonthKey)}</strong> (
                <span className="font-mono tabular-nums">
                  {formatINRFromPaise(yr.bestMonthPaise)}
                </span>
                )
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Month-over-Month Growth Breakdown */}
      <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xs">
        <h2 className="text-sm sm:text-base font-semibold text-[#0F1F3D]">{t.historyTitle}</h2>

        <div className="space-y-3.5">
          {monthlyHistory.map((s, idx) => {
            const prev = monthlyHistory[idx + 1];
            const delta = prev ? s.grandTotalPaise - prev.grandTotalPaise : null;
            const widthPct = Math.max(5, Math.round((s.grandTotalPaise / maxHistoryPaise) * 100));
            const historySlabs = [
              {
                label: t.slab1,
                inc: s.component1TotalPaise,
                sale: s.saleAmt1TotalPaise,
                qty: s.saleQty1Total,
              },
              {
                label: t.slab2,
                inc: s.component2TotalPaise,
                sale: s.saleAmt2TotalPaise,
                qty: s.saleQty2Total,
              },
              {
                label: t.slab3,
                inc: s.component3TotalPaise,
                sale: s.saleAmt3TotalPaise,
                qty: s.saleQty3Total,
              },
            ];
            return (
              <div
                key={s.monthKey}
                className="p-4 rounded-xl border border-slate-200/80 bg-[#F8FAFC] space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F1F3D]">
                      {formatMonthLabel(s.monthKey)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {s.sourceType === 'MONTHLY_RECORD'
                        ? t.monthlyStatementLabel
                        : `${s.publishedDaysCount} ${t.dailyRecordsLabel}`}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-slate-600 mt-0.5">
                      {t.saleLabel} {formatINRFromPaise(s.totalSaleAmtPaise)} · {t.qtyLabel}{' '}
                      {formatQty(s.totalSaleQty)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-bold font-mono tabular-nums text-[#0F1F3D]">
                      {formatINRFromPaise(s.grandTotalPaise)}
                    </p>
                    {delta !== null && (
                      <p
                        className={`text-[11px] font-mono tabular-nums font-semibold mt-0.5 inline-flex items-center gap-0.5 ${
                          delta >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {delta >= 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        <span>
                          {delta >= 0 ? '+' : ''}
                          {formatINRFromPaise(delta)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#0F1F3D] to-[#B8923A] rounded-full transition-all duration-300"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>

                <div className="rounded-xl bg-white border border-slate-100 divide-y divide-slate-100 sm:divide-y-0 sm:grid sm:grid-cols-3 sm:divide-x">
                  {historySlabs.map((slab) => (
                    <div
                      key={slab.label}
                      className="px-3 py-2 flex items-center justify-between gap-2 sm:block"
                    >
                      <div className="min-w-0">
                        <p className="text-[11px] text-slate-500 truncate">{slab.label}</p>
                        <p className="text-[10px] font-mono tabular-nums text-slate-400">
                          {t.saleLabel}: {formatINRFromPaise(slab.sale)} · {t.qtyLabel}:{' '}
                          {formatQty(slab.qty)}
                        </p>
                      </div>
                      <p className="text-xs font-mono tabular-nums font-semibold text-[#0F1F3D] shrink-0 sm:mt-1">
                        {formatINRFromPaise(slab.inc)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
