import React, { useMemo } from 'react';
import { getGraceDeadlineMs, useCountdown } from '../../hooks/useCountdown';

const normalizeStage = (value) => String(value || '').trim().toLowerCase();

const resolveCountdownConfig = (stage, pickupDateTime, dropDateTime, gracePeriodHours = 1) => {
  const normalizedStage = normalizeStage(stage);
  const graceDeadlineMs = getGraceDeadlineMs(dropDateTime, gracePeriodHours);
  const graceDeadline = Number.isFinite(graceDeadlineMs) ? new Date(graceDeadlineMs) : null;

  if (normalizedStage === 'scheduled') {
    return {
      label: 'Pickup starts in:',
      targetDateTime: pickupDateTime || null,
      direction: 'down',
      fallback: 'Pickup schedule unavailable',
    };
  }

  if (normalizedStage === 'active') {
    return {
      label: 'Return deadline in:',
      targetDateTime: graceDeadline,
      direction: 'down',
      fallback: 'Return deadline unavailable',
    };
  }

  if (normalizedStage === 'overdue') {
    return {
      label: 'Overdue by:',
      targetDateTime: graceDeadline,
      direction: 'up',
      fallback: 'Overdue duration unavailable',
    };
  }

  if (normalizedStage === 'completed') {
    return {
      label: 'Rental completed',
      targetDateTime: null,
      direction: 'down',
      fallback: 'Rental completed',
    };
  }

  return {
    label: 'Rental stage unavailable',
    targetDateTime: null,
    direction: 'down',
    fallback: 'Rental stage unavailable',
  };
};

const LiveStageCountdown = ({
  stage,
  pickupDateTime,
  dropDateTime,
  gracePeriodHours = 1,
  className = '',
}) => {
  const config = useMemo(
    () => resolveCountdownConfig(stage, pickupDateTime, dropDateTime, gracePeriodHours),
    [stage, pickupDateTime, dropDateTime, gracePeriodHours],
  );

  const countdown = useCountdown(config.targetDateTime, {
    direction: config.direction === 'up' ? 'up' : 'down',
    autoStop: config.direction !== 'up',
  });

  if (!config.targetDateTime) {
    return <p className={className}>{config.fallback}</p>;
  }

  if (!countdown.hasTarget) {
    return <p className={className}>{config.fallback}</p>;
  }

  const countdownValue = countdown.isComplete && config.direction === 'down' ? '00h 00m 00s' : countdown.formatted;

  return (
    <p className={className}>
      <span className="font-medium">{config.label}</span> {countdownValue}
    </p>
  );
};

export default LiveStageCountdown;

