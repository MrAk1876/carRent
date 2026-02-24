import React, { useEffect, useRef, useState } from 'react';
import { subscribeMessages } from '../../utils/messageBus';

const toneByType = {
  success: {
    label: 'Success',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10.2l3.1 3.1L15 6.7" />
      </svg>
    ),
  },
  error: {
    label: 'Error',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4">
        <path strokeLinecap="round" d="M6.2 6.2l7.6 7.6M13.8 6.2l-7.6 7.6" />
      </svg>
    ),
  },
  warning: {
    label: 'Warning',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 3.5l7 12.2H3l7-12.2z" />
        <path strokeLinecap="round" d="M10 7.8v4.2m0 2.2h.01" />
      </svg>
    ),
  },
  info: {
    label: 'Info',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <circle cx="10" cy="10" r="6.6" />
        <path strokeLinecap="round" d="M10 9.1v4m0-6.2h.01" />
      </svg>
    ),
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
    <div className="message-center fixed bottom-3 right-3 z-[140] flex w-[min(92vw,390px)] flex-col gap-2 pointer-events-none sm:bottom-5 sm:right-5">
      {messages.map((message) => {
        const toneType = toneByType[message.type] ? message.type : 'info';
        const tone = toneByType[toneType];
        return (
          <div
            key={message.id}
            className={`message-toast message-toast-enter message-toast--${toneType} pointer-events-auto relative overflow-hidden rounded-2xl border px-3.5 py-3 backdrop-blur`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2.5">
              <span className="message-toast__icon mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                {tone.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="message-toast__title text-[11px] font-semibold uppercase tracking-wide">{tone.label}</p>
                <p className="message-toast__text text-sm leading-snug break-words">{message.message}</p>
              </div>
              <button
                type="button"
                onClick={() => removeMessage(message.id)}
                className="message-toast__close -mt-0.5 rounded-md px-1 text-base leading-none opacity-60 hover:opacity-100"
                aria-label="Dismiss message"
              >
                x
              </button>
            </div>
            {message.duration > 0 ? (
              <span
                className="message-toast__progress pointer-events-none absolute bottom-0 left-0 h-[3px] w-full origin-left"
                style={{ animationDuration: `${Math.max(Number(message.duration) || 0, 1)}ms` }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default MessageCenter;
