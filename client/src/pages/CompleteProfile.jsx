import React, { useState } from 'react';
import API, { getErrorMessage } from '../api';

const PLACEHOLDER_AVATAR = 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

const CompleteProfile = () => {
  const [form, setForm] = useState({
    phone: '',
    address: '',
    dob: '',
  });

  const [image, setImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const calculateAge = (dob) => {
    const birthDate = new Date(dob);
    const today = new Date();

    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
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

    const dobDate = new Date(form.dob);
    const today = new Date();

    if (dobDate > today) {
      return 'Date of birth cannot be in the future';
    }

    const age = calculateAge(form.dob);
    if (age < 18) {
      return 'You must be at least 18 years old';
    }

    return null;
  };

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

      if (image) {
        formData.append('image', image);
      }

      const res = await API.put('/user/complete-profile', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const old = JSON.parse(localStorage.getItem('user'));
      const updated = { ...old, ...res.data.user };

      localStorage.setItem('user', JSON.stringify(updated));
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
              <input
                type="date"
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                max={new Date().toISOString().split('T')[0]}
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
              />
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
