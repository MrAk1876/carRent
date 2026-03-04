import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Grow,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import API, { getErrorMessage } from '../api';
import UniversalCalendarInput, { UniversalCalendarRangeValue } from './UniversalCalendarInput';
import { AvailabilityState, toDateKey } from '../utils/dateUtils';

type AvailabilityResponsePayload = {
  from?: string;
  to?: string;
  timeline?: Array<{ date?: string; state?: string }>;
  booked?: string[];
  maintenance?: string[];
  blackout?: string[];
  reserved?: string[];
  bookedDates?: string[];
  maintenanceDates?: string[];
  blackoutDates?: string[];
  reservedDates?: string[];
  unavailableDates?: {
    booked?: string[];
    maintenance?: string[];
    blackout?: string[];
    reserved?: string[];
  };
};

type CarAvailabilityModalProps = {
  open: boolean;
  carId: string | null;
  carLabel?: string;
  onClose: () => void;
  defaultRangeDays?: number;
};

const STATE_PRIORITY: Record<AvailabilityState, number> = {
  AVAILABLE: 0,
  RESERVED: 1,
  BLACKOUT: 2,
  MAINTENANCE: 3,
  BOOKED: 4,
  UNKNOWN: -1,
};

const normalizeState = (value: string | null | undefined): AvailabilityState => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'BOOKED') return 'BOOKED';
  if (normalized === 'MAINTENANCE') return 'MAINTENANCE';
  if (normalized === 'BLACKOUT') return 'BLACKOUT';
  if (normalized === 'RESERVED') return 'RESERVED';
  return 'AVAILABLE';
};

const createDateKeys = (fromDate: string, toDate: string): string[] => {
  const start = dayjs(fromDate).startOf('day');
  const end = dayjs(toDate).startOf('day');
  if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) return [];

  const keys: string[] = [];
  let cursor = start;
  while (cursor.isBefore(end, 'day') || cursor.isSame(end, 'day')) {
    keys.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }
  return keys;
};

const getStatePalette = (state: AvailabilityState, theme: ReturnType<typeof useTheme>) => {
  const isDark = theme.palette.mode === 'dark';
  if (state === 'BOOKED') {
    return {
      bg: alpha(theme.palette.error.main, isDark ? 0.24 : 0.1),
      border: alpha(theme.palette.error.main, isDark ? 0.5 : 0.26),
      text: isDark ? theme.palette.error.light : theme.palette.error.dark,
    };
  }
  if (state === 'MAINTENANCE') {
    return {
      bg: alpha(theme.palette.grey[500], isDark ? 0.3 : 0.14),
      border: alpha(theme.palette.grey[600], isDark ? 0.56 : 0.28),
      text: isDark ? theme.palette.grey[100] : theme.palette.grey[900],
    };
  }
  if (state === 'BLACKOUT') {
    return {
      bg: isDark ? alpha(theme.palette.common.black, 0.72) : alpha(theme.palette.grey[900], 0.86),
      border: isDark ? alpha(theme.palette.grey[200], 0.36) : alpha(theme.palette.grey[900], 0.7),
      text: isDark ? theme.palette.grey[100] : theme.palette.common.white,
    };
  }
  if (state === 'RESERVED') {
    return {
      bg: alpha(theme.palette.warning.main, isDark ? 0.28 : 0.14),
      border: alpha(theme.palette.warning.main, isDark ? 0.56 : 0.3),
      text: isDark ? theme.palette.warning.light : theme.palette.warning.dark,
    };
  }
  return {
    bg: alpha(theme.palette.success.main, isDark ? 0.24 : 0.08),
    border: alpha(theme.palette.success.main, isDark ? 0.5 : 0.22),
    text: isDark ? theme.palette.success.light : theme.palette.success.dark,
  };
};

