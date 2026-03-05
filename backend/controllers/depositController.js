const {
  getDepositRules,
  createDepositRule,
  updateDepositRule,
  deleteDepositRule,
} = require('../services/depositService');

exports.getAdminDepositRules = async (req, res) => {
  try {
    const rules = await getDepositRules({ tenantId: req.tenant?._id || req.user?.tenantId || null });
    return res.json({ rules });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load deposit rules' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createAdminDepositRule = async (req, res) => {
  try {
    const rule = await createDepositRule(req.body || {}, {
      tenantId: req.tenant?._id || req.user?.tenantId || null,
    });
    return res.status(201).json({
      message: 'Deposit rule created successfully',
      rule,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to create deposit rule' : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateAdminDepositRule = async (req, res) => {
  try {
    const rule = await updateDepositRule(req.params.id, req.body || {});
    return res.json({
      message: 'Deposit rule updated successfully',
      rule,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update deposit rule' : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteAdminDepositRule = async (req, res) => {
  try {
    const rule = await deleteDepositRule(req.params.id);
    return res.json({
      message: 'Deposit rule deleted successfully',
      rule,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to delete deposit rule' : error.message;
    return res.status(status).json({ message });
  }
};
