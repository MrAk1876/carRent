import React, { useEffect, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from '../../../utils/cropImage';
import { assets } from '../../../assets/assets';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';
import { normalizeRole } from '../../../utils/rbac';

const AdminProfile = () => {
  const notify = useNotify();
  const [user, setUser] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [password, setPassword] = useState('');
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState(null);
  const [showCrop, setShowCrop] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const data = localStorage.getItem('user');
    if (!data) return;
    setUser(JSON.parse(data));
  }, []);

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

  const updateProfile = async () => {
    if (!user) return;
    try {
      setSavingProfile(true);
      const payload = {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        address: user.address,
        dob: user.dob ? String(user.dob).split('T')[0] : '',
      };
      const res = await API.put('/user/profile', payload);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      notify.success('Profile updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Update failed'));
    } finally {
      setSavingProfile(false);
    }
  };

  const updatePassword = async () => {
    if (!password) {
      notify.error('Enter new password');
      return;
    }
    try {
      setSavingPassword(true);
      await API.put('/user/password', { password });
      setPassword('');
      notify.success('Password updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Password update failed'));
    } finally {
      setSavingPassword(false);
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

  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Admin';
  const role = normalizeRole(user.role);

  return (
    <>
      <div className="w-full bg-linear-to-br from-slate-100 via-white to-blue-50 px-4 pb-10 pt-10 md:px-10">
        <Title
          title="My Profile"
          subTitle="Manage your account information, profile photo, and security settings."
        />

        <div className="mt-6 grid max-w-6xl grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  onClick={() => document.getElementById('profileUpload')?.click()}
                  className="w-24 h-24 rounded-full border border-borderColor overflow-hidden cursor-pointer"
                >
                  <img
                    src={user.image || assets.user_profile}
                    alt="admin profile"
                    className="w-full h-full object-cover"
                  />
                </div>

                <div>
                  <p className="text-xl font-semibold text-gray-800">{name}</p>
                  <p className="text-sm text-gray-500 mt-1">{user.email}</p>
                  <button
                    type="button"
                    onClick={() => document.getElementById('profileUpload')?.click()}
                    className="mt-2 text-sm px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-medium"
                  >
                    Change Photo
                  </button>
                </div>
              </div>

              <div className="flex gap-2 text-xs">
                <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 uppercase">{role}</span>
                <span
                  className={`px-3 py-1 rounded-full ${
                    user.isProfileComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {user.isProfileComplete ? 'Profile Complete' : 'Incomplete'}
                </span>
              </div>
            </div>

            <input
              id="profileUpload"
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImageSrc(URL.createObjectURL(file));
                setShowCrop(true);
              }}
            />

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">First Name</label>
                <input
                  className="mt-1 border border-borderColor rounded-lg px-3 py-2 w-full"
                  value={user.firstName || ''}
                  onChange={(e) => setUser({ ...user, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Last Name</label>
                <input
                  className="mt-1 border border-borderColor rounded-lg px-3 py-2 w-full"
                  value={user.lastName || ''}
                  onChange={(e) => setUser({ ...user, lastName: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500">Email</label>
                <input
                  className="mt-1 border border-borderColor rounded-lg px-3 py-2 w-full"
                  value={user.email || ''}
                  onChange={(e) => setUser({ ...user, email: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Phone</label>
                <input
                  className="mt-1 border border-borderColor rounded-lg px-3 py-2 w-full"
                  value={user.phone || ''}
                  onChange={(e) => setUser({ ...user, phone: e.target.value })}
                  placeholder="Phone number"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Date of Birth</label>
                <input
                  type="date"
                  className="mt-1 border border-borderColor rounded-lg px-3 py-2 w-full"
                  value={user.dob?.split('T')[0] || ''}
                  onChange={(e) => setUser({ ...user, dob: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500">Address</label>
                <textarea
                  className="mt-1 border border-borderColor rounded-lg px-3 py-2 w-full"
                  rows={3}
                  value={user.address || ''}
                  onChange={(e) => setUser({ ...user, address: e.target.value })}
                  placeholder="Address"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={updateProfile}
              disabled={savingProfile}
              className={`mt-5 w-full md:w-auto px-5 py-2.5 rounded-lg font-medium ${
                savingProfile ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-primary text-white'
              }`}
            >
              {savingProfile ? 'Saving...' : 'Update Profile'}
            </button>
          </div>

          <div className="h-max rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <h3 className="text-lg font-semibold text-gray-800">Security</h3>
            <p className="text-sm text-gray-500 mt-1">Update your account password.</p>

            <div className="relative mt-4">
              <input
                type={showPass ? 'text' : 'password'}
                className="border border-borderColor rounded-lg px-3 py-2.5 w-full pr-12"
                placeholder="New Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPass((prev) => !prev)}
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

            <button
              type="button"
              onClick={updatePassword}
              disabled={savingPassword}
              className={`mt-3 w-full px-4 py-2.5 rounded-lg font-medium ${
                savingPassword ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-black text-white'
              }`}
            >
              {savingPassword ? 'Updating...' : 'Change Password'}
            </button>
          </div>
        </div>
      </div>

      {showCrop && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-white p-4 rounded-lg w-[min(92vw,360px)] h-[min(82vh,480px)] flex flex-col">
            <div className="relative flex-1">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="mt-4 w-full"
            />

            <div className="flex flex-col-reverse sm:flex-row justify-between items-stretch sm:items-center gap-2 mt-4">
              <button onClick={resetCropState} className="px-4 py-2 border rounded w-full sm:w-auto">
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

export default AdminProfile;
