import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const DEFAULT_DRAFT = Object.freeze({
  eventKey: '',
  name: '',
  description: '',
  messageTemplate: '',
  notificationTitleTemplate: '',
  smsTemplate: '',
  emailSubjectTemplate: '',
  emailTemplate: '',
  isActive: true,
  delivery: {
    inApp: true,
    email: true,
    sms: true,
  },
});

const normalizeText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeEventKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const toTemplateDraft = (entry = {}) => ({
  eventKey: normalizeEventKey(entry.eventKey),
  name: normalizeText(entry.name),
  description: normalizeText(entry.description),
  messageTemplate: String(entry.messageTemplate || '').trim(),
  notificationTitleTemplate: String(entry.notificationTitleTemplate || '').trim(),
  smsTemplate: String(entry.smsTemplate || '').trim(),
  emailSubjectTemplate: String(entry.emailSubjectTemplate || '').trim(),
  emailTemplate: String(entry.emailTemplate || '').trim(),
  isActive: entry.isActive !== undefined ? Boolean(entry.isActive) : true,
  delivery: {
    inApp: entry?.delivery?.inApp !== undefined ? Boolean(entry.delivery.inApp) : true,
    email: entry?.delivery?.email !== undefined ? Boolean(entry.delivery.email) : true,
    sms: entry?.delivery?.sms !== undefined ? Boolean(entry.delivery.sms) : true,
  },
});

