import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cake,
  Camera,
  Check,
  ChevronDown,
  Columns,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Gift,
  KeyRound,
  MessageCircle,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import {
  buildBulkDobCsvTemplate,
  extractMonthDayFromDob,
  formatBirthMonthDayLabel,
  getTodayIstParts,
  parseBulkDobCsvText,
  parseBulkDobRows,
  type BulkDobParseRow,
} from '../../lib/birthdayEngine';
import { DEFAULT_EMPLOYEE_PASSWORD, getShareableStaffAppUrl } from '../../lib/companyBrand';
import {
  buildDepartmentCsvTemplate,
  COMMON_NON_SALES_DEPARTMENTS,
  compressEmployeePhotoToDataUrl,
  OFFICIAL_DEPARTMENTS,
  parseBulkDepartmentCsvText,
  parseBulkDepartmentRows,
  type BulkDepartmentParseRow,
} from '../../lib/departmentLeaderboardEngine';
import {
  downloadEmployeeMasterCsvFile,
  downloadEmployeeMasterExcelFile,
  formatSalaryRupeesPlain,
  parseMonthlySalaryToPaise,
} from '../../lib/employeeMasterExport';
import { formatINRFromPaise } from '../../lib/format';
import { downloadCredentialSheetPdf } from '../../lib/pdfGenerator';
import {
  bulkUpdateEmployeeDobs,
  syncAllBirthdayProfilesFromEmployees,
} from '../../services/birthdayService';
import {
  bulkUpdateEmployeeDepartments,
  recomputeAndSaveDepartmentRankings,
  saveEmployeeColumnSettings,
  subscribeEmployeeColumnSettings,
} from '../../services/departmentVisibilityService';
import { useAuth } from '../../context/AuthContext';
import { generateStrongTemporaryPassword } from '../../lib/firebase';
import {
  backfillAuthUidAndActiveRegistry,
  deleteEmployeeByOwner,
  ownerSetEmployeePassword,
  provisionAllPendingEmployeeLogins,
  provisionSingleEmployeeDefaultLogin,
  saveEmployee,
  updateEmployeeStatus,
  type ProvisionFailureItem,
} from '../../services/incentiveService';
import { BirthdayWishingCardModal } from '../common/BirthdayWishingCardModal';
import { BulkEmployeeMasterDrawer } from './BulkEmployeeMasterDrawer';
import { EmployeeProfileDrawer } from './EmployeeProfileDrawer';
import type {
  Branch,
  DepartmentId,
  Employee,
  PortalVisibilitySettings,
  PublishedIncentive,
} from '../../types/incentive';

import type { VoiceFilterCommand } from '../../services/voiceToolExecutor';

interface Props {
  branches: Branch[];
  employees: Employee[];
  incentives?: PublishedIncentive[];
  visibilitySettings?: PortalVisibilitySettings;
  voiceFilter?: VoiceFilterCommand | null;
  onRefresh: () => Promise<void>;
}

const CUSTOM_COLUMNS_STORAGE_KEY = 'hom_emp_master_custom_columns';
const VISIBLE_COLUMNS_STORAGE_KEY = 'hom_emp_master_visible_columns';

const BUILTIN_EXTRA_TABLE_COLUMNS: Array<{ id: string; label: string }> = [
  { id: 'saleId', label: 'Sale ID (POS Code)' },
  { id: 'dateOfJoining', label: 'Date of Joining' },
  { id: 'dateOfExit', label: 'Date of Exit' },
  { id: 'dateOfBirth', label: 'Date of Birth' },
  { id: 'gender', label: 'Gender' },
  { id: 'monthlyGrossSalaryPaise', label: 'Monthly Salary' },
  { id: 'bankName', label: 'Bank Name' },
  { id: 'bankAccountMasked', label: 'Bank Account' },
  { id: 'bankIfsc', label: 'Bank IFSC' },
  { id: 'aadhaarMasked', label: 'Aadhaar (Masked)' },
  { id: 'panNumber', label: 'PAN Number' },
  { id: 'uanNumber', label: 'UAN Number' },
  { id: 'pfNumber', label: 'PF Number' },
  { id: 'esicNumber', label: 'ESIC Number' },
  { id: 'address', label: 'Address' },
  { id: 'emergencyContact', label: 'Emergency Contact' },
];

const VALID_BUILTIN_COLUMN_IDS = new Set(BUILTIN_EXTRA_TABLE_COLUMNS.map((c) => c.id));

function pruneValidVisibleColumns(cols: string[]): string[] {
  return cols.filter((id) => id.startsWith('custom:') || VALID_BUILTIN_COLUMN_IDS.has(id));
}

const QUICK_CUSTOM_COLUMN_SUGGESTIONS = [
  'Reference Name',
  'Vehicle Number',
  'Locker Number',
  'Tally / ERP Code',
];

function loadSavedStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function EmployeeMaster({
  branches,
  employees,
  incentives = [],
  visibilitySettings,
  voiceFilter,
  onRefresh,
}: Props) {
  const { isMainOwner } = useAuth();
  const [confirmDeleteEmp, setConfirmDeleteEmp] = useState<Employee | null>(null);
  const [deleteEmpReason, setDeleteEmpReason] = useState('');
  const [deletingEmpBusy, setDeletingEmpBusy] = useState(false);

  // Main Owner ONLY: Set / Reset Employee Password modal & transient handoff card
  const [pwdTargetEmp, setPwdTargetEmp] = useState<Employee | null>(null);
  const [pwdNewValue, setPwdNewValue] = useState('');
  const [showPwdNewValue, setShowPwdNewValue] = useState(true);
  const [pwdMustChange, setPwdMustChange] = useState(false);
  const [savingEmpPwd, setSavingEmpPwd] = useState(false);
  const [pwdModalErr, setPwdModalErr] = useState<string | null>(null);
  const [updatedEmpCreds, setUpdatedEmpCreds] = useState<{
    employeeId: string;
    fullName: string;
    loginId: string;
    password: string;
    phone?: string;
    mustChangePassword: boolean;
  } | null>(null);
  const [copiedEmpCreds, setCopiedEmpCreds] = useState(false);

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<
    'ALL' | 'UNASSIGNED' | 'NON_SALES' | DepartmentId
  >('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [authFilter, setAuthFilter] = useState<'ALL' | 'PENDING' | 'ACTIVE'>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [profileDrawerEmp, setProfileDrawerEmp] = useState<Employee | null>(null);

  useEffect(() => {
    if (!voiceFilter || voiceFilter.targetTab !== 'employees') return;
    if (voiceFilter.clearFilters) {
      setSearch('');
      setBranchFilter('ALL');
      setDepartmentFilter('ALL');
      setStatusFilter('ALL');
      setAuthFilter('ALL');
      return;
    }
    if (voiceFilter.searchQuery !== undefined) setSearch(voiceFilter.searchQuery);
    if (voiceFilter.branchId !== undefined) setBranchFilter(voiceFilter.branchId);
    if (voiceFilter.department !== undefined) setDepartmentFilter(voiceFilter.department);
    if (
      voiceFilter.status === 'ALL' ||
      voiceFilter.status === 'ACTIVE' ||
      voiceFilter.status === 'INACTIVE'
    ) {
      setStatusFilter(voiceFilter.status);
    }
  }, [voiceFilter]);

  const [employeeId, setEmployeeId] = useState('');
  const [saleId, setSaleId] = useState('');
  const [loginId, setLoginId] = useState('');
  const [fullName, setFullName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState<DepartmentId | ''>('');
  const [customDepartmentName, setCustomDepartmentName] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [designation, setDesignation] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [dateOfExit, setDateOfExit] = useState('');
  const [aadhaarMasked, setAadhaarMasked] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [uanNumber, setUanNumber] = useState('');
  const [pfNumber, setPfNumber] = useState('');
  const [esicNumber, setEsicNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountMasked, setBankAccountMasked] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [monthlyGrossSalaryRupees, setMonthlyGrossSalaryRupees] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [linkedGoogleEmail, setLinkedGoogleEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState<string>(DEFAULT_EMPLOYEE_PASSWORD);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [isBranchManager, setIsBranchManager] = useState(false);
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

  // Custom & Extra Table Columns + Bulk & Export Menu state
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!bulkMenuOpen && !exportMenuOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(ev.target as Node)) {
        setBulkMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(ev.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [bulkMenuOpen, exportMenuOpen]);
  const [savedCustomColumns, setSavedCustomColumns] = useState<string[]>(() =>
    loadSavedStringArray(CUSTOM_COLUMNS_STORAGE_KEY),
  );
  const [visibleExtraColumns, setVisibleExtraColumns] = useState<string[]>(() =>
    pruneValidVisibleColumns(loadSavedStringArray(VISIBLE_COLUMNS_STORAGE_KEY)),
  );
  const [newColumnInput, setNewColumnInput] = useState('');
  const [inlineFormColumnInput, setInlineFormColumnInput] = useState('');
  const latestCustomColsRef = useRef<string[]>(savedCustomColumns);
  const latestVisibleColsRef = useRef<string[]>(visibleExtraColumns);

  latestCustomColsRef.current = savedCustomColumns;
  latestVisibleColsRef.current = visibleExtraColumns;

  const persistColumnConfigToCloud = (nextCustom: string[], nextVisible: string[]) => {
    const cleanVisible = pruneValidVisibleColumns(nextVisible);
    try {
      localStorage.setItem(CUSTOM_COLUMNS_STORAGE_KEY, JSON.stringify(nextCustom));
      localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(cleanVisible));
    } catch {
      // Ignore storage error
    }
    void saveEmployeeColumnSettings({
      customColumns: nextCustom,
      visibleColumns: cleanVisible,
    }).catch(() => {
      // Non-blocking: localStorage retains changes if offline
    });
  };

  useEffect(() => {
    const unsub = subscribeEmployeeColumnSettings((cloud) => {
      if (!cloud) {
        const localCustom = latestCustomColsRef.current;
        const localVisible = pruneValidVisibleColumns(latestVisibleColsRef.current);
        if (localCustom.length > 0 || localVisible.length > 0) {
          void saveEmployeeColumnSettings({
            customColumns: localCustom,
            visibleColumns: localVisible,
          }).catch(() => {
            // Non-blocking
          });
        }
        return;
      }
      const cleanVisible = pruneValidVisibleColumns(cloud.visibleColumns);
      setSavedCustomColumns(cloud.customColumns);
      setVisibleExtraColumns(cleanVisible);
      try {
        localStorage.setItem(CUSTOM_COLUMNS_STORAGE_KEY, JSON.stringify(cloud.customColumns));
        localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(cleanVisible));
      } catch {
        // Ignore storage error
      }
    });
    return () => unsub();
  }, []);

  // Merge user-defined custom columns with any customFields keys present on existing employees
  const allCustomColumnNames = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const addName = (raw: string) => {
      const clean = String(raw || '').trim().slice(0, 60);
      const norm = clean.toLowerCase();
      if (!clean || seen.has(norm) || names.length >= 25) return;
      seen.add(norm);
      names.push(clean);
    };
    for (const c of savedCustomColumns) addName(c);
    for (const emp of employees) {
      for (const k of Object.keys(emp.customFields || {})) {
        addName(k);
      }
    }
    for (const k of Object.keys(customFields)) {
      addName(k);
    }
    return names;
  }, [savedCustomColumns, employees, customFields]);

  const handleToggleExtraColumn = (colId: string) => {
    const prev = latestVisibleColsRef.current;
    const nextVisible = prev.includes(colId)
      ? prev.filter((x) => x !== colId)
      : [...prev, colId];
    setVisibleExtraColumns(nextVisible);
    persistColumnConfigToCloud(latestCustomColsRef.current, nextVisible);
  };

  const handleAddCustomColumn = (rawName: string) => {
    const clean = String(rawName || '').trim().slice(0, 60);
    if (!clean) return;
    const norm = clean.toLowerCase();
    const existingBuiltin = BUILTIN_EXTRA_TABLE_COLUMNS.find(
      (b) => b.label.toLowerCase() === norm || b.id.toLowerCase() === norm,
    );
    if (existingBuiltin) {
      if (!visibleExtraColumns.includes(existingBuiltin.id)) {
        handleToggleExtraColumn(existingBuiltin.id);
      }
      setNewColumnInput('');
      setInlineFormColumnInput('');
      setFeedback({
        type: 'ok',
        text: `Built-in column "${existingBuiltin.label}" is now enabled in the Employee Master table.`,
      });
      return;
    }

    if (allCustomColumnNames.length >= 25 && !allCustomColumnNames.some((c) => c.toLowerCase() === norm)) {
      setFeedback({
        type: 'warn',
        text: 'Maximum 25 custom columns are supported in Employee Master.',
      });
      return;
    }

    const canonicalName =
      allCustomColumnNames.find((c) => c.toLowerCase() === norm) || clean;

    const prevCustom = latestCustomColsRef.current;
    const nextCustom = prevCustom.some((c) => c.toLowerCase() === norm)
      ? prevCustom
      : [...prevCustom, canonicalName];

    const colId = `custom:${canonicalName}`;
    const prevVisible = latestVisibleColsRef.current;
    const nextVisible = prevVisible.includes(colId)
      ? prevVisible
      : [...prevVisible, colId];

    setSavedCustomColumns(nextCustom);
    setVisibleExtraColumns(nextVisible);
    persistColumnConfigToCloud(nextCustom, nextVisible);

    setNewColumnInput('');
    setInlineFormColumnInput('');
  };

  const handleRemoveSavedCustomColumn = (colName: string) => {
    const norm = colName.toLowerCase();
    const nextCustom = latestCustomColsRef.current.filter((c) => c.toLowerCase() !== norm);
    const colId = `custom:${colName}`;
    const nextVisible = latestVisibleColsRef.current.filter((x) => x !== colId);
    setSavedCustomColumns(nextCustom);
    setVisibleExtraColumns(nextVisible);
    persistColumnConfigToCloud(nextCustom, nextVisible);
  };

  // Bulk Employee Master Upload state (Zero Silent Overlap Guard)
  const [showBulkMaster, setShowBulkMaster] = useState(false);

  // Bulk Department Upload state
  const [showBulkDept, setShowBulkDept] = useState(false);
  const [bulkDeptFileName, setBulkDeptFileName] = useState('');
  const [bulkDeptParse, setBulkDeptParse] = useState<BulkDepartmentParseRow[] | null>(null);
  const [savingBulkDept, setSavingBulkDept] = useState(false);

  // Bulk Birthdays (DOB) Upload & Wishing Card Preview state
  const [showBulkDob, setShowBulkDob] = useState(false);
  const [bulkDobFileName, setBulkDobFileName] = useState('');
  const [bulkDobParse, setBulkDobParse] = useState<BulkDobParseRow[] | null>(null);
  const [savingBulkDob, setSavingBulkDob] = useState(false);
  const [syncingBirthdays, setSyncingBirthdays] = useState(false);
  const [previewCardEmp, setPreviewCardEmp] = useState<Employee | null>(null);

  const pendingProvisionCount = employees.filter(
    (e) => !e.credentialsProvisioned || !e.authUid,
  ).length;
  const activeLoginCount = employees.length - pendingProvisionCount;
  const unassignedDeptCount = employees.filter((e) => !e.departmentId && !e.departmentName).length;
  const nonSalesDeptCount = employees.filter((e) => !e.departmentId && Boolean(e.departmentName)).length;

  const masterStats = useMemo(() => {
    let activeCount = 0;
    let inactiveCount = 0;
    for (const emp of employees) {
      if (emp.status === 'ACTIVE') activeCount += 1;
      else inactiveCount += 1;
    }
    return {
      total: employees.length,
      activeCount,
      inactiveCount,
    };
  }, [employees]);

  const filtered = employees.filter((e) => {
    const matchesBranch = branchFilter === 'ALL' || e.branchId === branchFilter;
    const matchesDept =
      departmentFilter === 'ALL' ||
      (departmentFilter === 'UNASSIGNED'
        ? !e.departmentId && !e.departmentName
        : departmentFilter === 'NON_SALES'
          ? !e.departmentId && Boolean(e.departmentName)
          : e.departmentId === departmentFilter);
    const matchesStatus = statusFilter === 'ALL' || e.status === statusFilter;
    const isPendingAuth = !e.credentialsProvisioned || !e.authUid;
    const matchesAuth =
      authFilter === 'ALL' ||
      (authFilter === 'PENDING' && isPendingAuth) ||
      (authFilter === 'ACTIVE' && !isPendingAuth);
    const q = search.toLowerCase();
    const matchesCustomFields =
      q &&
      e.customFields &&
      Object.values(e.customFields).some((v) => String(v || '').toLowerCase().includes(q));
    const matchesQuery =
      !q ||
      e.employeeId.toLowerCase().includes(q) ||
      (e.saleId || '').toLowerCase().includes(q) ||
      e.loginId.toLowerCase().includes(q) ||
      e.fullName.toLowerCase().includes(q) ||
      e.branchName.toLowerCase().includes(q) ||
      (e.departmentName || '').toLowerCase().includes(q) ||
      (e.designation || '').toLowerCase().includes(q) ||
      (e.phone || '').toLowerCase().includes(q) ||
      (e.panNumber || '').toLowerCase().includes(q) ||
      (e.aadhaarMasked || '').toLowerCase().includes(q) ||
      (e.uanNumber || '').toLowerCase().includes(q) ||
      (e.bankName || '').toLowerCase().includes(q) ||
      Boolean(matchesCustomFields);
    return (
      matchesBranch &&
      matchesDept &&
      matchesStatus &&
      matchesAuth &&
      matchesQuery
    );
  });

  const openCreate = () => {
    const nextNum = String(employees.length + 1).padStart(3, '0');
    setEditing(null);
    setEmployeeId(`EMP${nextNum}`);
    setSaleId('');
    setLoginId(`HOM${nextNum}`);
    setFullName('');
    setBranchId(branches[0]?.branchId || '');
    setDepartmentId('');
    setCustomDepartmentName('');
    setPhotoDataUrl('');
    setPhotoError(null);
    setDesignation('');
    setGender('');
    setDateOfBirth('');
    setDateOfJoining('');
    setDateOfExit('');
    setAadhaarMasked('');
    setPanNumber('');
    setUanNumber('');
    setPfNumber('');
    setEsicNumber('');
    setBankName('');
    setBankAccountMasked('');
    setBankIfsc('');
    setMonthlyGrossSalaryRupees('');
    setPhone('');
    setAddress('');
    setEmergencyContact('');
    setCustomFields({});
    setLinkedGoogleEmail('');
    setInitialPassword(DEFAULT_EMPLOYEE_PASSWORD);
    setStatus('ACTIVE');
    setMustChangePassword(true);
    setIsBranchManager(false);
    setShowForm(true);
    setFeedback(null);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setEmployeeId(emp.employeeId);
    setSaleId(emp.saleId || '');
    setLoginId(emp.loginId);
    setFullName(emp.fullName);
    setBranchId(emp.branchId);
    setDepartmentId(emp.departmentId || '');
    setCustomDepartmentName(!emp.departmentId ? emp.departmentName || '' : '');
    setPhotoDataUrl(emp.photoDataUrl || '');
    setPhotoError(null);
    setDesignation(emp.designation);
    setGender(emp.gender || '');
    setDateOfBirth(emp.dateOfBirth || '');
    setDateOfJoining(emp.dateOfJoining || '');
    setDateOfExit(emp.dateOfExit || '');
    setAadhaarMasked(emp.aadhaarMasked || '');
    setPanNumber(emp.panNumber || '');
    setUanNumber(emp.uanNumber || '');
    setPfNumber(emp.pfNumber || '');
    setEsicNumber(emp.esicNumber || '');
    setBankName(emp.bankName || '');
    setBankAccountMasked(emp.bankAccountMasked || '');
    setBankIfsc(emp.bankIfsc || '');
    setMonthlyGrossSalaryRupees(formatSalaryRupeesPlain(emp.monthlyGrossSalaryPaise));
    setPhone(emp.phone || '');
    setAddress(emp.address || '');
    setEmergencyContact(emp.emergencyContact || '');
    setCustomFields({ ...(emp.customFields || {}) });
    setLinkedGoogleEmail(emp.linkedGoogleEmail || '');
    setInitialPassword(emp.credentialsProvisioned ? '' : DEFAULT_EMPLOYEE_PASSWORD);
    setStatus(emp.status);
    setMustChangePassword(emp.credentialsProvisioned ? emp.mustChangePassword : true);
    setIsBranchManager(Boolean(emp.isBranchManager));
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

  const handleDownloadDobTemplate = () => {
    const csv = buildBulkDobCsvTemplate(employees);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'House_of_Muktai_Birthdays_DOB_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkDobFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkDobFileName(file.name);
    setBulkDobParse(null);
    setFeedback(null);
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        setBulkDobParse(parseBulkDobCsvText(text, employees));
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
              h.includes('dateofbirth') ||
              h === 'dob' ||
              h.includes('birthday')
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
        const headers: string[] = [];
        let maxCol = 1;
        headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
          maxCol = Math.max(maxCol, colNum);
          headers[colNum] = String(cell.text || cell.value || '').trim();
        });

        const objects: Array<Record<string, unknown>> = [];
        ws.eachRow((row, rowNumber) => {
          if (rowNumber <= headerRowNumber) return;
          const obj: Record<string, unknown> = {};
          let hasAny = false;
          for (let c = 1; c <= maxCol; c += 1) {
            const h = headers[c];
            if (!h) continue;
            const cell = row.getCell(c);
            const rawVal = cell.value instanceof Date ? cell.value : cell.text || cell.value || '';
            if (rawVal !== '' && rawVal !== null && rawVal !== undefined) hasAny = true;
            obj[h] = rawVal;
          }
          if (hasAny) objects.push(obj);
        });
        setBulkDobParse(parseBulkDobRows(objects, employees));
      } else {
        throw new Error('Please upload a .csv or .xlsx file.');
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to parse DOB file.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleApplyBulkDobs = async () => {
    if (!bulkDobParse) return;
    const validRows = bulkDobParse.filter((r) => r.status === 'VALID' && r.normalizedDob);
    if (validRows.length === 0) return;
    setSavingBulkDob(true);
    setFeedback(null);
    try {
      const res = await bulkUpdateEmployeeDobs(validRows, employees);
      setShowBulkDob(false);
      setBulkDobParse(null);
      setBulkDobFileName('');
      setFeedback({
        type: 'ok',
        text: `Updated Date of Birth for ${res.updatedCount} employee(s) and synced ${res.syncedProfiles} active 12-branch birthday profile(s).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to apply bulk Date of Birth update.',
      });
    } finally {
      setSavingBulkDob(false);
    }
  };

  const handleSyncBirthdayDirectory = async () => {
    setSyncingBirthdays(true);
    setFeedback(null);
    try {
      const res = await syncAllBirthdayProfilesFromEmployees(employees);
      setFeedback({
        type: 'ok',
        text: `12-Branch Birthday Directory synced: ${res.synced} active birthday profile(s) published, ${res.removed} inactive/cleared profile(s) removed.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to sync 12-branch birthday directory.',
      });
    } finally {
      setSyncingBirthdays(false);
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
      const res = await provisionSingleEmployeeDefaultLogin(emp, employees);
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

  const openSetEmployeePasswordModal = (emp: Employee) => {
    setPwdTargetEmp(emp);
    setPwdNewValue('');
    setShowPwdNewValue(true);
    setPwdMustChange(false);
    setPwdModalErr(null);
  };

  const handleSaveEmployeePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdTargetEmp) return;
    const cleanPwd = pwdNewValue.trim();
    if (cleanPwd.length < 8) {
      setPwdModalErr('Password must be at least 8 characters long.');
      return;
    }
    setSavingEmpPwd(true);
    setPwdModalErr(null);
    setFeedback(null);
    try {
      const { employee: updatedEmp } = await ownerSetEmployeePassword({
        employee: pwdTargetEmp,
        newPassword: cleanPwd,
        mustChangePassword: pwdMustChange,
      });
      setUpdatedEmpCreds({
        employeeId: updatedEmp.employeeId,
        fullName: updatedEmp.fullName,
        loginId: updatedEmp.loginId,
        password: cleanPwd,
        phone: updatedEmp.phone,
        mustChangePassword: pwdMustChange,
      });
      setCopiedEmpCreds(false);
      setPwdTargetEmp(null);
      setPwdNewValue('');
      setFeedback({
        type: 'ok',
        text: `Main Owner set a new portal password for ${updatedEmp.fullName} (${updatedEmp.loginId}). Previous password is revoked immediately.`,
      });
      await onRefresh();
    } catch (err) {
      setPwdModalErr(
        err instanceof Error ? err.message : `Unable to set password for ${pwdTargetEmp.loginId}.`,
      );
    } finally {
      setSavingEmpPwd(false);
    }
  };

  const buildEmployeeCredsMessage = (creds: {
    fullName: string;
    loginId: string;
    password: string;
    mustChangePassword: boolean;
  }) => {
    const portalUrl = getShareableStaffAppUrl();
    return [
      'House of Muktai — Employee Portal Login',
      `Name: ${creds.fullName}`,
      `Login ID: ${creds.loginId}`,
      `Password: ${creds.password}`,
      ...(portalUrl ? [`Portal Link: ${portalUrl}`] : []),
      creds.mustChangePassword
        ? 'Note: Please change your password after signing in.'
        : 'Note: Keep your password private. You can change it anytime from your Employee Portal.',
    ].join('\n');
  };

  const handleCopyEmployeeCreds = async (creds: {
    fullName: string;
    loginId: string;
    password: string;
    mustChangePassword: boolean;
  }) => {
    const text = buildEmployeeCredsMessage(creds);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEmpCreds(true);
      window.setTimeout(() => setCopiedEmpCreds(false), 2500);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedEmpCreds(true);
        window.setTimeout(() => setCopiedEmpCreds(false), 2500);
      } catch {
        setCopiedEmpCreds(false);
      }
    }
  };

  const buildWhatsAppCredsUrl = (creds: {
    fullName: string;
    loginId: string;
    password: string;
    phone?: string;
    mustChangePassword: boolean;
  }): string | null => {
    const digits = String(creds.phone || '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    const normalized = digits.length === 10 ? `91${digits}` : digits;
    const msg = buildEmployeeCredsMessage(creds);
    return `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`;
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
      const parsedSalaryPaise = monthlyGrossSalaryRupees.trim()
        ? parseMonthlySalaryToPaise(monthlyGrossSalaryRupees)
        : 0;
      const result = await saveEmployee({
        employeeId,
        saleId,
        loginId,
        fullName,
        branchId: branch.branchId,
        branchName: branch.branchName,
        departmentId,
        departmentName: departmentId ? undefined : customDepartmentName.trim(),
        photoDataUrl,
        designation,
        gender,
        dateOfBirth,
        dateOfJoining,
        dateOfExit,
        aadhaarMasked,
        panNumber,
        uanNumber,
        pfNumber,
        esicNumber,
        bankName,
        bankAccountMasked,
        bankIfsc,
        monthlyGrossSalaryPaise: parsedSalaryPaise,
        phone,
        address,
        emergencyContact,
        customFields,
        linkedGoogleEmail,
        role: 'EMPLOYEE',
        isBranchManager,
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

  const handleExportMasterExcel = async (scope: 'filtered' | 'all') => {
    const targetList = scope === 'filtered' ? filtered : employees;
    if (targetList.length === 0) return;
    setExportMenuOpen(false);
    setExportingExcel(true);
    try {
      const scopeLabel =
        scope === 'all'
          ? 'All_Branches'
          : branchFilter === 'ALL'
            ? 'Filtered'
            : branches.find((b) => b.branchId === branchFilter)?.branchCode || 'Branch';
      await downloadEmployeeMasterExcelFile({
        employees: targetList,
        branches,
        extraCustomColumns: allCustomColumnNames,
        scopeLabel,
      });
      setFeedback({
        type: 'ok',
        text: `Exported ${targetList.length} employee master record(s) with Branch HR Summary to Excel (.xlsx).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to generate Employee Master Excel export.',
      });
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportMasterCsv = (scope: 'filtered' | 'all') => {
    const targetList = scope === 'filtered' ? filtered : employees;
    if (targetList.length === 0) return;
    setExportMenuOpen(false);
    const scopeLabel =
      scope === 'all'
        ? 'All_Branches'
        : branchFilter === 'ALL'
          ? 'Filtered'
          : branches.find((b) => b.branchId === branchFilter)?.branchCode || 'Branch';
    downloadEmployeeMasterCsvFile(targetList, allCustomColumnNames, scopeLabel);
    setFeedback({
      type: 'ok',
      text: `Exported ${targetList.length} employee master record(s) to CSV (.csv).`,
    });
  };

  return (
    <div className="space-y-4">
      {/* Compact Employee Master Controls & Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 min-w-0 tabular-nums">
            <span className="font-semibold text-[#0F1F3D]">
              Total: {masterStats.total}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-emerald-700 font-medium">
              {masterStats.activeCount} Active
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">
              {masterStats.inactiveCount} Inactive
            </span>
            <span className="text-slate-300 hidden sm:inline">·</span>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-[#0F1F3D]" />
              Default Password:{' '}
              <code className="px-1.5 py-0.5 rounded bg-[#0F1F3D]/[0.07] text-[#0F1F3D] font-mono font-semibold">
                {DEFAULT_EMPLOYEE_PASSWORD}
              </code>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start xl:self-auto">
            {pendingProvisionCount > 0 && (
              <button
                type="button"
                disabled={bulkProvisioning}
                onClick={handleBulkProvisionLogins}
                className="h-9 px-3 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer transition-colors"
                title="Create Firebase Auth logins for all pending employees"
              >
                <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                {bulkProvisioning && bulkProgress
                  ? `Activating ${bulkProgress.processed}/${bulkProgress.total}...`
                  : bulkProvisioning
                    ? 'Activating...'
                    : `Activate Pending (${pendingProvisionCount})`}
              </button>
            )}

            {/* Direct Prominent Import Master Button */}
            <button
              type="button"
              onClick={() => {
                setShowBulkMaster((prev) => !prev);
                setShowBulkDept(false);
                setShowBulkDob(false);
              }}
              className={`h-9 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                showBulkMaster
                  ? 'border-[#0F1F3D] bg-[#0F1F3D] text-white'
                  : 'border-[#B8923A]/60 bg-[#FDF8EC] hover:bg-[#B8923A]/20 text-[#0F1F3D]'
              }`}
            >
              <Upload
                className={`w-3.5 h-3.5 ${showBulkMaster ? 'text-[#DFC27D]' : 'text-[#B8923A]'}`}
              />
              <span>Import Excel / CSV</span>
            </button>

            {/* Direct Prominent Export Master Dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                disabled={employees.length === 0 || exportingExcel}
                onClick={() => setExportMenuOpen((prev) => !prev)}
                aria-expanded={exportMenuOpen}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#0F1F3D] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#0F1F3D]" />
                <span>{exportingExcel ? 'Exporting...' : 'Export Master'}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white border border-slate-200 shadow-lg py-1.5 z-30">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Excel Workbook (.xlsx · 2 Sheets)
                  </div>
                  <button
                    type="button"
                    disabled={filtered.length === 0}
                    onClick={() => void handleExportMasterExcel('filtered')}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Export Filtered Excel ({filtered.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportMasterExcel('all')}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#0F1F3D] shrink-0" />
                    <span>Export Full Master Excel ({employees.length})</span>
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    CSV &amp; Credentials
                  </div>
                  <button
                    type="button"
                    disabled={filtered.length === 0}
                    onClick={() => handleExportMasterCsv('filtered')}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Export Filtered CSV ({filtered.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportMasterCsv('all')}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Export Full Master CSV ({employees.length})</span>
                  </button>
                  <button
                    type="button"
                    disabled={filtered.length === 0}
                    onClick={() => {
                      setExportMenuOpen(false);
                      const branchLabel =
                        branchFilter === 'ALL'
                          ? `All Branches (${branches.length})`
                          : branches.find((b) => b.branchId === branchFilter)?.branchName ||
                            branchFilter;
                      void downloadCredentialSheetPdf({
                        employees: filtered,
                        branchFilterLabel: branchLabel,
                        portalUrl: getShareableStaffAppUrl(),
                      });
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#B8923A] shrink-0" />
                    <span>Staff Login Credentials PDF ({filtered.length})</span>
                  </button>
                </div>
              )}
            </div>

            {/* Secondary Utilities Dropdown (Dept / DOB / Columns / Auth) */}
            <div className="relative" ref={bulkMenuRef}>
              <button
                type="button"
                onClick={() => setBulkMenuOpen((prev) => !prev)}
                aria-expanded={bulkMenuOpen}
                className={`h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  showBulkDept || showBulkDob || bulkMenuOpen
                    ? 'border-[#0F1F3D] bg-[#0F1F3D] text-white'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span>Bulk Tools</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>
              {bulkMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white border border-slate-200 shadow-lg py-1.5 z-30">
                  <button
                    type="button"
                    onClick={() => {
                      setShowBulkDept((prev) => !prev);
                      setShowBulkMaster(false);
                      setShowBulkDob(false);
                      setBulkDeptParse(null);
                      setBulkDeptFileName('');
                      setBulkMenuOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#B8923A]" />
                    <span>Bulk Department Upload</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBulkDob((prev) => !prev);
                      setShowBulkMaster(false);
                      setShowBulkDept(false);
                      setBulkDobParse(null);
                      setBulkDobFileName('');
                      setBulkMenuOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Cake className="w-3.5 h-3.5 text-[#B8923A]" />
                    <span>Bulk Birthdays (DOB)</span>
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    disabled={syncingBackfill}
                    onClick={() => {
                      setBulkMenuOpen(false);
                      void handleBackfillAuthSync();
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${syncingBackfill ? 'animate-spin' : ''}`} />
                    <span>{syncingBackfill ? 'Syncing Auth...' : 'Sync Auth & Backfill'}</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowColumnManager((prev) => !prev)}
              className={`h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                showColumnManager
                  ? 'border-[#0F1F3D] bg-[#0F1F3D] text-white'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
              }`}
            >
              <Columns
                className={`w-3.5 h-3.5 ${showColumnManager ? 'text-[#DFC27D]' : 'text-[#0F1F3D]'}`}
              />
              Columns ({visibleExtraColumns.length})
            </button>

            <button
              type="button"
              onClick={openCreate}
              disabled={branches.length === 0}
              className="h-9 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5 text-[#DFC27D]" />
              Add Employee
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search ID, Sale ID, name, mobile, PAN, Aadhaar, bank..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
            />
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Filter by branch"
            className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700"
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
              setDepartmentFilter(
                e.target.value as 'ALL' | 'UNASSIGNED' | 'NON_SALES' | DepartmentId,
              )
            }
            aria-label="Filter by department"
            className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700"
          >
            <option value="ALL">All Departments</option>
            <option value="NON_SALES">Non-Sales ({nonSalesDeptCount})</option>
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
            className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active ({masterStats.activeCount})</option>
            <option value="INACTIVE">Inactive ({masterStats.inactiveCount})</option>
          </select>
          <select
            value={authFilter}
            onChange={(e) => setAuthFilter(e.target.value as 'ALL' | 'PENDING' | 'ACTIVE')}
            aria-label="Filter by login status"
            className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700"
          >
            <option value="ALL">All Logins ({employees.length})</option>
            <option value="ACTIVE">Login Active ({activeLoginCount})</option>
            <option value="PENDING">Pending Login ({pendingProvisionCount})</option>
          </select>
        </div>
      </div>

      {/* Add & Manage Employee Master Columns Drawer */}
      {showColumnManager && (
        <div className="bg-white border border-[#0F1F3D]/25 rounded-xl overflow-hidden shadow-xs">
          <div className="px-4 sm:px-5 py-3.5 bg-[#0F1F3D] text-white flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Columns className="w-4 h-4 text-[#DFC27D]" />
                <span>Manage Table Columns</span>
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Add custom fields or toggle HR &amp; Statutory columns across the table, forms, and templates.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowColumnManager(false)}
              className="p-1.5 text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close column manager"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Create New Custom Column */}
            <div className="p-3.5 rounded-xl bg-[#FDF8EC]/70 border border-[#B8923A]/40 space-y-2.5">
              <p className="text-xs font-semibold text-[#0F1F3D]">
                Add Custom Column
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newColumnInput}
                  onChange={(e) => setNewColumnInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomColumn(newColumnInput);
                    }
                  }}
                  placeholder="Enter new column name (e.g. Aadhar No, Blood Group, Base Salary, Weekly Off)..."
                  maxLength={60}
                  className="flex-1 h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => handleAddCustomColumn(newColumnInput)}
                  disabled={!newColumnInput.trim()}
                  className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5 text-[#DFC27D]" />
                  Add Column
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-slate-500 mr-1">Quick Add:</span>
                {QUICK_CUSTOM_COLUMN_SUGGESTIONS.map((sug) => {
                  const alreadyAdded = allCustomColumnNames.some(
                    (c) => c.toLowerCase() === sug.toLowerCase(),
                  );
                  return (
                    <button
                      key={sug}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => handleAddCustomColumn(sug)}
                      className={`px-2 py-0.5 rounded border text-[11px] font-medium transition-colors ${
                        alreadyAdded
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 opacity-75 cursor-default'
                          : 'bg-white border-slate-300 hover:border-[#0F1F3D] text-slate-700 cursor-pointer'
                      }`}
                    >
                      {alreadyAdded ? `✓ ${sug}` : `+ ${sug}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Columns List */}
            {allCustomColumnNames.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#0F1F3D]">
                  2 · Custom Columns ({allCustomColumnNames.length} / 25) — Tick to Show in Table
                </p>
                <div className="flex flex-wrap gap-2">
                  {allCustomColumnNames.map((colName) => {
                    const colId = `custom:${colName}`;
                    const isChecked = visibleExtraColumns.includes(colId);
                    const hasDataOnEmployees = employees.some(
                      (emp) => emp.customFields && emp.customFields[colName],
                    );
                    return (
                      <div
                        key={colName}
                        className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${
                          isChecked
                            ? 'bg-[#0F1F3D]/5 border-[#0F1F3D] text-[#0F1F3D] font-semibold'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleExtraColumn(colId)}
                            className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                          />
                          <span>{colName}</span>
                        </label>
                        {!hasDataOnEmployees && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSavedCustomColumn(colName)}
                            title={`Remove empty custom column "${colName}"`}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Essential Optional Table Columns */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#0F1F3D]">
                  Optional Columns ({BUILTIN_EXTRA_TABLE_COLUMNS.length}) — Tick to Show in Table
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = [
                        ...BUILTIN_EXTRA_TABLE_COLUMNS.map((b) => b.id),
                        ...allCustomColumnNames.map((c) => `custom:${c}`),
                      ];
                      setVisibleExtraColumns(allIds);
                      persistColumnConfigToCloud(latestCustomColsRef.current, allIds);
                    }}
                    className="text-[11px] font-semibold text-[#0F1F3D] hover:underline cursor-pointer"
                  >
                    Show All
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleExtraColumns([]);
                      persistColumnConfigToCloud(latestCustomColsRef.current, []);
                    }}
                    className="text-[11px] font-medium text-slate-500 hover:underline cursor-pointer"
                  >
                    Reset to Default Compact View
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {BUILTIN_EXTRA_TABLE_COLUMNS.map((col) => {
                  const isChecked = visibleExtraColumns.includes(col.id);
                  return (
                    <label
                      key={col.id}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer select-none transition-colors ${
                        isChecked
                          ? 'bg-[#0F1F3D]/5 border-[#0F1F3D] text-[#0F1F3D] font-semibold'
                          : 'bg-slate-50/70 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleExtraColumn(col.id)}
                        className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                      />
                      <span className="truncate">{col.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Employee Master Upload Drawer (Zero Silent Overlap Guard) */}
      {showBulkMaster && (
        <BulkEmployeeMasterDrawer
          branches={branches}
          employees={employees}
          incentives={incentives}
          visibilitySettings={visibilitySettings}
          customColumns={allCustomColumnNames}
          onClose={() => setShowBulkMaster(false)}
          onSuccess={async (message) => {
            setShowBulkMaster(false);
            setFeedback({ type: 'ok', text: message });
            await onRefresh();
          }}
        />
      )}

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
                            <th className="py-2 px-3">Employee ID</th>
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

      {/* Bulk Birthdays (DOB) & 12-Branch Birthday Directory Sync Drawer */}
      {showBulkDob && (
        <div className="bg-white border border-[#0F1F3D]/25 rounded-xl overflow-hidden shadow-xs">
          <div className="px-4 sm:px-5 py-3.5 bg-[#0F1F3D] text-white flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                Bulk Employee Birthdays (DOB) &amp; 12-Branch Wishing Cards
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Privacy-isolated directory: employees see only Day &amp; Month (MM-DD) — Birth Year,
                Phone, PAN &amp; Salary are never shared.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBulkDob(false)}
              className="p-1.5 text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close bulk birthdays upload"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#0F1F3D]">
                    Step 1 · Download Pre-Filled DOB Sheet
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Opens in Excel with active employees pre-listed. Fill{' '}
                    <code className="font-mono text-[#0F1F3D]">YYYY-MM-DD</code> or{' '}
                    <code className="font-mono text-[#0F1F3D]">DD-MM-YYYY</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadDobTemplate}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center justify-center gap-1.5 self-start cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#B8923A]" />
                  Download DOB Template
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#0F1F3D]">
                    Step 2 · Upload Filled Excel (.xlsx) or CSV
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Automatically validates Employee IDs &amp; dates, updates Employee Master, and
                    publishes safe 12-branch profiles.
                  </p>
                </div>
                <label className="h-9 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 self-start cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#DFC27D]" />
                  <span>
                    {bulkDobFileName ? `Replace: ${bulkDobFileName}` : 'Choose Excel / CSV File'}
                  </span>
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={handleBulkDobFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#0F1F3D]">
                    Directory Sync ({employees.filter((e) => e.status === 'ACTIVE' && e.dateOfBirth).length}{' '}
                    Active with DOB)
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Re-syncs all active employee photos, branches &amp; DOBs to the live 12-branch
                    staff birthday feed.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={syncingBirthdays}
                  onClick={handleSyncBirthdayDirectory}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F1F3D] inline-flex items-center justify-center gap-1.5 self-start cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[#B8923A] ${syncingBirthdays ? 'animate-spin' : ''}`} />
                  {syncingBirthdays ? 'Syncing Directory...' : 'Sync 12-Branch Directory'}
                </button>
              </div>
            </div>

            {bulkDobParse && (() => {
              const validRows = bulkDobParse.filter((r) => r.status === 'VALID');
              const errorRows = bulkDobParse.filter((r) => r.status === 'ERROR');
              return (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-semibold text-emerald-700">
                        Valid DOBs: {validRows.length}
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
                      disabled={savingBulkDob || validRows.length === 0}
                      onClick={handleApplyBulkDobs}
                      className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Cake className="w-3.5 h-3.5" />
                      {savingBulkDob
                        ? 'Saving & Syncing Birthdays...'
                        : `Save ${validRows.length} Birthday(s) & Sync 12 Branches`}
                    </button>
                  </div>

                  {errorRows.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1 max-h-36 overflow-y-auto">
                      <p className="font-semibold">Rows skipped due to validation issues:</p>
                      {errorRows.slice(0, 15).map((err) => (
                        <div key={`${err.rowNumber}-${err.employeeId}`} className="font-mono text-[11px]">
                          Row {err.rowNumber}: [{err.employeeId} / {err.rawDob || 'blank'}] — {err.errorMessage}
                        </div>
                      ))}
                    </div>
                  )}

                  {validRows.length > 0 && (
                    <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <tr>
                            <th className="py-2 px-3">Employee ID</th>
                            <th className="py-2 px-3">Employee Name</th>
                            <th className="py-2 px-3">Branch</th>
                            <th className="py-2 px-3">Date of Birth</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {validRows.slice(0, 50).map((row) => (
                            <tr key={`${row.rowNumber}-${row.employeeId}`} className="hover:bg-slate-50">
                              <td className="py-1.5 px-3 font-mono text-slate-900">{row.employeeId}</td>
                              <td className="py-1.5 px-3 font-medium text-slate-800">{row.employeeName}</td>
                              <td className="py-1.5 px-3 text-slate-600">{row.branchName}</td>
                              <td className="py-1.5 px-3 font-mono font-semibold text-[#0F1F3D]">
                                {row.normalizedDob}
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

      {/* Main Owner ONLY: Transient Employee Password Ready Handoff Card */}
      {isMainOwner && updatedEmpCreds && (() => {
        const waUrl = buildWhatsAppCredsUrl(updatedEmpCreds);
        return (
          <div className="p-4 sm:p-5 rounded-xl bg-[#FFFDF7] border-2 border-[#B8923A] shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 text-[#0F1F3D]">
                <KeyRound className="w-4 h-4 text-[#B8923A] shrink-0" />
                <h3 className="text-sm font-bold">
                  Employee Password Ready — Share Privately With Staff
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyEmployeeCreds(updatedEmpCreds)}
                  className="h-8 px-3 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedEmpCreds ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#DFC27D]" />
                      Copy Login Details
                    </>
                  )}
                </button>
                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Share on WhatsApp
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setUpdatedEmpCreds(null)}
                  className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-white border border-slate-200">
                <p className="text-[11px] text-slate-500">Employee</p>
                <p className="font-semibold text-[#0F1F3D] mt-0.5">
                  {updatedEmpCreds.fullName}{' '}
                  <span className="font-mono text-slate-500">({updatedEmpCreds.employeeId})</span>
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white border border-slate-200">
                <p className="text-[11px] text-slate-500">Login ID (Unchanged)</p>
                <p className="font-mono font-bold text-[#0F1F3D] mt-0.5">
                  {updatedEmpCreds.loginId}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white border border-slate-200">
                <p className="text-[11px] text-slate-500">New Password</p>
                <p className="font-mono font-bold text-[#9A7625] mt-0.5">
                  {updatedEmpCreds.password}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-600">
              This password is shown only once and is never stored in plain text. Previous password
              is revoked immediately.
            </p>
          </div>
        );
      })()}

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
                  <th className="py-2 px-3">Employee ID</th>
                  <th className="py-2 px-3">Login ID</th>
                  <th className="py-2 px-3">Employee Name</th>
                  <th className="py-2 px-3">Branch</th>
                  <th className="py-2 px-3">Error Code</th>
                  <th className="py-2 px-3">Reason</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {failedProvisionItems.map((item) => {
                  const matchedEmp = employees.find((e) => e.employeeId === item.employeeId);
                  const isBusy = activatingEmployeeId === item.employeeId;
                  return (
                    <tr key={item.employeeId} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-slate-900">{item.employeeId}</td>
                      <td className="py-2 px-3 font-mono text-slate-700">{item.loginId}</td>
                      <td className="py-2 px-3 font-medium text-slate-900">{item.fullName}</td>
                      <td className="py-2 px-3 text-slate-600">{item.branchName}</td>
                      <td className="py-2 px-3 font-mono text-amber-800">{item.errorCode}</td>
                      <td className="py-2 px-3 text-slate-600">{item.reason}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {matchedEmp && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleActivateSingleEmployee(matchedEmp)}
                            className="h-7 px-2.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {isBusy ? 'Fixing...' : 'Auto-Fix & Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
          className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
        >
          {/* Form Header */}
          <div className="px-5 py-3.5 bg-[#0F1F3D] text-white flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm sm:text-base font-semibold">
                {editing ? `Edit Employee · ${editing.employeeId}` : 'Add New Employee'}
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Essential Job, Contact, Bank &amp; KYC details on one compact screen
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs font-medium text-slate-300 hover:text-white cursor-pointer inline-flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Close
            </button>
          </div>

          <div className="p-5 sm:p-6 space-y-6">
            {/* Section 1: Core Job, Contact & Login */}
            <section className="space-y-3.5">
              <h4 className="text-xs font-semibold text-[#0F1F3D] pb-1.5 border-b border-slate-100">
                1. Core Details &amp; Portal Login
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Employee ID <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editing)}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                    placeholder="e.g. EMP001"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono disabled:bg-slate-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Sale ID <span className="text-slate-400 font-normal">(POS Code)</span>
                  </label>
                  <input
                    type="text"
                    value={saleId}
                    onChange={(e) => setSaleId(e.target.value.toUpperCase())}
                    placeholder="Sales staff only"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Login ID <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                    placeholder="HOM001"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Full Name <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Employee full name"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Branch <span className="text-rose-600">*</span>
                  </label>
                  <select
                    required
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
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
                    Department
                  </label>
                  <select
                    value={
                      departmentId
                        ? `SALES:${departmentId}`
                        : customDepartmentName
                          ? `NONSALES:${customDepartmentName}`
                          : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith('SALES:')) {
                        setDepartmentId(val.slice(6) as DepartmentId);
                        setCustomDepartmentName('');
                      } else if (val.startsWith('NONSALES:')) {
                        setDepartmentId('');
                        setCustomDepartmentName(val.slice(9));
                      } else {
                        setDepartmentId('');
                        setCustomDepartmentName('');
                      }
                    }}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  >
                    <option value="">— Unassigned —</option>
                    <optgroup label="5 Sales Counter Departments">
                      {OFFICIAL_DEPARTMENTS.map((dept) => (
                        <option key={dept.id} value={`SALES:${dept.id}`}>
                          {dept.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Non-Sales Departments">
                      {COMMON_NON_SALES_DEPARTMENTS.map((name) => (
                        <option key={name} value={`NONSALES:${name}`}>
                          {name}
                        </option>
                      ))}
                      {customDepartmentName &&
                        !COMMON_NON_SALES_DEPARTMENTS.includes(customDepartmentName) && (
                          <option value={`NONSALES:${customDepartmentName}`}>
                            {customDepartmentName}
                          </option>
                        )}
                    </optgroup>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Designation <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g. Sales Executive, Cashier"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mobile Number
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98XXXXXXXX"
                    maxLength={24}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Gender
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  >
                    <option value="">— Select —</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date of Joining
                  </label>
                  <input
                    type="date"
                    value={dateOfJoining}
                    onChange={(e) => setDateOfJoining(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date of Exit <span className="text-slate-400 font-normal">(If left)</span>
                  </label>
                  <input
                    type="date"
                    value={dateOfExit}
                    onChange={(e) => setDateOfExit(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Initial Password{' '}
                      <span className="text-slate-400 font-normal">
                        {editing?.credentialsProvisioned ? '(Active)' : `(${DEFAULT_EMPLOYEE_PASSWORD})`}
                      </span>
                    </label>
                    {isMainOwner && editing && (
                      <button
                        type="button"
                        onClick={() => openSetEmployeePasswordModal(editing)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#9A7625] hover:underline cursor-pointer"
                      >
                        <KeyRound className="w-3 h-3" />
                        Set / Reset Password
                      </button>
                    )}
                  </div>
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
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono disabled:bg-slate-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Google Email <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="email"
                    value={linkedGoogleEmail}
                    onChange={(e) => setLinkedGoogleEmail(e.target.value)}
                    placeholder="staff@gmail.com"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>

                <div className="md:col-span-2 flex items-end">
                  <div className="w-full flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="w-9 h-9 rounded-full bg-[#0F1F3D] text-[#DFC27D] font-bold text-xs flex items-center justify-center overflow-hidden border border-[#B8923A]/50 shrink-0">
                      {photoDataUrl ? (
                        <img
                          src={photoDataUrl}
                          alt={fullName || 'Preview'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{(fullName || 'EM').slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <label className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-[#0F1F3D] inline-flex items-center gap-1.5 cursor-pointer">
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
                        className="h-8 px-2.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-medium text-red-700 cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                    {photoError && <p className="w-full text-xs text-red-700">{photoError}</p>}
                  </div>
                </div>
              </div>
            </section>

            {/* Section 2: Bank & Salary */}
            <section className="space-y-3.5">
              <h4 className="text-xs font-semibold text-[#0F1F3D] pb-1.5 border-b border-slate-100">
                2. Bank &amp; Monthly Salary (Optional)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Monthly Gross Salary (₹)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={monthlyGrossSalaryRupees}
                    onChange={(e) => setMonthlyGrossSalaryRupees(e.target.value)}
                    placeholder="e.g. 18500"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. State Bank of India"
                    maxLength={80}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank Account Number <span className="text-slate-400 font-normal">(Auto-masked)</span>
                  </label>
                  <input
                    type="text"
                    value={bankAccountMasked}
                    onChange={(e) => setBankAccountMasked(e.target.value)}
                    placeholder="XXXX1234"
                    maxLength={32}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank IFSC Code
                  </label>
                  <input
                    type="text"
                    value={bankIfsc}
                    onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                    placeholder="e.g. SBIN0001234"
                    maxLength={20}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono uppercase"
                  />
                </div>
              </div>
            </section>

            {/* Section 3: KYC, Statutory & Contact */}
            <section className="space-y-3.5">
              <h4 className="text-xs font-semibold text-[#0F1F3D] pb-1.5 border-b border-slate-100">
                3. KYC, Statutory &amp; Address (Optional)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Aadhaar Number <span className="text-slate-400 font-normal">(Auto-masked)</span>
                  </label>
                  <input
                    type="text"
                    value={aadhaarMasked}
                    onChange={(e) => setAadhaarMasked(e.target.value)}
                    placeholder="XXXX-XXXX-1234"
                    maxLength={24}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    PAN Number
                  </label>
                  <input
                    type="text"
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                    placeholder="ABCDE1234F"
                    maxLength={20}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    UAN Number
                  </label>
                  <input
                    type="text"
                    value={uanNumber}
                    onChange={(e) => setUanNumber(e.target.value)}
                    placeholder="12-digit UAN"
                    maxLength={32}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    PF Number
                  </label>
                  <input
                    type="text"
                    value={pfNumber}
                    onChange={(e) => setPfNumber(e.target.value)}
                    placeholder="PF Account No."
                    maxLength={40}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ESIC Number
                  </label>
                  <input
                    type="text"
                    value={esicNumber}
                    onChange={(e) => setEsicNumber(e.target.value)}
                    placeholder="ESIC IP No."
                    maxLength={40}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Emergency Contact
                  </label>
                  <input
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    placeholder="Emergency mobile number"
                    maxLength={40}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-mono"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Residential Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="City / Village / Street address"
                    maxLength={240}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm"
                  />
                </div>
              </div>
            </section>

            {/* Optional Custom Columns (Only if Admin Added Any) */}
            {allCustomColumnNames.length > 0 && (
              <section className="space-y-2.5 pt-2 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-[#0F1F3D]">
                  Custom Columns ({allCustomColumnNames.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {allCustomColumnNames.map((colName) => (
                    <div key={colName}>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        {colName}
                      </label>
                      <input
                        type="text"
                        value={customFields[colName] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomFields((prev) => ({
                            ...prev,
                            [colName]: val,
                          }));
                        }}
                        placeholder={`Enter ${colName}`}
                        maxLength={200}
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Access Toggles & Save Footer */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mustChangePassword}
                    onChange={(e) => setMustChangePassword(e.target.checked)}
                    className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                  />
                  Require password change on first login
                </label>

                <label className="inline-flex items-center gap-2 text-xs text-[#0F1F3D] font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isBranchManager}
                    onChange={(e) => setIsBranchManager(e.target.checked)}
                    className="rounded border-slate-300 text-[#B8923A] focus:ring-[#B8923A]"
                  />
                  Branch Manager (Read-Only Own Branch)
                </label>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="h-9 px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold disabled:opacity-60 cursor-pointer shrink-0"
                >
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Employee'}
                </button>
              </div>
            </div>
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
                  <th className="py-2.5 px-4 whitespace-nowrap">Employee</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Branch &amp; Dept</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Mobile</th>
                  {BUILTIN_EXTRA_TABLE_COLUMNS.filter((c) => visibleExtraColumns.includes(c.id)).map(
                    (col) => (
                      <th key={col.id} className="py-2.5 px-4 whitespace-nowrap text-[#0F1F3D]">
                        {col.label}
                      </th>
                    ),
                  )}
                  {allCustomColumnNames
                    .filter((cName) => visibleExtraColumns.includes(`custom:${cName}`))
                    .map((cName) => (
                      <th
                        key={`custom:${cName}`}
                        className="py-2.5 px-4 whitespace-nowrap text-[#8A671F] bg-[#FDF8EC]/40"
                      >
                        {cName}
                      </th>
                    ))}
                  <th className="py-2.5 px-4 whitespace-nowrap">Login</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((emp) => (
                  <tr key={emp.employeeId} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-2.5 px-4">
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
                          <div className="font-medium text-slate-900 truncate flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setProfileDrawerEmp(emp)}
                              className="hover:text-[#0F1F3D] hover:underline text-left truncate cursor-pointer"
                              title="Click to view employee profile"
                            >
                              {emp.fullName}
                            </button>
                            {emp.isBranchManager && (
                              <span className="text-[10px] font-semibold text-[#9A7625] shrink-0">
                                · Branch Mgr
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 truncate tabular-nums">
                            {emp.employeeId}
                            {emp.saleId ? ` · Sale: ${emp.saleId}` : ''} · {emp.loginId}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="text-xs font-medium text-slate-800">{emp.branchName}</div>
                      <div className="text-[11px] text-slate-500">
                        <span className={emp.departmentName ? 'text-[#0F1F3D] font-medium' : 'text-amber-700'}>
                          {emp.departmentName || 'Unassigned'}
                        </span>
                        {emp.designation ? ` · ${emp.designation}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="text-xs font-mono text-slate-700 tabular-nums">
                        {emp.phone || '—'}
                      </div>
                      {emp.dateOfBirth && extractMonthDayFromDob(emp.dateOfBirth) && (
                        <div className="text-[11px] text-[#9A7625]">
                          DOB: {formatBirthMonthDayLabel(emp.dateOfBirth, 'en')}
                        </div>
                      )}
                    </td>
                    {BUILTIN_EXTRA_TABLE_COLUMNS.filter((c) => visibleExtraColumns.includes(c.id)).map(
                      (col) => {
                        const rawVal = (emp as unknown as Record<string, unknown>)[col.id];
                        let displayVal = '—';
                        if (col.id === 'monthlyGrossSalaryPaise') {
                          displayVal =
                            typeof rawVal === 'number' && rawVal > 0
                              ? formatINRFromPaise(rawVal)
                              : '—';
                        } else if (rawVal !== undefined && rawVal !== null && String(rawVal).trim()) {
                          displayVal = String(rawVal);
                        }
                        return (
                          <td
                            key={col.id}
                            className="py-2.5 px-4 text-xs text-slate-700 whitespace-nowrap font-mono tabular-nums"
                          >
                            {displayVal}
                          </td>
                        );
                      },
                    )}
                    {allCustomColumnNames
                      .filter((cName) => visibleExtraColumns.includes(`custom:${cName}`))
                      .map((cName) => {
                        const map = emp.customFields || {};
                        let val = map[cName];
                        if (val === undefined) {
                          const lower = cName.toLowerCase();
                          const matchK = Object.keys(map).find((k) => k.toLowerCase() === lower);
                          if (matchK) val = map[matchK];
                        }
                        return (
                          <td
                            key={`custom:${cName}`}
                            className="py-2.5 px-4 text-xs text-slate-800 whitespace-nowrap bg-[#FDF8EC]/20"
                          >
                            {val || '—'}
                          </td>
                        );
                      })}
                    <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                      {emp.credentialsProvisioned ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <UserCheck className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : emp.linkedGoogleEmail ? (
                        <span className="text-slate-600">Google Linked</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <KeyRound className="w-3.5 h-3.5" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`text-xs font-semibold ${
                          emp.status === 'ACTIVE' ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {emp.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setProfileDrawerEmp(emp)}
                          title="View Complete 360° Employee Details"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F1F3D] hover:underline cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                        {emp.dateOfBirth && extractMonthDayFromDob(emp.dateOfBirth) && (
                          <button
                            type="button"
                            onClick={() => setPreviewCardEmp(emp)}
                            title="Preview & Download Official Birthday Wishing Card"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#9A7625] hover:underline cursor-pointer"
                          >
                            <Gift className="w-3.5 h-3.5" />
                            Card
                          </button>
                        )}
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
                        {isMainOwner && (
                          <button
                            type="button"
                            onClick={() => openSetEmployeePasswordModal(emp)}
                            title="Main Owner only: set or reset employee portal password"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#9A7625] hover:text-[#0F1F3D] hover:underline cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Set Password
                          </button>
                        )}
                        {isMainOwner && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteEmp(emp);
                              setDeleteEmpReason('');
                            }}
                            title="Main Owner only: permanently delete employee"
                            className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900 hover:underline cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main Owner ONLY: Set / Reset Employee Password Modal */}
      {isMainOwner && pwdTargetEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-2 border-[#B8923A]/50 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-[#0F1F3D] text-white flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#DFC27D] shrink-0" />
                  Main Owner · Set Employee Password
                </h3>
                <p className="text-xs text-slate-300 mt-0.5 truncate">
                  {pwdTargetEmp.fullName} ({pwdTargetEmp.employeeId} ·{' '}
                  <span className="font-mono text-[#DFC27D]">{pwdTargetEmp.loginId}</span>)
                </p>
              </div>
              <button
                type="button"
                disabled={savingEmpPwd}
                onClick={() => setPwdTargetEmp(null)}
                className="p-1 text-slate-300 hover:text-white cursor-pointer"
                aria-label="Close set employee password modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployeePassword} className="p-5 space-y-4">
              {pwdModalErr && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {pwdModalErr}
                </div>
              )}

              <p className="text-xs text-slate-600 leading-relaxed">
                Set a new portal password for this employee while keeping their exact Login ID{' '}
                <strong className="font-mono text-[#0F1F3D]">{pwdTargetEmp.loginId}</strong>. Any
                previous password is revoked immediately, and all historical salary slips &amp;
                incentives stay linked automatically.
              </p>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-slate-700">
                    New Password (min 8 chars)
                  </label>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPwdNewValue(DEFAULT_EMPLOYEE_PASSWORD);
                        setShowPwdNewValue(true);
                        setPwdMustChange(true);
                      }}
                      className="text-[11px] font-semibold text-slate-600 hover:text-[#0F1F3D] hover:underline cursor-pointer"
                    >
                      Default ({DEFAULT_EMPLOYEE_PASSWORD})
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPwdNewValue(generateStrongTemporaryPassword('Muktai@'));
                        setShowPwdNewValue(true);
                        setPwdMustChange(false);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#9A7625] hover:underline cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      Generate Strong
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type={showPwdNewValue ? 'text' : 'password'}
                    required
                    minLength={8}
                    maxLength={128}
                    autoFocus
                    placeholder="Enter new password (min 8 chars)"
                    value={pwdNewValue}
                    onChange={(e) => setPwdNewValue(e.target.value)}
                    className="w-full h-10 pl-3 pr-9 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#B8923A]/30 focus:border-[#0F1F3D]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwdNewValue((s) => !s)}
                    aria-label={showPwdNewValue ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPwdNewValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pwdMustChange}
                  onChange={(e) => setPwdMustChange(e.target.checked)}
                  className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
                />
                Require employee to change password on next login
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={savingEmpPwd}
                  onClick={() => setPwdTargetEmp(null)}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEmpPwd || pwdNewValue.trim().length < 8}
                  className="h-9 px-4 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#DFC27D]" />
                  {savingEmpPwd ? 'Saving Password...' : 'Save New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Owner ONLY: Permanent Employee Delete Confirmation Modal */}
      {isMainOwner && confirmDeleteEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-2 border-rose-200 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-rose-50 border-b border-rose-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-rose-950">
                  Main Owner · Permanently Delete Employee?
                </h3>
                <p className="text-xs text-rose-800 mt-0.5">
                  {confirmDeleteEmp.fullName} ({confirmDeleteEmp.employeeId} · {confirmDeleteEmp.loginId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteEmp(null)}
                className="p-1 text-rose-500 hover:text-rose-800 cursor-pointer"
                aria-label="Close delete employee confirmation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-700 leading-relaxed">
                This permanently removes the employee master record, revokes portal access immediately,
                and logs the deletion in Audit Logs. Tip: if you want to keep historical staff status,
                use <strong>Deactivate</strong> instead.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Audit Reason (optional)
                </label>
                <input
                  type="text"
                  value={deleteEmpReason}
                  onChange={(e) => setDeleteEmpReason(e.target.value)}
                  placeholder="e.g. Duplicate test employee entry"
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs text-slate-900"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={deletingEmpBusy}
                  onClick={() => setConfirmDeleteEmp(null)}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingEmpBusy}
                  onClick={async () => {
                    setDeletingEmpBusy(true);
                    setFeedback(null);
                    try {
                      await deleteEmployeeByOwner(confirmDeleteEmp, deleteEmpReason);
                      setFeedback({
                        type: 'ok',
                        text: `Main Owner permanently deleted employee ${confirmDeleteEmp.fullName} (${confirmDeleteEmp.employeeId}).`,
                      });
                      setConfirmDeleteEmp(null);
                      await onRefresh();
                    } catch (err) {
                      setFeedback({
                        type: 'err',
                        text:
                          err instanceof Error
                            ? err.message
                            : 'Unable to delete employee record.',
                      });
                    } finally {
                      setDeletingEmpBusy(false);
                    }
                  }}
                  className="h-9 px-4 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {deletingEmpBusy ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <EmployeeProfileDrawer
        employee={profileDrawerEmp}
        onClose={() => setProfileDrawerEmp(null)}
        onEdit={(emp) => openEdit(emp)}
      />

      <BirthdayWishingCardModal
        open={Boolean(previewCardEmp)}
        onClose={() => setPreviewCardEmp(null)}
        card={
          previewCardEmp
            ? {
                fullName: previewCardEmp.fullName,
                employeeId: previewCardEmp.employeeId,
                branchName: previewCardEmp.branchName,
                departmentName: previewCardEmp.departmentName,
                designation: previewCardEmp.designation,
                photoDataUrl: previewCardEmp.photoDataUrl,
                birthMonthDay:
                  extractMonthDayFromDob(previewCardEmp.dateOfBirth)?.birthMonthDay ||
                  getTodayIstParts().monthDay,
                celebrationYear: getTodayIstParts().year,
              }
            : null
        }
      />
    </div>
  );
}
