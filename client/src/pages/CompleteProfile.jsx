import React, { useState } from 'react';
import dayjs from 'dayjs';
import API, { getErrorMessage } from '../api';
import UniversalCalendarInput from '../components/UniversalCalendarInput';
import LocationSelector from '../components/LocationSelector';
import { getPublicCities, getPublicLocations, getPublicStates } from '../services/locationService';
import {
  buildLocationSelectionPayload,
  findLocationOption,
  loadPreferredLocationSelection,
  saveLocationSelection,
} from '../services/locationSelectionService';

const PLACEHOLDER_AVATAR = 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
const normalizeStoredId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value?._id) return String(value._id);
  return '';
};

const CompleteProfile = () => {
  const todayDateKey = dayjs().format('YYYY-MM-DD');
  const [form, setForm] = useState({
    phone: '',
    address: '',
    dob: '',
    stateId: '',
    cityId: '',
    locationId: '',
  });
  const [stateOptions, setStateOptions] = useState([]);
  const [cityOptions, setCityOptions] = useState([]);
  const [locationOptions, setLocationOptions] = useState([]);
  const [locationLoading, setLocationLoading] = useState(false);

  const [image, setImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const calculateAge = (dob) => {
    const dobInput = String(dob || '').split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobInput)) return 0;

    const birthDate = dayjs(dobInput);
    if (!birthDate.isValid()) return 0;

    const today = dayjs().startOf('day');
    let age = today.year() - birthDate.year();
    if (today.month() < birthDate.month() || (today.month() === birthDate.month() && today.date() < birthDate.date())) {
      age -= 1;
    }

    return age;
  };

  const validateForm = () => {
    if (!/^[0-9]{10}$/.test(form.phone)) {
      return 'Phone number must be 10 digits';
    }

    if (!form.dob) {
      return 'Date of birth is required';
    }

    const dobInput = String(form.dob).split('T')[0];
    const dobDate = dayjs(dobInput);
    const today = dayjs().startOf('day');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobInput) || !dobDate.isValid()) {
      return 'Invalid date of birth';
    }

    if (dobDate.isAfter(today, 'day')) {
      return 'Date of birth cannot be in the future';
    }

    const age = calculateAge(form.dob);
    if (age < 18) {
      return 'You must be at least 18 years old';
    }

    if (!form.stateId || !form.cityId || !form.locationId) {
      return 'Select your default state, city, and pickup location';
    }

    return null;
  };

  React.useEffect(() => {
    const savedUser = (() => {
      try {
        return JSON.parse(localStorage.getItem('user') || '{}');
      } catch {
        return {};
      }
    })();

    const preferredLocation = loadPreferredLocationSelection();
    setForm((previous) => ({
      ...previous,
      phone: savedUser?.phone || previous.phone || '',
      address: savedUser?.address || previous.address || '',
      dob: savedUser?.dob || previous.dob || '',
      stateId: normalizeStoredId(savedUser?.stateId) || preferredLocation.stateId || '',
      cityId: normalizeStoredId(savedUser?.cityId) || preferredLocation.cityId || '',
      locationId: normalizeStoredId(savedUser?.locationId) || preferredLocation.locationId || '',
    }));
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const loadStates = async () => {
      try {
        setLocationLoading(true);
        const states = await getPublicStates();
        if (cancelled) return;
        setStateOptions(states);
      } catch {
        if (!cancelled) setStateOptions([]);
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    loadStates();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!form.stateId) {
      setCityOptions([]);
      setLocationOptions([]);
      setForm((previous) =>
        previous.cityId || previous.locationId ? { ...previous, cityId: '', locationId: '' } : previous,
      );
      return;
    }

    let cancelled = false;

    const loadCities = async () => {
      try {
        setLocationLoading(true);
        const cities = await getPublicCities(form.stateId);
        if (cancelled) return;
        setCityOptions(cities);
        if (form.cityId && !cities.some((city) => String(city?._id || '') === String(form.cityId))) {
          setForm((previous) => ({ ...previous, cityId: '', locationId: '' }));
        }
      } catch {
        if (!cancelled) setCityOptions([]);
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    loadCities();

    return () => {
      cancelled = true;
    };
  }, [form.stateId, form.cityId]);

  React.useEffect(() => {
    if (!form.cityId) {
      setLocationOptions([]);
      setForm((previous) => (previous.locationId ? { ...previous, locationId: '' } : previous));
      return;
    }

    let cancelled = false;

    const loadLocations = async () => {
      try {
        setLocationLoading(true);
        const locations = await getPublicLocations(form.cityId);
        if (cancelled) return;
        setLocationOptions(locations);
        if (
          form.locationId &&
          !locations.some((location) => String(location?._id || '') === String(form.locationId))
        ) {
          setForm((previous) => ({ ...previous, locationId: '' }));
        }
      } catch {
        if (!cancelled) setLocationOptions([]);
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    loadLocations();

    return () => {
      cancelled = true;
    };
  }, [form.cityId, form.locationId]);

  const handleImageSelect = (event) => {
    const file = event.target.files?.[0] || null;
    setImage(file);

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    if (file) {
      setImagePreviewUrl(URL.createObjectURL(file));
    } else {
      setImagePreviewUrl('');
    }

    event.target.value = '';
  };

  React.useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const submitProfile = async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      const validationError = validateForm();
      if (validationError) {
        setErrorMsg(validationError);
        setLoading(false);
        return;
      }

      const age = calculateAge(form.dob);
      const formData = new FormData();
      formData.append('phone', form.phone);
      formData.append('address', form.address);
      formData.append('dob', form.dob);
      formData.append('age', age);
      formData.append('stateId', form.stateId);
      formData.append('cityId', form.cityId);
      formData.append('locationId', form.locationId);

      if (image) {
        formData.append('image', image);
      }

      const res = await API.put('/user/complete-profile', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const old = JSON.parse(localStorage.getItem('user'));
      const updated = { ...old, ...res.data.user };

      localStorage.setItem('user', JSON.stringify(updated));
      saveLocationSelection(
        buildLocationSelectionPayload({
          stateOption: findLocationOption(stateOptions, { id: updated?.stateId || form.stateId }),
          cityOption: findLocationOption(cityOptions, { id: updated?.cityId || form.cityId }),
          locationOption: findLocationOption(locationOptions, { id: updated?.locationId || form.locationId }),
        }),
      );
      window.location.href = '/';
    } catch (err) {
      setErrorMsg(getErrorMessage(err, 'Profile update failed'));
    } finally {
      setLoading(false);
    }
  };

  const liveAge = form.dob ? calculateAge(form.dob) : null;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-linear-to-br from-slate-100 via-white to-blue-50 px-4 py-10 sm:py-14">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_1.25fr]">
        <aside className="rounded-3xl border border-slate-200 bg-linear-to-br from-[#112a59] via-[#1f4db7] to-[#2d6cea] p-6 text-white shadow-lg sm:p-7">
          <p className="text-xs uppercase tracking-[0.18em] text-blue-100">Profile Setup</p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight">
            Complete your profile before booking your next ride.
          </h1>
          <p className="mt-3 text-sm text-blue-100/95">
            This helps us verify your account and makes booking approvals faster.
          </p>

          <div className="mt-6 space-y-3 rounded-2xl border border-white/25 bg-white/10 p-4 text-sm backdrop-blur">
            <p className="font-medium">What you need</p>
            <p className="text-blue-100">1. Valid 10-digit phone number</p>
            <p className="text-blue-100">2. Date of birth (18+ only)</p>
            <p className="text-blue-100">3. Address and optional profile photo</p>
          </div>
        </aside>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:p-7">
          <h2 className="text-2xl font-semibold text-slate-900">Complete Your Profile</h2>
          <p className="mt-1 text-sm text-slate-500">Add your details once to unlock full booking access.</p>

          <div className="mt-5 flex flex-col items-center">
            <label className="cursor-pointer">
              <div className="relative h-30 w-30 overflow-hidden rounded-full border-3 border-primary/70 bg-slate-100">
                <img
                  src={imagePreviewUrl || PLACEHOLDER_AVATAR}
                  className="h-full w-full object-cover"
                  alt="profile"
                />
              </div>
              <input type="file" accept="image/*" hidden onChange={handleImageSelect} />
            </label>
            <p className="mt-2 text-xs text-slate-500">Tap profile image to upload photo</p>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Phone Number</label>
              <input
                type="text"
                placeholder="10-digit mobile number"
                maxLength={10}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Date Of Birth</label>
              <div className="mt-1.5">
                <UniversalCalendarInput
                  mode="single"
                  variant="form"
                  appearance="dob"
                  value={form.dob || null}
                  minDate="1900-01-01"
                  maxDate={todayDateKey}
                  yearRange={{ start: 1900, end: new Date().getFullYear() }}
                  onChange={(nextValue) => setForm({ ...form, dob: typeof nextValue === 'string' ? nextValue : '' })}
                  placeholder="Select date of birth"
                />
              </div>
              {liveAge !== null ? (
                <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  Age: {liveAge} years
                </div>
              ) : null}
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Address</label>
              <textarea
                placeholder="Enter your full address"
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                rows={4}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <LocationSelector
              stateOptions={stateOptions}
              cityOptions={cityOptions}
              locationOptions={locationOptions}
              selectedStateId={form.stateId}
              selectedCityId={form.cityId}
              selectedLocationId={form.locationId}
              onStateChange={(stateId) =>
                setForm((previous) => ({ ...previous, stateId, cityId: '', locationId: '' }))
              }
              onCityChange={(cityId) =>
                setForm((previous) => ({ ...previous, cityId, locationId: '' }))
              }
              onLocationChange={(locationId) => setForm((previous) => ({ ...previous, locationId }))}
              loading={locationLoading}
              required
              wrapperClassName="grid grid-cols-1 gap-4"
              itemClassName=""
              labelClassName="text-xs font-medium uppercase tracking-wide text-slate-500"
              selectClassName="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              stateLabel="Default State"
              cityLabel="Default City"
              locationLabel="Default Pickup Location"
              locationPlaceholder="Select pickup location"
            />
          </div>

          {errorMsg ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMsg}
            </p>
          ) : null}

          <button
            onClick={submitProfile}
            disabled={loading}
            className={`mt-5 w-full rounded-xl py-2.5 text-sm font-medium text-white ${
              loading ? 'cursor-not-allowed bg-gray-400' : 'bg-primary hover:bg-primary-dull'
            }`}
          >
            {loading ? 'Saving...' : 'Save & Continue'}
          </button>
        </section>
      </div>
    </div>
  );
};

export default CompleteProfile;

