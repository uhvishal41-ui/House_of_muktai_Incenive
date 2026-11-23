import React, { useState } from 'react';
import {
  Camera,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { DEFAULT_EMPLOYEE_PASSWORD, getShareableStaffAppUrl } from '../../lib/companyBrand';
import {
  buildDepartmentCsvTemplate,
  compressEmployeePhotoToDataUrl,
  OFFICIAL_DEPARTMENTS,
  parseBulkDepartmentCsvText,
  parseBulkDepartmentRows,
  type BulkDepartmentParseRow,
} from '../../lib/departmentLeaderboardEngine';
import { downloadCredentialSheetPdf } from '../../lib/pdfGenerator';
import {
  bulkUpdateEmployeeDepartments,
  recomputeAndSaveDepartmentRankings,
} from '../../services/departmentVisibilityService';
import {
  backfillAuthUidAndActiveRegistry,
  provisionAllPendingEmployeeLogins,
  provisionSingleEmployeeDefaultLogin,
  saveEmployee,
  updateEmployeeStatus,
  type ProvisionFailureItem,
} from '../../services/incentiveService';
import type {
  Branch,
  DepartmentId,
  Employee,
  PortalVisibilitySettings,
  PublishedIncentive,
} from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  incentives?: PublishedIncentive[];
  visibilitySettings?: PortalVisibilitySettings;
  onRefresh: () => Promise<void>;
}

