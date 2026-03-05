import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import ThemeToggle from '../../../components/ThemeToggle';
import useNotify from '../../../hooks/useNotify';
import { isPlatformSuperAdmin } from '../../../utils/auth';
import {
  applyAdminSettingsToDocument,
  loadAdminSettings,
  resetAdminSettings,
  saveAdminSettings,
} from '../../../services/settingsService';

const HEX_COLOR_PATTERN = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i;

const sanitizeColor = (value, fallback) => {
  const normalized = String(value || '').trim();
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback;
};

const tenantBrandOverrideKey = (tenantId) => `car_rent_tenant_brand_override_${String(tenantId || 'default').trim()}`;

const loadTenantBrandOverride = (tenantId) => {
  try {
    const raw = window.localStorage.getItem(tenantBrandOverrideKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      primaryColor: sanitizeColor(parsed.primaryColor, ''),
      secondaryColor: sanitizeColor(parsed.secondaryColor, ''),
      logoUrl: String(parsed.logoUrl || '').trim(),
    };
  } catch {
    return null;
  }
};

const saveTenantBrandOverride = (tenantId, value = {}) => {
  window.localStorage.setItem(tenantBrandOverrideKey(tenantId), JSON.stringify(value));
};

const clearTenantBrandOverride = (tenantId) => {
  window.localStorage.removeItem(tenantBrandOverrideKey(tenantId));
};

const ToggleField = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start justify-between gap-4 rounded-xl border border-borderColor bg-white px-4 py-3">
    <div>
      <p className="text-sm font-medium text-gray-800">{label}</p>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
  </label>
);

