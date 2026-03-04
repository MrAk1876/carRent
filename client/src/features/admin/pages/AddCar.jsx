import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Title from '../components/Title';
import API, { getErrorMessage } from '../../../api';
import { assets } from '../../../assets/assets';
import ImageCropperModal from '../../../components/ImageCropperModal';
import useNotify from '../../../hooks/useNotify';
import UniversalCalendarInput from '../../../components/UniversalCalendarInput';
import { getUser } from '../../../utils/auth';
import { ROLES } from '../../../utils/rbac';

const normalizeCompactText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trimStart();

const finalizeCompactText = (value) => normalizeCompactText(value).trim();

const normalizeUpperCodeText = (value) => normalizeCompactText(value).toUpperCase();

const normalizeFeatures = (arr) => {
  const result = [];
  (arr || []).forEach((feature) => {
    if (typeof feature === 'string' && feature.startsWith('[')) {
      try {
        JSON.parse(feature).forEach((item) => result.push(finalizeCompactText(item)));
      } catch {
        result.push(finalizeCompactText(feature));
      }
    } else {
      result.push(finalizeCompactText(feature));
    }
  });
  return [...new Set(result)];
};

const DEFAULT_CAR_CATEGORIES = [
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
const CAR_UPLOAD_TIMEOUT_MS = 120000;
const MAX_CAR_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/webp',
]);

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
const MIN_MODEL_YEAR = 1980;
const REGISTRATION_MIN_LENGTH = 6;
const REGISTRATION_NUMBER_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/;
const ADD_LOCATION_OPTION_VALUE = '__ADD_NEW_LOCATION__';
const ADD_CATEGORY_OPTION_VALUE = '__ADD_NEW_CATEGORY__';

const normalizeRegistrationNumber = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 15);

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
  mapped.name = finalizeCompactText(mapped.name);
  mapped.brand = finalizeCompactText(mapped.brand);
  mapped.model = finalizeCompactText(mapped.model);
  mapped.location = finalizeCompactText(mapped.location);
  mapped.year = mapped.year ? String(mapped.year) : '';
  mapped.registrationNumber = normalizeRegistrationNumber(mapped.registrationNumber);
  mapped.chassisNumber = normalizeUpperCodeText(mapped.chassisNumber).trim();
  mapped.engineNumber = normalizeUpperCodeText(mapped.engineNumber).trim();

  return mapped;
};

