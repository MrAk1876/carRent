import { io, Socket } from 'socket.io-client';
import { getUser } from '../utils/auth';

export type SocketUnreadPayload = {
  userId: string;
  tenantId: string;
  messages: number;
  notifications: number;
  total: number;
  updatedAt: string;
};

export type SocketMessagePayload = {
  message: Record<string, unknown>;
};

export type SocketNotificationPayload = {
  notification: Record<string, unknown>;
};

export type SocketPresencePayload = {
  userId: string;
  status: 'online' | 'offline' | string;
  lastSeen?: string | null;
};

type SocketEventMap = {
  'message:new': SocketMessagePayload;
  'notification:new': SocketNotificationPayload;
  'unread:update': SocketUnreadPayload;
  'presence:update': SocketPresencePayload;
};

type Listener<T> = (payload: T) => void;

const SOCKET_PATH = '/socket.io';

const normalizeUrl = (value: string) => String(value || '').trim().replace(/\/+$/, '');
const parseBoolean = (value: string) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const isPlaceholderUrl = (value: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) return true;
  if (/[<>{}\[\]]/.test(normalized)) return true;
  if (/your[-_a-z0-9]*/i.test(normalized)) return true;
  return false;
};

const toValidHttpUrl = (value: string) => {
  const normalized = normalizeUrl(value);
  if (isPlaceholderUrl(normalized)) return '';
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return normalizeUrl(parsed.toString());
  } catch {
    return '';
  }
};

const resolveSocketBaseUrl = () => {
  const explicit = toValidHttpUrl(import.meta.env.VITE_SOCKET_URL || '');
  if (explicit) return explicit;

  const backendTarget = toValidHttpUrl(import.meta.env.VITE_DEV_BACKEND_URL || '');
  if (backendTarget) return backendTarget;

  const apiBaseUrl = toValidHttpUrl(import.meta.env.VITE_API_BASE_URL || '');
  if (apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://')) {
    if (apiBaseUrl.endsWith('/api')) return apiBaseUrl.slice(0, -4);
    return apiBaseUrl;
  }

  if (typeof window !== 'undefined') {
    const currentOrigin = toValidHttpUrl(window.location.origin || '');
    if (currentOrigin) return currentOrigin;
  }

  return 'http://localhost:5000';
};

const shouldUsePollingOnly = (socketUrl: string) => {
  if (parseBoolean(String(import.meta.env.VITE_SOCKET_FORCE_POLLING || ''))) {
    return true;
  }
  try {
    const parsed = new URL(socketUrl);
    const localHost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    return Boolean(import.meta.env.DEV) && localHost;
  } catch {
    return Boolean(import.meta.env.DEV);
  }
};

class SocketClientService {
  private socket: Socket | null = null;

  private initializedToken = '';

  private initializedTenantId = '';

  private readonly listeners: {
    [K in keyof SocketEventMap]: Set<Listener<SocketEventMap[K]>>;
  } = {
    'message:new': new Set(),
    'notification:new': new Set(),
    'unread:update': new Set(),
    'presence:update': new Set(),
  };

  connect(tokenInput?: string, tenantIdInput?: string) {
    const token = String(tokenInput || localStorage.getItem('token') || '').trim();
    if (!token) return null;

    const user = getUser();
    const tenantId = String(tenantIdInput || user?.tenantId || '').trim();
    const hasSocket = Boolean(this.socket);
    const sameCredentials =
      this.initializedToken === token &&
      this.initializedTenantId === tenantId;

    if (hasSocket && sameCredentials && this.socket) {
      // Avoid disconnecting a socket that is still connecting to prevent noisy
      // "closed before established" warnings when multiple UI widgets call connect().
      if (!this.socket.connected && !this.socket.active) {
        this.socket.connect();
      }
      return this.socket;
    }

    if (this.socket && !sameCredentials) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    const socketUrl = resolveSocketBaseUrl();
    const pollingOnly = shouldUsePollingOnly(socketUrl);
    this.socket = io(socketUrl, {
      path: SOCKET_PATH,
      transports: pollingOnly ? ['polling'] : ['polling', 'websocket'],
      upgrade: !pollingOnly,
      autoConnect: true,
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 6,
      reconnectionDelay: 1200,
      reconnectionDelayMax: 5000,
      auth: {
        token: `Bearer ${token}`,
        tenantId,
      },
      withCredentials: true,
    });

    this.initializedToken = token;
    this.initializedTenantId = tenantId;
    this.bindCoreListeners();

    return this.socket;
  }

  disconnect() {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }

  isConnected() {
    return Boolean(this.socket?.connected);
  }

  emitUserConnect() {
    if (!this.socket) return;
    this.socket.emit('user:connect');
  }

  on<K extends keyof SocketEventMap>(event: K, listener: Listener<SocketEventMap[K]>) {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  private bindCoreListeners() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.emitUserConnect();
    });

    this.socket.on('message:new', (payload: SocketMessagePayload) => {
      this.listeners['message:new'].forEach((listener) => listener(payload));
    });

    this.socket.on('notification:new', (payload: SocketNotificationPayload) => {
      this.listeners['notification:new'].forEach((listener) => listener(payload));
    });

    this.socket.on('unread:update', (payload: SocketUnreadPayload) => {
      this.listeners['unread:update'].forEach((listener) => listener(payload));
    });

    this.socket.on('presence:update', (payload: SocketPresencePayload) => {
      this.listeners['presence:update'].forEach((listener) => listener(payload));
    });

    this.socket.on('connect_error', (error: Error) => {
      const message = String(error?.message || '').toLowerCase();
      if (
        message.includes('unauthorized') ||
        message.includes('authentication') ||
        message.includes('token')
      ) {
        this.socket?.disconnect();
      }
    });
  }
}

const socketClient = new SocketClientService();

export default socketClient;
