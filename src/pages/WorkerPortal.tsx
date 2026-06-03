import { Link } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Clock, DollarSign, ListTodo, AlertTriangle,
  Power, MapPin, CheckSquare, Package, MessageCircle, X,
  MessageSquare, Sparkles, User, History as HistoryIcon, ChevronRight, Zap, Info,
  TrendingUp, Calendar, XCircle, Plus, Save, Phone, Award, BookOpen, Search, ShoppingCart, Trash, Minus
} from 'lucide-react';

import { authFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export default function WorkerPortal() {
  const { user, setUser, logout } = useAuth();

  const parseSkills = (skills: any) => {
    if (Array.isArray(skills)) return skills;
    if (typeof skills === 'string' && skills.trim() !== '') {
      try {
        const parsed = JSON.parse(skills);
        // If it's valid JSON, ensure it's an array, otherwise return it in an array
        return Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch (e) {
        // If JSON parsing fails, treat the string as a single skill
        console.warn("Attempting to parse non-JSON skill string. This indicates a potential data storage issue.", skills);
        return [skills.trim()]; // Treat the entire string as one skill, after trimming whitespace
      }
    }
    return [];
  };
  
  // App State
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [stats, setStats] = useState({ today: 0, pending: 0, monthly: 0 });
  const [activeTab, setActiveTab] = useState('home'); // home, agenda, logger, shop, chat, profile, history
  
  // Profile State
  const [profile, setProfile] = useState({
    bio: user?.bio || '',
    skills: parseSkills(user?.skills),
    phone: user?.phone || ''
  });

  // Re-sync profile when user context changes
  useEffect(() => {
    if (user) {
      setProfile({
        bio: user.bio || '',
        skills: parseSkills(user.skills),
        phone: user.phone || ''
      });
    }
  }, [user]);

  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Attendance
  const [clockedIn, setClockedIn] = useState(() => localStorage.getItem(`clockedIn_${user?.id}`) === 'true');
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(false);

  // Job Logger State
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [isLogging, setIsLogging] = useState(false);

  // Offline Queue
  const [queue, setQueue] = useState<any[]>(() => {
    const saved = localStorage.getItem(`worker_queue_${user?.id}`);
    return saved ? JSON.parse(saved) : [];
  });

  const toggleProductSelection = (product: any) => {
    setSelectedProducts(prev => {
      const exists = prev.find(p => p.id === product.id);
      if (exists) return prev.filter(p => p.id !== product.id);
      return [...prev, product];
    });
  };

  // AI & Chat
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // POS State
  const [posCart, setPosCart] = useState<any[]>([]);
  const [posSearch, setPosSearch] = useState('');
  const [isProcessingSale, setIsProcessingSale] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState(false);

  const addToPOSCart = (product: any) => {
    setPosCart(prev => {
      const exists = prev.find(i => i.id === product.id);
      if (exists) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updatePOSQty = (id: number, delta: number) => {
    setPosCart(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i));
  };

  const removeFromPOSCart = (id: number) => {
    setPosCart(prev => prev.filter(i => i.id !== id));
  };

  const posTotal = posCart.reduce((sum, i) => sum + (i.selling_price * i.quantity), 0);

  const handlePOSCheckout = async (method: string) => {
    if (posCart.length === 0) return;
    setIsProcessingSale(true);
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: posCart,
          total_amount: posTotal,
          payment_method: method,
          client_name: 'Walk-in Client',
          type: 'pos'
        })
      });
      if (!res.ok) throw new Error(await res.text());
      setPosCart([]);
      setSaleSuccess(true);
      fetchData(); // Refresh everything
      setTimeout(() => setSaleSuccess(false), 3000);
    } catch (err) {
      alert("POS Sale failed. Check stock levels.");
    } finally {
      setIsProcessingSale(false);
    }
  };

  const fetchData = async () => {
    if (!user) return;
    try {
      const [appts, svcs, prods, history, s] = await Promise.all([
        authFetch(`/api/appointments/worker/${user.id}`).then(r => r.json()),
        authFetch('/api/services').then(r => r.json()),
        authFetch('/api/worker/products').then(r => r.json()),
        authFetch(`/api/worker/history/${user.id}`).then(r => r.json()),
        authFetch(`/api/worker/stats/${user.id}`).then(r => r.json())
      ]);
      
      if (Array.isArray(appts)) setAppointments(appts);
      if (Array.isArray(svcs)) setServices(svcs);
      if (Array.isArray(prods)) setProducts(prods);
      if (Array.isArray(history)) setLogs(history);
      if (s) {
        setStats(prevStats => ({
          ...prevStats,
          today: Number(s.today || 0),
          pending: Number(s.pending || 0),
          monthly: Number(s.monthly || 0),
        }));
      }
    } catch (err) {
      console.error("Fetch failed", err);
    }
  };

  useEffect(() => {
    fetchData();
    if (user) {
      try {
        socketRef.current = io(window.location.origin);
        socketRef.current.emit("join_room", `chat_${user.id}`);
        socketRef.current.on("receive_message", (data) => setMessages(prev => [...prev, data]));
        socketRef.current.on('connect_error', (err) => {
          console.error('Socket.IO connection error:', err);
          // Optionally, set an error state or display a message to the user
        });
      } catch (error) {
        console.error('Failed to initialize Socket.IO:', error);
      }
    }
    return () => { socketRef.current?.disconnect(); };
  }, [user]);

  // Sync Offline Queue when back online
  useEffect(() => {
    const syncAll = async () => {
      if (!navigator.onLine) return;
      
      // Sync Attendance
      const savedAtt = localStorage.getItem(`worker_attendance_queue_${user?.id}`);
      if (savedAtt) {
        const attQueue = JSON.parse(savedAtt);
        for (let i = 0; i < attQueue.length; i++) {
          try {
            const res = await authFetch('/api/worker/attendance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(attQueue[i])
            });
            if (res.ok) {
              attQueue.splice(i, 1);
              i--;
            }
          } catch (e) { break; }
        }
        localStorage.setItem(`worker_attendance_queue_${user?.id}`, JSON.stringify(attQueue));
      }

      // Sync Logs
      if (queue.length > 0) {
        const newQueue = [...queue];
        for (let i = 0; i < newQueue.length; i++) {
          try {
            const res = await authFetch('/api/logs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newQueue[i])
            });
            if (res.ok) {
              newQueue.splice(i, 1);
              i--;
            }
          } catch (e) { break; }
        }
        setQueue(newQueue);
        localStorage.setItem(`worker_queue_${user?.id}`, JSON.stringify(newQueue));
      }

      fetchData();
    };

    window.addEventListener('online', syncAll);
    return () => window.removeEventListener('online', syncAll);
  }, [queue, user]);

  const handleAttendance = async () => {
    setIsAttendanceLoading(true);
    const type = clockedIn ? 'clock_out' : 'clock_in';
    const timestamp = new Date().toISOString();
    
    const attendanceData = { worker_id: user?.id, type, timestamp };

    if (!navigator.onLine) {
      const savedQueue = localStorage.getItem(`worker_attendance_queue_${user?.id}`);
      const attendanceQueue = savedQueue ? JSON.parse(savedQueue) : [];
      attendanceQueue.push(attendanceData);
      localStorage.setItem(`worker_attendance_queue_${user?.id}`, JSON.stringify(attendanceQueue));
      
      const newState = !clockedIn;
      setClockedIn(newState);
      localStorage.setItem(`clockedIn_${user?.id}`, newState.toString());
      alert("Offline: Attendance recorded locally and will sync later.");
      setIsAttendanceLoading(false);
      return;
    }

    try {
      const res = await authFetch('/api/worker/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attendanceData)
      });
      if (res.ok) {
        const newState = !clockedIn;
        setClockedIn(newState);
        localStorage.setItem(`clockedIn_${user?.id}`, newState.toString());
        fetchData();
      }
    } finally {
      setIsAttendanceLoading(false);
    }
  };

  const handleLogService = async () => {
    if (!selectedService) return;
    
    const commission = (selectedService.price * (user?.commission_rate || 40)) / 100;
    const logData = {
      worker_id: user?.id,
      action: `Completed ${selectedService.name}`,
      details: `Used: ${selectedProducts.map(p => p.name).join(', ') || 'None'} | Paid via ${paymentMethod}`,
      commission_earned: commission,
      product_ids: selectedProducts.map(p => p.id),
      payment_method: paymentMethod,
      appointment_id: selectedAppointmentId
    };

    if (!navigator.onLine) {
      const newQueue = [...queue, logData];
      setQueue(newQueue);
      localStorage.setItem(`worker_queue_${user?.id}`, JSON.stringify(newQueue));
      alert("Offline: Job queued and will sync when connection returns.");
      setSelectedService(null);
      setSelectedAppointmentId(null);
      setSelectedProducts([]);
      setActiveTab('home');
      return;
    }

    setIsLogging(true);
    try {
      const res = await authFetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      });
      if (res.ok) {
        alert(`Success! Earned $${Number(commission).toFixed(2)}`);
        setSelectedService(null);
        setSelectedAppointmentId(null);
        setSelectedProducts([]);
        fetchData();
        setActiveTab('home');
      }
    } finally {
      setIsLogging(false);
    }
  };

  const updateApptStatus = async (id: number, status: string) => {
    await authFetch(`/api/appointments/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    fetchData();
  };

  const handleUpdateProfile = async () => {
    setIsUpdatingProfile(true);
    try {
      const res = await authFetch('/api/worker/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, id: user?.id })
      });
      if (res.ok) {
        alert("Profile updated successfully!");
        if (user) {
          setUser({ ...user, ...profile });
        }
      }
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const reportDepleted = async (prodId: number) => {
    if (!confirm("Flag this product as depleted for the manager?")) return;
    try {
      const res = await authFetch(`/api/worker/products/${prodId}/deplete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: user?.id })
      });
      if (res.ok) {
        alert("Reported to management.");
        fetchData();
      }
    } catch (e) { console.error(e); }
  };

  const getAiUpsell = async (request: string) => {
    setIsAiLoading(true);
    try {
      const res = await authFetch('/api/worker/ai-upsell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request })
      });
      const data = await res.json();
      setAiSuggestion(data.suggestion);
    } finally {
      setIsAiLoading(false);
    }
  };

  const [chatTarget, setChatTarget] = useState<any>({ id: 1, name: 'Manager' });

  const sendMessage = () => {
    if (!chatMessage.trim()) return;
    const msg = { 
      tenant_id: '1', 
      sender_id: user?.id, 
      receiver_id: chatTarget.id, 
      message: chatMessage,
      sender_name: user?.name,
      timestamp: new Date().toISOString()
    };
    socketRef.current?.emit("send_message", msg);
    setMessages(prev => [...prev, { ...msg, self: true }]);
    setChatMessage('');
  };

  if (!user) return <div className="p-20 text-center">Please login.</div>;

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(posSearch.toLowerCase()) || 
    p.category?.toLowerCase().includes(posSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#2D2424] font-sans pb-32">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 p-6 sticky top-0 z-30 shadow-sm flex justify-between items-center">
        <div onClick={() => setActiveTab('profile')} className="cursor-pointer">
          <h1 className="text-xl font-serif font-black tracking-tight uppercase">{activeTab === 'pos' ? 'Retail POS' : 'Staff Portal'}</h1>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{user.role} • {user.name}</p>
        </div>
        <div className="flex items-center gap-3">
          {queue.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-600 rounded-lg animate-pulse">
              <Zap size={14} />
              <span className="text-[10px] font-black">{queue.length} Syncing</span>
            </div>
          )}
          <button onClick={() => setActiveTab('chat')} className="relative p-2 bg-gray-50 rounded-xl">
            <MessageSquare size={20} className="text-gray-400" />
            <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
          </button>
          <div 
            onClick={() => setActiveTab('profile')}
            className="w-10 h-10 bg-[#D4AF37] rounded-2xl flex items-center justify-center text-white font-black shadow-lg shadow-[#D4AF37]/20 cursor-pointer"
          >
            {user.name.charAt(0)}
          </div>
        </div>
      </header>

      <main className="p-5 space-y-6 max-w-lg mx-auto">

        {activeTab === 'pos' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-3">
              <Search className="text-gray-300" size={20} />
              <input 
                type="text" 
                placeholder="Search inventory..." 
                className="flex-1 bg-transparent border-none outline-none text-xs font-black uppercase tracking-widest"
                value={posSearch}
                onChange={(e) => setPosSearch(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {filteredProducts.map(p => (
                <div key={p.id} className="bg-white p-3 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col group hover:border-luxe-gold transition-all">
                  <div className="aspect-square bg-gray-50 rounded-2xl overflow-hidden mb-3 relative">
                    <img src={p.image_url || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=200&q=80'} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    {p.stock <= p.min_threshold && (
                      <div className="absolute top-2 right-2 bg-red-500 text-white text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-tighter shadow-lg">Low Stock</div>
                    )}
                  </div>
                  <h4 className="font-bold text-xs mb-1 line-clamp-1 px-1">{p.name}</h4>
                  <div className="flex items-center justify-between mt-auto p-1">
                    <p className="font-black text-luxe-gold text-sm">${p.selling_price}</p>
                    <button 
                      onClick={() => addToPOSCart(p)}
                      disabled={p.stock <= 0}
                      className="bg-luxe-dark text-white p-2 rounded-xl hover:bg-luxe-gold transition-colors disabled:opacity-50 shadow-md active:scale-95"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {posCart.length > 0 && (
              <div className="fixed bottom-28 left-4 right-4 bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 p-6 z-40 animate-in slide-in-from-bottom-6 duration-500">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-serif font-black text-lg">Current Order</h3>
                  <button onClick={() => setPosCart([])} className="text-red-400 text-[10px] font-black uppercase tracking-widest hover:underline">Clear All</button>
                </div>
                
                <div className="max-h-40 overflow-y-auto space-y-3 mb-4 pr-2 custom-scrollbar">
                  {posCart.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-2xl border border-gray-100/50">
                      <div className="flex-1">
                        <p className="text-[11px] font-black line-clamp-1">{item.name}</p>
                        <p className="text-[10px] text-gray-400 font-bold tracking-tighter">${item.selling_price} × {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => updatePOSQty(item.id, -1)} className="p-1.5 bg-white border border-gray-100 rounded-lg shadow-sm"><Minus size={12} /></button>
                        <span className="text-[11px] font-black w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updatePOSQty(item.id, 1)} className="p-1.5 bg-white border border-gray-100 rounded-lg shadow-sm"><Plus size={12} /></button>
                        <button onClick={() => removeFromPOSCart(item.id)} className="text-red-400 ml-2 hover:bg-red-50 p-1.5 rounded-lg transition-colors"><Trash size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-gray-100 pt-4 mb-5">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Payable Amount</span>
                  <span className="text-3xl font-serif font-black text-luxe-gold">${posTotal.toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handlePOSCheckout('Cash')}
                    disabled={isProcessingSale}
                    className="bg-gray-100 p-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.1em] flex items-center justify-center gap-2 hover:bg-gray-200 transition-all"
                  >
                    <DollarSign size={18} /> Cash
                  </button>
                  <button 
                    onClick={() => handlePOSCheckout('M-Pesa')}
                    disabled={isProcessingSale}
                    className="bg-[#2DBB54] text-white p-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.1em] flex items-center justify-center gap-2 hover:bg-[#259e47] shadow-lg shadow-[#2DBB54]/20 transition-all"
                  >
                    <Zap size={18} /> M-Pesa
                  </button>
                </div>
              </div>
            )}
            
            {saleSuccess && (
               <div className="fixed top-28 left-1/2 -translate-x-1/2 bg-green-500 text-white px-8 py-4 rounded-full shadow-2xl font-black text-xs uppercase tracking-widest animate-in fade-in slide-in-from-top-4 z-50 flex items-center gap-2">
                  <CheckCircle2 size={16} /> Order Completed!
               </div>
            )}
          </div>
        )}
        
        {/* HOME TAB */}
        {activeTab === 'home' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {/* Digital Time Clock */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 text-center space-y-6">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gray-50 rounded-full border border-gray-100">
                <div className={`w-2 h-2 rounded-full ${clockedIn ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{clockedIn ? 'On Shift' : 'Off Shift'}</span>
              </div>
              <h2 className="text-5xl font-serif font-bold tracking-tighter tabular-nums">
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </h2>
              <button 
                onClick={handleAttendance}
                disabled={isAttendanceLoading}
                className={`w-full py-6 rounded-[2rem] font-black uppercase text-xs tracking-[0.2em] transition-all shadow-2xl flex items-center justify-center gap-3 ${
                  clockedIn ? 'bg-white text-red-500 border-2 border-red-50 shadow-red-100' : 'bg-[#2D2424] text-[#D4AF37] shadow-black/20'
                }`}
              >
                <Power size={20} />
                {clockedIn ? 'Clock Out' : 'Clock In Now'}
              </button>
            </div>

            <div className="flex justify-between items-center px-2">
              <h2 className="text-xl font-serif font-black uppercase tracking-tight">Financial Overview</h2>
              <button onClick={fetchData} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-[#D4AF37] transition-colors">
                <Zap size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#2D2424] p-6 rounded-[2.5rem] shadow-xl text-white">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Today</p>
                <p className="text-3xl font-serif font-bold text-[#D4AF37]">${Number(stats.today || 0).toFixed(2)}</p>
                <p className="text-[10px] text-gray-400 mt-2">Live Commission</p>
              </div>
              <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Pending</p>
                <p className="text-3xl font-serif font-bold text-[#2D2424]">${Number(stats.pending || 0).toFixed(2)}</p>
                <p className="text-[10px] text-gray-400 mt-2">Unpaid Payouts</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer" onClick={() => setActiveTab('history')}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Monthly Performance</p>
                <p className="text-2xl font-serif font-bold mt-1">${Number(stats.monthly || 0).toFixed(2)}</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-[#D4AF37]">
                <TrendingUp size={24} />
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
               <button onClick={() => setActiveTab('history')} className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col items-center gap-2">
                 <HistoryIcon size={24} className="text-[#D4AF37]" />
                 <span className="text-[10px] font-black uppercase">60-Day History</span>
               </button>
               <button onClick={() => setActiveTab('profile')} className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col items-center gap-2">
                 <User size={24} className="text-[#D4AF37]" />
                 <span className="text-[10px] font-black uppercase">My Profile</span>
               </button>
            </div>

            {/* Recent History Reminder */}
            <div className="bg-blue-50 p-4 rounded-2xl flex gap-3 items-start border border-blue-100">
              <Info size={18} className="text-blue-500 shrink-0" />
              <p className="text-[10px] text-blue-700 font-medium leading-relaxed">
                Company Policy: Activity logs older than 60 days are automatically purged for data security. Keep your own records if needed.
              </p>
            </div>
          </div>
        )}

        {/* AGENDA TAB */}
        {activeTab === 'agenda' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="text-2xl font-serif font-bold px-2">Today's Agenda</h3>
            <div className="space-y-4 relative before:absolute before:left-6 before:top-4 before:bottom-4 before:w-px before:bg-gray-100">
              {appointments.length === 0 ? (
                <div className="text-center py-20 opacity-30"><Calendar size={48} className="mx-auto mb-4" /><p>No bookings today</p></div>
              ) : (
                appointments.map((apt, i) => {
                  if (!apt) {
                    console.error("Skipping null/undefined appointment at index", i);
                    return null;
                  }
                  return (
                    <div key={apt.id || i} className="relative pl-12 group">
                      <div className={`absolute left-4 top-1 w-4 h-4 rounded-full border-4 border-[#FDFBF7] shadow-sm z-10 ${
                        apt.status === 'completed' ? 'bg-green-500' : 
                        apt.status === 'in-progress' ? 'bg-[#D4AF37]' : 'bg-gray-200'
                      }`}></div>
                      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 group-hover:border-[#D4AF37] transition-all">
                        <div className="flex justify-between items-start mb-4">
                          <p className="text-xs font-black text-gray-400 uppercase tracking-tighter">{apt.start_time || 'N/A'}</p>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                            apt.status === 'completed' ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'
                          }`}>{apt.status || 'N/A'}</span>
                        </div>
                        <h4 className="font-serif font-bold text-lg">{apt.client_name || 'Unknown Client'}</h4>
                        <p className="text-sm font-bold text-[#D4AF37] mt-1">{apt.service_name || 'Unknown Service'}</p>
                        
                        {apt.notes && (
                          <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <p className="text-[10px] font-black uppercase text-gray-400 mb-1">Client Specs</p>
                            <p className="text-xs text-gray-600 italic leading-relaxed">"{apt.notes}"</p>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-6">
                          <button onClick={() => updateApptStatus(apt.id, 'in-progress')} className="py-3 bg-gray-50 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#D4AF37] hover:text-white transition-all">In-Progress</button>
                          <button onClick={() => { setChatTarget({ id: apt.client_id, name: apt.client_name }); setActiveTab('chat'); }} className="py-3 bg-gray-50 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2">
                             <MessageCircle size={14} /> Message Client
                          </button>
                        </div>
                        <button onClick={() => { 
                          setSelectedService(services.find(s => s.id === apt.service_id)); 
                          setSelectedAppointmentId(apt.id);
                          setActiveTab('logger'); 
                        }} className="w-full mt-2 py-4 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Complete & Log</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* LOGGER TAB */}
        {activeTab === 'logger' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="text-2xl font-serif font-bold px-2">Log Activity</h3>
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-gray-100 space-y-6">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-3">1. Service Type</label>
                <div className="grid grid-cols-1 gap-2">
                  <select 
                    className="w-full p-5 bg-gray-50 border-none rounded-2xl text-sm font-bold appearance-none"
                    value={selectedService?.id || ''}
                    onChange={(e) => setSelectedService(services.find(s => s.id === parseInt(e.target.value)))}
                  >
                    <option value="">Choose Service...</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.category} → {s.name} (${s.price})</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-3">2. Product Picker (Multiple Selection)</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-2xl">
                  {products.map(p => {
                    if (!p || typeof p.id === 'undefined') {
                      console.error("Skipping null/undefined product in LOGGER TAB", p);
                      return null;
                    }
                    const isSelected = selectedProducts.find(sp => sp.id === p.id);
                    return (
                      <button 
                        key={p.id}
                        onClick={() => toggleProductSelection(p)}
                        disabled={p.stock <= 0}
                        className={`p-3 rounded-xl text-[10px] font-bold text-left border-2 transition-all flex flex-col gap-1 ${
                          isSelected ? 'bg-[#D4AF37] text-white border-[#D4AF37]' : 'bg-white text-gray-600 border-gray-100 hover:border-[#D4AF37]/30'
                        } ${p.stock <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <span className="truncate">{p.name || 'Unknown Product'}</span>
                        <span className={`text-[8px] uppercase ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>Stock: {typeof p.stock !== 'undefined' ? p.stock : 'N/A'}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedProducts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedProducts.map(p => (
                      <span key={p.id} className="px-2 py-1 bg-[#D4AF37]/10 text-[#D4AF37] rounded-full text-[9px] font-black uppercase flex items-center gap-1">
                        {p.name}
                        <X size={10} className="cursor-pointer" onClick={() => toggleProductSelection(p)} />
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-3">3. Payment Tracking</label>
                <div className="flex gap-2 p-1 bg-gray-50 rounded-2xl">
                  {['Cash', 'M-Pesa', 'Card'].map(m => (
                    <button 
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-tighter transition-all ${
                        paymentMethod === m ? 'bg-white text-[#D4AF37] shadow-sm' : 'text-gray-400'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {selectedService && (
                <div className="pt-6 border-t border-gray-50 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase text-gray-400">Commission Preview</p>
                    <p className="text-2xl font-serif font-bold text-[#D4AF37]">+${Number((selectedService.price * (user?.commission_rate || 40)) / 100).toFixed(2)}</p>
                  </div>
                  <button 
                    onClick={handleLogService}
                    disabled={isLogging}
                    className="px-8 py-4 bg-[#2D2424] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50"
                  >
                    {isLogging ? 'Processing...' : 'Finalize Entry'}
                  </button>
                </div>
              )}
            </div>

            {/* AI Assistant Tool */}
            <div className="bg-[#2D2424] p-8 rounded-[2.5rem] shadow-2xl text-white space-y-4">
              <div className="flex items-center gap-3">
                <Sparkles size={20} className="text-[#D4AF37]" />
                <h4 className="font-serif font-bold text-lg text-[#D4AF37]">Staff AI Assistant</h4>
              </div>
              <p className="text-xs text-gray-400">Ask for upselling suggestions based on client needs.</p>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="e.g. 'Natural nail look'..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-xs focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && getAiUpsell((e.target as HTMLInputElement).value)}
                />
                <button 
                  onClick={() => {
                    const input = document.querySelector('input[placeholder*="Natural"]') as HTMLInputElement;
                    if (input) getAiUpsell(input.value);
                  }}
                  className="p-3 bg-[#D4AF37] text-black rounded-xl"
                >
                  <Zap size={16} />
                </button>
              </div>
              {isAiLoading && <div className="text-xs text-[#D4AF37] animate-pulse font-bold">Consulting AI...</div>}
              {aiSuggestion && (
                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 animate-in zoom-in-95">
                  <p className="text-xs leading-relaxed italic text-[#D4AF37]">{aiSuggestion}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SHOP TAB */}
        {activeTab === 'shop' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-center px-2">
              <h3 className="text-2xl font-serif font-bold">Shop Inventory</h3>
              <div className="text-[10px] font-black text-gray-400 px-3 py-1 bg-white rounded-full border border-gray-100 uppercase">Prices SP Only</div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {products.map(p => {
                if (!p || typeof p.id === 'undefined') {
                  console.error("Skipping null/undefined product in SHOP TAB", p);
                  return null;
                }
                return (
                  <div key={p.id} className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400"><Package size={24}/></div>
                      <div>
                        <p className="font-bold text-sm">{p.name || 'Unknown Product'}</p>
                        <p className="text-[10px] font-black text-[#D4AF37] uppercase tracking-tighter mt-0.5">${Number(p.selling_price || 0).toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-[10px] font-black uppercase text-gray-400">Stock</p>
                        <p className={`font-bold text-sm ${p.stock <= p.min_threshold ? 'text-red-500' : 'text-green-600'}`}>{typeof p.stock !== 'undefined' ? p.stock : 'N/A'} left</p>
                      </div>
                      <button 
                        onClick={() => reportDepleted(p.id)}
                        className={`p-3 rounded-xl transition-all ${p.manual_depleted ? 'bg-red-500 text-white' : 'bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500'}`}
                      >
                        <AlertTriangle size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="text-2xl font-serif font-bold px-2">60-Day Activity</h3>
            <div className="space-y-4">
              {logs.length === 0 ? (
                <div className="text-center py-20 opacity-30"><HistoryIcon size={48} className="mx-auto mb-4" /><p>No history found</p></div>
              ) : (
                logs.map((log, i) => {
                  if (!log) {
                    console.error("Skipping null/undefined log entry in HISTORY TAB", log);
                    return null;
                  }
                  return (
                    <div key={log.id || i} className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-[10px] font-black text-gray-400 uppercase">{log.timestamp ? new Date(log.timestamp).toLocaleDateString() : 'N/A'}</p>
                        <span className="text-[10px] font-black text-[#D4AF37] px-2 py-0.5 bg-[#D4AF37]/10 rounded-full">+${Number(log.commission_earned || 0).toFixed(2)}</span>
                      </div>
                      <h4 className="font-bold text-sm">{log.action || 'Unknown Action'}</h4>
                      <p className="text-xs text-gray-500 mt-1">{log.details || 'No details provided'}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="text-2xl font-serif font-bold px-2">Staff Profile</h3>
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-6">
              <div className="flex flex-col items-center gap-4 mb-4">
                <div className="w-24 h-24 bg-[#D4AF37] rounded-[2rem] flex items-center justify-center text-white text-4xl font-black shadow-xl">
                  {user.name.charAt(0)}
                </div>
                <div className="text-center">
                  <h4 className="text-xl font-bold">{user.name}</h4>
                  <p className="text-xs text-[#D4AF37] font-black uppercase tracking-widest">{user.role}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">Phone Number</label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input 
                      type="text" 
                      value={profile.phone}
                      onChange={(e) => setProfile({...profile, phone: e.target.value})}
                      className="w-full pl-11 p-4 bg-gray-50 border-none rounded-2xl text-sm font-bold"
                      placeholder="e.g. +254..."
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">Bio / Introduction</label>
                  <div className="relative">
                    <BookOpen size={16} className="absolute left-4 top-5 text-gray-300" />
                    <textarea 
                      value={profile.bio}
                      onChange={(e) => setProfile({...profile, bio: e.target.value})}
                      className="w-full pl-11 p-4 bg-gray-50 border-none rounded-2xl text-sm font-bold min-h-[100px]"
                      placeholder="Share a bit about your experience..."
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">Specialized Skills</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {profile.skills.map((skill: string, i: number) => (
                      <span key={i} className="px-3 py-1 bg-[#D4AF37]/10 text-[#D4AF37] rounded-full text-[10px] font-black uppercase flex items-center gap-2">
                        {skill}
                        <button onClick={() => setProfile({...profile, skills: profile.skills.filter((_: any, idx: number) => idx !== i)})}><X size={12}/></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      id="skill-input"
                      placeholder="Add a skill..."
                      className="flex-1 p-3 bg-gray-50 border-none rounded-xl text-xs font-bold"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value;
                          if (val) {
                            setProfile({...profile, skills: [...profile.skills, val]});
                            (e.target as HTMLInputElement).value = '';
                          }
                        }
                      }}
                    />
                    <button 
                      onClick={() => {
                        const el = document.getElementById('skill-input') as HTMLInputElement;
                        if (el.value) {
                          setProfile({...profile, skills: [...profile.skills, el.value]});
                          el.value = '';
                        }
                      }}
                      className="p-3 bg-[#D4AF37] text-white rounded-xl"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-50">
                  <button 
                    onClick={handleUpdateProfile}
                    disabled={isUpdatingProfile}
                    className="w-full py-5 bg-[#2D2424] text-white rounded-[2rem] font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl disabled:opacity-50"
                  >
                    <Save size={18} />
                    {isUpdatingProfile ? 'Saving...' : 'Save Profile Changes'}
                  </button>
                </div>

                <button 
                  onClick={logout}
                  className="w-full py-4 text-red-500 font-black text-[10px] uppercase tracking-widest"
                >
                  Logout from Portal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <div className="h-[70vh] flex flex-col animate-in fade-in duration-300">
            <div className="p-4 bg-white border-b border-gray-100 flex justify-between items-center rounded-t-3xl shadow-sm">
               <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[#D4AF37] rounded-full flex items-center justify-center text-white text-[10px] font-black">
                     {chatTarget.name.charAt(0)}
                  </div>
                  <div>
                     <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Messaging</p>
                     <p className="text-sm font-bold">{chatTarget.name}</p>
                  </div>
               </div>
               {chatTarget.id !== 1 && (
                  <button onClick={() => setChatTarget({ id: 1, name: 'Manager' })} className="px-3 py-1 bg-gray-50 rounded-lg text-[10px] font-black uppercase text-gray-400">Switch to Manager</button>
               )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-center py-10 opacity-20"><HistoryIcon size={48} className="mx-auto mb-4" /><p className="text-xs font-black uppercase tracking-widest">Chat records are permanent</p></div>
              {messages.map((m, i) => (
                <div key={i} className={`max-w-[80%] p-4 rounded-[1.5rem] text-xs font-medium ${m.self ? 'ml-auto bg-[#2D2424] text-white rounded-tr-none' : 'bg-white border border-gray-100 rounded-tl-none shadow-sm'}`}>
                  {m.message}
                </div>
              ))}
            </div>
            <div className="p-4 bg-white border-t border-gray-100 flex gap-3">
              <input 
                type="text" 
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Message Manager..."
                className="flex-1 bg-gray-50 border-none rounded-2xl p-4 text-xs font-bold focus:ring-2 focus:ring-[#D4AF37]"
              />
              <button onClick={sendMessage} className="w-14 h-14 bg-[#2D2424] text-[#D4AF37] rounded-2xl flex items-center justify-center shadow-lg shadow-black/10"><MessageSquare size={20} /></button>
            </div>
          </div>
        )}

      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 z-40 shadow-[0_-10px_40px_rgba(0,0,0,0.02)]">
        <div className="max-w-md mx-auto flex justify-around">
          {[
            { id: 'home', icon: User, label: 'Dash' },
            { id: 'agenda', icon: ListTodo, label: 'Agenda' },
            { id: 'pos', icon: ShoppingCart, label: 'Sell' },
            { id: 'logger', icon: CheckSquare, label: 'Log' },
            { id: 'shop', icon: Package, label: 'Shop' },
            { id: 'chat', icon: MessageCircle, label: 'Help' },
          ].map(btn => (
            <button
              key={btn.id}
              onClick={() => setActiveTab(btn.id)}
              className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === btn.id ? 'text-[#D4AF37] scale-110' : 'text-gray-300 hover:text-gray-500'}`}
            >
              <btn.icon size={22} strokeWidth={activeTab === btn.id ? 2.5 : 2} />
              <span className="text-[9px] font-black uppercase tracking-tighter">{btn.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
