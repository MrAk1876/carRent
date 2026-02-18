import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Title from '../components/Title';
import API, { getErrorMessage } from '../../../api';
import { assets } from '../../../assets/assets';
import ImageCropperModal from '../../../components/ImageCropperModal';

const normalizeFeatures = (arr) => {
  const result = [];
  (arr || []).forEach((feature) => {
    if (typeof feature === 'string' && feature.startsWith('[')) {
      try {
        JSON.parse(feature).forEach((item) => result.push(item));
      } catch {
        result.push(feature);
      }
    } else {
      result.push(feature);
    }
  });
  return [...new Set(result)];
};

const ALLOWED_CAR_CATEGORIES = [
  'Sedan',
  'SUV',
  'Luxury Sedan',
  'Luxury SUV',
  'Premium SUV',
  'Premium Sedan',
  'Compact SUV',
  'Hatchback',
  'Economy SUV',
  'MPV',
  'Sports Car',
  'Premium Hatchback',
  'Adventure SUV',
  'Luxury Adventure SUV',
];

const normalizeStringList = (values = []) =>
  [...new Set((values || []).map((item) => String(item || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

const normalizeBranchCities = (branch) =>
  normalizeStringList([branch?.city, ...(Array.isArray(branch?.serviceCities) ? branch.serviceCities : [])]);

const createEmptyCarForm = () => ({
  name: '',
  brand: '',
  model: '',
  year: '',
  pricePerDay: '',
  category: '',
  transmission: '',
  fuel_type: '',
  seating_capacity: '',
  branchId: '',
  location: '',
  registrationNumber: '',
  chassisNumber: '',
  engineNumber: '',
  purchaseDate: '',
  insuranceExpiry: '',
  pollutionExpiry: '',
  currentMileage: '',
  totalTripsCompleted: '',
  lastServiceDate: '',
});

const CAR_FORM_FIELDS = [
  'name',
  'brand',
  'model',
  'year',
  'pricePerDay',
  'category',
  'transmission',
  'fuel_type',
  'seating_capacity',
  'branchId',
  'location',
  'registrationNumber',
  'chassisNumber',
  'engineNumber',
  'purchaseDate',
  'insuranceExpiry',
  'pollutionExpiry',
  'currentMileage',
  'totalTripsCompleted',
  'lastServiceDate',
];

const DATE_FIELDS = ['purchaseDate', 'insuranceExpiry', 'pollutionExpiry', 'lastServiceDate'];

const toDateInputValue = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const mapCarToForm = (car) => {
  if (!car) return createEmptyCarForm();

  const mapped = createEmptyCarForm();
  CAR_FORM_FIELDS.forEach((field) => {
    if (field === 'branchId') {
      mapped.branchId = typeof car?.branchId === 'object' && car?.branchId?._id
        ? String(car.branchId._id)
        : String(car?.branchId || '');
      return;
    }
    mapped[field] = car[field] ?? '';
  });

  DATE_FIELDS.forEach((field) => {
    mapped[field] = toDateInputValue(mapped[field]);
  });

  if (!ALLOWED_CAR_CATEGORIES.includes(mapped.category)) {
    mapped.category = '';
  }

  return mapped;
};

const AddCar = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');

  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [features, setFeatures] = useState([]);
  const [customFeature, setCustomFeature] = useState('');
  const [rawImage, setRawImage] = useState(null);
  const [showCrop, setShowCrop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [branchOptions, setBranchOptions] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [branchSelectionScoped, setBranchSelectionScoped] = useState(false);
  const [originalBranchId, setOriginalBranchId] = useState('');

  const [car, setCar] = useState(createEmptyCarForm);

  const defaultFeatures = [
    'AC',
    'GPS',
    'Bluetooth',
    'Rear Camera',
    'USB Charging',
    'Airbags',
    'Cruise Control',
    'Touch Screen',
    'Sunroof',
    'ABS',
  ];

  const safeFeatures = useMemo(() => normalizeFeatures(features), [features]);
  const selectedBranch = useMemo(
    () => branchOptions.find((branch) => String(branch?._id || '') === String(car.branchId || '')) || null,
    [branchOptions, car.branchId],
  );
  const locationOptions = useMemo(() => {
    const branchCities = selectedBranch ? normalizeBranchCities(selectedBranch) : [];
    if (car.location) {
      return normalizeStringList([...branchCities, car.location]);
    }
    return branchCities;
  }, [selectedBranch, car.location]);
  const inputClass = 'px-3 py-2 mt-1 border border-borderColor rounded-lg outline-none bg-white w-full';
  const labelClass = 'text-xs font-medium uppercase tracking-wide text-gray-500';

  const closeCropper = () => {
    if (rawImage?.startsWith('blob:')) {
      URL.revokeObjectURL(rawImage);
    }
    setRawImage(null);
    setShowCrop(false);
  };

  const onSubmitHandler = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const formData = new FormData();
      CAR_FORM_FIELDS.forEach((key) => formData.append(key, car[key]));

      const cleanFeatures = normalizeFeatures(features);
      if (cleanFeatures.length < 5) {
        setErrorMsg('Please select at least 5 features');
        setLoading(false);
        return;
      }

      if (!String(car.branchId || '').trim()) {
        setErrorMsg('Please select a branch');
        setLoading(false);
        return;
      }

      if (!String(car.location || '').trim()) {
        setErrorMsg('Please provide a valid location');
        setLoading(false);
        return;
      }
      if (locationOptions.length > 0 && !locationOptions.includes(car.location)) {
        setErrorMsg('Please select a city that belongs to the selected branch');
        setLoading(false);
        return;
      }
      if (!ALLOWED_CAR_CATEGORIES.includes(car.category)) {
        setErrorMsg('Please select a valid category from the list');
        setLoading(false);
        return;
      }

      formData.append('features', JSON.stringify(cleanFeatures));

      if (!editId && !image) {
        setErrorMsg('Please upload car image');
        setLoading(false);
        return;
      }

      if (image) {
        formData.append('image', image);
      }

      if (editId) {
        if (originalBranchId && car.branchId && originalBranchId !== car.branchId) {
          await API.put(`/admin/cars/${editId}/transfer-branch`, { branchId: car.branchId });
        }
        formData.delete('branchId');
        await API.put(`/admin/cars/${editId}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await API.post('/admin/cars', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      window.location.href = '/owner/manage-cars';
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Upload failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadBranchOptions = async () => {
      try {
        setLoadingBranches(true);
        const branchOptionsResult = await API.get('/admin/branch-options', {
          showErrorToast: false,
          cacheTtlMs: 5 * 60 * 1000,
        });
        const scoped = Boolean(branchOptionsResult?.data?.scoped);
        const branches = Array.isArray(branchOptionsResult?.data?.branches) ? branchOptionsResult.data.branches : [];

        if (!cancelled) {
          setBranchSelectionScoped(scoped);
          setBranchOptions(branches);
          if (branches.length === 1) {
            setCar((prev) => (prev.branchId ? prev : { ...prev, branchId: String(branches[0]?._id || '') }));
          }
        }
      } catch {
        if (!cancelled) {
          setBranchSelectionScoped(false);
          setBranchOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingBranches(false);
        }
      }
    };

    loadBranchOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedBranch) return;
    const branchCities = normalizeBranchCities(selectedBranch);
    if (branchCities.length === 0) return;
    if (car.location) return;
    setCar((prev) => ({
      ...prev,
      location: branchCities[0],
    }));
  }, [selectedBranch, car.location]);

  useEffect(() => {
    if (!editId) return;
    API.get('/admin/cars', { showErrorToast: false }).then((res) => {
      const found = res.data.find((item) => item._id === editId);
      if (!found) return;
      const mappedCar = mapCarToForm(found);
      setCar(mappedCar);
      setOriginalBranchId(String(mappedCar.branchId || ''));
      setFeatures(normalizeFeatures(found.features));
      setPreviewUrl(found.image || '');

      const invalidFields = [];
      if (!mappedCar.category) invalidFields.push('category');
      if (invalidFields.length > 0) {
        setErrorMsg(
          `This car has an old ${invalidFields.join(' and ')} value. Please select from the updated list.`
        );
      }
    });
  }, [editId]);

  useEffect(() => {
    if (!image) return undefined;
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  return (
    <>
      <div className="px-4 py-10 md:px-10 flex-1">
        <Title
          title={editId ? 'Edit Car' : 'Add New Car'}
          subTitle="Create complete, polished car listings with pricing, specs, and must-have features."
        />

        <form onSubmit={onSubmitHandler} className="mt-6 max-w-6xl space-y-5">
          <div className="rounded-2xl border border-borderColor bg-white p-5 md:p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-800">Car Media</p>
                <p className="text-xs text-gray-500 mt-1">
                  Upload a clear front or 3/4-angle car image for better conversions.
                </p>
              </div>
              {editId && (
                <span className="text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                  Editing Existing Car
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <button
                type="button"
                onClick={() => document.getElementById('car-img')?.click()}
                className="w-40 h-24 border border-dashed border-borderColor rounded-xl overflow-hidden bg-light hover:opacity-90"
              >
                <img
                  src={previewUrl || assets.upload_icon}
                  className="w-full h-full object-cover"
                  alt="car upload preview"
                />
              </button>

              <div>
                <p className="text-sm text-gray-600">Tap the image card to upload and crop.</p>
                <p className="text-xs text-gray-500 mt-1">
                  Recommended: landscape orientation, high resolution, clean background.
                </p>
              </div>
            </div>

            <input
              type="file"
              id="car-img"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (rawImage?.startsWith('blob:')) {
                  URL.revokeObjectURL(rawImage);
                }
                setRawImage(URL.createObjectURL(file));
                setShowCrop(true);
              }}
            />
          </div>

          <div className="rounded-2xl border border-borderColor bg-white p-5 md:p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-800 mb-4">Basic Information</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Car Name</label>
                <input
                  type="text"
                  placeholder="e.g. BMW X5"
                  required
                  className={inputClass}
                  value={car.name}
                  onChange={(e) => setCar({ ...car, name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Brand</label>
                <input
                  type="text"
                  placeholder="e.g. BMW"
                  required
                  className={inputClass}
                  value={car.brand}
                  onChange={(e) => setCar({ ...car, brand: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Model</label>
                <input
                  type="text"
                  placeholder="e.g. X5"
                  required
                  className={inputClass}
                  value={car.model}
                  onChange={(e) => setCar({ ...car, model: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Year</label>
                <input
                  type="number"
                  placeholder="2025"
                  required
                  className={inputClass}
                  value={car.year}
                  onChange={(e) => setCar({ ...car, year: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Daily Price ({currency})</label>
                <input
                  type="number"
                  placeholder="100"
                  required
                  className={inputClass}
                  value={car.pricePerDay}
                  onChange={(e) => setCar({ ...car, pricePerDay: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Category</label>
                <select
                  onChange={(e) => setCar({ ...car, category: e.target.value })}
                  value={car.category}
                  className={inputClass}
                  required
                >
                  <option value="">Select category</option>
                  {ALLOWED_CAR_CATEGORIES.map((category) => (
                    <option value={category} key={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Branch</label>
                <select
                  value={car.branchId}
                  onChange={(e) => setCar({ ...car, branchId: e.target.value, location: '' })}
                  className={inputClass}
                  required
                  disabled={loadingBranches || (branchSelectionScoped && branchOptions.length <= 1)}
                >
                  <option value="">
                    {loadingBranches
                      ? 'Loading branches...'
                      : branchOptions.length
                      ? 'Select branch'
                      : 'No branch available'}
                  </option>
                  {branchOptions.map((branch) => (
                    <option value={branch._id} key={branch._id}>
                      {branch.branchName} {branch.state ? `(${branch.state})` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  {branchSelectionScoped
                    ? 'Your role is scoped to assigned branch options.'
                    : 'Choose the branch first to load allowed cities.'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-borderColor bg-white p-5 md:p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-800 mb-4">Technical Specs</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className={labelClass}>Transmission</label>
                <select
                  onChange={(e) => setCar({ ...car, transmission: e.target.value })}
                  value={car.transmission}
                  className={inputClass}
                >
                  <option value="">Select transmission</option>
                  <option value="Automatic">Automatic</option>
                  <option value="Manual">Manual</option>
                  <option value="Semi Automatic">Semi Automatic</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Fuel Type</label>
                <select
                  onChange={(e) => setCar({ ...car, fuel_type: e.target.value })}
                  value={car.fuel_type}
                  className={inputClass}
                >
                  <option value="">Select fuel type</option>
                  <option value="Petrol">Petrol</option>
                  <option value="Diesel">Diesel</option>
                  <option value="EV">EV</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Seating Capacity</label>
                <input
                  type="number"
                  placeholder="4"
                  required
                  className={inputClass}
                  value={car.seating_capacity}
                  onChange={(e) => setCar({ ...car, seating_capacity: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Location</label>
                <select
                  onChange={(e) => setCar({ ...car, location: e.target.value })}
                  value={car.location}
                  className={inputClass}
                  required
                  disabled={!car.branchId || locationOptions.length === 0}
                >
                  <option value="">
                    {!car.branchId
                      ? 'Select branch first'
                      : locationOptions.length
                      ? 'Select city'
                      : 'No city mapped for this branch'}
                  </option>
                  {locationOptions.map((city) => (
                    <option value={city} key={city}>
                      {city}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  {locationOptions.length
                    ? 'City options are loaded from selected branch.'
                    : 'Branch has no configured city list yet.'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-borderColor bg-white p-5 md:p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-800 mb-4">Fleet Metadata (Optional)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Registration Number</label>
                <input
                  type="text"
                  placeholder="e.g. GJ01AB1234"
                  className={inputClass}
                  value={car.registrationNumber}
                  onChange={(e) => setCar({ ...car, registrationNumber: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Chassis Number</label>
                <input
                  type="text"
                  placeholder="Vehicle chassis number"
                  className={inputClass}
                  value={car.chassisNumber}
                  onChange={(e) => setCar({ ...car, chassisNumber: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Engine Number</label>
                <input
                  type="text"
                  placeholder="Vehicle engine number"
                  className={inputClass}
                  value={car.engineNumber}
                  onChange={(e) => setCar({ ...car, engineNumber: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Purchase Date</label>
                <input
                  type="date"
                  className={inputClass}
                  value={car.purchaseDate}
                  onChange={(e) => setCar({ ...car, purchaseDate: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Insurance Expiry</label>
                <input
                  type="date"
                  className={inputClass}
                  value={car.insuranceExpiry}
                  onChange={(e) => setCar({ ...car, insuranceExpiry: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Pollution Expiry</label>
                <input
                  type="date"
                  className={inputClass}
                  value={car.pollutionExpiry}
                  onChange={(e) => setCar({ ...car, pollutionExpiry: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Current Mileage</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 10250"
                  className={inputClass}
                  value={car.currentMileage}
                  onChange={(e) => setCar({ ...car, currentMileage: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Total Trips Completed</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 12"
                  className={inputClass}
                  value={car.totalTripsCompleted}
                  onChange={(e) => setCar({ ...car, totalTripsCompleted: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Last Service Date</label>
                <input
                  type="date"
                  className={inputClass}
                  value={car.lastServiceDate}
                  onChange={(e) => setCar({ ...car, lastServiceDate: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-borderColor bg-white p-5 md:p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-800">Features</p>
              <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
                Selected: {safeFeatures.length} (Min 5)
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {[...new Set([...defaultFeatures, ...safeFeatures])].map((item) => (
                <label
                  key={item}
                  className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer ${
                    safeFeatures.includes(item)
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-borderColor bg-white text-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={safeFeatures.includes(item)}
                    onChange={() =>
                      setFeatures((prev) =>
                        prev.includes(item) ? prev.filter((feature) => feature !== item) : [...prev, item]
                      )
                    }
                  />
                  {item}
                </label>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
              <input
                value={customFeature}
                onChange={(e) => setCustomFeature(e.target.value)}
                placeholder="Add custom feature"
                className="border border-borderColor rounded-lg px-3 py-2"
              />
              <button
                type="button"
                onClick={() => {
                  const cleaned = customFeature.trim();
                  if (!cleaned) return;
                  setFeatures((prev) => [...new Set([...prev, cleaned])]);
                  setCustomFeature('');
                }}
                className="bg-gray-800 text-white rounded-lg px-4 py-2 text-sm font-medium"
              >
                Add Feature
              </button>
            </div>
          </div>

          {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}

          <button
            type="submit"
            disabled={loading}
            className={`flex items-center gap-2 px-5 py-3 rounded-lg font-medium ${
              loading ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-primary text-white'
            }`}
          >
            <img src={assets.tick_icon} alt="" />
            {loading ? 'Saving...' : editId ? 'Update Car' : 'List Car'}
          </button>
        </form>
      </div>

      {showCrop && (
        <ImageCropperModal
          imageSrc={rawImage}
          aspect={4 / 3}
          outputSize={800}
          onCancel={closeCropper}
          onSave={(blob) => {
            const file = new File([blob], 'car.jpg', { type: 'image/jpeg' });
            setImage(file);
            closeCropper();
          }}
        />
      )}
    </>
  );
};

export default AddCar;

