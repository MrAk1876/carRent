const mongoose = require('mongoose');
const Message = require('../models/Message');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { MESSAGE_TYPE, MESSAGE_TYPE_VALUES } = require('../models/Message');
const { ROLE, normalizeRole } = require('../utils/rbac');
const { createNotification } = require('./notificationService');
const { processIncomingUserMessageForAdmin } = require('./aiAssistantService');
const { emitMessageNew, emitUnreadUpdate } = require('../socket');

const MAX_CONVERSATION_LIMIT = 300;
const DEFAULT_CONVERSATION_LIMIT = 150;
const DELETED_MESSAGE_PLACEHOLDER = 'This message was deleted';
const AI_ASSISTANT_AUTOSUGGEST_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.AI_ASSISTANT_AUTOSUGGEST_ENABLED || '').trim().toLowerCase(),
);

const createMessageError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toObjectIdString = (value) => String(value || '').trim();

const ensureObjectId = (value, fieldName) => {
  const normalized = toObjectIdString(value);
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throw createMessageError(400, `Invalid ${fieldName}`);
  }
  return normalized;
};

const toOptionalObjectId = (value, fieldName) => {
  const normalized = toObjectIdString(value);
  if (!normalized) return '';
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throw createMessageError(400, `Invalid ${fieldName}`);
  }
  return normalized;
};

const toSafeLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONVERSATION_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_CONVERSATION_LIMIT);
};

const isAdminRole = (roleValue) => normalizeRole(roleValue, ROLE.USER) !== ROLE.USER;
const isUserRole = (roleValue) => normalizeRole(roleValue, ROLE.USER) === ROLE.USER;

const emitMessageToParticipants = ({ tenantId, message }) => {
  const senderId = toObjectIdString(message?.senderId);
  const receiverId = toObjectIdString(message?.receiverId);
  const targets = [...new Set([senderId, receiverId].filter(Boolean))];
  targets.forEach((userId) => {
    try {
      emitMessageNew({
        tenantId,
        userId,
        message,
      });
    } catch (realtimeError) {
      console.error('message realtime emit failed:', realtimeError?.message || realtimeError);
    }
  });
};

const STAFF_ROLE_PRIORITY = Object.freeze({
  [ROLE.PLATFORM_SUPER_ADMIN]: 0,
  [ROLE.SUPER_ADMIN]: 1,
  [ROLE.BRANCH_ADMIN]: 2,
  [ROLE.SUPPORT_STAFF]: 3,
  [ROLE.FLEET_MANAGER]: 4,
  [ROLE.FINANCE_MANAGER]: 5,
});

const getRolePriority = (roleValue) =>
  Number(STAFF_ROLE_PRIORITY[normalizeRole(roleValue, ROLE.USER)] ?? 99);

const toDisplayName = (user) => {
  const firstName = String(user?.firstName || '').trim();
  const lastName = String(user?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || String(user?.email || '').trim() || 'Admin Team';
};

const assertSendPermission = (sender, receiver) => {
  const senderIsUser = isUserRole(sender?.role);
  const receiverIsAdmin = isAdminRole(receiver?.role);

  // Users can only message admins. Admin/staff roles can message any tenant user.
  if (senderIsUser && !receiverIsAdmin) {
    throw createMessageError(403, 'Users can only send messages to admins');
  }
};

const assertConversationPermission = (currentUser, otherUser) => {
  const currentUserIsUser = isUserRole(currentUser?.role);
  const otherUserIsAdmin = isAdminRole(otherUser?.role);

  // Users can only read conversations with admins. Admin/staff roles can read all conversations.
  if (currentUserIsUser && !otherUserIsAdmin) {
    throw createMessageError(403, 'Users can only view conversations with admins');
  }
};

const normalizeMessageType = (value) => {
  const normalized = String(value || MESSAGE_TYPE.GENERAL).trim().toLowerCase();
  if (!MESSAGE_TYPE_VALUES.includes(normalized)) {
    throw createMessageError(422, 'Invalid message type');
  }
  return normalized;
};

const MESSAGE_DELETE_SCOPE = Object.freeze({
  FOR_ME: 'for_me',
  FOR_EVERYONE: 'for_everyone',
});

const normalizeDeleteScope = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['me', 'forme', MESSAGE_DELETE_SCOPE.FOR_ME].includes(normalized)) {
    return MESSAGE_DELETE_SCOPE.FOR_ME;
  }
  if (['all', 'everyone', 'foreveryone', MESSAGE_DELETE_SCOPE.FOR_EVERYONE].includes(normalized)) {
    return MESSAGE_DELETE_SCOPE.FOR_EVERYONE;
  }
  return MESSAGE_DELETE_SCOPE.FOR_EVERYONE;
};

