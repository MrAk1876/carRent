import dayjs, { Dayjs } from 'dayjs';

export const DATE_KEY_FORMAT = 'YYYY-MM-DD';

export type AvailabilityState =
  | 'AVAILABLE'
  | 'BOOKED'
  | 'MAINTENANCE'
  | 'BLACKOUT'
  | 'RESERVED'
  | 'UNKNOWN';

export type AvailabilityTimelineEntry = {
  date: string;
  state: AvailabilityState | string;
};

export type AvailabilityTimelineResponse = {
  timeline?: AvailabilityTimelineEntry[];
  booked?: string[];
  maintenance?: string[];
  blackout?: string[];
  reserved?: string[];
};

export type BookingRuleViolation =
  | 'VALID'
  | 'MISSING_PICKUP_DATE'
  | 'MISSING_DROP_DATE'
  | 'INVALID_PICKUP_DATE'
  | 'INVALID_DROP_DATE'
  | 'PICKUP_IN_PAST'
  | 'DROP_BEFORE_PICKUP'
  | 'SAME_DAY_DROP_NOT_ALLOWED'
  | 'MIN_RENTAL_NOT_MET'
  | 'MAX_RENTAL_EXCEEDED';

export type BookingRuleValidation = {
  valid: boolean;
  rule: BookingRuleViolation;
  reason: string;
  rentalDays: number;
};

export type DateRangeSelection = {
  pickupDate: Dayjs | null;
  dropDate: Dayjs | null;
};

export const AVAILABILITY_PRIORITY: Record<AvailabilityState, number> = {
  UNKNOWN: -1,
  AVAILABLE: 0,
  RESERVED: 1,
  BLACKOUT: 2,
  MAINTENANCE: 3,
  BOOKED: 4,
};

export const normalizeToDayStart = (value: Dayjs | Date | string): Dayjs => dayjs(value).startOf('day');

export const toDateKey = (value: Dayjs | Date | string): string =>
  normalizeToDayStart(value).format(DATE_KEY_FORMAT);

export const fromDateKey = (value: string): Dayjs => dayjs(value, DATE_KEY_FORMAT).startOf('day');

export const getToday = (): Dayjs => dayjs().startOf('day');

export const isValidDay = (value: Dayjs | null | undefined): value is Dayjs =>
  Boolean(value && value.isValid());

export const isPastDay = (value: Dayjs, referenceDate: Dayjs = getToday()): boolean =>
  normalizeToDayStart(value).isBefore(normalizeToDayStart(referenceDate), 'day');

export const isSameDay = (left: Dayjs | null, right: Dayjs | null): boolean => {
  if (!isValidDay(left) || !isValidDay(right)) return false;
  return left.isSame(right, 'day');
};

export const isInClosedRange = (value: Dayjs, start: Dayjs, end: Dayjs): boolean => {
  const normalizedValue = normalizeToDayStart(value);
  const normalizedStart = normalizeToDayStart(start);
  const normalizedEnd = normalizeToDayStart(end);
  return (
    normalizedValue.isSame(normalizedStart, 'day') ||
    normalizedValue.isSame(normalizedEnd, 'day') ||
    (normalizedValue.isAfter(normalizedStart, 'day') && normalizedValue.isBefore(normalizedEnd, 'day'))
  );
};

export const isInOpenRange = (value: Dayjs, start: Dayjs, end: Dayjs): boolean => {
  const normalizedValue = normalizeToDayStart(value);
  const normalizedStart = normalizeToDayStart(start);
  const normalizedEnd = normalizeToDayStart(end);
  return normalizedValue.isAfter(normalizedStart, 'day') && normalizedValue.isBefore(normalizedEnd, 'day');
};

export const buildCalendarDays = (month: Dayjs): Dayjs[] => {
  const normalizedMonth = normalizeToDayStart(month).startOf('month');
  const firstGridDay = normalizedMonth.startOf('week');
  const lastGridDay = normalizedMonth.endOf('month').endOf('week');

  const days: Dayjs[] = [];
  let cursor = firstGridDay;

  while (cursor.isBefore(lastGridDay, 'day') || cursor.isSame(lastGridDay, 'day')) {
    days.push(cursor);
    cursor = cursor.add(1, 'day');
  }

  return days;
};

