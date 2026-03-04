const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { ROLE, normalizeRole } = require('../utils/rbac');
const { PresenceService } = require('./presenceService');

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173'];

const SOCKET_EVENTS = Object.freeze({
  USER_CONNECT: 'user:connect',
  MESSAGE_NEW: 'message:new',
  NOTIFICATION_NEW: 'notification:new',
  UNREAD_UPDATE: 'unread:update',
  PRESENCE_UPDATE: 'presence:update',
});

const normalizeString = (value) => String(value || '').trim();
const normalizeOrigin = (value) => normalizeString(value).replace(/\/+$/, '').toLowerCase();

const toObjectIdOrNull = (value) => {
  const normalized = normalizeString(value);
  if (!mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const toUserRoomKey = (tenantId, userId) => `tenant:${tenantId}:user:${userId}`;
const toTenantRoomKey = (tenantId) => `tenant:${tenantId}`;
const toTenantUserKey = (tenantId, userId) => `${tenantId}:${userId}`;
const isAdminRole = (roleValue) => normalizeRole(roleValue, ROLE.USER) !== ROLE.USER;

const parseAllowedOrigins = () => {
  const configured = normalizeString(process.env.CORS_ORIGIN)
    .split(',')
    .map((origin) => normalizeString(origin).replace(/\/+$/, ''))
    .filter(Boolean);

  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
};

const isLocalhostOrigin = (origin) => /^https?:\/\/localhost(?::\d+)?$/i.test(normalizeOrigin(origin));

const parseToken = (socket) => {
  const authToken = normalizeString(socket.handshake?.auth?.token);
  if (authToken) {
    return authToken.toLowerCase().startsWith('bearer ') ? authToken.slice(7).trim() : authToken;
  }

  const authorization = normalizeString(socket.handshake?.headers?.authorization);
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  const queryToken = normalizeString(socket.handshake?.query?.token);
  if (queryToken) {
    return queryToken.toLowerCase().startsWith('bearer ') ? queryToken.slice(7).trim() : queryToken;
  }

  return '';
};

class SocketServerManager {
  constructor() {
    this.io = null;
    // In-memory tracking; can be replaced by Redis-backed adapter in future.
    this.socketUserMap = new Map();
    this.userSocketMap = new Map();
    this.connectedUserRoleMap = new Map();
    this.userRoleCache = new Map();
    this.presenceService = new PresenceService();
  }

  initialize(httpServer, options = {}) {
    if (this.io) return this.io;

    const allowedOrigins = parseAllowedOrigins();
    this.io = new Server(httpServer, {
      path: options.path || '/socket.io',
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);

          const normalized = normalizeOrigin(origin);
          const isAllowed =
            isLocalhostOrigin(normalized) ||
            allowedOrigins.map((entry) => normalizeOrigin(entry)).includes(normalized);

          if (isAllowed) return callback(null, true);
          return callback(new Error('Socket origin not allowed'));
        },
        credentials: true,
        methods: ['GET', 'POST'],
      },
    });

    this.io.use(this.authenticateSocket);
    this.io.on('connection', (socket) => this.onConnection(socket));

    return this.io;
  }

  getIO() {
    return this.io;
  }

  async close() {
    if (!this.io) return false;

    await this.io.close();
    this.io = null;
    this.socketUserMap.clear();
    this.userSocketMap.clear();
    this.connectedUserRoleMap.clear();
    this.userRoleCache.clear();
    this.presenceService.clear();

    return true;
  }

  authenticateSocket = async (socket, next) => {
    try {
      if (!process.env.JWT_SECRET) {
        return next(new Error('Socket authentication not configured'));
      }

      const token = parseToken(socket);
      if (!token) {
        return next(new Error('Authentication token missing'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded?.id)
        .setOptions({ skipTenantFilter: true })
        .select('_id tenantId role isBlocked')
        .lean();

      if (!user || user.isBlocked) {
        return next(new Error('Unauthorized socket connection'));
      }

      const userId = normalizeString(user._id);
      const tenantId = normalizeString(user.tenantId);

      if (!userId || !tenantId) {
        return next(new Error('Tenant context missing for socket user'));
      }

      const requestedTenantId =
        normalizeString(socket.handshake?.auth?.tenantId) ||
        normalizeString(socket.handshake?.query?.tenantId);
      if (requestedTenantId && requestedTenantId !== tenantId) {
        return next(new Error('Tenant mismatch'));
      }

      socket.data.userId = userId;
      socket.data.tenantId = tenantId;
      socket.data.role = normalizeString(user.role);

      return next();
    } catch (error) {
      return next(new Error('Unauthorized socket connection'));
    }
  };

  registerSocketConnection({ socketId, tenantId, userId, role }) {
    const normalizedSocketId = normalizeString(socketId);
    const normalizedTenantId = normalizeString(tenantId);
    const normalizedUserId = normalizeString(userId);
    const normalizedRole = normalizeRole(role, ROLE.USER);
    if (!normalizedSocketId || !normalizedTenantId || !normalizedUserId) return;

    const tenantUserKey = toTenantUserKey(normalizedTenantId, normalizedUserId);
    const existingSockets = this.userSocketMap.get(tenantUserKey) || new Set();
    existingSockets.add(normalizedSocketId);
    this.userSocketMap.set(tenantUserKey, existingSockets);
    this.connectedUserRoleMap.set(tenantUserKey, normalizedRole);
    this.userRoleCache.set(tenantUserKey, normalizedRole);
    this.socketUserMap.set(normalizedSocketId, {
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      role: normalizedRole,
    });

    return this.presenceService.setOnline({
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      socketId: normalizedSocketId,
    });
  }

  unregisterSocketConnection(socketId) {
    const normalizedSocketId = normalizeString(socketId);
    if (!normalizedSocketId) return null;

    const mapped = this.socketUserMap.get(normalizedSocketId);
    if (!mapped) return null;

    this.socketUserMap.delete(normalizedSocketId);

    const tenantUserKey = toTenantUserKey(mapped.tenantId, mapped.userId);
    const userSockets = this.userSocketMap.get(tenantUserKey);
    if (userSockets) {
      userSockets.delete(normalizedSocketId);
      if (userSockets.size === 0) {
        this.userSocketMap.delete(tenantUserKey);
        this.connectedUserRoleMap.delete(tenantUserKey);
      } else {
        this.userSocketMap.set(tenantUserKey, userSockets);
      }
    }

    const presence = this.presenceService.setOfflineBySocketId(normalizedSocketId);
    if (!presence) return null;

    return {
      ...presence,
      role: normalizeRole(mapped.role || this.userRoleCache.get(tenantUserKey), ROLE.USER),
    };
  }

  canReceivePresenceUpdate({ viewerUserId, viewerRole, targetUserId, targetRole }) {
    if (!viewerUserId || !targetUserId) return false;
    if (viewerUserId === targetUserId) return true;
    if (isAdminRole(viewerRole)) return true;
    return isAdminRole(targetRole);
  }

  getConnectedUsersForTenant(tenantId) {
    const normalizedTenantId = normalizeString(tenantId);
    if (!normalizedTenantId) return [];

    const prefix = `${normalizedTenantId}:`;
    const users = [];
    for (const [tenantUserKey, role] of this.connectedUserRoleMap.entries()) {
      if (!tenantUserKey.startsWith(prefix)) continue;
      users.push({
        userId: tenantUserKey.slice(prefix.length),
        role: normalizeRole(role, ROLE.USER),
      });
    }
    return users;
  }

  emitPresenceUpdateForUser({ tenantId, userId, role, status, lastSeen }) {
    const normalizedTenantId = normalizeString(tenantId);
    const normalizedUserId = normalizeString(userId);
    const normalizedRole = normalizeRole(role || this.userRoleCache.get(toTenantUserKey(normalizedTenantId, normalizedUserId)), ROLE.USER);
    if (!normalizedTenantId || !normalizedUserId) return false;

    const payload = {
      userId: normalizedUserId,
      status: normalizeString(status).toLowerCase() === 'online' ? 'online' : 'offline',
      lastSeen: lastSeen || null,
    };

    const connectedUsers = this.getConnectedUsersForTenant(normalizedTenantId);
    connectedUsers.forEach((viewer) => {
      if (
        this.canReceivePresenceUpdate({
          viewerUserId: viewer.userId,
          viewerRole: viewer.role,
          targetUserId: normalizedUserId,
          targetRole: normalizedRole,
        })
      ) {
        this.emitToUser({
          tenantId: normalizedTenantId,
          userId: viewer.userId,
          event: SOCKET_EVENTS.PRESENCE_UPDATE,
          payload,
        });
      }
    });

    return true;
  }

  emitPresenceSnapshotToUser({ tenantId, userId, role }) {
    const normalizedTenantId = normalizeString(tenantId);
    const normalizedUserId = normalizeString(userId);
    const normalizedRole = normalizeRole(role, ROLE.USER);
    if (!normalizedTenantId || !normalizedUserId) return false;

    const tenantPresence = this.presenceService.getTenantPresence(normalizedTenantId);
    tenantPresence.forEach((entry) => {
      const targetUserId = normalizeString(entry.userId);
      const targetRole = normalizeRole(
        this.userRoleCache.get(toTenantUserKey(normalizedTenantId, targetUserId)),
        ROLE.USER,
      );
      if (
        this.canReceivePresenceUpdate({
          viewerUserId: normalizedUserId,
          viewerRole: normalizedRole,
          targetUserId,
          targetRole,
        })
      ) {
        this.emitToUser({
          tenantId: normalizedTenantId,
          userId: normalizedUserId,
          event: SOCKET_EVENTS.PRESENCE_UPDATE,
          payload: {
            userId: targetUserId,
            status: normalizeString(entry.status).toLowerCase() === 'online' ? 'online' : 'offline',
            lastSeen: entry.lastSeen || null,
          },
        });
      }
    });

    return true;
  }

  onConnection(socket) {
    const userId = normalizeString(socket.data?.userId);
    const tenantId = normalizeString(socket.data?.tenantId);
    const role = normalizeRole(socket.data?.role, ROLE.USER);
    if (!userId || !tenantId) {
      socket.disconnect(true);
      return;
    }

    const connectedPresence = this.registerSocketConnection({
      socketId: socket.id,
      tenantId,
      userId,
      role,
    });
    socket.join(toUserRoomKey(tenantId, userId));
    socket.join(toTenantRoomKey(tenantId));

    if (connectedPresence) {
      this.emitPresenceUpdateForUser({
        tenantId,
        userId,
        role,
        status: connectedPresence.status,
        lastSeen: connectedPresence.lastSeen,
      });
      this.emitPresenceSnapshotToUser({ tenantId, userId, role });
    }

    socket.on(SOCKET_EVENTS.USER_CONNECT, (_payload, ack) => {
      const refreshedPresence = this.registerSocketConnection({
        socketId: socket.id,
        tenantId,
        userId,
        role,
      });
      if (refreshedPresence) {
        this.emitPresenceUpdateForUser({
          tenantId,
          userId,
          role,
          status: refreshedPresence.status,
          lastSeen: refreshedPresence.lastSeen,
        });
        this.emitPresenceSnapshotToUser({ tenantId, userId, role });
      }
      if (typeof ack === 'function') {
        ack({
          ok: true,
          userId,
          tenantId,
          socketId: socket.id,
        });
      }
    });

    void this.emitUnreadUpdate({ tenantId, userId }).catch((error) => {
      console.error('socket unread emit on connect failed:', error?.message || error);
    });

    socket.on('disconnect', () => {
      const disconnectedPresence = this.unregisterSocketConnection(socket.id);
      if (!disconnectedPresence) return;
      this.emitPresenceUpdateForUser({
        tenantId: disconnectedPresence.tenantId,
        userId: disconnectedPresence.userId,
        role: disconnectedPresence.role,
        status: disconnectedPresence.status,
        lastSeen: disconnectedPresence.lastSeen,
      });
    });
  }

  emitToUser({ tenantId, userId, event, payload }) {
    if (!this.io) return false;

    const normalizedTenantId = normalizeString(tenantId);
    const normalizedUserId = normalizeString(userId);
    if (!normalizedTenantId || !normalizedUserId || !event) return false;

    this.io.to(toUserRoomKey(normalizedTenantId, normalizedUserId)).emit(event, payload);
    return true;
  }

  emitMessageNew({ tenantId, userId, message }) {
    return this.emitToUser({
      tenantId,
      userId,
      event: SOCKET_EVENTS.MESSAGE_NEW,
      payload: { message },
    });
  }

  emitNotificationNew({ tenantId, userId, notification }) {
    return this.emitToUser({
      tenantId,
      userId,
      event: SOCKET_EVENTS.NOTIFICATION_NEW,
      payload: { notification },
    });
  }

  async getUnreadSnapshot({ tenantId, userId }) {
    const tenantObjectId = toObjectIdOrNull(tenantId);
    const userObjectId = toObjectIdOrNull(userId);

    if (!tenantObjectId || !userObjectId) {
      return {
        userId: normalizeString(userId),
        tenantId: normalizeString(tenantId),
        messages: 0,
        notifications: 0,
        total: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    const [messages, notifications] = await Promise.all([
      Message.countDocuments({
        tenantId: tenantObjectId,
        receiverId: userObjectId,
        isRead: false,
        deletedFor: { $ne: userObjectId },
      }),
      Notification.countDocuments({
        tenantId: tenantObjectId,
        userId: userObjectId,
        isRead: false,
      }),
    ]);

    return {
      userId: normalizeString(userId),
      tenantId: normalizeString(tenantId),
      messages: Number(messages || 0),
      notifications: Number(notifications || 0),
      total: Number(messages || 0) + Number(notifications || 0),
      updatedAt: new Date().toISOString(),
    };
  }

  async emitUnreadUpdate({ tenantId, userId }) {
    const snapshot = await this.getUnreadSnapshot({ tenantId, userId });
    this.emitToUser({
      tenantId: snapshot.tenantId,
      userId: snapshot.userId,
      event: SOCKET_EVENTS.UNREAD_UPDATE,
      payload: snapshot,
    });
    return snapshot;
  }
}

module.exports = {
  SocketServerManager,
  SOCKET_EVENTS,
  toUserRoomKey,
  toTenantRoomKey,
};
