import React from 'react';

const DEFAULT_HEIGHT = 260;

const safeNumber = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue;
};

const toCompactNumber = (value) => {
  const numericValue = safeNumber(value);
  if (Math.abs(numericValue) >= 10000000) return `${(numericValue / 10000000).toFixed(1)}Cr`;
  if (Math.abs(numericValue) >= 100000) return `${(numericValue / 100000).toFixed(1)}L`;
  if (Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toFixed(1)}K`;
  return `${Math.round(numericValue)}`;
};

const buildXAxisStep = (length) => Math.max(Math.ceil(length / 6), 1);

const ChartEmpty = ({ message }) => (
  <div className="h-[260px] rounded-xl border border-dashed border-slate-300 bg-slate-50/70 flex items-center justify-center text-sm text-slate-500">
    {message}
  </div>
);

const ChartLegend = ({ entries = [] }) => (
  <div className="mt-3 flex flex-wrap gap-3 text-xs">
    {entries.map((entry) => (
      <span key={entry.key} className="inline-flex items-center gap-1.5 text-slate-600">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: entry.color }}
          aria-hidden="true"
        />
        {entry.label}
      </span>
    ))}
  </div>
);

const chartContainerStyle = (length) => ({
  minWidth: `${Math.max(620, length * 56)}px`,
});

export const TrendLineChart = ({
  title,
  data = [],
  lines = [],
  xKey = 'date',
  height = DEFAULT_HEIGHT,
  xLabelFormatter = (value) => String(value || ''),
  yValueFormatter = toCompactNumber,
}) => {
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(lines) || lines.length === 0) {
    return <ChartEmpty message={`No ${title || 'trend'} data available`} />;
  }

  const top = 16;
  const right = 16;
  const bottom = 34;
  const left = 48;
  const chartWidth = Math.max(620, data.length * 56);
  const innerWidth = Math.max(chartWidth - left - right, 1);
  const innerHeight = Math.max(height - top - bottom, 1);

  const maxY = Math.max(
    ...lines.flatMap((line) => data.map((row) => safeNumber(row?.[line.key]))),
    0,
  );
  const yScaleMax = maxY > 0 ? maxY : 1;
  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, index) => {
    const value = yScaleMax * (1 - index / yTickCount);
    const y = top + (innerHeight * index) / yTickCount;
    return { value, y };
  });

  const getX = (index) => {
    if (data.length === 1) return left + innerWidth / 2;
    return left + (index / (data.length - 1)) * innerWidth;
  };
  const getY = (value) => top + innerHeight - (safeNumber(value) / yScaleMax) * innerHeight;
  const xStep = buildXAxisStep(data.length);

  return (
    <div className="overflow-x-auto">
      <svg
        style={chartContainerStyle(data.length)}
        viewBox={`0 0 ${chartWidth} ${height}`}
        role="img"
        aria-label={title || 'Line chart'}
      >
        {yTicks.map((tick) => (
          <g key={`grid-${tick.y}`}>
            <line x1={left} y1={tick.y} x2={chartWidth - right} y2={tick.y} stroke="#E2E8F0" strokeWidth="1" />
            <text x={left - 8} y={tick.y + 3} textAnchor="end" fill="#64748B" fontSize="10">
              {yValueFormatter(tick.value)}
            </text>
          </g>
        ))}

        {lines.map((line) => {
          const path = data
            .map((row, index) => `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getY(row?.[line.key])}`)
            .join(' ');

          return (
            <g key={line.key}>
              <path d={path} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {data.map((row, index) => (
                <circle
                  key={`${line.key}-point-${index}`}
                  cx={getX(index)}
                  cy={getY(row?.[line.key])}
                  r="2.5"
                  fill={line.color}
                >
                  <title>{`${line.label}: ${yValueFormatter(row?.[line.key])}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {data.map((row, index) => {
          const showLabel = index % xStep === 0 || index === data.length - 1;
          if (!showLabel) return null;
          return (
            <text key={`x-${index}`} x={getX(index)} y={height - 10} textAnchor="middle" fill="#64748B" fontSize="10">
              {xLabelFormatter(row?.[xKey])}
            </text>
          );
        })}
      </svg>

      <ChartLegend entries={lines.map((line) => ({ key: line.key, label: line.label, color: line.color }))} />
    </div>
  );
};