const AddCar = () => {
  const notify = useNotify();
  const navigate = useNavigate();
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const currentRole = getUser()?.role;
  const canManageBranchLocations = [ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN].includes(currentRole);
  const canManageCategories = [ROLES.SUPER_ADMIN].includes(currentRole);
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
  const [categoryOptions, setCategoryOptions] = useState(DEFAULT_CAR_CATEGORIES);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [categoryDialogDraft, setCategoryDialogDraft] = useState('');
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [locationDialogDraft, setLocationDialogDraft] = useState('');
  const [modelYearPickerOpen, setModelYearPickerOpen] = useState(false);
  const modelYearPickerRef = useRef(null);
  const modelYearToggleRef = useRef(null);
  const categoryDialogInputRef = useRef(null);
  const locationDialogInputRef = useRef(null);

  const [car, setCar] = useState(createEmptyCarForm);
  const todayDateKey = useMemo(() => dayjs().startOf('day').format('YYYY-MM-DD'), []);
  const tomorrowDateKey = useMemo(
    () => dayjs().startOf('day').add(1, 'day').format('YYYY-MM-DD'),
    [],
  );

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
  const modelYearOptions = useMemo(() => {
    const currentYear = dayjs().year();
    const years = [];
    for (let year = currentYear + 1; year >= MIN_MODEL_YEAR; year -= 1) {
      years.push(year);
    }

    const selectedYear = Number(car.year);
    if (Number.isFinite(selectedYear) && !years.includes(selectedYear)) {
      years.push(selectedYear);
      years.sort((a, b) => b - a);
    }

    return years;
  }, [car.year]);
  const modelYearMin = useMemo(() => MIN_MODEL_YEAR, []);
  const modelYearMax = useMemo(() => dayjs().year() + 1, []);
  const minFutureExpiryDate = useMemo(() => {
    const tomorrow = dayjs(tomorrowDateKey).startOf('day');
    const purchase = dayjs(car.purchaseDate);

    if (!purchase.isValid()) {
      return tomorrow.format('YYYY-MM-DD');
    }

    const purchasePlusOne = purchase.startOf('day').add(1, 'day');
    return purchasePlusOne.isAfter(tomorrow, 'day')
      ? purchasePlusOne.format('YYYY-MM-DD')
      : tomorrow.format('YYYY-MM-DD');
  }, [car.purchaseDate, tomorrowDateKey]);
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
  const categoryOptionsForSelect = useMemo(
    () => normalizeStringList([...categoryOptions, car.category]),
    [categoryOptions, car.category],
  );
  const inputClass = 'px-3 py-2 mt-1 border border-borderColor rounded-lg outline-none bg-white w-full';
  const labelClass = 'text-xs font-medium uppercase tracking-wide text-gray-500';

  const closeCropper = () => {
    if (rawImage?.startsWith('blob:')) {
      URL.revokeObjectURL(rawImage);
    }
    setRawImage(null);
    setShowCrop(false);
  };

  const reportSubmitError = (message) => {
    const safeMessage = String(message || '').trim();
    if (!safeMessage) return;
    setErrorMsg(safeMessage);
    notify.error(safeMessage);
  };

  const syncBranchOption = (updatedBranch) => {
    const branchId = String(updatedBranch?._id || '').trim();
    if (!branchId) return;

    setBranchOptions((previous) => {
      const next = Array.isArray(previous) ? [...previous] : [];
      const index = next.findIndex((branch) => String(branch?._id || '') === branchId);
      if (index >= 0) {
        next[index] = updatedBranch;
      } else {
        next.push(updatedBranch);
      }
      return next.sort((left, right) =>
        String(left?.branchName || '').localeCompare(String(right?.branchName || '')),
      );
    });
  };

  const syncCategoryOptions = (nextCategories) => {
    const normalized = normalizeStringList(nextCategories);
    setCategoryOptions(normalized.length ? normalized : DEFAULT_CAR_CATEGORIES);
  };

  const loadCategoryOptions = async () => {
    try {
      setLoadingCategories(true);
      const response = await API.get('/admin/categories', {
        showErrorToast: false,
        cacheTtlMs: 5 * 60 * 1000,
      });
      const categories = Array.isArray(response?.data?.categories)
        ? response.data.categories.map((entry) => String(entry?.name || entry).trim())
        : [];
      syncCategoryOptions(categories);
    } catch {
      syncCategoryOptions(DEFAULT_CAR_CATEGORIES);
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleCreateCategory = async (categoryInput) => {
    const categoryName = finalizeCompactText(categoryInput);
    if (!categoryName) {
      reportSubmitError('Enter a category name');
      return false;
    }

    try {
      setCreatingCategory(true);
      const response = await API.post(
        '/admin/categories',
        { name: categoryName },
        { showErrorToast: false },
      );
      const nextCategory = finalizeCompactText(response?.data?.category || categoryName);
      syncCategoryOptions([...categoryOptionsForSelect, nextCategory]);
      setCar((previous) => ({ ...previous, category: nextCategory }));
      notify.success(response?.data?.message || 'Category saved');
      return true;
    } catch (error) {
      reportSubmitError(getErrorMessage(error, 'Failed to add category'));
      return false;
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleCategorySelection = async (nextCategoryValue) => {
    const selectedValue = String(nextCategoryValue || '');
    if (!selectedValue) {
      setCar((previous) => ({ ...previous, category: '' }));
      return;
    }

    if (selectedValue !== ADD_CATEGORY_OPTION_VALUE) {
      setCar((previous) => ({ ...previous, category: selectedValue }));
      return;
    }

    if (!canManageCategories || creatingCategory) {
      return;
    }
    setCategoryDialogDraft('');
    setShowCategoryDialog(true);
  };

  const closeCategoryDialog = () => {
    if (creatingCategory) return;
    setShowCategoryDialog(false);
    setCategoryDialogDraft('');
  };

  const submitCategoryDialog = async () => {
    const success = await handleCreateCategory(categoryDialogDraft);
    if (success) {
      setShowCategoryDialog(false);
      setCategoryDialogDraft('');
    }
  };

  const handleCreateLocation = async (locationInput) => {
    const branchId = String(car.branchId || '').trim();
    const locationName = finalizeCompactText(locationInput);
    if (!branchId) {
      reportSubmitError('Select a branch before adding a location');
      return false;
    }
    if (!locationName) {
      reportSubmitError('Enter a location name');
      return false;
    }

    try {
      setCreatingLocation(true);
      const response = await API.post(
        '/admin/locations',
        { branchId, name: locationName },
        { showErrorToast: false },
      );
      const nextBranch = response?.data?.branch;
      const nextLocation = finalizeCompactText(response?.data?.location || locationName);
      if (nextBranch?._id) {
        syncBranchOption(nextBranch);
      }
      setCar((previous) => ({ ...previous, location: nextLocation }));
      notify.success(response?.data?.message || 'Location saved');
      return true;
    } catch (error) {
      reportSubmitError(getErrorMessage(error, 'Failed to add location'));
      return false;
    } finally {
      setCreatingLocation(false);
    }
  };

  const handleLocationSelection = async (nextLocationValue) => {
    const selectedValue = String(nextLocationValue || '');
    if (!selectedValue) {
      setCar((previous) => ({ ...previous, location: '' }));
      return;
    }

    if (selectedValue !== ADD_LOCATION_OPTION_VALUE) {
      setCar((previous) => ({ ...previous, location: selectedValue }));
      return;
    }

    if (!canManageBranchLocations || creatingLocation) {
      return;
    }
    setLocationDialogDraft('');
    setShowLocationDialog(true);
  };

  const closeLocationDialog = () => {
    if (creatingLocation) return;
    setShowLocationDialog(false);
    setLocationDialogDraft('');
  };

  const submitLocationDialog = async () => {
    const success = await handleCreateLocation(locationDialogDraft);
    if (success) {
      setShowLocationDialog(false);
      setLocationDialogDraft('');
    }
  };

  const onSubmitHandler = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const formData = new FormData();

      const cleanFeatures = normalizeFeatures(features);
      if (cleanFeatures.length < 5) {
        reportSubmitError('Please select at least 5 features');
        setLoading(false);
        return;
      }

      if (!String(car.branchId || '').trim()) {
        reportSubmitError('Please select a branch');
        setLoading(false);
        return;
      }

      if (!String(car.location || '').trim()) {
        reportSubmitError('Please provide a valid location');
        setLoading(false);
        return;
      }

      const normalizedLocation = finalizeCompactText(car.location);
      const branchCities = selectedBranch ? normalizeBranchCities(selectedBranch) : [];
      const matchedBranchCity =
        branchCities.length > 0
          ? branchCities.find((city) => city.toLowerCase() === normalizedLocation.toLowerCase())
          : normalizedLocation;

      if (branchCities.length > 0 && !matchedBranchCity) {
        reportSubmitError('Please select a city that belongs to the selected branch');
        setLoading(false);
        return;
      }

      const normalizedCategory = finalizeCompactText(car.category);
      if (!normalizedCategory || !categoryOptionsForSelect.includes(normalizedCategory)) {
        reportSubmitError('Please select a valid category from the list');
        setLoading(false);
        return;
      }

      const parsedModelYear = Number(car.year);
      if (
        !Number.isInteger(parsedModelYear) ||
        parsedModelYear < modelYearMin ||
        parsedModelYear > modelYearMax
      ) {
        reportSubmitError(`Please select a valid model year between ${modelYearMin} and ${modelYearMax}.`);
        setLoading(false);
        return;
      }

      const normalizedRegistrationNumber = normalizeRegistrationNumber(car.registrationNumber);
      if (
        normalizedRegistrationNumber &&
        (normalizedRegistrationNumber.length < REGISTRATION_MIN_LENGTH ||
          !REGISTRATION_NUMBER_PATTERN.test(normalizedRegistrationNumber))
      ) {
        reportSubmitError('Vehicle number must be valid (example: GJ05KZ2025).');
        setLoading(false);
        return;
      }

      const preparedCar = {
        ...car,
        name: finalizeCompactText(car.name),
        brand: finalizeCompactText(car.brand),
        model: finalizeCompactText(car.model),
        category: normalizedCategory,
        location: normalizedLocation,
        chassisNumber: normalizeUpperCodeText(car.chassisNumber).trim(),
        engineNumber: normalizeUpperCodeText(car.engineNumber).trim(),
        year: String(parsedModelYear),
        registrationNumber: normalizedRegistrationNumber,
      };

      const today = dayjs(todayDateKey).startOf('day');
      const purchaseDateValue = preparedCar.purchaseDate ? dayjs(preparedCar.purchaseDate).startOf('day') : null;
      const insuranceExpiryValue = preparedCar.insuranceExpiry ? dayjs(preparedCar.insuranceExpiry).startOf('day') : null;
      const pollutionExpiryValue = preparedCar.pollutionExpiry ? dayjs(preparedCar.pollutionExpiry).startOf('day') : null;
      const lastServiceDateValue = preparedCar.lastServiceDate ? dayjs(preparedCar.lastServiceDate).startOf('day') : null;

      if (purchaseDateValue && (!purchaseDateValue.isValid() || purchaseDateValue.isAfter(today, 'day'))) {
        reportSubmitError('Purchase date must be today or a past date.');
        setLoading(false);
        return;
      }

      if (lastServiceDateValue && (!lastServiceDateValue.isValid() || lastServiceDateValue.isAfter(today, 'day'))) {
        reportSubmitError('Last service date must be today or a past date.');
        setLoading(false);
        return;
      }

      if (insuranceExpiryValue && (!insuranceExpiryValue.isValid() || !insuranceExpiryValue.isAfter(today, 'day'))) {
        reportSubmitError('Insurance expiry must be a future date.');
        setLoading(false);
        return;
      }

      if (pollutionExpiryValue && (!pollutionExpiryValue.isValid() || !pollutionExpiryValue.isAfter(today, 'day'))) {
        reportSubmitError('Pollution expiry must be a future date.');
        setLoading(false);
        return;
      }

      if (purchaseDateValue && insuranceExpiryValue && insuranceExpiryValue.isBefore(purchaseDateValue, 'day')) {
        reportSubmitError('Insurance expiry cannot be before purchase date.');
        setLoading(false);
        return;
      }

      if (purchaseDateValue && pollutionExpiryValue && pollutionExpiryValue.isBefore(purchaseDateValue, 'day')) {
        reportSubmitError('Pollution expiry cannot be before purchase date.');
        setLoading(false);
        return;
      }

      if (purchaseDateValue && lastServiceDateValue && lastServiceDateValue.isBefore(purchaseDateValue, 'day')) {
        reportSubmitError('Last service date cannot be before purchase date.');
        setLoading(false);
        return;
      }

      CAR_FORM_FIELDS.forEach((key) => formData.append(key, preparedCar[key]));
      formData.set('location', matchedBranchCity || normalizedLocation);

      formData.append('features', JSON.stringify(cleanFeatures));

      if (!editId && !image) {
        reportSubmitError('Please upload car image');
        setLoading(false);
        return;
      }

      if (image) {
        formData.append('image', image);
      }

      if (editId) {
        if (originalBranchId && car.branchId && originalBranchId !== car.branchId) {
          await API.put(
            `/admin/cars/${editId}/transfer-branch`,
            { branchId: car.branchId },
            { showErrorToast: false },
          );
        }
        formData.delete('branchId');
        await API.put(`/admin/cars/${editId}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: CAR_UPLOAD_TIMEOUT_MS,
          showErrorToast: false,
        });
      } else {
        await API.post('/admin/cars', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: CAR_UPLOAD_TIMEOUT_MS,
          showErrorToast: false,
        });
      }

      notify.success(editId ? 'Car updated successfully' : 'Car added successfully');
      navigate('/owner/manage-cars');
    } catch (error) {
      reportSubmitError(getErrorMessage(error, 'Upload failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategoryOptions();
  }, []);

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

  useEffect(() => {
    if (!modelYearPickerOpen) return undefined;

    const handlePointerDown = (event) => {
      const pickerNode = modelYearPickerRef.current;
      const toggleNode = modelYearToggleRef.current;
      if (pickerNode && pickerNode.contains(event.target)) return;
      if (toggleNode && toggleNode.contains(event.target)) return;
      setModelYearPickerOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setModelYearPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [modelYearPickerOpen]);

  useEffect(() => {
    if (!showCategoryDialog) return undefined;
    const timeoutId = setTimeout(() => {
      categoryDialogInputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [showCategoryDialog]);

  useEffect(() => {
    if (!showLocationDialog) return undefined;
    const timeoutId = setTimeout(() => {
      locationDialogInputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [showLocationDialog]);

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
                  const normalizedMime = String(file.type || '').toLowerCase();
                  if (normalizedMime && !ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)) {
                    reportSubmitError('Only PNG, JPG, JPEG, and WEBP images are allowed.');
                    e.target.value = '';
                    return;
                  }
                  if (file.size > MAX_CAR_IMAGE_SIZE_BYTES) {
                    reportSubmitError('Image size must be 5MB or less.');
                    e.target.value = '';
                    return;
                  }
                  setErrorMsg('');
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
                  onChange={(e) => setCar({ ...car, name: normalizeCompactText(e.target.value) })}
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
                  onChange={(e) => setCar({ ...car, brand: normalizeCompactText(e.target.value) })}
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
                  onChange={(e) => setCar({ ...car, model: normalizeCompactText(e.target.value) })}
                />
              </div>
              <div>
                <label className={labelClass}>Year</label>
                <div className="relative mt-1">
                  <button
                    ref={modelYearToggleRef}
                    type="button"
                    className="w-full rounded-lg border border-borderColor bg-white px-3 py-2 text-left text-sm text-gray-700 shadow-sm transition-colors hover:border-primary/40"
                    onClick={() => setModelYearPickerOpen((previous) => !previous)}
                    aria-expanded={modelYearPickerOpen}
                    aria-haspopup="listbox"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={car.year ? 'font-medium text-gray-800' : 'text-gray-500'}>
                        {car.year || 'Select model year'}
                      </span>
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
                        <img src={assets.calendar_icon_colored} alt="calendar" className="h-3.5 w-3.5 object-contain" />
                      </span>
                    </span>
                  </button>

                  {modelYearPickerOpen ? (
                    <div
                      ref={modelYearPickerRef}
                      role="listbox"
                      className="absolute z-30 mt-2 w-full min-w-[260px] rounded-xl border border-borderColor bg-white p-2 shadow-[0_16px_28px_rgba(15,23,42,0.18)]"
                    >
                      <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                        Model Year
                      </p>
                      <div className="max-h-52 overflow-y-auto pr-1">
                        <div className="grid grid-cols-4 gap-1.5">
                          {modelYearOptions.map((year) => {
                            const selected = String(year) === String(car.year || '');
                            return (
                              <button
                                key={`model-year-${year}`}
                                type="button"
                                onClick={() => {
                                  setCar((previous) => ({ ...previous, year: String(year) }));
                                  setModelYearPickerOpen(false);
                                }}
                                className={`rounded-md border px-1.5 py-1.5 text-xs font-semibold transition-colors ${
                                  selected
                                    ? 'border-primary bg-primary text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {year}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
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
                  onChange={(event) => handleCategorySelection(event.target.value)}
                  value={car.category}
                  className={inputClass}
                  required
                >
                  <option value="">
                    {loadingCategories
                      ? 'Loading categories...'
                      : categoryOptionsForSelect.length
                        ? 'Select category'
                        : 'No category available'}
                  </option>
                  {categoryOptionsForSelect.map((category) => (
                    <option value={category} key={category}>
                      {category}
                    </option>
                  ))}
                  {canManageCategories ? (
                    <option value={ADD_CATEGORY_OPTION_VALUE} disabled={creatingCategory}>
                      {creatingCategory ? 'Adding category...' : '+ Add new category'}
                    </option>
                  ) : null}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  {categoryOptionsForSelect.length
                    ? 'Categories are tenant-wide and shared across fleet.'
                    : canManageCategories
                      ? 'No categories found. Use "+ Add new category" in dropdown.'
                      : 'No categories available. Ask SuperAdmin to create categories.'}
                </p>
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
                  required
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
                  required
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
                  onChange={(event) => handleLocationSelection(event.target.value)}
                  value={car.location}
                  className={inputClass}
                  required
                  disabled={!car.branchId}
                >
                  <option value="">
                    {!car.branchId
                      ? 'Select branch first'
                      : locationOptions.length
                        ? 'Select location'
                        : 'No location available'}
                  </option>
                  {locationOptions.map((city) => (
                    <option value={city} key={city}>
                      {city}
                    </option>
                  ))}
                  {canManageBranchLocations ? (
                    <option value={ADD_LOCATION_OPTION_VALUE} disabled={creatingLocation}>
                      {creatingLocation ? 'Adding location...' : '+ Add new location'}
                    </option>
                  ) : null}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  {locationOptions.length
                    ? 'Locations are loaded from selected branch.'
                    : canManageBranchLocations
                      ? 'No locations found for this branch. Use "+ Add new location" in dropdown.'
                      : 'No locations found for this branch.'}
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
                  onChange={(e) =>
                    setCar((previous) => ({
                      ...previous,
                      registrationNumber: normalizeRegistrationNumber(e.target.value),
                    }))
                  }
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Auto-formatted in uppercase (example: GJ05KZ2025).
                </p>
              </div>
              <div>
                <label className={labelClass}>Chassis Number</label>
                <input
                  type="text"
                  placeholder="Vehicle chassis number"
                  className={inputClass}
                  value={car.chassisNumber}
                  onChange={(e) => setCar({ ...car, chassisNumber: normalizeUpperCodeText(e.target.value) })}
                />
              </div>
              <div>
                <label className={labelClass}>Engine Number</label>
                <input
                  type="text"
                  placeholder="Vehicle engine number"
                  className={inputClass}
                  value={car.engineNumber}
                  onChange={(e) => setCar({ ...car, engineNumber: normalizeUpperCodeText(e.target.value) })}
                />
              </div>
              <div>
                <label className={labelClass}>Purchase Date</label>
                <UniversalCalendarInput
                  mode="single"
                  variant="form"
                  value={car.purchaseDate || null}
                  onChange={(nextValue) =>
                    setCar({ ...car, purchaseDate: typeof nextValue === 'string' ? nextValue : '' })
                  }
                  maxDate={todayDateKey}
                  placeholder="Purchase date"
                />
              </div>
              <div>
                <label className={labelClass}>Insurance Expiry</label>
                <UniversalCalendarInput
                  mode="single"
                  variant="form"
                  value={car.insuranceExpiry || null}
                  onChange={(nextValue) =>
                    setCar({ ...car, insuranceExpiry: typeof nextValue === 'string' ? nextValue : '' })
                  }
                  minDate={minFutureExpiryDate}
                  placeholder="Insurance expiry"
                />
              </div>
              <div>
                <label className={labelClass}>Pollution Expiry</label>
                <UniversalCalendarInput
                  mode="single"
                  variant="form"
                  value={car.pollutionExpiry || null}
                  onChange={(nextValue) =>
                    setCar({ ...car, pollutionExpiry: typeof nextValue === 'string' ? nextValue : '' })
                  }
                  minDate={minFutureExpiryDate}
                  placeholder="Pollution expiry"
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
                <UniversalCalendarInput
                  mode="single"
                  variant="form"
                  value={car.lastServiceDate || null}
                  onChange={(nextValue) =>
                    setCar({ ...car, lastServiceDate: typeof nextValue === 'string' ? nextValue : '' })
                  }
                  minDate={car.purchaseDate || null}
                  maxDate={todayDateKey}
                  placeholder="Last service date"
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
                onChange={(e) => setCustomFeature(normalizeCompactText(e.target.value))}
                placeholder="Add custom feature"
                className="border border-borderColor rounded-lg px-3 py-2"
              />
              <button
                type="button"
                onClick={() => {
                  const cleaned = finalizeCompactText(customFeature);
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
            {loading ? 'Saving...' : editId ? 'Update Car' : 'Add Car'}
            {!loading ? (
              <span aria-hidden="true" className="text-lg leading-none">
                {editId ? '✓' : '+'}
              </span>
            ) : null}
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

      {showCategoryDialog ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 px-4 modal-backdrop-enter"
          onClick={closeCategoryDialog}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_45px_rgba(15,23,42,0.28)] modal-panel-enter"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-base font-semibold text-slate-900">Add New Category</p>
            <p className="mt-1 text-xs text-slate-500">
              Add a tenant-wide category. It will be available immediately in the category dropdown.
            </p>
            <input
              ref={categoryDialogInputRef}
              type="text"
              value={categoryDialogDraft}
              onChange={(event) => setCategoryDialogDraft(normalizeCompactText(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitCategoryDialog();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeCategoryDialog();
                }
              }}
              placeholder="e.g. Compact SUV"
              className={`${inputClass} mt-4`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCategoryDialog}
                disabled={creatingCategory}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCategoryDialog}
                disabled={creatingCategory || !finalizeCompactText(categoryDialogDraft)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                  creatingCategory || !finalizeCompactText(categoryDialogDraft)
                    ? 'cursor-not-allowed bg-slate-400'
                    : 'bg-primary hover:bg-primary/90'
                }`}
              >
                {creatingCategory ? 'Adding...' : 'Add Category'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showLocationDialog ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 px-4 modal-backdrop-enter"
          onClick={closeLocationDialog}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_45px_rgba(15,23,42,0.28)] modal-panel-enter"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-base font-semibold text-slate-900">Add New Location</p>
            <p className="mt-1 text-xs text-slate-500">
              Add a new location for the selected branch. It will be available immediately in the dropdown.
            </p>
            <input
              ref={locationDialogInputRef}
              type="text"
              value={locationDialogDraft}
              onChange={(event) => setLocationDialogDraft(normalizeCompactText(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitLocationDialog();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeLocationDialog();
                }
              }}
              placeholder="e.g. Jamnagar"
              className={`${inputClass} mt-4`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeLocationDialog}
                disabled={creatingLocation}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitLocationDialog}
                disabled={creatingLocation || !finalizeCompactText(locationDialogDraft)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                  creatingLocation || !finalizeCompactText(locationDialogDraft)
                    ? 'cursor-not-allowed bg-slate-400'
                    : 'bg-primary hover:bg-primary/90'
                }`}
              >
                {creatingLocation ? 'Adding...' : 'Add Location'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default AddCar;

