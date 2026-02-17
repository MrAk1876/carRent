import { ROLES, getRolePermissions, hasRolePermission, isStaffRole, normalizeRole } from './rbac';

export const getUser = () => {
  const data = localStorage.getItem('user');
  if (!data) return null;

  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') return null;

    const role = normalizeRole(parsed.role);
    const permissions =
      Array.isArray(parsed.permissions) && parsed.permissions.length > 0
        ? parsed.permissions
        : getRolePermissions(role);

    return {
      ...parsed,
      role,
      permissions,
      assignedBranches: Array.isArray(parsed.assignedBranches) ? parsed.assignedBranches : [],
    };
  } catch {
    return null;
  }
};

export const isLoggedIn = () => !!localStorage.getItem('token');

// Kept for backward compatibility across existing UI imports.
export const isAdmin = () => {
  const user = getUser();
  return isStaffRole(user?.role);
};

export const hasPermission = (permission) => {
  const user = getUser();
  if (!user) return false;

  if (Array.isArray(user.permissions) && user.permissions.includes('*')) return true;
  if (Array.isArray(user.permissions) && user.permissions.includes(permission)) return true;
  return hasRolePermission(user.role, permission);
};

export const isPlatformSuperAdmin = () => {
  const user = getUser();
  return normalizeRole(user?.role) === ROLES.PLATFORM_SUPER_ADMIN;
};
