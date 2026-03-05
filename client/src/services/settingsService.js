const SETTINGS_STORAGE_KEY = 'car_rent_admin_settings_v1';

export const DEFAULT_ADMIN_SETTINGS = Object.freeze({
  dashboardDefaultScope: 'all',
  autoRefreshSeconds: 60,
  enableChartAnimations: true,
  compactDensity: false,
  enableDesktopNotifications: true,
  enableSoundAlerts: false,
  defaultReminderLeadHours: 2,
  showUnreadBadge: true,
  confirmBeforeDelete: true,
  confirmSensitiveActions: true,
  sessionWarningMinutes: 10,
});

const toNumberInRange = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
};

const normalizeSettings = (raw = {}) => {
  const next = raw && typeof raw === 'object' ? raw : {};
  return {
    dashboardDefaultScope: next.dashboardDefaultScope === 'my' ? 'my' : 'all',
    autoRefreshSeconds: toNumberInRange(next.autoRefreshSeconds, DEFAULT_ADMIN_SETTINGS.autoRefreshSeconds, 15, 300),
    enableChartAnimations: Boolean(next.enableChartAnimations),
    compactDensity: Boolean(next.compactDensity),
    enableDesktopNotifications: Boolean(next.enableDesktopNotifications),
    enableSoundAlerts: Boolean(next.enableSoundAlerts),
    defaultReminderLeadHours: toNumberInRange(
      next.defaultReminderLeadHours,
      DEFAULT_ADMIN_SETTINGS.defaultReminderLeadHours,
      1,
      48,
    ),
    showUnreadBadge: Boolean(next.showUnreadBadge),
    confirmBeforeDelete: Boolean(next.confirmBeforeDelete),
    confirmSensitiveActions: Boolean(next.confirmSensitiveActions),
    sessionWarningMinutes: toNumberInRange(next.sessionWarningMinutes, DEFAULT_ADMIN_SETTINGS.sessionWarningMinutes, 1, 60),
  };
};

export const loadAdminSettings = () => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ADMIN_SETTINGS };
    const parsed = JSON.parse(raw);
    return normalizeSettings({ ...DEFAULT_ADMIN_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }
};

export const saveAdminSettings = (nextSettings = {}) => {
  const normalized = normalizeSettings(nextSettings);
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
};

export const resetAdminSettings = () => {
  window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  return { ...DEFAULT_ADMIN_SETTINGS };
};

export const applyAdminSettingsToDocument = (settings = DEFAULT_ADMIN_SETTINGS) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-admin-density', settings.compactDensity ? 'compact' : 'comfortable');
};

