import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const SWIPE_THRESHOLD_PX = 72;
const SWIPE_MAX_OFFSET_PX = 104;
const SWIPE_MIN_DETECTION_PX = 6;

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
  const [swipeStageById, setSwipeStageById] = useState<Record<string, 1 | undefined>>({});
  const [swipeOffsetById, setSwipeOffsetById] = useState<Record<string, number>>({});
  const swipeSessionRef = useRef<{
    id: string;
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    isHorizontal: boolean;
    isCancelled: boolean;
  } | null>(null);
  const suppressClickMapRef = useRef<Record<string, number>>({});

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

  useEffect(() => {
    const idSet = new Set(notifications.map((entry) => normalizeString(entry._id)).filter(Boolean));
    setSwipeStageById((prev) => {
      let changed = false;
      const next: Record<string, 1 | undefined> = {};
      Object.keys(prev).forEach((id) => {
        if (idSet.has(id) && prev[id]) {
          next[id] = prev[id];
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setSwipeOffsetById((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      Object.keys(prev).forEach((id) => {
        if (idSet.has(id) && Number.isFinite(prev[id])) {
          next[id] = prev[id];
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [notifications]);

  const unreadLabel = useMemo(() => {
    if (unreadCount <= 0) return '0';
    if (unreadCount > 99) return '99+';
    return String(unreadCount);
  }, [unreadCount]);

  const closeMenu = useCallback(() => {
    setAnchorEl(null);
    setSwipeOffsetById({});
    setSwipeStageById({});
    swipeSessionRef.current = null;
    suppressClickMapRef.current = {};
  }, []);

  const clearSwipeState = useCallback((notificationId: string) => {
    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return;
    setSwipeOffsetById((prev) => {
      if (!(normalizedId in prev)) return prev;
      const next = { ...prev };
      delete next[normalizedId];
      return next;
    });
    setSwipeStageById((prev) => {
      if (!(normalizedId in prev)) return prev;
      const next = { ...prev };
      delete next[normalizedId];
      return next;
    });
  }, []);

  const markAsRead = useCallback(async (notificationId: string) => {
    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return;
    clearSwipeState(normalizedId);

    let wasUnread = false;
    setNotifications((prev) =>
      prev.map((entry) => {
        if (entry._id !== normalizedId) return entry;
        if (!entry.isRead) {
          wasUnread = true;
        }
        return { ...entry, isRead: true };
      }),
    );
    if (wasUnread) {
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    }

    try {
      await API.patch(`/notifications/read/${normalizedId}`, {}, { showErrorToast: false });
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to mark notification as read'));
      void refreshNotifications();
    }
  }, [clearSwipeState, notify, refreshNotifications]);

  const deleteNotification = useCallback(async (notificationId: string) => {
    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return;

    let removedUnread = 0;
    setNotifications((prev) => {
      const target = prev.find((entry) => entry._id === normalizedId);
      if (!target) return prev;
      removedUnread = target.isRead ? 0 : 1;
      return prev.filter((entry) => entry._id !== normalizedId);
    });
    if (removedUnread > 0) {
      setUnreadCount((prev) => Math.max(prev - removedUnread, 0));
    }
    clearSwipeState(normalizedId);

    try {
      await API.delete(`/notifications/${normalizedId}`, { showErrorToast: false });
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete notification'));
      void refreshNotifications();
    }
  }, [clearSwipeState, notify, refreshNotifications]);

  const setSwipeOffset = useCallback((notificationId: string, offset: number) => {
    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return;
    const clamped = Math.min(0, Math.max(-SWIPE_MAX_OFFSET_PX, Math.trunc(offset)));
    setSwipeOffsetById((prev) => {
      if (clamped === 0) {
        if (!(normalizedId in prev)) return prev;
        const next = { ...prev };
        delete next[normalizedId];
        return next;
      }
      if (prev[normalizedId] === clamped) return prev;
      return { ...prev, [normalizedId]: clamped };
    });
  }, []);

  const markSwipeClickSuppressed = useCallback((notificationId: string) => {
    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return;
    suppressClickMapRef.current[normalizedId] = Date.now() + 400;
  }, []);

  const shouldSuppressClick = useCallback((notificationId: string) => {
    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return false;
    const expiresAt = Number(suppressClickMapRef.current[normalizedId] || 0);
    if (!expiresAt) return false;
    if (expiresAt >= Date.now()) return true;
    delete suppressClickMapRef.current[normalizedId];
    return false;
  }, []);

  const handleSwipeAction = useCallback(async (item: NotificationEntry) => {
    const notificationId = normalizeString(item._id);
    if (!notificationId) return;

    const currentStage = swipeStageById[notificationId];
    if (!currentStage) {
      setSwipeStageById((prev) => ({ ...prev, [notificationId]: 1 }));
      if (!item.isRead) {
        await markAsRead(notificationId);
        notify.info('Marked as read. Swipe again to delete.');
      } else {
        notify.info('Swipe again to delete this notification.');
      }
      return;
    }

    await deleteNotification(notificationId);
    notify.success('Notification deleted');
  }, [deleteNotification, markAsRead, notify, swipeStageById]);

  const handlePointerDown = useCallback((notificationId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const normalizedId = normalizeString(notificationId);
    if (!normalizedId) return;

    swipeSessionRef.current = {
      id: normalizedId,
      pointerId: event.pointerId,
      pointerType: normalizeString(event.pointerType) || 'mouse',
      startX: event.clientX,
      startY: event.clientY,
      isHorizontal: false,
      isCancelled: false,
    };
    setSwipeOffset(normalizedId, 0);

    try {
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    } catch {
      // No-op. Some environments may not allow pointer capture.
    }
  }, [setSwipeOffset]);

  const handlePointerMove = useCallback((notificationId: string, event: React.PointerEvent<HTMLDivElement>) => {
    const active = swipeSessionRef.current;
    const normalizedId = normalizeString(notificationId);
    if (!active || active.id !== normalizedId || active.pointerId !== event.pointerId) return;
    if (active.isCancelled) return;

    const deltaX = event.clientX - active.startX;
    const deltaY = event.clientY - active.startY;

    if (!active.isHorizontal) {
      if (Math.abs(deltaX) < SWIPE_MIN_DETECTION_PX && Math.abs(deltaY) < SWIPE_MIN_DETECTION_PX) {
        return;
      }
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        active.isCancelled = true;
        setSwipeOffset(notificationId, 0);
        return;
      }
      active.isHorizontal = true;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
    if (deltaX >= 0) {
      setSwipeOffset(notificationId, 0);
      return;
    }
    setSwipeOffset(notificationId, deltaX);
  }, [setSwipeOffset]);

  const finishPointerSwipe = useCallback(async (
    item: NotificationEntry,
    event: React.PointerEvent<HTMLDivElement>,
    options: { cancelled?: boolean } = {},
  ) => {
    const notificationId = normalizeString(item._id);
    const active = swipeSessionRef.current;
    swipeSessionRef.current = null;

    try {
      if (typeof event.currentTarget.hasPointerCapture === 'function'
        && event.currentTarget.hasPointerCapture(event.pointerId)
        && typeof event.currentTarget.releasePointerCapture === 'function'
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // No-op.
    }

    if (!active || active.id !== notificationId || active.pointerId !== event.pointerId) {
      setSwipeOffset(notificationId, 0);
      return;
    }

    if (options.cancelled || active.isCancelled || !active.isHorizontal) {
      setSwipeOffset(notificationId, 0);
      return;
    }

    const swipeDistance = active.startX - event.clientX;
    setSwipeOffset(notificationId, 0);

    if (swipeDistance >= SWIPE_MIN_DETECTION_PX * 2) {
      markSwipeClickSuppressed(notificationId);
    }
    if (swipeDistance < SWIPE_THRESHOLD_PX) return;

    await handleSwipeAction(item);
  }, [handleSwipeAction, markSwipeClickSuppressed, setSwipeOffset]);

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
        onClose={closeMenu}
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
            <Box sx={{ px: 1.6, py: 1, borderBottom: '1px dashed', borderColor: alpha(theme.palette.divider, 0.6) }}>
              <Typography variant="caption" color="text.secondary">
                Swipe left once to mark read. Swipe left again to delete.
              </Typography>
            </Box>
            {notifications.map((item) => {
              const notificationId = normalizeString(item._id);
              const currentOffset = Number(swipeOffsetById[notificationId] || 0);
              const swipeDistance = Math.max(0, -currentOffset);
              const swipeProgress = Math.min(1, swipeDistance / SWIPE_THRESHOLD_PX);
              const isDeleteStage = Boolean(swipeStageById[notificationId]);
              const actionLabel = isDeleteStage
                ? 'Delete'
                : item.isRead
                  ? 'Arm Delete'
                  : 'Mark Read';
              const actionHint = isDeleteStage
                ? 'Second swipe confirmed'
                : item.isRead
                  ? 'First swipe'
                  : 'First swipe';
              const actionColor = isDeleteStage
                ? theme.palette.error.main
                : item.isRead
                  ? theme.palette.warning.main
                  : theme.palette.success.main;
              const actionBackground = isDeleteStage
                ? `linear-gradient(90deg, ${alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.1 : 0.04)} 0%, ${alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.45 : 0.22)} 100%)`
                : `linear-gradient(90deg, ${alpha(actionColor, theme.palette.mode === 'dark' ? 0.08 : 0.03)} 0%, ${alpha(actionColor, theme.palette.mode === 'dark' ? 0.32 : 0.16)} 100%)`;
              const actionOpacity = isDeleteStage ? 0.96 : swipeProgress;
              const actionScale = 0.92 + Math.min(1, swipeProgress) * 0.08;

              return (
                <Box
                  key={notificationId}
                  sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    borderBottom: '1px solid',
                    borderColor: alpha(theme.palette.divider, 0.5),
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      px: 1.6,
                      background: actionBackground,
                      opacity: actionOpacity,
                      transition: 'opacity 220ms ease, background 240ms ease',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{
                        color: actionColor,
                        transform: `translateX(${Math.round((1 - Math.min(1, swipeProgress)) * 14)}px) scale(${actionScale})`,
                        transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), color 220ms ease',
                      }}
                    >
                      <Box
                        sx={{
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: alpha(actionColor, 0.18),
                          border: `1px solid ${alpha(actionColor, 0.45)}`,
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          {isDeleteStage ? (
                            <path
                              d="M9 3h6m-9 4h12m-1 0-.7 11a2 2 0 0 1-2 1.9H9.7a2 2 0 0 1-2-1.9L7 7m3 4v5m4-5v5"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          ) : (
                            <path
                              d="m5 13 4 4L19 7"
                              stroke="currentColor"
                              strokeWidth="2.1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                        </svg>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.2, display: 'block' }}>
                          {actionLabel}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.78, display: 'block' }}>
                          {actionHint}
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>

                  <Box
                    onPointerDown={(event) => handlePointerDown(notificationId, event)}
                    onPointerMove={(event) => handlePointerMove(notificationId, event)}
                    onPointerUp={(event) => {
                      void finishPointerSwipe(item, event);
                    }}
                    onPointerCancel={(event) => {
                      void finishPointerSwipe(item, event, { cancelled: true });
                    }}
                    sx={{
                      touchAction: 'pan-y',
                      transform: `translateX(${currentOffset}px)`,
                      transition: currentOffset
                        ? 'none'
                        : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease',
                      userSelect: currentOffset ? 'none' : 'auto',
                      cursor: currentOffset ? 'grabbing' : 'grab',
                    }}
                  >
                    <ListItemButton
                      onClick={() => {
                        if (shouldSuppressClick(notificationId)) return;
                        if (isDeleteStage) {
                          clearSwipeState(notificationId);
                        }
                        if (normalizeString(item.type).toLowerCase() === 'message') {
                          openChatFromNotification();
                        }
                      }}
                      sx={{
                        alignItems: 'flex-start',
                        backgroundColor: item.isRead
                          ? alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.24 : 0.96)
                          : alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
                        boxShadow: isDeleteStage
                          ? `inset 0 0 0 1px ${alpha(theme.palette.error.main, 0.55)}`
                          : 'none',
                        transition: 'background-color 220ms ease, box-shadow 220ms ease',
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
                                  boxShadow: `0 0 0 5px ${alpha(theme.palette.primary.main, 0.13)}`,
                                  transition: 'box-shadow 220ms ease',
                                }}
                              />
                            ) : null}
                            {isDeleteStage ? (
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'error.main',
                                  fontWeight: 700,
                                  letterSpacing: 0.2,
                                }}
                              >
                                Swipe again to delete
                              </Typography>
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
                                    void markAsRead(notificationId);
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
                  </Box>
                </Box>
              );
            })}
          </List>
        )}
      </Menu>
    </>
  );
};

export default NotificationBell;
