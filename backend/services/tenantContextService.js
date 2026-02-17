const { AsyncLocalStorage } = require('async_hooks');

const tenantContextStorage = new AsyncLocalStorage();

const createDefaultTenantContext = () => ({
  tenantId: '',
  tenantCode: '',
  role: '',
  isPlatformSuperAdmin: false,
});

const runWithTenantContext = (context = {}, callback) => {
  const baseContext = {
    ...createDefaultTenantContext(),
    ...(context && typeof context === 'object' ? context : {}),
  };
  return tenantContextStorage.run(baseContext, callback);
};

const getTenantContext = () => tenantContextStorage.getStore() || createDefaultTenantContext();

const setTenantContext = (patch = {}) => {
  const currentContext = getTenantContext();
  const nextContext = {
    ...currentContext,
    ...(patch && typeof patch === 'object' ? patch : {}),
  };
  if (typeof tenantContextStorage.enterWith === 'function') {
    tenantContextStorage.enterWith(nextContext);
  }
  return nextContext;
};

const getTenantIdFromContext = () => {
  const context = getTenantContext();
  return String(context?.tenantId || '').trim();
};

const isPlatformSuperAdminContext = () => {
  const context = getTenantContext();
  return Boolean(context?.isPlatformSuperAdmin);
};

module.exports = {
  runWithTenantContext,
  getTenantContext,
  setTenantContext,
  getTenantIdFromContext,
  isPlatformSuperAdminContext,
};

