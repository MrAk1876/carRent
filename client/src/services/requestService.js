import API from '../api';

export const createBookingRequest = async ({
  carId,
  pickupDateTime,
  dropDateTime,
  fromDate,
  toDate,
  gracePeriodHours,
  useSubscription,
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
    useSubscription: Boolean(useSubscription),
  });

  return response.data;
};
