import { useEffect, useMemo, useState } from 'react';

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const listeners = new Set();
let tickerId = null;

const startTicker = () => {
  if (tickerId) return;

  tickerId = window.setInterval(() => {
    const nowMs = Date.now();
    listeners.forEach((listener) => listener(nowMs));
  }, ONE_SECOND_MS);
};

const stopTickerIfIdle = () => {
  if (tickerId && listeners.size === 0) {
    window.clearInterval(tickerId);
    tickerId = null;
  }
};

const subscribeToTicker = (listener) => {
  if (typeof listener !== 'function') return () => {};

  listeners.add(listener);
  startTicker();

  return () => {
    listeners.delete(listener);
    stopTickerIfIdle();
  };
};

export const toTimestamp = (value) => {
  if (!value) return Number.NaN;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Number.NaN;
  return parsed.getTime();
};

export const getDurationParts = (durationMs) => {
  const safeMs = Math.max(Number(durationMs || 0), 0);
  const totalSeconds = Math.floor(safeMs / ONE_SECOND_MS);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;

  return {
    days,
    hours,
    minutes,
    seconds,
    totalSeconds,
    totalMilliseconds: safeMs,
  };
};

export const formatDurationParts = (parts = {}) => {
  const days = Math.max(Number(parts.days || 0), 0);
  const hours = Math.max(Number(parts.hours || 0), 0);
  const minutes = Math.max(Number(parts.minutes || 0), 0);
  const seconds = Math.max(Number(parts.seconds || 0), 0);
  const values = [];

  if (days > 0) values.push(`${days}d`);
  values.push(`${String(hours).padStart(2, '0')}h`);
  values.push(`${String(minutes).padStart(2, '0')}m`);
  values.push(`${String(seconds).padStart(2, '0')}s`);

  return values.join(' ');
};

export const getGraceDeadlineMs = (dropDateTime, gracePeriodHours = 1) => {
  const dropTimestamp = toTimestamp(dropDateTime);
  if (!Number.isFinite(dropTimestamp)) return Number.NaN;

  const safeGraceHours = Number.isFinite(Number(gracePeriodHours))
    ? Math.max(Number(gracePeriodHours), 0)
    : 1;

  return dropTimestamp + safeGraceHours * ONE_HOUR_MS;
};

export const calculateLiveLateMetrics = (params = {}) => {
  const {
    stage = '',
    nowMs = Date.now(),
    dropDateTime,
    gracePeriodHours = 1,
    lateHours = 0,
    lateFee = 0,
    hourlyLateRate = 0,
    finalAmount = 0,
    advancePaid = 0,
  } = params;

  const normalizedStage = String(stage || '').trim().toLowerCase();
  const storedLateHours = Math.max(Math.floor(Number(lateHours || 0)), 0);
  const storedLateFee = Math.max(Number(lateFee || 0), 0);
  const safeHourlyLateRate = Math.max(Number(hourlyLateRate || 0), 0);
  const safeFinalAmount = Math.max(Number(finalAmount || 0), 0);
  const safeAdvancePaid = Math.max(Number(advancePaid || 0), 0);

  let computedLateHours = storedLateHours;
  if (normalizedStage === 'overdue') {
    const deadlineMs = getGraceDeadlineMs(dropDateTime, gracePeriodHours);
    if (Number.isFinite(deadlineMs)) {
      const overdueMs = Math.max(nowMs - deadlineMs, 0);
      const overdueHours = overdueMs > 0 ? Math.ceil(overdueMs / ONE_HOUR_MS) : 0;
      computedLateHours = Math.max(storedLateHours, overdueHours);
    }
  }

  const computedLateFee = Number((computedLateHours * safeHourlyLateRate).toFixed(2));
  const liveLateFee = Math.max(storedLateFee, computedLateFee);
  const liveRemainingAmount = Number((Math.max(safeFinalAmount - safeAdvancePaid, 0) + liveLateFee).toFixed(2));

  return {
    lateHours: computedLateHours,
    lateFee: liveLateFee,
    remainingAmount: liveRemainingAmount,
  };
};

export const useCountdown = (targetDateTime, options = {}) => {
  const { direction = 'down', autoStop = direction === 'down' } = options;
  const targetMs = useMemo(() => toTimestamp(targetDateTime), [targetDateTime]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(targetMs)) {
      setIsRunning(false);
      return undefined;
    }

    const initialNow = Date.now();
    setNowMs(initialNow);

    if (direction === 'down' && autoStop && initialNow >= targetMs) {
      setIsRunning(false);
      return undefined;
    }

    let unsubscribe = null;

    const handleTick = (nextNowMs) => {
      if (direction === 'down' && autoStop && nextNowMs >= targetMs) {
        setNowMs(targetMs);
        setIsRunning(false);
        if (unsubscribe) {
          const cleanup = unsubscribe;
          unsubscribe = null;
          cleanup();
        }
        return;
      }

      setNowMs(nextNowMs);
      setIsRunning(true);
    };

    unsubscribe = subscribeToTicker(handleTick);

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [targetMs, direction, autoStop]);

  const rawDeltaMs = useMemo(() => {
    if (!Number.isFinite(targetMs)) return 0;
    return direction === 'up' ? nowMs - targetMs : targetMs - nowMs;
  }, [targetMs, nowMs, direction]);

  const clampedDeltaMs = Math.max(rawDeltaMs, 0);
  const parts = useMemo(() => getDurationParts(clampedDeltaMs), [clampedDeltaMs]);
  const isComplete = Boolean(direction === 'down' && Number.isFinite(targetMs) && rawDeltaMs <= 0);

  return {
    ...parts,
    targetMs,
    nowMs,
    hasTarget: Number.isFinite(targetMs),
    isComplete,
    isRunning: isRunning && !isComplete,
    formatted: formatDurationParts(parts),
  };
};
