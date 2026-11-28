import React from 'react';
import {
  Building2,
  CreditCard,
  Download,
  Edit3,
  FileCheck2,
  Phone,
  X,
} from 'lucide-react';
import { downloadSingleEmployeeDossierCsv } from '../../lib/employeeMasterExport';
import { formatINRFromPaise } from '../../lib/format';
import type { Employee } from '../../types/incentive';

interface Props {
  employee: Employee | null;
  onClose: () => void;
  onEdit: (emp: Employee) => void;
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  const display = value && value.trim() ? value.trim() : '—';
  const isBlank = display === '—';
  return (
    <div className="py-2 border-b border-slate-100 last:border-b-0 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-4">
      <dt className="text-[11px] font-medium text-slate-500 shrink-0">{label}</dt>
      <dd
        className={`text-xs text-left sm:text-right break-words ${
          isBlank ? 'text-slate-400' : 'text-slate-900 font-medium'
        } ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {display}
      </dd>
    </div>
  );
}

export function EmployeeProfileDrawer({ employee, onClose, onEdit }: Props) {
  if (!employee) return null;

  const customEntries = Object.entries(employee.customFields || {}).filter(
    ([k, v]) => k.trim() && String(v ?? '').trim(),
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex justify-end"
      onClick={onClose}
    >
      <aside
        className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Employee Master Profile for ${employee.fullName}`}
      >
        {/* Top Executive Header */}
        <div className="px-5 py-4 bg-[#0F1F3D] text-white flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-full bg-[#1B315C] text-[#DFC27D] text-sm font-bold flex items-center justify-center overflow-hidden border border-[#B8923A]/60 shrink-0">
              {employee.photoDataUrl ? (
                <img
                  src={employee.photoDataUrl}
                  alt={employee.fullName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>
                  {employee.fullName
                    .split(' ')
                    .map((s) => s[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight truncate">
                  {employee.fullName}
                </h2>
                <span
                  className={`text-[11px] font-semibold ${
                    employee.status === 'ACTIVE' ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  · {employee.status}
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate mt-0.5">
                {employee.designation} · {employee.branchName}
                {employee.departmentName ? ` · ${employee.departmentName}` : ''}
              </p>
              <p className="text-[11px] font-mono text-[#DFC27D] mt-1 tabular-nums">
                EMP: {employee.employeeId}
                {employee.saleId ? ` · Sale ID: ${employee.saleId}` : ''} · Login: {employee.loginId}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-300 hover:text-white cursor-pointer shrink-0"
            aria-label="Close employee profile drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Essential Sections */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* 1. Job & Portal Access */}
          <section>
            <h3 className="text-xs font-semibold text-[#0F1F3D] flex items-center gap-1.5 mb-2">
              <Building2 className="w-3.5 h-3.5 text-[#B8923A]" />
              Job &amp; Portal Access
            </h3>
            <dl className="rounded-xl border border-slate-200 bg-white px-4 py-1">
              <DetailRow label="Branch" value={`${employee.branchName} (${employee.branchId})`} />
              <DetailRow label="Department" value={employee.departmentName || 'Unassigned'} />
              <DetailRow label="Designation" value={employee.designation} />
              <DetailRow label="Date of Joining" value={employee.dateOfJoining} mono />
              <DetailRow label="Date of Exit" value={employee.dateOfExit} mono />
              <DetailRow
                label="Login Status"
                value={
                  employee.credentialsProvisioned
                    ? 'Active'
                    : employee.linkedGoogleEmail
                      ? 'Google Linked'
                      : 'Pending Password'
                }
              />
              {employee.linkedGoogleEmail && (
                <DetailRow label="Linked Google Email" value={employee.linkedGoogleEmail} />
              )}
              {employee.isBranchManager && (
                <DetailRow label="Branch Manager View" value="Enabled (Own Branch)" />
              )}
            </dl>
          </section>

          {/* 2. Personal & Contact */}
          <section>
            <h3 className="text-xs font-semibold text-[#0F1F3D] flex items-center gap-1.5 mb-2">
              <Phone className="w-3.5 h-3.5 text-[#B8923A]" />
              Personal &amp; Contact
            </h3>
            <dl className="rounded-xl border border-slate-200 bg-white px-4 py-1">
              <DetailRow label="Mobile Number" value={employee.phone} mono />
              <DetailRow label="Gender" value={employee.gender} />
              <DetailRow label="Date of Birth" value={employee.dateOfBirth} mono />
              <DetailRow label="Residential Address" value={employee.address} />
              <DetailRow label="Emergency Contact" value={employee.emergencyContact} mono />
            </dl>
          </section>

          {/* 3. Bank & Salary */}
          <section>
            <h3 className="text-xs font-semibold text-[#0F1F3D] flex items-center gap-1.5 mb-2">
              <CreditCard className="w-3.5 h-3.5 text-[#B8923A]" />
              Bank &amp; Salary
            </h3>
            <dl className="rounded-xl border border-slate-200 bg-white px-4 py-1">
              <DetailRow
                label="Monthly Gross Salary"
                value={
                  employee.monthlyGrossSalaryPaise
                    ? formatINRFromPaise(employee.monthlyGrossSalaryPaise)
                    : ''
                }
                mono
              />
              <DetailRow label="Bank Name" value={employee.bankName} />
              <DetailRow label="Bank Account (Masked)" value={employee.bankAccountMasked} mono />
              <DetailRow label="Bank IFSC Code" value={employee.bankIfsc} mono />
            </dl>
          </section>

          {/* 4. KYC & Statutory */}
          <section>
            <h3 className="text-xs font-semibold text-[#0F1F3D] flex items-center gap-1.5 mb-2">
              <FileCheck2 className="w-3.5 h-3.5 text-[#B8923A]" />
              KYC &amp; Statutory
            </h3>
            <dl className="rounded-xl border border-slate-200 bg-white px-4 py-1">
              <DetailRow label="Aadhaar (Masked)" value={employee.aadhaarMasked} mono />
              <DetailRow label="PAN Number" value={employee.panNumber} mono />
              <DetailRow label="UAN Number" value={employee.uanNumber} mono />
              <DetailRow label="PF Account Number" value={employee.pfNumber} mono />
              <DetailRow label="ESIC Number" value={employee.esicNumber} mono />
              {customEntries.map(([k, v]) => (
                <DetailRow key={k} label={k} value={v} />
              ))}
            </dl>
          </section>
        </div>

        {/* Sticky Drawer Footer */}
        <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => downloadSingleEmployeeDossierCsv(employee)}
            className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#0F1F3D]" />
            Export (.csv)
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(employee);
              }}
              className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#DFC27D]" />
              Edit Details
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
