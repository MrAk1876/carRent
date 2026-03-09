const mongoose = require('mongoose');
const State = require('../models/State');
const City = require('../models/City');
const Location = require('../models/Location');

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const normalizeState = (state) => ({
  _id: String(state?._id || ''),
  name: String(state?.name || '').trim(),
});

const normalizeCity = (city) => ({
  _id: String(city?._id || ''),
  name: String(city?.name || '').trim(),
  stateId:
    typeof city?.stateId === 'object'
      ? String(city?.stateId?._id || '')
      : String(city?.stateId || ''),
  stateName:
    typeof city?.stateId === 'object'
      ? String(city?.stateId?.name || '').trim()
      : '',
});

const normalizeLocation = (location) => ({
  _id: String(location?._id || ''),
  name: String(location?.name || '').trim(),
  cityId:
    typeof location?.cityId === 'object'
      ? String(location?.cityId?._id || '')
      : String(location?.cityId || ''),
  cityName:
    typeof location?.cityId === 'object'
      ? String(location?.cityId?.name || '').trim()
      : '',
  stateId:
    typeof location?.stateId === 'object'
      ? String(location?.stateId?._id || '')
      : String(location?.stateId || ''),
  stateName:
    typeof location?.stateId === 'object'
      ? String(location?.stateId?.name || '').trim()
      : '',
  branchId:
    typeof location?.branchId === 'object'
      ? String(location?.branchId?._id || '')
      : String(location?.branchId || ''),
  branchName:
    typeof location?.branchId === 'object'
      ? String(location?.branchId?.branchName || '').trim()
      : '',
  branchAddress: String(location?.branchAddress || '').trim(),
});

exports.getPublicStates = async (req, res) => {
  try {
    const states = await State.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    return res.json({
      states: states.map(normalizeState),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load states' });
  }
};

exports.getPublicCities = async (req, res) => {
  try {
    const stateId = toObjectId(req.query?.stateId);
    const query = { isActive: true };
    if (req.query?.stateId && !stateId) {
      return res.status(422).json({ message: 'Invalid stateId' });
    }
    if (stateId) {
      query.stateId = stateId;
    }

    const cities = await City.find(query)
      .populate('stateId', 'name isActive')
      .sort({ name: 1 })
      .lean();

    return res.json({
      cities: cities
        .filter((city) => {
          if (typeof city?.stateId === 'object') {
            return city.stateId?.isActive !== false;
          }
          return true;
        })
        .map(normalizeCity),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load cities' });
  }
};

exports.getPublicLocations = async (req, res) => {
  try {
    const cityId = toObjectId(req.query?.cityId);
    const query = { isActive: true };
    if (req.query?.cityId && !cityId) {
      return res.status(422).json({ message: 'Invalid cityId' });
    }
    if (cityId) {
      query.cityId = cityId;
    }

    const locations = await Location.find(query)
      .populate('cityId', 'name isActive')
      .populate('stateId', 'name isActive')
      .populate('branchId', 'branchName isActive')
      .sort({ isPrimary: -1, name: 1 })
      .lean();

    return res.json({
      locations: locations
        .filter((location) => {
          if (typeof location?.cityId === 'object' && location.cityId?.isActive === false) return false;
          if (typeof location?.stateId === 'object' && location.stateId?.isActive === false) return false;
          if (typeof location?.branchId === 'object' && location.branchId?.isActive === false) return false;
          return true;
        })
        .map(normalizeLocation),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load locations' });
  }
};
