const { normalizeStatusKey } = require('./paymentUtils');

const FLEET_STATUS = Object.freeze({
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  RENTED: 'Rented',
  MAINTENANCE: 'Maintenance',
  INACTIVE: 'Inactive',
});

const FLEET_STATUS_VALUES = Object.freeze(Object.values(FLEET_STATUS));

const FLEET_STATUS_KEY_MAP = Object.freeze(
  FLEET_STATUS_VALUES.reduce((accumulator, statusValue) => {
    accumulator[normalizeStatusKey(statusValue)] = statusValue;
    return accumulator;
  }, {}),
);

const normalizeFleetStatus = (value, fallback = FLEET_STATUS.AVAILABLE) => {
  const normalizedKey = normalizeStatusKey(value);
  return FLEET_STATUS_KEY_MAP[normalizedKey] || fallback;
};

const isFleetBookable = (fleetStatus) => normalizeFleetStatus(fleetStatus) === FLEET_STATUS.AVAILABLE;

const fleetStatusToAvailability = (fleetStatus) => isFleetBookable(fleetStatus);

module.exports = {
  FLEET_STATUS,
  FLEET_STATUS_VALUES,
  FLEET_STATUS_KEY_MAP,
  normalizeFleetStatus,
  isFleetBookable,
  fleetStatusToAvailability,
};
