import React, { useEffect, useMemo, useRef } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';

export type MessageDeleteScope = 'for_me' | 'for_everyone';

export type ChatMessage = {
  _id: string;
  senderId: string;
  receiverId: string;
  content: string;
  createdAt?: string;
  isRead?: boolean;
  type?: string;
  editedAt?: string | null;
  isDeleted?: boolean;
  deletedAt?: string | null;
  isRemoved?: boolean;
};

type MessageThreadProps = {
  messages: ChatMessage[];
  currentUserId: string;
  activeName?: string;
  participantName?: string;
  presenceStatus?: 'online' | 'offline';
  lastSeen?: string | null;
  onEditMessage?: (messageId: string, content: string) => Promise<void> | void;
  onDeleteMessage?: (messageId: string, scope?: MessageDeleteScope) => Promise<void> | void;
  onReplyMessage?: (message: ChatMessage) => void;
  loading?: boolean;
  error?: string;
};

const toDateTimeLabel = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
};

const toPresenceLabel = (status: 'online' | 'offline', lastSeen?: string | null) => {
  if (status === 'online') return 'Online';
  if (!lastSeen) return 'Offline';
  const parsed = new Date(lastSeen);
  if (Number.isNaN(parsed.getTime())) return 'Offline';
  return `Last seen ${parsed.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const MessageThread: React.FC<MessageThreadProps> = ({
  messages,
  currentUserId,
  activeName = 'Conversation',
  participantName = '',
  presenceStatus = 'offline',
  lastSeen = null,
  onEditMessage,
  onDeleteMessage,
  onReplyMessage,
  loading = false,
  error = '',
}) => {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [menuState, setMenuState] = React.useState<{
    messageId: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleteTargetId, setDeleteTargetId] = React.useState('');
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [editMessageId, setEditMessageId] = React.useState('');
  const [editDraft, setEditDraft] = React.useState('');
  const [actionLoading, setActionLoading] = React.useState(false);

  const sortedMessages = useMemo(
    () =>
      [...messages].sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime();
        const rightTime = new Date(right.createdAt || 0).getTime();
        return leftTime - rightTime;
      }),
    [messages],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [sortedMessages.length]);

  const selectedMessage = useMemo(
    () => sortedMessages.find((message) => message._id === menuState?.messageId) || null,
    [menuState?.messageId, sortedMessages],
  );

  const deleteTargetMessage = useMemo(
    () => sortedMessages.find((message) => message._id === deleteTargetId) || null,
    [deleteTargetId, sortedMessages],
  );

  const closeActionMenu = () => {
    if (actionLoading) return;
    setMenuState(null);
  };

  const openActionMenu = (
    event: React.MouseEvent<HTMLElement>,
    message: ChatMessage,
    enabled: boolean,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!enabled) return;
    setMenuState({
      messageId: message._id,
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
    });
  };

  const closeDeleteDialog = () => {
    if (actionLoading) return;
    setDeleteDialogOpen(false);
    setDeleteTargetId('');
  };

  const closeEditDialog = () => {
    if (actionLoading) return;
    setEditDialogOpen(false);
    setEditMessageId('');
    setEditDraft('');
  };

  const openDeleteDialog = () => {
    if (!selectedMessage) {
      closeActionMenu();
      return;
    }
    setDeleteTargetId(selectedMessage._id);
    setDeleteDialogOpen(true);
    closeActionMenu();
  };

  const openEditDialog = () => {
    if (!selectedMessage || typeof onEditMessage !== 'function') {
      closeActionMenu();
      return;
    }
    setEditMessageId(selectedMessage._id);
    setEditDraft(String(selectedMessage.content || ''));
    setEditDialogOpen(true);
    closeActionMenu();
  };

  const performDelete = async (scope: MessageDeleteScope) => {
    if (!deleteTargetId || typeof onDeleteMessage !== 'function') return;
    try {
      setActionLoading(true);
      await onDeleteMessage(deleteTargetId, scope);
      closeDeleteDialog();
    } finally {
      setActionLoading(false);
    }
  };

  const copyMessageText = async () => {
    if (!selectedMessage) {
      closeActionMenu();
      return;
    }

    const messageText = String(selectedMessage.content || '').trim();
    if (!messageText) {
      closeActionMenu();
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(messageText);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = messageText;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    } catch {
      // Silent fallback.
    } finally {
      closeActionMenu();
    }
  };

  const replyToMessage = () => {
    if (!selectedMessage || typeof onReplyMessage !== 'function') {
      closeActionMenu();
      return;
    }
    onReplyMessage(selectedMessage);
    closeActionMenu();
  };

  const canCopySelectedMessage = Boolean(selectedMessage && String(selectedMessage.content || '').trim());
  const canEditSelectedMessage = Boolean(
    selectedMessage &&
      typeof onEditMessage === 'function' &&
      !selectedMessage.isDeleted &&
      !selectedMessage.isRemoved &&
      String(selectedMessage.senderId || '') === String(currentUserId || ''),
  );
  const canReplySelectedMessage = Boolean(
    selectedMessage &&
      typeof onReplyMessage === 'function' &&
      !selectedMessage.isDeleted &&
      !selectedMessage.isRemoved,
  );
  const canDeleteSelectedMessage = Boolean(
    selectedMessage &&
      String(selectedMessage.type || '').toLowerCase() !== 'system' &&
      typeof onDeleteMessage === 'function',
  );

  const submitEditMessage = async () => {
    if (!editMessageId || typeof onEditMessage !== 'function') return;
    const trimmed = String(editDraft || '').trim();
    if (!trimmed) return;
    try {
      setActionLoading(true);
      await onEditMessage(editMessageId, trimmed);
      closeEditDialog();
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 240 }}>
        <CircularProgress size={24} />
      </Stack>
    );
  }

  if (error) {
    return (
      <Box sx={{ flex: 1, p: 2 }}>
        <Typography variant="body2" color="error.main">
          {error}
        </Typography>
      </Box>
    );
  }

  if (sortedMessages.length === 0) {
    return (
      <Stack sx={{ flex: 1, p: 2.4 }} justifyContent="center" alignItems="center" spacing={1}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {activeName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No messages yet. Start the conversation.
        </Typography>
      </Stack>
    );
  }

  return (
    <Box
      ref={containerRef}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      sx={{
        flex: 1,
        minHeight: 0,
        px: 1.5,
        py: 1.4,
        overflowY: 'auto',
        background: alpha(theme.palette.background.default, theme.palette.mode === 'dark' ? 0.5 : 0.65),
      }}
    >
      {participantName ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.7}
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            px: 1.05,
            py: 0.65,
            mb: 0.7,
            borderRadius: 1.8,
            border: '1px solid',
            borderColor: alpha(theme.palette.divider, 0.7),
            backgroundColor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.88 : 0.96),
            backdropFilter: 'blur(3px)',
          }}
        >
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: 999,
              backgroundColor:
                presenceStatus === 'online'
                  ? theme.palette.success.main
                  : alpha(theme.palette.text.disabled, 0.92),
              boxShadow:
                presenceStatus === 'online'
                  ? `0 0 0 4px ${alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.26 : 0.14)}`
                  : 'none',
            }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {toPresenceLabel(presenceStatus, lastSeen)}
          </Typography>
        </Stack>
      ) : null}
      <Stack spacing={1}>
        {sortedMessages.map((message) => {
          const isOwn = String(message.senderId || '') === String(currentUserId || '');
          const canDeleteMessage =
            String(message.type || '').toLowerCase() !== 'system' &&
            typeof onDeleteMessage === 'function';
          const canReplyMessage = typeof onReplyMessage === 'function' && !message.isDeleted;
          const canCopyMessage = Boolean(String(message.content || '').trim());
          const canShowContextMenu = canDeleteMessage || canReplyMessage || canCopyMessage;

          return (
            <Stack
              key={message._id}
              alignItems={isOwn ? 'flex-end' : 'flex-start'}
              sx={{ width: '100%' }}
            >
              <Box
                onContextMenu={(event) => openActionMenu(event, message, canShowContextMenu)}
                sx={{
                  position: 'relative',
                  maxWidth: { xs: '90%', sm: '76%' },
                  px: 1.3,
                  py: 0.95,
                  borderRadius: 2.3,
                  borderTopRightRadius: isOwn ? 0.65 : 2.3,
                  borderTopLeftRadius: isOwn ? 2.3 : 0.65,
                  cursor: canShowContextMenu ? 'context-menu' : 'default',
                  backgroundColor: isOwn
                    ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.46 : 0.18)
                    : alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.92 : 0.96),
                  border: `1px solid ${alpha(
                    isOwn ? theme.palette.primary.main : theme.palette.divider,
                    theme.palette.mode === 'dark' ? 0.48 : 0.62,
                  )}`,
                  boxShadow: `0 8px 20px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.24 : 0.08)}`,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontStyle: message.isDeleted ? 'italic' : 'normal',
                    color: message.isDeleted ? 'text.secondary' : 'text.primary',
                  }}
                >
                  {message.content}
                </Typography>
                <Stack direction="row" spacing={0.65} justifyContent="flex-end" alignItems="center" sx={{ mt: 0.55 }}>
                  {message.editedAt && !message.isDeleted ? (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      edited
                    </Typography>
                  ) : null}
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {toDateTimeLabel(message.createdAt)}
                  </Typography>
                  {isOwn ? (
                    <Chip
                      size="small"
                      label={message.isRead ? 'Read' : 'Sent'}
                      sx={{
                        height: 18,
                        fontSize: 10,
                        borderRadius: 999,
                        backgroundColor: alpha(
                          message.isRead ? theme.palette.success.main : theme.palette.info.main,
                          0.22,
                        ),
                        color: message.isRead ? 'success.dark' : 'info.dark',
                      }}
                    />
                  ) : null}
                </Stack>
              </Box>
            </Stack>
          );
        })}
      </Stack>

      <Menu
        open={Boolean(menuState)}
        onClose={closeActionMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          menuState
            ? { top: menuState.mouseY, left: menuState.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={replyToMessage} disabled={!canReplySelectedMessage || actionLoading}>
          Reply
        </MenuItem>
        <MenuItem onClick={openEditDialog} disabled={!canEditSelectedMessage || actionLoading}>
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            void copyMessageText();
          }}
          disabled={!canCopySelectedMessage || actionLoading}
        >
          Copy
        </MenuItem>
        <MenuItem onClick={openDeleteDialog} disabled={!canDeleteSelectedMessage || actionLoading} sx={{ color: 'error.main' }}>
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={editDialogOpen} onClose={closeEditDialog} fullWidth maxWidth="xs">
        <DialogTitle>Edit Message</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            fullWidth
            multiline
            maxRows={6}
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            placeholder="Update your message"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditDialog} disabled={actionLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void submitEditMessage();
            }}
            disabled={actionLoading || String(editDraft || '').trim().length === 0}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={closeDeleteDialog} fullWidth maxWidth="xs">
        <DialogTitle>Delete Message</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Choose how you want to delete this message.
          </Typography>
          {deleteTargetMessage ? (
            <Box
              sx={{
                mt: 1.2,
                p: 1.1,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: alpha(theme.palette.background.default, 0.55),
              }}
            >
              <Typography
                variant="body2"
                sx={{ color: deleteTargetMessage.isDeleted ? 'text.secondary' : 'text.primary', fontStyle: deleteTargetMessage.isDeleted ? 'italic' : 'normal' }}
              >
                {deleteTargetMessage.content}
              </Typography>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog} disabled={actionLoading}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void performDelete('for_me');
            }}
            disabled={actionLoading}
          >
            Delete for me
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              void performDelete('for_everyone');
            }}
            disabled={actionLoading}
          >
            Delete for everyone
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MessageThread;
