const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Message = require('../models/Message');
const User = require('../models/User');
const { createNotification } = require('./notificationService');
const { ROLE, normalizeRole } = require('../utils/rbac');

const AI_INTENT = Object.freeze({
  BOOKING_STATUS: 'booking_status',
  PICKUP_LOCATION: 'pickup_location',
  CANCELLATION: 'cancellation',
  PAYMENT: 'payment',
  GENERAL_INQUIRY: 'general_inquiry',
});

const MAX_SUGGESTION_CACHE = 2000;
const MAX_USER_MESSAGE_LENGTH = 1600;
const OPENAI_RESPONSE_TIMEOUT_MS = 9000;
const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

const suggestionStore = new Map();
const messageSuggestionIndex = new Map();
const autoReplyModeStore = new Map();

const normalizeText = (value) => String(value || '').trim();
const toObjectIdString = (value) => normalizeText(value);
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(toObjectIdString(value));

const createAiAssistantError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const isUserRole = (roleValue) => normalizeRole(roleValue, ROLE.USER) === ROLE.USER;
const isAdminRole = (roleValue) => normalizeRole(roleValue, ROLE.USER) !== ROLE.USER;

const toIsoDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
};

const toReadableDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const toCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'N/A';
  return `INR ${amount.toFixed(0)}`;
};

const buildAutoReplyModeKey = (tenantId, adminId) =>
  `${toObjectIdString(tenantId)}::${toObjectIdString(adminId)}`;

