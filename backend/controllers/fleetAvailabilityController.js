const { getFleetAvailabilityTimeline } = require('../services/fleetAvailabilityService');

const DEFAULT_FLEET_AVAILABILITY_ERROR = 'Failed to load fleet availability timeline';

const parseRangeFromQuery = (query = {}) => ({
  fromDate: query.from || query.startDate || query.start,
  toDate: query.to || query.endDate || query.end,
});

exports.getAdminFleetAvailability = async (req, res) => {
  try {
    const { fromDate, toDate } = parseRangeFromQuery(req.query);
    const result = await getFleetAvailabilityTimeline({
      user: req.user,
      fromDate,
      toDate,
      branchId: req.query?.branchId,
      concurrency: req.query?.concurrency,
      maxRangeDays: req.query?.maxRangeDays,
    });

    return res.json(result);
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? DEFAULT_FLEET_AVAILABILITY_ERROR : error.message;
    return res.status(status).json({ message });
  }
};
