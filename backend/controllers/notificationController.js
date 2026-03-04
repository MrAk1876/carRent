const {
  getUserNotifications,
  markNotificationRead,
  deleteNotification,
} = require('../services/notificationService');

const GET_NOTIFICATIONS_ERROR = 'Failed to load notifications';
const MARK_NOTIFICATION_ERROR = 'Failed to mark notification as read';
const DELETE_NOTIFICATION_ERROR = 'Failed to delete notification';

exports.getNotifications = async (req, res) => {
  try {
    const payload = await getUserNotifications(req.user?._id, {
      tenantId: req.tenantId,
      limit: req.query?.limit,
    });

    return res.json(payload);
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? GET_NOTIFICATIONS_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.markNotificationAsRead = async (req, res) => {
  try {
    const notification = await markNotificationRead(req.params.id, req.user?._id, {
      tenantId: req.tenantId,
    });

    return res.json({
      message: 'Notification marked as read',
      data: notification,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? MARK_NOTIFICATION_ERROR : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const notification = await deleteNotification(req.params.id, req.user?._id, {
      tenantId: req.tenantId,
    });

    return res.json({
      message: 'Notification deleted',
      data: notification,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? DELETE_NOTIFICATION_ERROR : error.message;
    return res.status(status).json({ message });
  }
};
