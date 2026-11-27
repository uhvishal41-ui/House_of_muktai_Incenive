import React, { useMemo, useState } from 'react';
import { Building2, Edit3, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { sanitizeId } from '../../lib/format';
import {
  DEFAULT_12_BRANCHES,
  deleteBranch,
  OFFICIAL_BRANCH_ID_SET,
  saveBranch,
  syncOfficial12Branches,
} from '../../services/incentiveService';
import type { Branch, Employee } from '../../types/incentive';

interface Props {
  branches: Branch[];
  employees: Employee[];
  onRefresh: () => Promise<void>;
}

export function BranchMaster({ branches, employees, onRefresh }: Props) {
  const { isMainOwner } = useAuth();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [city, setCity] = useState('');
  const [managerName, setManagerName] = useState('');
  const [active, setActive] = useState(true);
  const [codeTouched, setCodeTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Branch | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const employeeCountByBranch = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employees) {
      map[e.branchId] = (map[e.branchId] || 0) + 1;
    }
    return map;
  }, [employees]);

  const missingOfficialCount = useMemo(() => {
    const existingIds = new Set(branches.map((b) => b.branchId));
    return DEFAULT_12_BRANCHES.filter((def) => !existingIds.has(def.code)).length;
  }, [branches]);

  const extraUnreferencedCount = useMemo(() => {
    return branches.filter(
      (b) => !OFFICIAL_BRANCH_ID_SET.has(b.branchId) && (employeeCountByBranch[b.branchId] || 0) === 0,
    ).length;
  }, [branches, employeeCountByBranch]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return branches
      .filter(
        (b) =>
          b.branchCode.toLowerCase().includes(q) ||
          b.branchName.toLowerCase().includes(q) ||
          b.city.toLowerCase().includes(q),
      )
      .sort((a, b) => a.branchName.localeCompare(b.branchName));
  }, [branches, search]);

  const openCreate = () => {
    setEditing(null);
    setBranchCode('');
    setBranchName('');
    setCity('');
    setManagerName('');
    setActive(true);
    setCodeTouched(false);
    setShowForm(true);
    setFeedback(null);
  };

  const openEdit = (branch: Branch) => {
    setEditing(branch);
    setBranchCode(branch.branchCode);
    setBranchName(branch.branchName);
    setCity(branch.city);
    setManagerName(branch.managerName || '');
    setActive(branch.active);
    setCodeTouched(true);
    setShowForm(true);
    setFeedback(null);
  };

  const handleBranchNameChange = (val: string) => {
    setBranchName(val);
    if (!editing && !codeTouched) {
      setBranchCode(sanitizeId(val).slice(0, 24));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCode = sanitizeId(branchCode || branchName).slice(0, 24);
    if (!finalCode || !branchName.trim() || !city.trim()) {
      setFeedback({ type: 'err', text: 'Branch Code, Branch Name, and City are required.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await saveBranch({
        branchId: editing?.branchId,
        branchCode: finalCode,
        branchName: branchName.trim().toUpperCase(),
        city: city.trim(),
        managerName,
        active,
        existingCreatedAt: editing?.createdAt,
      });
      setShowForm(false);
      setFeedback({
        type: 'ok',
        text: editing
          ? `Updated branch ${finalCode} (${branchName.trim().toUpperCase()}).`
          : `Added branch ${finalCode} (${branchName.trim().toUpperCase()}).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save branch.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSyncOfficial12 = async (pruneExtras: boolean) => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await syncOfficial12Branches({
        pruneAllNonOfficialUnreferenced: pruneExtras,
      });
      setFeedback({
        type: 'ok',
        text: `Official 12 branches linked (${res.createdOrUpdated} created/updated, ${res.removedCount} extra/duplicate branch(es) removed${
          res.remappedEmployees > 0
            ? `, ${res.remappedEmployees} employee(s) & ${res.remappedRecords} incentive record(s) safely remapped`
            : ''
        }).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to sync official 12 branches.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.branchId);
    setFeedback(null);
    try {
      await deleteBranch(confirmDelete);
      setConfirmDelete(null);
      setFeedback({
        type: 'ok',
        text: `Removed unused branch ${confirmDelete.branchName} (${confirmDelete.branchCode}).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to remove branch.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search branch code, name, or city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0F1F3D]/20 focus:border-[#0F1F3D]"
            />
          </div>
          <span className="hidden md:inline text-xs font-medium text-slate-500 whitespace-nowrap">
            {branches.length} Branches
          </span>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 self-start sm:self-auto">
          {branches.length === 0 && (
            <button
              type="button"
              disabled={syncing}
              onClick={() => handleSyncOfficial12(false)}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Building2 className="w-3.5 h-3.5" />
              {syncing ? 'Linking...' : 'Link Official 12'}
            </button>
          )}
          {(missingOfficialCount > 0 || (isMainOwner && extraUnreferencedCount > 0)) && branches.length > 0 && (
            <button
              type="button"
              disabled={syncing}
              onClick={() => handleSyncOfficial12(isMainOwner)}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Official 12'}
            </button>
          )}
          <button
            type="button"
            onClick={openCreate}
            className="h-8 px-3.5 rounded-lg bg-[#0F1F3D] hover:bg-[#162B50] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Branch
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {confirmDelete && (
        <div className="bg-white border border-red-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-700">
            <strong className="text-slate-900">Remove unused branch?</strong>{' '}
            <span className="font-mono">{confirmDelete.branchName}</span> ({confirmDelete.branchCode}
            ) has 0 linked employees and will be removed from Branch Master.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deletingId === confirmDelete.branchId}
              onClick={handleConfirmDelete}
              className="h-8 px-3 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-medium disabled:opacity-60 cursor-pointer"
            >
              {deletingId === confirmDelete.branchId ? 'Removing...' : 'Confirm Remove'}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              {editing ? `Edit Branch · ${editing.branchCode}` : 'Add New Branch'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Branch Name</label>
              <input
                type="text"
                required
                value={branchName}
                onChange={(e) => handleBranchNameChange(e.target.value)}
                placeholder="e.g. SATARA"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Branch Code</label>
              <input
                type="text"
                required
                disabled={Boolean(editing)}
                value={branchCode}
                onChange={(e) => {
                  setCodeTouched(true);
                  setBranchCode(e.target.value.toUpperCase());
                }}
                placeholder="e.g. SATARA"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Satara"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Branch Manager (Optional)
              </label>
              <input
                type="text"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                placeholder="Manager name"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-slate-300 text-[#0F1F3D] focus:ring-[#0F1F3D]"
              />
              Branch is active for ERP Excel imports
            </label>
            <button
              type="submit"
              disabled={saving}
              className="h-10 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Save Branch'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-800 mb-1">No branches found</p>
            <p className="text-xs text-slate-500">
              Use &ldquo;Link Official 12 Branches&rdquo; or &ldquo;Add Branch&rdquo; to configure
              branches for ERP Excel imports.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Branch Code</th>
                  <th className="py-3 px-4">Branch Name</th>
                  <th className="py-3 px-4">City</th>
                  <th className="py-3 px-4 text-right">Staff</th>
                  <th className="py-3 px-4">Manager</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((branch) => {
                  const staffCount = employeeCountByBranch[branch.branchId] || 0;
                  const isOfficial = OFFICIAL_BRANCH_ID_SET.has(branch.branchId);
                  return (
                    <tr key={branch.branchId} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-slate-900">
                        {branch.branchCode}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-slate-900 font-medium">{branch.branchName}</span>
                        {!isOfficial && (
                          <span className="ml-2 text-[11px] font-medium text-slate-500">
                            (Custom)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{branch.city}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {staffCount}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{branch.managerName || '—'}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs font-semibold ${
                            branch.active ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {branch.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openEdit(branch)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-[#0F1F3D] cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          {isMainOwner && !isOfficial && staffCount === 0 && (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(branch)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline cursor-pointer"
                              title="Main Owner only: permanently remove unused branch"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