const STATE_ORDER: AvailabilityState[] = ['AVAILABLE', 'BOOKED', 'MAINTENANCE', 'BLACKOUT', 'RESERVED'];
const STATE_CODE: Record<AvailabilityState, string> = {
  AVAILABLE: 'AV',
  BOOKED: 'BK',
  MAINTENANCE: 'MT',
  BLACKOUT: 'BO',
  RESERVED: 'RS',
  UNKNOWN: '--',
};
const QUICK_RANGE_OPTIONS = [7, 30, 60, 90];

const CarAvailabilityModal: React.FC<CarAvailabilityModalProps> = ({
  open,
  carId,
  carLabel = 'Selected Car',
  onClose,
  defaultRangeDays = 30,
}) => {
  const theme = useTheme();
  const todayKey = toDateKey(new Date());

  const [range, setRange] = useState<UniversalCalendarRangeValue>({
    startDate: dayjs().startOf('day').format('YYYY-MM-DD'),
    endDate: dayjs().startOf('day').add(Math.max(defaultRangeDays, 1), 'day').format('YYYY-MM-DD'),
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [payload, setPayload] = useState<AvailabilityResponsePayload | null>(null);
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  useEffect(() => {
    if (!open) return;
    const start = dayjs().startOf('day');
    const end = start.add(Math.max(defaultRangeDays, 1), 'day');
    setRange({
      startDate: start.format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
    });
    setError('');
    setPayload(null);
  }, [carId, defaultRangeDays, open]);

  const fromDate = String(range.startDate || '').trim();
  const toDate = String(range.endDate || '').trim();

  const loadAvailability = useCallback(async () => {
    if (!open || !carId || !fromDate || !toDate) return;
    if (dayjs(fromDate).isAfter(dayjs(toDate), 'day')) {
      setError('Start date cannot be after end date.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const response = await API.get(`/admin/cars/${carId}/availability`, {
        params: { from: fromDate, to: toDate },
        showErrorToast: false,
        dedupe: false,
      });
      const data = (response.data || null) as AvailabilityResponsePayload | null;
      setPayload(data);
    } catch (apiError) {
      setPayload(null);
      setError(getErrorMessage(apiError, 'Failed to load car availability.'));
    } finally {
      setLoading(false);
    }
  }, [carId, fromDate, open, toDate]);

  useEffect(() => {
    if (!open || !carId) return;
    loadAvailability();
  }, [open, carId, fromDate, toDate, refreshNonce, loadAvailability]);

  const dateKeys = useMemo(() => createDateKeys(fromDate, toDate), [fromDate, toDate]);

  const timelineByDate = useMemo(() => {
    const map: Record<string, AvailabilityState> = {};
    const dateSet = new Set(dateKeys);

    for (const dateKey of dateKeys) {
      map[dateKey] = 'AVAILABLE';
    }

    const applyState = (dateKey: string, nextStateRaw: string | null | undefined) => {
      const normalizedDate = String(dateKey || '').trim();
      if (!dateSet.has(normalizedDate)) return;
      const nextState = normalizeState(nextStateRaw);
      const currentState = map[normalizedDate] || 'AVAILABLE';
      if ((STATE_PRIORITY[nextState] || 0) >= (STATE_PRIORITY[currentState] || 0)) {
        map[normalizedDate] = nextState;
      }
    };

    const timelineCandidates = [
      payload?.timeline,
      (payload as { dailyAvailability?: Array<{ date?: string; state?: string }> } | null)?.dailyAvailability,
      (payload as { availability?: Array<{ date?: string; state?: string }> } | null)?.availability,
    ];

    for (const candidate of timelineCandidates) {
      if (!Array.isArray(candidate)) continue;
      for (const entry of candidate) {
        applyState(String(entry?.date || '').trim(), entry?.state || 'AVAILABLE');
      }
    }

    const assignList = (dates: string[] | undefined, state: AvailabilityState) => {
      if (!Array.isArray(dates)) return;
      for (const date of dates) {
        applyState(String(date || '').trim(), state);
      }
    };

    assignList(payload?.booked, 'BOOKED');
    assignList(payload?.maintenance, 'MAINTENANCE');
    assignList(payload?.blackout, 'BLACKOUT');
    assignList(payload?.reserved, 'RESERVED');
    assignList(payload?.bookedDates, 'BOOKED');
    assignList(payload?.maintenanceDates, 'MAINTENANCE');
    assignList(payload?.blackoutDates, 'BLACKOUT');
    assignList(payload?.reservedDates, 'RESERVED');

    assignList(payload?.unavailableDates?.booked, 'BOOKED');
    assignList(payload?.unavailableDates?.maintenance, 'MAINTENANCE');
    assignList(payload?.unavailableDates?.blackout, 'BLACKOUT');
    assignList(payload?.unavailableDates?.reserved, 'RESERVED');

    return map;
  }, [dateKeys, payload]);

  const selectedRangeDays = useMemo(() => {
    if (!fromDate || !toDate) return null;
    const start = dayjs(fromDate).startOf('day');
    const end = dayjs(toDate).startOf('day');
    if (!start.isValid() || !end.isValid()) return null;
    return end.diff(start, 'day');
  }, [fromDate, toDate]);
  const stateCounts = useMemo(() => {
    const counts: Record<AvailabilityState, number> = {
      AVAILABLE: 0,
      BOOKED: 0,
      MAINTENANCE: 0,
      BLACKOUT: 0,
      RESERVED: 0,
      UNKNOWN: 0,
    };

    for (const dateKey of dateKeys) {
      const state = timelineByDate[dateKey] || 'AVAILABLE';
      counts[state] = (counts[state] || 0) + 1;
    }

    return counts;
  }, [dateKeys, timelineByDate]);
  const blockedDaysCount = useMemo(
    () =>
      (stateCounts.BOOKED || 0) +
      (stateCounts.MAINTENANCE || 0) +
      (stateCounts.BLACKOUT || 0) +
      (stateCounts.RESERVED || 0),
    [stateCounts],
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      TransitionComponent={Grow}
      slotProps={{
        backdrop: {
          className: 'modal-backdrop-enter',
          transitionDuration: { enter: 220, exit: 160 },
          sx: {
            backgroundColor: alpha(theme.palette.common.black, 0.32),
            backdropFilter: 'blur(2.6px)',
          },
        },
      }}
      TransitionProps={{
        timeout: { enter: 320, exit: 190 },
      }}
      PaperProps={{
        className: 'modal-panel-enter',
        sx: {
          width: { xs: 'calc(100% - 12px)', sm: 'calc(100% - 32px)', lg: 1120 },
          maxWidth: 1120,
          borderRadius: 3.4,
          overflow: 'hidden',
          border: `1px solid ${alpha(theme.palette.common.white, 0.42)}`,
          boxShadow: `0 30px 70px ${alpha(theme.palette.common.black, 0.3)}`,
          background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 1)}, ${alpha(theme.palette.background.default, 0.95)})`,
          transformOrigin: '50% 16%',
          transition: 'box-shadow 220ms ease',
        },
      }}
    >
      <DialogTitle
        sx={{
          px: 2.2,
          py: 1.6,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.48)}`,
          background: `linear-gradient(160deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.background.paper, 0.98)})`,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', letterSpacing: '0.01em' }}>
              Car Availability
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.3 }}>
              {carLabel} | Date-wise operational timeline
            </Typography>
          </Box>
          <IconButton
            onClick={onClose}
            size="small"
            sx={{
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
              backgroundColor: alpha(theme.palette.background.paper, 0.85),
            }}
          >
            <Typography sx={{ fontSize: 16, lineHeight: 1 }}>x</Typography>
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent
        sx={{
          px: { xs: 1.2, sm: 2 },
          pb: { xs: 1.2, sm: 2 },
          pt: { xs: 1.9, sm: 2.8 },
        }}
      >
        <Box
          sx={{
            borderRadius: 2.4,
            border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
            backgroundColor: alpha(theme.palette.background.paper, 0.9),
            boxShadow: `0 8px 20px ${alpha(theme.palette.common.black, 0.06)}`,
            p: 1.25,
            mt: 0.2,
            mb: 1.4,
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.2}
            alignItems={{ xs: 'stretch', md: 'flex-end' }}
          >
            <Box sx={{ minWidth: { xs: '100%', md: 400 } }}>
              <UniversalCalendarInput
                mode="range"
                variant="form"
                appearance="booking"
                value={range}
                onChange={(nextValue) => {
                  const nextRange = (nextValue || {}) as UniversalCalendarRangeValue;
                  setRange({
                    startDate: nextRange.startDate || null,
                    endDate: nextRange.endDate || null,
                  });
                }}
                placeholder="Select timeline range"
              />
            </Box>

            <Button
              variant="contained"
              onClick={() => setRefreshNonce((previous) => previous + 1)}
              disabled={loading || !carId}
              sx={{ borderRadius: 2, textTransform: 'none', minWidth: 126, boxShadow: 'none', height: 44 }}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>

          <Stack direction="row" spacing={0.8} sx={{ mt: 1.1, flexWrap: 'wrap' }}>
            {QUICK_RANGE_OPTIONS.map((rangeDays) => (
              <Button
                key={`quick-range-${rangeDays}`}
                size="small"
                variant={selectedRangeDays === rangeDays ? 'contained' : 'outlined'}
                onClick={() => {
                  const start = dayjs().startOf('day');
                  setRange({
                    startDate: start.format('YYYY-MM-DD'),
                    endDate: start.add(rangeDays, 'day').format('YYYY-MM-DD'),
                  });
                }}
                sx={{
                  textTransform: 'none',
                  borderRadius: 999,
                  minWidth: 70,
                  height: 28,
                  fontSize: 11,
                  boxShadow: 'none',
                  borderColor: alpha(theme.palette.primary.main, 0.32),
                }}
              >
                {rangeDays}d
              </Button>
            ))}
          </Stack>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' },
            gap: 0.9,
            mb: 1.2,
          }}
        >
          {STATE_ORDER.map((state) => {
            const palette = getStatePalette(state, theme);
            return (
              <Box
                key={`summary-${state}`}
                sx={{
                  borderRadius: 2,
                  border: `1px solid ${alpha(palette.border, 0.78)}`,
                  backgroundColor: palette.bg,
                  px: 1,
                  py: 0.9,
                  boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.36)}`,
                }}
              >
                <Typography sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: alpha(palette.text, 0.85) }}>
                  {state}
                </Typography>
                <Typography sx={{ mt: 0.25, fontSize: 16, fontWeight: 800, color: palette.text }}>
                  {stateCounts[state] || 0}
                </Typography>
              </Box>
            );
          })}
        </Box>

        <Stack direction="row" spacing={0.8} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
          <Box
            sx={{
              px: 1.1,
              py: 0.55,
              borderRadius: 999,
              border: `1px solid ${alpha(theme.palette.success.main, 0.24)}`,
              backgroundColor: alpha(theme.palette.success.main, 0.1),
            }}
          >
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 700,
                color: theme.palette.mode === 'dark' ? 'success.light' : 'success.dark',
              }}
            >
              Available {stateCounts.AVAILABLE || 0}
            </Typography>
          </Box>
          <Box
            sx={{
              px: 1.1,
              py: 0.55,
              borderRadius: 999,
              border: `1px solid ${alpha(theme.palette.warning.main, 0.24)}`,
              backgroundColor: alpha(theme.palette.warning.main, 0.12),
            }}
          >
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 700,
                color: theme.palette.mode === 'dark' ? 'warning.light' : 'warning.dark',
              }}
            >
              Blocked {blockedDaysCount}
            </Typography>
          </Box>
        </Stack>

        {error ? <Alert sx={{ borderRadius: 2, mb: 1.2 }}>{error}</Alert> : null}

        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
            <CircularProgress size={20} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Loading availability...</Typography>
          </Stack>
        ) : null}

        {!loading && dateKeys.length === 0 ? (
          <Box
            sx={{
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
              backgroundColor: alpha(theme.palette.background.default, 0.9),
              p: 2,
            }}
          >
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Select a valid date range to view availability.
            </Typography>
          </Box>
        ) : null}

        {!loading && dateKeys.length > 0 ? (
          <Box
            sx={{
              borderRadius: 2.6,
              border: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
              overflow: 'hidden',
              backgroundColor: alpha(theme.palette.background.default, 0.46),
              boxShadow: `0 10px 24px ${alpha(theme.palette.common.black, 0.08)}`,
            }}
          >
            <Box
              sx={{
                px: 1.35,
                py: 1.1,
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
                backgroundColor: alpha(theme.palette.background.paper, 0.95),
              }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: 'text.primary', lineHeight: 1.2 }}>
                {carLabel}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.2 }}>
                Scroll horizontally to inspect each day in the selected range.
              </Typography>
            </Box>

            <Box sx={{ overflowX: 'auto', p: 1.2 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  minWidth: Math.max(760, dateKeys.length * 86),
                }}
              >
                {dateKeys.map((dateKey) => {
                  const state = timelineByDate[dateKey] || 'AVAILABLE';
                  const palette = getStatePalette(state, theme);
                  const isToday = dateKey === todayKey;

                  return (
                    <Tooltip
                      key={`day-card-${dateKey}`}
                      arrow
                      title={
                        <Box>
                          <Typography sx={{ fontSize: 11, fontWeight: 700 }}>
                            {dayjs(dateKey).format('DD MMM YYYY')}
                          </Typography>
                          <Typography sx={{ fontSize: 11 }}>{`State: ${state}`}</Typography>
                        </Box>
                      }
                    >
                      <Box
                        sx={{
                          width: 78,
                          minWidth: 78,
                          minHeight: 106,
                          borderRadius: 2.1,
                          border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
                          backgroundColor: alpha(theme.palette.background.paper, 0.98),
                          px: 0.75,
                          py: 0.75,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 0.35,
                          position: 'relative',
                          transition: 'all 140ms ease',
                          boxShadow: isToday
                            ? `inset 0 0 0 2px ${alpha(theme.palette.info.main, 0.45)}`
                            : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.45)}`,
                          '&:hover': {
                            transform: 'translateY(-2px)',
                            boxShadow: isToday
                              ? `inset 0 0 0 2px ${alpha(theme.palette.info.main, 0.45)}, 0 10px 18px ${alpha(theme.palette.common.black, 0.14)}`
                              : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.45)}, 0 10px 18px ${alpha(theme.palette.common.black, 0.14)}`,
                          },
                        }}
                      >
                        {isToday ? (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 6.5,
                              right: 6.5,
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              backgroundColor: theme.palette.info.main,
                              border: `1px solid ${alpha(theme.palette.common.white, 0.9)}`,
                            }}
                          />
                        ) : null}

                        <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'text.secondary', mt: 0.1 }}>
                          {dayjs(dateKey).format('ddd').toUpperCase()}
                        </Typography>
                        <Typography sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: 'text.primary' }}>
                          {dayjs(dateKey).format('DD')}
                        </Typography>
                        <Typography sx={{ fontSize: 10, color: 'text.secondary', lineHeight: 1 }}>
                          {dayjs(dateKey).format('MMM')}
                        </Typography>

                        <Box
                          sx={{
                            mt: 'auto',
                            width: '100%',
                            borderRadius: 1.5,
                            border: `1px solid ${palette.border}`,
                            backgroundColor: palette.bg,
                            color: palette.text,
                            py: 0.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: '0.02em',
                          }}
                        >
                          {STATE_CODE[state] || '--'}
                        </Box>
                      </Box>
                    </Tooltip>
                  );
                })}
              </Stack>
            </Box>
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default CarAvailabilityModal;