export function EmployeeMaster({
  branches,
  employees,
  incentives = [],
  visibilitySettings,
  onRefresh,
}: Props) {
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<'ALL' | 'UNASSIGNED' | DepartmentId>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [authFilter, setAuthFilter] = useState<'ALL' | 'PENDING' | 'ACTIVE'>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const [employeeId, setEmployeeId] = useState('');
  const [loginId, setLoginId] = useState('');
  const [fullName, setFullName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState<DepartmentId | ''>('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [designation, setDesignation] = useState('Sales Executive');
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [uanNumber, setUanNumber] = useState('');
  const [pfNumber, setPfNumber] = useState('');
  const [esicNumber, setEsicNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountMasked, setBankAccountMasked] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedGoogleEmail, setLinkedGoogleEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState<string>(DEFAULT_EMPLOYEE_PASSWORD);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingBackfill, setSyncingBackfill] = useState(false);
  const [bulkProvisioning, setBulkProvisioning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    processed: number;
    total: number;
    provisioned: number;
    failed: number;
    currentName: string;
  } | null>(null);
  const [failedProvisionItems, setFailedProvisionItems] = useState<ProvisionFailureItem[]>([]);
  const [activatingEmployeeId, setActivatingEmployeeId] = useState<string | null>(null);
  const [togglingEmployeeId, setTogglingEmployeeId] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<Employee | null>(null);
  const [toggleReason, setToggleReason] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  // Bulk Department Upload state
  const [showBulkDept, setShowBulkDept] = useState(false);
  const [bulkDeptFileName, setBulkDeptFileName] = useState('');
  const [bulkDeptParse, setBulkDeptParse] = useState<BulkDepartmentParseRow[] | null>(null);
  const [savingBulkDept, setSavingBulkDept] = useState(false);

  const pendingProvisionCount = employees.filter(
    (e) => !e.credentialsProvisioned || !e.authUid,
  ).length;
  const activeLoginCount = employees.length - pendingProvisionCount;
  const unassignedDeptCount = employees.filter((e) => !e.departmentId).length;

  const filtered = employees.filter((e) => {
    const matchesBranch = branchFilter === 'ALL' || e.branchId === branchFilter;
    const matchesDept =
      departmentFilter === 'ALL' ||
      (departmentFilter === 'UNASSIGNED' ? !e.departmentId : e.departmentId === departmentFilter);
    const matchesStatus = statusFilter === 'ALL' || e.status === statusFilter;
    const isPendingAuth = !e.credentialsProvisioned || !e.authUid;
    const matchesAuth =
      authFilter === 'ALL' ||
      (authFilter === 'PENDING' && isPendingAuth) ||
      (authFilter === 'ACTIVE' && !isPendingAuth);
    const q = search.toLowerCase();
    const matchesQuery =
      !q ||
      e.employeeId.toLowerCase().includes(q) ||
      e.loginId.toLowerCase().includes(q) ||
      e.fullName.toLowerCase().includes(q) ||
      e.branchName.toLowerCase().includes(q) ||
      (e.departmentName || '').toLowerCase().includes(q);
    return matchesBranch && matchesDept && matchesStatus && matchesAuth && matchesQuery;
  });

  const openCreate = () => {
    const nextNum = String(employees.length + 1).padStart(3, '0');
    setEditing(null);
    setEmployeeId(`EMP${nextNum}`);
    setLoginId(`HOM${nextNum}`);
    setFullName('');
    setBranchId(branches[0]?.branchId || '');
    setDepartmentId('');
    setPhotoDataUrl('');
    setPhotoError(null);
    setDesignation('Sales Executive');
    setDateOfJoining('');
    setPanNumber('');
    setUanNumber('');
    setPfNumber('');
    setEsicNumber('');
    setBankName('');
    setBankAccountMasked('');
    setBankIfsc('');
    setPhone('');
    setLinkedGoogleEmail('');
    setInitialPassword(DEFAULT_EMPLOYEE_PASSWORD);
    setStatus('ACTIVE');
    setMustChangePassword(true);
    setShowForm(true);
    setFeedback(null);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setEmployeeId(emp.employeeId);
    setLoginId(emp.loginId);
    setFullName(emp.fullName);
    setBranchId(emp.branchId);
    setDepartmentId(emp.departmentId || '');
    setPhotoDataUrl(emp.photoDataUrl || '');
    setPhotoError(null);
    setDesignation(emp.designation);
    setDateOfJoining(emp.dateOfJoining || '');
    setPanNumber(emp.panNumber || '');
    setUanNumber(emp.uanNumber || '');
    setPfNumber(emp.pfNumber || '');
    setEsicNumber(emp.esicNumber || '');
    setBankName(emp.bankName || '');
    setBankAccountMasked(emp.bankAccountMasked || '');
    setBankIfsc(emp.bankIfsc || '');
    setPhone(emp.phone || '');
    setLinkedGoogleEmail(emp.linkedGoogleEmail || '');
    setInitialPassword(emp.credentialsProvisioned ? '' : DEFAULT_EMPLOYEE_PASSWORD);
    setStatus(emp.status);
    setMustChangePassword(emp.credentialsProvisioned ? emp.mustChangePassword : true);
    setShowForm(true);
    setFeedback(null);
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    try {
      const dataUrl = await compressEmployeePhotoToDataUrl(file);
      setPhotoDataUrl(dataUrl);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Unable to process image.');
    } finally {
      e.target.value = '';
    }
  };

  const handleDownloadDeptTemplate = () => {
    const csv = buildDepartmentCsvTemplate(employees);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'House_of_Muktai_Departments_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkDeptFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkDeptFileName(file.name);
    setBulkDeptParse(null);
    setFeedback(null);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        setBulkDeptParse(parseBulkDepartmentCsvText(text, employees));
      } else if (lower.endsWith('.xls')) {
        throw new Error(
          'Legacy Excel 97–2003 (.xls) files are not supported. Please open the file in Excel and Save As .xlsx or .csv, then upload again.',
        );
      } else if (lower.endsWith('.xlsx')) {
        const ExcelJS = await import('exceljs');
        const wb = new ExcelJS.Workbook();
        const buf = await file.arrayBuffer();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error('The Excel file does not contain any worksheet.');

        // Auto-detect header row in first 8 rows (handles company title banner rows)
        let headerRowNumber = 1;
        let bestScore = -1;
        const maxScan = Math.min(8, ws.rowCount);
        for (let r = 1; r <= maxScan; r += 1) {
          let score = 0;
          ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
            const h = String(cell.text || cell.value || '')
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');
            if (
              h.includes('salesmanno') ||
              h.includes('employeeid') ||
              h.includes('empid') ||
              h.includes('department') ||
              h.includes('dept') ||
              h.includes('section')
            ) {
              score += 2;
            }
          });
          if (score > bestScore) {
            bestScore = score;
            headerRowNumber = r;
          }
        }

        const headerRow = ws.getRow(headerRowNumber);
        const normalizedHeaders: string[] = [];
        let maxCol = 1;
        headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
          maxCol = Math.max(maxCol, colNum);
          normalizedHeaders[colNum] = String(cell.text || cell.value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');
        });

        let idCol = 0;
        let deptCol = 0;
        for (let c = 1; c <= maxCol; c += 1) {
          const h = normalizedHeaders[c] || '';
          if (
            !idCol &&
            (h.includes('salesmanno') ||
              h.includes('employeeid') ||
              h.includes('empid') ||
              h === 'id' ||
              h.includes('loginid'))
          ) {
            idCol = c;
          }
          if (!deptCol && (h.includes('department') || h.includes('dept') || h.includes('section'))) {
            deptCol = c;
          }
        }
        const safeIdCol = idCol || 1;
        const safeDeptCol = deptCol || maxCol;

        const rawRows: Array<{ rowNumber: number; employeeId: string; department: string }> = [];
        ws.eachRow((row, rowNumber) => {
          if (rowNumber <= headerRowNumber) return;
          const empIdVal = String(row.getCell(safeIdCol).text || row.getCell(safeIdCol).value || '').trim();
          const deptVal = String(row.getCell(safeDeptCol).text || row.getCell(safeDeptCol).value || '').trim();
          if (!empIdVal && !deptVal) return;
          rawRows.push({ rowNumber, employeeId: empIdVal, department: deptVal });
        });
        setBulkDeptParse(parseBulkDepartmentRows(rawRows, employees));
      } else {
        throw new Error('Please upload a .csv or .xlsx file.');
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to parse department file.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleApplyBulkDepartments = async () => {
    if (!bulkDeptParse) return;
    const readyRows = bulkDeptParse.filter(
      (r): r is BulkDepartmentParseRow & { resolvedDepartment: NonNullable<BulkDepartmentParseRow['resolvedDepartment']> } =>
        (r.status === 'READY' || r.status === 'UNCHANGED') && r.resolvedDepartment !== null,
    );
    if (readyRows.length === 0) return;
    setSavingBulkDept(true);
    setFeedback(null);
    try {
      const res = await bulkUpdateEmployeeDepartments({
        assignments: readyRows.map((r) => ({
          employeeId: r.employeeId,
          departmentId: r.resolvedDepartment.id,
        })),
        allEmployees: employees,
      });

      // Build updated employee list locally to immediately recompute Top-3 Leaderboards
      const deptMap = new Map<string, { id: DepartmentId; name: string }>(
        readyRows.map((r) => [
          r.employeeId.toUpperCase(),
          { id: r.resolvedDepartment.id, name: r.resolvedDepartment.name },
        ]),
      );
      const updatedEmployees = employees.map((emp) => {
        const hit = deptMap.get(emp.employeeId.toUpperCase());
        return hit ? { ...emp, departmentId: hit.id, departmentName: hit.name } : emp;
      });

      let rankNote = '';
      if (incentives.length > 0) {
        const rankRes = await recomputeAndSaveDepartmentRankings({
          employees: updatedEmployees,
          incentives,
          visibilitySettings,
        });
        rankNote = ` Refreshed Top-3 leaderboards for ${rankRes.monthsProcessed} month(s).`;
      }

      setShowBulkDept(false);
      setBulkDeptParse(null);
      setBulkDeptFileName('');
      setFeedback({
        type: 'ok',
        text: `Assigned departments for ${res.updatedCount} employee(s) (${res.activeRegistrySynced} active staff auth profiles synced).${rankNote}`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to apply bulk department assignments.',
      });
    } finally {
      setSavingBulkDept(false);
    }
  };

  const handleBulkProvisionLogins = async () => {
    setBulkProvisioning(true);
    setBulkProgress(null);
    setFailedProvisionItems([]);
    setFeedback(null);
    try {
      const res = await provisionAllPendingEmployeeLogins(employees, {
        onProgress: (p) => setBulkProgress(p),
      });
      setFailedProvisionItems(res.failedItems);
      setFeedback({
        type:
          res.providerDisabled || res.rateLimited || res.failedCount > 0 ? 'warn' : 'ok',
        text: res.message,
      });
      if (res.failedCount > 0) {
        setAuthFilter('PENDING');
      }
      if (res.provisionedCount > 0) {
        await onRefresh();
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to provision employee logins.',
      });
    } finally {
      setBulkProvisioning(false);
      setBulkProgress(null);
    }
  };

  const handleActivateSingleEmployee = async (emp: Employee) => {
    setActivatingEmployeeId(emp.employeeId);
    setFeedback(null);
    try {
      const res = await provisionSingleEmployeeDefaultLogin(emp);
      setFeedback({ type: res.ok ? 'ok' : 'warn', text: res.message });
      if (res.ok) {
        setFailedProvisionItems((prev) =>
          prev.filter((item) => item.employeeId !== emp.employeeId),
        );
        await onRefresh();
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : `Unable to activate ${emp.loginId}.`,
      });
    } finally {
      setActivatingEmployeeId(null);
    }
  };

  const handleBackfillAuthSync = async () => {
    setSyncingBackfill(true);
    setFeedback(null);
    try {
      const res = await backfillAuthUidAndActiveRegistry();
      setFeedback({
        type: 'ok',
        text: `Auth Registry & Legacy Backfill complete: active_auth_uids (+${res.activeRegistryAdded} added / -${res.activeRegistryRemoved} revoked), normalized ${res.legacyRolesNormalized} legacy role(s), backfilled authUid on ${res.incentivesUpdated} incentive(s), ${res.summariesUpdated} summary(ies), ${res.notificationsUpdated} notification(s), ${res.payoutsUpdated} payout(s), ${res.adjustmentsUpdated} adjustment(s), ${res.targetsUpdated} target(s).${
          res.unlinkedEmployeesCount > 0
            ? ` (${res.unlinkedEmployeesCount} employee(s) do not have login credentials provisioned yet.)`
            : ''
        }`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to run Auth Registry & Legacy Backfill.',
      });
    } finally {
      setSyncingBackfill(false);
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!confirmToggle) return;
    const targetStatus = confirmToggle.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setTogglingEmployeeId(confirmToggle.employeeId);
    setFeedback(null);
    try {
      const res = await updateEmployeeStatus({
        employee: confirmToggle,
        targetStatus,
        reason: toggleReason.trim() || undefined,
      });
      setConfirmToggle(null);
      setToggleReason('');
      setFeedback({
        type: 'ok',
        text: `${res.auditAction}: ${confirmToggle.fullName} (${confirmToggle.employeeId}) is now ${targetStatus}. ${
          targetStatus === 'INACTIVE'
            ? 'Employee portal login is blocked while all historical incentives and audit logs remain preserved.'
            : 'Employee portal access and historical incentive visibility are restored.'
        }`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update employee status.',
      });
    } finally {
      setTogglingEmployeeId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const branch = branches.find((b) => b.branchId === branchId);
    if (!branch) {
      setFeedback({ type: 'err', text: 'Please select a valid branch from Branch Master first.' });
      return;
    }
    if (!editing && initialPassword && initialPassword.length < 8) {
      setFeedback({ type: 'err', text: 'Initial password must be at least 8 characters long.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const result = await saveEmployee({
        employeeId,
        loginId,
        fullName,
        branchId: branch.branchId,
        branchName: branch.branchName,
        departmentId,
        photoDataUrl,
        designation,
        dateOfJoining,
        panNumber,
        uanNumber,
        pfNumber,
        esicNumber,
        bankName,
        bankAccountMasked,
        bankIfsc,
        phone,
        linkedGoogleEmail,
        role: 'EMPLOYEE',
        status,
        mustChangePassword,
        initialPassword: initialPassword || undefined,
        existing: editing,
      });

      // If department or photo changed, silently refresh department Top-3 leaderboards
      if (
        incentives.length > 0 &&
        (result.employee.departmentId !== editing?.departmentId ||
          result.employee.photoDataUrl !== editing?.photoDataUrl)
      ) {
        try {
          const updatedList = editing
            ? employees.map((emp) =>
                emp.employeeId === result.employee.employeeId ? result.employee : emp,
              )
            : [...employees, result.employee];
          await recomputeAndSaveDepartmentRankings({
            employees: updatedList,
            incentives,
            visibilitySettings,
          });
        } catch {
          // Non-blocking
        }
      }

      setShowForm(false);
      if (result.provisioningNote && result.provisioningNote.includes('Firebase Console')) {
        setFeedback({ type: 'warn', text: result.provisioningNote });
      } else {
        setFeedback({
          type: 'ok',
          text:
            result.provisioningNote ||
            (editing
              ? `Updated employee ${result.employee.employeeId}.`
              : `Created employee ${result.employee.employeeId}.`),
        });
      }
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save employee.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Unified Employee Controls & Action Button Tray */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
            <ShieldCheck className="w-4 h-4 text-[#0F1F3D] shrink-0" />
            <span className="truncate">
              Default Password:{' '}
              <code className="px-1.5 py-0.5 rounded bg-[#0F1F3D]/[0.07] text-[#0F1F3D] font-mono font-semibold">
                {DEFAULT_EMPLOYEE_PASSWORD}
              </code>
              <span className="hidden sm:inline text-slate-500"> · Mandatory change on first login</span>
            </span>
          </div>

          <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 self-start xl:self-auto">
            {pendingProvisionCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setAuthFilter(authFilter === 'PENDING' ? 'ALL' : 'PENDING')}
                  className={`h-8 px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    authFilter === 'PENDING'
                      ? 'border-amber-500 bg-amber-50 text-amber-900'
                      : 'border-slate-200 bg-white hover:bg-amber-50 text-amber-900'
                  }`}
                >
                  Pending ({pendingProvisionCount})
                </button>
                <button
                  type="button"
                  disabled={bulkProvisioning}
                  onClick={handleBulkProvisionLogins}
                  className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 cursor-pointer transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {bulkProvisioning && bulkProgress
                    ? `Activating ${bulkProgress.processed}/${bulkProgress.total}...`
                    : bulkProvisioning
                      ? 'Activating...'
                      : `Activate Pending (${pendingProvisionCount})`}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={syncingBackfill}
              onClick={handleBackfillAuthSync}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingBackfill ? 'animate-spin' : ''}`} />
              {syncingBackfill ? 'Syncing...' : 'Sync Auth'}
            </button>
            <button
              type="button"
              disabled={filtered.length === 0}
              onClick={() => {
                const branchLabel =
                  branchFilter === 'ALL'
                    ? `All Branches (${branches.length})`
                    : branches.find((b) => b.branchId === branchFilter)?.branchName || branchFilter;
                void downloadCredentialSheetPdf({
                  employees: filtered,
                  branchFilterLabel: branchLabel,
                  portalUrl: getShareableStaffAppUrl(),
                });
              }}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-[#0F1F3D]" />
              Credentials PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setShowBulkDept((prev) => !prev);
                setBulkDeptParse(null);
                setBulkDeptFileName('');
              }}
              className={`h-8 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                showBulkDept
                  ? 'border-[#B8923A] bg-[#B8923A]/15 text-[#0F1F3D]'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-[#0F1F3D]'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#B8923A]" />
              Bulk Dept. Upload
            </button>
            <button
              type="button"
              onClick={openCreate}
              disabled={branches.length === 0}
              className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Employee
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search ID, Login ID, name, dept..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
            />
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Filter by branch"
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-700"
          >
            <option value="ALL">All Branches ({branches.length})</option>
            {branches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchCode} — {b.branchName}
              </option>
            ))}
          </select>
          <select
            value={departmentFilter}
            onChange={(e) =>
              setDepartmentFilter(e.target.value as 'ALL' | 'UNASSIGNED' | DepartmentId)
            }
            aria-label="Filter by department"
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-700"
          >
            <option value="ALL">All Departments (5)</option>
            <option value="UNASSIGNED">Unassigned ({unassignedDeptCount})</option>
            {OFFICIAL_DEPARTMENTS.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
            aria-label="Filter by status"
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-700"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>
          <select
            value={authFilter}
            onChange={(e) => setAuthFilter(e.target.value as 'ALL' | 'PENDING' | 'ACTIVE')}
            aria-label="Filter by login provisioning"
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-700"
          >
            <option value="ALL">All Logins ({employees.length})</option>
            <option value="PENDING">Pending ({pendingProvisionCount})</option>
            <option value="ACTIVE">Active ({activeLoginCount})</option>
          </select>
        </div>
      </div>

      {/* Bulk Department Assignment Drawer (Excel / CSV) */}
      {showBulkDept && (
        <div className="bg-white border border-[#0F1F3D]/25 rounded-xl overflow-hidden shadow-xs">
          <div className="px-4 sm:px-5 py-3.5 bg-[#0F1F3D] text-white flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                Bulk Department Assignment · 5 Retail Textile Departments
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Saree Dept. · Ladies Wear Dept. · Kids Wear Dept. · Mens Wear Dept. · Non Apparels Dept.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBulkDept(false)}
              className="p-1.5 text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close bulk department upload"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#0F1F3D]">
                    Step 1 · Download Pre-Filled Employee Sheet
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Opens in Excel with all {employees.length} employees pre-listed. Fill the{' '}
                    <code className="font-mono text-[#0F1F3D]">Department</code> column (e.g.,{' '}
                    <strong>Kids Wear Dept.</strong>, <strong>Saree Dept.</strong>).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadDeptTemplate}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center justify-center gap-1.5 self-start cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#B8923A]" />
                  Download Pre-Filled CSV Template
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#0F1F3D]">
                    Step 2 · Upload Filled Excel (.xlsx) or CSV (.csv)
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Automatically matches Employee IDs & maps spelling variants (e.g. Lediesware →
                    Ladies Wear Dept., Kids ware → Kids Wear Dept.).
                  </p>
                </div>
                <label className="h-9 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 self-start cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#DFC27D]" />
                  <span>{bulkDeptFileName ? `Replace: ${bulkDeptFileName}` : 'Choose Excel / CSV File'}</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={handleBulkDeptFileSelect}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {bulkDeptParse && (() => {
              const validRows = bulkDeptParse.filter(
                (r) => (r.status === 'READY' || r.status === 'UNCHANGED') && r.resolvedDepartment,
              );
              const errorRows = bulkDeptParse.filter(
                (r) => r.status === 'UNKNOWN_EMPLOYEE' || r.status === 'INVALID_DEPARTMENT',
              );
              return (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-semibold text-emerald-700">
                        Valid Matches: {validRows.length}
                      </span>
                      <span className="text-slate-300">|</span>
                      <span
                        className={`font-semibold ${
                          errorRows.length > 0 ? 'text-amber-700' : 'text-slate-500'
                        }`}
                      >
                        Skipped / Issues: {errorRows.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={savingBulkDept || validRows.length === 0}
                      onClick={handleApplyBulkDepartments}
                      className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      {savingBulkDept
                        ? 'Saving & Refreshing Leaderboards...'
                        : `Apply ${validRows.length} Department(s) & Refresh Top-3`}
                    </button>
                  </div>

                  {errorRows.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1 max-h-36 overflow-y-auto">
                      <p className="font-semibold">Rows skipped due to validation issues:</p>
                      {errorRows.slice(0, 15).map((err) => (
                        <div key={`${err.rowNumber}-${err.employeeId}`} className="font-mono text-[11px]">
                          Row {err.rowNumber}: [{err.employeeId || 'blank'} / {err.rawDepartment || 'blank'}] — {err.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {validRows.length > 0 && (
                    <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <tr>
                            <th className="py-2 px-3">Emp ID</th>
                            <th className="py-2 px-3">Employee Name</th>
                            <th className="py-2 px-3">Branch</th>
                            <th className="py-2 px-3">Assigned Department</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {validRows.slice(0, 50).map((row) => (
                            <tr key={`${row.rowNumber}-${row.employeeId}`} className="hover:bg-slate-50">
                              <td className="py-1.5 px-3 font-mono text-slate-900">{row.employeeId}</td>
                              <td className="py-1.5 px-3 font-medium text-slate-800">{row.employeeName}</td>
                              <td className="py-1.5 px-3 text-slate-600">{row.branchName}</td>
                              <td className="py-1.5 px-3 font-semibold text-[#0F1F3D]">
                                {row.resolvedDepartment?.name}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {bulkProvisioning && bulkProgress && (
        <div className="p-4 rounded-xl bg-slate-900 text-white text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              Activating logins ({bulkProgress.processed} / {bulkProgress.total}) —{' '}
              <span className="text-amber-300">{bulkProgress.currentName || 'Finishing...'}</span>
            </span>
            <span className="font-mono">
              Activated: {bulkProgress.provisioned} · Failed: {bulkProgress.failed}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#B8923A] to-[#DFC27D] transition-all"
              style={{
                width: `${Math.min(100, Math.round((bulkProgress.processed / Math.max(1, bulkProgress.total)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {branches.length === 0 && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          Initialize branches in <strong>Branch Master</strong> before creating employees.
        </div>
      )}

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm leading-relaxed ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : feedback.type === 'warn'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {failedProvisionItems.length > 0 && (
        <div className="bg-white border border-amber-300 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-amber-950">
                Pending / Failed Login Activations ({failedProvisionItems.length})
              </h3>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Exact reason for each employee below. If rate-limited by Firebase, wait 5–10 minutes
                and click <strong>Activate All Pending</strong> again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFailedProvisionItems([])}
              className="text-xs font-medium text-amber-900 hover:underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-2 px-3">Salesman No</th>
                  <th className="py-2 px-3">Login ID</th>
                  <th className="py-2 px-3">Employee Name</th>
                  <th className="py-2 px-3">Branch</th>
                  <th className="py-2 px-3">Error Code</th>
                  <th className="py-2 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {failedProvisionItems.map((item) => (
                  <tr key={item.employeeId} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono text-slate-900">{item.employeeId}</td>
                    <td className="py-2 px-3 font-mono text-slate-700">{item.loginId}</td>
                    <td className="py-2 px-3 font-medium text-slate-900">{item.fullName}</td>
                    <td className="py-2 px-3 text-slate-600">{item.branchName}</td>
                    <td className="py-2 px-3 font-mono text-amber-800">{item.errorCode}</td>
                    <td className="py-2 px-3 text-slate-600">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inline Status Change Confirmation Drawer */}
      {confirmToggle && (
        <div className="bg-white border border-[#0F1F3D]/30 rounded-xl p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Confirm Super Admin{' '}
                {confirmToggle.status === 'ACTIVE' ? 'Deactivation' : 'Reactivation'} ·{' '}
                {confirmToggle.fullName} ({confirmToggle.employeeId})
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                {confirmToggle.status === 'ACTIVE'
                  ? 'Deactivating this employee will immediately block their Employee Portal login. Their employee profile, historical incentive statements, and audit logs will remain safely preserved.'
                  : 'Reactivating this employee will immediately restore Employee Portal login and full access to all historical incentives.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setConfirmToggle(null);
                setToggleReason('');
              }}
              className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Optional audit note (e.g., Resigned, Extended leave, Rejoined)..."
              value={toggleReason}
              onChange={(e) => setToggleReason(e.target.value)}
              className="flex-1 h-9 px-3 rounded-lg border border-slate-300 text-xs text-slate-900"
            />
            <button
              type="button"
              disabled={togglingEmployeeId === confirmToggle.employeeId}
              onClick={handleConfirmStatusChange}
              className={`h-9 px-4 rounded-lg text-white text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                confirmToggle.status === 'ACTIVE'
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              {togglingEmployeeId === confirmToggle.employeeId
                ? 'Updating...'
                : confirmToggle.status === 'ACTIVE'
                  ? 'Confirm Deactivate Employee'
                  : 'Confirm Reactivate Employee'}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              {editing ? `Edit Employee · ${editing.employeeId}` : 'Create Employee Account'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Employee ID (Salesman No)
              </label>
              <input
                type="text"
                required
                disabled={Boolean(editing)}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                placeholder="459"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Assigned Login ID
              </label>
              <input
                type="text"
                required
                value={loginId}
                onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                placeholder="HOM459"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Employee full name"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Branch</label>
              <select
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.branchCode} — {b.branchName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Department (Top-3 Sales Leaderboard)
              </label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value as DepartmentId | '')}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                <option value="">— Unassigned —</option>
                {OFFICIAL_DEPARTMENTS.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Designation</label>
              <input
                type="text"
                required
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98XXXXXXXX"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Initial Login Password{' '}
                {editing?.credentialsProvisioned
                  ? '(Already Provisioned)'
                  : `(Default: ${DEFAULT_EMPLOYEE_PASSWORD})`}
              </label>
              <input
                type="text"
                disabled={Boolean(editing?.credentialsProvisioned)}
                value={initialPassword}
                onChange={(e) => setInitialPassword(e.target.value)}
                placeholder={
                  editing?.credentialsProvisioned
                    ? 'Credentials active'
                    : DEFAULT_EMPLOYEE_PASSWORD
                }
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Linked Google Email (Optional)
              </label>
              <input
                type="email"
                value={linkedGoogleEmail}
                onChange={(e) => setLinkedGoogleEmail(e.target.value)}
                placeholder="employee@gmail.com"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                <div className="w-full h-10 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 flex items-center">
                  Employee (Staff Portal)
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Status (Super Admin)
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className="w-full h-10 px-2.5 rounded-lg border border-slate-300 bg-white text-sm"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </div>

            {/* Employee Photo Uploader (Auto-cropped square thumbnail for Top-3 Leaderboard) */}
            <div className="md:col-span-2 lg:col-span-3 pt-1">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Employee Photo (Shown on Department Top-3 Leaderboard · Auto-cropped 160×160)
              </label>
              <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-12 h-12 rounded-full bg-[#0F1F3D] text-[#DFC27D] font-bold text-sm flex items-center justify-center overflow-hidden border-2 border-[#B8923A]/50 shrink-0">
                  {photoDataUrl ? (
                    <img
                      src={photoDataUrl}
                      alt={fullName || 'Employee preview'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{(fullName || 'EM').slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer">
                    <Camera className="w-3.5 h-3.5 text-[#B8923A]" />
                    <span>{photoDataUrl ? 'Change Photo' : 'Upload Photo'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoFileChange}
                      className="hidden"
                    />
                  </label>
                  {photoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setPhotoDataUrl('')}
                      className="h-9 px-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-medium text-red-700 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  )}
                  <span className="text-[11px] text-slate-500">
                    JPG / PNG / WebP · Compressed automatically for fast mobile load
                  </span>
                </div>
                {photoError && (
                  <p className="w-full text-xs text-red-700 font-medium">{photoError}</p>
                )}
              </div>
            </div>

            {/* HR, Statutory & Bank Details (Optional — Printed on Official Salary Slips & Auto-Synced) */}
            <div className="md:col-span-2 lg:col-span-3 pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-[#0F1F3D] mb-2.5">
                HR, Statutory &amp; Bank Details{' '}
                <span className="font-normal text-slate-500">
                  (Optional · Printed on Salary Slips · Bank Account auto-masked as XXXX1234)
                </span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Date of Joining (DOJ)
                  </label>
                  <input
                    type="date"
                    value={dateOfJoining}
                    onChange={(e) => setDateOfJoining(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    PAN Number
                  </label>
                  <input
                    type="text"
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                    placeholder="ABCDE1234F"
                    maxLength={20}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    UAN Number
                  </label>
                  <input
                    type="text"
                    value={uanNumber}
                    onChange={(e) => setUanNumber(e.target.value)}
                    placeholder="100123456789"
                    maxLength={24}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    PF Number
                  </label>
                  <input
                    type="text"
                    value={pfNumber}
                    onChange={(e) => setPfNumber(e.target.value)}
                    placeholder="MH/PUN/12345"
                    maxLength={32}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    ESIC Number
                  </label>
                  <input
                    type="text"
                    value={esicNumber}
                    onChange={(e) => setEsicNumber(e.target.value)}
                    placeholder="31-00-123456"
                    maxLength={32}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="State Bank of India"
                    maxLength={80}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Bank Account (Auto-Masked)
                  </label>
                  <input
                    type="text"
                    value={bankAccountMasked}
                    onChange={(e) => setBankAccountMasked(e.target.value)}
                    placeholder="XXXX1234"
                    maxLength={32}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    IFSC Code
                  </label>
                  <input
                    type="text"
                    value={bankIfsc}
                    onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                    placeholder="SBIN0001234"
                    maxLength={20}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono uppercase"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={mustChangePassword}
                onChange={(e) => setMustChangePassword(e.target.checked)}
                className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
              />
              Require password change on first employee sign-in
            </label>

            <button
              type="submit"
              disabled={saving}
              className="h-10 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Employee'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-800 mb-1">No employees match your filter</p>
            <p className="text-xs text-slate-500">
              Create employee accounts or register new candidates during ERP Excel import.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Salesman No</th>
                  <th className="py-3 px-4">Login ID</th>
                  <th className="py-3 px-4">Employee Name</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Auth Provisioning</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((emp) => (
                  <tr key={emp.employeeId} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-slate-900">
                      {emp.employeeId}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">{emp.loginId}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#0F1F3D] text-[#DFC27D] text-[11px] font-bold flex items-center justify-center overflow-hidden border border-[#B8923A]/40 shrink-0">
                          {emp.photoDataUrl ? (
                            <img
                              src={emp.photoDataUrl}
                              alt={emp.fullName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>
                              {emp.fullName
                                .split(' ')
                                .map((s) => s[0])
                                .join('')
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">{emp.fullName}</div>
                          <div className="text-xs text-slate-500 truncate">{emp.designation}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{emp.branchName}</td>
                    <td className="py-3 px-4 text-xs">
                      {emp.departmentName ? (
                        <span className="font-semibold text-[#0F1F3D]">{emp.departmentName}</span>
                      ) : (
                        <span className="text-amber-700 font-medium">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {emp.credentialsProvisioned ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <UserCheck className="w-3.5 h-3.5" />
                          Login ID Active
                        </span>
                      ) : emp.linkedGoogleEmail ? (
                        <span className="text-slate-600">Google Linked</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <KeyRound className="w-3.5 h-3.5" />
                          Pending Password
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold ${
                          emp.status === 'ACTIVE' ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {emp.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-3">
                        {(!emp.credentialsProvisioned || !emp.authUid) && (
                          <button
                            type="button"
                            disabled={activatingEmployeeId === emp.employeeId}
                            onClick={() => handleActivateSingleEmployee(emp)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#0F1F3D] hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            {activatingEmployeeId === emp.employeeId ? 'Activating...' : 'Activate'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmToggle(emp);
                            setToggleReason('');
                          }}
                          className={`inline-flex items-center gap-1 text-xs font-medium cursor-pointer ${
                            emp.status === 'ACTIVE'
                              ? 'text-red-700 hover:underline'
                              : 'text-emerald-700 hover:underline'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                          {emp.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(emp)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-[#0F1F3D] cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
