import React, { useEffect, useMemo, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Box,
  Button,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AvailabilityState,
  buildCalendarDays,
  getToday,
  isInClosedRange,
  isPastDay,
  isSameDay,
  splitIntoWeeks,
  toDateKey,
} from '../utils/dateUtils';

type CalendarMode = 'single' | 'range';
type CalendarVariant = 'form' | 'availability';
type CalendarAppearance = 'default' | 'dob' | 'booking';

export type UniversalCalendarRangeValue = {
  startDate: string | null;
  endDate: string | null;
};

type UniversalCalendarValue = string | null | UniversalCalendarRangeValue;

type UniversalCalendarInputProps = {
  label?: string;
  mode?: CalendarMode;
  variant?: CalendarVariant;
  appearance?: CalendarAppearance;
  value: UniversalCalendarValue;
  onChange: (value: UniversalCalendarValue) => void;
  placeholder?: string;
  minDate?: string | null;
  maxDate?: string | null;
  disabled?: boolean;
  disablePast?: boolean;
  helperText?: string;
  availabilityMap?: Record<string, AvailabilityState | string>;
  disableUnavailable?: boolean;
  blockedStates?: AvailabilityState[];
  showLegend?: boolean;
  showStateTooltip?: boolean;
  yearRange?: { start: number; end: number };
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = Array.from({ length: 12 }, (_, monthIndex) =>
  dayjs().month(monthIndex).format('MMMM'),
);
const DEFAULT_BLOCKED_STATES: AvailabilityState[] = ['BOOKED', 'MAINTENANCE', 'BLACKOUT', 'RESERVED'];

const CalendarGlyph: React.FC<{ highlight?: boolean }> = ({ highlight = false }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="3.5"
      y="5"
      width="17"
      height="15.5"
      rx="2.4"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path d="M7.5 3.5V7.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M16.5 3.5V7.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M3.5 9.2H20.5" stroke="currentColor" strokeWidth="1.7" />
    {highlight ? <circle cx="16.8" cy="14.8" r="1.6" fill="currentColor" /> : null}
  </svg>
);

const parseDateValue = (value: string | null | undefined): Dayjs | null => {
  if (!value) return null;
  const parsed = dayjs(value).startOf('day');
  return parsed.isValid() ? parsed : null;
};

const normalizeState = (value: string | AvailabilityState | null | undefined): AvailabilityState => {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'BOOKED') return 'BOOKED';
  if (upper === 'MAINTENANCE') return 'MAINTENANCE';
  if (upper === 'BLACKOUT') return 'BLACKOUT';
  if (upper === 'RESERVED') return 'RESERVED';
  if (upper === 'AVAILABLE') return 'AVAILABLE';
  return 'UNKNOWN';
};

const formatInputText = (mode: CalendarMode, value: UniversalCalendarValue, placeholder: string) => {
  if (mode === 'single') {
    const date = parseDateValue(value as string | null);
    if (!date) return placeholder;
    return date.format('DD MMM YYYY');
  }

  const rangeValue = (value || {}) as UniversalCalendarRangeValue;
  const start = parseDateValue(rangeValue.startDate);
  const end = parseDateValue(rangeValue.endDate);
  if (!start && !end) return placeholder;
  if (start && !end) return `${start.format('DD MMM YYYY')} -`;
  if (!start && end) return `- ${end.format('DD MMM YYYY')}`;
  return `${start?.format('DD MMM YYYY')} - ${end?.format('DD MMM YYYY')}`;
};

