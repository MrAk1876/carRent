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

  const onSubmitHandler = async e => {
    e.preventDefault();

    setLoading(true);
    setErrorMsg('');

    try {
      if (state === 'login') {
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
    <div onClick={() => setShowLogin(false)} className="fixed top-0 bottom-0 left-0 right-0 z-100 flex items-center text-sm text-gray-600 bg-black/50">
      <form onSubmit={onSubmitHandler} onClick={e => e.stopPropagation()} className="flex flex-col gap-4 m-auto items-start p-8 py-12 w-80 sm:w-88 text-gray-500 rounded-lg shadow-xl border border-gray-200 bg-white">
        <p className="text-2xl font-medium m-auto">
          <span className="text-primary">User</span> {state === 'login' ? 'Login' : 'Sign Up'}
        </p>
        {state === 'register' && (
          <>
            <div className="w-full">
              <p>First Name</p>
              <input onChange={e => setFirstName(e.target.value)} value={firstName} className="border border-gray-200 rounded w-full p-2 mt-1 outline-primary" required />
            </div>

            <div className="w-full">
              <p>Last Name</p>
              <input onChange={e => setLastName(e.target.value)} value={lastName} className="border border-gray-200 rounded w-full p-2 mt-1 outline-primary" required />
            </div>
          </>
        )}
        <div className="w-full ">
          <p>Email</p>
          <input onChange={e => setEmail(e.target.value)} value={email} placeholder="type here" className="border border-gray-200 rounded w-full p-2 mt-1 outline-primary" type="email" required />
        </div>
        <div className="w-full ">
          <p>Password</p>
          <div className="relative mt-1">
            <input
              onChange={e => setPassword(e.target.value)}
              value={password}
              placeholder="type here"
              className="border border-gray-200 rounded w-full p-2 pr-11 outline-primary"
              type={showPassword ? 'text' : 'password'}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(prev => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <img src={showPassword ? assets.eye_icon : assets.eye_close_icon} alt="" className="w-4 h-4" />
            </button>
          </div>
        </div>
        {state === 'register' ? (
          <p>
            Already have account?{' '}
            <span onClick={() => setState('login')} className="text-primary cursor-pointer">
              click here
            </span>
          </p>
        ) : (
          <p>
            Create an account?{' '}
            <span onClick={() => setState('register')} className="text-primary cursor-pointer">
              click here
            </span>
          </p>
        )}
        {errorMsg && <p className="text-red-500 text-sm text-center w-full">{errorMsg}</p>}
        <button
          disabled={loading}
          className={`bg-primary text-white w-full py-2 rounded-md cursor-pointer
  ${loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-800 transition-all'}`}
        >
          {loading ? 'Please wait...' : state === 'register' ? 'Create Account' : 'Login'}
        </button>
      </form>
    </div>
  );
};

export default Login;
