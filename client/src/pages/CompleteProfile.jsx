import React, { useState } from 'react';
import API, { getErrorMessage } from '../api';

const CompleteProfile = () => {
  const [form, setForm] = useState({
    phone: '',
    address: '',
    dob: '',
  });

  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // calculate age from DOB
  const calculateAge = dob => {
    const birthDate = new Date(dob);
    const today = new Date();

    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();

    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  };

  // validate form
  const validateForm = () => {
    // phone validation
    if (!/^[0-9]{10}$/.test(form.phone)) {
      return 'Phone number must be 10 digits';
    }

    if (!form.dob) {
      return 'Date of birth is required';
    }

    const dobDate = new Date(form.dob);
    const today = new Date();

    // future DOB check
    if (dobDate > today) {
      return 'Date of birth cannot be in the future';
    }

    const age = calculateAge(form.dob);

    if (age < 18) {
      return 'You must be at least 18 years old';
    }

    return null; // valid
  };

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
      formData.append('age', age); // 🔥 auto calculated

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

  return (
    <div className="max-w-md mx-4 sm:mx-auto mt-10 sm:mt-20 bg-white p-5 sm:p-6 rounded-xl shadow">
      <h2 className="text-xl font-semibold mb-4">Complete Your Profile</h2>

      <div className="flex flex-col items-center mb-5">
        <label className="cursor-pointer">
          <div className="w-28 h-28 rounded-full border-2 border-primary overflow-hidden flex items-center justify-center">
            <img src={image ? URL.createObjectURL(image) : 'https://cdn-icons-png.flaticon.com/512/847/847969.png'} className="w-full h-full object-cover" alt="profile" />
          </div>

          <input type="file" accept="image/*" hidden onChange={e => setImage(e.target.files[0])} />
        </label>

        <p className="text-xs text-gray-500 mt-2">Upload profile photo</p>
      </div>

      <input type="text" placeholder="Phone Number" maxLength={10} className="border p-2 w-full mb-3" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} />

      <input type="date" className="border p-2 w-full mb-3" max={new Date().toISOString().split('T')[0]} value={form.dob} onChange={e => setForm({ ...form, dob: e.target.value })} />
      {form.dob && <p className="text-sm text-gray-500 mb-3">Age: {calculateAge(form.dob)} years</p>}

      <textarea placeholder="Address" className="border p-2 w-full mb-3" onChange={e => setForm({ ...form, address: e.target.value })} />
      {errorMsg && <p className="text-red-500 text-sm mb-3">{errorMsg}</p>}

      <button
        onClick={submitProfile}
        disabled={loading}
        className={`w-full py-2 rounded text-white
    ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary'}
  `}
      >
        {loading ? 'Saving...' : 'Save & Continue'}
      </button>
    </div>
  );
};

export default CompleteProfile;