const getStatePalette = (
  state: AvailabilityState,
  variant: CalendarVariant,
  theme: ReturnType<typeof useTheme>,
) => {
  const isDark = theme.palette.mode === 'dark';
  if (variant === 'form') {
    return {
      bg: alpha(theme.palette.background.paper, isDark ? 0.72 : 0.94),
      border: alpha(theme.palette.divider, isDark ? 0.72 : 0.86),
      text: theme.palette.text.primary,
    };
  }

  if (state === 'BOOKED') {
    return {
      bg: alpha(theme.palette.error.main, isDark ? 0.26 : 0.14),
      border: alpha(theme.palette.error.main, isDark ? 0.5 : 0.32),
      text: isDark ? theme.palette.error.light : theme.palette.error.dark,
    };
  }
  if (state === 'MAINTENANCE') {
    return {
      bg: alpha(theme.palette.grey[500], isDark ? 0.3 : 0.18),
      border: alpha(theme.palette.grey[600], isDark ? 0.55 : 0.34),
      text: isDark ? theme.palette.grey[100] : theme.palette.grey[800],
    };
  }
  if (state === 'BLACKOUT') {
    return {
      bg: isDark ? alpha(theme.palette.common.black, 0.72) : alpha(theme.palette.grey[900], 0.88),
      border: isDark ? alpha(theme.palette.grey[200], 0.35) : alpha(theme.palette.grey[900], 0.96),
      text: isDark ? theme.palette.grey[100] : theme.palette.common.white,
    };
  }
  if (state === 'RESERVED') {
    return {
      bg: alpha(theme.palette.warning.main, isDark ? 0.28 : 0.2),
      border: alpha(theme.palette.warning.main, isDark ? 0.56 : 0.42),
      text: isDark ? theme.palette.warning.light : theme.palette.warning.dark,
    };
  }
  return {
    bg: alpha(theme.palette.background.paper, isDark ? 0.72 : 0.94),
    border: alpha(theme.palette.divider, isDark ? 0.72 : 0.86),
    text: theme.palette.text.primary,
  };
};

const CalendarLegend: React.FC<{ theme: ReturnType<typeof useTheme> }> = ({ theme }) => {
  const states: AvailabilityState[] = ['AVAILABLE', 'BOOKED', 'MAINTENANCE', 'BLACKOUT', 'RESERVED'];

  return (
    <Stack direction="row" spacing={0.9} sx={{ mt: 1.4, flexWrap: 'wrap' }}>
      {states.map((state) => {
        const palette = getStatePalette(state, 'availability', theme);
        return (
          <Box
            key={state}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.6,
              fontSize: 10,
              color: 'text.secondary',
              mr: 0.2,
            }}
          >
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                backgroundColor: palette.bg,
              }}
            />
            <span>{state}</span>
          </Box>
        );
      })}
    </Stack>
  );
};

