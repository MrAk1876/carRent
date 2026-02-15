import React, { useEffect, useRef, useState } from 'react';
import { subscribeMessages } from '../../utils/messageBus';

const toneByType = {
  success: {
    card: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    badge: 'bg-emerald-600',
    label: 'Success',
  },
  error: {
    card: 'border-red-200 bg-red-50 text-red-900',
    badge: 'bg-red-600',
    label: 'Error',
  },
  warning: {
    card: 'border-amber-200 bg-amber-50 text-amber-900',
    badge: 'bg-amber-600',
    label: 'Warning',
  },
  info: {
    card: 'border-blue-200 bg-blue-50 text-blue-900',
    badge: 'bg-blue-600',
    label: 'Info',
  },
};

const MessageCenter = () => {
  const [messages, setMessages] = useState([]);
  const timersRef = useRef(new Map());

  const removeMessage = (id) => {
    setMessages((prev) => prev.filter((message) => message.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  };

  useEffect(() => {
    const timers = timersRef.current;
    const removeMessageById = (id) => {
      setMessages((prev) => prev.filter((message) => message.id !== id));
      const timer = timers.get(id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(id);
      }
    };

    const unsubscribe = subscribeMessages((message) => {
      setMessages((prev) => [...prev, message]);

      if (message.duration > 0) {
        const timer = setTimeout(() => {
          removeMessageById(message.id);
        }, message.duration);
        timers.set(message.id, timer);
      }
    });

    return () => {
      unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="fixed right-3 top-3 z-120 flex w-[min(92vw,390px)] flex-col gap-2">
      {messages.map((message) => {
        const tone = toneByType[message.type] || toneByType.info;
        return (
          <div
            key={message.id}
            className={`message-toast-enter pointer-events-auto rounded-xl border px-3 py-2 shadow-[0_14px_30px_rgba(15,23,42,0.16)] backdrop-blur ${tone.card}`}
          >
            <div className="flex items-start gap-2">
              <span className={`mt-1 h-2.5 w-2.5 rounded-full ${tone.badge}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{tone.label}</p>
                <p className="text-sm leading-snug wrap-break-word">{message.message}</p>
              </div>
              <button
                type="button"
                onClick={() => removeMessage(message.id)}
                className="rounded-md px-1 text-base leading-none opacity-55 hover:opacity-100"
                aria-label="Dismiss message"
              >
                x
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MessageCenter;
