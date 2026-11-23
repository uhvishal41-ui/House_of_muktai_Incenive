import React from 'react';
import { Award, Crown, Medal, TrendingUp, Trophy, Users } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { formatINRFromPaise, formatMonthLabel } from '../../lib/format';
import type {
  DepartmentId,
  DepartmentLeaderboard,
  DepartmentLeaderboardEntry,
  EmployeeDepartmentRank,
} from '../../types/incentive';

interface Props {
  monthKey: string;
  departmentId?: DepartmentId | '';
  departmentName?: string;
  currentEmployeeId: string;
  leaderboard: DepartmentLeaderboard | null;
  personalRank: EmployeeDepartmentRank | null;
  isMr: boolean;
}

function getInitials(name: string): string {
  const parts = (name || 'HM').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
}

export function DepartmentLeaderboardCard({
  monthKey,
  departmentId,
  departmentName,
  currentEmployeeId,
  leaderboard,
  personalRank,
  isMr,
}: Props) {
  const prefersReduced = useReducedMotion();

  if (!monthKey) return null;

  const displayDeptName =
    leaderboard?.departmentName || departmentName || (isMr ? 'तुमचा विभाग' : 'Your Department');
  const monthLabel = formatMonthLabel(monthKey);

  // Unassigned department state
  if (!departmentId) {
    return (
      <section className="lg:col-span-12 bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0F1F3D]/8 text-[#0F1F3D] flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4 text-[#B8923A]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#0F1F3D]">
              {isMr ? '१२ शाखांमधील विभाग टॉप ३ सेल्स लीडरबोर्ड' : '12-Branch Department Top-3 Sales Leaderboard'}
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {isMr
                ? 'तुमचा विभाग (Saree / Ladies Wear / Kids Wear / Mens Wear / Non Apparels) अद्याप नेमलेला नाही. विभाग जोडण्यासाठी कृपया Admin शी संपर्क साधा.'
                : 'Your department (Saree / Ladies Wear / Kids Wear / Mens Wear / Non Apparels) is not assigned yet. Contact Admin to join your department leaderboard.'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const top3 = leaderboard?.top3 || [];
  const totalParticipants = leaderboard?.totalParticipants ?? personalRank?.totalParticipants ?? 0;

  // Arrange podium visually: #2 Left, #1 Center, #3 Right when all 3 exist; otherwise ordered list
  const entry1 = top3.find((e) => e.rank === 1) || null;
  const entry2 = top3.find((e) => e.rank === 2) || null;
  const entry3 = top3.find((e) => e.rank === 3) || null;
  const podiumOrder: Array<{ slot: 1 | 2 | 3; entry: DepartmentLeaderboardEntry | null }> = [
    { slot: 2, entry: entry2 },
    { slot: 1, entry: entry1 },
    { slot: 3, entry: entry3 },
  ];

  void currentEmployeeId;

  return (
    <section className="lg:col-span-12 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
      {/* Corporate Navy + Gold Header */}
      <div className="px-4 sm:px-5 py-3.5 bg-[#0F1F3D] text-white relative">
        <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-[#DFC27D]/35 flex items-center justify-center shrink-0">
              <Trophy className="w-4 h-4 text-[#DFC27D]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold tracking-tight text-white truncate">
                {displayDeptName} · {isMr ? 'टॉप ३ सेल्स लीडर्स' : 'Top 3 Sales Leaders'}
              </h2>
              <p className="text-[11px] text-slate-300 truncate">
                {monthLabel} · {isMr ? 'सर्व १२ शाखांमध्ये' : 'Across all 12 branches'}
                {totalParticipants > 0
                  ? ` · ${totalParticipants} ${isMr ? 'कर्मचारी' : 'staff'}`
                  : ''}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#DFC27D] shrink-0">
            {isMr ? 'फक्त विक्री रक्कम' : 'Sale Amt Only'}
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Top 3 Sales Podium */}
        {top3.length === 0 ? (
          <div className="py-6 px-4 text-center rounded-xl bg-slate-50 border border-slate-200/70">
            <p className="text-xs font-medium text-slate-700">
              {isMr
                ? `${displayDeptName} साठी ${monthLabel} मधील सेल्स रँकिंग अद्याप प्रसिद्ध झालेले नाही.`
                : `Sales rankings for ${displayDeptName} (${monthLabel}) are not published yet.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:gap-3.5 items-end pt-2">
            {podiumOrder.map(({ slot, entry }, idx) => {
              if (!entry) {
                return (
                  <div
                    key={`empty-${slot}`}
                    className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-2.5 sm:p-3 text-center min-h-[132px] flex flex-col items-center justify-center"
                  >
                    <span className="text-xs font-mono font-bold text-slate-300">#{slot}</span>
                    <span className="text-[10px] text-slate-400 mt-1">—</span>
                  </div>
                );
              }

              const isFirst = slot === 1;
              const mine = personalRank != null && personalRank.rank === slot;

              return (
                <motion.div
                  key={`slot-${slot}-${entry.employeeName}`}
                  initial={prefersReduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: idx * 0.06 }}
                  className={`relative rounded-xl border text-center flex flex-col items-center justify-between transition-all ${
                    isFirst
                      ? 'px-2 sm:px-3.5 pt-4 pb-3.5 bg-gradient-to-b from-[#B8923A]/[0.11] via-[#DFC27D]/[0.05] to-white border-[#B8923A]/60 shadow-xs min-h-[168px]'
                      : 'px-2 sm:px-3 pt-3 pb-3 bg-[#F8FAFC] border-slate-200/90 min-h-[146px]'
                  } ${mine ? 'ring-2 ring-[#0F1F3D]/40' : ''}`}
                >
                  {/* Rank Marker */}
                  <div
                    className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-mono font-bold px-2 py-0.5 rounded-md mb-2 ${
                      isFirst
                        ? 'bg-[#B8923A] text-white'
                        : slot === 2
                          ? 'bg-[#0F1F3D] text-white'
                          : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isFirst ? (
                      <Crown className="w-3 h-3" />
                    ) : (
                      <Medal className="w-3 h-3" />
                    )}
                    <span>#{slot}</span>
                  </div>

                  {/* Employee Photo or Monogram */}
                  <div
                    className={`rounded-full overflow-hidden flex items-center justify-center font-bold bg-[#0F1F3D] text-[#DFC27D] shrink-0 ${
                      isFirst
                        ? 'w-14 h-14 sm:w-16 sm:h-16 text-base border-2 border-[#B8923A] shadow-xs'
                        : 'w-11 h-11 sm:w-12 sm:h-12 text-xs border-2 border-slate-300'
                    }`}
                  >
                    {entry.photoDataUrl ? (
                      <img
                        src={entry.photoDataUrl}
                        alt={entry.employeeName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{getInitials(entry.employeeName)}</span>
                    )}
                  </div>

                  {/* Name & Branch ONLY */}
                  <div className="w-full mt-2 min-w-0">
                    <p className="text-[11px] sm:text-xs font-bold text-[#0F1F3D] leading-tight line-clamp-2">
                      {entry.employeeName}
                      {mine ? (isMr ? ' (तुम्ही)' : ' (You)') : ''}
                    </p>
                    <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 truncate mt-0.5 uppercase tracking-wide">
                      {entry.branchName}
                    </p>
                  </div>

                  {/* ONLY Sale Amount — Strictly Zero Incentive Figures */}
                  <div className="w-full mt-2 pt-2 border-t border-slate-200/70">
                    <p
                      className={`font-mono tabular-nums font-bold leading-tight truncate ${
                        isFirst
                          ? 'text-xs sm:text-sm text-[#0F1F3D]'
                          : 'text-[11px] sm:text-xs text-[#1E3A5F]'
                      }`}
                    >
                      {formatINRFromPaise(entry.saleAmtPaise)}
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-slate-400 mt-0.5">
                      {isMr ? 'विक्री रक्कम' : 'Sale Amount'}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Private Personal Department Rank Strip */}
        {personalRank && (
          <div className="rounded-xl bg-[#0F1F3D]/[0.04] border border-[#0F1F3D]/15 px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#0F1F3D] text-[#DFC27D] font-mono font-bold text-sm flex items-center justify-center shrink-0">
                {personalRank.rank > 0 ? `#${personalRank.rank}` : '—'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#0F1F3D] flex items-center gap-1.5 flex-wrap">
                  <span>
                    {personalRank.rank > 0
                      ? isMr
                        ? `तुमची रँक: #${personalRank.rank} / ${personalRank.totalParticipants}`
                        : `Your Rank: #${personalRank.rank} of ${personalRank.totalParticipants}`
                      : isMr
                        ? `तुमची रँक: अद्याप विक्री नाही (${personalRank.totalParticipants} पैकी)`
                        : `Not Ranked Yet (0 sales · ${personalRank.totalParticipants} staff)`}
                  </span>
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-1">
                  {personalRank.rank > 0 && personalRank.rank <= 3 ? (
                    <>
                      <Award className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                      <span className="text-emerald-800 font-semibold">
                        {isMr
                          ? 'अभिनंदन! तुम्ही १२ शाखांमध्ये टॉप ३ मध्ये आहात!'
                          : 'Congratulations! You are in the Top 3 across all 12 branches!'}
                      </span>
                    </>
                  ) : personalRank.gapToTop3Paise > 0 ? (
                    <>
                      <TrendingUp className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                      <span>
                        {isMr
                          ? `टॉप ३ मध्ये येण्यासाठी ${formatINRFromPaise(personalRank.gapToTop3Paise)} अधिक विक्री आवश्यक`
                          : `${formatINRFromPaise(personalRank.gapToTop3Paise)} more in sales to enter Top 3`}
                      </span>
                    </>
                  ) : (
                    <>
                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>
                        {isMr
                          ? `${displayDeptName} मधील तुमची वैयक्तिक स्थिती`
                          : `Your private standing in ${displayDeptName}`}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="sm:text-right border-t sm:border-t-0 border-slate-200/80 pt-2 sm:pt-0 shrink-0">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">
                {isMr ? 'तुमची विक्री' : 'Your Sale'}
              </p>
              <p className="text-sm font-mono tabular-nums font-bold text-[#0F1F3D]">
                {formatINRFromPaise(personalRank.saleAmtPaise)}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
