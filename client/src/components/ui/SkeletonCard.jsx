import React from 'react';

const SkeletonCard = () => {
  return (
    <div className="rounded-2xl border border-borderColor bg-white p-4 shadow-sm animate-pulse">
      <div className="h-44 rounded-xl bg-slate-200" />
      <div className="mt-4 h-5 w-2/3 bg-slate-200 rounded" />
      <div className="mt-2 h-4 w-1/2 bg-slate-200 rounded" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="h-4 bg-slate-200 rounded" />
        <div className="h-4 bg-slate-200 rounded" />
        <div className="h-4 bg-slate-200 rounded" />
        <div className="h-4 bg-slate-200 rounded" />
      </div>
    </div>
  );
};

export default SkeletonCard;
