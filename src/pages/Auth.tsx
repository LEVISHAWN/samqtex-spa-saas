import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Lock, Mail, User, Phone, Loader2, ShieldCheck, Briefcase } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function AuthPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [portal, setPortal] = useState<'client' | 'worker' | 'admin'>('client');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [showSetup, setShowSetup] = useState(false);
  const [setupData, setSetupData] = useState({ newPassword: '', bio: '', skills: '' });
  const [isSettingUp, setIsSettingUp] = useState(false);

  const handleInitialSetup = async (e: FormEvent) => {
    e.preventDefault();
    setIsSettingUp(true);
    try {
      const res = await fetch('/api/worker/setup-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user?.id, ...setupData })
      });
      if (res.ok) {
        alert("Account secured! Redirecting to your dashboard...");
        navigate(user?.role === 'admin' ? '/admin' : '/worker');
      }
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const tenantId = localStorage.getItem('tenantId') || '1';
      await login(identifier, password, tenantId, portal);

      const userStr = localStorage.getItem('user');
      if (userStr) {
        const u = JSON.parse(userStr);
        if (u.is_first_login && portal !== 'client') {
          setShowSetup(true);
        } else {
          if (u.role === 'admin' && portal === 'admin') navigate('/admin');
          else if (u.role === 'worker' || portal === 'worker') navigate('/worker');
          else navigate('/');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
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

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md rounded-[3rem] p-10 shadow-2xl shadow-black/5 border border-gray-100">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-serif font-bold text-black mb-3">
              Portal Access
            </h1>
            <p className="text-gray-400 text-xs font-medium px-4">
              Enter your credentials to access your personalized dashboard and tools.
            </p>
          </div>

          {/* Portal Selector */}
          <div className="flex p-1 bg-gray-50 rounded-2xl mb-8 border border-gray-100">
            {[
              { id: 'client', label: 'Client', icon: User },
              { id: 'worker', label: 'Staff', icon: Briefcase },
              { id: 'admin', label: 'Admin', icon: ShieldCheck },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPortal(p.id as any)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-tighter transition-all ${
                  portal === p.id 
                    ? 'bg-white text-black shadow-sm ring-1 ring-black/5' 
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <p.icon size={14} />
                {p.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-[10px] font-black uppercase tracking-widest mb-8 border border-red-100 animate-in fade-in zoom-in-95">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 ml-1">{portal === 'worker' ? 'Phone Number' : 'Identity Log'}</label>
              <div className="relative">
                {portal === 'worker' ? <Phone className="w-5 h-5 text-gray-300 absolute left-4 top-1/2 -translate-y-1/2" /> : <Mail className="w-5 h-5 text-gray-300 absolute left-4 top-1/2 -translate-y-1/2" />}
                <input 
                  type="text" 
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-4 py-4 text-sm font-bold focus:ring-2 focus:ring-black/5"
                  placeholder={portal === 'worker' ? 'e.g. 0712345678' : 'Username, Email or Phone'}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 ml-1">{portal === 'worker' ? 'Personal PIN' : 'Security Password'}</label>
              <div className="relative">
                <Lock className="w-5 h-5 text-gray-300 absolute left-4 top-1/2 -translate-y-1/2" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-4 py-4 text-sm font-bold focus:ring-2 focus:ring-black/5"
                  placeholder={portal === 'worker' ? '••••' : '••••••••'}
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={isLoading}
              className="w-full bg-black text-[#D4AF37] py-5 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:scale-[1.02] transition-all flex items-center justify-center gap-2 mt-8 shadow-2xl shadow-black/20"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : `Enter ${portal} Portal`}
            </button>
          </form>

          <div className="mt-12 pt-8 border-t border-gray-50 text-center">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">System Credentials Memo</p>
            <div className="mt-2 text-[9px] text-gray-300 font-medium">
              Admin: admin / SamQtex+123<br/>
              Staff: jane / worker123
            </div>
          </div>
        </div>
      </main>

      {showSetup && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-lg animate-in zoom-in-95 duration-500 shadow-2xl relative">
            <h3 className="text-3xl font-serif font-bold mb-2">Welcome Aboard</h3>
            <p className="text-gray-500 text-sm mb-8">One last step: Let's secure your account and set up your professional bio.</p>
            
            <form onSubmit={handleInitialSetup} className="space-y-6">
               <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-gray-400 ml-1">New Secure Password</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="Min. 8 characters"
                    className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]"
                    onChange={e => setSetupData({...setupData, newPassword: e.target.value})}
                  />
               </div>
               
               <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-gray-400 ml-1">Professional Bio</label>
                  <textarea 
                    required 
                    placeholder="e.g. Senior Stylist with 5+ years experience..."
                    className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-medium focus:ring-2 focus:ring-[#D4AF37] min-h-[100px]"
                    onChange={e => setSetupData({...setupData, bio: e.target.value})}
                  />
               </div>

               <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-gray-400 ml-1">Skills (Comma separated)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Nails, Facial, Dreadlocks"
                    className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]"
                    onChange={e => setSetupData({...setupData, skills: e.target.value})}
                  />
               </div>

               <button 
                 type="submit" 
                 disabled={isSettingUp}
                 className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl transition-transform hover:scale-[1.02]"
               >
                 {isSettingUp ? 'Securing Account...' : 'Complete Profile Setup'}
               </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
