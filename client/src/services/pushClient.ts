import API from '../api';

const SERVICE_WORKER_PATH = '/service-worker.js';
const VAPID_PUBLIC_KEY = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();

let initializationPromise: Promise<void> | null = null;

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const normalized = String(base64String || '').trim();
  if (!normalized) return new Uint8Array();

  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const base64 = (normalized + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const canUsePushNotifications = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

const registerServiceWorker = async () => {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing && String(existing.active?.scriptURL || existing.installing?.scriptURL || '').includes(SERVICE_WORKER_PATH)) {
    return existing;
  }
  return navigator.serviceWorker.register(SERVICE_WORKER_PATH);
};

const requestBrowserPermission = async () => {
  if (!canUsePushNotifications()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
};

const postSubscriptionToBackend = async (subscription: PushSubscription) => {
  await API.post(
    '/notifications/subscribe',
    {
      subscription: subscription.toJSON(),
    },
    { showErrorToast: false },
  );
};

const subscribeToPush = async () => {
  if (!canUsePushNotifications()) return;
  if (!VAPID_PUBLIC_KEY) return;

  await registerServiceWorker();
  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  if (subscription) {
    await postSubscriptionToBackend(subscription);
  }
};

export const initPushClient = async () => {
  if (!canUsePushNotifications()) return;
  const token = String(localStorage.getItem('token') || '').trim();
  if (!token) return;
  if (!VAPID_PUBLIC_KEY) return;

  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      const permission = await requestBrowserPermission();
      if (permission !== 'granted') return;
      await subscribeToPush();
    } catch (error) {
      console.error('push client init failed:', error);
    }
  })().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
};

export const requestPushPermissionAndSubscribe = async () => {
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, permission: 'missing-vapid-key' };
  }
  const permission = await requestBrowserPermission();
  if (permission !== 'granted') {
    return { ok: false, permission };
  }

  await subscribeToPush();
  return { ok: true, permission };
};