const resolveUser = async (userId) => {
  const user = await User.findById(userId)
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId role isBlocked')
    .lean();
  if (!user) {
    throw createMessageError(404, 'User not found');
  }
  if (Boolean(user.isBlocked)) {
    throw createMessageError(403, 'Blocked users cannot participate in messaging');
  }
  return user;
};

const ensureTenantAlignment = (sender, receiver, tenantIdInput = '') => {
  const senderTenantId = toObjectIdString(sender?.tenantId);
  const receiverTenantId = toObjectIdString(receiver?.tenantId);
  const requestedTenantId = toObjectIdString(tenantIdInput || senderTenantId || receiverTenantId);

  if (!senderTenantId || !receiverTenantId || !requestedTenantId) {
    throw createMessageError(403, 'Tenant scope is required for messaging');
  }

  if (senderTenantId !== receiverTenantId || senderTenantId !== requestedTenantId) {
    throw createMessageError(403, 'Sender and receiver must belong to same tenant');
  }

  return requestedTenantId;
};

const buildMessageNotificationMeta = (normalizedType, message, content, options = {}) => {
  const notificationTitle =
    String(options.notificationTitle || '').trim() ||
    (normalizedType === MESSAGE_TYPE.BOOKING
      ? 'New booking message'
      : normalizedType === MESSAGE_TYPE.SYSTEM
        ? 'System message'
        : 'New message');

  const notificationBody =
    String(options.notificationBody || '').trim() ||
    String(content || '').slice(0, 180) ||
    'You have received a new message';

  const notificationType = String(options.notificationType || '').trim().toLowerCase() || 'message';
  const notificationReferenceId = toObjectIdString(options.notificationReferenceId || message?._id || '');

  return {
    notificationTitle,
    notificationBody,
    notificationType,
    notificationReferenceId,
  };
};

const validateBookingMessageAccess = async ({ bookingId, sender, receiver, tenantId, options = {} }) => {
  const normalizedBookingId = toOptionalObjectId(bookingId, 'booking id');
  if (!normalizedBookingId) return null;

  const booking = await Booking.findById(normalizedBookingId)
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId user')
    .lean();

  if (!booking) {
    throw createMessageError(404, 'Booking not found');
  }

  const bookingTenantId = toObjectIdString(booking.tenantId);
  if (!bookingTenantId || bookingTenantId !== tenantId) {
    throw createMessageError(403, 'Booking does not belong to current tenant');
  }

  if (options.skipBookingParticipantValidation) {
    return normalizedBookingId;
  }

  const bookingUserId = toObjectIdString(booking.user);
  const senderId = toObjectIdString(sender?._id);
  const receiverId = toObjectIdString(receiver?._id);

  const senderRole = normalizeRole(sender?.role, ROLE.USER);
  const receiverRole = normalizeRole(receiver?.role, ROLE.USER);
  const senderIsBookingUser = senderId === bookingUserId;
  const receiverIsBookingUser = receiverId === bookingUserId;

  if (!senderIsBookingUser && !receiverIsBookingUser) {
    throw createMessageError(403, 'Booking messages must include the booking user');
  }

  if (senderRole === ROLE.USER && !senderIsBookingUser) {
    throw createMessageError(403, 'Sender is not a participant of this booking');
  }

  if (receiverRole === ROLE.USER && !receiverIsBookingUser) {
    throw createMessageError(403, 'Receiver is not a participant of this booking');
  }

  return normalizedBookingId;
};

