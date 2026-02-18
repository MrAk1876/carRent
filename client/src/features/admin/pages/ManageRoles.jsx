import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';
import { getUser } from '../../../utils/auth';

const BRANCH_SCOPED_ROLES = new Set(['BranchAdmin', 'FleetManager', 'FinanceManager', 'SupportStaff']);

const toBranchesArray = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const toBranchesLabel = (branches = [], branchLookup = new Map()) => {
  if (!Array.isArray(branches) || branches.length === 0) return 'All / Not Assigned';
  return branches
    .map((branchId) => branchLookup.get(String(branchId)) || String(branchId))
    .join(', ');
};

const ManageRoles = () => {
  const notify = useNotify();
  const currentUser = getUser();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [branchCatalog, setBranchCatalog] = useState([]);
  const [search, setSearch] = useState('');
  const [roleDraftById, setRoleDraftById] = useState({});
  const [branchesDraftById, setBranchesDraftById] = useState({});
  const [activeDraftById, setActiveDraftById] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/roles');
      const responseUsers = Array.isArray(response.data?.users) ? response.data.users : [];
      const responseRoles = Array.isArray(response.data?.roles) ? response.data.roles : [];
      const responseBranches = Array.isArray(response.data?.branches) ? response.data.branches : [];

      setUsers(responseUsers);
      setRoles(responseRoles);
      setBranchCatalog(responseBranches);
      setRoleDraftById(
        responseUsers.reduce((acc, user) => {
          acc[user._id] = user.role || 'User';
          return acc;
        }, {}),
      );
      setBranchesDraftById(
        responseUsers.reduce((acc, user) => {
          acc[user._id] = Array.isArray(user.assignedBranches) ? user.assignedBranches.map(String) : [];
          return acc;
        }, {}),
      );
      setActiveDraftById(
        responseUsers.reduce((acc, user) => {
          acc[user._id] = !Boolean(user.isBlocked);
          return acc;
        }, {}),
      );
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load role data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = String(search || '').trim().toLowerCase();
    if (!query) return users;

    return users.filter((user) => {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim().toLowerCase();
      const email = String(user.email || '').toLowerCase();
      const role = String(user.role || '').toLowerCase();
      return fullName.includes(query) || email.includes(query) || role.includes(query);
    });
  }, [search, users]);
  const branchLookup = useMemo(() => {
    return new Map(
      branchCatalog.map((branch) => [String(branch?._id || ''), String(branch?.branchName || '').trim()]),
    );
  }, [branchCatalog]);

  const staffCount = useMemo(
    () => users.filter((user) => String(user.role || '').trim() !== 'User').length,
    [users],
  );
  const existingSuperAdminId = useMemo(() => {
    const superAdmin = users.find((user) => String(user.role || '').trim() === 'SuperAdmin');
    return superAdmin?._id ? String(superAdmin._id) : '';
  }, [users]);

  const saveRole = async (userId) => {
    const actionId = `save:${userId}`;
    try {
      setActionKey(actionId);
      await API.patch(`/admin/roles/${userId}`, {
        role: roleDraftById[userId],
        assignedBranches: toBranchesArray(branchesDraftById[userId]),
        isBlocked: !activeDraftById[userId],
      });
      await loadData();
      notify.success('Role updated successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update role'));
    } finally {
      setActionKey('');
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Manage Roles"
        subTitle="SuperAdmin role control for staff activation, role assignments, and branch scope."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Accounts</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{users.length}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Staff Accounts</p>
          <p className="mt-2 text-2xl font-semibold text-blue-700">{staffCount}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Role Options</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{roles.length}</p>
        </div>
      </div>

      <div className="mt-6 max-w-5xl">
        <input
          placeholder="Search by name, email, or role"
          className="w-full md:w-96 border border-borderColor rounded-lg px-3 py-2 text-sm bg-white"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="admin-section-scroll-shell admin-section-scroll-shell--table mt-4">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll admin-section-scroll--free admin-section-scroll--table">
          <div className="max-w-6xl w-full rounded-2xl overflow-hidden border border-borderColor bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-280 border-collapse text-left text-sm">
                <thead className="bg-light text-gray-700">
                  <tr>
                    <th className="p-3 font-medium">User</th>
                    <th className="p-3 font-medium">Current Role</th>
                    <th className="p-3 font-medium">Set Role</th>
                    <th className="p-3 font-medium">Assigned Branches</th>
                    <th className="p-3 font-medium">Account</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="border-t border-borderColor">
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        Loading roles...
                      </td>
                    </tr>
                  ) : null}

                  {!loading && filteredUsers.length === 0 ? (
                    <tr className="border-t border-borderColor">
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        No users found.
                      </td>
                    </tr>
                  ) : null}

                  {!loading &&
                    filteredUsers.map((user) => {
                      const id = user._id;
                      const busy = actionKey === `save:${id}`;
                      const isCurrentUser = String(currentUser?._id || '') === String(id);
                      const isSelfSuperAdmin = isCurrentUser && String(user.role || '') === 'SuperAdmin';
                      const roleOptionsForUser = roles.filter((roleOption) => {
                        if (roleOption !== 'SuperAdmin') return true;
                        if (!existingSuperAdminId) return true;
                        return existingSuperAdminId === String(id);
                      });

                      return (
                        <tr key={id} className="border-t border-borderColor align-top">
                          <td className="p-3">
                            <p className="font-medium text-gray-800">
                              {`${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User'}
                            </p>
                            <p className="text-xs text-gray-500">{user.email}</p>
                          </td>

                          <td className="p-3">
                            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                              {user.role || 'User'}
                            </span>
                          </td>

                          <td className="p-3">
                            <select
                              value={roleDraftById[id] || user.role || 'User'}
                              onChange={(event) =>
                                setRoleDraftById((previous) => ({
                                  ...previous,
                                  [id]: event.target.value,
                                }))
                              }
                              className="w-45 border border-borderColor rounded-lg px-2.5 py-2 text-sm bg-white"
                              disabled={isSelfSuperAdmin}
                            >
                              {roleOptionsForUser.map((roleOption) => (
                                <option key={roleOption} value={roleOption}>
                                  {roleOption}
                                </option>
                              ))}
                            </select>
                            {existingSuperAdminId && existingSuperAdminId !== String(id) ? (
                              <p className="mt-1 text-[11px] text-gray-500">Only one SuperAdmin is allowed.</p>
                            ) : null}
                          </td>

                          <td className="p-3">
                            {branchCatalog.length > 0 ? (
                              <select
                                multiple
                                value={toBranchesArray(branchesDraftById[id])}
                                onChange={(event) =>
                                  setBranchesDraftById((previous) => ({
                                    ...previous,
                                    [id]: Array.from(event.target.selectedOptions || []).map((option) => option.value),
                                  }))
                                }
                                disabled={!BRANCH_SCOPED_ROLES.has(roleDraftById[id] || user.role || 'User')}
                                className="w-60 min-h-24 border border-borderColor rounded-lg px-2.5 py-2 text-sm bg-white"
                              >
                                {branchCatalog.map((branch) => (
                                  <option key={branch._id} value={branch._id}>
                                    {branch.branchName} ({branch.branchCode})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={toBranchesArray(branchesDraftById[id]).join(', ')}
                                onChange={(event) =>
                                  setBranchesDraftById((previous) => ({
                                    ...previous,
                                    [id]: toBranchesArray(event.target.value),
                                  }))
                                }
                                placeholder="Branch ID, Branch ID"
                                className="w-60 border border-borderColor rounded-lg px-2.5 py-2 text-sm"
                              />
                            )}
                            <p className="mt-1 text-[11px] text-gray-500">
                              Current: {toBranchesLabel(user.assignedBranches, branchLookup)}
                            </p>
                          </td>

                          <td className="p-3">
                            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={Boolean(activeDraftById[id])}
                                onChange={(event) =>
                                  setActiveDraftById((previous) => ({
                                    ...previous,
                                    [id]: event.target.checked,
                                  }))
                                }
                                className="h-4 w-4 accent-primary"
                                disabled={isCurrentUser}
                              />
                              {activeDraftById[id] ? 'Active' : 'Deactivated'}
                            </label>
                            {isCurrentUser ? (
                              <p className="text-[11px] text-gray-500 mt-1">Self-deactivation is disabled.</p>
                            ) : null}
                            {isSelfSuperAdmin ? (
                              <p className="text-[11px] text-gray-500 mt-1">Self role downgrade is disabled.</p>
                            ) : null}
                          </td>

                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => saveRole(id)}
                              disabled={busy}
                              className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
                                busy ? 'bg-slate-400 cursor-not-allowed' : 'bg-primary'
                              }`}
                            >
                              {busy ? 'Saving...' : 'Save'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default ManageRoles;
