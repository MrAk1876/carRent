import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const ManageUsers = () => {
  const notify = useNotify();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [passwords, setPasswords] = useState({});
  const [errorMsg, setErrorMsg] = useState('');
  const [processingId, setProcessingId] = useState('');

  const loadUsers = async () => {
    try {
      const res = await API.get('/admin/users');
      setUsers(Array.isArray(res.data) ? res.data : []);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load users'));
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const toggleBlock = async (id) => {
    try {
      setProcessingId(id);
      await API.put(`/admin/users/block/${id}`);
      await loadUsers();
      notify.success('User status updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update user status'));
    } finally {
      setProcessingId('');
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    try {
      setProcessingId(id);
      await API.delete(`/admin/users/${id}`);
      await loadUsers();
      notify.success('User deleted successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete user'));
    } finally {
      setProcessingId('');
    }
  };

  const changePassword = async (id) => {
    const password = passwords[id];
    if (!password) {
      notify.error('Enter password');
      return;
    }

    try {
      setProcessingId(id);
      await API.put(`/admin/users/password/${id}`, { password });
      setPasswords((prev) => ({ ...prev, [id]: '' }));
      notify.success('Password updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Password update failed'));
    } finally {
      setProcessingId('');
    }
  };

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return users
      .filter((user) => user.role === 'user')
      .filter((user) => {
        if (!normalizedSearch) return true;
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase();
        return fullName.includes(normalizedSearch) || String(user.email || '').toLowerCase().includes(normalizedSearch);
      });
  }, [search, users]);

  const stats = useMemo(() => {
    const total = filteredUsers.length;
    const blocked = filteredUsers.filter((user) => user.isBlocked).length;
    const active = Math.max(total - blocked, 0);
    return { total, active, blocked };
  }, [filteredUsers]);

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title title="Manage Users" subTitle="Search, block, remove users, and reset passwords from one place." />

      {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Visible Users</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Active</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Blocked</p>
          <p className="mt-2 text-2xl font-semibold text-red-600">{stats.blocked}</p>
        </div>
      </div>

      <div className="mt-6 max-w-5xl">
        <input
          placeholder="Search by name or email"
          className="w-full md:w-96 border border-borderColor rounded-lg px-3 py-2 text-sm bg-white"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="admin-section-scroll-shell mt-4">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll admin-section-scroll--free">
          <div className="max-w-6xl w-full rounded-2xl overflow-hidden border border-borderColor bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-245 border-collapse text-left text-sm">
                <thead className="bg-light text-gray-700">
                  <tr>
                    <th className="p-3 font-medium">User</th>
                    <th className="p-3 font-medium">Email</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Reset Password</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 && (
                    <tr className="border-t border-borderColor">
                      <td colSpan={5} className="p-8 text-center text-gray-500">
                        No users matched your search.
                      </td>
                    </tr>
                  )}

                  {filteredUsers.map((user) => {
                    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
                    const isBusy = processingId === user._id;
                    return (
                      <tr key={user._id} className="border-t border-borderColor align-top">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-gray-800">{name}</p>
                              <p className="text-xs text-gray-500">ID: {user._id?.slice(-6)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-gray-700">{user.email}</td>
                        <td className="p-3">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                              user.isBlocked ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {user.isBlocked ? 'Blocked' : 'Active'}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              placeholder="New password"
                              className="border border-borderColor rounded-lg px-3 py-2 text-sm w-52"
                              value={passwords[user._id] || ''}
                              onChange={(e) =>
                                setPasswords((prev) => ({ ...prev, [user._id]: e.target.value }))
                              }
                            />
                            <button
                              onClick={() => changePassword(user._id)}
                              disabled={isBusy}
                              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                                isBusy ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-primary text-white'
                              }`}
                            >
                              Update
                            </button>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleBlock(user._id)}
                              disabled={isBusy}
                              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                                user.isBlocked
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-amber-500 text-white'
                              } ${isBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              {user.isBlocked ? 'Unblock' : 'Block'}
                            </button>

                            <button
                              onClick={() => deleteUser(user._id)}
                              disabled={isBusy}
                              className={`px-3 py-2 rounded-lg text-sm font-medium bg-red-500 text-white ${
                                isBusy ? 'opacity-60 cursor-not-allowed' : ''
                              }`}
                            >
                              Delete
                            </button>
                          </div>
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

export default ManageUsers;
