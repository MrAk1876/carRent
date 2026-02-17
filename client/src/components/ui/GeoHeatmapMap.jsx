import React, { useMemo, useState } from 'react';

const DEFAULT_VIEWPORT = {
  minLat: 6,
  maxLat: 38,
  minLng: 66,
  maxLng: 98,
};

const safeNumber = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const GeoHeatmapMap = ({
  title = 'Geo Heatmap',
  subtitle = '',
  points = [],
  pointColor = '#2563EB',
  valueFormatter = (value) => value,
  valueLabel = 'Value',
  selectedPointKey = '',
  onSelectPoint,
}) => {
  const [hoveredKey, setHoveredKey] = useState('');

  const normalizedPoints = useMemo(
    () =>
      (Array.isArray(points) ? points : [])
        .map((point, index) => {
          const latitude = safeNumber(point?.latitude);
          const longitude = safeNumber(point?.longitude);
          const value = safeNumber(point?.value);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
          return {
            key: String(point?.key || `${latitude}:${longitude}:${index}`),
            latitude,
            longitude,
            value,
            label: String(point?.label || ''),
            address: String(point?.address || ''),
            meta: point?.meta || null,
          };
        })
        .filter(Boolean),
    [points],
  );

  const bounds = useMemo(() => {
    if (!normalizedPoints.length) return DEFAULT_VIEWPORT;

    const lats = normalizedPoints.map((point) => point.latitude);
    const lngs = normalizedPoints.map((point) => point.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latPadding = Math.max((maxLat - minLat) * 0.15, 0.4);
    const lngPadding = Math.max((maxLng - minLng) * 0.15, 0.4);

    return {
      minLat: clamp(minLat - latPadding, -90, 90),
      maxLat: clamp(maxLat + latPadding, -90, 90),
      minLng: clamp(minLng - lngPadding, -180, 180),
      maxLng: clamp(maxLng + lngPadding, -180, 180),
    };
  }, [normalizedPoints]);

  const mapGeometry = useMemo(() => {
    const width = 1000;
    const height = 420;
    const padding = 30;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
    const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.0001);
    const maxValue = Math.max(...normalizedPoints.map((point) => point.value), 0);

    const mappedPoints = normalizedPoints.map((point) => {
      const x = padding + ((point.longitude - bounds.minLng) / lngSpan) * innerWidth;
      const y = padding + (1 - (point.latitude - bounds.minLat) / latSpan) * innerHeight;
      const intensity = maxValue > 0 ? point.value / maxValue : 0;
      const radius = 6 + intensity * 28;
      return {
        ...point,
        x,
        y,
        radius,
        intensity,
      };
    });

    return {
      width,
      height,
      padding,
      innerWidth,
      innerHeight,
      mappedPoints,
      maxValue,
    };
  }, [bounds, normalizedPoints]);

  const hoveredPoint = useMemo(
    () => mapGeometry.mappedPoints.find((point) => point.key === hoveredKey) || null,
    [hoveredKey, mapGeometry.mappedPoints],
  );

  const selectedPoint = useMemo(
    () => mapGeometry.mappedPoints.find((point) => point.key === selectedPointKey) || null,
    [mapGeometry.mappedPoints, selectedPointKey],
  );

  return (
    <div className="rounded-2xl border border-borderColor bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
          {subtitle ? <p className="text-xs text-gray-500">{subtitle}</p> : null}
        </div>
        <div className="text-xs text-gray-500">
          {normalizedPoints.length} plotted areas
        </div>
      </div>

      {normalizedPoints.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-gray-500">
          No geo coordinates available for this filter.
        </div>
      ) : (
        <div className="mt-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/50">
            <svg viewBox={`0 0 ${mapGeometry.width} ${mapGeometry.height}`} className="min-w-[680px] w-full">
              <rect
                x={mapGeometry.padding}
                y={mapGeometry.padding}
                width={mapGeometry.innerWidth}
                height={mapGeometry.innerHeight}
                fill="#F8FAFC"
                stroke="#CBD5E1"
                strokeWidth="1"
                rx="8"
              />

              {mapGeometry.mappedPoints.map((point) => {
                const isSelected = selectedPointKey && point.key === selectedPointKey;
                return (
                  <g key={point.key}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={point.radius}
                      fill={pointColor}
                      fillOpacity={0.16 + point.intensity * 0.36}
                      stroke={pointColor}
                      strokeOpacity={0.45 + point.intensity * 0.5}
                      strokeWidth={isSelected ? 2.4 : 1}
                      onMouseEnter={() => setHoveredKey(point.key)}
                      onMouseLeave={() => setHoveredKey('')}
                      onClick={() => {
                        if (onSelectPoint) onSelectPoint(point);
                      }}
                      className="cursor-pointer transition-all duration-150"
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={isSelected ? 3.3 : 2.4}
                      fill={pointColor}
                      fillOpacity={0.95}
                      pointerEvents="none"
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-borderColor bg-slate-50 px-3 py-2 text-gray-600">
              <p>
                Viewport: Lat {bounds.minLat.toFixed(2)} to {bounds.maxLat.toFixed(2)} | Lng {bounds.minLng.toFixed(2)} to {bounds.maxLng.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg border border-borderColor bg-slate-50 px-3 py-2 text-gray-600">
              <p>
                Max {valueLabel}: {valueFormatter(mapGeometry.maxValue)}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-borderColor bg-white px-3 py-2 text-xs">
            {hoveredPoint || selectedPoint ? (
              <div className="space-y-1 text-gray-700">
                <p className="font-semibold">
                  {String((hoveredPoint || selectedPoint)?.label || 'Area')}
                </p>
                <p>
                  {valueLabel}: {valueFormatter((hoveredPoint || selectedPoint)?.value || 0)}
                </p>
                <p>
                  Lat/Lng: {safeNumber((hoveredPoint || selectedPoint)?.latitude).toFixed(3)}, {safeNumber((hoveredPoint || selectedPoint)?.longitude).toFixed(3)}
                </p>
                {(hoveredPoint || selectedPoint)?.address ? (
                  <p className="text-gray-500">{String((hoveredPoint || selectedPoint)?.address || '')}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-gray-500">Hover or click a heat point to inspect area details.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GeoHeatmapMap;
