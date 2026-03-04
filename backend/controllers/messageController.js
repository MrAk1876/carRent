const {
  sendMessage,
  updateMessageContent,
  deleteMessage: deleteMessageById,
  getConversation,
  markAsRead,
  getUnreadCount,
  getAdminContact,
} = require('../services/messageService');

const SEND_MESSAGE_ERROR = 'Failed to send message';
const UPDATE_MESSAGE_ERROR = 'Failed to update message';
const DELETE_MESSAGE_ERROR = 'Failed to delete message';
const GET_CONVERSATION_ERROR = 'Failed to load conversation';
const MARK_READ_ERROR = 'Failed to mark message as read';
const GET_UNREAD_COUNT_ERROR = 'Failed to load unread count';
const GET_ADMIN_CONTACT_ERROR = 'Failed to load admin contact';

exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user?._id;
    const receiverId = req.body?.receiverId;
    const content = req.body?.content;
    const type = req.body?.type || 'general';
    const bookingId = req.body?.bookingId || null;

    const message = await sendMessage(senderId, receiverId, content, type, bookingId, {
      tenantId: req.tenantId,
    });

    return res.status(201).json({
      message: 'Message sent successfully',
      data: message,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? SEND_MESSAGE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.getConversation = async (req, res) => {
  try {
    const currentUserId = req.user?._id;
    const otherUserId = req.params.userId;
    const conversation = await getConversation(currentUserId, otherUserId, {
      tenantId: req.tenantId,
      limit: req.query?.limit,
    });

    return res.json({
      conversation,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? GET_CONVERSATION_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateMessage = async (req, res) => {
  try {
    const message = await updateMessageContent(req.params.id, req.user?._id, req.body?.content, {
      tenantId: req.tenantId,
    });

    return res.json({
      message: 'Message updated successfully',
      data: message,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? UPDATE_MESSAGE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const message = await deleteMessageById(req.params.id, req.user?._id, {
      tenantId: req.tenantId,
      scope: req.body?.scope || req.query?.scope,
    });

    return res.json({
      message: 'Message deleted successfully',
      data: message,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? DELETE_MESSAGE_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.markMessageAsRead = async (req, res) => {
  try {
    const message = await markAsRead(req.params.id, req.user?._id, {
      tenantId: req.tenantId,
    });

    return res.json({
      message: 'Message marked as read',
      data: message,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? MARK_READ_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await getUnreadCount(req.user?._id, {
      tenantId: req.tenantId,
    });

    return res.json({
      unreadCount,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? GET_UNREAD_COUNT_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.getAdminContact = async (req, res) => {
  try {
    const contact = await getAdminContact(req.user?._id, {
      tenantId: req.tenantId,
    });

    return res.json({
      contact,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? GET_ADMIN_CONTACT_ERROR : error.message;
    return res.status(status).json({ message });
  }
};