export const StackedBarTrendChart = ({
  title,
  data = [],
  bars = [],
  xKey = 'date',
  height = DEFAULT_HEIGHT,
  xLabelFormatter = (value) => String(value || ''),
  yValueFormatter = toCompactNumber,
}) => {
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(bars) || bars.length === 0) {
    return <ChartEmpty message={`No ${title || 'stacked trend'} data available`} />;
  }

  const top = 16;
  const right = 16;
  const bottom = 34;
  const left = 48;
  const chartWidth = Math.max(620, data.length * 56);
  const innerWidth = Math.max(chartWidth - left - right, 1);
  const innerHeight = Math.max(height - top - bottom, 1);

  const totals = data.map((row) => bars.reduce((sum, bar) => sum + safeNumber(row?.[bar.key]), 0));
  const maxTotal = Math.max(...totals, 0);
  const yScaleMax = maxTotal > 0 ? maxTotal : 1;
  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, index) => {
    const value = yScaleMax * (1 - index / yTickCount);
    const y = top + (innerHeight * index) / yTickCount;
    return { value, y };
  });

  const barSlotWidth = innerWidth / Math.max(data.length, 1);
  const barWidth = Math.max(Math.min(barSlotWidth * 0.6, 30), 10);
  const xStep = buildXAxisStep(data.length);

  return (
    <div className="overflow-x-auto">
      <svg
        style={chartContainerStyle(data.length)}
        viewBox={`0 0 ${chartWidth} ${height}`}
        role="img"
        aria-label={title || 'Stacked bar chart'}
      >
        {yTicks.map((tick) => (
          <g key={`grid-${tick.y}`}>
            <line x1={left} y1={tick.y} x2={chartWidth - right} y2={tick.y} stroke="#E2E8F0" strokeWidth="1" />
            <text x={left - 8} y={tick.y + 3} textAnchor="end" fill="#64748B" fontSize="10">
              {yValueFormatter(tick.value)}
            </text>
          </g>
        ))}

        {data.map((row, index) => {
          const centerX = left + barSlotWidth * index + barSlotWidth / 2;
          let currentY = top + innerHeight;

          return (
            <g key={`bar-${index}`}>
              {bars.map((bar) => {
                const rawValue = safeNumber(row?.[bar.key]);
                const segmentHeight = (rawValue / yScaleMax) * innerHeight;
                currentY -= segmentHeight;
                return (
                  <rect
                    key={`${bar.key}-${index}`}
                    x={centerX - barWidth / 2}
                    y={currentY}
                    width={barWidth}
                    height={Math.max(segmentHeight, 0)}
                    fill={bar.color}
                    rx="3"
                  >
                    <title>{`${bar.label}: ${yValueFormatter(rawValue)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        {data.map((row, index) => {
          const showLabel = index % xStep === 0 || index === data.length - 1;
          if (!showLabel) return null;
          const centerX = left + barSlotWidth * index + barSlotWidth / 2;
          return (
            <text key={`x-${index}`} x={centerX} y={height - 10} textAnchor="middle" fill="#64748B" fontSize="10">
              {xLabelFormatter(row?.[xKey])}
            </text>
          );
        })}
      </svg>

      <ChartLegend entries={bars.map((bar) => ({ key: bar.key, label: bar.label, color: bar.color }))} />
    </div>
  );
};

export const BarTrendChart = ({
  title,
  data = [],
  barKey,
  barLabel,
  barColor = '#2563EB',
  xKey = 'date',
  height = DEFAULT_HEIGHT,
  xLabelFormatter = (value) => String(value || ''),
  yValueFormatter = toCompactNumber,
}) => {
  if (!Array.isArray(data) || data.length === 0 || !barKey) {
    return <ChartEmpty message={`No ${title || 'bar trend'} data available`} />;
  }

  const top = 16;
  const right = 16;
  const bottom = 34;
  const left = 48;
  const chartWidth = Math.max(620, data.length * 56);
  const innerWidth = Math.max(chartWidth - left - right, 1);
  const innerHeight = Math.max(height - top - bottom, 1);

  const maxY = Math.max(...data.map((row) => safeNumber(row?.[barKey])), 0);
  const yScaleMax = maxY > 0 ? maxY : 1;
  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, index) => {
    const value = yScaleMax * (1 - index / yTickCount);
    const y = top + (innerHeight * index) / yTickCount;
    return { value, y };
  });

  const barSlotWidth = innerWidth / Math.max(data.length, 1);
  const barWidth = Math.max(Math.min(barSlotWidth * 0.6, 30), 10);
  const xStep = buildXAxisStep(data.length);

  return (
    <div className="overflow-x-auto">
      <svg
        style={chartContainerStyle(data.length)}
        viewBox={`0 0 ${chartWidth} ${height}`}
        role="img"
        aria-label={title || 'Bar chart'}
      >
        {yTicks.map((tick) => (
          <g key={`grid-${tick.y}`}>
            <line x1={left} y1={tick.y} x2={chartWidth - right} y2={tick.y} stroke="#E2E8F0" strokeWidth="1" />
            <text x={left - 8} y={tick.y + 3} textAnchor="end" fill="#64748B" fontSize="10">
              {yValueFormatter(tick.value)}
            </text>
          </g>
        ))}

        {data.map((row, index) => {
          const centerX = left + barSlotWidth * index + barSlotWidth / 2;
          const value = safeNumber(row?.[barKey]);
          const barHeight = (value / yScaleMax) * innerHeight;
          return (
            <rect
              key={`bar-${index}`}
              x={centerX - barWidth / 2}
              y={top + innerHeight - barHeight}
              width={barWidth}
              height={Math.max(barHeight, 0)}
              fill={barColor}
              rx="3"
            >
              <title>{`${barLabel || barKey}: ${yValueFormatter(value)}`}</title>
            </rect>
          );
        })}

        {data.map((row, index) => {
          const showLabel = index % xStep === 0 || index === data.length - 1;
          if (!showLabel) return null;
          const centerX = left + barSlotWidth * index + barSlotWidth / 2;
          return (
            <text key={`x-${index}`} x={centerX} y={height - 10} textAnchor="middle" fill="#64748B" fontSize="10">
              {xLabelFormatter(row?.[xKey])}
            </text>
          );
        })}
      </svg>

      <ChartLegend entries={[{ key: barKey, label: barLabel || barKey, color: barColor }]} />
    </div>
  );
};
