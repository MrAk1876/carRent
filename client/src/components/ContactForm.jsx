import React, { useMemo, useState } from 'react';
import { getErrorMessage } from '../api';
import { sendContactMessage } from '../services/contactService';
import ScrollReveal from './ui/ScrollReveal';
import InlineSpinner from './ui/InlineSpinner';
import useNotify from '../hooks/useNotify';

const initialForm = {
  name: '',
  email: '',
  subject: '',
  message: '',
};

const ContactForm = () => {
  const notify = useNotify();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const validationError = useMemo(() => {
    if (!form.name.trim() || form.name.trim().length < 2) return 'Name should be at least 2 characters.';
    const emailPattern = /^\S+@\S+\.\S+$/;
    if (!emailPattern.test(form.email)) return 'Please enter a valid email address.';
    if (!form.message.trim() || form.message.trim().length < 10) return 'Message should be at least 10 characters.';
    return '';
  }, [form]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validationError) {
      setErrorMsg(validationError);
      notify.warning(validationError);
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      await sendContactMessage({
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });

      setForm(initialForm);
      notify.success('Message sent successfully. We will contact you shortly.');
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to submit the form. Please try again.');
      setErrorMsg(message);
      notify.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollReveal id="contact" className="px-4 md:px-8 xl:px-10 pt-2 pb-16" direction="up" delay={60}>
      <div className="max-w-245 mx-auto rounded-3xl border border-borderColor bg-white p-6 md:p-9 shadow-sm">
        <h3 className="text-2xl md:text-3xl font-semibold text-slate-900">Contact Us</h3>
        <p className="text-sm md:text-base text-slate-600 mt-2">
          Have a question about booking, negotiation, or payments? Send us a message.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Your Name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="border border-borderColor rounded-lg px-4 py-3 outline-none"
            required
          />
          <input
            type="email"
            placeholder="Your Email"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            className="border border-borderColor rounded-lg px-4 py-3 outline-none"
            required
          />
          <input
            type="text"
            placeholder="Subject (Optional)"
            value={form.subject}
            onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
            className="border border-borderColor rounded-lg px-4 py-3 outline-none md:col-span-2"
          />
          <textarea
            rows={5}
            placeholder="Write your message..."
            value={form.message}
            onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
            className="border border-borderColor rounded-lg px-4 py-3 outline-none md:col-span-2"
            required
          />

          {errorMsg ? <p className="text-sm text-red-500 md:col-span-2">{errorMsg}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className={`md:col-span-2 px-6 py-3 rounded-lg text-white font-medium inline-flex items-center justify-center gap-2 ${
              submitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-primary-dull'
            }`}
          >
            {submitting ? (
              <>
                <InlineSpinner size="sm" className="border-white/40 border-t-white" />
                Sending...
              </>
            ) : (
              'Send Message'
            )}
          </button>
        </form>
      </div>
    </ScrollReveal>
  );
};

export default ContactForm;
