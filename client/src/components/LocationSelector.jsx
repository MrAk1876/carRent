import React from 'react';

const normalizeText = (value) => String(value || '').trim();

const LocationSelector = ({
  stateOptions = [],
  cityOptions = [],
  locationOptions = [],
  selectedStateId = '',
  selectedCityId = '',
  selectedLocationId = '',
  onStateChange,
  onCityChange,
  onLocationChange,
  loading = false,
  required = false,
  allowAll = false,
  stateLabel = 'State',
  cityLabel = 'City',
  locationLabel = 'Location',
  statePlaceholder = 'Select state',
  cityPlaceholder = 'Select city',
  locationPlaceholder = 'Select location',
  wrapperClassName = 'grid grid-cols-1 md:grid-cols-3 gap-3',
  itemClassName = '',
  labelClassName = 'block text-xs font-medium uppercase tracking-wide text-gray-500',
  selectClassName = 'mt-1 w-full rounded-lg border border-borderColor bg-white px-3 py-2 text-sm outline-none',
}) => {
  const normalizedStateId = normalizeText(selectedStateId);
  const normalizedCityId = normalizeText(selectedCityId);
  const normalizedLocationId = normalizeText(selectedLocationId);
  const cityDisabled = loading || (!allowAll && !normalizedStateId && cityOptions.length === 0);
  const locationDisabled = loading || (!allowAll && !normalizedCityId && locationOptions.length === 0);

  return (
    <div className={wrapperClassName}>
      <div className={itemClassName}>
        <label className={labelClassName}>{stateLabel}</label>
        <select
          value={normalizedStateId}
          onChange={(event) => onStateChange?.(String(event.target.value || ''))}
          className={selectClassName}
          disabled={loading}
          required={required}
        >
          {allowAll ? <option value="">All states</option> : null}
          {!allowAll ? (
            <option value="">
              {loading ? 'Loading states...' : stateOptions.length > 0 ? statePlaceholder : 'No states available'}
            </option>
          ) : null}
          {stateOptions.map((state) => (
            <option value={state._id} key={state._id || state.name}>
              {state.name}
            </option>
          ))}
        </select>
      </div>

      <div className={itemClassName}>
        <label className={labelClassName}>{cityLabel}</label>
        <select
          value={normalizedCityId}
          onChange={(event) => onCityChange?.(String(event.target.value || ''))}
          className={selectClassName}
          disabled={cityDisabled}
          required={required}
        >
          {allowAll ? <option value="">All cities</option> : null}
          {!allowAll ? (
            <option value="">
              {!normalizedStateId
                ? 'Select state first'
                : loading
                  ? 'Loading cities...'
                  : cityOptions.length > 0
                    ? cityPlaceholder
                    : 'No cities available'}
            </option>
          ) : null}
          {cityOptions.map((city) => (
            <option value={city._id} key={city._id || `${city.name}-${city.stateId || 'city'}`}>
              {city.name}
            </option>
          ))}
        </select>
      </div>

      {onLocationChange ? (
        <div className={itemClassName}>
          <label className={labelClassName}>{locationLabel}</label>
          <select
            value={normalizedLocationId}
            onChange={(event) => onLocationChange?.(String(event.target.value || ''))}
            className={selectClassName}
            disabled={locationDisabled}
            required={required}
          >
            {allowAll ? <option value="">All locations</option> : null}
            {!allowAll ? (
              <option value="">
                {!normalizedCityId
                  ? 'Select city first'
                  : loading
                    ? 'Loading locations...'
                    : locationOptions.length > 0
                      ? locationPlaceholder
                      : 'No locations available'}
              </option>
            ) : null}
            {locationOptions.map((location) => (
              <option
                value={location._id}
                key={location._id || `${location.name}-${location.cityId || 'location'}`}
              >
                {location.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
};

export default LocationSelector;
