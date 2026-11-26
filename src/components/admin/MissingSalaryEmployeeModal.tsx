import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  RefreshCw,
  Search,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { OFFICIAL_DEPARTMENTS } from '../../lib/departmentLeaderboardEngine';
import { formatINRFromPaise } from '../../lib/format';
import {
  findSuggestedMasterEmployeesForSalaryRow,
  type ParsedSalaryRow,
} from '../../lib/salarySlipEngine';
import { saveEmployee } from '../../services/incentiveService';
import type { Branch, DepartmentId, Employee } from '../../types/incentive';

export type MissingEmployeeActionMode = 'ADD' | 'CHANGE' | 'UPDATE';

interface Props {
  row: ParsedSalaryRow;
  initialMode: MissingEmployeeActionMode;
  branches: Branch[];
  employees: Employee[];
  onClose: () => void;
  /** Called after Add / Change / Update completes so the salary upload preview refreshes immediately. */
  onResolved: (params: {
    mode: MissingEmployeeActionMode;
    rowNumber: number;
    targetEmployeeId: string;
    savedEmployee?: Employee;
    message: string;
  }) => void;
}

function deriveDefaultLoginId(employeeId: string): string {
  const clean = employeeId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!clean) return '';
  if (clean.startsWith('HOM') && clean.length >= 3) return clean.slice(0, 40);
  if (clean.startsWith('EMP') && clean.length >= 4) {
    return `HOM${clean.slice(3)}`.slice(0, 40);
  }
  const candidate = `HOM${clean}`.slice(0, 40);
  return candidate.length >= 3 ? candidate : `${candidate}00`.slice(0, 40);
}

function findMatchingBranchId(rawBranch: string, branches: Branch[]): string {
  if (!branches.length) return '';
  const target = rawBranch.trim().toUpperCase();
  if (target) {
    const exact = branches.find(
      (b) =>
        b.branchName.trim().toUpperCase() === target ||
        b.branchCode.trim().toUpperCase() === target ||
        b.branchId.trim().toUpperCase() === target.replace(/\s+/g, '_'),
    );
    if (exact) return exact.branchId;
    const partial = branches.find(
      (b) =>
        b.branchName.trim().toUpperCase().includes(target) ||
        target.includes(b.branchName.trim().toUpperCase()),
    );
    if (partial) return partial.branchId;
  }
  return branches[0].branchId;
}