const sendMessage = async (senderId, receiverId, content, type = MESSAGE_TYPE.GENERAL, bookingId = null, options = {}) => {
  const normalizedSenderId = ensureObjectId(senderId, 'sender id');
  const normalizedReceiverId = ensureObjectId(receiverId, 'receiver id');
  const normalizedType = normalizeMessageType(type);
  const normalizedContent = String(content || '').trim();

  if (!normalizedContent) {
    throw createMessageError(422, 'Message content is required');
  }

  if (normalizedType === MESSAGE_TYPE.BOOKING && !toObjectIdString(bookingId)) {
    throw createMessageError(422, 'bookingId is required for booking messages');
  }

  const [sender, receiver] = await Promise.all([
    resolveUser(normalizedSenderId),
    resolveUser(normalizedReceiverId),
  ]);
  const tenantId = ensureTenantAlignment(sender, receiver, options.tenantId);
  assertSendPermission(sender, receiver);

  const validatedBookingId = await validateBookingMessageAccess({
    bookingId,
    sender,
    receiver,
    tenantId,
    options,
  });

  const message = await Message.create({
    senderId: new mongoose.Types.ObjectId(normalizedSenderId),
    receiverId: new mongoose.Types.ObjectId(normalizedReceiverId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
    bookingId: validatedBookingId ? new mongoose.Types.ObjectId(validatedBookingId) : null,
    type: normalizedType,
    content: normalizedContent,
    isRead: false,
  });
  const messagePayload = typeof message?.toObject === 'function' ? message.toObject() : message;

  try {
    emitMessageNew({
      tenantId,
      userId: normalizedReceiverId,
      message: messagePayload,
    });
  } catch (realtimeError) {
    console.error('message realtime emit failed:', realtimeError?.message || realtimeError);
  }

  void emitUnreadUpdate({
    tenantId,
    userId: normalizedReceiverId,
  }).catch((realtimeError) => {
    console.error('message unread realtime emit failed:', realtimeError?.message || realtimeError);
  });

  const notificationMeta = buildMessageNotificationMeta(normalizedType, message, normalizedContent, options);
  try {
    await createNotification(
      normalizedReceiverId,
      notificationMeta.notificationType,
      notificationMeta.notificationReferenceId,
      notificationMeta.notificationTitle,
      notificationMeta.notificationBody,
      { tenantId },
    );
  } catch (notificationError) {
    if (options.failOnNotificationError) {
      throw notificationError;
    }
    console.error('message notification create failed:', notificationError?.message || notificationError);
  }

  const senderRole = normalizeRole(sender?.role, ROLE.USER);
  const receiverRole = normalizeRole(receiver?.role, ROLE.USER);
  const shouldProcessAiSuggestion =
    AI_ASSISTANT_AUTOSUGGEST_ENABLED &&
    !options.skipAiAssistant &&
    senderRole === ROLE.USER &&
    receiverRole !== ROLE.USER;

  if (shouldProcessAiSuggestion) {
    void processIncomingUserMessageForAdmin({
      messageId: toObjectIdString(messagePayload?._id),
      tenantId,
      adminId: normalizedReceiverId,
      sendAutoReply: ({ content, bookingId }) =>
        sendMessage(
          normalizedReceiverId,
          normalizedSenderId,
          content,
          MESSAGE_TYPE.GENERAL,
          bookingId || validatedBookingId || null,
          {
            tenantId,
            skipAiAssistant: true,
            notificationType: 'message',
            notificationTitle: 'AI auto-reply sent',
            notificationBody: 'An automated assistant response was sent to the user.',
          },
        ),
    }).catch((aiError) => {
      console.error('ai suggestion hook failed:', aiError?.message || aiError);
    });
  }

  return message;
};

const updateMessageContent = async (messageId, userId, content, options = {}) => {
  const normalizedMessageId = ensureObjectId(messageId, 'message id');
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const normalizedContent = String(content || '').trim();

  if (!normalizedContent) {
    throw createMessageError(422, 'Message content is required');
  }

  const actor = await resolveUser(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || actor.tenantId);
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createMessageError(400, 'Invalid tenant id');
  }
  if (toObjectIdString(actor.tenantId) !== tenantId) {
    throw createMessageError(403, 'Message tenant mismatch');
  }

  const actorObjectId = new mongoose.Types.ObjectId(normalizedUserId);
  const message = await Message.findOne({
    _id: new mongoose.Types.ObjectId(normalizedMessageId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
    $or: [{ senderId: actorObjectId }, { receiverId: actorObjectId }],
    deletedFor: { $ne: actorObjectId },
  });

  if (!message) {
    throw createMessageError(404, 'Message not found');
  }
  if (message.isDeleted) {
    throw createMessageError(409, 'Deleted messages cannot be edited');
  }
  if (message.type === MESSAGE_TYPE.SYSTEM) {
    throw createMessageError(403, 'System messages cannot be edited');
  }

  message.content = normalizedContent;
  message.editedAt = new Date();
  await message.save();

  const payload = typeof message?.toObject === 'function' ? message.toObject() : message;
  emitMessageToParticipants({ tenantId, message: payload });

  return payload;
};

const deleteMessage = async (messageId, userId, options = {}) => {
  const normalizedMessageId = ensureObjectId(messageId, 'message id');
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const deleteScope = normalizeDeleteScope(options.scope);

  const actor = await resolveUser(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || actor.tenantId);
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createMessageError(400, 'Invalid tenant id');
  }
  if (toObjectIdString(actor.tenantId) !== tenantId) {
    throw createMessageError(403, 'Message tenant mismatch');
  }

  const actorObjectId = new mongoose.Types.ObjectId(normalizedUserId);
  const message = await Message.findOne({
    _id: new mongoose.Types.ObjectId(normalizedMessageId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
    $or: [{ senderId: actorObjectId }, { receiverId: actorObjectId }],
  });

  if (!message) {
    throw createMessageError(404, 'Message not found');
  }
  if (message.type === MESSAGE_TYPE.SYSTEM) {
    throw createMessageError(403, 'System messages cannot be deleted');
  }

  const senderId = toObjectIdString(message.senderId);
  const receiverId = toObjectIdString(message.receiverId);
  const participantIds = [...new Set([senderId, receiverId].filter(Boolean))];

  if (!participantIds.includes(normalizedUserId)) {
    throw createMessageError(403, 'Only conversation participants can delete this message');
  }

  if (deleteScope === MESSAGE_DELETE_SCOPE.FOR_ME) {
    const alreadyDeletedForActor = (message.deletedFor || []).some(
      (entry) => toObjectIdString(entry) === normalizedUserId,
    );

    if (!alreadyDeletedForActor) {
      message.deletedFor = [...(message.deletedFor || []), actorObjectId];
      await message.save();
    }

    const payload = typeof message?.toObject === 'function' ? message.toObject() : message;
    payload.isRemoved = true;
    try {
      emitMessageNew({
        tenantId,
        userId: normalizedUserId,
        message: payload,
      });
    } catch (realtimeError) {
      console.error('message realtime emit failed:', realtimeError?.message || realtimeError);
    }
    return payload;
  }

  message.content = DELETED_MESSAGE_PLACEHOLDER;
  message.isDeleted = true;
  message.isDeletedForAll = true;
  message.deletedAt = new Date();
  message.editedAt = null;
  message.isRead = true;
  await message.save();

  const payload = typeof message?.toObject === 'function' ? message.toObject() : message;
  emitMessageToParticipants({ tenantId, message: payload });

  if (receiverId) {
    void emitUnreadUpdate({
      tenantId,
      userId: receiverId,
    }).catch((realtimeError) => {
      console.error('message unread realtime emit failed:', realtimeError?.message || realtimeError);
    });
  }

  return payload;
};

const getConversation = async (userId, otherUserId, options = {}) => {
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const normalizedOtherUserId = ensureObjectId(otherUserId, 'other user id');
  const [currentUser, otherUser] = await Promise.all([
    resolveUser(normalizedUserId),
    resolveUser(normalizedOtherUserId),
  ]);

  const tenantId = ensureTenantAlignment(currentUser, otherUser, options.tenantId);
  assertConversationPermission(currentUser, otherUser);
  const limit = toSafeLimit(options.limit);

  const currentUserObjectId = new mongoose.Types.ObjectId(normalizedUserId);
  const otherUserObjectId = new mongoose.Types.ObjectId(normalizedOtherUserId);

  const conversation = await Message.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    deletedFor: { $ne: currentUserObjectId },
    $or: [
      {
        senderId: currentUserObjectId,
        receiverId: otherUserObjectId,
      },
      {
        senderId: otherUserObjectId,
        receiverId: currentUserObjectId,
      },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  return conversation;
};

const markAsRead = async (messageId, userId, options = {}) => {
  const normalizedMessageId = ensureObjectId(messageId, 'message id');
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const receiver = await resolveUser(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || receiver.tenantId);

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createMessageError(400, 'Invalid tenant id');
  }
  if (toObjectIdString(receiver.tenantId) !== tenantId) {
    throw createMessageError(403, 'Message tenant mismatch');
  }

  const userObjectId = new mongoose.Types.ObjectId(normalizedUserId);
  const message = await Message.findOneAndUpdate(
    {
      _id: normalizedMessageId,
      tenantId: new mongoose.Types.ObjectId(tenantId),
      receiverId: userObjectId,
      isDeletedForAll: { $ne: true },
      deletedFor: { $ne: userObjectId },
    },
    {
      $set: { isRead: true },
    },
    { new: true },
  ).lean();

  if (!message) {
    throw createMessageError(404, 'Message not found');
  }

  return message;
};

const getUnreadCount = async (userId, options = {}) => {
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const receiver = await resolveUser(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || receiver.tenantId);

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createMessageError(400, 'Invalid tenant id');
  }
  if (toObjectIdString(receiver.tenantId) !== tenantId) {
    throw createMessageError(403, 'Message tenant mismatch');
  }

  const userObjectId = new mongoose.Types.ObjectId(normalizedUserId);
  const unreadCount = await Message.countDocuments({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    receiverId: userObjectId,
    isRead: false,
    isDeletedForAll: { $ne: true },
    deletedFor: { $ne: userObjectId },
  });

  return Number(unreadCount || 0);
};

