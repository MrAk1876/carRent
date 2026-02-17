export const ROLES = Object.freeze({
  PLATFORM_SUPER_ADMIN: 'PlatformSuperAdmin',
  SUPER_ADMIN: 'SuperAdmin',
  BRANCH_ADMIN: 'BranchAdmin',
  FLEET_MANAGER: 'FleetManager',
  FINANCE_MANAGER: 'FinanceManager',
  SUPPORT_STAFF: 'SupportStaff',
  USER: 'User',
});

export const PERMISSIONS = Object.freeze({
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

const LEGACY_ROLE_MAP = Object.freeze({
  admin: ROLES.SUPER_ADMIN,
  user: ROLES.USER,
  owner: ROLES.SUPER_ADMIN,
  platformsuperadmin: ROLES.PLATFORM_SUPER_ADMIN,
  superadmin: ROLES.SUPER_ADMIN,
  branchadmin: ROLES.BRANCH_ADMIN,
  fleetmanager: ROLES.FLEET_MANAGER,
  financemanager: ROLES.FINANCE_MANAGER,
  supportstaff: ROLES.SUPPORT_STAFF,
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.PLATFORM_SUPER_ADMIN]: [
    PERMISSIONS.MANAGE_TENANTS,
    PERMISSIONS.VIEW_PLATFORM_ANALYTICS,
    PERMISSIONS.MANAGE_PLATFORM_SUBSCRIPTIONS,
  ],
  [ROLES.SUPER_ADMIN]: ['*'],
  [ROLES.BRANCH_ADMIN]: [
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.MANAGE_DRIVERS,
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.MANAGE_OFFERS,
    PERMISSIONS.MANAGE_REVIEWS,
  ],
  [ROLES.FLEET_MANAGER]: [
    PERMISSIONS.MANAGE_FLEET,
    PERMISSIONS.MANAGE_MAINTENANCE,
    PERMISSIONS.MANAGE_INSPECTIONS,
    PERMISSIONS.MANAGE_DRIVERS,
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [ROLES.FINANCE_MANAGER]: [
    PERMISSIONS.PROCESS_REFUNDS,
    PERMISSIONS.VIEW_FINANCIALS,
    PERMISSIONS.MANAGE_INVOICES,
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.VIEW_ANALYTICS,
  ],
  [ROLES.SUPPORT_STAFF]: [
    PERMISSIONS.VIEW_ALL_BOOKINGS,
    PERMISSIONS.MANAGE_OFFERS,
    PERMISSIONS.MANAGE_REVIEWS,
  ],
  [ROLES.USER]: [],
});

const normalizeRoleKey = (value) => String(value || '').trim().replace(/[\s_-]+/g, '').toLowerCase();

export const normalizeRole = (value, fallback = ROLES.USER) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (Object.values(ROLES).includes(raw)) return raw;
  return LEGACY_ROLE_MAP[normalizeRoleKey(raw)] || fallback;
};

export const getRolePermissions = (roleValue) => {
  const normalizedRole = normalizeRole(roleValue);
  const list = ROLE_PERMISSIONS[normalizedRole];
  return Array.isArray(list) ? [...list] : [];
};

export const hasRolePermission = (roleValue, permission) => {
  if (!permission) return false;
  const permissions = getRolePermissions(roleValue);
  if (permissions.includes('*')) return true;
  return permissions.includes(permission);
};

export const isStaffRole = (roleValue) => normalizeRole(roleValue) !== ROLES.USER;
