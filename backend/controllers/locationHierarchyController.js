const mongoose = require('mongoose');
const State = require('../models/State');
const City = require('../models/City');
const Branch = require('../models/Branch');
const Car = require('../models/Car');
const { normalizeName, normalizeKey, ensureStateDocument, ensureCityDocument } = require('../services/locationHierarchyService');

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const normalizeStateForClient = (state) => ({
  _id: String(state?._id || ''),
  name: String(state?.name || '').trim(),
  isActive: Boolean(state?.isActive),
  createdAt: state?.createdAt || null,
  updatedAt: state?.updatedAt || null,
});

const normalizeCityForClient = (city) => ({
  _id: String(city?._id || ''),
  name: String(city?.name || '').trim(),
  stateId:
    typeof city?.stateId === 'object'
      ? {
          _id: String(city?.stateId?._id || ''),
          name: String(city?.stateId?.name || '').trim(),
        }
      : String(city?.stateId || ''),
  isActive: Boolean(city?.isActive),
  createdAt: city?.createdAt || null,
  updatedAt: city?.updatedAt || null,
});

exports.getStates = async (req, res) => {
  try {
    const states = await State.find({})
      .sort({ name: 1 })
      .lean();

    return res.json({
      states: states.map(normalizeStateForClient),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load states' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createState = async (req, res) => {
  try {
    const stateName = normalizeName(req.body?.name);
    if (!stateName) {
      return res.status(422).json({ message: 'State name is required' });
    }

    const state = await ensureStateDocument({ name: stateName });
    return res.status(201).json({
      message: 'State created successfully',
      state: normalizeStateForClient(state),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to create state' : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateState = async (req, res) => {
  try {
    const stateId = toObjectId(req.params.id);
    if (!stateId) {
      return res.status(422).json({ message: 'Invalid state id' });
    }

    const state = await State.findById(stateId);
    if (!state) {
      return res.status(404).json({ message: 'State not found' });
    }

    if (req.body?.name !== undefined) {
      const nextName = normalizeName(req.body.name);
      if (!nextName) {
        return res.status(422).json({ message: 'State name cannot be empty' });
      }

      const duplicate = await State.findOne({
        _id: { $ne: state._id },
        nameKey: normalizeKey(nextName),
      })
        .select('_id')
        .lean();
      if (duplicate?._id) {
        return res.status(422).json({ message: 'State already exists' });
      }

      state.name = nextName;
    }

    if (req.body?.isActive !== undefined) {
      state.isActive = Boolean(req.body.isActive);
    }

    await state.save();
    await Branch.updateMany({ stateId: state._id }, { $set: { state: state.name } });

    return res.json({
      message: 'State updated successfully',
      state: normalizeStateForClient(state),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update state' : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteState = async (req, res) => {
  try {
    const stateId = toObjectId(req.params.id);
    if (!stateId) {
      return res.status(422).json({ message: 'Invalid state id' });
    }

    const [state, cityCount, branchCount] = await Promise.all([
      State.findById(stateId),
      City.countDocuments({ stateId }),
      Branch.countDocuments({ stateId }),
    ]);

    if (!state) {
      return res.status(404).json({ message: 'State not found' });
    }
    if (cityCount > 0 || branchCount > 0) {
      return res.status(422).json({
        message: 'Remove linked cities and branches before deleting this state',
      });
    }

    await state.deleteOne();
    return res.json({
      message: 'State deleted successfully',
      deletedStateId: String(state._id),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to delete state' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getCities = async (req, res) => {
  try {
    const stateId = toObjectId(req.query?.stateId);
    const query = stateId ? { stateId } : {};

    const cities = await City.find(query)
      .populate('stateId', 'name')
      .sort({ name: 1 })
      .lean();

    return res.json({
      cities: cities.map(normalizeCityForClient),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load cities' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createCity = async (req, res) => {
  try {
    const stateId = toObjectId(req.body?.stateId);
    const cityName = normalizeName(req.body?.name);
    if (!stateId) {
      return res.status(422).json({ message: 'stateId is required' });
    }
    if (!cityName) {
      return res.status(422).json({ message: 'City name is required' });
    }

    const state = await State.findById(stateId);
    if (!state) {
      return res.status(404).json({ message: 'State not found' });
    }

    const city = await ensureCityDocument({
      stateId: state._id,
      name: cityName,
    });

    await city.populate('stateId', 'name');
    return res.status(201).json({
      message: 'City created successfully',
      city: normalizeCityForClient(city),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to create city' : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateCity = async (req, res) => {
  try {
    const cityId = toObjectId(req.params.id);
    if (!cityId) {
      return res.status(422).json({ message: 'Invalid city id' });
    }

    const city = await City.findById(cityId);
    if (!city) {
      return res.status(404).json({ message: 'City not found' });
    }

    if (req.body?.stateId !== undefined) {
      const nextStateId = toObjectId(req.body.stateId);
      if (!nextStateId) {
        return res.status(422).json({ message: 'Invalid stateId' });
      }
      const state = await State.findById(nextStateId);
      if (!state) {
        return res.status(404).json({ message: 'State not found' });
      }
      city.stateId = state._id;
    }

    if (req.body?.name !== undefined) {
      const nextName = normalizeName(req.body.name);
      if (!nextName) {
        return res.status(422).json({ message: 'City name cannot be empty' });
      }

      const duplicate = await City.findOne({
        _id: { $ne: city._id },
        stateId: city.stateId,
        nameKey: normalizeKey(nextName),
      })
        .select('_id')
        .lean();
      if (duplicate?._id) {
        return res.status(422).json({ message: 'City already exists in this state' });
      }

      city.name = nextName;
    }

    if (req.body?.isActive !== undefined) {
      city.isActive = Boolean(req.body.isActive);
    }

    await city.save();
    await city.populate('stateId', 'name');
    await Branch.updateMany({ cityId: city._id }, { $set: { city: city.name, stateId: city.stateId } });

    return res.json({
      message: 'City updated successfully',
      city: normalizeCityForClient(city),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update city' : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteCity = async (req, res) => {
  try {
    const cityId = toObjectId(req.params.id);
    if (!cityId) {
      return res.status(422).json({ message: 'Invalid city id' });
    }

    const [city, branchCount, carCount] = await Promise.all([
      City.findById(cityId),
      Branch.countDocuments({ cityId }),
      Car.countDocuments({ cityId }),
    ]);

    if (!city) {
      return res.status(404).json({ message: 'City not found' });
    }
    if (branchCount > 0 || carCount > 0) {
      return res.status(422).json({
        message: 'Move or remove linked branches and cars before deleting this city',
      });
    }

    await city.deleteOne();
    return res.json({
      message: 'City deleted successfully',
      deletedCityId: String(city._id),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to delete city' : error.message;
    return res.status(status).json({ message });
  }
};

