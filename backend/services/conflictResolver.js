const {
  AVAILABILITY_STATE,
  buildAvailabilityTimeline,
  evaluateDateRangeRentability,
} = require('./availabilityService');

const resolveAvailabilityConflict = async (options = {}) => {
  const {
    carId,
    startDate,
    endDate,
    fromDate,
    toDate,
    skipCarValidation = false,
    maxRangeDays,
  } = options;

  const normalizedFromDate = fromDate || startDate;
  const normalizedToDate = toDate || endDate;

  const evaluation = await evaluateDateRangeRentability({
    carId,
    fromDate: normalizedFromDate,
    toDate: normalizedToDate,
    skipCarValidation,
    maxRangeDays,
  });

  const allConflictingDates = evaluation.timeline
    .filter((entry) => entry.state !== AVAILABILITY_STATE.AVAILABLE)
    .map((entry) => entry.date);

  return {
    valid: evaluation.valid,
    conflictReason: evaluation.conflictReason || '',
    conflictingDates: allConflictingDates,
    primaryConflictDates: evaluation.conflictingDates,
    summary: evaluation.summary,
  };
};

const isDateRangeConflictFree = async (options = {}) => {
  const result = await resolveAvailabilityConflict(options);
  return Boolean(result.valid);
};

module.exports = {
  resolveAvailabilityConflict,
  isDateRangeConflictFree,
  buildAvailabilityTimeline,
};
