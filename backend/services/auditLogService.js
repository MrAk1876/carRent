const AuditLog = require('../models/AuditLog');

const normalizeMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch {
    return null;
  }
};

const queueAuditLog = ({ userId, actionType, targetEntity, targetId = '', meta = null }) => {
  if (!userId || !actionType || !targetEntity) return;

  Promise.resolve()
    .then(() =>
      AuditLog.create({
        userId,
        actionType: String(actionType).trim(),
        targetEntity: String(targetEntity).trim(),
        targetId: String(targetId || '').trim(),
        meta: normalizeMeta(meta),
      }),
    )
    .catch((error) => {
      console.error('audit log failed:', error);
    });
};

module.exports = {
  queueAuditLog,
};
