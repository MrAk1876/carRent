const STORAGE_KEY = 'car-rental:selected-location';

const normalizeText = (value) => String(value || '').trim();
const normalizeId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (value?._id) return String(value._id).trim();
  return '';
};

const sanitizeSelection = (selection = {}) => ({
  userId: normalizeId(selection.userId),
  stateId: normalizeId(selection.stateId),
  cityId: normalizeId(selection.cityId),
  locationId: normalizeId(selection.locationId),
  stateName: normalizeText(selection.stateName || selection.state || selection.stateId?.name),
  cityName: normalizeText(selection.cityName || selection.city || selection.cityId?.name),
  locationName: normalizeText(
    selection.locationName || selection.location || selection.locationId?.name,
  ),
});

const readStorage = (storage) => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSelection(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeStorage = (storage, selection) => {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSelection(selection)));
  } catch {
    // Ignore storage errors.
  }
};

const readStoredUser = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const getCurrentUserId = () => normalizeId(readStoredUser()?._id);

export const hasCompleteLocationSelection = (selection = {}) =>
  Boolean(normalizeText(selection.stateId) && normalizeText(selection.cityId) && normalizeText(selection.locationId));

export const loadSavedLocationSelection = () => {
  if (typeof window === 'undefined') return sanitizeSelection({});
  const savedSelection =
    readStorage(window.localStorage) ||
    readStorage(window.sessionStorage) ||
    sanitizeSelection({});
  const currentUserId = getCurrentUserId();

  if (currentUserId) {
    if (!savedSelection.userId || savedSelection.userId !== currentUserId) {
      return sanitizeSelection({});
    }
    return savedSelection;
  }

  if (savedSelection.userId) {
    return sanitizeSelection({});
  }

  return savedSelection;
};

export const loadUserDefaultLocationSelection = () => {
  const user = readStoredUser();
  return sanitizeSelection({
    userId: user?._id,
    stateId: user?.stateId,
    cityId: user?.cityId,
    locationId: user?.locationId,
    stateName: user?.stateName,
    cityName: user?.cityName,
    locationName: user?.locationName,
  });
};

export const loadPreferredLocationSelection = () => {
  const userDefaultSelection = loadUserDefaultLocationSelection();
  if (hasCompleteLocationSelection(userDefaultSelection)) {
    return userDefaultSelection;
  }

  const savedSelection = loadSavedLocationSelection();
  if (hasCompleteLocationSelection(savedSelection)) {
    return savedSelection;
  }

  return userDefaultSelection;
};

export const saveLocationSelection = (selection) => {
  if (typeof window === 'undefined') return sanitizeSelection(selection);
  const sanitized = sanitizeSelection({
    ...selection,
    userId: selection?.userId || getCurrentUserId(),
  });
  writeStorage(window.localStorage, sanitized);
  writeStorage(window.sessionStorage, sanitized);
  return sanitized;
};

export const clearSavedLocationSelection = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};

export const findLocationOption = (options = [], target = {}) => {
  const requestedId = normalizeText(
    target.id || target._id || target.stateId || target.cityId || target.locationId,
  );
  const requestedName = normalizeText(
    target.name || target.stateName || target.cityName || target.locationName,
  ).toLowerCase();

  return (
    (options || []).find((option) => {
      const optionId = normalizeText(option?._id);
      const optionName = normalizeText(option?.name).toLowerCase();
      if (requestedId && optionId === requestedId) return true;
      if (requestedName && optionName === requestedName) return true;
      return false;
    }) || null
  );
};

export const buildLocationSelectionPayload = ({
  stateOption = null,
  cityOption = null,
  locationOption = null,
} = {}) =>
  sanitizeSelection({
    stateId: stateOption?._id || cityOption?.stateId || locationOption?.stateId || '',
    cityId: cityOption?._id || locationOption?.cityId || '',
    locationId: locationOption?._id || '',
    stateName: stateOption?.name || cityOption?.stateName || '',
    cityName: cityOption?.name || locationOption?.cityName || '',
    locationName: locationOption?.name || '',
  });
