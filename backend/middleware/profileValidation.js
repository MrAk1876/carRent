// backend/middleware/profileValidation.js

const calculateAge = (dob) => {
  const birthDate = new Date(dob);
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();

  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
};

exports.validateProfileData = (req, res, next) => {
  const { phone, dob, email } = req.body;
  const normalizedPhone = String(phone || "").trim();

  // email (only if present)
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  // phone
  if (!/^[0-9]{10}$/.test(normalizedPhone)) {
    return res.status(400).json({ message: "Phone number must be exactly 10 digits" });
  }

  // dob
  if (!dob) {
    return res.status(400).json({ message: "Date of birth is required" });
  }

  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) {
    return res.status(400).json({ message: "Invalid date of birth" });
  }
  const today = new Date();

  if (dobDate > today) {
    return res.status(400).json({ message: "Date of birth cannot be in the future" });
  }

  const age = calculateAge(dob);
  if (age < 18) {
    return res.status(400).json({ message: "User must be at least 18 years old" });
  }

  // 🔥 attach calculated age to request (IMPORTANT)
  req.calculatedAge = age;
  req.body.phone = normalizedPhone;

  next(); // move to controller
};
