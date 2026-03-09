import React, { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import API, { getErrorMessage } from '../api';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from '../utils/cropImage';
import { assets } from '../assets/assets';
import useNotify from '../hooks/useNotify';
import { resolveImageUrl } from '../utils/image';
import UniversalCalendarInput from '../components/UniversalCalendarInput';
import LocationSelector from '../components/LocationSelector';
import { getPublicCities, getPublicLocations, getPublicStates } from '../services/locationService';
import {
  buildLocationSelectionPayload,
  findLocationOption,
  loadPreferredLocationSelection,
  saveLocationSelection,
} from '../services/locationSelectionService';

const normalizeStoredId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value?._id) return String(value._id);
  return '';
};

const Profile = () => {
  const notify = useNotify();
  const todayDateKey = dayjs().format('YYYY-MM-DD');
  const [user, setUser] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [password, setPassword] = useState('');
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState(null);
  const [showCrop, setShowCrop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [stateOptions, setStateOptions] = useState([]);
  const [cityOptions, setCityOptions] = useState([]);
  const [locationOptions, setLocationOptions] = useState([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const inputClass = (field) =>
    `border p-2.5 w-full rounded-lg focus:outline-none focus:ring-1 ${
      fieldErrors[field] ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-primary'
    }`;

  const handleChange = (field, value) => {
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));
    setUser(prev => ({ ...prev, [field]: value }));
  };

  const isFormInvalid = () => {
    return Object.keys(validateProfile()).length > 0;
  };

  useEffect(() => {
    const data = localStorage.getItem('user');
    if (!data) return;
    const parsedUser = JSON.parse(data);
    const preferredLocation = loadPreferredLocationSelection();
    setUser({
      ...parsedUser,
      stateId: normalizeStoredId(parsedUser?.stateId) || preferredLocation.stateId || '',
      cityId: normalizeStoredId(parsedUser?.cityId) || preferredLocation.cityId || '',
      locationId: normalizeStoredId(parsedUser?.locationId) || preferredLocation.locationId || '',
      stateName: parsedUser?.stateName || parsedUser?.stateId?.name || preferredLocation.stateName || '',
      cityName: parsedUser?.cityName || parsedUser?.cityId?.name || preferredLocation.cityName || '',
      locationName:
        parsedUser?.locationName || parsedUser?.locationId?.name || preferredLocation.locationName || '',
    });
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    if (!user?.stateId) {
      setCityOptions([]);
      setLocationOptions([]);
      return;
    }

    let cancelled = false;

    const loadCities = async () => {
      try {
        setLocationLoading(true);
        const cities = await getPublicCities(user.stateId);
        if (cancelled) return;
        setCityOptions(cities);
        if (user.cityId && !cities.some((city) => String(city?._id || '') === String(user.cityId))) {
          setUser((previous) => ({ ...previous, cityId: '', cityName: '', locationId: '', locationName: '' }));
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
  }, [user?.stateId, user?.cityId]);

  useEffect(() => {
    if (!user?.cityId) {
      setLocationOptions([]);
      return;
    }

    let cancelled = false;

    const loadLocations = async () => {
      try {
        setLocationLoading(true);
        const locations = await getPublicLocations(user.cityId);
        if (cancelled) return;
        setLocationOptions(locations);
        if (
          user.locationId &&
          !locations.some((location) => String(location?._id || '') === String(user.locationId))
        ) {
          setUser((previous) => ({ ...previous, locationId: '', locationName: '' }));
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
  }, [user?.cityId, user?.locationId]);

  useEffect(() => {
    return () => {
      if (imageSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, [imageSrc]);

  const resetCropState = () => {
    if (imageSrc?.startsWith('blob:')) {
      URL.revokeObjectURL(imageSrc);
    }
    setShowCrop(false);
    setImageSrc(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  };
  // calculate age from DOB using date-only comparison to avoid timezone drift
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

  const validateProfile = () => {
    const errors = {};

    // email
    if (!/^\S+@\S+\.\S+$/.test(user.email)) {
      errors.email = 'Invalid email address';
    }

    // phone
    if (!/^[0-9]{10}$/.test(user.phone || '')) {
      errors.phone = 'Phone number must be exactly 10 digits';
    }

    // dob
    if (!user.dob) {
      errors.dob = 'Date of birth is required';
    } else {
      const dobInput = String(user.dob).split('T')[0];
      const dobDate = dayjs(dobInput);
      const today = dayjs().startOf('day');

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dobInput) || !dobDate.isValid()) {
        errors.dob = 'Invalid date of birth';
      } else if (dobDate.isAfter(today, 'day')) {
        errors.dob = 'Date of birth cannot be in the future';
      } else {
        const age = calculateAge(user.dob);
        if (age < 18) {
          errors.dob = 'You must be at least 18 years old';
        }
      }
    }

    if (!user.stateId) {
      errors.stateId = 'State is required';
    }
    if (!user.cityId) {
      errors.cityId = 'City is required';
    }
    if (!user.locationId) {
      errors.locationId = 'Pickup location is required';
    }

    return errors;
  };

  const updateProfile = async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      const errors = validateProfile();
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setLoading(false);
        return;
      }
      setFieldErrors({});

      // auto-calculate age from dob
      const age = calculateAge(user.dob);

      const payload = {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        dob: user.dob,
        age,
        address: user.address,
        stateId: user.stateId,
        cityId: user.cityId,
        locationId: user.locationId,
      };

      const res = await API.put('/user/profile', payload);

      localStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      saveLocationSelection(
        buildLocationSelectionPayload({
          stateOption: findLocationOption(stateOptions, { id: res.data.user?.stateId || user.stateId }),
          cityOption: findLocationOption(cityOptions, { id: res.data.user?.cityId || user.cityId }),
          locationOption: findLocationOption(locationOptions, { id: res.data.user?.locationId || user.locationId }),
        }),
      );
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Profile update failed'));
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async () => {
    try {
      if (!password || password.length < 8) {
        setPasswordMsg('Password must be at least 8 characters');
        return;
      }

      setPasswordLoading(true);
      setPasswordMsg('');
      await API.put('/user/password', { password });
      setPassword('');
      setPasswordMsg('Password updated successfully');
    } catch (error) {
      setPasswordMsg(getErrorMessage(error, 'Password update failed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const onCropComplete = (_, croppedAreaPixels) => {
    setCroppedArea(croppedAreaPixels);
  };

  const saveCroppedImage = async () => {
    try {
      const blob = await getCroppedImg(imageSrc, croppedArea);

      const formData = new FormData();
      formData.append('image', blob, 'profile.jpg');

      const res = await API.put('/user/profile-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const updated = { ...user, image: res.data.image };
      localStorage.setItem('user', JSON.stringify(updated));
      setUser(updated);

      resetCropState();
      notify.success('Photo updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Upload failed'));
    }
  };

  if (!user) return null;
  const resolvedUserImage = resolveImageUrl(user.image);

  return (
    <>
      <div className="min-h-[calc(100vh-64px)] bg-linear-to-br from-slate-100 via-white to-blue-50 py-8 md:py-12">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 md:px-6 lg:grid-cols-[280px_1fr]">
          <div className="h-max rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => document.getElementById('profileUpload').click()}
                className="w-32 h-32 rounded-full border-4 border-primary overflow-hidden hover:opacity-90 transition"
              >
                <img
                  src={resolvedUserImage || assets.user_profile}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              </button>

              <p className="text-lg font-semibold mt-4">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-sm text-gray-500">{user.email}</p>
              <span
                className={`mt-3 text-xs px-3 py-1 rounded-full ${
                  user.isProfileComplete ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                }`}
              >
                {user.isProfileComplete ? 'Profile Complete' : 'Profile Incomplete'}
              </span>
            </div>

            <p className="text-xs text-gray-500 mt-4 text-center">Click profile image to change photo</p>

            <input
              id="profileUpload"
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  setImageSrc(URL.createObjectURL(file));
                  setShowCrop(true);
                }
                e.target.value = '';
              }}
            />
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-semibold text-slate-900">My Profile</h2>
              <p className="text-sm text-gray-500 mt-1">Update your personal details and contact information.</p>
              {errorMsg && <p className="text-red-500 text-sm mt-3">{errorMsg}</p>}

              <div className="mt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-600">First Name</label>
                    <input
                      className={`${inputClass('firstName')} mt-1`}
                      value={user.firstName || ''}
                      onChange={(e) => handleChange('firstName', e.target.value)}
                      placeholder="First Name"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-600">Last Name</label>
                    <input
                      className={`${inputClass('lastName')} mt-1`}
                      value={user.lastName || ''}
                      onChange={(e) => handleChange('lastName', e.target.value)}
                      placeholder="Last Name"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-600">Email</label>
                  <input
                    className={`${inputClass('email')} mt-1`}
                    value={user.email || ''}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="Email"
                  />
                  {fieldErrors.email && <p className="text-red-500 text-xs mt-1">{fieldErrors.email}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-600">Phone</label>
                    <input
                      className={`${inputClass('phone')} mt-1`}
                      value={user.phone || ''}
                      maxLength={10}
                      onChange={(e) => handleChange('phone', e.target.value.replace(/\D/g, ''))}
                      placeholder="Phone Number"
                    />
                    {fieldErrors.phone && <p className="text-red-500 text-xs mt-1">{fieldErrors.phone}</p>}
                  </div>

                  <div>
                    <label className="text-sm text-gray-600">Date Of Birth</label>
                    <div className="mt-1">
                      <UniversalCalendarInput
                        mode="single"
                        variant="form"
                        appearance="dob"
                        value={user.dob?.split('T')[0] || null}
                        minDate="1900-01-01"
                        maxDate={todayDateKey}
                        yearRange={{ start: 1900, end: new Date().getFullYear() }}
                        onChange={(nextValue) => handleChange('dob', typeof nextValue === 'string' ? nextValue : '')}
                        placeholder="Select date of birth"
                      />
                    </div>
                    {fieldErrors.dob && <p className="text-red-500 text-xs mt-1">{fieldErrors.dob}</p>}
                    {user.dob && <p className="text-xs text-gray-500 mt-1">Age: {calculateAge(user.dob)} years</p>}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-600">Address</label>
                  <textarea
                    className={`${inputClass('address')} mt-1`}
                    rows={3}
                    value={user.address || ''}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="Address"
                  />
                </div>

                <div>
                  <LocationSelector
                    stateOptions={stateOptions}
                    cityOptions={cityOptions}
                    locationOptions={locationOptions}
                    selectedStateId={user.stateId || ''}
                    selectedCityId={user.cityId || ''}
                    selectedLocationId={user.locationId || ''}
                    onStateChange={(stateId) => {
                      const stateOption = findLocationOption(stateOptions, { id: stateId });
                      setFieldErrors((previous) => ({
                        ...previous,
                        stateId: undefined,
                        cityId: undefined,
                        locationId: undefined,
                      }));
                      setUser((previous) => ({
                        ...previous,
                        stateId,
                        cityId: '',
                        locationId: '',
                        stateName: stateOption?.name || '',
                        cityName: '',
                        locationName: '',
                      }));
                    }}
                    onCityChange={(cityId) => {
                      const cityOption = findLocationOption(cityOptions, { id: cityId });
                      setFieldErrors((previous) => ({ ...previous, cityId: undefined, locationId: undefined }));
                      setUser((previous) => ({
                        ...previous,
                        cityId,
                        locationId: '',
                        cityName: cityOption?.name || '',
                        locationName: '',
                      }));
                    }}
                    onLocationChange={(locationId) => {
                      const locationOption = findLocationOption(locationOptions, { id: locationId });
                      setFieldErrors((previous) => ({ ...previous, locationId: undefined }));
                      setUser((previous) => ({
                        ...previous,
                        locationId,
                        locationName: locationOption?.name || '',
                      }));
                    }}
                    loading={locationLoading}
                    required
                    wrapperClassName="grid grid-cols-1 gap-4"
                    itemClassName=""
                    labelClassName="text-sm text-gray-600"
                    selectClassName="mt-1 border p-2.5 w-full rounded-lg focus:outline-none focus:ring-1 border-gray-300 focus:ring-primary"
                    stateLabel="Default State"
                    cityLabel="Default City"
                    locationLabel="Default Pickup Location"
                  />
                  {fieldErrors.stateId && <p className="text-red-500 text-xs mt-1">{fieldErrors.stateId}</p>}
                  {fieldErrors.cityId && <p className="text-red-500 text-xs mt-1">{fieldErrors.cityId}</p>}
                  {fieldErrors.locationId && <p className="text-red-500 text-xs mt-1">{fieldErrors.locationId}</p>}
                </div>
              </div>

              <button
                onClick={updateProfile}
                disabled={loading || isFormInvalid()}
                className={`w-full py-2.5 mt-5 rounded-lg text-white transition-all ${
                  loading || isFormInvalid() ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-primary-dull'
                }`}
              >
                {loading ? 'Updating...' : 'Update Profile'}
              </button>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">Security</h3>
              <p className="text-sm text-gray-500 mt-1">Change your account password.</p>

              <div className="relative mt-4">
                <input
                  type={showPass ? 'text' : 'password'}
                  className="border border-gray-300 p-2.5 w-full rounded-lg focus:outline-none focus:ring-1 focus:ring-primary pr-14"
                  placeholder="New Password"
                  value={password}
                  onChange={(e) => {
                    setPasswordMsg('');
                    setPassword(e.target.value);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  className="password-toggle-btn absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md opacity-80 hover:opacity-100"
                >
                  <img
                    src={showPass ? assets.eye_icon : assets.eye_close_icon}
                    alt=""
                    className="password-toggle-icon h-5 w-5"
                  />
                </button>
              </div>

              {passwordMsg && (
                <p className={`text-sm mt-2 ${passwordMsg.includes('success') ? 'text-green-600' : 'text-red-500'}`}>
                  {passwordMsg}
                </p>
              )}

              <button
                onClick={updatePassword}
                disabled={passwordLoading}
                className={`text-white w-full py-2.5 mt-4 rounded-lg transition-all ${
                  passwordLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-black hover:opacity-90'
                }`}
              >
                {passwordLoading ? 'Updating...' : 'Change Password'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showCrop && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-white p-4 rounded-lg w-[min(92vw,360px)] h-[min(82vh,480px)] flex flex-col">
            {/* Crop Area */}
            <div className="relative flex-1">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1} // 🔒 square image
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            {/* Zoom */}
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="mt-4 w-full"
            />

            {/* Buttons */}
            <div className="flex flex-col-reverse sm:flex-row justify-between items-stretch sm:items-center gap-2 mt-4">
              <button
                onClick={() => {
                  resetCropState();
                }}
                className="px-4 py-2 border rounded w-full sm:w-auto"
              >
                Cancel
              </button>

              <button onClick={saveCroppedImage} className="px-6 py-2 bg-primary text-white rounded-lg w-full sm:w-auto">
                Upload Photo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Profile;
