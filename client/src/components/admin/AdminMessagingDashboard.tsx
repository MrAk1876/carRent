import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import API, { getErrorMessage } from '../../api';
import { getUser } from '../../utils/auth';
import { ROLES, normalizeRole } from '../../utils/rbac';
import useNotify from '../../hooks/useNotify';
import socketClient from '../../services/socketClient';
import ConversationList, { ConversationListItem } from '../chat/ConversationList';
import MessageThread, { ChatMessage, MessageDeleteScope } from '../chat/MessageThread';
import MessageInput from '../chat/MessageInput';

type Participant = {
  userId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
};

type AdminMessagingDashboardProps = {
  title?: string;
  subtitle?: string;
};

type LooseRecord = Record<string, unknown>;

type ConversationFilter = 'all' | 'unread';

const MAX_PREVIEW_LENGTH = 96;
const HIDDEN_CHAT_STORAGE_PREFIX = 'car-rental:admin-hidden-chats';

const normalizeText = (value: unknown) => String(value || '').trim();

const toId = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    const entry = value as LooseRecord;
    return normalizeText(entry._id || entry.id || entry.userId);
  }
  return '';
};

const extractRows = (value: unknown): LooseRecord[] => {
  if (Array.isArray(value)) return value as LooseRecord[];
  if (!value || typeof value !== 'object') return [];
  const payload = value as LooseRecord;
  if (Array.isArray(payload.data)) return payload.data as LooseRecord[];
  if (Array.isArray(payload.users)) return payload.users as LooseRecord[];
  if (Array.isArray(payload.bookings)) return payload.bookings as LooseRecord[];
  return [];
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

const formatPreview = (value: string) => {
  const normalized = normalizeText(value);
  if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1)}...`;
};

const buildHiddenChatStorageKey = (adminUserId: string, tenantId: string) =>
  `${HIDDEN_CHAT_STORAGE_PREFIX}:${tenantId || 'global'}:${adminUserId || 'anonymous'}`;

const readHiddenUserIds = (storageKey: string) => {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as string[];
    return [...new Set(parsed.map((entry) => toId(entry)).filter(Boolean))];
  } catch {
    return [] as string[];
  }
};

const writeHiddenUserIds = (storageKey: string, ids: string[]) => {
  if (typeof window === 'undefined') return;
  const unique = [...new Set(ids.map((entry) => toId(entry)).filter(Boolean))];
  if (unique.length === 0) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(unique));
};

const toParticipantFromUser = (entry: LooseRecord): Participant => {
  const userId = toId(entry._id || entry.id || entry.userId);
  const firstName = normalizeText(entry.firstName);
  const lastName = normalizeText(entry.lastName);
  const fullName = normalizeText(`${firstName} ${lastName}`);
  const email = normalizeText(entry.email);
  const fallback = fullName || email || `User ${userId.slice(0, 6)}`;
  return {
    userId,
    name: fallback,
    email,
    avatarUrl: normalizeText(entry.avatarUrl || entry.image),
  };
};

const buildParticipantsFromBookings = (rows: LooseRecord[], currentUserId: string) => {
  const participantMap = new Map<string, Participant>();
  rows.forEach((booking) => {
    const user = (booking.user || booking.userId || {}) as LooseRecord;
    const participant = toParticipantFromUser(user);
    if (!participant.userId || participant.userId === currentUserId) return;
    if (!participantMap.has(participant.userId)) {
      participantMap.set(participant.userId, participant);
    }
  });
  return [...participantMap.values()];
};

const AdminMessagingDashboard: React.FC<AdminMessagingDashboardProps> = ({
  title = 'Admin Messages',
  subtitle = 'Centralized conversation control',
}) => {
  const theme = useTheme();
  const notify = useNotify();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const currentUser = getUser();
  const currentUserId = toId(currentUser?._id);
  const tenantId = toId(currentUser?.tenantId);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [messagesByUser, setMessagesByUser] = useState<Record<string, ChatMessage[]>>({});
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [unreadByUser, setUnreadByUser] = useState<Record<string, number>>({});
  const [hiddenUserIds, setHiddenUserIds] = useState<string[]>([]);
  const [presenceByUser, setPresenceByUser] = useState<
    Record<string, { status: 'online' | 'offline'; lastSeen: string | null }>
  >({});
  const [totalUnread, setTotalUnread] = useState(0);
  const hiddenChatStorageKey = useMemo(
    () => buildHiddenChatStorageKey(currentUserId, tenantId),
    [currentUserId, tenantId],
  );
  const hiddenUserIdSet = useMemo(() => new Set(hiddenUserIds), [hiddenUserIds]);

  const selectedUserRef = useRef(selectedUserId);
  useEffect(() => {
    selectedUserRef.current = selectedUserId;
  }, [selectedUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setHiddenUserIds([]);
      return;
    }
    setHiddenUserIds(readHiddenUserIds(hiddenChatStorageKey));
  }, [currentUserId, hiddenChatStorageKey]);

  useEffect(() => {
    if (!currentUserId) return;
    writeHiddenUserIds(hiddenChatStorageKey, hiddenUserIds);
  }, [currentUserId, hiddenChatStorageKey, hiddenUserIds]);

  const ensureParticipant = useCallback((userId: string, nameHint = 'User') => {
    const normalizedUserId = toId(userId);
    if (!normalizedUserId || normalizedUserId === currentUserId) return;

    setParticipants((prev) => {
      if (prev.some((entry) => entry.userId === normalizedUserId)) return prev;
      return [
        ...prev,
        {
          userId: normalizedUserId,
          name: `${nameHint} ${normalizedUserId.slice(0, 4)}`,
        },
      ];
    });
  }, [currentUserId]);

  const syncUnreadCount = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const response = await API.get('/messages/unread-count', { showErrorToast: false });
      setTotalUnread(Number(response?.data?.unreadCount || 0));
    } catch {
      // Silent background refresh.
    }
  }, [currentUserId]);

  const markMessagesRead = useCallback(async (peerUserId: string, messageIds: string[]) => {
    if (!peerUserId || messageIds.length === 0) return;
    await Promise.all(
      messageIds.map((messageId) =>
        API.patch(`/messages/read/${messageId}`, {}, { showErrorToast: false }).catch(() => null),
      ),
    );
    setMessagesByUser((prev) => {
      const currentMessages = prev[peerUserId] || [];
      const readSet = new Set(messageIds);
      return {
        ...prev,
        [peerUserId]: currentMessages.map((message) =>
          readSet.has(message._id) ? { ...message, isRead: true } : message,
        ),
      };
    });
    setUnreadByUser((prev) => ({ ...prev, [peerUserId]: 0 }));
    void syncUnreadCount();
  }, [syncUnreadCount]);

  const handleToggleHiddenConversation = useCallback((peerUserId: string, hidden: boolean) => {
    const normalizedPeerId = toId(peerUserId);
    if (!normalizedPeerId) return;
    setHiddenUserIds((prev) => {
      const next = new Set(prev);
      if (hidden) {
        next.add(normalizedPeerId);
      } else {
        next.delete(normalizedPeerId);
      }
      return [...next];
    });
    if (hidden && selectedUserId === normalizedPeerId && !normalizeText(searchTerm)) {
      setSelectedUserId('');
    }
  }, [searchTerm, selectedUserId]);

  const loadConversation = useCallback(async (peerUserId: string, options: { silent?: boolean } = {}) => {
    const normalizedPeerId = toId(peerUserId);
    if (!normalizedPeerId) return;

    if (!options.silent) {
      setLoadingConversation(true);
      setThreadError('');
    }
    try {
      const response = await API.get(`/messages/conversation/${normalizedPeerId}`, {
        showErrorToast: false,
        params: { limit: 250 },
      });
      const conversationRows = extractRows(response?.data?.conversation || response?.data);
      const mappedMessages = sortByDateAsc(conversationRows.map(toMessage));
      setMessagesByUser((prev) => ({ ...prev, [normalizedPeerId]: mappedMessages }));

      const unreadIds = mappedMessages
        .filter((message) => message.receiverId === currentUserId && !message.isRead)
        .map((message) => message._id);
      if (unreadIds.length > 0) {
        await markMessagesRead(normalizedPeerId, unreadIds);
      } else {
        setUnreadByUser((prev) => ({ ...prev, [normalizedPeerId]: 0 }));
        void syncUnreadCount();
      }
    } catch (error) {
      if (!options.silent) {
        setThreadError(getErrorMessage(error, 'Failed to load conversation'));
      }
    } finally {
      if (!options.silent) {
        setLoadingConversation(false);
      }
    }
  }, [currentUserId, markMessagesRead]);

  const loadParticipants = useCallback(async () => {
    if (!currentUserId) return;
    setLoadingParticipants(true);

    try {
      const usersResponse = await API.get('/admin/users', { showErrorToast: false, cacheTtlMs: 60 * 1000 });
      const rows = extractRows(usersResponse?.data);
      const mapped = rows
        .filter((row) => normalizeRole(row.role) === ROLES.USER)
        .map(toParticipantFromUser)
        .filter((entry) => entry.userId && entry.userId !== currentUserId);
      const unique = new Map<string, Participant>();
      mapped.forEach((entry) => {
        unique.set(entry.userId, entry);
      });
      setParticipants([...unique.values()]);
      return;
    } catch {
      // Fallback below.
    } finally {
      setLoadingParticipants(false);
    }

    try {
      const bookingsResponse = await API.get('/admin/bookings', { showErrorToast: false });
      const bookingRows = extractRows(bookingsResponse?.data);
      setParticipants(buildParticipantsFromBookings(bookingRows, currentUserId));
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to load chat users'));
      setParticipants([]);
    }
  }, [currentUserId, notify]);

  useEffect(() => {
    void loadParticipants();
    void syncUnreadCount();
  }, [loadParticipants, syncUnreadCount]);

  useEffect(() => {
    if (participants.length === 0) {
      setSelectedUserId('');
      return;
    }
    if (selectedUserId && participants.some((entry) => entry.userId === selectedUserId)) return;

    // Do not auto-open first conversation; admin should pick from list explicitly.
    if (!selectedUserId) return;
    setSelectedUserId('');
  }, [participants, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    setReplyTo(null);
    void loadConversation(selectedUserId);
  }, [loadConversation, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return undefined;
    const intervalHandle = window.setInterval(() => {
      void loadConversation(selectedUserId, { silent: true });
    }, 9000);
    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [loadConversation, selectedUserId]);

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
    const syncOnFocus = () => {
      void syncUnreadCount();
      const activePeerId = selectedUserRef.current;
      if (activePeerId) {
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
    if (!currentUserId) return undefined;

    socketClient.connect(localStorage.getItem('token') || '', tenantId);
    const unsubscribeMessage = socketClient.on('message:new', (payload) => {
      const rawMessage = (payload?.message || {}) as LooseRecord;
      const nextMessage = toMessage(rawMessage);
      const isConversationParticipant =
        nextMessage.senderId === currentUserId || nextMessage.receiverId === currentUserId;
      if (!isConversationParticipant) return;

      const peerId =
        nextMessage.senderId === currentUserId ? nextMessage.receiverId : nextMessage.senderId;
      if (!peerId) return;

      ensureParticipant(peerId, 'User');
      setMessagesByUser((prev) => ({
        ...prev,
        [peerId]: addUniqueMessage(prev[peerId] || [], nextMessage),
      }));

      const isIncoming = nextMessage.receiverId === currentUserId;
      if (!isIncoming) return;

      if (selectedUserRef.current === peerId) {
        void markMessagesRead(peerId, [nextMessage._id]);
      } else {
        setUnreadByUser((prev) => ({
          ...prev,
          [peerId]: Number(prev[peerId] || 0) + 1,
        }));
      }
    });

    const unsubscribeUnread = socketClient.on('unread:update', (payload) => {
      const payloadUserId = toId(payload?.userId);
      if (payloadUserId && payloadUserId !== currentUserId) return;
      setTotalUnread(Number(payload?.messages || 0));
    });

    const unsubscribePresence = socketClient.on('presence:update', (payload) => {
      const targetUserId = toId(payload?.userId);
      if (!targetUserId || targetUserId === currentUserId) return;
      const status = String(payload?.status || '').toLowerCase() === 'online' ? 'online' : 'offline';
      const lastSeenRaw = normalizeText(payload?.lastSeen);
      setPresenceByUser((prev) => ({
        ...prev,
        [targetUserId]: {
          status,
          lastSeen: status === 'online' ? null : lastSeenRaw || prev[targetUserId]?.lastSeen || null,
        },
      }));
    });

    return () => {
      unsubscribeMessage();
      unsubscribeUnread();
      unsubscribePresence();
    };
  }, [currentUserId, ensureParticipant, markMessagesRead, tenantId]);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedUserId || !currentUserId) return;
    const response = await API.post('/messages/send', {
      receiverId: selectedUserId,
      content,
      type: 'general',
    });
    const sentMessage = toMessage((response?.data?.data || {}) as LooseRecord);
    setMessagesByUser((prev) => ({
      ...prev,
      [selectedUserId]: addUniqueMessage(prev[selectedUserId] || [], sentMessage),
    }));
    setHiddenUserIds((prev) => prev.filter((entry) => entry !== selectedUserId));
  }, [currentUserId, selectedUserId]);

  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!selectedUserId || !messageId) return;
    const response = await API.patch(`/messages/${messageId}`, { content });
    const updatedMessage = toMessage((response?.data?.data || {}) as LooseRecord);
    setMessagesByUser((prev) => ({
      ...prev,
      [selectedUserId]: addUniqueMessage(prev[selectedUserId] || [], updatedMessage),
    }));
  }, [selectedUserId]);

  const handleDeleteMessage = useCallback(async (messageId: string, scope: MessageDeleteScope = 'for_everyone') => {
    if (!selectedUserId || !messageId) return;
    const response = await API.delete(`/messages/${messageId}`, { data: { scope } });
    const deletedMessage = toMessage((response?.data?.data || {}) as LooseRecord);
    setMessagesByUser((prev) => ({
      ...prev,
      [selectedUserId]: addUniqueMessage(prev[selectedUserId] || [], deletedMessage),
    }));
    setReplyTo((previous) => (previous?._id === messageId ? null : previous));
  }, [selectedUserId]);

  const allConversationItems = useMemo(() => {
    const query = normalizeText(searchTerm).toLowerCase();
    const hasQuery = Boolean(query);
    const filteredParticipants = participants.filter((entry) => {
      const matchesQuery = !query || (
        normalizeText(entry.name).toLowerCase().includes(query) ||
        normalizeText(entry.email).toLowerCase().includes(query)
      );
      if (!matchesQuery) return false;
      const isHidden = hiddenUserIdSet.has(entry.userId);
      if (isHidden && !hasQuery) return false;
      return true;
    });

    const list: ConversationListItem[] = filteredParticipants.map((entry) => {
      const messages = messagesByUser[entry.userId] || [];
      const lastMessage = messages[messages.length - 1];
      return {
        userId: entry.userId,
        name: entry.name,
        avatarUrl: entry.avatarUrl,
        lastMessagePreview: lastMessage?.content
          ? formatPreview(lastMessage.content)
          : 'Tap to open conversation',
        lastMessageAt: lastMessage?.createdAt,
        unreadCount: Number(unreadByUser[entry.userId] || 0),
        presenceStatus: presenceByUser[entry.userId]?.status || 'offline',
        lastSeen: presenceByUser[entry.userId]?.lastSeen || null,
        isHidden: hiddenUserIdSet.has(entry.userId),
      };
    });

    return list.sort((left, right) => {
      if (Boolean(left.isHidden) !== Boolean(right.isHidden)) {
        return left.isHidden ? 1 : -1;
      }
      const leftDate = new Date(left.lastMessageAt || 0).getTime();
      const rightDate = new Date(right.lastMessageAt || 0).getTime();
      if (leftDate === rightDate) return left.name.localeCompare(right.name);
      return rightDate - leftDate;
    });
  }, [hiddenUserIdSet, messagesByUser, participants, presenceByUser, searchTerm, unreadByUser]);

  const filteredConversationItems = useMemo(() => {
    if (conversationFilter === 'all') return allConversationItems;
    return allConversationItems.filter((item) => Number(item.unreadCount || 0) > 0);
  }, [allConversationItems, conversationFilter]);

  const activeParticipant = participants.find((entry) => entry.userId === selectedUserId);
  const activeMessages = selectedUserId ? messagesByUser[selectedUserId] || [] : [];
  const activePresence = selectedUserId ? presenceByUser[selectedUserId] : undefined;
  const showListOnlyOnMobile = isMobile && !selectedUserId;
  const showThreadOnMobile = isMobile && Boolean(selectedUserId);

  if (!currentUserId) {
    return (
      <Paper
        elevation={0}
        sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', p: 2.2, minHeight: 260 }}
      >
        <Typography variant="body2" color="text.secondary">
          Please log in to open messaging.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.7 : 0.88),
        minHeight: { xs: 420, md: 560 },
        height: { xs: 'min(76vh, 720px)', md: 'min(78vh, 780px)' },
        overflow: 'hidden',
        display: 'flex',
        backgroundColor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.84 : 0.96),
      }}
    >
      {(!isMobile || showListOnlyOnMobile) && (
        <Box
          sx={{
            width: { xs: '100%', md: 360 },
            borderRight: { xs: 'none', md: '1px solid' },
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            backgroundColor: alpha(theme.palette.background.default, theme.palette.mode === 'dark' ? 0.44 : 0.58),
          }}
        >
          <Stack spacing={1.1} sx={{ p: 1.4, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  {title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {subtitle}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={totalUnread > 99 ? '99+' : totalUnread}
                color={totalUnread > 0 ? 'primary' : 'default'}
                variant={totalUnread > 0 ? 'filled' : 'outlined'}
              />
            </Stack>
            <TextField
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search users by name or email"
              size="small"
              fullWidth
            />
            <Stack direction="row" spacing={0.8}>
              <Chip
                size="small"
                label="All"
                clickable
                color={conversationFilter === 'all' ? 'primary' : 'default'}
                variant={conversationFilter === 'all' ? 'filled' : 'outlined'}
                onClick={() => setConversationFilter('all')}
              />
              <Chip
                size="small"
                label={`Unread (${allConversationItems.filter((item) => Number(item.unreadCount || 0) > 0).length})`}
                clickable
                color={conversationFilter === 'unread' ? 'primary' : 'default'}
                variant={conversationFilter === 'unread' ? 'filled' : 'outlined'}
                onClick={() => setConversationFilter('unread')}
              />
            </Stack>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ConversationList
              conversations={filteredConversationItems}
              selectedUserId={selectedUserId}
              loading={loadingParticipants}
              onSelectConversation={setSelectedUserId}
              onToggleHidden={handleToggleHiddenConversation}
            />
          </Box>
        </Box>
      )}

      {(!isMobile || showThreadOnMobile) && (
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ px: 1.3, py: 1.05, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            {isMobile ? (
              <IconButton size="small" onClick={() => setSelectedUserId('')} aria-label="Back to conversations">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14 6 8 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </IconButton>
            ) : null}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {activeParticipant?.name || 'Select a conversation'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {activeParticipant?.email || 'Customer support messaging'}
              </Typography>
            </Box>
          </Stack>

          {loadingConversation && activeMessages.length === 0 ? (
            <Stack sx={{ flex: 1, minHeight: 0 }} alignItems="center" justifyContent="center">
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <MessageThread
                messages={activeMessages}
                currentUserId={currentUserId}
                loading={loadingConversation}
                error={threadError}
                activeName={activeParticipant?.name || 'Conversation'}
                participantName={activeParticipant?.name || 'User'}
                presenceStatus={activePresence?.status || 'offline'}
                lastSeen={activePresence?.lastSeen || null}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                onReplyMessage={(message) => setReplyTo(message)}
              />
            </Box>
          )}

          <MessageInput
            disabled={!selectedUserId}
            placeholder={selectedUserId ? 'Type a message' : 'Select a user to start chatting'}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSend={handleSendMessage}
          />
        </Box>
      )}
    </Paper>
  );
};

export default AdminMessagingDashboard;
