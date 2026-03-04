import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import API, { getErrorMessage } from '../../api';
import { getUser, isAdmin } from '../../utils/auth';
import useNotify from '../../hooks/useNotify';
import socketClient from '../../services/socketClient';
import ConversationList, { ConversationListItem } from './ConversationList';
import MessageThread, { ChatMessage, MessageDeleteScope } from './MessageThread';
import MessageInput from './MessageInput';

export type ChatParticipant = {
  userId: string;
  name: string;
  avatarUrl?: string;
  email?: string;
};

type ChatLayoutProps = {
  participants?: ChatParticipant[];
  defaultSelectedUserId?: string;
  title?: string;
  subtitle?: string;
  onUnreadChange?: (count: number) => void;
};

type ConversationApiMessage = {
  _id?: string;
  senderId?: string;
  receiverId?: string;
  content?: string;
  createdAt?: string;
  isRead?: boolean;
  type?: string;
  editedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  isRemoved?: boolean;
};

const MAX_PREVIEW_LENGTH = 72;

const normalizeString = (value: unknown) => String(value || '').trim();

const formatPreview = (value: string) => {
  const normalized = normalizeString(value);
  if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3)}...`;
};

const toParticipant = (input: Record<string, unknown>): ChatParticipant => {
  const userId = normalizeString(input.userId || input._id || input.id);
  const firstName = normalizeString(input.firstName);
  const lastName = normalizeString(input.lastName);
  const compositeName = normalizeString(`${firstName} ${lastName}`);
  return {
    userId,
    name: compositeName || normalizeString(input.name) || normalizeString(input.email) || `User ${userId.slice(0, 6)}`,
    avatarUrl: normalizeString(input.avatarUrl || input.image),
    email: normalizeString(input.email),
  };
};

const toMessage = (input: ConversationApiMessage): ChatMessage => {
  const senderId = normalizeString(input.senderId);
  const receiverId = normalizeString(input.receiverId);
  const fallbackId = `${senderId}-${receiverId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    _id: normalizeString(input._id) || fallbackId,
    senderId,
    receiverId,
    content: normalizeString(input.content),
    createdAt: normalizeString(input.createdAt) || new Date().toISOString(),
    isRead: Boolean(input.isRead),
    type: normalizeString(input.type) || 'general',
    editedAt: normalizeString(input.editedAt) || null,
    isDeleted: Boolean(input.isDeleted),
    deletedAt: normalizeString(input.deletedAt) || null,
    isRemoved: Boolean(input.isRemoved),
  };
};

const addMessageUnique = (messages: ChatMessage[], nextMessage: ChatMessage) => {
  if (!nextMessage?._id) return messages;
  if (nextMessage.isRemoved) {
    return messages
      .filter((message) => message._id !== nextMessage._id)
      .sort(
        (left, right) =>
          new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime(),
      );
  }
  const existingIndex = messages.findIndex((message) => message._id === nextMessage._id);
  if (existingIndex >= 0) {
    const next = [...messages];
    next[existingIndex] = { ...next[existingIndex], ...nextMessage };
    return next.sort(
      (left, right) => new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime(),
    );
  }
  return [...messages, nextMessage].sort(
    (left, right) => new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime(),
  );
};

