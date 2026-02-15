const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const MIN_PASSWORD_LENGTH = 8;

// REGISTER
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const safeFirstName = String(firstName || '').trim();
    const safeLastName = String(lastName || '').trim();

    if (!safeFirstName || !safeLastName || !normalizedEmail || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server authentication is not configured" });
    }

    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = await User.create({
      firstName: safeFirstName,
      lastName: safeLastName,
      email: normalizedEmail,
      password
    });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        image: user.image
      }
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Registration failed" });
  }
};


// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server authentication is not configured" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    if (user.isBlocked) return res.status(403).json({ message: 'Account is blocked' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        image: user.image,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
};
