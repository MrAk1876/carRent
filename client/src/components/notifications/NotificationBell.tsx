import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import API, { getErrorMessage } from '../../api';
import { getUser } from '../../utils/auth';
import { normalizeRole, ROLES } from '../../utils/rbac';
import useNotify from '../../hooks/useNotify';
import socketClient from '../../services/socketClient';

type NotificationEntry = {
  _id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  referenceId?: string;
  createdAt?: string;
};

type NotificationBellProps = {
  size?: 'small' | 'medium' | 'large';
  className?: string;
};

const normalizeString = (value: unknown) => String(value || '').trim();

const toNotification = (value: Record<string, unknown>): NotificationEntry => ({
  _id: normalizeString(value._id),
  title: normalizeString(value.title) || 'Notification',
  body: normalizeString(value.body),
  type: normalizeString(value.type) || 'system',
  isRead: Boolean(value.isRead),
  referenceId: normalizeString(value.referenceId),
  createdAt: normalizeString(value.createdAt),
});

const formatWhen = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const NotificationBell: React.FC<NotificationBellProps> = ({ size = 'medium', className = '' }) => {
  const notify = useNotify();
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();
  const currentUserId = normalizeString(user?._id);
  const tenantId = normalizeString(user?.tenantId);
  const isStaffUser = normalizeRole(user?.role, ROLES.USER) !== ROLES.USER;

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const open = Boolean(anchorEl);

  const refreshNotifications = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!currentUserId) return;
    if (!options.silent) {
      setLoading(true);
    }
    try {
      const response = await API.get('/notifications', { showErrorToast: false });
      const rowsRaw = Array.isArray(response?.data?.notifications) ? response.data.notifications : [];
      const mapped = rowsRaw.map((entry: Record<string, unknown>) => toNotification(entry));
      setNotifications(mapped);
      setUnreadCount(Number(response?.data?.unreadCount || 0));
    } catch (error) {
      if (!options.silent) {
        notify.error(getErrorMessage(error, 'Failed to load notifications'));
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [currentUserId, notify]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    void refreshNotifications();
    socketClient.connect(localStorage.getItem('token') || '', tenantId);

    const unsubscribeNotification = socketClient.on('notification:new', (payload) => {
      const next = toNotification((payload?.notification || {}) as Record<string, unknown>);
      if (!next._id) return;
      setNotifications((prev) => {
        const withoutDuplicate = prev.filter((entry) => entry._id !== next._id);
        return [{ ...next, isRead: false }, ...withoutDuplicate];
      });
      setUnreadCount((prev) => prev + 1);
    });

    const unsubscribeUnread = socketClient.on('unread:update', (payload) => {
      const payloadUserId = normalizeString(payload?.userId);
      if (payloadUserId && payloadUserId !== currentUserId) return;
      setUnreadCount(Number(payload?.notifications || 0));
    });

    return () => {
      unsubscribeNotification();
      unsubscribeUnread();
    };
  }, [currentUserId, refreshNotifications, tenantId]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    const intervalHandle = window.setInterval(() => {
      void refreshNotifications({ silent: true });
    }, 12000);
    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [currentUserId, refreshNotifications]);

  useEffect(() => {
    if (!open) return;
    void refreshNotifications({ silent: true });
  }, [open, refreshNotifications]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    const syncOnFocus = () => {
      void refreshNotifications({ silent: true });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncOnFocus();
      }
    };
    window.addEventListener('focus', syncOnFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', syncOnFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUserId, refreshNotifications]);

  const unreadLabel = useMemo(() => {
    if (unreadCount <= 0) return '0';
    if (unreadCount > 99) return '99+';
    return String(unreadCount);
  }, [unreadCount]);

  const markAsRead = useCallback(async (notificationId: string) => {
    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return;

    setNotifications((prev) =>
      prev.map((entry) => (entry._id === normalizedId ? { ...entry, isRead: true } : entry)),
    );
    setUnreadCount((prev) => Math.max(prev - 1, 0));

    try {
      await API.patch(`/notifications/read/${normalizedId}`, {}, { showErrorToast: false });
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to mark notification as read'));
      void refreshNotifications();
    }
  }, [notify, refreshNotifications]);

  const openChatFromNotification = useCallback(() => {
    const query = new URLSearchParams(location.search || '');
    query.set('chat', 'open');
    const nextQuery = query.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextQuery ? `?${nextQuery}` : '',
      },
      { replace: false },
    );
  }, [location.pathname, location.search, navigate]);

  const resolveSenderLabel = useCallback((item: NotificationEntry) => {
    if (normalizeString(item.type).toLowerCase() !== 'message') return '';
    return isStaffUser ? 'From: Customer' : 'From: Admin Team';
  }, [isStaffUser]);

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          size={size}
          className={className}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{
            border: `1px solid ${alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.7 : 0.9)}`,
            borderRadius: 2,
            backgroundColor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.85 : 0.96),
          }}
        >
          <Badge color="error" badgeContent={unreadLabel} invisible={unreadCount <= 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3.8c-3.1 0-5.6 2.5-5.6 5.6v2.2c0 .8-.2 1.6-.6 2.3L4.8 15c-.5 1-.1 2.2.9 2.7.3.2.7.3 1.1.3h10.4c1.1 0 2-.9 2-2 0-.4-.1-.7-.3-1.1l-.9-1.1c-.4-.7-.6-1.5-.6-2.3V9.4c0-3.1-2.5-5.6-5.6-5.6Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path d="M9.7 19.1a2.3 2.3 0 0 0 4.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        PaperProps={{
          sx: {
            width: 360,
            maxWidth: 'calc(100vw - 20px)',
            borderRadius: 2.5,
            border: '1px solid',
            borderColor: 'divider',
            mt: 1.1,
            boxShadow: `0 20px 44px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.5 : 0.18)}`,
          },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 1.1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Notifications
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {unreadCount} unread
          </Typography>
        </Stack>
        <Divider />
        {loading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ p: 2.2 }}>
            <CircularProgress size={22} />
          </Stack>
        ) : notifications.length === 0 ? (
          <Box sx={{ p: 2.1 }}>
            <Typography variant="body2" color="text.secondary">
              No notifications yet.
            </Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {notifications.map((item) => (
              <ListItemButton
                key={item._id}
                onClick={() => {
                  if (normalizeString(item.type).toLowerCase() === 'message') {
                    openChatFromNotification();
                  }
                }}
                sx={{
                  alignItems: 'flex-start',
                  borderBottom: '1px solid',
                  borderColor: alpha(theme.palette.divider, 0.5),
                  backgroundColor: item.isRead
                    ? 'transparent'
                    : alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
                }}
              >
                <ListItemText
                  primaryTypographyProps={{ component: 'div' }}
                  secondaryTypographyProps={{ component: 'div' }}
                  primary={
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {item.title}
                      </Typography>
                      {!item.isRead ? (
                        <Box
                          sx={{
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            backgroundColor: 'primary.main',
                          }}
                        />
                      ) : null}
                    </Stack>
                  }
                  secondary={
                    <Stack spacing={0.35} sx={{ mt: 0.2 }}>
                      {resolveSenderLabel(item) ? (
                        <Typography variant="caption" color="primary.main" sx={{ fontWeight: 600 }}>
                          {resolveSenderLabel(item)}
                        </Typography>
                      ) : null}
                      <Typography variant="body2" color="text.secondary">
                        {item.body}
                      </Typography>
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">
                          {formatWhen(item.createdAt)}
                        </Typography>
                        {!item.isRead ? (
                          <Typography
                            component="button"
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void markAsRead(item._id);
                            }}
                            sx={{
                              border: 'none',
                              background: 'transparent',
                              color: 'primary.main',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                              px: 0,
                            }}
                          >
                            Mark read
                          </Typography>
                        ) : null}
                      </Stack>
                    </Stack>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Menu>
    </>
  );
};

export default NotificationBell;
