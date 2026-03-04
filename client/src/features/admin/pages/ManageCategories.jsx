import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const normalizeCompactText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const toCategoryKey = (categoryName) => normalizeCompactText(categoryName).toLowerCase();

const ManageCategories = () => {
  const notify = useNotify();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [createDraft, setCreateDraft] = useState('');
  const [renameDraftByCategory, setRenameDraftByCategory] = useState({});
  const [actionKey, setActionKey] = useState('');
  const [carsModalState, setCarsModalState] = useState({
    open: false,
    categoryName: '',
    cars: [],
    loading: false,
    error: '',
    movingCarId: '',
    targetByCarId: {},
  });

  const loadCategories = async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/categories', { showErrorToast: false });
      const nextCategories = Array.isArray(response?.data?.categories) ? response.data.categories : [];
      setCategories(nextCategories);
      setRenameDraftByCategory({});
      setErrorMsg('');
    } catch (error) {
      setCategories([]);
      setErrorMsg(getErrorMessage(error, 'Failed to load car categories'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const stats = useMemo(() => {
    const totalCategories = categories.length;
    const categoriesWithCars = categories.filter((category) => Number(category?.carCount || 0) > 0).length;
    const defaultCategories = categories.filter((category) => Boolean(category?.isDefault)).length;
    return {
      totalCategories,
      categoriesWithCars,
      defaultCategories,
    };
  }, [categories]);

  const updateRenameDraft = (categoryName, value) => {
    const key = toCategoryKey(categoryName);
    setRenameDraftByCategory((previous) => ({
      ...previous,
      [key]: normalizeCompactText(value),
    }));
  };

  const handleCreateCategory = async () => {
    const categoryName = normalizeCompactText(createDraft);
    if (!categoryName) {
      notify.error('Enter a category name');
      return;
    }

    try {
      setActionKey('create');
      const response = await API.post(
        '/admin/categories',
        { name: categoryName },
        { showErrorToast: false },
      );
      setCreateDraft('');
      await loadCategories();
      notify.success(response?.data?.message || 'Category added');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to add category'));
    } finally {
      setActionKey('');
    }
  };

  const handleRenameCategory = async (currentName) => {
    const key = toCategoryKey(currentName);
    const nextName = normalizeCompactText(renameDraftByCategory[key] || currentName);
    if (!nextName) {
      notify.error('Enter a valid category name');
      return;
    }
    if (toCategoryKey(nextName) === toCategoryKey(currentName)) {
      notify.error('Please change the category name before saving');
      return;
    }

    try {
      setActionKey(`rename:${key}`);
      const response = await API.put(
        '/admin/categories',
        { currentName, nextName },
        { showErrorToast: false },
      );
      await loadCategories();
      const movedCars = Number(response?.data?.movedCars || 0);
      notify.success(
        movedCars > 0
          ? `Category renamed and ${movedCars} car${movedCars > 1 ? 's were' : ' was'} updated`
          : response?.data?.message || 'Category renamed',
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to rename category'));
    } finally {
      setActionKey('');
    }
  };

  const handleDeleteCategory = async (categoryName) => {
    const confirmed = window.confirm(`Delete category "${categoryName}"?`);
    if (!confirmed) return;

    try {
      const key = toCategoryKey(categoryName);
      setActionKey(`delete:${key}`);
      const response = await API.delete('/admin/categories', {
        params: { name: categoryName },
        showErrorToast: false,
      });
      await loadCategories();
      notify.success(response?.data?.message || 'Category deleted');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete category'));
    } finally {
      setActionKey('');
    }
  };

  const closeCarsModal = () => {
    if (carsModalState.movingCarId) return;
    setCarsModalState({
      open: false,
      categoryName: '',
      cars: [],
      loading: false,
      error: '',
      movingCarId: '',
      targetByCarId: {},
    });
  };

  const openCarsModal = async (categoryName) => {
    const normalizedCategoryName = normalizeCompactText(categoryName);
    if (!normalizedCategoryName) return;

    setCarsModalState({
      open: true,
      categoryName: normalizedCategoryName,
      cars: [],
      loading: true,
      error: '',
      movingCarId: '',
      targetByCarId: {},
    });

    try {
      const response = await API.get('/admin/categories/cars', {
        params: { name: normalizedCategoryName },
        showErrorToast: false,
      });
      const filteredCars = Array.isArray(response?.data?.cars) ? response.data.cars : [];
      setCarsModalState((previous) => ({
        ...previous,
        cars: filteredCars,
        loading: false,
      }));
    } catch (error) {
      setCarsModalState((previous) => ({
        ...previous,
        loading: false,
        error: getErrorMessage(error, 'Failed to load cars for this category'),
      }));
    }
  };

  const updateCarMoveTarget = (carId, targetCategory) => {
    const normalizedCarId = String(carId || '').trim();
    if (!normalizedCarId) return;
    setCarsModalState((previous) => ({
      ...previous,
      targetByCarId: {
        ...previous.targetByCarId,
        [normalizedCarId]: normalizeCompactText(targetCategory),
      },
    }));
  };

  const handleMoveCarToCategory = async (car) => {
    const carId = String(car?._id || '').trim();
    const currentCategory = normalizeCompactText(carsModalState.categoryName);
    const targetCategory = normalizeCompactText(carsModalState.targetByCarId[carId]);
    if (!carId) return;
    if (!targetCategory) {
      notify.error('Select target category first');
      return;
    }
    if (toCategoryKey(targetCategory) === toCategoryKey(currentCategory)) {
      notify.error('Select a different category');
      return;
    }

    try {
      setCarsModalState((previous) => ({ ...previous, movingCarId: carId }));
      await API.patch(
        '/admin/categories/cars/move',
        {
          carId,
          fromCategory: currentCategory,
          toCategory: targetCategory,
        },
        { showErrorToast: false },
      );
      setCarsModalState((previous) => ({
        ...previous,
        movingCarId: '',
        cars: previous.cars.filter((item) => String(item?._id || '') !== carId),
      }));
      await loadCategories();
      notify.success('Car category updated');
    } catch (error) {
      setCarsModalState((previous) => ({ ...previous, movingCarId: '' }));
      notify.error(getErrorMessage(error, 'Failed to move car category'));
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Car Categories"
        subTitle="Manage tenant-wide car categories with safe rename and delete rules."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Categories</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.totalCategories}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-blue-700">Categories With Cars</p>
          <p className="mt-2 text-2xl font-semibold text-blue-700">{stats.categoriesWithCars}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Default Categories</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{stats.defaultCategories}</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-borderColor bg-white p-8 text-sm text-gray-500 shadow-sm">
          Loading category data...
        </div>
      ) : null}

      {!loading ? (
        <section className="mt-6 rounded-2xl border border-borderColor bg-white p-4 md:p-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input
              type="text"
              placeholder="Add new category"
              value={createDraft}
              onChange={(event) => setCreateDraft(normalizeCompactText(event.target.value))}
              className="rounded-lg border border-borderColor px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleCreateCategory}
              disabled={actionKey === 'create'}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                actionKey === 'create'
                  ? 'cursor-not-allowed bg-slate-400'
                  : 'bg-primary hover:bg-primary/90'
              }`}
            >
              {actionKey === 'create' ? 'Adding...' : 'Add Category'}
            </button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-borderColor">
            <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-gray-700">
                <tr>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Cars</th>
                  <th className="px-3 py-2 font-medium">Rename</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr className="border-t border-borderColor">
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                      No categories found.
                    </td>
                  </tr>
                ) : (
                  categories.map((category) => {
                    const key = toCategoryKey(category.name);
                    const draftValue = renameDraftByCategory[key] ?? category.name;
                    const deleteDisabled = Number(category?.carCount || 0) > 0;
                    return (
                      <tr key={key} className="border-t border-borderColor align-middle">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">{category.name}</span>
                            {category.isDefault ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                Default
                              </span>
                            ) : null}
                            {category.legacyOnly ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                From Cars
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{Number(category?.carCount || 0)}</td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={draftValue}
                            onChange={(event) => updateRenameDraft(category.name, event.target.value)}
                            className="w-full rounded-lg border border-borderColor px-2.5 py-1.5 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleRenameCategory(category.name)}
                              disabled={actionKey === `rename:${key}`}
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${
                                actionKey === `rename:${key}`
                                  ? 'cursor-not-allowed bg-slate-400'
                                  : 'bg-primary hover:bg-primary/90'
                              }`}
                            >
                              {actionKey === `rename:${key}` ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openCarsModal(category.name)}
                              className="rounded-md px-3 py-1.5 text-xs font-semibold bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                              title="View cars in this category"
                            >
                              View Cars
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(category.name)}
                              disabled={deleteDisabled || actionKey === `delete:${key}`}
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                deleteDisabled || actionKey === `delete:${key}`
                                  ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                  : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                              }`}
                              title={
                                deleteDisabled
                                  ? 'Move or update cars using this category before deleting'
                                  : 'Delete category'
                              }
                            >
                              {actionKey === `delete:${key}` ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {carsModalState.open ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] p-3 md:p-4 modal-backdrop-enter"
          onClick={closeCarsModal}
        >
          <div
            className="w-full max-w-[min(1080px,96vw)] max-h-[92vh] rounded-3xl border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.28)] overflow-hidden flex flex-col modal-panel-enter"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/70 px-5 py-4 md:px-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base md:text-lg font-semibold text-slate-900">Cars In Category</p>
                  <p className="mt-1 text-xs md:text-sm text-slate-600">{carsModalState.categoryName}</p>
                </div>
                <button
                  type="button"
                  onClick={closeCarsModal}
                  disabled={Boolean(carsModalState.movingCarId)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="px-5 pb-5 pt-4 md:px-6 md:pb-6 md:pt-5 flex-1 min-h-0 overflow-hidden flex flex-col">
              {carsModalState.error ? <p className="text-sm text-red-500">{carsModalState.error}</p> : null}

              {carsModalState.loading ? (
                <div className="rounded-xl border border-borderColor bg-slate-50 px-4 py-6 text-sm text-gray-500">
                  Loading cars...
                </div>
              ) : null}

              {!carsModalState.loading && !carsModalState.error ? (
                <div className="mt-4 min-h-0 flex-1 overflow-auto relative rounded-xl border border-borderColor bg-white shadow-inner">
                  <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
                    <thead className="text-gray-700">
                      <tr>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Car</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Move To Category</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {carsModalState.cars.length === 0 ? (
                        <tr className="border-t border-borderColor">
                          <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                            No cars currently assigned to this category.
                          </td>
                        </tr>
                      ) : (
                        carsModalState.cars.map((car) => {
                          const carId = String(car?._id || '');
                          const moveOptions = categories
                            .map((entry) => normalizeCompactText(entry?.name))
                            .filter(
                              (name) => name && toCategoryKey(name) !== toCategoryKey(carsModalState.categoryName),
                            );
                          const selectedTarget = carsModalState.targetByCarId[carId] || '';
                          const moving = carsModalState.movingCarId === carId;
                          return (
                            <tr key={carId} className="border-t border-borderColor align-middle">
                              <td className="px-3 py-2">
                                <p className="font-medium text-gray-800">
                                  {`${car?.brand || ''} ${car?.model || car?.name || ''}`.trim() || 'Car'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {car?.registrationNumber || 'N/A'} | {car?.fleetStatus || 'Status N/A'}
                                </p>
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={selectedTarget}
                                  onChange={(event) => updateCarMoveTarget(carId, event.target.value)}
                                  className="w-full rounded-lg border border-borderColor px-2.5 py-1.5 text-xs"
                                  disabled={moving || moveOptions.length === 0}
                                >
                                  <option value="">
                                    {moveOptions.length ? 'Select category' : 'No other category'}
                                  </option>
                                  {moveOptions.map((optionName) => (
                                    <option key={`${carId}:${optionName}`} value={optionName}>
                                      {optionName}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => handleMoveCarToCategory(car)}
                                  disabled={moving || !selectedTarget}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                    moving || !selectedTarget
                                      ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                      : 'bg-primary text-white hover:bg-primary/90'
                                  }`}
                                >
                                  {moving ? 'Moving...' : 'Move'}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ManageCategories;

