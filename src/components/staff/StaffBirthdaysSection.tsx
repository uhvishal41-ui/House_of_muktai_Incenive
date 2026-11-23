import React, { useMemo, useState } from 'react';
import {
  Building2,
  Cake,
  CalendarDays,
  Check,
  Download,
  Gift,
  Heart,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BIRTHDAY_WISH_PRESETS,
  formatBirthMonthDayLabel,
  getTodayIstParts,
  isBirthdayToday,
  partitionBirthdays,
} from '../../lib/birthdayEngine';
import { downloadOfficialBirthdayCardPng } from '../../lib/birthdayCardGenerator';
import { sendEmployeeBirthdayWish } from '../../services/birthdayService';
import type { BirthdayProfile, BirthdayWish, Employee } from '../../types/incentive';

interface StaffBirthdaysSectionProps {
  currentEmployee: Employee;
  profiles: BirthdayProfile[];
  receivedWishes: BirthdayWish[];
  sentWishes: BirthdayWish[];
  isMr: boolean;
  onOpenMyCard: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || 'H') + (parts[1]?.[0] || parts[0]?.[1] || 'M')).toUpperCase();
}

export function StaffBirthdaysSection({
  currentEmployee,
  profiles,
  receivedWishes,
  sentWishes,
  isMr,
  onOpenMyCard,
}: StaffBirthdaysSectionProps) {
  const [tab, setTab] = useState<'today' | 'upcoming'>('today');
  const [wishTarget, setWishTarget] = useState<BirthdayProfile | null>(null);
  const [wishMessage, setWishMessage] = useState(
    isMr ? BIRTHDAY_WISH_PRESETS[0].text : BIRTHDAY_WISH_PRESETS[2].text,
  );
  const [sendingWish, setSendingWish] = useState(false);
  const [wishError, setWishError] = useState<string | null>(null);
  const [wishSuccessNote, setWishSuccessNote] = useState<string | null>(null);
  const [quickDownloading, setQuickDownloading] = useState(false);

  const todayIst = useMemo(() => getTodayIstParts(), []);
  const myBirthdayToday = useMemo(
    () => isBirthdayToday(currentEmployee.dateOfBirth),
    [currentEmployee.dateOfBirth],
  );

  const { today: todayBirthdays, upcoming: upcomingBirthdays } = useMemo(
    () => partitionBirthdays(profiles, new Date(), 7),
    [profiles],
  );

  const sentRecipientSet = useMemo(() => {
    const set = new Set<string>();
    for (const w of sentWishes) {
      if (w.celebrationYear === todayIst.year) {
        set.add(w.recipientEmployeeId);
      }
    }
    return set;
  }, [sentWishes, todayIst.year]);

  const openWishComposer = (target: BirthdayProfile) => {
    setWishTarget(target);
    setWishMessage(isMr ? BIRTHDAY_WISH_PRESETS[0].text : BIRTHDAY_WISH_PRESETS[2].text);
    setWishError(null);
  };

  const handleSendWish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wishTarget) return;
    const clean = wishMessage.trim();
    if (clean.length < 2) {
      setWishError(
        isMr ? 'कृपया किमान २ अक्षरांचा शुभेच्छा संदेश लिहा.' : 'Please write a short wish message.',
      );
      return;
    }

    setSendingWish(true);
    setWishError(null);
    try {
      await sendEmployeeBirthdayWish({
        recipient: wishTarget,
        sender: currentEmployee,
        message: clean,
      });
      const targetName = wishTarget.fullName;
      setWishTarget(null);
      setWishSuccessNote(
        isMr
          ? `${targetName} यांना वाढदिवसाच्या शुभेच्छा पाठवल्या गेल्या!`
          : `Birthday wish sent to ${targetName}!`,
      );
      window.setTimeout(() => setWishSuccessNote(null), 4000);
    } catch (err) {
      setWishError(
        err instanceof Error
          ? err.message
          : isMr
            ? 'शुभेच्छा पाठवता आल्या नाहीत. कृपया पुन्हा प्रयत्न करा.'
            : 'Unable to send wish right now. Please try again.',
      );
    } finally {
      setSendingWish(false);
    }
  };

  const handleQuickDownloadMyCard = async () => {
    if (!currentEmployee.dateOfBirth) return;
    setQuickDownloading(true);
    try {
      await downloadOfficialBirthdayCardPng({
        fullName: currentEmployee.fullName,
        employeeId: currentEmployee.employeeId,
        branchName: currentEmployee.branchName,
        departmentName: currentEmployee.departmentName,
        designation: currentEmployee.designation,
        photoDataUrl: currentEmployee.photoDataUrl,
        birthMonthDay: currentEmployee.dateOfBirth.slice(5, 10),
        celebrationYear: todayIst.year,
      });
    } finally {
      setQuickDownloading(false);
    }
  };

  // Hide entire block only if there's truly nothing to show (no own birthday, no received wishes, no today/upcoming birthdays across 12 branches)
  const hasAnyCelebration =
    myBirthdayToday ||
    receivedWishes.length > 0 ||
    todayBirthdays.length > 0 ||
    upcomingBirthdays.length > 0;

  if (!hasAnyCelebration) {
    return null;
  }

  return (
    <div id="staff-birthdays-section" className="lg:col-span-12 space-y-4">
      {/* 1. Own Birthday Celebration Banner (House of Muktai Official Card CTA) */}
      {myBirthdayToday && (
        <section className="rounded-2xl bg-gradient-to-r from-[#0B162C] via-[#0F1F3D] to-[#1A335E] text-white border border-[#DFC27D]/55 overflow-hidden shadow-sm">
          <div className="h-1 w-full bg-gradient-to-r from-[#B8923A] via-[#F3DFAA] to-[#B8923A]" />
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-[#DFC27D]/15 border border-[#DFC27D]/45 text-[#F3DFAA] flex items-center justify-center shrink-0">
                <Cake className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wide text-[#DFC27D] inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {isMr
                      ? 'हाऊस ऑफ मुक्ताई तर्फे वाढदिवसाच्या हार्दिक शुभेच्छा!'
                      : 'Happy Birthday from House of Muktai!'}
                  </span>
                </p>
                <h2 className="text-base sm:text-lg font-bold text-white mt-0.5 leading-snug">
                  {isMr
                    ? `वाढदिवसाच्या मनःपूर्वक शुभेच्छा, ${currentEmployee.fullName}!`
                    : `Happy Birthday, ${currentEmployee.fullName}!`}
                </h2>
                <p className="text-xs text-slate-300 mt-1">
                  {isMr
                    ? `तुमचे अधिकृत House of Muktai Wishing Card तयार आहे · आज तुम्हाला ${receivedWishes.length} शुभेच्छा आल्या आहेत.`
                    : `Your official House of Muktai Birthday Wishing Card is ready · ${receivedWishes.length} wish${receivedWishes.length === 1 ? '' : 'es'} received so far.`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenMyCard}
                className="h-11 px-4 rounded-xl bg-[#DFC27D] hover:bg-[#ebd397] active:scale-[0.98] text-[#0F1F3D] text-xs font-bold inline-flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer"
              >
                <Gift className="w-4 h-4 shrink-0" />
                <span>{isMr ? 'वाढदिवसाचे कार्ड पहा' : 'Open Wishing Card'}</span>
              </button>
              <button
                type="button"
                onClick={handleQuickDownloadMyCard}
                disabled={quickDownloading}
                className="h-11 px-3.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5 text-[#DFC27D]" />
                <span>{isMr ? 'PNG सेव्ह' : 'Save PNG'}</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 2. Personal Received Wishes Wall (Shown when employee has wishes for this year) */}
      {receivedWishes.length > 0 && (
        <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Heart className="w-4 h-4 text-[#B8923A] fill-[#DFC27D] shrink-0" />
              <h2 className="text-sm font-semibold text-[#0F1F3D] truncate">
                {isMr
                  ? `तुम्हाला आलेल्या वाढदिवसाच्या शुभेच्छा (${receivedWishes.length})`
                  : `Birthday Wishes Received (${receivedWishes.length})`}
              </h2>
            </div>
            {myBirthdayToday && (
              <button
                type="button"
                onClick={onOpenMyCard}
                className="text-xs font-semibold text-[#9A7625] hover:text-[#0F1F3D] whitespace-nowrap cursor-pointer"
              >
                {isMr ? 'कार्ड पहा' : 'View Card'}
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {receivedWishes.map((wish) => {
              const isMgmt = wish.senderRole === 'SUPER_ADMIN';
              return (
                <div
                  key={wish.wishId}
                  className={`px-4 sm:px-5 py-3.5 ${isMgmt ? 'bg-[#FDF9EE]/70' : 'bg-white'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0F1F3D] truncate">
                        {wish.senderName}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {wish.senderBranchName}
                        {isMgmt ? ' · Official Management Wish' : ''}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">
                      {new Date(wish.createdAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs sm:text-[13px] text-slate-700 leading-relaxed">
                    “{wish.message}”
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. 12-Branch Today's & Upcoming Birthdays Celebration Board */}
      {(todayBirthdays.length > 0 || upcomingBirthdays.length > 0) && (
        <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#0F1F3D]/6 text-[#B8923A] flex items-center justify-center shrink-0">
                <Cake className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[#0F1F3D] truncate">
                  {isMr
                    ? '१२ शाखांमधील आजचे वाढदिवस'
                    : "12-Branch Birthday Celebrations"}
                </h2>
                <p className="text-[11px] text-slate-500 truncate">
                  {isMr
                    ? 'सर्व १२ शाखांतील सहकाऱ्यांना शुभेच्छा पाठवा'
                    : 'Celebrate and wish colleagues across all 12 House of Muktai branches'}
                </p>
              </div>
            </div>

            <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200/80 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setTab('today')}
                className={`h-8 px-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  tab === 'today'
                    ? 'bg-[#0F1F3D] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                {isMr ? `आज (${todayBirthdays.length})` : `Today (${todayBirthdays.length})`}
              </button>
              <button
                type="button"
                onClick={() => setTab('upcoming')}
                className={`h-8 px-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  tab === 'upcoming'
                    ? 'bg-[#0F1F3D] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#0F1F3D]'
                }`}
              >
                {isMr
                  ? `पुढील ७ दिवस (${upcomingBirthdays.length})`
                  : `Next 7 Days (${upcomingBirthdays.length})`}
              </button>
            </div>
          </div>

          {wishSuccessNote && (
            <div className="px-4 sm:px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{wishSuccessNote}</span>
            </div>
          )}

          {tab === 'today' ? (
            todayBirthdays.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {todayBirthdays.map((person) => {
                  const isMe = person.employeeId === currentEmployee.employeeId;
                  const alreadyWished = sentRecipientSet.has(person.employeeId);
                  return (
                    <div
                      key={person.employeeId}
                      className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {person.photoDataUrl ? (
                          <img
                            src={person.photoDataUrl}
                            alt={person.fullName}
                            className="w-11 h-11 rounded-full object-cover border-2 border-[#DFC27D] shrink-0 bg-slate-100"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-[#0F1F3D] text-[#DFC27D] text-xs font-bold flex items-center justify-center border-2 border-[#DFC27D]/60 shrink-0">
                            {getInitials(person.fullName)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#0F1F3D] truncate">
                            {person.fullName}
                            {isMe && (
                              <span className="ml-1.5 text-[11px] font-semibold text-[#9A7625]">
                                ({isMr ? 'तुम्ही' : 'You'})
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500 truncate flex items-center gap-1.5 mt-0.5">
                            <Building2 className="w-3 h-3 text-[#B8923A] shrink-0" />
                            <span className="truncate">
                              {[person.branchName, person.departmentName, person.designation]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isMe ? (
                          <button
                            type="button"
                            onClick={onOpenMyCard}
                            className="h-10 px-3.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                          >
                            <Gift className="w-3.5 h-3.5 text-[#DFC27D]" />
                            <span>{isMr ? 'माझे कार्ड' : 'My Card'}</span>
                          </button>
                        ) : alreadyWished ? (
                          <span className="h-10 px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                            <Check className="w-3.5 h-3.5" />
                            <span>{isMr ? 'शुभेच्छा पाठवल्या' : 'Wished'}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openWishComposer(person)}
                            className="h-10 px-3.5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] active:scale-[0.98] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all"
                          >
                            <Send className="w-3.5 h-3.5 text-[#DFC27D]" />
                            <span>{isMr ? 'शुभेच्छा पाठवा' : 'Wish'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-5 py-6 text-center text-xs text-slate-500">
                {isMr
                  ? 'आज कोणत्याही शाखेत वाढदिवस नाही. पुढील ७ दिवसांचे वाढदिवस पाहण्यासाठी वरचा टॅब निवडा.'
                  : 'No birthdays across the 12 branches today. Switch to Next 7 Days to see upcoming celebrations.'}
              </div>
            )
          ) : upcomingBirthdays.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {upcomingBirthdays.map((person) => (
                <div
                  key={person.employeeId}
                  className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {person.photoDataUrl ? (
                      <img
                        src={person.photoDataUrl}
                        alt={person.fullName}
                        className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0 bg-slate-100"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-100 text-[#0F1F3D] text-xs font-bold flex items-center justify-center border border-slate-200 shrink-0">
                        {getInitials(person.fullName)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0F1F3D] truncate">
                        {person.fullName}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {[person.branchName, person.departmentName].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1">
                      <CalendarDays className="w-3.5 h-3.5 text-[#B8923A]" />
                      <span>{formatBirthMonthDayLabel(person.birthMonthDay, isMr ? 'mr' : 'en')}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {person.daysUntil === 1
                        ? isMr
                          ? 'उद्या'
                          : 'Tomorrow'
                        : isMr
                          ? `${person.daysUntil} दिवसांनी`
                          : `In ${person.daysUntil} days`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-6 text-center text-xs text-slate-500">
              {isMr
                ? 'पुढील ७ दिवसांत कोणताही आगामी वाढदिवस नाही.'
                : 'No upcoming birthdays in the next 7 days.'}
            </div>
          )}
        </section>
      )}

      {/* 4. Interactive Send Birthday Wish Modal */}
      <AnimatePresence>
        {wishTarget && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Send birthday wish to ${wishTarget.fullName}`}
            className="fixed inset-0 z-50 bg-[#0F1F3D]/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => !sendingWish && setWishTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
            >
              <div className="bg-[#0F1F3D] text-white px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-[#DFC27D]">
                    {isMr ? 'वाढदिवसाच्या शुभेच्छा पाठवा' : 'Send Birthday Wish'}
                  </p>
                  <h3 className="text-sm font-bold text-white truncate mt-0.5">
                    {wishTarget.fullName} · {wishTarget.branchName}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setWishTarget(null)}
                  disabled={sendingWish}
                  aria-label="Close wish composer"
                  className="h-9 w-9 rounded-lg bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSendWish} className="p-5 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold text-slate-600 mb-2">
                    {isMr ? 'झटपट शुभेच्छा निवडा:' : 'Quick Wish Templates:'}
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {BIRTHDAY_WISH_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setWishMessage(preset.text)}
                        className={`text-left px-3 py-2 rounded-xl border text-xs transition-colors cursor-pointer ${
                          wishMessage === preset.text
                            ? 'bg-[#0F1F3D]/5 border-[#0F1F3D] text-[#0F1F3D] font-medium'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {preset.text}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="birthday-wish-message"
                      className="text-xs font-semibold text-slate-700"
                    >
                      {isMr ? 'तुमचा संदेश' : 'Your Personal Message'}
                    </label>
                    <span className="text-[10px] font-mono tabular-nums text-slate-400">
                      {wishMessage.length}/240
                    </span>
                  </div>
                  <textarea
                    id="birthday-wish-message"
                    rows={3}
                    maxLength={240}
                    required
                    value={wishMessage}
                    onChange={(e) => setWishMessage(e.target.value)}
                    placeholder={
                      isMr
                        ? 'तुमच्या शुभेच्छा येथे लिहा...'
                        : 'Write your birthday wishes here...'
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
                  />
                </div>

                {wishError && (
                  <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">
                    {wishError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setWishTarget(null)}
                    disabled={sendingWish}
                    className="h-11 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {isMr ? 'रद्द करा' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={sendingWish}
                    className="h-11 px-5 rounded-xl bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <Send className="w-3.5 h-3.5 text-[#DFC27D]" />
                    <span>
                      {sendingWish
                        ? isMr
                          ? 'पाठवत आहे...'
                          : 'Sending...'
                        : isMr
                          ? 'शुभेच्छा पाठवा'
                          : 'Send Wish'}
                    </span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
