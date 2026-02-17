const ROLE = Object.freeze({
  PLATFORM_SUPER_ADMIN: 'PlatformSuperAdmin',
  SUPER_ADMIN: 'SuperAdmin',
  BRANCH_ADMIN: 'BranchAdmin',
  FLEET_MANAGER: 'FleetManager',
  FINANCE_MANAGER: 'FinanceManager',
  SUPPORT_STAFF: 'SupportStaff',
  USER: 'User',
});

const LEGACY_ROLE_MAP = Object.freeze({
  admin: ROLE.SUPER_ADMIN,
  user: ROLE.USER,
  owner: ROLE.SUPER_ADMIN,
  platformsuperadmin: ROLE.PLATFORM_SUPER_ADMIN,
  superadmin: ROLE.SUPER_ADMIN,
  branchadmin: ROLE.BRANCH_ADMIN,
  fleetmanager: ROLE.FLEET_MANAGER,
  financemanager: ROLE.FINANCE_MANAGER,
  supportstaff: ROLE.SUPPORT_STAFF,
});

const ROLES = Object.freeze(Object.values(ROLE));

const PERMISSIONS = Object.freeze({
  MANAGE_BOOKINGS: 'MANAGE_BOOKINGS',
  PROCESS_REFUNDS: 'PROCESS_REFUNDS',
  VIEW_ANALYTICS: 'VIEW_ANALYTICS',
  MANAGE_FLEET: 'MANAGE_FLEET',
  MANAGE_MAINTENANCE: 'MANAGE_MAINTENANCE',
  MANAGE_INSPECTIONS: 'MANAGE_INSPECTIONS',
  MANAGE_DRIVERS: 'MANAGE_DRIVERS',
  MANAGE_USERS: 'MANAGE_USERS',
  MANAGE_ROLES: 'MANAGE_ROLES',
  VIEW_ALL_BOOKINGS: 'VIEW_ALL_BOOKINGS',
  MANAGE_OFFERS: 'MANAGE_OFFERS',
  MANAGE_REVIEWS: 'MANAGE_REVIEWS',
  VIEW_FINANCIALS: 'VIEW_FINANCIALS',
  MANAGE_INVOICES: 'MANAGE_INVOICES',
  MANAGE_TENANTS: 'MANAGE_TENANTS',
  VIEW_PLATFORM_ANALYTICS: 'VIEW_PLATFORM_ANALYTICS',
  MANAGE_PLATFORM_SUBSCRIPTIONS: 'MANAGE_PLATFORM_SUBSCRIPTIONS',
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLE.PLATFORM_SUPER_ADMIN]: [
    PERMISSIONS.MANAGE_TENANTS,
    PERMISSIONS.VIEW_PLATFORM_ANALYTICS,
    PERMISSIONS.MANAGE_PLATFORM_SUBSCRIPTIONS,
  ],
  [ROLE.SUPER_ADMIN]: ['*'],
  [ROLE.BRANCH_ADMIN]: [
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.MANAGE_DRIVERS,
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.MANAGE_OFFERS,
    PERMISSIONS.MANAGE_REVIEWS,
  ],
  [ROLE.FLEET_MANAGER]: [
    PERMISSIONS.MANAGE_FLEET,
    PERMISSIONS.MANAGE_MAINTENANCE,
    PERMISSIONS.MANAGE_INSPECTIONS,
    PERMISSIONS.MANAGE_DRIVERS,
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [ROLE.FINANCE_MANAGER]: [
    PERMISSIONS.PROCESS_REFUNDS,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.MANAGE_INVOICES,
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [ROLE.SUPPORT_STAFF]: [
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.MANAGE_OFFERS,
    PERMISSIONS.MANAGE_REVIEWS,
  ],
  [ROLE.USER]: [],
});

const normalizeRoleKey = (value) => String(value || '').trim().replace(/[\s_-]+/g, '').toLowerCase();

const normalizeRole = (value, fallback = ROLE.USER) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (ROLES.includes(raw)) return raw;

  const mapped = LEGACY_ROLE_MAP[normalizeRoleKey(raw)];
  return mapped || fallback;
};

const normalizeBranches = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

const isStaffRole = (roleValue) => normalizeRole(roleValue) !== ROLE.USER;
const isUserRole = (roleValue) => normalizeRole(roleValue) === ROLE.USER;

const getPermissionsForRole = (roleValue) => {
  const normalizedRole = normalizeRole(roleValue);
  const permissions = ROLE_PERMISSIONS[normalizedRole];
  return Array.isArray(permissions) ? [...permissions] : [];
};

const hasPermission = (roleOrUser, permission) => {
  if (!permission) return false;

  const roleValue =
    roleOrUser && typeof roleOrUser === 'object'
      ? roleOrUser.role
      : roleOrUser;
  const permissions = getPermissionsForRole(roleValue);
  if (permissions.includes('*')) return true;
  return permissions.includes(permission);
};

const hasAnyPermission = (roleOrUser, permissions = []) => {
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  return permissions.some((permission) => hasPermission(roleOrUser, permission));
};

const getRoleOptions = () => [...ROLES];

module.exports = {
  ROLE,
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  normalizeRole,
  normalizeBranches,
  isStaffRole,
  isUserRole,
  getPermissionsForRole,
  hasPermission,
  hasAnyPermission,
  getRoleOptions,
};