const UniversalCalendarInput: React.FC<UniversalCalendarInputProps> = ({
  label,
  mode = 'single',
  variant,
  appearance,
  value,
  onChange,
  placeholder,
  minDate = null,
  maxDate = null,
  disabled = false,
  disablePast = false,
  helperText = '',
  availabilityMap = {},
  disableUnavailable = false,
  blockedStates = DEFAULT_BLOCKED_STATES,
  showLegend,
  showStateTooltip,
  yearRange,
}) => {
  const theme = useTheme();
  const today = useMemo(() => getToday(), []);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [hoverDate, setHoverDate] = useState<Dayjs | null>(null);

  const singleValue = mode === 'single' ? parseDateValue(value as string | null) : null;
  const rangeValue = mode === 'range' ? ((value || {}) as UniversalCalendarRangeValue) : null;
  const rangeStart = mode === 'range' ? parseDateValue(rangeValue?.startDate) : null;
  const rangeEnd = mode === 'range' ? parseDateValue(rangeValue?.endDate) : null;
  const selectedReferenceDay = singleValue || rangeStart || today;

  const [viewMonth, setViewMonth] = useState<Dayjs>(selectedReferenceDay.startOf('month'));

  const minDay = parseDateValue(minDate);
  const maxDay = parseDateValue(maxDate);
  const isOpen = Boolean(anchorEl);

  const hasAvailabilityData = useMemo(
    () => Object.keys(availabilityMap || {}).length > 0,
    [availabilityMap],
  );
  const effectiveVariant: CalendarVariant =
    variant || (hasAvailabilityData || disableUnavailable ? 'availability' : 'form');
  const effectiveAppearance: CalendarAppearance =
    appearance || (effectiveVariant === 'availability' ? 'booking' : 'default');
  const effectiveShowLegend =
    showLegend ??
    (effectiveVariant === 'availability' && hasAvailabilityData && effectiveAppearance !== 'dob');
  const effectiveShowStateTooltip =
    showStateTooltip ??
    (effectiveVariant === 'availability' && effectiveAppearance !== 'dob');
  const lockDaySelectionToVisibleMonth = effectiveVariant === 'form' && mode === 'single';
  const triggerBorderRadius = effectiveVariant === 'form' ? '8px' : '12px';
  const triggerIconRadius = effectiveVariant === 'form' ? '6px' : '8px';
  const formBorderColor = 'var(--color-borderColor)';
  const triggerBorderColor = effectiveVariant === 'form' ? formBorderColor : alpha(theme.palette.divider, 0.9);
  const triggerBackground =
    effectiveVariant === 'form'
      ? theme.palette.background.paper
      : `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 1)}, ${alpha(theme.palette.background.default, 0.86)})`;
  const triggerHoverBorderColor =
    effectiveVariant === 'form' ? alpha(theme.palette.primary.main, 0.35) : alpha(theme.palette.primary.main, 0.5);
  const triggerHoverShadow =
    effectiveVariant === 'form'
      ? `0 8px 14px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.2 : 0.05)}`
      : `0 12px 22px ${alpha(theme.palette.common.black, 0.08)}`;
  const triggerIconBorderColor =
    effectiveVariant === 'form' ? alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.9 : 0.72) : alpha(theme.palette.divider, 0.75);

  const displayText = formatInputText(
    mode,
    value,
    placeholder || (mode === 'range' ? 'Select date range' : 'Select date'),
  );
  const hasSelection = mode === 'single' ? Boolean(singleValue) : Boolean(rangeStart || rangeEnd);

  const monthDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);
  const weeks = useMemo(() => splitIntoWeeks(monthDays), [monthDays]);

  useEffect(() => {
    if (!isOpen) return;
    const nextBase = (singleValue || rangeStart || today).startOf('month');
    setViewMonth(nextBase);
  }, [isOpen, rangeStart, singleValue, today]);

  const yearBounds = useMemo(() => {
    const minYear = yearRange?.start || minDay?.year() || today.year() - 100;
    const maxYear = yearRange?.end || maxDay?.year() || today.year() + 20;
    return {
      start: Math.min(minYear, maxYear),
      end: Math.max(minYear, maxYear),
    };
  }, [maxDay, minDay, today, yearRange?.end, yearRange?.start]);

  const yearOptions = useMemo(() => {
    const options: number[] = [];
    for (let year = yearBounds.start; year <= yearBounds.end; year += 1) {
      options.push(year);
    }
    return options;
  }, [yearBounds.end, yearBounds.start]);

  const previewRangeEnd = useMemo(() => {
    if (mode !== 'range') return null;
    if (!rangeStart || rangeEnd || !hoverDate) return null;
    return hoverDate.isBefore(rangeStart, 'day') ? null : hoverDate;
  }, [hoverDate, mode, rangeEnd, rangeStart]);

  const isDateDisabled = (date: Dayjs): boolean => {
    if (disablePast && isPastDay(date, today)) return true;
    if (minDay && date.isBefore(minDay, 'day')) return true;
    if (maxDay && date.isAfter(maxDay, 'day')) return true;
    if (!disableUnavailable) return false;
    const state = normalizeState(availabilityMap[toDateKey(date)]);
    return blockedStates.includes(state);
  };

  const clearSelection = () => {
    if (mode === 'single') {
      onChange(null);
    } else {
      onChange({ startDate: null, endDate: null });
    }
    setHoverDate(null);
  };

  const handleDayClick = (date: Dayjs) => {
    if (isDateDisabled(date)) return;
    const dateKey = toDateKey(date);

    if (mode === 'single') {
      onChange(dateKey);
      setAnchorEl(null);
      setHoverDate(null);
      return;
    }

    if (!rangeStart || (rangeStart && rangeEnd)) {
      onChange({ startDate: dateKey, endDate: null });
      return;
    }

    if (date.isBefore(rangeStart, 'day')) {
      onChange({ startDate: dateKey, endDate: null });
      return;
    }

    onChange({ startDate: toDateKey(rangeStart), endDate: dateKey });
    setAnchorEl(null);
    setHoverDate(null);
  };

  const isDayInRange = (date: Dayjs) => {
    if (mode !== 'range' || !rangeStart) return false;
    const effectiveEnd = rangeEnd || previewRangeEnd;
    if (!effectiveEnd) return false;
    return isInClosedRange(date, rangeStart, effectiveEnd);
  };

  const resolveDayStyle = (date: Dayjs) => {
    const rawState = normalizeState(availabilityMap[toDateKey(date)]);
    const state = effectiveVariant === 'availability' ? rawState : 'AVAILABLE';
    const palette = getStatePalette(state, effectiveVariant, theme);
    const outsideMonth = !date.isSame(viewMonth, 'month');
    const isToday = isSameDay(date, today);
    const selectedSingle = mode === 'single' && singleValue && isSameDay(date, singleValue);
    const selectedRangeStart = mode === 'range' && rangeStart && isSameDay(date, rangeStart);
    const selectedRangeEnd = mode === 'range' && rangeEnd && isSameDay(date, rangeEnd);
    const inRange = isDayInRange(date);
    const dayDisabled = isDateDisabled(date);

    if (selectedSingle || selectedRangeStart || selectedRangeEnd) {
      return {
        state,
        isToday,
        dayDisabled,
        outsideMonth,
        backgroundColor: theme.palette.primary.main,
        borderColor: theme.palette.primary.dark,
        color: theme.palette.primary.contrastText,
        dotColor: theme.palette.info.light,
      };
    }

    return {
      state,
      isToday,
      dayDisabled,
      outsideMonth,
      backgroundColor: inRange ? alpha(theme.palette.primary.main, 0.12) : palette.bg,
      borderColor: inRange ? alpha(theme.palette.primary.main, 0.3) : palette.border,
      color: outsideMonth ? alpha(palette.text, 0.45) : palette.text,
      dotColor: theme.palette.info.main,
    };
  };

  return (
    <Box sx={{ width: '100%' }}>
      {label ? (
        <Typography sx={{ mb: 0.7, fontSize: 12, fontWeight: 600, color: 'text.secondary', letterSpacing: '0.02em' }}>
          {label}
        </Typography>
      ) : null}

      <Box
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) return;
          setAnchorEl(event.currentTarget as HTMLElement);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setAnchorEl(event.currentTarget as HTMLElement);
          }
        }}
        sx={{
          width: '100%',
          minHeight: 44,
          borderRadius: triggerBorderRadius,
          border: `1px solid ${isOpen ? triggerHoverBorderColor : triggerBorderColor}`,
          background:
            disabled
              ? alpha(theme.palette.action.disabledBackground, 0.55)
              : triggerBackground,
          px: 1.4,
          py: 1.05,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'all 140ms ease',
          '&:hover': disabled
            ? undefined
            : {
                boxShadow: triggerHoverShadow,
                borderColor: triggerHoverBorderColor,
              },
        }}
      >
        <Typography sx={{ fontSize: 13, color: hasSelection ? 'text.primary' : 'text.secondary', fontWeight: 500 }}>
          {displayText}
        </Typography>
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: triggerIconRadius,
            border: `1px solid ${triggerIconBorderColor}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            fontSize: 11,
            backgroundColor: alpha(theme.palette.background.paper, 0.9),
          }}
        >
          <CalendarGlyph highlight={mode === 'range'} />
        </Box>
      </Box>

      {helperText ? (
        <Typography sx={{ mt: 0.6, fontSize: 11, color: 'text.secondary' }}>{helperText}</Typography>
      ) : null}

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={() => {
          setAnchorEl(null);
          setHoverDate(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{
          sx: {
            mt: 1,
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.divider, 0.88)}`,
            boxShadow: `0 22px 38px ${alpha(theme.palette.common.black, 0.16)}`,
            overflow: 'hidden',
            background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 1)}, ${alpha(theme.palette.background.default, 0.98)})`,
          },
        }}
      >
        <Box sx={{ p: 1.6, width: effectiveAppearance === 'dob' ? 326 : 338 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.2 }}>
            <IconButton
              size="small"
              onClick={() => setViewMonth((previous) => previous.subtract(1, 'month'))}
              sx={{
                borderRadius: 1.8,
                border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
              }}
            >
              <Typography sx={{ fontSize: 12 }}>{'<'}</Typography>
            </IconButton>

            <Stack
              direction="row"
              spacing={0.8}
              sx={{
                flexDirection: effectiveAppearance === 'dob' ? 'row-reverse' : 'row',
              }}
            >
              <Box
                component="select"
                value={String(viewMonth.month())}
                onChange={(event) => {
                  const nextMonth = Number(event.target.value);
                  if (!Number.isFinite(nextMonth)) return;
                  setViewMonth((previous) => previous.month(nextMonth).startOf('month'));
                }}
                sx={{
                  height: 30,
                  borderRadius: 1.5,
                  border: `1px solid ${alpha(theme.palette.divider, 0.85)}`,
                  backgroundColor: alpha(theme.palette.background.paper, 0.96),
                  px: 1.1,
                  fontSize: 12,
                  color: 'text.primary',
                }}
              >
                {MONTH_LABELS.map((monthLabel, monthIndex) => (
                  <option key={monthLabel} value={monthIndex}>
                    {monthLabel}
                  </option>
                ))}
              </Box>

              <Box
                component="select"
                value={String(viewMonth.year())}
                onChange={(event) => {
                  const nextYear = Number(event.target.value);
                  if (!Number.isFinite(nextYear)) return;
                  setViewMonth((previous) => previous.year(nextYear).startOf('month'));
                }}
                sx={{
                  height: 30,
                  minWidth: 86,
                  borderRadius: 1.5,
                  border: `1px solid ${alpha(theme.palette.divider, 0.85)}`,
                  backgroundColor: alpha(theme.palette.background.paper, 0.96),
                  px: 1.1,
                  fontSize: 12,
                  color: 'text.primary',
                }}
              >
                {yearOptions.map((yearValue) => (
                  <option key={yearValue} value={yearValue}>
                    {yearValue}
                  </option>
                ))}
              </Box>
            </Stack>

            <IconButton
              size="small"
              onClick={() => setViewMonth((previous) => previous.add(1, 'month'))}
              sx={{
                borderRadius: 1.8,
                border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
              }}
            >
              <Typography sx={{ fontSize: 12 }}>{'>'}</Typography>
            </IconButton>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.6 }}>
            {WEEKDAY_LABELS.map((dayLabel) => (
              <Typography
                key={dayLabel}
                sx={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'text.secondary', py: 0.5 }}
              >
                {dayLabel}
              </Typography>
            ))}
          </Box>

          <Stack spacing={0.6} sx={{ mt: 0.6 }}>
            {weeks.map((week, weekIndex) => (
              <Box key={`week-${weekIndex}`} sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.6 }}>
                {week.map((day) => {
                  const dayKey = toDateKey(day);
                  const dayStyle = resolveDayStyle(day);
                  const isDisabled =
                    dayStyle.dayDisabled || (lockDaySelectionToVisibleMonth && dayStyle.outsideMonth);
                  const dayContent = (
                    <Box
                      onMouseEnter={() => {
                        if (mode === 'range' && rangeStart && !rangeEnd) {
                          setHoverDate(day);
                        }
                      }}
                      onMouseLeave={() => {
                        if (mode === 'range' && !rangeEnd) {
                          setHoverDate(null);
                        }
                      }}
                      onClick={() => {
                        if (isDisabled) return;
                        handleDayClick(day);
                      }}
                      sx={{
                        position: 'relative',
                        height: effectiveAppearance === 'dob' ? 34 : 36,
                        borderRadius: 2,
                        border: `1px solid ${dayStyle.borderColor}`,
                        backgroundColor: dayStyle.backgroundColor,
                        color: dayStyle.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 600,
                        userSelect: 'none',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        opacity: isDisabled ? 0.42 : 1,
                        transition: 'all 140ms ease',
                        '&:hover': isDisabled
                          ? undefined
                          : {
                              transform: 'translateY(-1px)',
                              boxShadow: `0 8px 16px ${alpha(theme.palette.common.black, 0.12)}`,
                              borderColor: alpha(theme.palette.primary.main, 0.45),
                            },
                        '&::after': dayStyle.isToday
                          ? {
                              content: '""',
                              position: 'absolute',
                              width: 5,
                              height: 5,
                              borderRadius: 999,
                              backgroundColor: dayStyle.dotColor,
                              bottom: 4,
                            }
                          : undefined,
                      }}
                    >
                      {day.date()}
                    </Box>
                  );

                  if (!effectiveShowStateTooltip) {
                    return <Box key={dayKey}>{dayContent}</Box>;
                  }

                  return (
                    <Tooltip
                      key={dayKey}
                      arrow
                      title={
                        <Box>
                          <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{day.format('DD MMM YYYY')}</Typography>
                          <Typography sx={{ fontSize: 11 }}>{`State: ${dayStyle.state}`}</Typography>
                        </Box>
                      }
                    >
                      <Box>{dayContent}</Box>
                    </Tooltip>
                  );
                })}
              </Box>
            ))}
          </Stack>

          {effectiveShowLegend ? <CalendarLegend theme={theme} /> : null}

          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.6 }}>
            <Button
              size="small"
              variant="text"
              onClick={clearSelection}
              sx={{ textTransform: 'none', fontSize: 12, minWidth: 64 }}
            >
              Clear
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => handleDayClick(today)}
              disabled={isDateDisabled(today)}
              sx={{ textTransform: 'none', fontSize: 12, borderRadius: 1.6 }}
            >
              Today
            </Button>
          </Stack>
        </Box>
      </Popover>
    </Box>
  );
};

export default UniversalCalendarInput;
