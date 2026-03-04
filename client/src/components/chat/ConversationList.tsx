import React from 'react';
import {
  Avatar,
  Badge,
  Box,
  List,
  ListItemButton,
  ListItemText,
  Skeleton,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';

export type ConversationListItem = {
  userId: string;
  name: string;
  avatarUrl?: string;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  presenceStatus?: 'online' | 'offline';
  lastSeen?: string | null;
};

type ConversationListProps = {
  conversations: ConversationListItem[];
  selectedUserId: string;
  loading?: boolean;
  onSelectConversation: (userId: string) => void;
};

const toDateTimeLabel = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const toLastSeenLabel = (value?: string | null) => {
  if (!value) return 'Offline';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Offline';
  return `Last seen ${parsed.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  selectedUserId,
  loading = false,
  onSelectConversation,
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  if (loading) {
    return (
      <Stack spacing={1.25} sx={{ px: 1.2, py: 1 }}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Stack
            key={`conversation-skeleton-${index}`}
            direction="row"
            spacing={1.2}
            alignItems="center"
            sx={{
              px: 1.2,
              py: 1,
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
            }}
          >
            <Skeleton variant="circular" width={36} height={36} />
            <Stack spacing={0.45} sx={{ flex: 1 }}>
              <Skeleton variant="rounded" width="52%" height={13} />
              <Skeleton variant="rounded" width="84%" height={12} />
            </Stack>
          </Stack>
        ))}
      </Stack>
    );
  }

  if (conversations.length === 0) {
    return (
      <Box sx={{ px: 2, py: 3, color: 'text.secondary' }}>
        <Typography variant="body2">No conversations yet.</Typography>
      </Box>
    );
  }

  return (
    <List
      disablePadding
      sx={{
        px: 1.1,
        py: 1,
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      {conversations.map((conversation) => {
        const isSelected = selectedUserId === conversation.userId;
        const unreadCount = Math.max(Number(conversation.unreadCount || 0), 0);
        const isOnline = String(conversation.presenceStatus || '').toLowerCase() === 'online';
        return (
          <ListItemButton
            key={conversation.userId}
            onClick={() => onSelectConversation(conversation.userId)}
            selected={isSelected}
            sx={{
              borderRadius: 2,
              mb: 0.75,
              px: 1.1,
              py: 1,
              border: `1px solid ${
                isSelected
                  ? alpha(theme.palette.primary.main, isDark ? 0.56 : 0.34)
                  : alpha(theme.palette.divider, isDark ? 0.6 : 0.72)
              }`,
              backgroundColor: isSelected
                ? alpha(theme.palette.primary.main, isDark ? 0.24 : 0.12)
                : alpha(theme.palette.background.paper, isDark ? 0.86 : 0.94),
              boxShadow: isSelected
                ? `0 10px 20px ${alpha(theme.palette.primary.main, isDark ? 0.28 : 0.14)}`
                : 'none',
              '&:hover': {
                backgroundColor: isSelected
                  ? alpha(theme.palette.primary.main, isDark ? 0.28 : 0.16)
                  : alpha(theme.palette.action.hover, isDark ? 0.22 : 0.1),
              },
            }}
          >
            <Badge
              color="error"
              badgeContent={unreadCount > 99 ? '99+' : unreadCount}
              invisible={unreadCount <= 0}
              sx={{ mr: 1.2 }}
            >
              <Avatar src={conversation.avatarUrl || ''} sx={{ width: 36, height: 36 }}>
                {String(conversation.name || '?').trim().charAt(0).toUpperCase()}
              </Avatar>
            </Badge>
            <ListItemText
              primaryTypographyProps={{ component: 'div' }}
              secondaryTypographyProps={{ component: 'div' }}
              primary={
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        backgroundColor: isOnline ? 'success.main' : alpha(theme.palette.text.disabled, 0.9),
                        boxShadow: isOnline
                          ? `0 0 0 4px ${alpha(theme.palette.success.main, isDark ? 0.24 : 0.14)}`
                          : 'none',
                      }}
                    />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                      {conversation.name || 'Unknown'}
                    </Typography>
                  </Stack>
                  {conversation.lastMessageAt ? (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {toDateTimeLabel(conversation.lastMessageAt)}
                    </Typography>
                  ) : null}
                </Stack>
              }
              secondary={
                <Stack spacing={0.25} sx={{ mt: 0.2 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'text.secondary',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                    }}
                  >
                    {conversation.lastMessagePreview || 'Start a conversation'}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: isOnline ? 'success.dark' : 'text.secondary',
                    }}
                  >
                    {isOnline ? 'Online' : toLastSeenLabel(conversation.lastSeen)}
                  </Typography>
                </Stack>
              }
            />
          </ListItemButton>
        );
      })}
    </List>
  );
};

export default ConversationList;
