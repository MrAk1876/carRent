import React from 'react';

const ToastAlert = ({ show, type = 'success', message = '' }) => {
  if (!show || !message) return null;

  const toneClass =
    type === 'error' ? 'bg-red-600 text-white' : type === 'warning' ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white';

  return (
    <div className="fixed top-5 right-5 z-1000">
      <div className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${toneClass}`}>{message}</div>
    </div>
  );
};

export default ToastAlert;
