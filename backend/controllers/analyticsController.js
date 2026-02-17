const { getAnalyticsDashboard } = require('../services/analyticsService');

exports.getAnalytics = async (req, res) => {
  try {
    const analytics = await getAnalyticsDashboard(req.user, {
      branchId: req.query?.branchId,
      range: req.query?.range,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
      timezone: req.query?.timezone,
      sortType: req.query?.sortType,
      customerSort: req.query?.customerSort,
    });

    return res.json(analytics);
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load analytics dashboard' : error.message;
    return res.status(status).json({ message });
  }
};
