const ContactMessage = require('../models/ContactMessage');

const emailPattern = /^\S+@\S+\.\S+$/;

exports.createContactMessage = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();

    if (!name || name.length < 2) {
      return res.status(422).json({ message: 'Name should be at least 2 characters.' });
    }

    if (!emailPattern.test(email)) {
      return res.status(422).json({ message: 'Please provide a valid email address.' });
    }

    if (!message || message.length < 10) {
      return res.status(422).json({ message: 'Message should be at least 10 characters.' });
    }

    const contactMessage = await ContactMessage.create({
      name,
      email,
      subject,
      message,
      status: 'new',
    });

    return res.status(201).json({
      message: 'Contact message sent successfully.',
      contactMessage,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save contact message' });
  }
};