const ManageAutoMessages = () => {
  const notify = useNotify();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionKey, setActionKey] = useState('');
  const [dialogState, setDialogState] = useState({
    open: false,
    mode: 'create',
    templateId: '',
  });
  const [draft, setDraft] = useState({ ...DEFAULT_DRAFT });

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/auto-messages', { showErrorToast: false });
      const rows = Array.isArray(response?.data?.templates) ? response.data.templates : [];
      setTemplates(rows);
      setErrorMsg('');
    } catch (error) {
      setTemplates([]);
      setErrorMsg(getErrorMessage(error, 'Failed to load auto message templates'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const stats = useMemo(() => {
    const total = templates.length;
    const active = templates.filter((entry) => Boolean(entry?.isActive)).length;
    const systemDefaults = templates.filter((entry) => Boolean(entry?.isSystemDefault)).length;
    const custom = Math.max(total - systemDefaults, 0);
    return { total, active, systemDefaults, custom };
  }, [templates]);

  const openCreateDialog = () => {
    setDialogState({
      open: true,
      mode: 'create',
      templateId: '',
    });
    setDraft({ ...DEFAULT_DRAFT });
  };

  const openEditDialog = (template) => {
    setDialogState({
      open: true,
      mode: 'edit',
      templateId: String(template?._id || ''),
    });
    setDraft(toTemplateDraft(template));
  };

  const closeDialog = () => {
    if (actionKey === 'save-template') return;
    setDialogState({ open: false, mode: 'create', templateId: '' });
    setDraft({ ...DEFAULT_DRAFT });
  };

  const updateDraft = (field, value) => {
    setDraft((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const updateDelivery = (field, checked) => {
    setDraft((previous) => ({
      ...previous,
      delivery: {
        ...previous.delivery,
        [field]: checked,
      },
    }));
  };

  const handleSaveTemplate = async () => {
    const payload = {
      eventKey: normalizeEventKey(draft.eventKey),
      name: normalizeText(draft.name),
      description: normalizeText(draft.description),
      messageTemplate: String(draft.messageTemplate || '').trim(),
      notificationTitleTemplate: String(draft.notificationTitleTemplate || '').trim(),
      smsTemplate: String(draft.smsTemplate || '').trim(),
      emailSubjectTemplate: String(draft.emailSubjectTemplate || '').trim(),
      emailTemplate: String(draft.emailTemplate || '').trim(),
      isActive: Boolean(draft.isActive),
      delivery: {
        inApp: Boolean(draft?.delivery?.inApp),
        email: Boolean(draft?.delivery?.email),
        sms: Boolean(draft?.delivery?.sms),
      },
    };

    if (!payload.name || !payload.messageTemplate) {
      notify.error('Name and message template are required');
      return;
    }
    if (dialogState.mode === 'create' && !payload.eventKey) {
      notify.error('Event key is required');
      return;
    }

    try {
      setActionKey('save-template');
      if (dialogState.mode === 'create') {
        await API.post('/admin/auto-messages', payload, { showErrorToast: false });
      } else {
        await API.put(`/admin/auto-messages/${dialogState.templateId}`, payload, { showErrorToast: false });
      }
      await loadTemplates();
      closeDialog();
      notify.success(dialogState.mode === 'create' ? 'Auto message created' : 'Auto message updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to save auto message template'));
    } finally {
      setActionKey('');
    }
  };

  const handleDeleteTemplate = async (template) => {
    const templateId = String(template?._id || '');
    if (!templateId) return;
    const confirmed = window.confirm(`Delete auto message "${template?.name || template?.eventKey}"?`);
    if (!confirmed) return;

    try {
      setActionKey(`delete:${templateId}`);
      await API.delete(`/admin/auto-messages/${templateId}`, { showErrorToast: false });
      await loadTemplates();
      notify.success('Auto message deleted');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete auto message'));
    } finally {
      setActionKey('');
    }
  };

  const toggleTemplateActive = async (template) => {
    const templateId = String(template?._id || '');
    if (!templateId) return;
    const nextActive = !Boolean(template?.isActive);

    try {
      setActionKey(`toggle:${templateId}`);
      await API.put(
        `/admin/auto-messages/${templateId}`,
        {
          ...toTemplateDraft(template),
          isActive: nextActive,
        },
        { showErrorToast: false },
      );
      await loadTemplates();
      notify.success(`Template ${nextActive ? 'enabled' : 'disabled'}`);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update template status'));
    } finally {
      setActionKey('');
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Auto Message Control"
        subTitle="Manage reminder and automated communication templates used across chat, email, and SMS."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4 max-w-6xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Templates</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Active</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-blue-700">System Defaults</p>
          <p className="mt-2 text-2xl font-semibold text-blue-700">{stats.systemDefaults}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-violet-700">Custom</p>
          <p className="mt-2 text-2xl font-semibold text-violet-700">{stats.custom}</p>
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-borderColor bg-white p-4 md:p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            Placeholders supported: <span className="font-semibold text-gray-800">{'{{userName}}'}</span>,{' '}
            <span className="font-semibold text-gray-800">{'{{carName}}'}</span>,{' '}
            <span className="font-semibold text-gray-800">{'{{pickupTime}}'}</span>,{' '}
            <span className="font-semibold text-gray-800">{'{{dropTime}}'}</span>,{' '}
            <span className="font-semibold text-gray-800">{'{{branchName}}'}</span>,{' '}
            <span className="font-semibold text-gray-800">{'{{dropLocation}}'}</span>,{' '}
            <span className="font-semibold text-gray-800">{'{{bookingId}}'}</span>
          </p>
          <button
            type="button"
            onClick={openCreateDialog}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            + Add Template
          </button>
        </div>

        {loading ? (
          <div className="mt-4 rounded-xl border border-borderColor bg-slate-50 px-4 py-6 text-sm text-gray-500">
            Loading templates...
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-borderColor">
            <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-gray-700">
                <tr>
                  <th className="px-3 py-2 font-medium">Event Key</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Message Preview</th>
                  <th className="px-3 py-2 font-medium">Delivery</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                      No auto message templates found.
                    </td>
                  </tr>
                ) : (
                  templates.map((template) => {
                    const templateId = String(template?._id || '');
                    const deleting = actionKey === `delete:${templateId}`;
                    const toggling = actionKey === `toggle:${templateId}`;
                    return (
                      <tr key={templateId || template.eventKey} className="border-t border-borderColor align-top">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-gray-800">{template.eventKey}</p>
                          {template.isSystemDefault ? (
                            <span className="mt-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                              System
                            </span>
                          ) : (
                            <span className="mt-1 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                              Custom
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-800">{template.name}</p>
                          <p className="mt-1 text-xs text-gray-500">{template.description || 'No description'}</p>
                        </td>
                        <td className="px-3 py-2">
                          <p className="max-w-[380px] truncate text-gray-700">{template.messageTemplate}</p>
                          <p className="mt-1 text-xs text-gray-500 truncate">
                            Notification: {template.notificationTitleTemplate || 'N/A'}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${template?.delivery?.inApp ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              In-App
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${template?.delivery?.email ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                              Email
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${template?.delivery?.sms ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                              SMS
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggleTemplateActive(template)}
                            disabled={toggling}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                              toggling
                                ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                : template.isActive
                                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {toggling ? 'Updating...' : template.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditDialog(template)}
                              className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(template)}
                              disabled={Boolean(template?.isSystemDefault) || deleting}
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                Boolean(template?.isSystemDefault) || deleting
                                  ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                  : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                              }`}
                              title={
                                template?.isSystemDefault
                                  ? 'System templates cannot be deleted'
                                  : 'Delete template'
                              }
                            >
                              {deleting ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialogState.open ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] p-3 md:p-4 modal-backdrop-enter"
          onClick={closeDialog}
        >
          <div
            className="w-full max-w-[min(980px,96vw)] max-h-[94vh] rounded-3xl border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.28)] overflow-hidden flex flex-col modal-panel-enter"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/70 px-5 py-4 md:px-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base md:text-lg font-semibold text-slate-900">
                    {dialogState.mode === 'create' ? 'Create Auto Message Template' : 'Edit Auto Message Template'}
                  </p>
                  <p className="mt-1 text-xs md:text-sm text-slate-600">
                    Configure message content and delivery channels.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={actionKey === 'save-template'}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="px-5 pb-5 pt-4 md:px-6 md:pb-6 md:pt-5 flex-1 min-h-0 overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs text-gray-600">
                  Event Key
                  <input
                    type="text"
                    value={draft.eventKey}
                    onChange={(event) => updateDraft('eventKey', normalizeEventKey(event.target.value))}
                    disabled={dialogState.mode !== 'create'}
                    placeholder="drop_reminder_2h"
                    className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm disabled:bg-slate-100"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Name
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => updateDraft('name', event.target.value)}
                    placeholder="Drop Reminder (2 Hours)"
                    className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="mt-3 block text-xs text-gray-600">
                Description
                <input
                  type="text"
                  value={draft.description}
                  onChange={(event) => updateDraft('description', event.target.value)}
                  placeholder="Short description for admin usage."
                  className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                />
              </label>

              <label className="mt-3 block text-xs text-gray-600">
                In-App Message Template
                <textarea
                  value={draft.messageTemplate}
                  onChange={(event) => updateDraft('messageTemplate', event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                />
              </label>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs text-gray-600">
                  Notification Title Template
                  <input
                    type="text"
                    value={draft.notificationTitleTemplate}
                    onChange={(event) => updateDraft('notificationTitleTemplate', event.target.value)}
                    className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  SMS Template
                  <input
                    type="text"
                    value={draft.smsTemplate}
                    onChange={(event) => updateDraft('smsTemplate', event.target.value)}
                    className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs text-gray-600">
                  Email Subject Template
                  <input
                    type="text"
                    value={draft.emailSubjectTemplate}
                    onChange={(event) => updateDraft('emailSubjectTemplate', event.target.value)}
                    className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  Status
                  <select
                    value={draft.isActive ? 'active' : 'inactive'}
                    onChange={(event) => updateDraft('isActive', event.target.value === 'active')}
                    className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <label className="mt-3 block text-xs text-gray-600">
                Email Template
                <textarea
                  value={draft.emailTemplate}
                  onChange={(event) => updateDraft('emailTemplate', event.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-borderColor px-3 py-2 text-sm"
                />
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(draft?.delivery?.inApp)}
                    onChange={(event) => updateDelivery('inApp', event.target.checked)}
                  />
                  In-App
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(draft?.delivery?.email)}
                    onChange={(event) => updateDelivery('email', event.target.checked)}
                  />
                  Email
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(draft?.delivery?.sms)}
                    onChange={(event) => updateDelivery('sms', event.target.checked)}
                  />
                  SMS
                </label>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={actionKey === 'save-template'}
                  className="rounded-lg border border-borderColor bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={actionKey === 'save-template'}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                    actionKey === 'save-template'
                      ? 'cursor-not-allowed bg-slate-400'
                      : 'bg-primary hover:bg-primary/90'
                  }`}
                >
                  {actionKey === 'save-template'
                    ? 'Saving...'
                    : dialogState.mode === 'create'
                      ? 'Create Template'
                      : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ManageAutoMessages;