const getAdminContact = async (userId, options = {}) => {
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const requester = await resolveUser(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || requester.tenantId);

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createMessageError(400, 'Invalid tenant id');
  }
  if (toObjectIdString(requester.tenantId) !== tenantId) {
    throw createMessageError(403, 'Message tenant mismatch');
  }

  const requesterObjectId = new mongoose.Types.ObjectId(normalizedUserId);
  const staffUsers = await User.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    isBlocked: false,
    role: { $ne: ROLE.USER },
    _id: { $ne: requesterObjectId },
  })
    .setOptions({ skipTenantFilter: true })
    .select('_id firstName lastName email role createdAt')
    .lean();

  if (!Array.isArray(staffUsers) || staffUsers.length === 0) {
    throw createMessageError(404, 'No admin contact found for this tenant');
  }

  const sorted = [...staffUsers].sort((left, right) => {
    const roleDelta = getRolePriority(left?.role) - getRolePriority(right?.role);
    if (roleDelta !== 0) return roleDelta;
    const leftTime = new Date(left?.createdAt || 0).getTime();
    const rightTime = new Date(right?.createdAt || 0).getTime();
    return leftTime - rightTime;
  });

  const target = sorted[0];
  return {
    userId: toObjectIdString(target?._id),
    name: toDisplayName(target),
    email: String(target?.email || '').trim(),
    role: normalizeRole(target?.role, ROLE.USER),
  };
};

module.exports = {
  createMessageError,
  sendMessage,
  updateMessageContent,
  deleteMessage,
  getConversation,
  markAsRead,
  getUnreadCount,
  getAdminContact,
  MESSAGE_DELETE_SCOPE,
};
