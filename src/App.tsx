import { ReactNode, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { Sparkles, Star, ArrowRight, Clock, Heart, MapPin, Phone, Mail, Instagram, Facebook, Twitter, Users, Bell, X } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TenantProvider, useTenant } from './contexts/TenantContext';
import { authFetch } from './api';

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons in Leaflet with Vite
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
   iconUrl: markerIcon,
   shadowUrl: markerShadow,
   iconSize: [25, 41],
   iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

import ClientApp from './pages/ClientApp';
import WorkerPortal from './pages/WorkerPortal';
import AdminDashboard from './pages/AdminDashboard';
import AuthPage from './pages/Auth';
import QuickBooking from './pages/QuickBooking';

function MapComponent() {
   const { tenant } = useTenant();
   const [branches, setBranches] = useState<any[]>([]);

   const fetchBranches = async () => {
      try {
         const res = await authFetch('/api/branches');
         const data = await res.json();
         if (Array.isArray(data)) setBranches(data);
      } catch (err) {
         console.error('Failed to fetch branch locations', err);
      }
   };

   useEffect(() => {
      fetchBranches();
   }, []);

   const mainPosition: [number, number] | null = tenant?.latitude && tenant?.longitude ? [parseFloat(String(tenant.latitude)), parseFloat(String(tenant.longitude))] : null;
   const branchMarkers = branches
      .filter((b) => b.latitude && b.longitude)
      .map((b) => ({
         id: `branch-${b.id}`,
         position: [parseFloat(String(b.latitude)), parseFloat(String(b.longitude))] as [number, number],
         title: b.name,
         description: b.address,
      }));

   const markers = [
      ...(mainPosition ? [{ id: 'main', position: mainPosition, title: tenant?.name || 'Main Salon', description: tenant?.address }]: []),
      ...branchMarkers
   ];

   function FitBounds({ bounds }: { bounds: [number, number][] }) {
      const map = useMap();
      useEffect(() => {
         if (bounds.length === 0) return;
         map.fitBounds(bounds, { padding: [40, 40] });
      }, [bounds, map]);
      return null;
   }

   const defaultPosition: [number, number] = mainPosition ?? [-1.286389, 36.817223];
   const centerPosition = markers.length > 0 ? markers[0].position : defaultPosition;
   const bounds = markers.map((marker) => marker.position);

   return (
      <div className="h-[400px] w-full rounded-[2rem] overflow-hidden shadow-xl border border-gray-100">
         <MapContainer center={centerPosition} zoom={13} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
            <TileLayer
               attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
               url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {bounds.length > 0 && <FitBounds bounds={bounds} />}
            {markers.map((marker) => (
               <Marker key={marker.id} position={marker.position}>
                  <Popup>
                     <div className="text-center">
                        <p className="font-serif font-bold">{marker.title}</p>
                        <p className="text-xs">{marker.description || 'Location'}</p>
                     </div>
                  </Popup>
               </Marker>
            ))}
         </MapContainer>
      </div>
   );
}

