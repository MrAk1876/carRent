const mongoose = require('mongoose');
const {
  getTenantContext,
  getTenantIdFromContext,
  isPlatformSuperAdminContext,
} = require('../services/tenantContextService');

const TENANT_QUERY_HOOKS = [
  'find',
  'findOne',
  'count',
  'countDocuments',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndRemove',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
];

const shouldSkipTenantFilter = (query) => {
  const options = typeof query?.getOptions === 'function' ? query.getOptions() : query?.options || {};
  if (options?.skipTenantFilter === true) return true;
  return false;
};

const withTenantCondition = (existingQuery = {}, tenantObjectId = null) => {
  if (!tenantObjectId) return existingQuery;
  const tenantFilter = { tenantId: tenantObjectId };
  if (!existingQuery || Object.keys(existingQuery).length === 0) return tenantFilter;
  return { $and: [existingQuery, tenantFilter] };
};

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const tenantScopedPlugin = (schema, options = {}) => {
  const fieldName = options.fieldName || 'tenantId';
  if (!schema.path(fieldName)) {
    schema.add({
      [fieldName]: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        default: null,
        index: true,
      },
    });
  }

  schema.pre('save', function syncTenantOnCreate() {
    const context = getTenantContext();
    const tenantObjectId = toObjectId(context?.tenantId);
    if (tenantObjectId && !this[fieldName]) {
      this[fieldName] = tenantObjectId;
    }
  });

  TENANT_QUERY_HOOKS.forEach((hook) => {
    schema.pre(hook, function applyTenantScope() {
      if (shouldSkipTenantFilter(this)) {
        return;
      }

      if (isPlatformSuperAdminContext()) {
        return;
      }

      const tenantId = getTenantIdFromContext();
      const tenantObjectId = toObjectId(tenantId);
      if (!tenantObjectId) return;

      const currentQuery = typeof this.getQuery === 'function' ? this.getQuery() : {};
      this.setQuery(withTenantCondition(currentQuery, tenantObjectId));
    });
  });

  schema.pre('aggregate', function applyAggregateTenantScope() {
    if (isPlatformSuperAdminContext()) {
      return;
    }

    const options = this?.options || {};
    if (options?.skipTenantFilter === true) {
      return;
    }

    const tenantObjectId = toObjectId(getTenantIdFromContext());
    if (!tenantObjectId) return;

    const pipeline = Array.isArray(this.pipeline()) ? this.pipeline() : [];
    const tenantMatch = { [fieldName]: tenantObjectId };
    this.pipeline().unshift({ $match: tenantMatch });
  });
};

module.exports = tenantScopedPlugin;
