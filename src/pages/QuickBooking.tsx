import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Phone, User, Loader2 } from 'lucide-react';
import { authFetch } from '../api';

export default function QuickBooking() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('I would like to book an appointment. Please call me back.');
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('idle');

    if (!name.trim() || !phone.trim()) {
      setError('Name and phone number are required.');
      setStatus('error');
      return;
    }

    setIsSending(true);
    try {
      const res = await authFetch('/api/quick-booking', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), message: message.trim() })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send booking request.');

      setStatus('success');
      setName('');
      setPhone('');
      setMessage('I would like to book an appointment. Please call me back.');
    } catch (err: any) {
      setError(err.message || 'Unable to send booking request.');
      setStatus('error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col font-sans">
      <header className="p-6">
        <Link to="/" className="text-gray-400 hover:text-black transition-colors inline-flex items-center gap-2">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-xs font-black uppercase tracking-widest">Back to Home</span>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6">
        <div className="w-full max-w-xl bg-white rounded-[3rem] p-10 shadow-2xl shadow-black/5 border border-gray-100">
          <div className="text-center mb-8">
            <p className="text-sm uppercase tracking-[0.3em] text-luxe-dusty font-black">Quick Booking</p>
            <h1 className="text-4xl font-serif font-bold text-black mt-4">Book with just your name and phone</h1>
            <p className="text-gray-500 mt-4 text-sm leading-6">
              No signup needed. Send your booking request directly to our team and we will call you back to confirm.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Full Name</label>
              <div className="relative">
                <User className="w-5 h-5 text-gray-300 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your Name"
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-medium focus:ring-2 focus:ring-black/5"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Phone Number</label>
              <div className="relative">
                <Phone className="w-5 h-5 text-gray-300 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 0712345678"
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-medium focus:ring-2 focus:ring-black/5"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Optional Request</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-black/5"
              />
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl p-4">{error}</div>}
            {status === 'success' && <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-2xl p-4">Booking request sent successfully. We will call you soon.</div>}

            <button
              type="submit"
              disabled={isSending}
              className="w-full bg-black text-white py-4 rounded-2xl font-black uppercase text-xs tracking-[0.2em] hover:bg-gray-900 transition-colors flex items-center justify-center gap-2"
            >
              {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Booking Request'}
            </button>
          </form>

        </div>
      </main>
    </div>
  );
}
