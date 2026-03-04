const {
  createAiAssistantError,
  generateSuggestionForMessage,
  getAutoReplyMode,
  setAutoReplyMode,
  markSuggestionSent,
} = require('../services/aiAssistantService');
const { sendMessage } = require('../services/messageService');

const GET_AI_SUGGESTION_ERROR = 'Failed to generate AI suggestion';
const SEND_AI_SUGGESTION_ERROR = 'Failed to send AI reply';
const UPDATE_AUTO_REPLY_MODE_ERROR = 'Failed to update auto-reply mode';
const GET_AUTO_REPLY_MODE_ERROR = 'Failed to load auto-reply mode';

const toObjectIdString = (value) => String(value || '').trim();
const normalizeText = (value) => String(value || '').trim();

const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return null;
};

exports.getReplySuggestion = async (req, res) => {
  try {
    const messageId = req.params?.messageId || req.body?.messageId || req.query?.messageId;
    if (!messageId) {
      throw createAiAssistantError(422, 'messageId is required');
    }

    const regenerateInput =
      req.body?.regenerate !== undefined ? req.body.regenerate : req.query?.regenerate;
    const regenerate = toBoolean(regenerateInput);
    const suggestion = await generateSuggestionForMessage({
      messageId,
      tenantId: req.tenantId,
      forceRegenerate: regenerate === true,
    });

    return res.json({
      message: 'AI suggestion generated',
      data: suggestion,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? GET_AI_SUGGESTION_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.sendSuggestedReply = async (req, res) => {
  try {
    const messageId = req.params?.messageId || req.body?.messageId;
    if (!messageId) {
      throw createAiAssistantError(422, 'messageId is required');
    }

    const suggestion = await generateSuggestionForMessage({
      messageId,
      tenantId: req.tenantId,
      forceRegenerate: false,
    });

    const editedContent = normalizeText(req.body?.content);
    const finalContent = editedContent || suggestion.suggestion;
    if (!finalContent) {
      throw createAiAssistantError(422, 'Reply content is required');
    }

    const sentMessage = await sendMessage(
      req.user?._id,
      suggestion.userId,
      finalContent,
      'general',
      suggestion.bookingId || null,
      {
        tenantId: req.tenantId,
        skipAiAssistant: true,
      },
    );

    const updatedSuggestion = markSuggestionSent({
      messageId: suggestion.messageId,
      sentMessageId: sentMessage?._id,
      sentByAdminId: req.user?._id,
      autoReplySent: false,
      finalContent,
    });

    return res.status(201).json({
      message: 'AI reply sent successfully',
      data: {
        sentMessage,
        suggestion: updatedSuggestion || suggestion,
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? SEND_AI_SUGGESTION_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.getAutoReplyMode = async (req, res) => {
  try {
    const mode = getAutoReplyMode({
      tenantId: req.tenantId,
      adminId: toObjectIdString(req.user?._id),
    });
    return res.json({
      data: mode,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? GET_AUTO_REPLY_MODE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateAutoReplyMode = async (req, res) => {
  try {
    const enabled = toBoolean(req.body?.enabled);
    if (enabled === null) {
      throw createAiAssistantError(422, 'enabled must be true or false');
    }

    const mode = setAutoReplyMode({
      tenantId: req.tenantId,
      adminId: toObjectIdString(req.user?._id),
      enabled,
    });

    return res.json({
      message: `AI auto-reply ${enabled ? 'enabled' : 'disabled'}`,
      data: mode,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? UPDATE_AUTO_REPLY_MODE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};
