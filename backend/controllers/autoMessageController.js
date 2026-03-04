const {
  getAutoMessages,
  createAutoMessage,
  updateAutoMessage,
  deleteAutoMessage,
  createAutoMessageError,
} = require('../services/autoMessageService');

const LIST_ERROR = 'Failed to load auto messages';
const CREATE_ERROR = 'Failed to create auto message';
const UPDATE_ERROR = 'Failed to update auto message';
const DELETE_ERROR = 'Failed to delete auto message';

const toSafeTenantId = (req) => String(req?.tenantId || req?.user?.tenantId || '').trim();

exports.getAutoMessages = async (req, res) => {
  try {
    const tenantId = toSafeTenantId(req);
    if (!tenantId) {
      throw createAutoMessageError(403, 'Tenant context is required');
    }
    const templates = await getAutoMessages(tenantId, { userId: req.user?._id });
    return res.json({ templates });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? LIST_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.createAutoMessage = async (req, res) => {
  try {
    const tenantId = toSafeTenantId(req);
    if (!tenantId) {
      throw createAutoMessageError(403, 'Tenant context is required');
    }
    const template = await createAutoMessage(tenantId, req.user?._id, req.body || {});
    return res.status(201).json({
      message: 'Auto message created',
      template,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? CREATE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateAutoMessage = async (req, res) => {
  try {
    const tenantId = toSafeTenantId(req);
    if (!tenantId) {
      throw createAutoMessageError(403, 'Tenant context is required');
    }
    const template = await updateAutoMessage(req.params?.id, tenantId, req.user?._id, req.body || {});
    return res.json({
      message: 'Auto message updated',
      template,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? UPDATE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteAutoMessage = async (req, res) => {
  try {
    const tenantId = toSafeTenantId(req);
    if (!tenantId) {
      throw createAutoMessageError(403, 'Tenant context is required');
    }
    const template = await deleteAutoMessage(req.params?.id, tenantId);
    return res.json({
      message: 'Auto message deleted',
      template,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? DELETE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};