export const splitIntoWeeks = (days: Dayjs[]): Dayjs[][] => {
  const weeks: Dayjs[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
};

export const resolveAvailabilityState = (
  date: Dayjs,
  availabilityMap: Record<string, AvailabilityState>,
): AvailabilityState => {
  return availabilityMap[toDateKey(date)] || 'AVAILABLE';
};

export const isBlockedByAvailability = (state: AvailabilityState): boolean =>
  ['BOOKED', 'MAINTENANCE', 'BLACKOUT', 'RESERVED'].includes(state);

export const isDayDisabled = (
  date: Dayjs,
  availabilityMap: Record<string, AvailabilityState>,
  referenceDate: Dayjs = getToday(),
): boolean => {
  if (isPastDay(date, referenceDate)) return true;
  return isBlockedByAvailability(resolveAvailabilityState(date, availabilityMap));
};

const normalizeTimelineState = (rawState: string): AvailabilityState => {
  const upper = String(rawState || '').trim().toUpperCase();
  if (upper === 'BOOKED') return 'BOOKED';
  if (upper === 'MAINTENANCE') return 'MAINTENANCE';
  if (upper === 'BLACKOUT') return 'BLACKOUT';
  if (upper === 'RESERVED') return 'RESERVED';
  if (upper === 'AVAILABLE') return 'AVAILABLE';
  return 'UNKNOWN';
};

export const normalizeAvailabilityMap = (
  payload: AvailabilityTimelineResponse | null | undefined,
): Record<string, AvailabilityState> => {
  const map: Record<string, AvailabilityState> = {};
  if (!payload) return map;

  const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
  for (const entry of timeline) {
    const key = String(entry?.date || '').trim();
    if (!key) continue;
    map[key] = normalizeTimelineState(String(entry?.state || ''));
  }

  const assignFallbackState = (dates: string[] | undefined, state: AvailabilityState) => {
    if (!Array.isArray(dates)) return;
    for (const dateKey of dates) {
      const key = String(dateKey || '').trim();
      if (!key) continue;
      const currentState = map[key] || 'AVAILABLE';
      if ((AVAILABILITY_PRIORITY[state] ?? 0) >= (AVAILABILITY_PRIORITY[currentState] ?? 0)) {
        map[key] = state;
      }
    }
  };

  assignFallbackState(payload.booked, 'BOOKED');
  assignFallbackState(payload.maintenance, 'MAINTENANCE');
  assignFallbackState(payload.blackout, 'BLACKOUT');
  assignFallbackState(payload.reserved, 'RESERVED');

  return map;
};

export const resolvePreviewEndDate = (
  pickupDate: Dayjs | null,
  dropDate: Dayjs | null,
  hoverDate: Dayjs | null,
): Dayjs | null => {
  if (dropDate) return normalizeToDayStart(dropDate);
  if (!pickupDate || !hoverDate) return null;

  const normalizedHoverDate = normalizeToDayStart(hoverDate);
  if (normalizedHoverDate.isBefore(pickupDate, 'day')) return null;
  return normalizedHoverDate;
};

export const calculateRentalDays = (pickupDate: Dayjs, dropDate: Dayjs): number => {
  return normalizeToDayStart(dropDate).diff(normalizeToDayStart(pickupDate), 'day');
};

export const validateBookingBusinessRules = ({
  pickupDate,
  dropDate,
  minRentalDays = 1,
  maxRentalDays = 30,
  referenceDate = getToday(),
}: {
  pickupDate: Dayjs | null;
  dropDate: Dayjs | null;
  minRentalDays?: number;
  maxRentalDays?: number;
  referenceDate?: Dayjs;
}): BookingRuleValidation => {
  if (!isValidDay(pickupDate)) {
    return { valid: false, rule: 'MISSING_PICKUP_DATE', reason: 'Pickup date is required.', rentalDays: 0 };
  }
  if (!pickupDate.isValid()) {
    return { valid: false, rule: 'INVALID_PICKUP_DATE', reason: 'Invalid pickup date.', rentalDays: 0 };
  }
  if (pickupDate.isBefore(referenceDate, 'day')) {
    return { valid: false, rule: 'PICKUP_IN_PAST', reason: 'Pickup date cannot be in the past.', rentalDays: 0 };
  }

  if (!isValidDay(dropDate)) {
    return { valid: false, rule: 'MISSING_DROP_DATE', reason: 'Drop date is required.', rentalDays: 0 };
  }
  if (!dropDate.isValid()) {
    return { valid: false, rule: 'INVALID_DROP_DATE', reason: 'Invalid drop date.', rentalDays: 0 };
  }

  const rentalDays = calculateRentalDays(pickupDate, dropDate);
  if (dropDate.isBefore(pickupDate, 'day')) {
    return {
      valid: false,
      rule: 'DROP_BEFORE_PICKUP',
      reason: 'Drop date must be after pickup date.',
      rentalDays,
    };
  }
  if (dropDate.isSame(pickupDate, 'day')) {
    return {
      valid: false,
      rule: 'SAME_DAY_DROP_NOT_ALLOWED',
      reason: 'Same-day drop is not allowed.',
      rentalDays,
    };
  }

  if (rentalDays < Math.max(minRentalDays, 1)) {
    return {
      valid: false,
      rule: 'MIN_RENTAL_NOT_MET',
      reason: `Minimum rental duration is ${Math.max(minRentalDays, 1)} day.`,
      rentalDays,
    };
  }

  if (rentalDays > Math.max(maxRentalDays, minRentalDays)) {
    return {
      valid: false,
      rule: 'MAX_RENTAL_EXCEEDED',
      reason: `Maximum rental duration is ${Math.max(maxRentalDays, minRentalDays)} days.`,
      rentalDays,
    };
  }

  return { valid: true, rule: 'VALID', reason: '', rentalDays };
};

export const shouldShowWeekendIndicator = (date: Dayjs): boolean => {
  const day = normalizeToDayStart(date).day();
  return day === 0 || day === 6;
};

export const enumerateDateKeysInRange = (pickupDate: Dayjs, dropDate: Dayjs): string[] => {
  const start = normalizeToDayStart(pickupDate);
  const end = normalizeToDayStart(dropDate);
  const keys: string[] = [];
  let cursor = start;

  while (cursor.isBefore(end, 'day') || cursor.isSame(end, 'day')) {
    keys.push(toDateKey(cursor));
    cursor = cursor.add(1, 'day');
  }

  return keys;
};