const Settings = () => {
  const notify = useNotify();
  const canManageTenantBranding = isPlatformSuperAdmin();
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError] = useState('');
  const [tenant, setTenant] = useState(null);
  const [branding, setBranding] = useState({
    primaryColor: '#2563EB',
    secondaryColor: '#0F172A',
    logoUrl: '',
  });
  const [brandingDirty, setBrandingDirty] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);

  const [preferences, setPreferences] = useState(() => loadAdminSettings());
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);

  useEffect(() => {
    applyAdminSettingsToDocument(preferences);
  }, [preferences]);

  useEffect(() => {
    let active = true;

    const loadTenant = async () => {
      setTenantLoading(true);
      setTenantError('');
      try {
        const response = await API.get('/tenant/context', { showErrorToast: false, cacheTtlMs: 0, maxRetries: 1 });
        if (!active) return;
        const tenantContext = response?.data?.tenant || null;
        setTenant(tenantContext);

        const localOverride = loadTenantBrandOverride(tenantContext?._id);
        setBranding({
          primaryColor: sanitizeColor(localOverride?.primaryColor || tenantContext?.primaryColor, '#2563EB'),
          secondaryColor: sanitizeColor(localOverride?.secondaryColor || tenantContext?.secondaryColor, '#0F172A'),
          logoUrl: String(localOverride?.logoUrl || tenantContext?.logoUrl || '').trim(),
        });
      } catch (error) {
        if (!active) return;
        setTenantError(getErrorMessage(error, 'Failed to load website settings context'));
      } finally {
        if (active) {
          setTenantLoading(false);
        }
      }
    };

    loadTenant();
    return () => {
      active = false;
    };
  }, []);

  const applyBrandingToDom = (nextBranding) => {
    document.documentElement.style.setProperty('--color-primary', sanitizeColor(nextBranding?.primaryColor, '#2563EB'));
    document.documentElement.style.setProperty(
      '--color-primary-dull',
      sanitizeColor(nextBranding?.secondaryColor, '#0F172A'),
    );
  };

  const handlePreferenceUpdate = (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    setPreferencesDirty(true);
  };

  const savePreferencesChanges = async () => {
    try {
      setSavingPreferences(true);
      const next = saveAdminSettings(preferences);
      setPreferences(next);
      setPreferencesDirty(false);
      applyAdminSettingsToDocument(next);
      notify.success('Settings saved');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to save settings'));
    } finally {
      setSavingPreferences(false);
    }
  };

  const resetPreferencesChanges = () => {
    const defaults = resetAdminSettings();
    setPreferences(defaults);
    setPreferencesDirty(false);
    applyAdminSettingsToDocument(defaults);
    notify.info('Settings reset to default values');
  };

  const saveBranding = async () => {
    const payload = {
      primaryColor: sanitizeColor(branding.primaryColor, ''),
      secondaryColor: sanitizeColor(branding.secondaryColor, ''),
      logoUrl: String(branding.logoUrl || '').trim(),
    };

    if (!payload.primaryColor || !payload.secondaryColor) {
      notify.error('Primary and secondary colors must be valid hex colors');
      return;
    }

    try {
      setSavingBranding(true);

      if (canManageTenantBranding) {
        if (!tenant?._id) {
          notify.error('Tenant context missing. Reload and try again.');
          return;
        }
        const response = await API.patch(`/platform/tenants/${tenant._id}`, payload);
        const updated = response?.data?.tenant || null;
        if (updated) {
          setTenant(updated);
        }
        clearTenantBrandOverride(tenant?._id);
        applyBrandingToDom(payload);
        setBrandingDirty(false);
        notify.success('Branding settings updated for tenant');
        return;
      }

      saveTenantBrandOverride(tenant?._id, payload);
      applyBrandingToDom(payload);
      setBrandingDirty(false);
      notify.success('Branding preview saved for this browser');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to save branding settings'));
    } finally {
      setSavingBranding(false);
    }
  };

  const clearLocalBrandingPreview = () => {
    clearTenantBrandOverride(tenant?._id);
    setBranding({
      primaryColor: sanitizeColor(tenant?.primaryColor, '#2563EB'),
      secondaryColor: sanitizeColor(tenant?.secondaryColor, '#0F172A'),
      logoUrl: String(tenant?.logoUrl || '').trim(),
    });
    applyBrandingToDom(tenant || {});
    setBrandingDirty(false);
    notify.info('Local branding preview removed');
  };

  const requestDesktopPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      notify.warning('Desktop notifications are not supported in this browser');
      return;
    }

    const result = await Notification.requestPermission();
    if (result === 'granted') {
      notify.success('Desktop notification permission granted');
    } else if (result === 'denied') {
      notify.warning('Desktop notification permission denied');
    } else {
      notify.info('Desktop notification permission dismissed');
    }
  };

  const summaryItems = useMemo(
    () => [
      { title: 'Dashboard Scope', value: preferences.dashboardDefaultScope === 'all' ? 'All Branches' : 'My Branches' },
      { title: 'Auto Refresh', value: `${preferences.autoRefreshSeconds}s` },
      { title: 'Reminder Lead', value: `${preferences.defaultReminderLeadHours}h` },
      { title: 'Session Warning', value: `${preferences.sessionWarningMinutes}m` },
    ],
    [preferences],
  );

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Settings"
        subTitle="Control website appearance, operational defaults, notification behavior, and safety preferences."
      />

      {tenantError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {tenantError}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 max-w-6xl">
        {summaryItems.map((item) => (
          <div key={item.title} className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">{item.title}</p>
            <p className="mt-2 text-xl font-semibold text-gray-800">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 max-w-6xl">
        <section className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Appearance & Branding</h2>
              <p className="text-sm text-gray-500 mt-1">
                Manage color identity and theme behavior across the dashboard.
              </p>
            </div>
            <ThemeToggle showLabel />
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500">Primary Color</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="color"
                  value={sanitizeColor(branding.primaryColor, '#2563EB')}
                  onChange={(event) => {
                    setBranding((prev) => ({ ...prev, primaryColor: event.target.value }));
                    setBrandingDirty(true);
                  }}
                  className="h-10 w-12 rounded-lg border border-borderColor bg-white"
                />
                <input
                  type="text"
                  value={branding.primaryColor}
                  onChange={(event) => {
                    setBranding((prev) => ({ ...prev, primaryColor: event.target.value }));
                    setBrandingDirty(true);
                  }}
                  className="flex-1 rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
                  placeholder="#2563EB"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Secondary Color</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="color"
                  value={sanitizeColor(branding.secondaryColor, '#0F172A')}
                  onChange={(event) => {
                    setBranding((prev) => ({ ...prev, secondaryColor: event.target.value }));
                    setBrandingDirty(true);
                  }}
                  className="h-10 w-12 rounded-lg border border-borderColor bg-white"
                />
                <input
                  type="text"
                  value={branding.secondaryColor}
                  onChange={(event) => {
                    setBranding((prev) => ({ ...prev, secondaryColor: event.target.value }));
                    setBrandingDirty(true);
                  }}
                  className="flex-1 rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
                  placeholder="#0F172A"
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500">Tenant Logo URL (optional)</label>
              <input
                type="text"
                value={branding.logoUrl}
                onChange={(event) => {
                  setBranding((prev) => ({ ...prev, logoUrl: event.target.value }));
                  setBrandingDirty(true);
                }}
                className="mt-1 w-full rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
                placeholder="https://example.com/logo.png"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <div className="h-4 w-4 rounded-full border border-borderColor" style={{ background: branding.primaryColor }} />
            <div
              className="h-4 w-4 rounded-full border border-borderColor"
              style={{ background: branding.secondaryColor }}
            />
            <span className="text-xs text-gray-500">
              {canManageTenantBranding ? 'Saves tenant-wide branding.' : 'Saves browser-only branding preview.'}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveBranding}
              disabled={savingBranding || !brandingDirty || tenantLoading}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingBranding ? 'Saving...' : 'Save Branding'}
            </button>
            {!canManageTenantBranding ? (
              <button
                type="button"
                onClick={clearLocalBrandingPreview}
                disabled={savingBranding || tenantLoading}
                className="rounded-lg border border-borderColor px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-60"
              >
                Clear Local Preview
              </button>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Operational Defaults</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure how admin modules behave by default on load.
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500">Default Dashboard Scope</label>
              <select
                value={preferences.dashboardDefaultScope}
                onChange={(event) => handlePreferenceUpdate('dashboardDefaultScope', event.target.value)}
                className="mt-1 w-full rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
              >
                <option value="all">All Branches</option>
                <option value="my">My Branches</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Auto Refresh Interval (seconds)</label>
              <input
                type="number"
                min={15}
                max={300}
                value={preferences.autoRefreshSeconds}
                onChange={(event) => handlePreferenceUpdate('autoRefreshSeconds', Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <ToggleField
              label="Enable chart animations"
              hint="Smooth transitions in dashboard charts and cards."
              checked={preferences.enableChartAnimations}
              onChange={(value) => handlePreferenceUpdate('enableChartAnimations', value)}
            />
            <ToggleField
              label="Compact dashboard density"
              hint="Tighter spacing for data-heavy operations."
              checked={preferences.compactDensity}
              onChange={(value) => handlePreferenceUpdate('compactDensity', value)}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Notification Preferences</h2>
          <p className="text-sm text-gray-500 mt-1">
            Control reminders, badges, and desktop notification behavior.
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <ToggleField
              label="Desktop notifications"
              hint="Allow browser popups for reminders and new messages."
              checked={preferences.enableDesktopNotifications}
              onChange={(value) => handlePreferenceUpdate('enableDesktopNotifications', value)}
            />
            <ToggleField
              label="Sound alerts"
              hint="Play sound for important notifications."
              checked={preferences.enableSoundAlerts}
              onChange={(value) => handlePreferenceUpdate('enableSoundAlerts', value)}
            />
            <ToggleField
              label="Unread badges"
              hint="Show unread counts in messaging and notification icons."
              checked={preferences.showUnreadBadge}
              onChange={(value) => handlePreferenceUpdate('showUnreadBadge', value)}
            />
            <div className="rounded-xl border border-borderColor bg-white px-4 py-3">
              <label className="text-sm font-medium text-gray-800">Default reminder lead (hours)</label>
              <input
                type="number"
                min={1}
                max={48}
                value={preferences.defaultReminderLeadHours}
                onChange={(event) => handlePreferenceUpdate('defaultReminderLeadHours', Number(event.target.value))}
                className="mt-2 w-full rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={requestDesktopPermission}
                className="mt-2 rounded-md border border-borderColor px-3 py-1.5 text-xs font-semibold text-gray-700"
              >
                Request Browser Permission
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Safety & Session Controls</h2>
          <p className="text-sm text-gray-500 mt-1">
            Add guardrails for critical actions performed by admins and managers.
          </p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <ToggleField
              label="Confirm before delete"
              hint="Show confirmation prompt before deleting records."
              checked={preferences.confirmBeforeDelete}
              onChange={(value) => handlePreferenceUpdate('confirmBeforeDelete', value)}
            />
            <ToggleField
              label="Double confirm sensitive actions"
              hint="Require additional confirmation for branch-level destructive actions."
              checked={preferences.confirmSensitiveActions}
              onChange={(value) => handlePreferenceUpdate('confirmSensitiveActions', value)}
            />
            <div className="rounded-xl border border-borderColor bg-white px-4 py-3 md:col-span-2">
              <label className="text-sm font-medium text-gray-800">Session warning before auto logout (minutes)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={preferences.sessionWarningMinutes}
                onChange={(event) => handlePreferenceUpdate('sessionWarningMinutes', Number(event.target.value))}
                className="mt-2 w-full md:max-w-sm rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={savePreferencesChanges}
              disabled={!preferencesDirty || savingPreferences}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPreferences ? 'Saving...' : 'Save Preferences'}
            </button>
            <button
              type="button"
              onClick={resetPreferencesChanges}
              disabled={savingPreferences}
              className="rounded-lg border border-borderColor px-4 py-2 text-sm font-semibold text-gray-700"
            >
              Reset Defaults
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings;

