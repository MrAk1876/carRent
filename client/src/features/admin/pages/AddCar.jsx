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

const ALLOWED_CAR_LOCATIONS = [
  'Ahmedabad',
  'Surat',
  'Vadodara',
  'Rajkot',
  'Gandhinagar',
  'Jamnagar',
];
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
  location: '',
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
  'location',
];

const mapCarToForm = (car) => {
  if (!car) return createEmptyCarForm();

  const mapped = createEmptyCarForm();
  CAR_FORM_FIELDS.forEach((field) => {
    mapped[field] = car[field] ?? '';
  });

  if (!ALLOWED_CAR_LOCATIONS.includes(mapped.location)) {
    mapped.location = '';
  }
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

      if (!ALLOWED_CAR_LOCATIONS.includes(car.location)) {
        setErrorMsg('Please select a valid location from the list');
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
    if (!editId) return;
    API.get('/admin/cars').then((res) => {
      const found = res.data.find((item) => item._id === editId);
      if (!found) return;
      const mappedCar = mapCarToForm(found);
      setCar(mappedCar);
      setFeatures(normalizeFeatures(found.features));
      setPreviewUrl(found.image || '');

      const invalidFields = [];
      if (!mappedCar.location) invalidFields.push('location');
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
                >
                  <option value="">Select location</option>
                  {ALLOWED_CAR_LOCATIONS.map((city) => (
                    <option value={city} key={city}>
                      {city}
                    </option>
                  ))}
                </select>
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

