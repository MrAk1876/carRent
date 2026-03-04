// backend/middleware/profileValidation.js

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseDobParts = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
  const match = DATE_ONLY_PATTERN.exec(datePart);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day, datePart };
};

const isFutureDob = (dobParts, referenceDate = new Date()) => {
  if (!dobParts) return true;

  const referenceYear = referenceDate.getFullYear();
  const referenceMonth = referenceDate.getMonth() + 1;
  const referenceDay = referenceDate.getDate();

  if (dobParts.year > referenceYear) return true;
  if (dobParts.year < referenceYear) return false;
  if (dobParts.month > referenceMonth) return true;
  if (dobParts.month < referenceMonth) return false;
  return dobParts.day > referenceDay;
};

const calculateAge = (dobParts, referenceDate = new Date()) => {
  if (!dobParts) return -1;

  let age = referenceDate.getFullYear() - dobParts.year;
  const month = referenceDate.getMonth() + 1;
  const day = referenceDate.getDate();

  if (month < dobParts.month || (month === dobParts.month && day < dobParts.day)) {
    age -= 1;
  }

  return age;
};

exports.validateProfileData = (req, res, next) => {
  const { phone, dob, email } = req.body;
  const normalizedPhone = String(phone || '').trim();

  // email (only if present)
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email address' });
  }

  // phone
  if (!/^[0-9]{10}$/.test(normalizedPhone)) {
    return res.status(400).json({ message: 'Phone number must be exactly 10 digits' });
  }

  // dob
  if (!dob) {
    return res.status(400).json({ message: 'Date of birth is required' });
  }

  const dobParts = parseDobParts(dob);
  if (!dobParts) {
    return res.status(400).json({ message: 'Invalid date of birth' });
  }

  if (isFutureDob(dobParts)) {
    return res.status(400).json({ message: 'Date of birth cannot be in the future' });
  }

  const age = calculateAge(dobParts);
  if (age < 18) {
    return res.status(400).json({ message: 'User must be at least 18 years old' });
  }

  // Attach normalized values for the controller layer.
  req.calculatedAge = age;
  req.body.phone = normalizedPhone;
  req.body.dob = dobParts.datePart;

  next();
};
