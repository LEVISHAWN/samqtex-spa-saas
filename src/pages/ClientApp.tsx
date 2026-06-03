import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, MessageSquare, Sparkles, Loader2, User, MessageCircle, X, MapPin, Clock, CreditCard, ChevronRight, CheckCircle2, Zap, Package, ShoppingBag, Plus, Minus, Trash2 } from 'lucide-react';
import { authFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { io, Socket } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});
const goldBranchIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

function FitBounds({ bounds }: { bounds: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds.length) return;
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [bounds, map]);

  return null;
}

export default function ClientApp() {
  const { tenant } = useTenant();
  const [services, setServices] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const selectedBranch = branches.find((branch) => branch.id === activeBranchId) || null;
  const locationMarkers = [
    ...(tenant?.latitude && tenant?.longitude ? [{
      id: 'main',
      position: [parseFloat(String(tenant.latitude)), parseFloat(String(tenant.longitude))] as [number, number],
      title: tenant.name || 'Main Salon',
      description: tenant.address,
      isBranch: false,
    }] : []),
    ...branches.filter((branch) => branch.latitude && branch.longitude).map((branch) => ({
      id: `branch-${branch.id}`,
      position: [parseFloat(String(branch.latitude)), parseFloat(String(branch.longitude))] as [number, number],
      title: branch.name,
      description: branch.address,
      isBranch: true,
    }))
  ];
  const [prompt, setPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false); // This will only control the "human support" chat now
  const [chatMode, setChatMode] = useState<'ai' | 'support'>('ai'); // Default to AI for the main tab
  const [aiMessages, setAiMessages] = useState<{message: string, self: boolean}[]>([
    { message: "Hi! I'm your AI Stylist. How can I help you today? Ask me about our services or recommendations!", self: false }
  ]);
  const [activeTab, setActiveTab] = useState('book'); // 'book', 'history', 'products', 'ai_chat'
  
  // Booking Flow State
  const [bookingStep, setBookingStep] = useState(0); // 0: None, 1: Details, 2: Payment, 3: Success
  const [bookingService, setBookingService] = useState<any | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedWorker, setSelectedWorker] = useState('any');
  const [specialRequests, setSpecialRequests] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(''); // 'pending', 'success'
  const [transactionRef, setTransactionRef] = useState('');
  const [finalPrice, setFinalPrice] = useState(0);
  const [expirationTime, setExpirationTime] = useState<Date | null>(null);

  // Cart State
  const [cart, setCart] = useState<any[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);

  // History State
  const [historyPhone, setHistoryPhone] = useState('');
  const [myAppointments, setMyAppointments] = useState<any[]>([]);
  const [myOrders, setMyOrders] = useState<any[]>([]);

  // Broadcast State
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [showBroadcasts, setShowBroadcasts] = useState(false);
  
  const { refetchTenant } = useTenant();

  const addToCart = (product: any) => {
    setCart(prev => {
      const exists = prev.find(i => i.id === product.id);
      if (exists) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...product, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const updateQty = (id: number, delta: number) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i));
  };

  const removeFromCart = (id: number) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const cartTotal = cart.reduce((sum, i) => sum + (i.selling_price * i.quantity), 0);

  const handleCheckout = async (method: string) => {
    setIsOrdering(true);
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart,
          total_amount: cartTotal,
          payment_method: method,
          client_name: clientName,
          client_phone: clientPhone,
          type: 'online'
        })
      });
      if (!res.ok) throw new Error(await res.text());
      setCart([]);
      setOrderComplete(true);
      setTimeout(() => {
        setOrderComplete(false);
        setIsCartOpen(false);
        setActiveTab('history');
      }, 3000);
    } catch (err) {
      alert("Order failed. Please check stock levels.");
    } finally {
      setIsOrdering(false);
    }
  };

  const fetchMyOrders = async () => {
    try {
      const res = await authFetch('/api/orders/my');
      if (res.ok) {
        const data = await res.json();
        setMyOrders(data);
      }
    } catch (e) {}
  };

  // Chat State
  const [messages, setMessages] = useState<any[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Attempt to pre-fill if user was logged in previously
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        setClientName(u.name || '');
        setClientPhone(u.phone || '');
        setHistoryPhone(u.phone || '');
      } catch(e) {}
    }

    authFetch('/api/services')
      .then(res => res.json())
      .then(data => setServices(data))
      .catch(err => console.error("Failed to fetch services", err));
      
    authFetch('/api/workers')
      .then(res => res.json())
      .then(data => setWorkers(data))
      .catch(err => console.error("Failed to fetch workers", err));

    authFetch('/api/branches')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) { setBranches(data); } })
      .catch(err => console.error("Failed to fetch branches", err));

    // Fetch broadcast messages
    authFetch('/api/broadcasts')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setBroadcasts(data); })
      .catch(err => console.error("Failed to fetch broadcasts", err));

    // Refetch tenant and branch data when page comes back into focus
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refetchTenant();
        authFetch('/api/branches')
          .then(res => res.json())
          .then(data => { if (Array.isArray(data)) { setBranches(data); } })
          .catch(err => console.error("Failed to refresh branches", err));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      socketRef.current?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refetchTenant]);

  // Fetch products when the products tab is active
  useEffect(() => {
    if (activeTab === 'products') {
      authFetch('/api/products')
        .then(res => res.json())
        .then(data => setProducts(data))
        .catch(err => console.error("Failed to fetch products", err));
    }
  }, [activeTab]);

  // Fetch history when phone number is entered
  useEffect(() => {
    if (historyPhone.length < 9) return;
    authFetch(`/api/appointments/client/${historyPhone}`)
      .then(res => res.json())
      .then(data => setMyAppointments(data))
      .catch(err => console.error("Failed to fetch history", err));
    fetchMyOrders();
  }, [historyPhone, activeTab]);

  const handleAskAI = async (text: string = prompt) => {
    if (!text.trim()) return;
    setIsLoading(true);
    setAiResponse('');
    setPrompt(text);
    
    try {
      const res = await authFetch('/api/ai-stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text })
      });
      const data = await res.json();
      setAiResponse(data.reply || "Sorry, I couldn't process that request right now.");
    } catch (error) {
      setAiResponse("An error occurred while connecting to the AI Stylist.");
    } finally {
      setIsLoading(false);
    }
  };

  const sendAiMessage = async () => {
    if (!chatMessage.trim()) return;
    const text = chatMessage;
    setChatMessage('');
    setIsLoading(true);
    
    setAiMessages(prev => [...prev, { message: text, self: true }]);
    
    try {
      const res = await authFetch('/api/ai-stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text })
      });
      const data = await res.json();
      setAiMessages(prev => [...prev, { message: data.reply || "Sorry, I couldn't process that request right now.", self: false }]);
    } catch (error) {
      setAiMessages(prev => [...prev, { message: "An error occurred while connecting to the AI Stylist.", self: false }]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAvailableSlots = async () => {
    if (!bookingDate || !bookingService) return;
    setIsLoading(true);
    try {
      const res = await authFetch(`/api/appointments/available-slots?date=${bookingDate}&service_id=${bookingService.id}&worker_id=${selectedWorker}`);
      const slots = await res.json();
      setAvailableSlots(slots);
    } catch (error) {
      console.error("Failed to fetch slots", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailableSlots();
  }, [bookingDate, bookingService, selectedWorker]);

  const handleConfirmBooking = async () => {
    if (!clientName || !clientPhone || !bookingDate || !bookingTime) {
      alert("Please select a date, time, and confirm your details.");
      return;
    }
    
    setIsBooking(true);
    try {
      const res = await authFetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: clientName,
          client_phone: clientPhone,
          service_id: bookingService.id,
          worker_id: selectedWorker,
          date: bookingDate,
          start_time: bookingTime,
          notes: specialRequests
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm booking.");

      setFinalPrice(data.final_price);
      setBookingStep(3); // Directly to success
      setPaymentStatus('success');
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsBooking(false);
    }
  };

  const handleStripePayment = async () => {
    if (!bookingService) return;
    setIsBooking(true);
    try {
      const res = await authFetch('/api/payments/stripe/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          amount: bookingService.price,
          appointmentId: 'pending_' + Date.now()
        })
      });
      const session = await res.json();
      // In a real app, you'd redirect to session.url
      console.log("Stripe Session:", session);
      handleSimulatePayment(); // Fallback to simulation for this demo
    } catch (error) {
      alert("Stripe integration failed. Using backup payment method.");
      handleSimulatePayment();
    }
  };

  const handleSimulatePayment = async () => {
    setIsBooking(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const res = await authFetch('/api/payments/mpesa/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: transactionRef })
      });

      if (!res.ok) throw new Error("Payment Confirm Failed");

      setPaymentStatus('success');
      setBookingStep(3);
    } catch (error) {
      alert("Payment confirmation failed. Try again.");
    } finally {
      setIsBooking(false);
    }
  };

  const startBooking = (service: any) => {
    setBookingService(service);
    setBookingStep(1);
  };

  const sendMessage = () => {
    if (!chatMessage.trim()) return;
    const storedUser = localStorage.getItem('user');
    const u = storedUser ? JSON.parse(storedUser) : null;
    
    const msgData = {
      tenant_id: localStorage.getItem('tenantId') || '1',
      sender_id: u?.id || clientPhone || 'guest',
      receiver_id: 1, // Manager
      message: chatMessage
    };
    socketRef.current?.emit("send_message", msgData);
    setMessages(prev => [...prev, { ...msgData, self: true }]);
    setChatMessage('');
  };

  const closeBooking = () => {
    setBookingStep(0);
    setBookingService(null);
    setPaymentStatus('');
    setTransactionRef('');
  };

  return (
    <div className="min-h-screen bg-luxe-bg text-luxe-text relative font-sans">
      <header className="border-b border-gray-200 p-4 sticky top-0 bg-luxe-bg/80 backdrop-blur-md z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <Link to="/" className="text-gray-500 hover:text-luxe-dusty transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-xl font-serif font-bold text-luxe-text">{tenant?.name || 'SamQtex Spa'}</h1>
          <div className="w-6" />
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-8 pb-24">
        
        {/* Broadcast Messages Banner */}
        {broadcasts.length > 0 && (
          <div className="sticky top-20 z-20 space-y-2">
            <button 
              onClick={() => setShowBroadcasts(!showBroadcasts)}
              className="w-full bg-gradient-to-r from-luxe-gold to-luxe-dusty text-black p-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-between hover:shadow-lg transition-all"
            >
              <span>📢 {broadcasts.length} New Message{broadcasts.length !== 1 ? 's' : ''} from {tenant?.name}</span>
              <ChevronRight className={`w-5 h-5 transition-transform ${showBroadcasts ? 'rotate-90' : ''}`} />
            </button>

            {showBroadcasts && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden space-y-0">
                {broadcasts.map((broadcast, idx) => (
                  <div key={idx} className={`p-4 ${idx !== broadcasts.length - 1 ? 'border-b border-gray-100' : ''}`}>
                    <p className="text-xs text-gray-400 font-black uppercase tracking-widest mb-2">
                      {new Date(broadcast.timestamp).toLocaleDateString()} {new Date(broadcast.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                    </p>
                    <p className="text-sm font-medium leading-relaxed text-gray-800">{broadcast.message}</p>
                  </div>
                ))}
                <button 
                  onClick={() => setShowBroadcasts(false)}
                  className="w-full p-3 bg-gray-50 text-gray-600 text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
                >
                  <X size={14} /> Close
                </button>
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'book' && (
          <>
            <section className="text-center py-4">
              <h2 className="text-3xl font-serif font-bold mb-2">Book Your <span className="text-luxe-dusty italic">Glow</span></h2>
              <p className="text-gray-500 text-sm">Premium salon services at your fingertips.</p>
            </section>

            <section>
              <h3 className="text-lg font-serif font-bold mb-4">Service Catalog</h3>
              <div className="space-y-4">
                {services.map((service) => (
                  <div key={service.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden flex hover:shadow-md transition-shadow">
                    <div className="w-24 h-24 bg-gray-100 flex-shrink-0">
                      <img src={service.image_url || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=200&q=80'} alt={service.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] text-luxe-dusty font-black uppercase tracking-widest">{service.category}</span>
                        <h4 className="font-serif font-bold text-sm">{service.name}</h4>
                        <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" /> {service.duration_minutes} min
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-luxe-gold">${service.price}</p>
                        <button 
                          onClick={() => startBooking(service)}
                          className="text-xs font-black uppercase tracking-widest text-luxe-dusty hover:text-luxe-dusty-hover transition-colors"
                        >
                          Book Now
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Find Us Section */}
            {(branches.length > 0 || (tenant?.latitude && tenant?.longitude)) && (
              <section className="space-y-4">
                <h3 className="text-lg font-serif font-bold flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-luxe-dusty" />
                  Find Us
                </h3>

                {/* Branch selector tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {/* Main Salon Tab */}
                  <button
                    onClick={() => setActiveBranchId(null)}
                    className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                      activeBranchId === null
                        ? 'bg-luxe-dark text-white shadow-md'
                        : 'bg-white border border-gray-200 text-gray-500 hover:border-luxe-dusty'
                    }`}
                  >
                    Main Salon
                  </button>
                  {/* Branch Tabs */}
                  {branches.map(b => (
                    <button
                      key={b.id}
                      onClick={() => setActiveBranchId(b.id)}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                        activeBranchId === b.id
                          ? 'bg-luxe-dark text-white shadow-md'
                          : 'bg-white border border-gray-200 text-gray-500 hover:border-luxe-dusty'
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>

                {/* Location details */}
                {activeBranchId === null ? (
                  /* Main Salon Details */
                  <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                      {/* Map */}
                      {locationMarkers.length > 0 ? (
                        <div style={{height: '220px'}}>
                          <MapContainer
                            center={locationMarkers[0].position}
                            zoom={15}
                            style={{ height: '100%', width: '100%' }}
                            zoomControl={false}
                            dragging={true}
                          >
                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                            <FitBounds bounds={locationMarkers.map((marker) => marker.position)} />
                            {locationMarkers.map((marker) => (
                              <Marker
                                key={marker.id}
                                position={marker.position}
                                icon={marker.isBranch ? goldBranchIcon : undefined}
                              >
                                <Popup>
                                  <b>{marker.title}</b><br />{marker.description}
                                </Popup>
                              </Marker>
                            ))}
                          </MapContainer>
                        </div>
                      ) : (
                        <div className="h-32 bg-gray-50 flex items-center justify-center">
                          <p className="text-xs text-gray-300 font-bold uppercase tracking-widest">Location pin not set yet</p>
                        </div>
                      )}
                    {/* Salon info */}
                    <div className="p-5 space-y-2">
                      <h4 className="font-serif font-bold text-base">{tenant?.name || 'Main Salon'}</h4>
                      {tenant?.address && (
                        <p className="text-xs text-gray-500 flex items-start gap-2">
                          <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-luxe-dusty" />
                          {tenant.address}
                        </p>
                      )}
                      {tenant?.phone && (
                        <p className="text-xs text-gray-500 flex items-center gap-2">
                          <span className="text-luxe-dusty font-bold">📞</span>
                          <a href={`tel:${tenant.phone}`} className="hover:text-luxe-dusty transition-colors font-medium">{tenant.phone}</a>
                        </p>
                      )}
                      {tenant?.latitude && tenant?.longitude && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${tenant.latitude},${tenant.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block mt-3 text-center py-3 bg-luxe-dark text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-luxe-dusty transition-colors"
                        >
                          Get Directions →
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Branch Details */
                  branches.filter(b => b.id === activeBranchId).map(b => (
                    <div key={b.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                      {/* Map */}
                      {locationMarkers.length > 0 ? (
                        <div style={{height: '220px'}}>
                          <MapContainer
                            center={locationMarkers[0].position}
                            zoom={15}
                            style={{ height: '100%', width: '100%' }}
                            zoomControl={false}
                            dragging={true}
                          >
                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                            <FitBounds bounds={locationMarkers.map((marker) => marker.position)} />
                            {locationMarkers.map((marker) => (
                              <Marker
                                key={marker.id}
                                position={marker.position}
                                icon={marker.isBranch ? goldBranchIcon : undefined}
                              >
                                <Popup>
                                  <b>{marker.title}</b><br />{marker.description}
                                </Popup>
                              </Marker>
                            ))}
                          </MapContainer>
                        </div>
                      ) : (
                        <div className="h-32 bg-gray-50 flex items-center justify-center">
                          <p className="text-xs text-gray-300 font-bold uppercase tracking-widest">Location pin not set yet</p>
                        </div>
                      )}

                      {/* Branch info */}
                      <div className="p-5 space-y-2">
                        <h4 className="font-serif font-bold text-base">{b.name}</h4>
                        {b.address && (
                          <p className="text-xs text-gray-500 flex items-start gap-2">
                            <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-luxe-dusty" />
                            {b.address}
                          </p>
                        )}
                        {b.phone && (
                          <p className="text-xs text-gray-500 flex items-center gap-2">
                            <span className="text-luxe-dusty font-bold">📞</span>
                            <a href={`tel:${b.phone}`} className="hover:text-luxe-dusty transition-colors font-medium">{b.phone}</a>
                          </p>
                        )}
                        {b.latitude && b.longitude && (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${b.latitude},${b.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mt-3 text-center py-3 bg-luxe-dark text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-luxe-dusty transition-colors"
                          >
                            Get Directions →
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </section>
            )}
          </>
        )}

        {activeTab === 'products' && (
          <section className="space-y-6">
            <h2 className="text-2xl font-serif font-bold">Shop Inventory</h2>
            <div className="grid grid-cols-2 gap-4">
              {products.map(p => (
                <div key={p.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                  <div className="aspect-square bg-gray-100 relative">
                    <img src={p.image_url || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=400&q=80'} alt={p.name} className="w-full h-full object-cover" />
                    <div className={`absolute top-2 left-2 text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-widest ${p.stock > 0 ? 'bg-white/90 text-green-700' : 'bg-red-500 text-white'}`}>
                      {p.stock > 0 ? 'AVAILABLE' : 'OUT OF STOCK'}
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest mb-1">{p.category}</span>
                    <h4 className="font-bold text-sm mb-1">{p.name}</h4>
                    <p className="text-xs text-gray-500 line-clamp-1 mb-3 flex-1">{p.description}</p>
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-luxe-gold text-lg">${p.selling_price}</p>
                      <button 
                        disabled={p.stock <= 0}
                        onClick={() => addToCart(p)}
                        className="bg-luxe-dark text-white p-2 rounded-xl hover:bg-luxe-dusty transition-colors disabled:opacity-50"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'history' && (
          <section className="space-y-6">
            <div className="text-center py-4">
              <h2 className="text-2xl font-serif font-bold">Purchase History</h2>
              <p className="text-xs text-gray-400 uppercase tracking-widest mt-1">Orders & Appointments</p>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
              <p className="text-xs text-gray-500 leading-relaxed text-center italic">
                Enter your phone number to see your appointment history and product orders.
              </p>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 ml-1">Phone Number</label>
                <input 
                  type="tel" 
                  placeholder="e.g. 0712345678"
                  value={historyPhone}
                  onChange={(e) => setHistoryPhone(e.target.value)}
                  className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-luxe-dusty" 
                />
              </div>
            </div>

            {myOrders.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Product Orders</h3>
                {myOrders.map(order => (
                  <div key={order.id} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
                    <div>
                      <p className="font-bold text-sm">Order #{order.id}</p>
                      <p className="text-[10px] text-gray-400 uppercase font-bold">{new Date(order.created_at).toLocaleDateString()} • {order.payment_method}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-luxe-gold">${order.total_amount}</p>
                      <span className="text-[8px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-full bg-green-50 text-green-600">{order.payment_status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Service Appointments</h3>
              {myAppointments.length === 0 && historyPhone.length >= 9 && !isLoading && (
                <div className="text-center py-10 opacity-30">
                  <Calendar size={48} className="mx-auto mb-2" />
                  <p className="text-xs font-bold uppercase tracking-widest">No records found for this number</p>
                </div>
              )}
              {myAppointments.map(apt => (
                <div key={apt.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm group hover:border-luxe-dusty transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="text-[10px] font-black text-luxe-dusty uppercase tracking-tighter bg-luxe-dusty/5 px-2 py-0.5 rounded-full mb-1 inline-block">{apt.status}</span>
                      <h4 className="font-serif font-bold text-lg">{apt.service_name}</h4>
                    </div>
                    <div className="text-right">
                       <p className="text-sm font-black text-luxe-gold">${apt.price || 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 pt-4 border-t border-gray-50">
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} className="text-gray-300" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">{new Date(apt.date).toLocaleDateString()} • {apt.start_time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'ai_chat' && (
          <section className="space-y-6">
            <h2 className="text-2xl font-serif font-bold mb-4">AI Stylist Chat</h2>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/30 min-h-[40vh] rounded-xl border border-gray-100">
              {aiMessages.map((m, i) => (
                <div key={i} className={`p-3 rounded-2xl text-xs font-medium max-w-[85%] ${m.self ? 'bg-luxe-dusty text-white ml-auto rounded-tr-none' : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none shadow-sm'}`}>
                  {m.message}
                </div>
              ))}
              {isLoading && (
                <div className="p-3 text-xs text-luxe-dusty rounded-2xl bg-white border border-gray-100 max-w-[85%] rounded-tl-none flex gap-1 items-center h-10 w-12">
                   <div className="w-1.5 h-1.5 rounded-full bg-luxe-dusty animate-bounce"></div>
                   <div className="w-1.5 h-1.5 rounded-full bg-luxe-dusty animate-bounce delay-75"></div>
                   <div className="w-1.5 h-1.5 rounded-full bg-luxe-dusty animate-bounce delay-150"></div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-gray-100 bg-white flex gap-2 rounded-xl shadow-sm">
              <input 
                type="text" 
                value={chatMessage} 
                onChange={e => setChatMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendAiMessage(); }}
                className="flex-1 bg-gray-50 border-none rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-luxe-dusty outline-none"
                placeholder="Ask about styles or FAQs..."
              />
              <button 
                onClick={sendAiMessage} 
                className="bg-luxe-dusty text-white p-3 rounded-xl hover:bg-luxe-dusty-hover transition-colors shadow-md shadow-luxe-dusty/20"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {activeTab === 'broadcasts' && (
          <section className="space-y-6">
            <h2 className="text-2xl font-serif font-bold mb-4">Messages from {tenant?.name}</h2>
            {broadcasts.length > 0 ? (
              <div className="space-y-4">
                {broadcasts.map((broadcast, idx) => (
                  <div key={idx} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-[10px] font-black uppercase tracking-widest text-luxe-dusty">📢 Announcement</span>
                      <span className="text-xs text-gray-400 font-medium">
                        {new Date(broadcast.timestamp).toLocaleDateString()} {new Date(broadcast.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-800 font-medium">{broadcast.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <MessageSquare size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-400 font-medium">No messages yet</p>
                <p className="text-xs text-gray-500 mt-1">Check back soon for announcements from {tenant?.name}</p>
              </div>
            )}
          </section>
        )}

      </main>

      {/* Cart FAB */}
      {cart.length > 0 && !isCartOpen && (
        <button 
          onClick={() => setIsCartOpen(true)}
          className="fixed bottom-24 right-4 z-40 bg-luxe-dusty text-white p-4 rounded-full shadow-2xl animate-bounce flex items-center gap-2"
        >
          <ShoppingBag size={24} />
          <span className="bg-white text-luxe-dusty text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">{cart.reduce((a, b) => a + b.quantity, 0)}</span>
        </button>
      )}

      {/* Cart Sidebar / Modal */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsCartOpen(false)} />
          <div className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-xl font-serif font-bold">Your Cart</h3>
              <button onClick={() => setIsCartOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {orderComplete ? (
                <div className="text-center py-20 space-y-4">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 size={40} className="text-green-600" />
                  </div>
                  <h4 className="text-2xl font-serif font-bold">Order Received!</h4>
                  <p className="text-sm text-gray-500">Thank you for your purchase. You can track your order in the history tab.</p>
                </div>
              ) : cart.length === 0 ? (
                <div className="text-center py-20 opacity-20">
                  <ShoppingBag size={64} className="mx-auto mb-4" />
                  <p className="font-black uppercase tracking-widest text-sm">Cart is Empty</p>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.id} className="flex gap-4">
                    <div className="w-20 h-20 bg-gray-100 rounded-2xl overflow-hidden shrink-0">
                      <img src={item.image_url || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=200&q=80'} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h4 className="font-bold text-sm">{item.name}</h4>
                      <p className="text-luxe-gold font-bold text-xs">${item.selling_price}</p>
                      <div className="flex items-center gap-3 pt-2">
                        <button onClick={() => updateQty(item.id, -1)} className="p-1 border border-gray-200 rounded-lg"><Minus size={12} /></button>
                        <span className="text-xs font-black">{item.quantity}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="p-1 border border-gray-200 rounded-lg"><Plus size={12} /></button>
                        <button onClick={() => removeFromCart(item.id)} className="ml-auto text-red-400 p-1"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {!orderComplete && cart.length > 0 && (
              <div className="p-6 border-t border-gray-100 space-y-4 bg-gray-50/50">
                <div className="flex justify-between items-end">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Amount</span>
                  <span className="text-2xl font-serif font-bold text-luxe-gold">${cartTotal.toFixed(2)}</span>
                </div>
                
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Select Payment Method</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => handleCheckout('Cash')}
                      disabled={isOrdering}
                      className="bg-white border border-gray-200 p-3 rounded-2xl text-[10px] font-black uppercase tracking-tighter hover:border-luxe-dusty transition-all flex flex-col items-center gap-1"
                    >
                      <CreditCard size={16} /> Cash / Store
                    </button>
                    <button 
                      onClick={() => handleCheckout('M-Pesa')}
                      disabled={isOrdering}
                      className="bg-[#2DBB54] text-white p-3 rounded-2xl text-[10px] font-black uppercase tracking-tighter hover:bg-[#259e47] transition-all flex flex-col items-center gap-1"
                    >
                      <Zap size={16} /> M-Pesa
                    </button>
                  </div>
                  <button 
                    onClick={() => handleCheckout('Stripe')}
                    disabled={isOrdering}
                    className="w-full bg-[#635BFF] text-white p-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[#5249cf] transition-all flex items-center justify-center gap-2"
                  >
                    Pay with Card (Stripe)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Chatbot & Direct Chat (now only for human support) */}
      <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2">
        {isChatOpen && (
          <div className="bg-white border border-gray-200 rounded-2xl w-80 shadow-2xl overflow-hidden flex flex-col h-[28rem]">
            <div className="bg-luxe-bg p-3 flex justify-between items-center border-b border-gray-200">
              <span className="font-serif font-bold text-sm flex items-center gap-2">
                <User className="w-4 h-4 text-luxe-gold" /> Support
              </span>
              <button onClick={() => setIsChatOpen(false)}><X className="w-5 h-5 text-gray-400 hover:text-black transition-colors" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/30">
              {messages.map((m, i) => (
                <div key={i} className={`p-3 rounded-2xl text-xs font-medium max-w-[85%] ${m.self ? 'bg-luxe-dusty text-white ml-auto rounded-tr-none' : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none shadow-sm'}`}>
                  {m.message}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-gray-100 bg-white flex gap-2">
              <input 
                type="text" 
                value={chatMessage} 
                onChange={e => setChatMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
                className="flex-1 bg-gray-50 border-none rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-luxe-dusty outline-none"
                placeholder="Message manager..."
              />
              <button 
                onClick={sendMessage} 
                className="bg-luxe-dusty text-white p-3 rounded-xl hover:bg-luxe-dusty-hover transition-colors shadow-md shadow-luxe-dusty/20"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        <button 
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="bg-luxe-dusty text-white w-14 h-14 rounded-full flex items-center justify-center shadow-2xl shadow-luxe-dusty/40 hover:scale-105 transition-transform group"
        >
          <MessageCircle className="w-6 h-6" /> {/* Always Message Circle now, no Sparkles toggle */}
        </button>
      </div>

      {/* Booking Modal */}
      {bookingStep > 0 && bookingService && (
        <div className="fixed inset-0 bg-luxe-dark/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-xl font-serif font-bold">{bookingService.name}</h3>
              <button onClick={closeBooking}><X className="w-6 h-6 text-gray-400" /></button>
            </div>

            {bookingStep === 1 && (
              <div className="space-y-4">
                <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Name" className="w-full bg-gray-50 border p-3 rounded-xl text-sm" />
                <input type="tel" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Phone" className="w-full bg-gray-50 border p-3 rounded-xl text-sm" />
                
                <h4 className="font-bold text-sm mt-4 text-gray-500">Pick Professional</h4>
                <select value={selectedWorker} onChange={e => setSelectedWorker(e.target.value)} className="w-full bg-gray-50 border p-3 rounded-xl text-sm font-medium">
                  <option value="any">Any Available (Most Efficient)</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name} {w.tier ? `(${w.tier.toUpperCase()})` : ''}</option>)}
                </select>

                <h4 className="font-bold text-sm mt-4 text-gray-500">Select Date</h4>
                <input type="date" min={new Date().toISOString().split('T')[0]} value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="w-full bg-gray-50 border p-3 rounded-xl" />
                
                {bookingDate && (
                  <div className="space-y-2">
                    <h4 className="font-bold text-sm mt-4 text-gray-500">Available Time Slots</h4>
                    {isLoading ? <p className="text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Checking slots...</p> : 
                     availableSlots.length > 0 ? (
                       <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto p-1">
                         {availableSlots.map(slot => {
                           const timeStr = slot.substring(0, 5);
                           return (
                             <button 
                               key={slot} 
                               onClick={() => setBookingTime(slot)}
                               className={`py-2 rounded-lg text-sm font-medium border transition-colors ${bookingTime === slot ? 'bg-luxe-dusty text-white border-luxe-dusty' : 'bg-white border-gray-200 text-gray-700 hover:border-luxe-dusty'}`}
                             >
                               {timeStr}
                             </button>
                           );
                         })}
                       </div>
                     ) : (
                       <div className="p-3 bg-red-50 text-red-500 text-sm rounded-xl">No slots available for this date.</div>
                     )
                    }
                  </div>
                )}

                <textarea value={specialRequests} onChange={e => setSpecialRequests(e.target.value)} placeholder="Specs / Allergies / Special Requests" className="w-full bg-gray-50 border p-3 rounded-xl text-sm mt-4" rows={2}></textarea>

                <button onClick={handleConfirmBooking} disabled={isBooking || !bookingTime} className="w-full bg-luxe-dark text-white py-4 rounded-xl font-bold mt-4 disabled:opacity-50">
                  {isBooking ? 'Confirming...' : 'Confirm Booking'}
                </button>
              </div>
            )}

            {bookingStep === 3 && (
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle2 className="w-10 h-10 text-green-600" /></div>
                <h3 className="text-2xl font-serif font-bold mb-2">Booking Confirmed!</h3>
                <p className="text-gray-500 text-sm">Your appointment has been successfully scheduled. We look forward to seeing you!</p>
                <button onClick={closeBooking} className="w-full bg-luxe-dark text-white py-4 rounded-xl font-bold mt-8">Done</button>
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 flex justify-around z-30">
        <button onClick={() => setActiveTab('book')} className={`flex flex-col items-center ${activeTab === 'book' ? 'text-luxe-dusty' : 'text-gray-400'}`}><Calendar className="w-6 h-6" /><span className="text-[10px]">Book</span></button>
        <button onClick={() => setActiveTab('products')} className={`flex flex-col items-center ${activeTab === 'products' ? 'text-luxe-dusty' : 'text-gray-400'}`}><Package className="w-6 h-6" /><span className="text-[10px]">Shop</span></button>
        <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center ${activeTab === 'history' ? 'text-luxe-dusty' : 'text-gray-400'}`}><User className="w-6 h-6" /><span className="text-[10px]">History</span></button>
        <button onClick={() => setActiveTab('broadcasts')} className={`flex flex-col items-center relative ${activeTab === 'broadcasts' ? 'text-luxe-dusty' : 'text-gray-400'}`}>
          <MessageSquare className="w-6 h-6" />
          {broadcasts.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-black rounded-full w-5 h-5 flex items-center justify-center">{broadcasts.length}</span>}
          <span className="text-[10px]">Messages</span>
        </button>
        <button onClick={() => setActiveTab('ai_chat')} className={`flex flex-col items-center ${activeTab === 'ai_chat' ? 'text-luxe-dusty' : 'text-gray-400'}`}><Sparkles className="w-6 h-6" /><span className="text-[10px]">AI Chat</span></button>
      </nav>
    </div>
  );
}
