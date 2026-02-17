import React from 'react';
import API, { getErrorMessage } from '../api';
import { assets } from '../assets/assets';

const Login = ({ setShowLogin }) => {
  const [state, setState] = React.useState('login');
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState('');

  const isRegister = state === 'register';

  const onSubmitHandler = async (e) => {
    e.preventDefault();

    setLoading(true);
    setErrorMsg('');

    try {
      if (!isRegister) {
        const res = await API.post('/auth/login', {
          email,
          password,
        });

        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));

        setShowLogin(false);

        if (res.data.user.isProfileComplete === false) {
          window.location.href = '/complete-profile';
        }
      } else {
        const res = await API.post('/auth/register', {
          firstName,
          lastName,
          email,
          password,
        });

        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));

        if (res.data.user.isProfileComplete === false) {
          window.location.href = '/complete-profile';
        }

        setState('login');
      }
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Something went wrong'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={() => setShowLogin(false)}
      className="fixed inset-0 z-100 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.35)] md:grid-cols-[1.05fr_1fr]"
      >
        <button
          type="button"
          onClick={() => setShowLogin(false)}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 hover:text-slate-700"
          aria-label="Close login dialog"
        >
          x
        </button>

        <aside className="hidden min-h-full flex-col justify-between bg-linear-to-br from-[#0f244f] via-[#1f4db7] to-[#2d6cea] p-8 text-white md:flex">
          <div>
            <img src={assets.logo} alt="CarRental" className="h-8 brightness-0 invert" />
            <p className="mt-8 text-xs uppercase tracking-[0.2em] text-blue-100">Welcome Back</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">
              Drive smarter with one secure account.
            </h2>
            <p className="mt-4 text-sm text-blue-100/95">
              Access bookings, live rental status, offers, subscriptions, and invoices from one place.
            </p>
          </div>

          <div className="space-y-2 rounded-2xl border border-white/25 bg-white/10 p-4 text-sm backdrop-blur">
            <p className="font-medium">Why this account flow?</p>
            <p className="text-blue-100">1. Secure login with role-based access.</p>
            <p className="text-blue-100">2. Quick profile completion for smoother booking.</p>
            <p className="text-blue-100">3. Real-time tracking after booking confirmation.</p>
          </div>
        </aside>

        <form onSubmit={onSubmitHandler} className="p-6 sm:p-8 md:p-9">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setState('login')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                !isRegister ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setState('register')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                isRegister ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Register
            </button>
          </div>

          <h3 className="mt-5 text-2xl font-semibold text-slate-900">
            {isRegister ? 'Create Your Account' : 'Sign In To Continue'}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {isRegister
              ? 'Use your details to create a new car rental account.'
              : 'Use your email and password to access your dashboard.'}
          </p>

          <div className="mt-6 space-y-4">
            {isRegister ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">First Name</label>
                  <input
                    onChange={(e) => setFirstName(e.target.value)}
                    value={firstName}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Last Name</label>
                  <input
                    onChange={(e) => setLastName(e.target.value)}
                    value={lastName}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"
                    required
                  />
                </div>
              </div>
            ) : null}

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</label>
              <input
                onChange={(e) => setEmail(e.target.value)}
                value={email}
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Password</label>
              <div className="relative mt-1.5">
                <input
                  onChange={(e) => setPassword(e.target.value)}
                  value={password}
                  placeholder={isRegister ? 'Create a strong password' : 'Enter your password'}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-11 text-sm text-slate-700"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <img src={showPassword ? assets.eye_icon : assets.eye_close_icon} alt="" className="h-4 w-4" />
                </button>
              </div>
              {isRegister ? (
                <p className="mt-1 text-[11px] text-slate-500">Use at least 8 characters for better security.</p>
              ) : null}
            </div>
          </div>

          {errorMsg ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMsg}
            </div>
          ) : null}

          <button
            disabled={loading}
            className={`mt-5 w-full rounded-xl py-2.5 text-sm font-medium text-white ${
              loading ? 'cursor-not-allowed bg-slate-400' : 'bg-primary hover:bg-primary-dull'
            }`}
          >
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Login'}
          </button>

          <p className="mt-4 text-center text-sm text-slate-500">
            {isRegister ? 'Already have an account?' : 'Need a new account?'}{' '}
            <button
              type="button"
              onClick={() => setState(isRegister ? 'login' : 'register')}
              className="font-medium text-primary hover:text-primary-dull"
            >
              {isRegister ? 'Login here' : 'Register here'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Login;