function LandingPage() {
   const { user, logout } = useAuth();
   const navigate = useNavigate();
   const [services, setServices] = useState<any[]>([]);
   const [products, setProducts] = useState<any[]>([]);

   // Subscription State
   const [showSubscribeModal, setShowSubscribeModal] = useState(false);
   const [subscribeEmail, setSubscribeEmail] = useState('');
   const [subscribePhone, setSubscribePhone] = useState('');
   const [isSubscribing, setIsSubscribing] = useState(false);
   const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'success' | 'error'>('idle');

   const handleSubscribe = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubscribing(true);
      setSubscribeStatus('idle');
      try {
         const res = await authFetch('/api/subscribe', {
            method: 'POST',
            body: JSON.stringify({ email: subscribeEmail, phone: subscribePhone })
         });
         if (!res.ok) throw new Error();
         setSubscribeStatus('success');
         setTimeout(() => {
            setShowSubscribeModal(false);
            setSubscribeStatus('idle');
            setSubscribeEmail('');
            setSubscribePhone('');
         }, 2000);
      } catch (err) {
         setSubscribeStatus('error');
      } finally {
         setIsSubscribing(false);
      }
   };

   useEffect(() => {
      authFetch('/api/services')
         .then(res => res.json())
         .then(data => {
            if (Array.isArray(data)) setServices(data);
         })
         .catch(err => console.error("Failed to fetch services", err));

      authFetch('/api/products')
         .then(res => res.json())
         .then(data => {
            if (Array.isArray(data)) setProducts(data);
         })
         .catch(err => console.error("Failed to fetch products", err));
   }, []);

   return (
      <div className="min-h-screen bg-luxe-bg text-luxe-text font-sans selection:bg-luxe-dusty selection:text-white">

         {/* Navbar */}
         <nav className="flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
            <div className="flex items-center gap-2">
               <div className="bg-luxe-dusty text-white p-2 rounded-full">
                  <Sparkles className="w-5 h-5" />
               </div>
               <span className="font-serif text-2xl font-bold tracking-tight">SamQtex Spa</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
               <a href="#services" className="hover:text-luxe-dusty transition-colors">Services</a>
               <a href="#products" className="hover:text-luxe-dusty transition-colors">Products</a>
               <a href="#about" className="hover:text-luxe-dusty transition-colors">About</a>
               <a href="#contact" className="hover:text-luxe-dusty transition-colors">Contact</a>
            </div>
            <div className="flex items-center gap-4">
               {user ? (
                  <>
                     <button onClick={() => navigate(`/${user.role === 'client' ? 'client' : user.role === 'worker' ? 'worker' : 'admin'}`)} className="text-sm font-medium hover:text-luxe-dusty">Dashboard</button>
                     <button onClick={logout} className="text-sm font-medium hover:text-luxe-dusty">Sign Out</button>
                  </>
               ) : null}
               <button onClick={() => navigate('/client')} className="bg-luxe-dusty hover:bg-luxe-dusty-hover text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors">
                  Book Now
               </button>
            </div>
         </nav>

         {/* Hero */}
         <section className="max-w-7xl mx-auto px-8 py-12 flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6">
               <div className="inline-flex items-center gap-2 bg-luxe-sand/30 px-4 py-2 rounded-full text-sm font-medium text-luxe-dark">
                  <Star className="w-4 h-4 text-luxe-gold fill-luxe-gold" />
                  Award-Winning Salon Experience
               </div>
               <h1 className="text-6xl md:text-7xl font-serif font-bold leading-tight text-luxe-text">
                  Where <span className="text-luxe-dusty italic">Beauty</span><br />
                  Meets <span className="text-luxe-gold">Elegance</span>
               </h1>
               <p className="text-lg text-gray-600 max-w-md leading-relaxed">
                  Discover the art of self-care at our luxury salon. Expert beauticians, premium products, and an ambiance designed to make you feel extraordinary.
               </p>
               <div className="flex items-center gap-4 pt-4">
                  <button onClick={() => navigate('/client')} className="bg-luxe-dusty hover:bg-luxe-dusty-hover text-white px-8 py-3.5 rounded-full font-medium transition-colors flex items-center gap-2">
                     Book Appointment <ArrowRight className="w-4 h-4" />
                  </button>
                  <button className="border border-gray-300 hover:border-luxe-dusty hover:text-luxe-dusty px-8 py-3.5 rounded-full font-medium transition-colors">
                     Explore Services
                  </button>
               </div>
               <div className="flex items-center gap-12 pt-8 border-t border-gray-200 mt-8">
                  <div>
                     <p className="text-3xl font-serif font-bold">15<span className="text-luxe-dusty">+</span></p>
                     <p className="text-sm text-gray-500">Years Experience</p>
                  </div>
                  <div>
                     <p className="text-3xl font-serif font-bold">10<span className="text-luxe-dusty">+</span></p>
                     <p className="text-sm text-gray-500">Expert Stylists</p>
                  </div>
                  <div>
                     <p className="text-3xl font-serif font-bold">10k<span className="text-luxe-dusty">+</span></p>
                     <p className="text-sm text-gray-500">Happy Clients</p>
                  </div>
               </div>
            </div>
            <div className="flex-1 relative">
               <img src="https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80" alt="Salon Interior" className="rounded-[2rem] shadow-2xl object-cover h-[600px] w-full" referrerPolicy="no-referrer" />
               {/* Floating Badges */}
               <div className="absolute top-8 right-8 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
                  <div className="flex -space-x-2">
                     <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white"></div>
                     <div className="w-8 h-8 rounded-full bg-gray-300 border-2 border-white"></div>
                     <div className="w-8 h-8 rounded-full bg-gray-400 border-2 border-white"></div>
                  </div>
                  <span className="text-sm font-bold">+50 Stylists</span>
               </div>
               <div className="absolute bottom-8 left-8 bg-white/90 backdrop-blur-sm p-4 rounded-2xl shadow-lg flex items-center gap-4">
                  <div className="bg-luxe-dusty text-white p-3 rounded-full">
                     <Star className="w-6 h-6 fill-white" />
                  </div>
                  <div>
                     <p className="font-bold text-lg">4.9 Rating</p>
                     <p className="text-sm text-gray-500">2,500+ Reviews</p>
                  </div>
               </div>
            </div>
         </section>

         {/* Services */}
         <section id="services" className="max-w-7xl mx-auto px-8 py-24 text-center">
            <p className="text-luxe-dusty font-medium tracking-widest text-sm uppercase mb-4">Our Services</p>
            <h2 className="text-4xl md:text-5xl font-serif font-bold mb-6">
               Tailored <span className="text-luxe-dusty italic">Beauty</span> Experiences
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto mb-16">
               Discover our comprehensive range of premium beauty services, each designed to enhance your natural radiance.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
               {services.length > 0 ? (
                  services.slice(0, 6).map((s, i) => (
                     <div key={i} className="bg-white rounded-[2rem] p-4 shadow-sm border border-gray-100 hover:shadow-xl transition-shadow flex flex-col">
                        <div className="relative h-48 rounded-2xl overflow-hidden mb-6">
                           <img src={s.image_url || s.img || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=500&q=80'} alt={s.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                           <div className="absolute top-4 right-4 bg-luxe-gold/90 backdrop-blur-sm text-white text-xs font-bold px-3 py-1 rounded-full">Popular</div>
                        </div>
                        <div className="px-2 flex-1 flex flex-col">
                           <div className="flex items-center gap-3 mb-4">
                              <div className="w-10 h-10 rounded-xl bg-luxe-dusty/10 flex items-center justify-center text-xl">{s.icon || '✨'}</div>
                              <div>
                                 <h3 className="font-serif font-bold text-xl">{s.name}</h3>
                                 <p className="text-luxe-gold text-sm font-medium">From ${s.price}</p>
                              </div>
                           </div>
                           <p className="text-gray-600 text-sm mb-6 flex-1">{s.description || s.desc}</p>
                           <button onClick={() => navigate('/client')} className="w-full py-3 rounded-full border border-luxe-dusty text-luxe-dusty font-medium hover:bg-luxe-dusty hover:text-white transition-colors">
                              Book Now
                           </button>
                        </div>
                     </div>
                  ))
               ) : (
                  <div className="md:col-span-3 bg-white rounded-[2rem] p-16 shadow-sm border border-gray-100 text-center text-gray-500">
                     <p className="text-lg font-semibold">Not Posted currently</p>
                     <p className="mt-3 text-sm text-gray-400">Our service list is being updated. Please check back soon.</p>
                  </div>
               )}
            </div>
            <div className="mt-12">
               <button onClick={() => navigate('/client')} className="bg-luxe-gold text-white px-8 py-3.5 rounded-full font-medium hover:bg-yellow-600 transition-colors shadow-lg shadow-luxe-gold/20">
                  View All Services
               </button>
            </div>
         </section>

         {/* Products */}
         <section id="products" className="bg-white py-24">
            <div className="max-w-7xl mx-auto px-8">
               <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
                  <div>
                     <p className="text-luxe-dusty font-medium tracking-widest text-sm uppercase mb-4">Shop Products</p>
                     <h2 className="text-4xl md:text-5xl font-serif font-bold mb-4">
                        Premium <span className="text-luxe-gold">Beauty</span> Products
                     </h2>
                     <p className="text-gray-600 max-w-xl">
                        Take the salon experience home with our curated collection of professional-grade beauty products.
                     </p>
                  </div>
                  <button onClick={() => navigate('/client')} className="border border-luxe-dusty text-luxe-dusty px-6 py-3 rounded-full font-medium hover:bg-luxe-dusty hover:text-white transition-colors whitespace-nowrap">
                     View All Products
                  </button>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {products.length > 0 ? (
                     products.slice(0, 8).map((p, i) => (
                        <div key={i} className="group cursor-pointer" onClick={() => navigate('/client')}>
                           <div className="relative h-64 rounded-2xl overflow-hidden mb-4 bg-gray-100">
                              <img src={p.image_url || 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=400&q=80'} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
                              <div className="absolute top-3 left-3 bg-luxe-dusty/90 backdrop-blur-sm text-white text-xs font-bold px-3 py-1 rounded-full">Bestseller</div>
                           </div>
                           <p className="text-xs text-gray-500 font-medium tracking-wider mb-1 uppercase">{p.category || p.cat}</p>
                           <h3 className="font-serif font-bold text-lg mb-2">{p.name}</h3>
                           <div className="flex items-center justify-between">
                              <p className="font-bold text-luxe-text">${p.selling_price || p.price}</p>
                              <div className="flex items-center gap-1 text-sm font-medium text-gray-600">
                                 <Star className="w-4 h-4 text-luxe-gold fill-luxe-gold" /> {p.rating || '4.9'}
                              </div>
                           </div>
                        </div>
                     ))
                  ) : (
                     <div className="sm:col-span-2 lg:col-span-4 bg-white rounded-[2rem] p-16 shadow-sm border border-gray-100 text-center text-gray-500">
                        <p className="text-lg font-semibold">Not Posted currently</p>
                        <p className="mt-3 text-sm text-gray-400">Our product collection is being refreshed. Please check back soon.</p>
                     </div>
                  )}
               </div>
            </div>
         </section>

         {/* Promo */}
         <section className="max-w-7xl mx-auto px-8 py-12">
            <div className="bg-gradient-to-r from-luxe-dusty to-[#9A4C58] rounded-[2rem] p-12 md:p-20 text-center text-white shadow-2xl">
               <h2 className="text-4xl md:text-5xl font-serif font-bold mb-6">New Member Exclusive</h2>
               <p className="text-lg text-white/90 max-w-2xl mx-auto mb-10">
                  Get 20% off your first purchase when you join our beauty club. Plus, enjoy exclusive member perks and broadcast updates!
               </p>
               <button onClick={() => setShowSubscribeModal(true)} className="bg-white text-luxe-dusty px-8 py-4 rounded-full font-bold hover:bg-gray-50 transition-colors shadow-lg">
                  Join Now & Save
               </button>
            </div>
         </section>

         {/* Subscription Modal */}
         {showSubscribeModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-[2rem] p-8 max-w-md w-full relative shadow-2xl animate-in fade-in zoom-in duration-300">
                  <button onClick={() => setShowSubscribeModal(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-600">
                     <X className="w-6 h-6" />
                  </button>
                  <div className="text-center mb-8">
                     <div className="w-16 h-16 bg-luxe-dusty/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Bell className="w-8 h-8 text-luxe-dusty animate-bounce" />
                     </div>
                     <h3 className="text-2xl font-serif font-bold">Join the Beauty Club</h3>
                     <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                        Stay updated with our latest offers, beauty tips, and broadcast messages from our stylists.
                     </p>
                  </div>

                  {subscribeStatus === 'success' ? (
                     <div className="text-center py-8 space-y-4 animate-in slide-in-from-bottom duration-500">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                           <Sparkles className="w-8 h-8 text-green-600" />
                        </div>
                        <h4 className="text-xl font-bold text-green-600">You're Subscribed!</h4>
                        <p className="text-gray-500">Welcome to the family. Watch your inbox for a special 20% discount code.</p>
                     </div>
                  ) : (
                     <form onSubmit={handleSubscribe} className="space-y-4">
                        <div className="space-y-1.5">
                           <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">Email Address</label>
                           <input
                              type="email"
                              required
                              placeholder="e.g., beautiful@example.com"
                              value={subscribeEmail}
                              onChange={(e) => setSubscribeEmail(e.target.value)}
                              className="w-full bg-gray-50 border-gray-100 rounded-2xl px-6 py-4 text-sm focus:ring-2 focus:ring-luxe-dusty focus:bg-white transition-all outline-none"
                           />
                        </div>
                        <div className="space-y-1.5">
                           <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">Phone (Optional)</label>
                           <input
                              type="tel"
                              placeholder="e.g., +254 700 000 000"
                              value={subscribePhone}
                              onChange={(e) => setSubscribePhone(e.target.value)}
                              className="w-full bg-gray-50 border-gray-100 rounded-2xl px-6 py-4 text-sm focus:ring-2 focus:ring-luxe-dusty focus:bg-white transition-all outline-none"
                           />
                        </div>
                        {subscribeStatus === 'error' && (
                           <p className="text-red-500 text-xs text-center font-medium">Already subscribed or invalid details.</p>
                        )}
                        <button
                           disabled={isSubscribing}
                           type="submit"
                           className="w-full bg-luxe-dusty hover:bg-luxe-dusty-hover text-white py-4 rounded-2xl font-bold shadow-lg shadow-luxe-dusty/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                           {isSubscribing ? 'Joining...' : 'Subscribe Now'} <ArrowRight className="w-4 h-4" />
                        </button>
                        <p className="text-[10px] text-center text-gray-400 mt-4 leading-relaxed">
                           By subscribing, you agree to receive marketing messages. <br />
                           Unsubscribe at any time. Your privacy is our priority.
                        </p>
                     </form>
                  )}
               </div>
            </div>
         )}

         {/* About */}
         <section id="about" className="max-w-7xl mx-auto px-8 py-24 flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1 relative">
               <div className="grid grid-cols-2 gap-4">
                  <img src="https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=400&q=80" alt="Hair" className="rounded-3xl w-full h-64 object-cover mt-12" referrerPolicy="no-referrer" />
                  <img src="https://images.unsplash.com/photo-1516975080661-46b0a1691211?auto=format&fit=crop&w=400&q=80" alt="Makeup" className="rounded-3xl w-full h-48 object-cover" referrerPolicy="no-referrer" />
                  <img src="https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=400&q=80" alt="Salon" className="rounded-3xl w-full h-48 object-cover col-span-2" referrerPolicy="no-referrer" />
               </div>
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-xl text-center">
                  <p className="text-4xl font-serif font-bold text-luxe-dusty">15<span className="text-luxe-gold">+</span></p>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mt-1">Years of Excellence</p>
               </div>
            </div>
            <div className="flex-1 space-y-8">
               <div>
                  <p className="text-luxe-dusty font-medium tracking-widest text-sm uppercase mb-4">About Us</p>
                  <h2 className="text-4xl md:text-5xl font-serif font-bold mb-6">
                     Your Journey to <span className="text-luxe-dusty italic">Radiance</span> Begins Here
                  </h2>
                  <p className="text-gray-600 leading-relaxed mb-6">
                     Founded in 2013, SamQtex Spa has been the go-to destination for those seeking exceptional beauty services. Our commitment to excellence, combined with our passion for helping clients feel their best, has made us a beloved fixture in the community.
                  </p>
                  <p className="text-gray-600 leading-relaxed">
                     We believe that beauty is not just about appearance—it's about confidence, self-expression, and well-being. That's why every service we offer is designed to nurture both your outer beauty and inner peace.
                  </p>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
                  <div className="flex gap-4">
                     <div className="w-12 h-12 rounded-full bg-luxe-dusty/10 flex items-center justify-center shrink-0">
                        <Star className="w-5 h-5 text-luxe-dusty" />
                     </div>
                     <div>
                        <h4 className="font-bold mb-1">Best in Town</h4>
                        <p className="text-sm text-gray-500">Recognized for excellence in beauty services across the region.</p>
                     </div>
                  </div>
                  <div className="flex gap-4">
                     <div className="w-12 h-12 rounded-full bg-luxe-dusty/10 flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 text-luxe-dusty" />
                     </div>
                     <div>
                        <h4 className="font-bold mb-1">Flexible Hours</h4>
                        <p className="text-sm text-gray-500">Open 7 days a week with convenient early and late appointments.</p>
                     </div>
                  </div>
                  <div className="flex gap-4">
                     <div className="w-12 h-12 rounded-full bg-luxe-dusty/10 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5 text-luxe-dusty" />
                     </div>
                     <div>
                        <h4 className="font-bold mb-1">Expert Team</h4>
                        <p className="text-sm text-gray-500">10+ professionals with years of industry experience.</p>
                     </div>
                  </div>
                  <div className="flex gap-4">
                     <div className="w-12 h-12 rounded-full bg-luxe-dusty/10 flex items-center justify-center shrink-0">
                        <Heart className="w-5 h-5 text-luxe-dusty" />
                     </div>
                     <div>
                        <h4 className="font-bold mb-1">Personalized Care</h4>
                        <p className="text-sm text-gray-500">Every treatment is tailored to your unique needs and preferences.</p>
                     </div>
                  </div>
               </div>

               <button className="bg-luxe-dusty text-white px-8 py-3.5 rounded-full font-medium hover:bg-luxe-dusty-hover transition-colors">
                  Learn More About Us
               </button>
            </div>
         </section>

         {/* Map Section */}
         <section className="max-w-7xl mx-auto px-8 py-24">
            <div className="flex flex-col lg:flex-row gap-12 items-center">
               <div className="flex-1 space-y-6">
                  <h2 className="text-4xl md:text-5xl font-serif font-bold">Visit Our <span className="text-luxe-dusty italic">Sanctuary</span></h2>
                  <p className="text-gray-600 leading-relaxed max-w-md">
                     Located in the heart of the Wangige, our spa is designed to be your escape from the everyday.
                     Find us and experience the tranquility you deserve.
                  </p>
                  <div className="space-y-4">
                     <div className="flex items-center gap-4 text-gray-700">
                        <div className="w-10 h-10 rounded-full bg-luxe-dusty/10 flex items-center justify-center shrink-0">
                           <MapPin className="w-5 h-5 text-luxe-dusty" />
                        </div>
                        <p className="font-medium">Opposite Wangige Shopping Mall, Wangige, Kiambu, Kenya</p>
                     </div>
                  </div>
               </div>
               <div className="flex-1 w-full min-h-[400px]">
                  <MapComponent />
               </div>
            </div>
         </section>

         {/* Footer */}
         <footer id="contact" className="bg-luxe-dark text-white pt-20 pb-10">
            <div className="max-w-7xl mx-auto px-8">
               <div className="text-center max-w-2xl mx-auto mb-20">
                  <h2 className="text-4xl font-serif font-bold mb-4">Stay <span className="italic">Beautiful</span></h2>
                  <p className="text-gray-400 mb-8">Subscribe to our newsletter for exclusive offers, beauty tips, and the latest updates.</p>
                  <div className="flex gap-2 max-w-md mx-auto">
                     <input type="email" placeholder="Enter your email" className="flex-1 bg-white/10 border border-white/20 rounded-full px-6 py-3 text-white placeholder:text-gray-400 focus:outline-none focus:border-luxe-dusty" />
                     <button className="bg-luxe-dusty hover:bg-luxe-dusty-hover text-white px-8 py-3 rounded-full font-medium transition-colors">
                        Subscribe
                     </button>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16 border-t border-white/10 pt-16">
                  <div className="space-y-6">
                     <div className="flex items-center gap-2">
                        <div className="bg-luxe-dusty text-white p-2 rounded-full">
                           <Sparkles className="w-5 h-5" />
                        </div>
                        <span className="font-serif text-2xl font-bold tracking-tight">LuxeBeauty</span>
                     </div>
                     <p className="text-gray-400 text-sm leading-relaxed">
                        Your destination for premium beauty services and products. Where elegance meets excellence.
                     </p>
                     <div className="flex gap-4">
                        <button className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-luxe-dusty transition-colors"><Instagram className="w-5 h-5" /></button>
                        <button className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-luxe-dusty transition-colors"><Facebook className="w-5 h-5" /></button>
                        <button className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-luxe-dusty transition-colors"><Twitter className="w-5 h-5" /></button>
                     </div>
                  </div>

                  <div>
                     <h4 className="font-serif font-bold text-lg mb-6">Quick Links</h4>
                     <ul className="space-y-4 text-sm text-gray-400">
                        <li><a href="#services" className="hover:text-white transition-colors">Services</a></li>
                        <li><a href="#products" className="hover:text-white transition-colors">Products</a></li>
                        <li><a href="#about" className="hover:text-white transition-colors">About Us</a></li>
                        <li><a href="#" className="hover:text-white transition-colors">Book Now</a></li>
                     </ul>
                  </div>

                  <div>
                     <h4 className="font-serif font-bold text-lg mb-6">Our Services</h4>
                     <ul className="space-y-4 text-sm text-gray-400">
                        <li><a href="#" className="hover:text-white transition-colors">Nail Artistry</a></li>
                        <li><a href="#" className="hover:text-white transition-colors">Facial Treatments</a></li>
                        <li><a href="#" className="hover:text-white transition-colors">Hair Styling</a></li>
                        <li><a href="#" className="hover:text-white transition-colors">Lash & Brows</a></li>
                        <li><a href="#" className="hover:text-white transition-colors">Spa & Wellness</a></li>
                        <li><a href="#" className="hover:text-white transition-colors">Bridal Packages</a></li>
                     </ul>
                  </div>

                  <div>
                     <h4 className="font-serif font-bold text-lg mb-6">Contact Us</h4>
                     <ul className="space-y-4 text-sm text-gray-400">
                        <li className="flex items-start gap-3">
                           <MapPin className="w-5 h-5 text-luxe-dusty shrink-0" />
                           <span>123 Beauty Lane, Suite 100<br />New York, NY 10001</span>
                        </li>
                        <li className="flex items-center gap-3">
                           <Phone className="w-5 h-5 text-luxe-dusty shrink-0" />
                           <span>(123) 456-7890</span>
                        </li>
                        <li className="flex items-center gap-3">
                           <Mail className="w-5 h-5 text-luxe-dusty shrink-0" />
                           <span>hello@luxebeauty.com</span>
                        </li>
                     </ul>
                  </div>
               </div>

               <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-500">
                  <p>© 2024 Luxe Beauty Salon. All rights reserved.</p>
                  <div className="flex gap-6">
                     <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
                     <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
                  </div>
               </div>
            </div>
         </footer>
      </div>
   );
}

function ProtectedRoute({ children, allowedRoles }: { children: ReactNode, allowedRoles: string[] }) {
   const { user } = useAuth();

   if (!user) {
      return <Navigate to="/auth" replace />;
   }

   if (!allowedRoles.includes(user.role)) {
      return <Navigate to="/auth" replace />;
   }

   return <>{children}</>;
}

export default function App() {
   return (
      <AuthProvider>
         <TenantProvider>
            <BrowserRouter>
               <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/staff" element={<Navigate to="/auth" replace />} />
                  <Route path="/client" element={<QuickBooking />} />
                  <Route path="/client/*" element={<ClientApp />} />
                  <Route
                     path="/admin/*"
                     element={
                        <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
                           <AdminDashboard />
                        </ProtectedRoute>
                     }
                  />
                  <Route
                     path="/worker/*"
                     element={
                        <ProtectedRoute allowedRoles={['worker', 'admin', 'superadmin']}>
                           <WorkerPortal />
                        </ProtectedRoute>
                     }
                  />
               </Routes>
            </BrowserRouter>
         </TenantProvider>
      </AuthProvider>
   );
}
