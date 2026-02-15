import React from 'react';

const InlineSpinner = ({ className = '', size = 'md' }) => {
  const sizeClass = size === 'sm' ? 'h-4 w-4 border-2' : size === 'lg' ? 'h-10 w-10 border-4' : 'h-6 w-6 border-[3px]';

  return (
    <span
      className={`inline-block animate-spin rounded-full border-gray-300 border-t-primary ${sizeClass} ${className}`}
      aria-label="loading"
    />
  );
};

export default InlineSpinner;
