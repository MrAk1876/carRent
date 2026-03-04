const { SocketServerManager } = require('./socketServer');

const realtimeGateway = new SocketServerManager();

const initializeSocketServer = (httpServer, options = {}) =>
  realtimeGateway.initialize(httpServer, options);

const closeSocketServer = async () => realtimeGateway.close();

const getSocketServer = () => realtimeGateway.getIO();

const emitMessageNew = ({ tenantId, userId, message }) =>
  realtimeGateway.emitMessageNew({ tenantId, userId, message });

const emitNotificationNew = ({ tenantId, userId, notification }) =>
  realtimeGateway.emitNotificationNew({ tenantId, userId, notification });

const emitUnreadUpdate = async ({ tenantId, userId }) =>
  realtimeGateway.emitUnreadUpdate({ tenantId, userId });

module.exports = {
  initializeSocketServer,
  closeSocketServer,
  getSocketServer,
  emitMessageNew,
  emitNotificationNew,
  emitUnreadUpdate,
};
