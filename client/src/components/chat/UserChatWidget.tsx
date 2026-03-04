import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Badge,
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useLocation } from 'react-router-dom';
import API, { getErrorMessage } from '../../api';
import useNotify from '../../hooks/useNotify';
import { getUser } from '../../utils/auth';
import socketClient from '../../services/socketClient';
import MessageThread, { ChatMessage, MessageDeleteScope } from './MessageThread';
import MessageInput from './MessageInput';

type UserChatWidgetProps = {
  adminUserId?: string;
  adminName?: string;
  title?: string;
};

type LooseRecord = Record<string, unknown>;

const STORAGE_ADMIN_ID_KEY = 'chat_admin_peer_id';

const normalizeText = (value: unknown) => String(value || '').trim();

const toId = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    const entry = value as LooseRecord;
    return normalizeText(entry._id || entry.id || entry.userId);
  }
  return '';
};

const toMessage = (value: LooseRecord): ChatMessage => {
  const senderId = toId(value.senderId);
  const receiverId = toId(value.receiverId);
  const fallbackId = `${senderId}-${receiverId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    _id: toId(value._id) || fallbackId,
    senderId,
    receiverId,
    content: normalizeText(value.content),
    createdAt: normalizeText(value.createdAt) || new Date().toISOString(),
    isRead: Boolean(value.isRead),
    type: normalizeText(value.type) || 'general',
    editedAt: normalizeText(value.editedAt) || null,
    isDeleted: Boolean(value.isDeleted),
    deletedAt: normalizeText(value.deletedAt) || null,
    isRemoved: Boolean(value.isRemoved),
  };
};

const sortByDateAsc = (messages: ChatMessage[]) =>
  [...messages].sort(
    (left, right) => new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime(),
  );

const addUniqueMessage = (messages: ChatMessage[], nextMessage: ChatMessage) => {
  if (!nextMessage?._id) return sortByDateAsc(messages);
  if (nextMessage.isRemoved) {
    return sortByDateAsc(messages.filter((message) => message._id !== nextMessage._id));
  }
  const existingIndex = messages.findIndex((message) => message._id === nextMessage._id);
  if (existingIndex >= 0) {
    const next = [...messages];
    next[existingIndex] = { ...next[existingIndex], ...nextMessage };
    return sortByDateAsc(next);
  }
  return sortByDateAsc([...messages, nextMessage]);
};

const resolveInitialAdminPeerId = (explicitAdminId?: string, currentUserId = '') => {
  const resolved = [
    normalizeText(explicitAdminId),
    normalizeText(localStorage.getItem(STORAGE_ADMIN_ID_KEY)),
    normalizeText(import.meta.env.VITE_SUPPORT_USER_ID),
  ].find((entry) => entry && entry !== currentUserId);
  return normalizeText(resolved);
};

const UserChatWidget: React.FC<UserChatWidgetProps> = ({
  adminUserId = '',
  adminName = '',
  title = 'Chat with Admin',
}) => {
  const theme = useTheme();
  const notify = useNotify();
  const location = useLocation();
  const currentUser = getUser();
  const currentUserId = toId(currentUser?._id);
  const tenantId = toId(currentUser?.tenantId);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [peerUserId, setPeerUserId] = useState('');
  const [resolvedPeerName, setResolvedPeerName] = useState('');
  const [resolvingAdmin, setResolvingAdmin] = useState(false);
  const [peerPresence, setPeerPresence] = useState<{ status: 'online' | 'offline'; lastSeen: string | null }>({
    status: 'offline',
    lastSeen: null,
  });

  const peerUserIdRef = useRef(peerUserId);
  const openRef = useRef(open);
  useEffect(() => {
    peerUserIdRef.current = peerUserId;
  }, [peerUserId]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const peerDisplayName = useMemo(() => {
    const envName = normalizeText(import.meta.env.VITE_SUPPORT_NAME);
    return normalizeText(resolvedPeerName) || normalizeText(adminName) || envName || 'Admin Team';
  }, [adminName, resolvedPeerName]);

  const peerPresenceLabel = useMemo(() => {
    if (peerPresence.status === 'online') return 'Online';
    if (!peerPresence.lastSeen) return 'Offline';
    const parsed = new Date(peerPresence.lastSeen);
    if (Number.isNaN(parsed.getTime())) return 'Offline';
    return `Last seen ${parsed.toLocaleString([], {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }, [peerPresence.lastSeen, peerPresence.status]);

  const syncUnreadCount = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const response = await API.get('/messages/unread-count', { showErrorToast: false });
      setUnreadCount(Number(response?.data?.unreadCount || 0));
    } catch {
      // Keep this background refresh silent.
    }
  }, [currentUserId]);

  const markMessagesRead = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    await Promise.all(
      messageIds.map((messageId) =>
        API.patch(`/messages/read/${messageId}`, {}, { showErrorToast: false }).catch(() => null),
      ),
    );
    setMessages((prev) => {
      const readSet = new Set(messageIds);
      return prev.map((message) => (readSet.has(message._id) ? { ...message, isRead: true } : message));
    });
    void syncUnreadCount();
  }, [syncUnreadCount]);

  const loadConversation = useCallback(async (targetPeerId: string, options: { silent?: boolean } = {}) => {
    const normalizedPeerId = toId(targetPeerId);
    if (!normalizedPeerId) return;

    if (!options.silent) {
      setLoading(true);
      setThreadError('');
    }
    try {
      const response = await API.get(`/messages/conversation/${normalizedPeerId}`, {
        showErrorToast: false,
        params: { limit: 250 },
      });
      const rows = Array.isArray(response?.data?.conversation) ? response.data.conversation : [];
      const mapped = sortByDateAsc(rows.map((entry: LooseRecord) => toMessage(entry)));
      setMessages(mapped);
      setReplyTo((previous) => {
        if (!previous) return null;
        return mapped.some((entry) => entry._id === previous._id) ? previous : null;
      });
      const unreadIds = mapped
        .filter((message) => message.receiverId === currentUserId && !message.isRead)
        .map((message) => message._id);
      if (unreadIds.length > 0) {
        await markMessagesRead(unreadIds);
      } else {
        void syncUnreadCount();
      }
    } catch (error) {
      if (!options.silent) {
        setThreadError(getErrorMessage(error, 'Failed to load conversation'));
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [currentUserId, markMessagesRead]);

  const resolveAdminContact = useCallback(async () => {
    if (!currentUserId) return '';
    try {
      setResolvingAdmin(true);
      const response = await API.get('/messages/admin-contact', { showErrorToast: false });
      const contact = (response?.data?.contact || {}) as LooseRecord;
      const resolvedId = toId(contact.userId || contact._id || contact.id);
      if (!resolvedId || resolvedId === currentUserId) return '';
      const resolvedName = normalizeText(contact.name || contact.fullName || contact.email);
      setPeerUserId(resolvedId);
      if (resolvedName) {
        setResolvedPeerName(resolvedName);
      }
      localStorage.setItem(STORAGE_ADMIN_ID_KEY, resolvedId);
      return resolvedId;
    } catch {
      return '';
    } finally {
      setResolvingAdmin(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    const resolvedAdminId = resolveInitialAdminPeerId(adminUserId, currentUserId);
    setPeerUserId(resolvedAdminId);
    if (!resolvedAdminId) {
      void resolveAdminContact();
    }
    void syncUnreadCount();
  }, [adminUserId, currentUserId, resolveAdminContact, syncUnreadCount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = new URLSearchParams(location.search || '');
    if (query.get('chat') !== 'open') return;
    setOpen(true);
    query.delete('chat');
    const nextQuery = query.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [location.search]);

  useEffect(() => {
    if (!open || !peerUserId) return;
    setReplyTo(null);
    void loadConversation(peerUserId);
  }, [loadConversation, open, peerUserId]);

  useEffect(() => {
    if (!open || peerUserId) return;
    void resolveAdminContact();
  }, [open, peerUserId, resolveAdminContact]);

  useEffect(() => {
    if (!open || !peerUserId) return undefined;
    const intervalHandle = window.setInterval(() => {
      void loadConversation(peerUserId, { silent: true });
    }, 8000);
    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [loadConversation, open, peerUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    const intervalHandle = window.setInterval(() => {
      void syncUnreadCount();
    }, 12000);
    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [currentUserId, syncUnreadCount]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    socketClient.connect(localStorage.getItem('token') || '', tenantId);
    const unsubscribeMessage = socketClient.on('message:new', (payload) => {
      const nextMessage = toMessage((payload?.message || {}) as LooseRecord);
      const isCurrentUserParticipant =
        nextMessage.senderId === currentUserId || nextMessage.receiverId === currentUserId;
      if (!isCurrentUserParticipant) return;

      const peerId =
        nextMessage.senderId === currentUserId ? nextMessage.receiverId : nextMessage.senderId;
      if (!peerId || peerId === currentUserId) return;

      if (!peerUserIdRef.current) {
        setPeerUserId(peerId);
        localStorage.setItem(STORAGE_ADMIN_ID_KEY, peerId);
      }

      const activePeerId = peerUserIdRef.current || peerId;
      if (peerId !== activePeerId) return;

      setMessages((prev) => addUniqueMessage(prev, nextMessage));

      const isIncoming = nextMessage.receiverId === currentUserId;
      if (!isIncoming) return;

      if (openRef.current) {
        void markMessagesRead([nextMessage._id]);
      }
    });

    const unsubscribeUnread = socketClient.on('unread:update', (payload) => {
      const payloadUserId = toId(payload?.userId);
      if (payloadUserId && payloadUserId !== currentUserId) return;
      setUnreadCount(Number(payload?.messages || 0));
    });

    const unsubscribePresence = socketClient.on('presence:update', (payload) => {
      const targetUserId = toId(payload?.userId);
      const activePeerId = peerUserIdRef.current;
      if (!targetUserId || !activePeerId || targetUserId !== activePeerId) return;
      const status = String(payload?.status || '').toLowerCase() === 'online' ? 'online' : 'offline';
      const lastSeenRaw = normalizeText(payload?.lastSeen);
      setPeerPresence((prev) => ({
        status,
        lastSeen: status === 'online' ? null : lastSeenRaw || prev.lastSeen || null,
      }));
    });

    return () => {
      unsubscribeMessage();
      unsubscribeUnread();
      unsubscribePresence();
    };
  }, [currentUserId, markMessagesRead, tenantId]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    const syncOnFocus = () => {
      void syncUnreadCount();
      const activePeerId = peerUserIdRef.current;
      if (openRef.current && activePeerId) {
        void loadConversation(activePeerId, { silent: true });
      }
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
  }, [currentUserId, loadConversation, syncUnreadCount]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const handleSendMessage = useCallback(async (content: string) => {
    let receiverId = peerUserId;
    if (!receiverId) {
      receiverId = await resolveAdminContact();
    }
    if (!receiverId) {
      notify.warning('Admin contact is unavailable right now.');
      return;
    }

    try {
      const response = await API.post('/messages/send', {
        receiverId,
        content,
        type: 'general',
      });
      const sentMessage = toMessage((response?.data?.data || {}) as LooseRecord);
      setMessages((prev) => addUniqueMessage(prev, sentMessage));
      localStorage.setItem(STORAGE_ADMIN_ID_KEY, receiverId);
      setThreadError('');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to send message'));
      throw error;
    }
  }, [notify, peerUserId, resolveAdminContact]);

  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!messageId) return;
    const response = await API.patch(`/messages/${messageId}`, { content });
    const updatedMessage = toMessage((response?.data?.data || {}) as LooseRecord);
    setMessages((prev) => addUniqueMessage(prev, updatedMessage));
  }, []);

  const handleDeleteMessage = useCallback(async (messageId: string, scope: MessageDeleteScope = 'for_everyone') => {
    if (!messageId) return;
    const response = await API.delete(`/messages/${messageId}`, { data: { scope } });
    const deletedMessage = toMessage((response?.data?.data || {}) as LooseRecord);
    setMessages((prev) => addUniqueMessage(prev, deletedMessage));
    setReplyTo((previous) => (previous?._id === messageId ? null : previous));
  }, []);

  if (!currentUserId) return null;
  if (typeof document === 'undefined') return null;

  const widget = (
    <Box
      sx={{
        position: 'fixed',
        right: { xs: 8, sm: 18 },
        bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', sm: 18 },
        zIndex: 1300,
      }}
    >
      {open ? (
        <Paper
          elevation={0}
          sx={{
            width: { xs: 'calc(100vw - 16px)', sm: 370 },
            maxWidth: { xs: 'calc(100vw - 16px)', sm: 370 },
            height: { xs: 'min(calc(100dvh - 90px), 720px)', sm: 540 },
            maxHeight: { xs: 'calc(100dvh - 90px)', sm: 540 },
            mb: { xs: 0.6, sm: 1.2 },
            borderRadius: { xs: 2.2, sm: 3 },
            border: '1px solid',
            borderColor: alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.72 : 0.9),
            boxShadow: `0 26px 60px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.62 : 0.2)}`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.84 : 0.96),
            transform: 'translateY(0)',
            transition: 'opacity 180ms ease, transform 180ms ease',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{
              px: 1.25,
              py: 1.1,
              borderBottom: '1px solid',
              borderColor: 'divider',
              backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.3 : 0.1),
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {peerDisplayName} - {peerPresenceLabel}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </IconButton>
          </Stack>

          {!peerUserId && !loading ? (
            <Stack sx={{ flex: 1, p: 2 }} justifyContent="center" spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Admin contact is unavailable at the moment.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {resolvingAdmin ? 'Finding an available admin...' : 'Please try again in a moment.'}
              </Typography>
            </Stack>
          ) : (
            <>
              {loading && messages.length === 0 ? (
                <Stack sx={{ flex: 1 }} alignItems="center" justifyContent="center">
                  <CircularProgress size={22} />
                </Stack>
              ) : (
                <MessageThread
                  messages={messages}
                  currentUserId={currentUserId}
                  activeName={peerDisplayName}
                  loading={loading}
                  error={threadError}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                  onReplyMessage={(message) => setReplyTo(message)}
                />
              )}
              <MessageInput
                disabled={!peerUserId}
                placeholder={peerUserId ? 'Type a message' : 'Admin unavailable'}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(null)}
                onSend={handleSendMessage}
              />
            </>
          )}
        </Paper>
      ) : null}

      <Badge
        color="error"
        badgeContent={unreadCount > 99 ? '99+' : unreadCount}
        invisible={unreadCount <= 0}
        overlap="circular"
      >
        <IconButton
          onClick={() => setOpen((prev) => !prev)}
          aria-label={open ? 'Close chat' : 'Open chat'}
          sx={{
            width: 54,
            height: 54,
            borderRadius: 999,
            color: 'common.white',
            background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${alpha(
              theme.palette.primary.dark,
              0.95,
            )} 100%)`,
            boxShadow: `0 16px 32px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.56 : 0.38)}`,
            '&:hover': {
              background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 100%)`,
            },
          }}
        >
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 8h10M7 12h6m-8 8 2.6-2H18a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 2 2.8V20z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </IconButton>
      </Badge>
    </Box>
  );

  return createPortal(widget, document.body);
};

export default UserChatWidget;