const ChatLayout: React.FC<ChatLayoutProps> = ({
  participants = [],
  defaultSelectedUserId = '',
  title = 'Messages',
  subtitle = 'Realtime chat',
  onUnreadChange,
}) => {
  const notify = useNotify();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const currentUser = getUser();
  const currentUserId = normalizeString(currentUser?._id);
  const tenantId = normalizeString(currentUser?.tenantId);
  const canLoadTenantUsers = isAdmin();

  const [participantList, setParticipantList] = useState<ChatParticipant[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [search, setSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>({});
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>({});
  const [totalUnreadMessages, setTotalUnreadMessages] = useState(0);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const selectedUserRef = useRef(selectedUserId);
  useEffect(() => {
    selectedUserRef.current = selectedUserId;
  }, [selectedUserId]);

  const ensureParticipant = useCallback((userId: string, nameHint = 'Support Team') => {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId || normalizedUserId === currentUserId) return;

    setParticipantList((prev) => {
      if (prev.some((entry) => entry.userId === normalizedUserId)) return prev;
      return [
        ...prev,
        {
          userId: normalizedUserId,
          name: nameHint,
        },
      ];
    });
  }, [currentUserId]);

  const markMessageIdsAsRead = useCallback(
    async (peerUserId: string, messageIds: string[]) => {
      if (!peerUserId || messageIds.length === 0) return;

      await Promise.all(
        messageIds.map((messageId) =>
          API.patch(`/messages/read/${messageId}`, {}, { showErrorToast: false }).catch(() => null),
        ),
      );

      setMessagesByConversation((prev) => {
        const currentMessages = prev[peerUserId] || [];
        const readSet = new Set(messageIds);
        return {
          ...prev,
          [peerUserId]: currentMessages.map((message) =>
            readSet.has(message._id) ? { ...message, isRead: true } : message,
          ),
        };
      });
      setUnreadByConversation((prev) => ({ ...prev, [peerUserId]: 0 }));
    },
    [],
  );

  const loadConversation = useCallback(
    async (peerUserId: string, options: { silent?: boolean } = {}) => {
      const normalizedPeer = normalizeString(peerUserId);
      if (!normalizedPeer) return;
      if (!options.silent) {
        setLoadingThread(true);
        setThreadError('');
      }

      try {
        const response = await API.get(`/messages/conversation/${normalizedPeer}`, { showErrorToast: false });
        const conversationRaw = Array.isArray(response?.data?.conversation) ? response.data.conversation : [];
        const mapped = conversationRaw.map((entry: ConversationApiMessage) => toMessage(entry));
        setMessagesByConversation((prev) => ({ ...prev, [normalizedPeer]: mapped }));
        setReplyTo((previous) => {
          if (!previous) return null;
          return mapped.some((entry) => entry._id === previous._id) ? previous : null;
        });

        const unreadIds = mapped
          .filter((message) => message.receiverId === currentUserId && !message.isRead)
          .map((message) => message._id);
        if (unreadIds.length > 0) {
          await markMessageIdsAsRead(normalizedPeer, unreadIds);
        } else {
          setUnreadByConversation((prev) => ({ ...prev, [normalizedPeer]: 0 }));
        }
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to load conversation');
        setThreadError(message);
      } finally {
        if (!options.silent) {
          setLoadingThread(false);
        }
      }
    },
    [currentUserId, markMessageIdsAsRead],
  );

  const syncUnreadCount = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const response = await API.get('/messages/unread-count', { showErrorToast: false });
      const unreadCount = Number(response?.data?.unreadCount || 0);
      setTotalUnreadMessages(unreadCount);
      if (typeof onUnreadChange === 'function') onUnreadChange(unreadCount);
    } catch {
      // keep silent for background sync
    }
  }, [currentUserId, onUnreadChange]);

  const refreshContacts = useCallback(async () => {
    if (!currentUserId) return;

    if (participants.length > 0) {
      const normalized = participants
        .map((entry) => toParticipant(entry as unknown as Record<string, unknown>))
        .filter((entry) => entry.userId && entry.userId !== currentUserId);
      setParticipantList(normalized);
      return;
    }

    if (canLoadTenantUsers) {
      setLoadingContacts(true);
      try {
        const response = await API.get('/admin/users', { showErrorToast: false });
        const users = Array.isArray(response?.data) ? response.data : [];
        const normalized = users
          .map((entry: Record<string, unknown>) => toParticipant(entry))
          .filter((entry) => entry.userId && entry.userId !== currentUserId);
        setParticipantList(normalized);
      } catch (error) {
        try {
          const bookingResponse = await API.get('/admin/bookings', { showErrorToast: false });
          const bookings = Array.isArray(bookingResponse?.data) ? bookingResponse.data : [];
          const usersFromBookings = bookings
            .map((booking: Record<string, unknown>) => booking.user as Record<string, unknown>)
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => toParticipant(entry))
            .filter((entry) => entry.userId && entry.userId !== currentUserId);

          const uniqueById = new Map<string, ChatParticipant>();
          usersFromBookings.forEach((entry) => {
            if (!uniqueById.has(entry.userId)) {
              uniqueById.set(entry.userId, entry);
            }
          });
          setParticipantList([...uniqueById.values()]);
        } catch {
          notify.error(getErrorMessage(error, 'Failed to load contacts'));
          setParticipantList([]);
        }
      } finally {
        setLoadingContacts(false);
      }
      return;
    }

    const supportUserId = normalizeString(import.meta.env.VITE_SUPPORT_USER_ID);
    if (supportUserId && supportUserId !== currentUserId) {
      setParticipantList([
        {
          userId: supportUserId,
          name: normalizeString(import.meta.env.VITE_SUPPORT_NAME) || 'Support Team',
        },
      ]);
    } else {
      setParticipantList([]);
    }
  }, [canLoadTenantUsers, currentUserId, notify, participants]);

  useEffect(() => {
    void refreshContacts();
  }, [refreshContacts]);

  useEffect(() => {
    if (!currentUserId) return;
    void syncUnreadCount();
  }, [currentUserId, syncUnreadCount]);

  useEffect(() => {
    if (participantList.length === 0) {
      setSelectedUserId('');
      return;
    }

    const preferred = normalizeString(defaultSelectedUserId);
    const selectedIsAvailable = participantList.some((entry) => entry.userId === selectedUserId);
    if (selectedIsAvailable) return;

    if (preferred && participantList.some((entry) => entry.userId === preferred)) {
      setSelectedUserId(preferred);
      return;
    }

    // Do not auto-open first conversation; user/admin should pick from list explicitly.
    if (!selectedUserId) return;
    setSelectedUserId('');
  }, [defaultSelectedUserId, participantList, selectedUserId]);

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
      const nextMessage = toMessage((payload?.message || {}) as ConversationApiMessage);
      const isCurrentUserParticipant =
        nextMessage.senderId === currentUserId || nextMessage.receiverId === currentUserId;
      if (!isCurrentUserParticipant) return;

      const peerUserId =
        nextMessage.senderId === currentUserId ? nextMessage.receiverId : nextMessage.senderId;
      if (!peerUserId) return;

      ensureParticipant(peerUserId);

      setMessagesByConversation((prev) => {
        const existing = prev[peerUserId] || [];
        return {
          ...prev,
          [peerUserId]: addMessageUnique(existing, nextMessage),
        };
      });

      const selectedPeer = selectedUserRef.current;
      const isIncoming = nextMessage.receiverId === currentUserId;
      if (!isIncoming) return;

      if (selectedPeer === peerUserId) {
        void markMessageIdsAsRead(peerUserId, [nextMessage._id]);
      } else {
        setUnreadByConversation((prev) => ({
          ...prev,
          [peerUserId]: Number(prev[peerUserId] || 0) + 1,
        }));
      }
    });

    const unsubscribeUnread = socketClient.on('unread:update', (payload) => {
      const payloadUserId = normalizeString(payload?.userId);
      if (payloadUserId && payloadUserId !== currentUserId) return;
      const unreadCount = Number(payload?.messages || 0);
      setTotalUnreadMessages(unreadCount);
      if (typeof onUnreadChange === 'function') onUnreadChange(unreadCount);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeUnread();
    };
  }, [currentUserId, ensureParticipant, markMessageIdsAsRead, onUnreadChange, tenantId]);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!selectedUserId || !currentUserId) return;
      const payload = {
        receiverId: selectedUserId,
        content,
        type: 'general',
      };

      const response = await API.post('/messages/send', payload);
      const sentMessage = toMessage((response?.data?.data || {}) as ConversationApiMessage);

      setMessagesByConversation((prev) => {
        const existing = prev[selectedUserId] || [];
        return {
          ...prev,
          [selectedUserId]: addMessageUnique(existing, sentMessage),
        };
      });
      setReplyTo(null);
    },
    [currentUserId, selectedUserId],
  );

  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!selectedUserId || !messageId) return;
    const response = await API.patch(`/messages/${messageId}`, { content });
    const updatedMessage = toMessage((response?.data?.data || {}) as ConversationApiMessage);
    setMessagesByConversation((prev) => ({
      ...prev,
      [selectedUserId]: addMessageUnique(prev[selectedUserId] || [], updatedMessage),
    }));
  }, [selectedUserId]);

  const handleDeleteMessage = useCallback(async (messageId: string, scope: MessageDeleteScope = 'for_everyone') => {
    if (!selectedUserId || !messageId) return;
    const response = await API.delete(`/messages/${messageId}`, { data: { scope } });
    const deletedMessage = toMessage((response?.data?.data || {}) as ConversationApiMessage);
    setMessagesByConversation((prev) => ({
      ...prev,
      [selectedUserId]: addMessageUnique(prev[selectedUserId] || [], deletedMessage),
    }));
    setReplyTo((previous) => (previous?._id === messageId ? null : previous));
  }, [selectedUserId]);

  const activeMessages = selectedUserId ? messagesByConversation[selectedUserId] || [] : [];

  const filteredParticipants = useMemo(() => {
    const query = normalizeString(search).toLowerCase();
    const list = participantList.filter((participant) => {
      if (!query) return true;
      const name = normalizeString(participant.name).toLowerCase();
      const email = normalizeString(participant.email).toLowerCase();
      return name.includes(query) || email.includes(query);
    });

    const conversationItems: ConversationListItem[] = list.map((participant) => {
      const conversationMessages = messagesByConversation[participant.userId] || [];
      const lastMessage = conversationMessages[conversationMessages.length - 1];
      return {
        userId: participant.userId,
        name: participant.name,
        avatarUrl: participant.avatarUrl,
        lastMessagePreview: lastMessage?.content ? formatPreview(lastMessage.content) : '',
        lastMessageAt: lastMessage?.createdAt,
        unreadCount: Number(unreadByConversation[participant.userId] || 0),
      };
    });

    return conversationItems.sort((left, right) => {
      const leftAt = new Date(left.lastMessageAt || 0).getTime();
      const rightAt = new Date(right.lastMessageAt || 0).getTime();
      return rightAt - leftAt;
    });
  }, [messagesByConversation, participantList, search, unreadByConversation]);

  const activeParticipant = participantList.find((participant) => participant.userId === selectedUserId);
  const showListOnlyOnMobile = isMobile && !selectedUserId;
  const showThreadOnMobile = isMobile && Boolean(selectedUserId);

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
        display: 'flex',
        minHeight: { xs: 420, md: 560 },
        height: { xs: 'min(74vh, 720px)', md: 'min(76vh, 760px)' },
      }}
    >
      {(!isMobile || showListOnlyOnMobile) && (
        <Box
          sx={{
            width: { xs: '100%', md: 320 },
            borderRight: { xs: 'none', md: '1px solid' },
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'background.paper',
          }}
        >
          <Stack spacing={1} sx={{ p: 1.4, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  {title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {subtitle}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={`${totalUnreadMessages} unread`}
                color={totalUnreadMessages > 0 ? 'primary' : 'default'}
                variant={totalUnreadMessages > 0 ? 'filled' : 'outlined'}
              />
            </Stack>
            <TextField
              fullWidth
              size="small"
              placeholder="Search conversations"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ConversationList
              conversations={filteredParticipants}
              selectedUserId={selectedUserId}
              loading={loadingContacts}
              onSelectConversation={setSelectedUserId}
            />
          </Box>
        </Box>
      )}

      {(!isMobile || showThreadOnMobile) && (
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ px: 1.35, py: 1.1, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            {isMobile ? (
              <IconButton size="small" onClick={() => setSelectedUserId('')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14 6 8 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </IconButton>
            ) : null}
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {activeParticipant?.name || 'Select a conversation'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {activeParticipant?.email || 'Realtime messaging'}
              </Typography>
            </Stack>
          </Stack>
          <Divider />
          <MessageThread
            messages={activeMessages}
            currentUserId={currentUserId}
            activeName={activeParticipant?.name || 'Conversation'}
            loading={loadingThread}
            error={threadError}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onReplyMessage={(message) => setReplyTo(message)}
          />
          <MessageInput
            disabled={!selectedUserId}
            placeholder={selectedUserId ? 'Write your message...' : 'Select a conversation first'}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSend={handleSendMessage}
          />
        </Box>
      )}
    </Paper>
  );
};

export default ChatLayout;
