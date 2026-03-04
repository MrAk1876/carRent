const normalizeString = (value) => String(value || '').trim();
const toTenantUserKey = (tenantId, userId) => `${tenantId}:${userId}`;

const PRESENCE_STATUS = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
});

class PresenceService {
  constructor() {
    this.presenceByTenantUser = new Map();
    this.userSocketsByTenantUser = new Map();
    this.socketToTenantUser = new Map();
  }

  setOnline({ tenantId, userId, socketId }) {
    const normalizedTenantId = normalizeString(tenantId);
    const normalizedUserId = normalizeString(userId);
    const normalizedSocketId = normalizeString(socketId);
    if (!normalizedTenantId || !normalizedUserId || !normalizedSocketId) {
      return null;
    }

    const tenantUserKey = toTenantUserKey(normalizedTenantId, normalizedUserId);
    const socketSet = this.userSocketsByTenantUser.get(tenantUserKey) || new Set();
    socketSet.add(normalizedSocketId);
    this.userSocketsByTenantUser.set(tenantUserKey, socketSet);
    this.socketToTenantUser.set(normalizedSocketId, {
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
    });

    const existingPresence = this.presenceByTenantUser.get(tenantUserKey) || {};
    const nextPresence = {
      socketId: normalizedSocketId,
      status: PRESENCE_STATUS.ONLINE,
      lastSeen: existingPresence.lastSeen || null,
    };
    this.presenceByTenantUser.set(tenantUserKey, nextPresence);

    return {
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      ...nextPresence,
    };
  }

  setOfflineBySocketId(socketId) {
    const normalizedSocketId = normalizeString(socketId);
    if (!normalizedSocketId) return null;

    const mapped = this.socketToTenantUser.get(normalizedSocketId);
    if (!mapped) return null;

    this.socketToTenantUser.delete(normalizedSocketId);

    const tenantId = normalizeString(mapped.tenantId);
    const userId = normalizeString(mapped.userId);
    const tenantUserKey = toTenantUserKey(tenantId, userId);

    const socketSet = this.userSocketsByTenantUser.get(tenantUserKey) || new Set();
    socketSet.delete(normalizedSocketId);

    const existingPresence = this.presenceByTenantUser.get(tenantUserKey) || {
      socketId: '',
      status: PRESENCE_STATUS.OFFLINE,
      lastSeen: null,
    };

    let nextPresence = null;
    if (socketSet.size > 0) {
      this.userSocketsByTenantUser.set(tenantUserKey, socketSet);
      const [firstSocketId] = socketSet.values();
      nextPresence = {
        socketId: normalizeString(firstSocketId),
        status: PRESENCE_STATUS.ONLINE,
        lastSeen: existingPresence.lastSeen || null,
      };
    } else {
      this.userSocketsByTenantUser.delete(tenantUserKey);
      nextPresence = {
        socketId: '',
        status: PRESENCE_STATUS.OFFLINE,
        lastSeen: new Date().toISOString(),
      };
    }

    this.presenceByTenantUser.set(tenantUserKey, nextPresence);

    return {
      tenantId,
      userId,
      ...nextPresence,
    };
  }

  getPresence({ tenantId, userId }) {
    const normalizedTenantId = normalizeString(tenantId);
    const normalizedUserId = normalizeString(userId);
    if (!normalizedTenantId || !normalizedUserId) {
      return {
        tenantId: normalizedTenantId,
        userId: normalizedUserId,
        socketId: '',
        status: PRESENCE_STATUS.OFFLINE,
        lastSeen: null,
      };
    }

    const presence =
      this.presenceByTenantUser.get(toTenantUserKey(normalizedTenantId, normalizedUserId)) || null;

    if (!presence) {
      return {
        tenantId: normalizedTenantId,
        userId: normalizedUserId,
        socketId: '',
        status: PRESENCE_STATUS.OFFLINE,
        lastSeen: null,
      };
    }

    return {
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      socketId: normalizeString(presence.socketId),
      status:
        normalizeString(presence.status).toLowerCase() === PRESENCE_STATUS.ONLINE
          ? PRESENCE_STATUS.ONLINE
          : PRESENCE_STATUS.OFFLINE,
      lastSeen: presence.lastSeen || null,
    };
  }

  getTenantPresence(tenantId) {
    const normalizedTenantId = normalizeString(tenantId);
    if (!normalizedTenantId) return [];

    const prefix = `${normalizedTenantId}:`;
    const entries = [];

    for (const [tenantUserKey, presence] of this.presenceByTenantUser.entries()) {
      if (!tenantUserKey.startsWith(prefix)) continue;
      const userId = tenantUserKey.slice(prefix.length);
      entries.push({
        tenantId: normalizedTenantId,
        userId,
        socketId: normalizeString(presence?.socketId),
        status:
          normalizeString(presence?.status).toLowerCase() === PRESENCE_STATUS.ONLINE
            ? PRESENCE_STATUS.ONLINE
            : PRESENCE_STATUS.OFFLINE,
        lastSeen: presence?.lastSeen || null,
      });
    }

    return entries;
  }

  clear() {
    this.presenceByTenantUser.clear();
    this.userSocketsByTenantUser.clear();
    this.socketToTenantUser.clear();
  }
}

module.exports = {
  PRESENCE_STATUS,
  PresenceService,
};