const generateSuggestionId = () =>
  `aisg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const pruneSuggestionStore = () => {
  if (suggestionStore.size <= MAX_SUGGESTION_CACHE) return;
  const sorted = [...suggestionStore.values()].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const removeCount = suggestionStore.size - MAX_SUGGESTION_CACHE;
  sorted.slice(0, removeCount).forEach((entry) => {
    suggestionStore.delete(entry.suggestionId);
    if (entry.messageId && messageSuggestionIndex.get(entry.messageId) === entry.suggestionId) {
      messageSuggestionIndex.delete(entry.messageId);
    }
  });
};

const detectIntent = (userMessage = '') => {
  const normalized = normalizeText(userMessage).toLowerCase();
  if (!normalized) {
    return { intent: AI_INTENT.GENERAL_INQUIRY, confidence: 0.35 };
  }

  if (/\b(cancel|cancellation|reschedule|re-schedule|abort)\b/.test(normalized)) {
    return { intent: AI_INTENT.CANCELLATION, confidence: 0.9 };
  }

  if (/\b(payment|paid|pay|advance|balance|invoice|refund|upi|card)\b/.test(normalized)) {
    return { intent: AI_INTENT.PAYMENT, confidence: 0.88 };
  }

  if (/\b(pickup|pick up|where.*(pick|collect)|location|branch)\b/.test(normalized)) {
    return { intent: AI_INTENT.PICKUP_LOCATION, confidence: 0.86 };
  }

  if (/\b(status|confirmed|confirmation|booked|booking|when|schedule|time)\b/.test(normalized)) {
    return { intent: AI_INTENT.BOOKING_STATUS, confidence: 0.8 };
  }

  return { intent: AI_INTENT.GENERAL_INQUIRY, confidence: 0.45 };
};

const extractOpenAIText = (payload = {}) => {
  if (normalizeText(payload.output_text)) return normalizeText(payload.output_text);
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (normalizeText(part?.text)) return normalizeText(part.text);
      if (normalizeText(part?.output_text)) return normalizeText(part.output_text);
    }
  }
  return '';
};

const buildFallbackReply = (intent, bookingContext) => {
  const bookingId = normalizeText(bookingContext?.bookingId) || 'your booking';
  const carName = normalizeText(bookingContext?.carName) || 'your car';
  const pickupLocation = normalizeText(bookingContext?.pickupLocation) || 'the assigned pickup point';
  const bookingStatus = normalizeText(bookingContext?.bookingStatus) || 'currently under review';
  const pickupTime = normalizeText(bookingContext?.pickupDateTime)
    ? toReadableDate(bookingContext.pickupDateTime)
    : 'the scheduled slot shared in your booking';
  const totalAmount = toCurrency(bookingContext?.totalAmount);
  const remainingAmount = toCurrency(bookingContext?.remainingAmount);

  switch (intent) {
    case AI_INTENT.BOOKING_STATUS:
      return `Thanks for checking in. Booking ${bookingId} for ${carName} is currently ${bookingStatus}. Your pickup is planned for ${pickupTime}.`;
    case AI_INTENT.PICKUP_LOCATION:
      return `Thanks for your message. For booking ${bookingId}, pickup location is ${pickupLocation}. Please reach 10-15 minutes before your scheduled time.`;
    case AI_INTENT.CANCELLATION:
      return `I understand your cancellation request. Please confirm booking ${bookingId}; our team will apply the tenant cancellation policy and share the final update shortly.`;
    case AI_INTENT.PAYMENT:
      return `Regarding booking ${bookingId}, total payable is ${totalAmount} and current remaining amount is ${remainingAmount}. If you want, we can share supported payment options right away.`;
    default:
      return `Thanks for reaching out. I have noted your query for booking ${bookingId} and our team will assist you with the next steps shortly.`;
  }
};

const callOpenAIReply = async ({ userMessage, bookingContext, detectedIntent }) => {
  const apiKey = normalizeText(process.env.OPENAI_API_KEY);
  if (!apiKey || typeof fetch !== 'function') {
    return '';
  }

  const apiUrl = normalizeText(process.env.OPENAI_BASE_URL) || 'https://api.openai.com/v1/responses';
  const model = normalizeText(process.env.OPENAI_MODEL) || OPENAI_DEFAULT_MODEL;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), OPENAI_RESPONSE_TIMEOUT_MS);

  const promptPayload = {
    userMessage: normalizeText(userMessage).slice(0, MAX_USER_MESSAGE_LENGTH),
    intent: detectedIntent,
    bookingContext: {
      bookingId: normalizeText(bookingContext?.bookingId),
      bookingStatus: normalizeText(bookingContext?.bookingStatus),
      fromDate: toIsoDate(bookingContext?.fromDate),
      toDate: toIsoDate(bookingContext?.toDate),
      pickupDateTime: toIsoDate(bookingContext?.pickupDateTime),
      pickupLocation: normalizeText(bookingContext?.pickupLocation),
      carName: normalizeText(bookingContext?.carName),
      totalAmount: Number(bookingContext?.totalAmount || 0),
      remainingAmount: Number(bookingContext?.remainingAmount || 0),
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_output_tokens: 220,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  'You draft concise admin replies for a car rental platform. Keep it polite, clear, factual, and <= 3 sentences. Do not invent unavailable details.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Create a reply draft for this support message context:\n${JSON.stringify(promptPayload)}`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const payload = await response.json();
    return extractOpenAIText(payload);
  } catch (error) {
    console.error('ai reply generation failed:', error?.message || error);
    return '';
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const resolveBookingContext = async ({ tenantId, bookingId, userId }) => {
  const normalizedTenantId = toObjectIdString(tenantId);
  const normalizedBookingId = toObjectIdString(bookingId);
  const normalizedUserId = toObjectIdString(userId);

  if (!isValidObjectId(normalizedTenantId) || !isValidObjectId(normalizedUserId)) {
    return null;
  }

  const baseQuery = {
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
    user: new mongoose.Types.ObjectId(normalizedUserId),
  };
  const query = { ...baseQuery };
  if (isValidObjectId(normalizedBookingId)) {
    query._id = new mongoose.Types.ObjectId(normalizedBookingId);
  }

  let booking = await Booking.findOne(query)
    .setOptions({ skipTenantFilter: true })
    .select(
      '_id bookingStatus fromDate toDate pickupDateTime pickupLocation totalAmount remainingAmount finalAmount car',
    )
    .populate('car', 'name brand model location')
    .sort({ createdAt: -1 })
    .lean();

  if (!booking && !normalizedBookingId) {
    booking = await Booking.findOne(baseQuery)
      .setOptions({ skipTenantFilter: true })
      .select(
        '_id bookingStatus fromDate toDate pickupDateTime pickupLocation totalAmount remainingAmount finalAmount car',
      )
      .populate('car', 'name brand model location')
      .sort({ createdAt: -1 })
      .lean();
  }

  if (!booking) return null;

  const carName =
    normalizeText(booking?.car?.name) ||
    normalizeText(`${normalizeText(booking?.car?.brand)} ${normalizeText(booking?.car?.model)}`) ||
    'N/A';

  return {
    bookingId: toObjectIdString(booking._id),
    bookingStatus: normalizeText(booking.bookingStatus),
    fromDate: booking.fromDate || null,
    toDate: booking.toDate || null,
    pickupDateTime: booking.pickupDateTime || booking.fromDate || null,
    pickupLocation:
      normalizeText(booking?.pickupLocation?.address) || normalizeText(booking?.car?.location) || 'N/A',
    carName,
    totalAmount: Number(booking?.totalAmount || booking?.finalAmount || 0),
    remainingAmount: Number(booking?.remainingAmount || 0),
  };
};

const findMessageForSuggestion = async ({ messageId, tenantId }) => {
  const normalizedMessageId = toObjectIdString(messageId);
  const normalizedTenantId = toObjectIdString(tenantId);
  if (!isValidObjectId(normalizedMessageId)) {
    throw createAiAssistantError(400, 'Invalid message id');
  }
  if (!isValidObjectId(normalizedTenantId)) {
    throw createAiAssistantError(400, 'Invalid tenant id');
  }

  const message = await Message.findOne({
    _id: new mongoose.Types.ObjectId(normalizedMessageId),
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
  })
    .setOptions({ skipTenantFilter: true })
    .select('_id senderId receiverId tenantId bookingId type content createdAt')
    .lean();

  if (!message) {
    throw createAiAssistantError(404, 'Message not found for AI suggestion');
  }
  return message;
};

const resolveMessageParticipants = async (message) => {
  const senderId = toObjectIdString(message?.senderId);
  const receiverId = toObjectIdString(message?.receiverId);
  const [sender, receiver] = await Promise.all([
    User.findById(senderId).setOptions({ skipTenantFilter: true }).select('_id role').lean(),
    User.findById(receiverId).setOptions({ skipTenantFilter: true }).select('_id role').lean(),
  ]);

  if (!sender || !receiver) {
    throw createAiAssistantError(404, 'Message participants not found');
  }

  return { sender, receiver };
};

const makeSuggestionRecord = ({
  message,
  tenantId,
  adminId,
  userId,
  bookingContext,
  intent,
  confidence,
  reply,
  source,
}) => {
  const createdAt = new Date().toISOString();
  return {
    suggestionId: generateSuggestionId(),
    messageId: toObjectIdString(message?._id),
    tenantId: toObjectIdString(tenantId),
    adminId: toObjectIdString(adminId),
    userId: toObjectIdString(userId),
    bookingId: toObjectIdString(message?.bookingId || bookingContext?.bookingId || ''),
    intent,
    confidence: Number(confidence || 0),
    source,
    suggestion: normalizeText(reply),
    userMessage: normalizeText(message?.content),
    createdAt,
    updatedAt: createdAt,
    status: 'suggested',
    autoReplySent: false,
    sentMessageId: '',
    bookingContext: bookingContext || null,
  };
};

const cacheSuggestionRecord = (record) => {
  suggestionStore.set(record.suggestionId, record);
  messageSuggestionIndex.set(record.messageId, record.suggestionId);
  pruneSuggestionStore();
  return record;
};

const getSuggestionForMessage = (messageId) => {
  const normalizedMessageId = toObjectIdString(messageId);
  const suggestionId = messageSuggestionIndex.get(normalizedMessageId);
  if (!suggestionId) return null;
  return suggestionStore.get(suggestionId) || null;
};

const updateSuggestionRecord = (messageId, updater) => {
  const current = getSuggestionForMessage(messageId);
  if (!current || typeof updater !== 'function') return null;
  const updated = {
    ...current,
    ...updater(current),
    updatedAt: new Date().toISOString(),
  };
  suggestionStore.set(updated.suggestionId, updated);
  return updated;
};

const generateReply = async (userMessage, bookingContext = {}) => {
  const cleanUserMessage = normalizeText(userMessage).slice(0, MAX_USER_MESSAGE_LENGTH);
  if (!cleanUserMessage) {
    throw createAiAssistantError(422, 'User message is required for AI reply generation');
  }

  const { intent, confidence } = detectIntent(cleanUserMessage);
  const aiReply = await callOpenAIReply({
    userMessage: cleanUserMessage,
    bookingContext,
    detectedIntent: intent,
  });
  const fallbackReply = buildFallbackReply(intent, bookingContext);
  const reply = normalizeText(aiReply) || fallbackReply;

  return {
    reply,
    intent,
    confidence,
    source: normalizeText(aiReply) ? 'openai' : 'fallback',
    model: normalizeText(process.env.OPENAI_MODEL) || OPENAI_DEFAULT_MODEL,
  };
};

const generateSuggestionForMessage = async ({ messageId, tenantId, forceRegenerate = false }) => {
  const cached = getSuggestionForMessage(messageId);
  if (cached && !forceRegenerate) {
    return cached;
  }

  const message = await findMessageForSuggestion({ messageId, tenantId });
  const { sender, receiver } = await resolveMessageParticipants(message);
  if (!isUserRole(sender?.role) || !isAdminRole(receiver?.role)) {
    throw createAiAssistantError(
      422,
      'AI suggestions are generated only for user to admin messages',
    );
  }

  const bookingContext = await resolveBookingContext({
    tenantId,
    bookingId: message.bookingId,
    userId: message.senderId,
  });
  const generated = await generateReply(message.content, bookingContext || {});
  const record = makeSuggestionRecord({
    message,
    tenantId,
    adminId: message.receiverId,
    userId: message.senderId,
    bookingContext,
    intent: generated.intent,
    confidence: generated.confidence,
    reply: generated.reply,
    source: generated.source,
  });

  return cacheSuggestionRecord(record);
};

const setAutoReplyMode = ({ tenantId, adminId, enabled }) => {
  const normalizedTenantId = toObjectIdString(tenantId);
  const normalizedAdminId = toObjectIdString(adminId);
  if (!isValidObjectId(normalizedTenantId)) {
    throw createAiAssistantError(400, 'Invalid tenant id');
  }
  if (!isValidObjectId(normalizedAdminId)) {
    throw createAiAssistantError(400, 'Invalid admin id');
  }

  const key = buildAutoReplyModeKey(normalizedTenantId, normalizedAdminId);
  const normalizedEnabled = Boolean(enabled);
  const payload = {
    tenantId: normalizedTenantId,
    adminId: normalizedAdminId,
    enabled: normalizedEnabled,
    updatedAt: new Date().toISOString(),
  };
  autoReplyModeStore.set(key, payload);
  return payload;
};

const getAutoReplyMode = ({ tenantId, adminId }) => {
  const normalizedTenantId = toObjectIdString(tenantId);
  const normalizedAdminId = toObjectIdString(adminId);
  const key = buildAutoReplyModeKey(normalizedTenantId, normalizedAdminId);
  const payload = autoReplyModeStore.get(key);
  if (payload) return payload;
  return {
    tenantId: normalizedTenantId,
    adminId: normalizedAdminId,
    enabled: false,
    updatedAt: '',
  };
};

const markSuggestionSent = ({
  messageId,
  sentMessageId,
  sentByAdminId,
  autoReplySent = false,
  finalContent = '',
}) =>
  updateSuggestionRecord(messageId, (current) => ({
    status: autoReplySent ? 'auto_sent' : 'sent',
    autoReplySent: Boolean(autoReplySent),
    sentAt: new Date().toISOString(),
    sentByAdminId: toObjectIdString(sentByAdminId),
    sentMessageId: toObjectIdString(sentMessageId),
    finalContent: normalizeText(finalContent) || current.suggestion,
  }));

const processIncomingUserMessageForAdmin = async ({
  messageId,
  tenantId,
  adminId,
  sendAutoReply,
}) => {
  try {
    const suggestion = await generateSuggestionForMessage({ messageId, tenantId });
    const preview = suggestion.suggestion.slice(0, 180);
    await createNotification(
      suggestion.adminId,
      'system',
      suggestion.messageId,
      'AI reply suggestion ready',
      preview || 'New AI suggestion is available for the latest user message.',
      { tenantId: suggestion.tenantId },
    );

    const autoMode = getAutoReplyMode({
      tenantId: suggestion.tenantId,
      adminId: toObjectIdString(adminId || suggestion.adminId),
    });
    if (!autoMode.enabled || typeof sendAutoReply !== 'function') {
      return suggestion;
    }

    const sentMessage = await sendAutoReply({
      content: suggestion.suggestion,
      bookingId: suggestion.bookingId || null,
      userId: suggestion.userId,
      adminId: suggestion.adminId,
    });
    const sentMessageId = toObjectIdString(sentMessage?._id);
    markSuggestionSent({
      messageId: suggestion.messageId,
      sentMessageId,
      sentByAdminId: suggestion.adminId,
      autoReplySent: true,
      finalContent: suggestion.suggestion,
    });
    return suggestion;
  } catch (error) {
    console.error('ai auto suggestion process failed:', error?.message || error);
    return null;
  }
};

module.exports = {
  AI_INTENT,
  createAiAssistantError,
  detectIntent,
  generateReply,
  generateSuggestionForMessage,
  getSuggestionForMessage,
  getAutoReplyMode,
  setAutoReplyMode,
  markSuggestionSent,
  processIncomingUserMessageForAdmin,
};