export function MissingSalaryEmployeeModal({
  row,
  initialMode,
  branches,
  employees,
  onClose,
  onResolved,
}: Props) {
  const [mode, setMode] = useState<MissingEmployeeActionMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => findSuggestedMasterEmployeesForSalaryRow(row, employees, 6),
    [row, employees],
  );

  const defaultSuggestedEmp = suggestions[0]?.employee || null;

  // --- ADD MODE STATE (pre-filled from uploaded paysheet row) ---
  const [addEmpId, setAddEmpId] = useState<string>(row.employeeId || '');
  const [addFullName, setAddFullName] = useState<string>(
    row.employeeName && row.employeeName !== '—' ? row.employeeName : '',
  );
  const [addSaleId, setAddSaleId] = useState<string>(row.saleId || '');
  const [addBranchId, setAddBranchId] = useState<string>(() =>
    findMatchingBranchId(row.rawBranch, branches),
  );
  const [addDeptType, setAddDeptType] = useState<'SALES' | 'NON_SALES'>(() =>
    row.resolvedDepartment ? 'SALES' : row.customDepartmentName ? 'NON_SALES' : 'SALES',
  );
  const [addDeptId, setAddDeptId] = useState<DepartmentId | ''>(
    row.resolvedDepartment?.id || '',
  );
  const [addCustomDept, setAddCustomDept] = useState<string>(
    row.resolvedDepartment ? '' : row.customDepartmentName || '',
  );
  const [addDesignation, setAddDesignation] = useState<string>(
    row.designation && row.designation !== 'Employee' ? row.designation : 'Sales Executive',
  );
  const [addGender, setAddGender] = useState<string>(row.gender || '');
  const [addCategory, setAddCategory] = useState<string>(row.category || '');
  const [addDoj, setAddDoj] = useState<string>(row.dateOfJoining || '');
  const [addPhone, setAddPhone] = useState<string>('');
  const [addPan, setAddPan] = useState<string>(row.panNumber || '');
  const [addUan, setAddUan] = useState<string>(row.uanNumber || '');
  const [addPf, setAddPf] = useState<string>(row.pfNumber || '');
  const [addEsic, setAddEsic] = useState<string>(row.esicNumber || '');
  const [addBankName, setAddBankName] = useState<string>(row.bankName || '');
  const [addBankAcc, setAddBankAcc] = useState<string>(row.bankAccountMasked || '');
  const [addBankIfsc, setAddBankIfsc] = useState<string>(row.bankIfsc || '');

  // --- CHANGE MODE STATE (remap paysheet row to existing Master Employee or corrected EMP ID) ---
  const [changeSearch, setChangeSearch] = useState<string>('');
  const [selectedChangeEmpId, setSelectedChangeEmpId] = useState<string>(
    defaultSuggestedEmp?.employeeId || '',
  );
  const [manualChangeEmpId, setManualChangeEmpId] = useState<string>(row.employeeId || '');

  // --- UPDATE MODE STATE (select existing Master Employee & update their profile with paysheet values) ---
  const [updateSearch, setUpdateSearch] = useState<string>('');
  const [selectedUpdateEmpId, setSelectedUpdateEmpId] = useState<string>(
    defaultSuggestedEmp?.employeeId || '',
  );
  const selectedUpdateEmp = useMemo(
    () =>
      employees.find(
        (e) => e.employeeId.trim().toUpperCase() === selectedUpdateEmpId.trim().toUpperCase(),
      ) || null,
    [employees, selectedUpdateEmpId],
  );

  const [updFullName, setUpdFullName] = useState<string>(() =>
    defaultSuggestedEmp
      ? defaultSuggestedEmp.fullName
      : row.employeeName !== '—'
        ? row.employeeName
        : '',
  );
  const [updSaleId, setUpdSaleId] = useState<string>(
    () => row.saleId || defaultSuggestedEmp?.saleId || '',
  );
  const [updBranchId, setUpdBranchId] = useState<string>(() => {
    if (row.rawBranch) return findMatchingBranchId(row.rawBranch, branches);
    return defaultSuggestedEmp?.branchId || branches[0]?.branchId || '';
  });
  const [updDeptId, setUpdDeptId] = useState<DepartmentId | ''>(
    () => row.resolvedDepartment?.id || defaultSuggestedEmp?.departmentId || '',
  );
  const [updCustomDept, setUpdCustomDept] = useState<string>(() => {
    if (row.resolvedDepartment) return '';
    if (row.customDepartmentName) return row.customDepartmentName;
    return defaultSuggestedEmp?.departmentId ? '' : defaultSuggestedEmp?.departmentName || '';
  });
  const [updDesignation, setUpdDesignation] = useState<string>(
    () =>
      (row.designation && row.designation !== 'Employee' ? row.designation : '') ||
      defaultSuggestedEmp?.designation ||
      'Sales Executive',
  );
  const [updDoj, setUpdDoj] = useState<string>(
    () => row.dateOfJoining || defaultSuggestedEmp?.dateOfJoining || '',
  );
  const [updBankName, setUpdBankName] = useState<string>(
    () => row.bankName || defaultSuggestedEmp?.bankName || '',
  );
  const [updBankAcc, setUpdBankAcc] = useState<string>(
    () => row.bankAccountMasked || defaultSuggestedEmp?.bankAccountMasked || '',
  );
  const [updBankIfsc, setUpdBankIfsc] = useState<string>(
    () => row.bankIfsc || defaultSuggestedEmp?.bankIfsc || '',
  );
  const [updPan, setUpdPan] = useState<string>(
    () => row.panNumber || defaultSuggestedEmp?.panNumber || '',
  );
  const [updUan, setUpdUan] = useState<string>(
    () => row.uanNumber || defaultSuggestedEmp?.uanNumber || '',
  );
  const [updPf, setUpdPf] = useState<string>(
    () => row.pfNumber || defaultSuggestedEmp?.pfNumber || '',
  );
  const [updEsic, setUpdEsic] = useState<string>(
    () => row.esicNumber || defaultSuggestedEmp?.esicNumber || '',
  );

  const hydrateUpdateFieldsFromEmployee = (emp: Employee) => {
    setSelectedUpdateEmpId(emp.employeeId);
    setUpdFullName(emp.fullName || (row.employeeName !== '—' ? row.employeeName : ''));
    setUpdSaleId(row.saleId || emp.saleId || '');
    setUpdBranchId(
      row.rawBranch ? findMatchingBranchId(row.rawBranch, branches) : emp.branchId,
    );
    setUpdDeptId(row.resolvedDepartment?.id || emp.departmentId || '');
    setUpdCustomDept(
      row.resolvedDepartment
        ? ''
        : row.customDepartmentName || (emp.departmentId ? '' : emp.departmentName || ''),
    );
    setUpdDesignation(
      (row.designation && row.designation !== 'Employee' ? row.designation : '') ||
        emp.designation ||
        'Sales Executive',
    );
    setUpdDoj(row.dateOfJoining || emp.dateOfJoining || '');
    setUpdBankName(row.bankName || emp.bankName || '');
    setUpdBankAcc(row.bankAccountMasked || emp.bankAccountMasked || '');
    setUpdBankIfsc(row.bankIfsc || emp.bankIfsc || '');
    setUpdPan(row.panNumber || emp.panNumber || '');
    setUpdUan(row.uanNumber || emp.uanNumber || '');
    setUpdPf(row.pfNumber || emp.pfNumber || '');
    setUpdEsic(row.esicNumber || emp.esicNumber || '');
    setError(null);
  };

  const filteredChangeEmployees = useMemo(() => {
    const q = changeSearch.trim().toLowerCase();
    if (!q) {
      const suggestedIds = new Set(suggestions.map((s) => s.employee.employeeId));
      return [
        ...suggestions.map((s) => s.employee),
        ...employees.filter((e) => !suggestedIds.has(e.employeeId)).slice(0, 25),
      ];
    }
    return employees
      .filter(
        (e) =>
          e.employeeId.toLowerCase().includes(q) ||
          e.fullName.toLowerCase().includes(q) ||
          (e.saleId || '').toLowerCase().includes(q) ||
          e.branchName.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [changeSearch, employees, suggestions]);

  const filteredUpdateEmployees = useMemo(() => {
    const q = updateSearch.trim().toLowerCase();
    if (!q) {
      const suggestedIds = new Set(suggestions.map((s) => s.employee.employeeId));
      return [
        ...suggestions.map((s) => s.employee),
        ...employees.filter((e) => !suggestedIds.has(e.employeeId)).slice(0, 20),
      ];
    }
    return employees
      .filter(
        (e) =>
          e.employeeId.toLowerCase().includes(q) ||
          e.fullName.toLowerCase().includes(q) ||
          (e.saleId || '').toLowerCase().includes(q) ||
          e.branchName.toLowerCase().includes(q),
      )
      .slice(0, 25);
  }, [updateSearch, employees, suggestions]);

  const handleSaveAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanId = addEmpId.trim();
    if (!cleanId) {
      setError('Please enter a valid Employee ID.');
      return;
    }
    if (!addFullName.trim()) {
      setError('Please enter the Employee Full Name.');
      return;
    }
    const alreadyExists = employees.find(
      (emp) => emp.employeeId.trim().toUpperCase() === cleanId.toUpperCase(),
    );
    if (alreadyExists) {
      setError(
        `Employee ID "${cleanId}" already exists in Master (${alreadyExists.fullName}). Use the "Change" or "Update" tab instead.`,
      );
      return;
    }
    const branch = branches.find((b) => b.branchId === addBranchId);
    if (!branch) {
      setError('Please select a Branch.');
      return;
    }

    setSaving(true);
    try {
      const loginId = deriveDefaultLoginId(cleanId);
      const { employee } = await saveEmployee({
        employeeId: cleanId,
        saleId: addSaleId.trim(),
        loginId,
        fullName: addFullName.trim(),
        branchId: branch.branchId,
        branchName: branch.branchName,
        departmentId: addDeptType === 'SALES' ? addDeptId : '',
        departmentName: addDeptType === 'NON_SALES' ? addCustomDept.trim() : undefined,
        designation: addDesignation.trim() || 'Sales Executive',
        gender: addGender.trim(),
        category: addCategory.trim(),
        dateOfJoining: addDoj.trim(),
        phone: addPhone.trim(),
        panNumber: addPan.trim(),
        uanNumber: addUan.trim(),
        pfNumber: addPf.trim(),
        esicNumber: addEsic.trim(),
        bankName: addBankName.trim(),
        bankAccountMasked: addBankAcc.trim(),
        bankIfsc: addBankIfsc.trim(),
        status: 'ACTIVE',
        mustChangePassword: true,
        existing: null,
      });

      onResolved({
        mode: 'ADD',
        rowNumber: row.rowNumber,
        targetEmployeeId: employee.employeeId,
        savedEmployee: employee,
        message: `Added ${employee.fullName} (EMP ID: ${employee.employeeId}) to Employee Master and validated Row ${row.rowNumber}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add employee to Master.');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyChange = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const chosenId = (selectedChangeEmpId || manualChangeEmpId).trim();
    if (!chosenId) {
      setError('Select an existing Master employee or enter a valid Employee ID.');
      return;
    }
    const matched = employees.find(
      (emp) =>
        emp.employeeId.trim().toUpperCase() === chosenId.toUpperCase() ||
        emp.loginId.trim().toUpperCase() === chosenId.toUpperCase(),
    );
    if (!matched) {
      setError(
        `Employee ID "${chosenId}" is not in Employee Master. Choose an employee from the list or use the "Add" tab to create a new employee.`,
      );
      return;
    }

    onResolved({
      mode: 'CHANGE',
      rowNumber: row.rowNumber,
      targetEmployeeId: matched.employeeId,
      message: `Changed Row ${row.rowNumber} Employee ID from "${row.employeeId || 'blank'}" to "${matched.employeeId}" (${matched.fullName}).`,
    });
  };

  const handleSaveUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedUpdateEmp) {
      setError('Please select an existing Master Employee to update.');
      return;
    }
    if (!updFullName.trim()) {
      setError('Employee Full Name cannot be blank.');
      return;
    }
    const branch = branches.find((b) => b.branchId === updBranchId);
    if (!branch) {
      setError('Please select a Branch.');
      return;
    }

    setSaving(true);
    try {
      const { employee } = await saveEmployee({
        employeeId: selectedUpdateEmp.employeeId,
        saleId: updSaleId.trim(),
        loginId: selectedUpdateEmp.loginId,
        fullName: updFullName.trim(),
        branchId: branch.branchId,
        branchName: branch.branchName,
        departmentId: updDeptId,
        departmentName: updDeptId ? undefined : updCustomDept.trim(),
        designation: updDesignation.trim() || selectedUpdateEmp.designation,
        gender: row.gender || selectedUpdateEmp.gender,
        category: row.category || selectedUpdateEmp.category,
        dateOfJoining: updDoj.trim(),
        panNumber: updPan.trim(),
        uanNumber: updUan.trim(),
        pfNumber: updPf.trim(),
        esicNumber: updEsic.trim(),
        bankName: updBankName.trim(),
        bankAccountMasked: updBankAcc.trim(),
        bankIfsc: updBankIfsc.trim(),
        status: selectedUpdateEmp.status,
        mustChangePassword: selectedUpdateEmp.mustChangePassword,
        existing: selectedUpdateEmp,
      });

      onResolved({
        mode: 'UPDATE',
        rowNumber: row.rowNumber,
        targetEmployeeId: employee.employeeId,
        savedEmployee: employee,
        message: `Updated Master profile for ${employee.fullName} (EMP ID: ${employee.employeeId}) and linked Row ${row.rowNumber}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update Master employee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-[#0F1F3D] text-white relative flex items-start justify-between gap-3">
          <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-[#B8923A] via-[#DFC27D] to-[#B8923A]" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Resolve Missing Employee · Row {row.rowNumber}
            </h3>
            <p className="text-[11px] text-slate-300 mt-0.5 truncate">
              Sheet EMP ID: <span className="font-mono text-[#DFC27D]">{row.employeeId || 'blank'}</span>
              {' · '}
              <span className="font-semibold text-white">{row.employeeName}</span>
              {row.rawBranch ? ` · ${row.rawBranch}` : ''}
              {row.netPayablePaise > 0 ? ` · Net ${formatINRFromPaise(row.netPayablePaise)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3-Tab Mode Switcher (Add / Change / Update) */}
        <div className="px-5 pt-3 pb-2 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('ADD');
              setError(null);
            }}
            className={`h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors border ${
              mode === 'ADD'
                ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:text-emerald-800'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add New</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('CHANGE');
              setError(null);
            }}
            className={`h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors border ${
              mode === 'CHANGE'
                ? 'bg-[#0F1F3D] text-white border-[#0F1F3D] shadow-2xs'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Change ID</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('UPDATE');
              setError(null);
            }}
            className={`h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors border ${
              mode === 'UPDATE'
                ? 'bg-[#B8923A] text-white border-[#B8923A] shadow-2xs'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50 hover:text-amber-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Update Master</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: ADD NEW EMPLOYEE TO MASTER */}
          {mode === 'ADD' && (
            <form id="missing-emp-add-form" onSubmit={(e) => void handleSaveAdd(e)} className="space-y-4">
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-[11px] text-emerald-950">
                Creates this employee directly in <strong>Employee Master</strong> with all details
                extracted from the paysheet and immediately validates Row {row.rowNumber}.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Employee ID <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={addEmpId}
                    onChange={(e) => setAddEmpId(e.target.value)}
                    placeholder="e.g. 3099"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20"
                  />
                  {addEmpId.trim() && addEmpId.trim().toUpperCase() !== row.employeeId.trim().toUpperCase() && (
                    <p className="text-[10px] text-emerald-700 mt-0.5">
                      Row {row.rowNumber} will automatically use new ID {addEmpId.trim()}.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Full Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={addFullName}
                    onChange={(e) => setAddFullName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Branch <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={addBranchId}
                    onChange={(e) => setAddBranchId(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                  >
                    {branches.map((b) => (
                      <option key={b.branchId} value={b.branchId}>
                        {b.branchName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Sales ID (Optional, unique for Sales Staff)
                  </label>
                  <input
                    type="text"
                    value={addSaleId}
                    onChange={(e) => setAddSaleId(e.target.value)}
                    placeholder="Blank for Non-Sales"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Department Category
                  </label>
                  <select
                    value={addDeptType}
                    onChange={(e) => setAddDeptType(e.target.value as 'SALES' | 'NON_SALES')}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                  >
                    <option value="SALES">Official Sales Department (Leaderboard)</option>
                    <option value="NON_SALES">Non-Sales / Support Department</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {addDeptType === 'SALES' ? 'Sales Department' : 'Non-Sales Department Name'}
                  </label>
                  {addDeptType === 'SALES' ? (
                    <select
                      value={addDeptId}
                      onChange={(e) => setAddDeptId(e.target.value as DepartmentId | '')}
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                    >
                      <option value="">Unassigned</option>
                      {OFFICIAL_DEPARTMENTS.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={addCustomDept}
                      onChange={(e) => setAddCustomDept(e.target.value)}
                      placeholder="e.g. Housekeeping, Billing, Accounts"
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={addDesignation}
                    onChange={(e) => setAddDesignation(e.target.value)}
                    placeholder="Sales Executive / Helper / Billing"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Date of Joining (YYYY-MM-DD)
                  </label>
                  <input
                    type="text"
                    value={addDoj}
                    onChange={(e) => setAddDoj(e.target.value)}
                    placeholder="2026-10-01"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Mobile Phone (Optional)
                  </label>
                  <input
                    type="text"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    placeholder="10-digit WhatsApp number"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Gender / Category
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={addGender}
                      onChange={(e) => setAddGender(e.target.value)}
                      placeholder="Gender"
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900"
                    />
                    <input
                      type="text"
                      value={addCategory}
                      onChange={(e) => setAddCategory(e.target.value)}
                      placeholder="Category"
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Pre-filled Bank & Statutory Summary */}
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[11px] font-semibold text-slate-600 mb-2">
                  Bank &amp; Statutory Details (Auto-filled from Paysheet)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    value={addBankName}
                    onChange={(e) => setAddBankName(e.target.value)}
                    placeholder="Bank Name"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                  <input
                    type="text"
                    value={addBankAcc}
                    onChange={(e) => setAddBankAcc(e.target.value)}
                    placeholder="Bank A/C (XXXX1234)"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                  <input
                    type="text"
                    value={addBankIfsc}
                    onChange={(e) => setAddBankIfsc(e.target.value)}
                    placeholder="IFSC Code"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                  <input
                    type="text"
                    value={addPan}
                    onChange={(e) => setAddPan(e.target.value)}
                    placeholder="PAN"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                  <input
                    type="text"
                    value={addUan}
                    onChange={(e) => setAddUan(e.target.value)}
                    placeholder="UAN"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                  <input
                    type="text"
                    value={addPf}
                    onChange={(e) => setAddPf(e.target.value)}
                    placeholder="PF No"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                  <input
                    type="text"
                    value={addEsic}
                    onChange={(e) => setAddEsic(e.target.value)}
                    placeholder="ESIC No"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                </div>
              </div>
            </form>
          )}

          {/* TAB 2: CHANGE EMPLOYEE ID / REMAP TO EXISTING MASTER EMPLOYEE */}
          {mode === 'CHANGE' && (
            <form id="missing-emp-change-form" onSubmit={handleApplyChange} className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                Use <strong>Change ID</strong> if this employee already exists in Employee Master
                under a different Employee ID (for example, a typo or leading-zero mismatch in the
                Excel sheet). This remaps Row {row.rowNumber} immediately without altering Master.
              </div>

              {suggestions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-[#0F1F3D]">
                    Smart Suggestions from Employee Master:
                  </p>
                  <div className="space-y-1.5">
                    {suggestions.slice(0, 4).map((s) => {
                      const active = selectedChangeEmpId === s.employee.employeeId;
                      return (
                        <button
                          key={s.employee.employeeId}
                          type="button"
                          onClick={() => {
                            setSelectedChangeEmpId(s.employee.employeeId);
                            setManualChangeEmpId(s.employee.employeeId);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                            active
                              ? 'bg-[#0F1F3D] text-white border-[#0F1F3D]'
                              : 'bg-emerald-50/60 border-emerald-200 hover:bg-emerald-50 text-slate-900'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold truncate">
                              {s.employee.fullName}{' '}
                              <span className={`font-mono text-[11px] ${active ? 'text-[#DFC27D]' : 'text-slate-600'}`}>
                                ({s.employee.employeeId})
                              </span>
                            </p>
                            <p className={`text-[10px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                              {s.employee.branchName}
                              {s.employee.saleId ? ` · Sale ID: ${s.employee.saleId}` : ''} · {s.reason}
                            </p>
                          </div>
                          {active && <CheckCircle2 className="w-4 h-4 text-[#DFC27D] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Search &amp; Pick Existing Employee from Master
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={changeSearch}
                    onChange={(e) => setChangeSearch(e.target.value)}
                    placeholder="Search by Name, Employee ID, Sale ID, or Branch..."
                    className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {filteredChangeEmployees.map((emp) => {
                    const active = selectedChangeEmpId === emp.employeeId;
                    return (
                      <button
                        key={emp.employeeId}
                        type="button"
                        onClick={() => {
                          setSelectedChangeEmpId(emp.employeeId);
                          setManualChangeEmpId(emp.employeeId);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 cursor-pointer ${
                          active ? 'bg-[#0F1F3D]/10 text-[#0F1F3D] font-semibold' : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-[11px] text-slate-600 mr-2">
                            {emp.employeeId}
                          </span>
                          <span className="truncate">{emp.fullName}</span>
                          <span className="text-[10px] text-slate-500 ml-2">
                            {emp.branchName}
                            {emp.saleId ? ` · Sale ID ${emp.saleId}` : ''}
                          </span>
                        </div>
                        {active && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />}
                      </button>
                    );
                  })}
                  {filteredChangeEmployees.length === 0 && (
                    <p className="p-3 text-center text-xs text-slate-500">
                      No Master employee found matching &ldquo;{changeSearch}&rdquo;.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Selected / Corrected Employee ID for Row {row.rowNumber}
                </label>
                <input
                  type="text"
                  value={manualChangeEmpId}
                  onChange={(e) => {
                    setManualChangeEmpId(e.target.value);
                    setSelectedChangeEmpId(e.target.value);
                  }}
                  placeholder="Enter exact Master Employee ID"
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                />
              </div>
            </form>
          )}

          {/* TAB 3: UPDATE EXISTING MASTER EMPLOYEE WITH PAYSHEET DETAILS & LINK */}
          {mode === 'UPDATE' && (
            <form id="missing-emp-update-form" onSubmit={(e) => void handleSaveUpdate(e)} className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-[11px] text-amber-950">
                Select an existing Master employee to <strong>update their Master profile</strong>{' '}
                (Branch, Department, Sale ID, Bank, Statutory details) from this paysheet and link
                Row {row.rowNumber} to them.
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-slate-700">
                  1. Choose Existing Employee Master Record to Update
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={updateSearch}
                    onChange={(e) => setUpdateSearch(e.target.value)}
                    placeholder="Search Master by Name, ID, or Sale ID..."
                    className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {filteredUpdateEmployees.map((emp) => {
                    const active = selectedUpdateEmpId === emp.employeeId;
                    const sug = suggestions.find((s) => s.employee.employeeId === emp.employeeId);
                    return (
                      <button
                        key={emp.employeeId}
                        type="button"
                        onClick={() => hydrateUpdateFieldsFromEmployee(emp)}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 cursor-pointer ${
                          active ? 'bg-amber-50 text-[#0F1F3D] font-semibold' : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="min-w-0 truncate">
                          <span className="font-mono text-[11px] text-slate-600 mr-2">
                            {emp.employeeId}
                          </span>
                          <span>{emp.fullName}</span>
                          <span className="text-[10px] text-slate-500 ml-2">
                            {emp.branchName}
                            {sug ? ` · ${sug.reason}` : ''}
                          </span>
                        </div>
                        {active && <CheckCircle2 className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedUpdateEmp && (
                <div className="pt-2 border-t border-slate-200 space-y-3">
                  <p className="text-[11px] font-bold text-[#0F1F3D]">
                    2. Review &amp; Update Profile for {selectedUpdateEmp.employeeId}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={updFullName}
                        onChange={(e) => setUpdFullName(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Sales ID
                      </label>
                      <input
                        type="text"
                        value={updSaleId}
                        onChange={(e) => setUpdSaleId(e.target.value)}
                        placeholder="Blank for Non-Sales"
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Branch
                      </label>
                      <select
                        value={updBranchId}
                        onChange={(e) => setUpdBranchId(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                      >
                        {branches.map((b) => (
                          <option key={b.branchId} value={b.branchId}>
                            {b.branchName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Designation
                      </label>
                      <input
                        type="text"
                        value={updDesignation}
                        onChange={(e) => setUpdDesignation(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Sales Department (or leave blank for Non-Sales)
                      </label>
                      <select
                        value={updDeptId}
                        onChange={(e) => setUpdDeptId(e.target.value as DepartmentId | '')}
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                      >
                        <option value="">Non-Sales / Custom</option>
                        {OFFICIAL_DEPARTMENTS.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!updDeptId && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Non-Sales Department Name
                        </label>
                        <input
                          type="text"
                          value={updCustomDept}
                          onChange={(e) => setUpdCustomDept(e.target.value)}
                          placeholder="e.g. Housekeeping, Billing"
                          className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Date of Joining
                      </label>
                      <input
                        type="text"
                        value={updDoj}
                        onChange={(e) => setUpdDoj(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Bank A/C (Masked)
                      </label>
                      <input
                        type="text"
                        value={updBankAcc}
                        onChange={(e) => setUpdBankAcc(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Bank Name
                      </label>
                      <input
                        type="text"
                        value={updBankName}
                        onChange={(e) => setUpdBankName(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        IFSC Code
                      </label>
                      <input
                        type="text"
                        value={updBankIfsc}
                        onChange={(e) => setUpdBankIfsc(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          {mode === 'ADD' && (
            <button
              type="submit"
              form="missing-emp-add-form"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UserPlus className="w-3.5 h-3.5" />
              )}
              <span>{saving ? 'Adding to Master...' : 'Add to Master & Validate Row'}</span>
            </button>
          )}

          {mode === 'CHANGE' && (
            <button
              type="submit"
              form="missing-emp-change-form"
              className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-[#DFC27D]" />
              <span>Apply ID Change</span>
            </button>
          )}

          {mode === 'UPDATE' && (
            <button
              type="submit"
              form="missing-emp-update-form"
              disabled={saving || !selectedUpdateEmp}
              className="h-9 px-4 rounded-lg bg-[#B8923A] hover:bg-[#9E7C2F] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UserCheck className="w-3.5 h-3.5" />
              )}
              <span>{saving ? 'Updating Master...' : 'Update Master & Link Row'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
