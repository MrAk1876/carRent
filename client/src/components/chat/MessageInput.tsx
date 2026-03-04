import React, { useMemo, useState } from 'react';
import { Box, IconButton, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import TextField from '@mui/material/TextField';
import type { ChatMessage } from './MessageThread';

type MessageInputProps = {
  disabled?: boolean;
  placeholder?: string;
  replyTo?: ChatMessage | null;
  onClearReply?: () => void;
  onSend: (message: string) => Promise<void> | void;
};

const MAX_REPLY_PREVIEW = 80;

const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const MessageInput: React.FC<MessageInputProps> = ({
  disabled = false,
  placeholder = 'Type a message...',
  replyTo = null,
  onClearReply,
  onSend,
}) => {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const replyPreview = useMemo(() => {
    if (!replyTo) return '';
    const normalized = collapseWhitespace(String(replyTo.content || ''));
    if (!normalized) return '';
    if (normalized.length <= MAX_REPLY_PREVIEW) return normalized;
    return `${normalized.slice(0, MAX_REPLY_PREVIEW - 3)}...`;
  }, [replyTo]);

  const submitMessage = async () => {
    if (sending || disabled) return;
    const nextValue = String(value || '').trim();
    if (!nextValue) return;

    let outgoingMessage = nextValue;
    if (replyTo && replyPreview) {
      outgoingMessage = `Replying to: "${replyPreview}"\n${nextValue}`;
    }

    try {
      setSending(true);
      await onSend(outgoingMessage);
      setValue('');
      if (typeof onClearReply === 'function') {
        onClearReply();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Box
      sx={{
        p: 1.2,
        pb: 'max(10px, env(safe-area-inset-bottom, 0px))',
        borderTop: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      {replyTo ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{
            mb: 1,
            px: 1,
            py: 0.7,
            borderRadius: 1.8,
            border: '1px solid',
            borderColor: alpha(theme.palette.primary.main, 0.28),
            backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.08),
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
              Reply
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {replyPreview || 'Selected message'}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={onClearReply}
            disabled={disabled || sending}
            aria-label="Cancel reply"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </IconButton>
        </Stack>
      ) : null}

      <Stack direction="row" alignItems="flex-end" spacing={1}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          value={value}
          disabled={disabled || sending}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submitMessage();
            }
          }}
          placeholder={placeholder}
        />
        <Tooltip title="Send">
          <span>
            <IconButton
              color="primary"
              onClick={() => {
                void submitMessage();
              }}
              disabled={disabled || sending || String(value || '').trim().length === 0}
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'background.default',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4.3 5.1 20.6 11.7c.7.3.7 1.3 0 1.6L4.3 19.9c-.7.3-1.4-.3-1.2-1l2.1-6.4c.1-.3.1-.7 0-1L3.1 6.1c-.2-.7.5-1.3 1.2-1z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path d="M5.6 12h7.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
};

export default MessageInput;
