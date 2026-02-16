import React from 'react';
import { calculateLiveLateMetrics, useCountdown, getGraceDeadlineMs } from '../../hooks/useCountdown';

const LiveLateFeeSummary = ({
  stage,
  dropDateTime,
  gracePeriodHours = 1,
  lateHours = 0,
  lateFee = 0,
  hourlyLateRate = 0,
  finalAmount = 0,
  advancePaid = 0,
  currency = '\u20B9',
  className = '',
  highlight = false,
}) => {
  const graceDeadlineMs = getGraceDeadlineMs(dropDateTime, gracePeriodHours);
  const countdown = useCountdown(Number.isFinite(graceDeadlineMs) ? new Date(graceDeadlineMs) : null, {
    direction: 'up',
    autoStop: false,
  });

  const liveMetrics = calculateLiveLateMetrics({
    stage,
    nowMs: countdown.nowMs,
    dropDateTime,
    gracePeriodHours,
    lateHours,
    lateFee,
    hourlyLateRate,
    finalAmount,
    advancePaid,
  });

  const shouldRender = liveMetrics.lateHours > 0 || liveMetrics.lateFee > 0 || String(stage).toLowerCase() === 'overdue';
  if (!shouldRender) return null;

  return (
    <div
      className={`rounded-lg border p-3 text-xs space-y-1 ${
        highlight ? 'border-red-300 bg-red-50/70 text-red-700' : 'border-borderColor bg-light text-gray-600'
      } ${className}`.trim()}
    >
      <p>
        Late Hours: <span className="font-semibold">{liveMetrics.lateHours}</span>
      </p>
      <p>
        Late Fee:{' '}
        <span className="font-semibold">
          {currency}
          {liveMetrics.lateFee}
        </span>
      </p>
      <p>
        Updated Remaining:{' '}
        <span className="font-semibold">
          {currency}
          {liveMetrics.remainingAmount}
        </span>
      </p>
    </div>
  );
};

export default LiveLateFeeSummary;

