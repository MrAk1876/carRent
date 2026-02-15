import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assets } from '../../../assets/assets';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';

const ManageCars = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const navigate = useNavigate();
  const [cars, setCars] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionId, setActionId] = useState('');
  const actionButtonBaseClass =
    'inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-2.5 text-xs font-semibold leading-none transition-all';
  const actionIconWrapClass = 'inline-flex h-4 w-4 shrink-0 items-center justify-center';
  const actionIconClass = 'h-3.5 w-3.5 object-contain';

  const fetchOwnerCars = async () => {
    try {
      setLoading(true);
      const res = await API.get('/admin/cars');
      setCars(Array.isArray(res.data) ? res.data : []);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load cars'));
    } finally {
      setLoading(false);
    }
  };

  const toggleCar = async id => {
    try {
      setActionId(id);
      await API.put(`/admin/cars/toggle/${id}`);
      fetchOwnerCars();
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to update car'));
    } finally {
      setActionId('');
    }
  };

  const deleteCar = async id => {
    if (!window.confirm('Delete this car?')) return;

    try {
      setActionId(id);
      await API.delete(`/admin/cars/${id}`);
      fetchOwnerCars();
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Delete failed'));
    } finally {
      setActionId('');
    }
  };

  useEffect(() => {
    fetchOwnerCars();
  }, []);

  const filteredCars = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return cars
      .filter(car => {
        if (statusFilter === 'available') return car.isAvailable;
        if (statusFilter === 'unavailable') return !car.isAvailable;
        return true;
      })
      .filter(car => {
        if (!searchTerm) return true;
        return (
          String(car.name || '')
            .toLowerCase()
            .includes(searchTerm) ||
          String(car.brand || '')
            .toLowerCase()
            .includes(searchTerm) ||
          String(car.model || '')
            .toLowerCase()
            .includes(searchTerm) ||
          String(car.category || '')
            .toLowerCase()
            .includes(searchTerm) ||
          String(car.location || '')
            .toLowerCase()
            .includes(searchTerm)
        );
      });
  }, [cars, search, statusFilter]);

  const stats = useMemo(() => {
    const total = cars.length;
    const available = cars.filter(car => car.isAvailable).length;
    const unavailable = Math.max(total - available, 0);
    const avgPrice = total > 0 ? Math.round(cars.reduce((sum, car) => sum + Number(car.pricePerDay || 0), 0) / total) : 0;
    return { total, available, unavailable, avgPrice };
  }, [cars]);

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title title="Manage Cars" subTitle="Control listing visibility, pricing, and updates for all vehicles from one place." />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 max-w-6xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Cars</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Available</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.available}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Unavailable</p>
          <p className="mt-2 text-2xl font-semibold text-red-600">{stats.unavailable}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Avg. Price / Day</p>
          <p className="mt-2 text-2xl font-semibold text-primary">
            {currency}
            {stats.avgPrice}
          </p>
        </div>
      </div>

      <div className="mt-6 max-w-6xl flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, brand, model, category, or location" className="w-full md:w-107.5 border border-borderColor rounded-lg px-3 py-2 text-sm bg-white" />

        <div className="flex gap-2">
          <button onClick={() => setStatusFilter('all')} className={`px-3 py-2 rounded-lg text-xs font-medium ${statusFilter === 'all' ? 'bg-primary text-white' : 'bg-white border border-borderColor'}`}>
            All
          </button>
          <button onClick={() => setStatusFilter('available')} className={`px-3 py-2 rounded-lg text-xs font-medium ${statusFilter === 'available' ? 'bg-emerald-600 text-white' : 'bg-white border border-borderColor'}`}>
            Available
          </button>
          <button onClick={() => setStatusFilter('unavailable')} className={`px-3 py-2 rounded-lg text-xs font-medium ${statusFilter === 'unavailable' ? 'bg-red-500 text-white' : 'bg-white border border-borderColor'}`}>
            Unavailable
          </button>
        </div>
      </div>

      <div className="admin-section-scroll-shell mt-4">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll admin-section-scroll--free">
          <div className="max-w-6xl w-full rounded-2xl overflow-hidden border border-borderColor bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-245 border-collapse text-left text-sm text-gray-600">
                <thead className="bg-light text-gray-700">
                  <tr>
                    <th className="p-3 font-medium">Car</th>
                    <th className="p-3 font-medium">Category</th>
                    <th className="p-3 font-medium">Price</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr className="border-t border-borderColor">
                      <td className="p-8 text-center text-gray-500" colSpan={5}>
                        Loading cars...
                      </td>
                    </tr>
                  )}

                  {!loading && filteredCars.length === 0 && (
                    <tr className="border-t border-borderColor">
                      <td className="p-8 text-center text-gray-500" colSpan={5}>
                        No cars found for selected filters.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    filteredCars.map(car => (
                      <tr key={car._id} className="border-t border-borderColor">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <img src={car.image} alt="car" className="w-16 h-12 object-cover rounded-md border border-borderColor" />
                            <div>
                              <p className="font-medium text-gray-800">
                                {car.brand} {car.model}
                              </p>
                              <p className="text-xs text-gray-500">
                                {car.seating_capacity} seats | {car.transmission} | {car.location}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-gray-700">{car.category || 'N/A'}</td>
                        <td className="p-3 font-medium text-gray-800">
                          {currency}
                          {car.pricePerDay}
                        </td>
                        <td className="p-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${car.isAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{car.isAvailable ? 'Available' : 'Unavailable'}</span>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => navigate(`/owner/add-car?edit=${car._id}`)} disabled={actionId === car._id} className={`${actionButtonBaseClass} ${actionId === car._id ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`} title="Edit">
                              <span className={actionIconWrapClass}>
                                <img src={assets.edit_icon} alt="edit" className={actionIconClass} />
                              </span>
                              <span>Edit</span>
                            </button>
                            <button onClick={() => toggleCar(car._id)} disabled={actionId === car._id} className={`${actionButtonBaseClass} ${actionId === car._id ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60' : car.isAvailable ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`} title={car.isAvailable ? 'Mark unavailable' : 'Mark available'}>
                              <span className={actionIconWrapClass}>
                                <img src={car.isAvailable ? assets.eye_close_icon : assets.eye_icon} alt="toggle" className={actionIconClass} />
                              </span>
                              <span>{car.isAvailable ? 'Hide' : 'Show'}</span>
                            </button>
                            <button onClick={() => deleteCar(car._id)} disabled={actionId === car._id} className={`${actionButtonBaseClass} ${actionId === car._id ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60' : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'}`} title="Delete">
                              <span className={actionIconWrapClass}>
                                <img src={assets.delete_icon} alt="delete" className={actionIconClass} />
                              </span>
                              <span>Delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default ManageCars;
