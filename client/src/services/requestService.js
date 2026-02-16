import API from '../api';

export const createBookingRequest = async ({
  carId,
  pickupDateTime,
  dropDateTime,
  fromDate,
  toDate,
  gracePeriodHours,
}) => {
  const normalizedPickupDateTime = pickupDateTime || fromDate;
  const normalizedDropDateTime = dropDateTime || toDate;

  const response = await API.post('/requests', {
    carId,
    pickupDateTime: normalizedPickupDateTime,
    dropDateTime: normalizedDropDateTime,
    fromDate: normalizedPickupDateTime,
    toDate: normalizedDropDateTime,
    gracePeriodHours,
  });

  return response.data;
};
