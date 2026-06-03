import { Link } from 'react-router-dom';
import { 
  ArrowLeft, TrendingUp, AlertTriangle, Package, Activity, Users, Settings, 
  Video, PieChart, BarChart3, Plus, Calendar, Clock, DollarSign, Download, 
  Trash2, Save, CheckCircle2, XCircle, UserPlus, Filter, Truck, MessageSquare, Bell,
  Heart, MoreVertical, FileText, Search, Shield, Globe, CreditCard, Zap, Award, Sparkles, ShoppingBag, MapPin
} from 'lucide-react';
import { authFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useEffect, useState, useRef, useCallback } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons (Vite asset bundling)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Gold pin icon for existing branches
const goldIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
// Red pin icon for preview/new pin
const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// Internal component — listens for map clicks to set pin position
function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onMapClick(e.latlng.lat, e.latlng.lng); }
  });
  return null;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  
  // Data State
  const [products, setProducts] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [chatLogs, setChatLogs] = useState<any[]>([]);
  const [cctvFeeds, setCctvFeeds] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [revenueStats, setRevenueStats] = useState<any>({ daily: [], weekly: [], monthly: [] });
  const [serviceStats, setServiceStats] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [branches, setBranches] = useState<any[]>([]);
  
  // UI State
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showAddCctv, setShowAddCctv] = useState(false);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Branch state
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [editingBranch, setEditingBranch] = useState<any>(null);
  const [newBranch, setNewBranch] = useState({ name: '', address: '', phone: '', latitude: null as number | null, longitude: null as number | null, is_active: true });
  const [branchPinPreview, setBranchPinPreview] = useState<{lat: number, lng: number} | null>(null);
  const [isSavingBranch, setIsSavingBranch] = useState(false);
  const [branchError, setBranchError] = useState('');

  // Salon location pin preview
  const [salonPinPreview, setSalonPinPreview] = useState<{lat: number, lng: number} | null>(null);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await authFetch('/api/admin/upload', {
        method: 'POST',
        body: formData,
        headers: {} // Let browser set Content-Type with boundary
      });
      const data = await res.json();
      return data.url;
    } catch (e) {
      console.error("Upload failed", e);
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Form states
  const [newStaff, setNewStaff] = useState({ name: '', email: '', username: '', phone: '', password: '', role: 'worker', commission_rate: 40 });
  const [newProduct, setNewProduct] = useState({ name: '', category: '', cost_price: 0, selling_price: 0, stock: 0, min_threshold: 5, unit: 'pcs', consumption_per_service: 1.0, description: '', image_url: '' });
  const [newService, setNewService] = useState({ name: '', category: '', description: '', price: 0, duration_minutes: 30, buffer_time_minutes: 15, requires_room: false, image_url: '' });
  const [newCctv, setNewCctv] = useState({ name: '', feed_url: '' });
  const [newSchedule, setNewSchedule] = useState({ worker_id: '', day_of_week: 'Monday', start_time: '08:00', end_time: '17:00', is_off: false });
  const [marketingMsg, setMarketingMsg] = useState('');
  const [salonSettings, setSalonSettings] = useState({ salon_name: '', logo_url: '', primary_color: '#D4AF37', secondary_color: '#9A4C58', data_retention_days: 60, latitude: null as number | null, longitude: null as number | null, address: '', phone: '' });

  const fetchData = async () => {
    try {
      const [prods, lg, stf, rev, svcStatsData, clnts, chats, cctv, sch, svcs, ords] = await Promise.all([
        authFetch('/api/admin/products').then(r => r.json()),
        authFetch('/api/admin/logs').then(r => r.json()),
        authFetch('/api/admin/staff').then(r => r.json()),
        authFetch('/api/admin/stats/revenue').then(r => r.json()),
        authFetch('/api/admin/stats/services').then(r => r.json()),
        authFetch('/api/admin/clients').then(r => r.json()),
        authFetch('/api/admin/chat-logs').then(r => r.json()),
        authFetch('/api/admin/cctv').then(r => r.json()),
        authFetch('/api/admin/schedules').then(r => r.json()),
        authFetch('/api/admin/services').then(r => r.json()),
        authFetch('/api/admin/orders').then(r => r.json())
      ]);

      if (Array.isArray(prods)) setProducts(prods);
      if (Array.isArray(lg)) setLogs(lg);
      else if (lg.error) console.error("Logs error:", lg.error);
      
      if (Array.isArray(stf)) setStaff(stf);
      if (rev && !rev.error) setRevenueStats(rev);
      if (Array.isArray(svcStatsData)) setServiceStats(svcStatsData);
      if (Array.isArray(clnts)) setClients(clnts);
      if (Array.isArray(chats)) setChatLogs(chats);
      if (Array.isArray(cctv)) setCctvFeeds(cctv);
      if (Array.isArray(sch)) setSchedules(sch);
      if (Array.isArray(svcs)) setServices(svcs);
      if (Array.isArray(ords)) setAllOrders(ords);

      // Fetch branches
      try {
        const branchRes = await authFetch('/api/admin/branches');
        const branchData = await branchRes.json();
        if (Array.isArray(branchData)) setBranches(branchData);
      } catch (e) { console.error('Branches fetch failed', e); }

    } catch (e) { console.error("Data fetch failed", e); }
  };

  useEffect(() => {
    fetchData();
    authFetch('/api/settings').then(res => res.json()).then(data => {
      if (data) setSalonSettings({ 
        salon_name: data.salon_name, 
        logo_url: data.logo_url, 
        primary_color: data.primary_color, 
        secondary_color: data.secondary_color,
        data_retention_days: data.data_retention_days,
        latitude: data.latitude,
        longitude: data.longitude,
        address: data.address,
        phone: data.phone
      });
    });
  }, []);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const payload = { 
        ...salonSettings, 
        latitude: salonPinPreview?.lat || salonSettings.latitude, 
        longitude: salonPinPreview?.lng || salonSettings.longitude 
      };
      const res = await authFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert("Settings updated!");
        setSalonPinPreview(null); // Clear preview after save
        // Update local state with new values
        setSalonSettings(prev => ({
          ...prev,
          latitude: payload.latitude,
          longitude: payload.longitude
        }));
      }
    } finally { setIsSaving(false); }
  };

  const generateWelcomeKit = (member: any) => {
    const doc = new jsPDF() as any;
    doc.setFontSize(22);
    doc.text("SAMQTEX SPA - STAFF WELCOME KIT", 20, 30);
    doc.setFontSize(12);
    doc.text(`Welcome, ${member.name}!`, 20, 50);
    doc.text("Your account has been provisioned. Please use the following details to login:", 20, 60);
    
    doc.setDrawColor(212, 175, 55);
    doc.rect(20, 70, 170, 40);
    
    doc.setFont("helvetica", "bold");
    doc.text(`Portal URL: ${window.location.origin}/auth`, 30, 80);
    doc.text(`Username: ${member.username}`, 30, 90);
    doc.text(`Initial Password: ${member.password || '[Hidden for Security]'}`, 30, 100);
    
    doc.setFont("helvetica", "normal");
    doc.text("Security Notice:", 20, 130);
    doc.text("1. This password is temporary. You will be prompted to change it on your first login.", 20, 140);
    doc.text("2. Never share your credentials with other staff members.", 20, 150);
    
    doc.text("Wishing you a successful journey at SamQtex Spa!", 20, 180);
    doc.save(`WelcomeKit_${member.username}.pdf`);
  };

  const [staffError, setStaffError] = useState('');
  const handleAddStaff = async (e: any) => {
    e.preventDefault();
    setStaffError('');
    const res = await authFetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newStaff)
    });
    const data = await res.json();
    if (res.ok) {
      setShowAddStaff(false);
      setNewStaff({ name: '', email: '', username: '', phone: '', password: '', role: 'worker', commission_rate: 40 });
      fetchData();
    } else {
      setStaffError(data.error || "Failed to onboard member");
    }
  };

  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [productError, setProductError] = useState('');
  const handleUpdateProduct = async (e: any) => {
    e.preventDefault();
    setProductError('');
    const res = await authFetch(`/api/admin/products/${editingProduct.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingProduct)
    });
    const data = await res.json();
    if (res.ok) {
      setEditingProduct(null);
      fetchData();
    } else {
      setProductError(data.error || "Update failed");
    }
  };

  const handleAddProduct = async (e: any) => {
    e.preventDefault();
    setProductError('');
    const res = await authFetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProduct)
    });
    const data = await res.json();
    if (res.ok) {
      setShowAddProduct(false);
      setNewProduct({ name: '', category: '', cost_price: 0, selling_price: 0, stock: 0, min_threshold: 5, unit: 'pcs', consumption_per_service: 1.0, description: '', image_url: '' });
      fetchData();
    } else {
      setProductError(data.error || "Failed to sync to catalog");
    }
  };

  const [editingService, setEditingService] = useState<any>(null);
  const [serviceError, setServiceError] = useState('');
  const handleAddService = async (e: any) => {
    e.preventDefault();
    setServiceError('');
    const res = await authFetch('/api/admin/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newService)
    });
    const data = await res.json();
    if (res.ok) {
      setShowAddService(false);
      setNewService({ name: '', category: '', description: '', price: 0, duration_minutes: 30, buffer_time_minutes: 15, requires_room: false });
      fetchData();
    } else {
      setServiceError(data.error || "Failed to create service");
    }
  };

  const handleUpdateService = async (e: any) => {
    e.preventDefault();
    setServiceError('');
    const res = await authFetch(`/api/admin/services/${editingService.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingService)
    });
    const data = await res.json();
    if (res.ok) {
      setEditingService(null);
      fetchData();
    } else {
      setServiceError(data.error || "Update failed");
    }
  };

  const handleDeleteService = async (id: number) => {
    if (!confirm("Are you sure you want to delete this service?")) return;
    const res = await authFetch(`/api/admin/services/${id}`, { method: 'DELETE' });
    if (res.ok) fetchData();
  };

  const handleDeleteStaff = async (id: number) => {
    if (!confirm("Are you sure you want to delete this staff member? This action cannot be undone.")) return;
    const res = await authFetch(`/api/admin/staff/${id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete staff member");
    }
  };

  const handleDeleteProduct = async (id: number) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    const res = await authFetch(`/api/admin/products/${id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete product");
    }
  };

  const handlePayout = async (logId: number) => {
    if (!confirm("Mark this commission as paid?")) return;
    const res = await authFetch(`/api/admin/staff/payout/${logId}`, { method: 'POST' });
    if (res.ok) fetchData();
  };

  const handleBroadcast = async () => {
    if (!marketingMsg.trim()) return;
    const res = await authFetch('/api/admin/marketing-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: marketingMsg })
    });
    if (res.ok) {
      alert("Marketing blast sent!");
      setMarketingMsg('');
    }
  };

  const handleAddBranch = async () => {
    setBranchError('');
    if (!newBranch.name) { setBranchError('Branch name is required'); return; }
    setIsSavingBranch(true);
    try {
      const payload = { ...newBranch, latitude: branchPinPreview?.lat || newBranch.latitude, longitude: branchPinPreview?.lng || newBranch.longitude };
      const res = await authFetch('/api/admin/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) { const d = await res.json(); setBranchError(d.error || 'Failed to save'); return; }
      setShowAddBranch(false);
      setNewBranch({ name: '', address: '', phone: '', latitude: null, longitude: null, is_active: true });
      setBranchPinPreview(null);
      fetchData();
    } finally { setIsSavingBranch(false); }
  };

  const handleUpdateBranch = async () => {
    if (!editingBranch) return;
    setBranchError('');
    setIsSavingBranch(true);
    try {
      const payload = {
        ...editingBranch,
        latitude: branchPinPreview?.lat ?? editingBranch.latitude,
        longitude: branchPinPreview?.lng ?? editingBranch.longitude,
      };
      const res = await authFetch(`/api/admin/branches/${editingBranch.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) { const d = await res.json(); setBranchError(d.error || 'Update failed'); return; }
      setEditingBranch(null);
      setBranchPinPreview(null);
      fetchData();
    } finally { setIsSavingBranch(false); }
  };

  const handleDeleteBranch = async (id: number) => {
    if (!confirm('Delete this branch? This cannot be undone.')) return;
    const res = await authFetch(`/api/admin/branches/${id}`, { method: 'DELETE' });
    if (res.ok) fetchData();
  };

  const exportToPDF = (data: any[], title: string) => {
    const doc = new jsPDF() as any;
    doc.text(title, 14, 15);
    const headers = Object.keys(data[0] || {});
    const rows = data.map(item => Object.values(item));
    doc.autoTable({ head: [headers], body: rows, startY: 20 });
    doc.save(`${title.toLowerCase().replace(/ /g, '_')}.pdf`);
  };

  const exportToExcel = (data: any[], fileName: string) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  if (!user || user.role !== 'admin') return <div className="p-20 text-center font-bold">Access Denied. Admins Only.</div>;

  const totalDailyRev = revenueStats.daily?.reduce((acc: number, r: any) => acc + (parseFloat(r.total) || 0), 0) || 0;
  const lowStockCount = products.filter(p => p.stock <= p.min_threshold).length;

  return (
    <div className="min-h-screen bg-white text-black flex flex-col md:flex-row font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-black text-white flex flex-col h-screen sticky top-0 z-50">
        <div className="p-8 border-b border-white/10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-[#D4AF37] rounded-lg shadow-[0_0_15px_rgba(212,175,55,0.4)]"></div>
            <h1 className="text-xl font-serif font-bold tracking-tighter">SAMQTEX</h1>
          </div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Admin Command Center</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {[
            { id: 'overview', icon: Activity, label: 'BI Dashboard' },
            { id: 'services', icon: Sparkles, label: 'Services Catalog' },
            { id: 'inventory', icon: Package, label: 'Shop & Stock' },
            { id: 'orders', icon: ShoppingBag, label: 'Retail Orders' },
            { id: 'workforce', icon: Users, label: 'Workforce Hub' },
            { id: 'crm', icon: Heart, label: 'Clients & CRM' },
            { id: 'security', icon: Video, label: 'CCTV Monitoring' },
            { id: 'branches', icon: MapPin, label: 'Branch Locations' },
            { id: 'settings', icon: Settings, label: 'SaaS Config' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${
                activeTab === tab.id ? 'bg-[#D4AF37] text-black font-bold shadow-[0_0_20px_rgba(212,175,55,0.3)]' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <tab.icon size={20} strokeWidth={activeTab === tab.id ? 2.5 : 2} />
              <span className="text-sm">{tab.label}</span>
            </button>
          ))}
        </nav>


        <div className="p-6 border-t border-white/10">
          <Link to="/" className="w-full py-3 bg-white/5 rounded-xl text-xs flex items-center justify-center gap-2 text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Exit to Site
          </Link>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 bg-[#F8F8F8] h-screen overflow-y-auto p-8 lg:p-12 relative">
        
        {/* Header Bar */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-12">
          <div>
            <h2 className="text-3xl font-serif font-bold text-black capitalize">{activeTab.replace('_', ' ')}</h2>
            <p className="text-gray-500 text-sm mt-1">Real-time data synchronization active.</p>
          </div>
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-600 rounded-full border border-amber-100 animate-pulse">
              <Zap size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">System Live</span>
            </div>
            <button className="p-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all text-gray-400 relative">
              <Bell size={20}/>
              {lowStockCount > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>}
            </button>
            <div className="flex items-center gap-3 bg-white p-2 pr-6 rounded-2xl shadow-sm border border-gray-100">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center text-[#D4AF37] font-bold shadow-lg">A</div>
              <div>
                <p className="text-xs font-bold leading-none">{user.name}</p>
                <p className="text-[10px] text-gray-400 mt-1 uppercase font-black tracking-tighter">Super Admin</p>
              </div>
            </div>
          </div>
        </header>

        {/* ALERTS SECTION */}
        {lowStockCount > 0 && (
          <div className="mb-8 p-6 bg-red-50 border border-red-100 rounded-[2rem] flex items-center justify-between animate-in slide-in-from-top-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center text-red-600">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="font-bold text-red-900">Critical Stock Warning</p>
                <p className="text-xs text-red-700">{lowStockCount} items are below the threshold. Restock immediately.</p>
              </div>
            </div>
            <button onClick={() => setActiveTab('inventory')} className="px-6 py-3 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-200">Manage Inventory</button>
          </div>
        )}

        {/* BI DASHBOARD */}
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {[
                { label: 'Today Rev.', value: `$${totalDailyRev.toLocaleString()}`, trend: '+12.5%', color: 'text-black', icon: DollarSign },
                { label: 'Weekly Gross', value: `$${revenueStats.weekly?.reduce((acc:any, r:any)=>acc+parseFloat(r.total),0).toLocaleString()}`, trend: 'M-Pesa 60%', color: 'text-green-600', icon: TrendingUp },
                { label: 'Client Base', value: clients.length, trend: 'Growing', color: 'text-[#D4AF37]', icon: Users },
                { label: 'Stock Value', value: `$${products.reduce((acc,p)=>acc+(p.cost_price*p.stock),0).toLocaleString()}`, trend: 'BP Total', color: 'text-blue-600', icon: Package },
              ].map((kpi, i) => (
                <div key={i} className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 hover:border-[#D4AF37] transition-all group relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                    <kpi.icon size={64} />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">{kpi.label}</p>
                  <p className={`text-4xl font-serif font-bold ${kpi.color}`}>{kpi.value}</p>
                  <div className="flex items-center gap-2 mt-4">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">{kpi.trend}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Leaderboard */}
              <div className="lg:col-span-1 bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                <h3 className="text-xl font-serif font-bold mb-6 flex items-center gap-3"><Award className="text-[#D4AF37]"/> Top Beauticians</h3>
                <div className="space-y-6">
                  {staff.filter(s=>s.role==='worker').sort((a,b)=>b.efficiency_score - a.efficiency_score).slice(0, 5).map((s, i) => (
                    <div key={i} className="flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-serif font-bold text-gray-400 group-hover:bg-[#D4AF37] group-hover:text-white transition-all">
                          {i+1}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{s.name}</p>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-tighter">{s.sessions || 0} Sessions</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-sm">{s.efficiency_score || '0.0'}</p>
                        <div className="w-16 h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-[#D4AF37]" style={{width: `${(s.efficiency_score || 0) * 10}%`}}></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Service Analytics */}
              <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-serif font-bold flex items-center gap-3"><PieChart className="text-blue-500"/> Service Popularity</h3>
                  <div className="flex gap-2">
                    <button className="text-[10px] font-black px-3 py-1 bg-black text-white rounded-full">REAL-TIME</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {serviceStats.slice(0, 8).map(s => (
                    <div key={s.name} className="aspect-square bg-gray-50 rounded-[2rem] flex flex-col items-center justify-center p-4 text-center border border-transparent hover:border-[#D4AF37] transition-all cursor-pointer group">
                      <div className="w-12 h-12 bg-white rounded-2xl shadow-sm mb-4 flex items-center justify-center text-[#D4AF37] group-hover:scale-110 transition-transform">
                        <Activity size={24}/>
                      </div>
                      <p className="font-bold text-xs">{s.name}</p>
                      <p className="text-[10px] font-black text-gray-400 mt-1 uppercase tracking-tighter">{s.bookings} Bookings</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Activity Log */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-serif font-bold flex items-center gap-3"><Activity className="text-purple-500"/> System-wide Activities</h3>
                <button onClick={fetchData} className="p-2 bg-gray-50 rounded-xl hover:text-[#D4AF37] transition-colors"><Zap size={16}/></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {logs.slice(0, 6).map((l, i) => (
                  <div key={i} className="p-5 bg-gray-50 rounded-[2rem] border border-gray-100 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-3">
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                          l.action === 'Inventory' ? 'bg-blue-100 text-blue-600' : 
                          l.action === 'User Management' ? 'bg-purple-100 text-purple-600' :
                          l.action === 'Attendance' ? 'bg-orange-100 text-orange-600' : 'bg-gray-200 text-gray-600'
                        }`}>{l.action}</span>
                        <span className="text-[8px] font-medium text-gray-400">{new Date(l.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs font-bold text-black leading-relaxed">{l.details}</p>
                    </div>
                    <p className="text-[9px] text-gray-400 mt-4 font-black uppercase tracking-tighter">Executor: {l.worker_name || 'System'}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SERVICES TAB */}
        {activeTab === 'services' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-2xl font-serif font-bold">Services Catalog</h3>
                <p className="text-gray-500 text-sm">Define and price your organization's offerings.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => exportToExcel(services, 'Services_Report')} className="p-3 bg-white text-black rounded-2xl shadow-sm hover:bg-gray-50 border border-gray-100"><Download size={20}/></button>
                <button onClick={() => setShowAddService(true)} className="px-6 py-4 bg-black text-[#D4AF37] rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 shadow-2xl shadow-black/20">
                  <Plus size={18}/> New Service
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map(s => (
                <div key={s.id} className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 hover:border-[#D4AF37] transition-all group relative overflow-hidden">
                  <div className="flex justify-between items-start mb-4">
                    <span className="px-3 py-1 bg-luxe-dusty/10 text-luxe-dusty rounded-full text-[10px] font-black uppercase tracking-widest">{s.category}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingService(s)} className="p-2 text-gray-400 hover:text-black transition-colors"><Settings size={16}/></button>
                      <button onClick={() => handleDeleteService(s.id)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                    </div>
                  </div>
                  <h4 className="text-lg font-serif font-bold text-black mb-2">{s.name}</h4>
                  <p className="text-xs text-gray-500 line-clamp-2 mb-4 h-8">{s.description || 'No description provided.'}</p>
                  <div className="flex items-center justify-between border-t border-gray-50 pt-4">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Price</p>
                      <p className="text-xl font-bold text-green-600">${s.price}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Duration</p>
                      <p className="text-sm font-bold">{s.duration_minutes} min</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RETAIL ORDERS TAB */}
        {activeTab === 'orders' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-2xl font-serif font-bold">Product Sales Management</h3>
                <p className="text-gray-500 text-sm">Reviewing e-commerce and POS transactions</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => exportToExcel(allOrders, 'Sales_Report')} className="p-4 bg-white text-black rounded-2xl shadow-sm hover:bg-gray-50 border border-gray-100 flex items-center gap-2 font-bold text-xs"><Download size={18}/> Export CSV</button>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Order ID</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Date</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Client / Source</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Amount</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Payment</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Type</th>
                      <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {allOrders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50/50 transition-colors group">
                        <td className="px-8 py-6 font-mono font-bold text-xs">#{order.id}</td>
                        <td className="px-8 py-6 text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString()}</td>
                        <td className="px-8 py-6">
                          <p className="text-xs font-bold">{order.client_name || 'Anonymous'}</p>
                          <p className="text-[10px] text-gray-400 font-bold">{order.client_phone || 'No Phone'}</p>
                        </td>
                        <td className="px-8 py-6 text-sm font-black text-luxe-gold">${order.total_amount}</td>
                        <td className="px-8 py-6">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${order.payment_status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                            {order.payment_method} • {order.payment_status}
                          </span>
                        </td>
                        <td className="px-8 py-6">
                           <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{order.type}</span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${order.status === 'completed' ? 'bg-green-500' : 'bg-amber-500'}`}></div>
                            <span className="text-xs font-bold uppercase tracking-tighter">{order.status}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {allOrders.length === 0 && (
                  <div className="p-20 text-center text-gray-300 opacity-50">
                     <ShoppingBag size={48} className="mx-auto mb-4" />
                     <p className="text-xs font-black uppercase tracking-widest">No Sales Records Found</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

         {/* INVENTORY TAB */}
         {activeTab === 'inventory' && (
           <div className="space-y-8 animate-in fade-in duration-500">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
               <div>
                 <h3 className="text-2xl font-serif font-bold">Advanced Shop Logic</h3>
                 <p className="text-gray-500 text-sm">Managing $BP$ (Bulk Price) vs $SP$ (Selling Price)</p>
               </div>
               <div className="flex gap-3">
                 <button onClick={() => exportToExcel(products, 'Inventory_Report')} className="p-3 bg-white text-black rounded-2xl shadow-sm hover:bg-gray-50 border border-gray-100"><Download size={20}/></button>
                 <button onClick={() => setShowAddProduct(true)} className="px-6 py-4 bg-black text-[#D4AF37] rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 shadow-2xl shadow-black/20">
                   <Plus size={18}/> New SKU
                 </button>
               </div>
             </div>

             <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
               <table className="w-full text-left">
                <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                  <tr>
                    <th className="px-8 py-6">Product & Identity</th>
                    <th className="px-8 py-6">Bulk Price ($BP)</th>
                    <th className="px-8 py-6">Selling Price ($SP)</th>
                    <th className="px-8 py-6">Stock / Consumption</th>
                    <th className="px-8 py-6">Profit Margin</th>
                    <th className="px-8 py-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {products.map(p => {
                    const margin = Number(p.selling_price || 0) - Number(p.cost_price || 0);
                    const marginPct = (Number(p.selling_price) > 0 ? (margin / Number(p.selling_price)) * 100 : 0).toFixed(1);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-all group">
                        <td className="px-8 py-6">
                          <p className="font-bold text-sm text-black">{p.name}</p>
                          <p className="text-[10px] text-gray-400 mt-1 uppercase font-black tracking-tighter">{p.category || 'Jewelry'}</p>
                        </td>
                        <td className="px-8 py-6 font-mono text-sm font-bold text-red-500">${p.cost_price}</td>
                        <td className="px-8 py-6 font-mono text-sm font-bold text-green-600">${p.selling_price}</td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold">{p.stock} <span className="text-[10px] font-black uppercase text-gray-400">{p.unit}</span></span>
                            {p.manual_depleted && <span className="p-1 bg-red-100 text-red-600 rounded-md"><AlertTriangle size={12}/></span>}
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm">${margin}</span>
                            <span className="text-[10px] px-2 py-0.5 bg-green-50 text-green-600 rounded-lg font-black">+{marginPct}%</span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            {p.stock <= p.min_threshold ? 
                              <span className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-[10px] font-black uppercase tracking-widest">Urgent</span> :
                              <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-black uppercase tracking-widest">Healthy</span>
                            }
                            <button onClick={() => setEditingProduct({...p, reason: ''})} className="p-2 text-gray-400 hover:text-[#D4AF37] transition-colors"><Settings size={18}/></button>
                            <button onClick={() => handleDeleteProduct(p.id)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* WORKFORCE TAB */}
        {activeTab === 'workforce' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h3 className="text-2xl font-serif font-bold">Workforce & Payouts</h3>
              <div className="flex gap-2">
                <button onClick={() => setShowAddSchedule(true)} className="px-6 py-4 bg-white border border-gray-100 rounded-2xl font-black text-[10px] uppercase tracking-widest">Roster Setup</button>
                <button onClick={() => setShowAddStaff(true)} className="px-6 py-4 bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest">Add Member</button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              {/* Staff Directory */}
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                <h4 className="text-lg font-serif font-bold mb-6 flex items-center gap-3"><UserPlus className="text-[#D4AF37]"/> Team Management</h4>
                <div className="space-y-4">
                  {staff.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-6 bg-gray-50 rounded-[2rem] border border-transparent hover:border-[#D4AF37]/20 transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center font-serif font-bold text-xl shadow-sm group-hover:bg-black group-hover:text-[#D4AF37] transition-all">
                          {s.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{s.name}</p>
                          <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest">{s.role}</p>
                          <p className="text-[9px] text-gray-400 font-medium mt-1">{s.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => generateWelcomeKit(s)} className="p-3 bg-white text-gray-400 hover:text-[#D4AF37] rounded-xl transition-all shadow-sm" title="Download Welcome Kit">
                           <FileText size={18} />
                        </button>
                        <button onClick={() => handleDeleteStaff(s.id)} className="p-3 bg-white text-gray-400 hover:text-red-500 rounded-xl transition-all shadow-sm" title="Terminate Member">
                           <Trash2 size={18} />
                        </button>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 mb-1 justify-end">
                          <span className="text-sm font-bold text-black">{s.commission_rate}%</span>
                        </div>
                        <p className="text-[9px] text-gray-400 font-black uppercase">Commission</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attendance & Payouts */}
              <div className="space-y-8">
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                  <h4 className="text-lg font-serif font-bold mb-6 flex items-center gap-3"><Clock className="text-blue-500"/> Shift Compliance</h4>
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {logs.filter(l=>l.action==='Attendance').slice(0, 10).map((l, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <div>
                          <p className="text-[10px] font-black uppercase text-gray-400">{new Date(l.timestamp).toLocaleDateString()}</p>
                          <p className="text-sm font-bold">{l.worker_name}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${l.details.includes('In') ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{l.details}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                  <h4 className="text-lg font-serif font-bold mb-6 flex items-center gap-3"><DollarSign className="text-green-600"/> Payout Approvals</h4>
                  <div className="space-y-4">
                    {logs.filter(l => l.commission_earned > 0 && !l.is_paid).slice(0, 5).map((l, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                        <div>
                          <p className="text-sm font-bold">{l.worker_name}</p>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-tighter">{l.action}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <p className="font-mono text-sm font-bold text-green-600">${l.commission_earned}</p>
                          <button onClick={() => handlePayout(l.id)} className="p-3 bg-white text-green-600 rounded-xl hover:bg-green-600 hover:text-white shadow-sm transition-all"><CheckCircle2 size={18}/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CRM TAB */}
        {activeTab === 'crm' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Client Database */}
              <div className="flex-1 bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-serif font-bold">Client Directory</h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input type="text" placeholder="Search clients..." className="pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl text-xs font-bold w-64" />
                  </div>
                </div>
                <div className="space-y-4">
                  {clients.map(c => (
                    <div key={c.id} className="flex items-center justify-between p-6 bg-gray-50 rounded-[2rem] group transition-all hover:bg-white hover:shadow-xl hover:shadow-black/5">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-[#D4AF37] font-serif font-bold text-xl">
                          {c.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{c.name}</p>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{c.phone}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-tighter">Member Since</p>
                        <p className="text-xs font-bold">{new Date(c.created_at).getFullYear()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Marketing & Broadcast */}
              <div className="w-full lg:w-96 space-y-8">
                <div className="bg-[#2D2424] p-8 rounded-[2.5rem] shadow-2xl text-white">
                  <h4 className="text-lg font-serif font-bold text-[#D4AF37] mb-4 flex items-center gap-3"><Bell size={20}/> Marketing Blast</h4>
                  <p className="text-xs text-gray-400 mb-6 leading-relaxed">Send a broadcast message to all registered clients for promotions or updates.</p>
                  <textarea 
                    value={marketingMsg}
                    onChange={(e)=>setMarketingMsg(e.target.value)}
                    placeholder="e.g. '20% Off all Facials this Friday! Book now...'"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-xs font-medium focus:ring-2 focus:ring-[#D4AF37] outline-none min-h-[120px] mb-6"
                  />
                  <button onClick={handleBroadcast} className="w-full py-4 bg-[#D4AF37] text-black rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-transform">Broadcast Message</button>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                  <h4 className="text-lg font-serif font-bold mb-6 flex items-center gap-3"><MessageSquare size={20} className="text-blue-500"/> Chat Auditor</h4>
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {chatLogs.map((chat, i) => (
                      <div key={i} className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-[9px] font-black uppercase text-gray-400">{chat.sender_name} → {chat.receiver_name}</p>
                          <p className="text-[9px] text-gray-400 font-medium">{new Date(chat.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
                        </div>
                        <p className="text-[10px] font-medium leading-relaxed italic">"{chat.message}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECURITY TAB */}
        {activeTab === 'security' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <div className="bg-black aspect-video rounded-[3.5rem] shadow-2xl relative overflow-hidden group border-4 border-white/10">
                  <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&q=80')] opacity-40 mix-blend-overlay"></div>
                  <div className="absolute top-8 left-8 flex items-center gap-3 bg-black/60 px-4 py-2 rounded-full backdrop-blur-md border border-white/10">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>
                    <span className="text-[10px] font-black tracking-widest text-white uppercase">LIVE FEED: MAIN SPA HQ</span>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center group-hover:scale-110 transition-transform duration-700">
                      <Shield className="w-24 h-24 text-white/10 mx-auto mb-4" />
                      <p className="text-white/20 text-xs font-black uppercase tracking-widest">NVR Secure Channel Active</p>
                    </div>
                  </div>
                  <div className="absolute bottom-8 right-8 flex gap-2">
                    <button className="p-3 bg-white/10 text-white rounded-xl backdrop-blur-sm"><Globe size={18}/></button>
                    <button className="p-3 bg-[#D4AF37] text-black rounded-xl shadow-lg shadow-yellow-500/20"><FileText size={18}/></button>
                  </div>
                </div>
              </div>
              <div className="bg-white p-8 rounded-[3.5rem] shadow-sm border border-gray-100 flex flex-col h-full">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-serif font-bold">Surveillance Hub</h3>
                  <button onClick={() => setShowAddCctv(true)} className="p-2 bg-gray-50 rounded-lg hover:bg-black hover:text-[#D4AF37] transition-all"><Plus size={16}/></button>
                </div>
                <div className="space-y-4 flex-1">
                  {cctvFeeds.length === 0 ? (
                    <div className="text-center py-10 opacity-20">
                      <Video size={48} className="mx-auto mb-2" />
                      <p className="text-xs font-black uppercase tracking-widest">No feeds active</p>
                    </div>
                  ) : (
                    cctvFeeds.map(cam => (
                      <div key={cam.id} className="p-5 bg-gray-50 rounded-2xl flex items-center justify-between border border-transparent hover:border-black/5 hover:bg-white hover:shadow-xl hover:shadow-black/5 transition-all cursor-pointer group">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-gray-300 group-hover:text-black transition-colors">
                            <Video size={18} />
                          </div>
                          <span className="text-sm font-bold">{cam.name}</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${cam.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                      </div>
                    ))
                  )}
                </div>
                <div className="pt-8 border-t border-gray-50">
                  <button className="w-full py-5 bg-black text-white rounded-[2rem] font-black text-[10px] uppercase tracking-widest shadow-xl transition-transform hover:scale-[1.02]">Full Grid Console</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BRANCHES TAB */}
        {activeTab === 'branches' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-2xl font-serif font-bold">Branch Locations</h3>
                <p className="text-gray-500 text-sm">Manage physical locations that clients can find on the map.</p>
              </div>
              <button
                id="add-branch-btn"
                onClick={() => { setShowAddBranch(true); setBranchPinPreview(null); setBranchError(''); }}
                className="px-6 py-4 bg-black text-[#D4AF37] rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 shadow-2xl shadow-black/20"
              >
                <Plus size={18}/> Add Branch
              </button>
            </div>

            {branches.length === 0 ? (
              <div className="bg-white rounded-[2.5rem] p-20 text-center border border-gray-100 shadow-sm">
                <MapPin size={48} className="mx-auto mb-4 text-gray-200" />
                <p className="text-sm font-black uppercase tracking-widest text-gray-300">No branches yet. Add your first location.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Branch Cards */}
                <div className="space-y-4">
                  {branches.map(b => (
                    <div key={b.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:border-[#D4AF37]/30 transition-all group">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${ b.is_active ? 'bg-[#D4AF37]/10' : 'bg-gray-100'}`}>
                            <MapPin size={20} className={b.is_active ? 'text-[#D4AF37]' : 'text-gray-300'} />
                          </div>
                          <div>
                            <p className="font-bold text-sm">{b.name}</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{b.is_active ? 'Active' : 'Inactive'}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingBranch({...b}); setBranchPinPreview(b.latitude ? { lat: parseFloat(b.latitude), lng: parseFloat(b.longitude) } : null); setBranchError(''); }}
                            className="p-2 text-gray-400 hover:text-[#D4AF37] transition-colors" title="Edit Branch"
                          >
                            <Settings size={16}/>
                          </button>
                          <button
                            onClick={() => handleDeleteBranch(b.id)}
                            className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Delete Branch"
                          >
                            <Trash2 size={16}/>
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-gray-50 space-y-1">
                        {b.address && <p className="text-xs text-gray-500 flex items-start gap-2"><MapPin size={12} className="mt-0.5 shrink-0 text-gray-300"/>{b.address}</p>}
                        {b.phone && <p className="text-xs text-gray-500">{b.phone}</p>}
                        {b.latitude && b.longitude && (
                          <p className="text-[10px] font-mono text-gray-400 bg-gray-50 px-2 py-1 rounded-lg inline-block mt-1">
                            📍 {parseFloat(b.latitude).toFixed(6)}, {parseFloat(b.longitude).toFixed(6)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Overview Map */}
                <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-50">
                    <h4 className="font-serif font-bold text-lg">Branches Overview</h4>
                    <p className="text-xs text-gray-400 mt-1">All branch pins on one view</p>
                  </div>
                  <div className="h-80">
                    <MapContainer
                      center={branches.find(b => b.latitude) ? [parseFloat(branches.find(b => b.latitude).latitude), parseFloat(branches.find(b => b.latitude).longitude)] : [-1.286389, 36.817223]}
                      zoom={13}
                      style={{ height: '100%', width: '100%' }}
                    >
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
                      {branches.filter(b => b.latitude && b.longitude).map(b => (
                        <Marker key={b.id} position={[parseFloat(b.latitude), parseFloat(b.longitude)]} icon={goldIcon}>
                          <Popup><b>{b.name}</b><br/>{b.address}</Popup>
                        </Marker>
                      ))}
                    </MapContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20">
            <section className="grid grid-cols-1 md:grid-cols-3 gap-12">
              <div className="md:col-span-1">
                <h4 className="text-lg font-serif font-bold flex items-center gap-3"><Globe className="text-[#D4AF37]"/> Salon Identity</h4>
                <p className="text-gray-400 text-xs mt-3 leading-relaxed">Customize your brand appearance and system identity.</p>
              </div>
              <div className="md:col-span-2 space-y-6">
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-6">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-3">Salon Name / Branch</label>
                    <input type="text" value={salonSettings.salon_name} onChange={e => setSalonSettings({...salonSettings, salon_name: e.target.value})} className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-3">Primary (Gold)</label>
                      <input type="color" value={salonSettings.primary_color} onChange={e => setSalonSettings({...salonSettings, primary_color: e.target.value})} className="w-full h-14 p-1 bg-gray-50 rounded-2xl border-none cursor-pointer" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-3">Secondary (Luxe)</label>
                      <input type="color" value={salonSettings.secondary_color} onChange={e => setSalonSettings({...salonSettings, secondary_color: e.target.value})} className="w-full h-14 p-1 bg-gray-50 rounded-2xl border-none cursor-pointer" />
                    </div>
                  </div>
                  <button 
                    onClick={handleSaveSettings} 
                    disabled={isSaving}
                    className="px-10 py-5 bg-black text-[#D4AF37] rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-2xl shadow-black/20"
                  >
                    {isSaving ? 'Syncing...' : 'Update Identity'}
                  </button>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-12">
              <div className="md:col-span-1">
                <h4 className="text-lg font-serif font-bold text-red-600 flex items-center gap-3"><Trash2 size={20}/> Compliance</h4>
                <p className="text-gray-400 text-xs mt-3 leading-relaxed">Manage your 60-day auto-purge policies and data lifecycle.</p>
              </div>
              <div className="md:col-span-2">
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-red-50 space-y-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-sm">60-Day Data Purge</p>
                      <p className="text-[10px] text-gray-400 mt-1 uppercase font-black tracking-widest">Status: Active & Enforced</p>
                    </div>
                    <div className="w-14 h-7 bg-red-600 rounded-full flex items-center px-1.5 shadow-inner">
                      <div className="w-4 h-4 bg-white rounded-full translate-x-7"></div>
                    </div>
                  </div>
                  <div className="pt-8 border-t border-gray-50 flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2"><CreditCard size={14}/> SaaS Subscription</p>
                      <p className="text-[10px] text-gray-400 mt-1 font-medium">Next billing cycle: May 12, 2026</p>
                    </div>
                    <span className="px-6 py-3 bg-green-50 text-green-600 text-[10px] font-black rounded-full shadow-sm">ACTIVE STATUS</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-12">
              <div className="md:col-span-1">
                <h4 className="text-lg font-serif font-bold flex items-center gap-3"><MapPin className="text-[#D4AF37]"/> Location & Contact</h4>
                <p className="text-gray-400 text-xs mt-3 leading-relaxed">Set your main business location and contact information.</p>
              </div>
              <div className="md:col-span-2 space-y-6">
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-3">Address</label>
                      <input type="text" value={salonSettings.address} onChange={e => setSalonSettings({...salonSettings, address: e.target.value})} className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" placeholder="Enter business address" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-3">Phone</label>
                      <input type="text" value={salonSettings.phone} onChange={e => setSalonSettings({...salonSettings, phone: e.target.value})} className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" placeholder="Enter phone number" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-3">Location Pin</label>
                    <div className="h-64 rounded-2xl overflow-hidden border border-gray-100">
                      <MapContainer 
                        center={salonSettings.latitude && salonSettings.longitude ? [salonSettings.latitude, salonSettings.longitude] : [40.7128, -74.0060]} 
                        zoom={13} 
                        style={{ height: '100%', width: '100%' }}
                        className="rounded-2xl"
                      >
                        <TileLayer
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        />
                        <MapClickHandler onMapClick={(lat, lng) => setSalonPinPreview({lat, lng})} />
                        {(salonPinPreview || (salonSettings.latitude && salonSettings.longitude)) && (
                          <Marker 
                            position={salonPinPreview ? [salonPinPreview.lat, salonPinPreview.lng] : [salonSettings.latitude!, salonSettings.longitude!]} 
                            icon={redIcon}
                          >
                            <Popup>Main Business Location</Popup>
                          </Marker>
                        )}
                      </MapContainer>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Click on the map to set your business location pin</p>
                  </div>
                  <button 
                    onClick={handleSaveSettings} 
                    disabled={isSaving}
                    className="px-10 py-5 bg-black text-[#D4AF37] rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-2xl shadow-black/20"
                  >
                    {isSaving ? 'Syncing...' : 'Update Location'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

      </main>

      {/* Modals */}
      {editingService && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-xl animate-in zoom-in-95 duration-300 relative shadow-2xl">
            <button onClick={() => setEditingService(null)} className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-8">Update Service</h3>
            {serviceError && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{serviceError}</div>}
            <form onSubmit={handleUpdateService} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Service Name</label>
                  <input type="text" value={editingService.name} required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingService({...editingService, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Category</label>
                  <input type="text" value={editingService.category} required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingService({...editingService, category: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Image</label>
                  <div className="flex gap-2">
                    <input type="text" value={editingService.image_url || ''} className="flex-1 bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingService({...editingService, image_url: e.target.value})} />
                    <label className="p-4 bg-gray-100 rounded-2xl cursor-pointer hover:bg-gray-200">
                      <Download size={20}/>
                      <input type="file" className="hidden" accept="image/*" onChange={async e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = await handleUpload(file);
                          if (url) setEditingService({...editingService, image_url: url});
                        }
                      }} />
                    </label>
                  </div>
                  {isUploading && <p className="text-[8px] text-[#D4AF37] animate-pulse">Uploading...</p>}
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Price ($)</label>
                  <input type="number" step="0.01" value={editingService.price} required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingService({...editingService, price: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Description</label>
                <textarea value={editingService.description} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-medium" onChange={e => setEditingService({...editingService, description: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Duration (min)</label>
                  <input type="number" value={editingService.duration_minutes} required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingService({...editingService, duration_minutes: parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Buffer (min)</label>
                  <input type="number" value={editingService.buffer_time_minutes} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingService({...editingService, buffer_time_minutes: parseInt(e.target.value)})} />
                </div>
              </div>
              <button type="submit" className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-black/20 transition-transform hover:scale-[1.02]">Sync Service</button>
            </form>
          </div>
        </div>
      )}

      {showAddService && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-xl animate-in zoom-in-95 duration-300 relative shadow-2xl">
            <button onClick={() => setShowAddService(false)} className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-8">Launch New Service</h3>
            {serviceError && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{serviceError}</div>}
            <form onSubmit={handleAddService} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Service Name</label>
                  <input type="text" placeholder="e.g. Diamond Facial" required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setNewService({...newService, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Category</label>
                  <input type="text" placeholder="e.g. Skin Care" required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setNewService({...newService, category: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Image</label>
                  <div className="flex gap-2">
                    <input type="text" placeholder="https://..." value={newService.image_url} className="flex-1 bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setNewService({...newService, image_url: e.target.value})} />
                    <label className="p-4 bg-gray-100 rounded-2xl cursor-pointer hover:bg-gray-200">
                      <Download size={20}/>
                      <input type="file" className="hidden" accept="image/*" onChange={async e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = await handleUpload(file);
                          if (url) setNewService({...newService, image_url: url});
                        }
                      }} />
                    </label>
                  </div>
                  {isUploading && <p className="text-[8px] text-[#D4AF37] animate-pulse">Uploading...</p>}
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Price ($)</label>
                  <input type="number" step="0.01" required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setNewService({...newService, price: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Description</label>
                <textarea placeholder="Service description..." className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-medium" onChange={e => setNewService({...newService, description: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Duration (min)</label>
                  <input type="number" defaultValue={30} required className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setNewService({...newService, duration_minutes: parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Buffer (min)</label>
                  <input type="number" defaultValue={15} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setNewService({...newService, buffer_time_minutes: parseInt(e.target.value)})} />
                </div>
              </div>
              <button type="submit" className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-black/20 mt-4 transition-transform hover:scale-[1.02]">Publish Service</button>
            </form>
          </div>
        </div>
      )}

      {editingProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-xl animate-in zoom-in-95 duration-300 relative shadow-2xl">
            <button onClick={() => setEditingProduct(null)} className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-8">Adjust Inventory</h3>
            {productError && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{productError}</div>}
            <form onSubmit={handleUpdateProduct} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Product Name</label>
                  <input type="text" value={editingProduct.name} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Stock Level</label>
                  <input type="number" value={editingProduct.stock} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setEditingProduct({...editingProduct, stock: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Selling Price ($SP)</label>
                  <input type="number" value={editingProduct.selling_price} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingProduct({...editingProduct, selling_price: parseFloat(e.target.value)})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Consumption Rate</label>
                  <input type="number" step="0.01" value={editingProduct.consumption_per_service} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setEditingProduct({...editingProduct, consumption_per_service: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Image</label>
                <div className="flex gap-2">
                  <input type="text" value={editingProduct.image_url || ''} className="flex-1 bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold" onChange={e => setEditingProduct({...editingProduct, image_url: e.target.value})} />
                  <label className="p-4 bg-gray-100 rounded-2xl cursor-pointer hover:bg-gray-200">
                    <Download size={20}/>
                    <input type="file" className="hidden" accept="image/*" onChange={async e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = await handleUpload(file);
                        if (url) setEditingProduct({...editingProduct, image_url: url});
                      }
                    }} />
                  </label>
                </div>
                {isUploading && <p className="text-[8px] text-[#D4AF37] animate-pulse">Uploading...</p>}
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Reason for Adjustment (Audit Log)</label>
                <textarea 
                  required
                  placeholder="e.g. Manual restock, Damaged goods, Error correction..."
                  className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-red-200 min-h-[100px]"
                  onChange={e => setEditingProduct({...editingProduct, reason: e.target.value})}
                />
              </div>
              <button type="submit" className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-black/20 transition-transform hover:scale-[1.02]">Sync Adjustments</button>
            </form>
          </div>
        </div>
      )}

      {showAddProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-xl animate-in zoom-in-95 duration-300 relative shadow-2xl">
            <button onClick={() => setShowAddProduct(false)} className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-8">Register New SKU</h3>
            {productError && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{productError}</div>}
            <form onSubmit={handleAddProduct} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Product Info</label>
                <input type="text" placeholder="Product Name (e.g. Gel Polish #402)" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
                <input type="text" placeholder="Category (e.g. Nails, Facial)" className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewProduct({...newProduct, category: e.target.value})} />
                <div className="flex gap-2">
                  <input type="text" placeholder="Image URL" value={newProduct.image_url} className="flex-1 bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewProduct({...newProduct, image_url: e.target.value})} />
                  <label className="p-5 bg-gray-100 rounded-2xl cursor-pointer hover:bg-gray-200">
                    <Download size={20}/>
                    <input type="file" className="hidden" accept="image/*" onChange={async e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = await handleUpload(file);
                        if (url) setNewProduct({...newProduct, image_url: url});
                      }
                    }} />
                  </label>
                </div>
                {isUploading && <p className="text-[8px] text-[#D4AF37] animate-pulse">Uploading...</p>}
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Bulk Price ($BP)</label>
                  <input type="number" step="0.01" placeholder="0.00" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-red-400" onChange={e => setNewProduct({...newProduct, cost_price: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Selling Price ($SP)</label>
                  <input type="number" step="0.01" placeholder="0.00" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-green-400" onChange={e => setNewProduct({...newProduct, selling_price: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Consumption Rate (e.g. 0.5ml)</label>
                  <input type="number" step="0.01" placeholder="1.0" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewProduct({...newProduct, consumption_per_service: parseFloat(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Unit (ml, pcs, box)</label>
                  <input type="text" placeholder="Unit" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewProduct({...newProduct, unit: e.target.value})} />
                </div>
              </div>
              <button type="submit" className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-black/20 mt-4 transition-transform hover:scale-[1.02]">Sync to Catalog</button>
            </form>
          </div>
        </div>
      )}

      {showAddStaff && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-xl animate-in zoom-in-95 duration-300 relative shadow-2xl">
            <button onClick={() => setShowAddStaff(false)} className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-8">Expand Workforce</h3>
            {staffError && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{staffError}</div>}
            <form onSubmit={handleAddStaff} className="space-y-4">
              <input type="text" placeholder="Full Member Name" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewStaff({...newStaff, name: e.target.value})} />
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="User ID" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewStaff({...newStaff, username: e.target.value})} />
                <input type="password" placeholder="Temp Pin/Pass" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewStaff({...newStaff, password: e.target.value})} />
              </div>
              <input type="text" placeholder="Phone Number (+254...)" required className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewStaff({...newStaff, phone: e.target.value})} />
              <div className="grid grid-cols-2 gap-4">
                <select className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewStaff({...newStaff, role: e.target.value})}>
                  <option value="worker">Beautician</option>
                  <option value="admin">Manager</option>
                </select>
                <div className="relative">
                  <input type="number" placeholder="Comm. %" className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" defaultValue={40} onChange={e => setNewStaff({...newStaff, commission_rate: parseInt(e.target.value)})} />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 font-bold text-gray-400">%</span>
                </div>
              </div>
              <button type="submit" className="w-full py-5 bg-[#D4AF37] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-yellow-500/20 mt-4 transition-transform hover:scale-[1.02]">Onboard Member</button>
            </form>
          </div>
        </div>
      )}

      {showAddCctv && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-lg animate-in zoom-in-95 duration-300 relative">
            <button onClick={() => setShowAddCctv(false)} className="absolute top-8 right-8 text-gray-300 hover:text-black"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-8">New Camera Feed</h3>
            <div className="space-y-6">
              <input type="text" placeholder="Camera Name (e.g. Lobby)" className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold" onChange={e => setNewCctv({...newCctv, name: e.target.value})} />
              <input type="text" placeholder="Feed URL (IP/RTSP)" className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold" onChange={e => setNewCctv({...newCctv, feed_url: e.target.value})} />
              <button 
                onClick={async () => {
                  const res = await authFetch('/api/admin/cctv', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newCctv)
                  });
                  if (res.ok) { setShowAddCctv(false); fetchData(); }
                }}
                className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest"
              >
                Establish Link
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSchedule && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-xl animate-in zoom-in-95 duration-300 relative">
            <button onClick={() => setShowAddSchedule(false)} className="absolute top-8 right-8 text-gray-300 hover:text-black"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-8">Weekly Roster Entry</h3>
            <div className="space-y-6">
              <select className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold" onChange={e => setNewSchedule({...newSchedule, worker_id: e.target.value})}>
                <option value="">Select Staff...</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold" onChange={e => setNewSchedule({...newSchedule, day_of_week: e.target.value})}>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-6">
                <input type="time" className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold" value={newSchedule.start_time} onChange={e => setNewSchedule({...newSchedule, start_time: e.target.value})} />
                <input type="time" className="w-full bg-gray-50 border-none rounded-2xl p-5 text-sm font-bold" value={newSchedule.end_time} onChange={e => setNewSchedule({...newSchedule, end_time: e.target.value})} />
              </div>
              <button 
                onClick={async () => {
                  const res = await authFetch('/api/admin/schedules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newSchedule)
                  });
                  if (res.ok) { setShowAddSchedule(false); fetchData(); }
                }}
                className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-[10px] tracking-widest"
              >
                Commit to Roster
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD BRANCH MODAL */}
      {showAddBranch && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-10 rounded-[3.5rem] w-full max-w-2xl animate-in zoom-in-95 duration-300 relative shadow-2xl max-h-[90vh] overflow-y-auto">
            <button onClick={() => { setShowAddBranch(false); setBranchPinPreview(null); }} className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-2">Add New Branch</h3>
            <p className="text-gray-400 text-xs mb-6 uppercase tracking-widest font-bold">Click on the map to pin the exact location</p>
            {branchError && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{branchError}</div>}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Branch Name *</label>
                  <input id="new-branch-name" type="text" placeholder="e.g. Westlands Branch" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewBranch({...newBranch, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Phone</label>
                  <input type="tel" placeholder="+254 712 345 678" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewBranch({...newBranch, phone: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Address</label>
                <input type="text" placeholder="e.g. Westlands Square, Ground Floor" className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setNewBranch({...newBranch, address: e.target.value})} />
              </div>

              {/* Map Picker */}
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">📍 Click Map to Pin Location</label>
                <div className="rounded-2xl overflow-hidden border-2 border-dashed border-gray-200 hover:border-[#D4AF37] transition-colors" style={{height: '280px'}}>
                  <MapContainer center={[-1.286389, 36.817223]} zoom={12} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
                    <MapClickHandler onMapClick={(lat, lng) => setBranchPinPreview({ lat, lng })} />
                    {branchPinPreview && (
                      <Marker position={[branchPinPreview.lat, branchPinPreview.lng]} icon={redIcon}>
                        <Popup>New pin: {branchPinPreview.lat.toFixed(6)}, {branchPinPreview.lng.toFixed(6)}</Popup>
                      </Marker>
                    )}
                  </MapContainer>
                </div>
                {branchPinPreview ? (
                  <p className="text-[10px] font-mono text-[#D4AF37] mt-2 font-bold">✓ Pin set: {branchPinPreview.lat.toFixed(6)}, {branchPinPreview.lng.toFixed(6)}</p>
                ) : (
                  <p className="text-[10px] text-gray-400 mt-2">No pin placed yet. Click anywhere on the map above.</p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="branch-active-new" checked={newBranch.is_active} onChange={e => setNewBranch({...newBranch, is_active: e.target.checked})} className="w-4 h-4 accent-[#D4AF37]" />
                <label htmlFor="branch-active-new" className="text-sm font-bold text-gray-600">Active (visible to clients)</label>
              </div>

              <button
                id="save-branch-btn"
                onClick={handleAddBranch}
                disabled={isSavingBranch}
                className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-black/20 transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                {isSavingBranch ? 'Saving...' : 'Save Branch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT BRANCH MODAL */}
      {editingBranch && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white p-10 rounded-[3.5rem] w-full max-w-2xl animate-in zoom-in-95 duration-300 relative shadow-2xl max-h-[90vh] overflow-y-auto">
            <button onClick={() => { setEditingBranch(null); setBranchPinPreview(null); }} className="absolute top-8 right-8 text-gray-300 hover:text-black transition-colors"><XCircle size={24}/></button>
            <h3 className="text-3xl font-serif font-bold mb-2">Edit Branch</h3>
            <p className="text-gray-400 text-xs mb-6 uppercase tracking-widest font-bold">Click on the map to reposition the pin</p>
            {branchError && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{branchError}</div>}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Branch Name *</label>
                  <input type="text" value={editingBranch.name} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setEditingBranch({...editingBranch, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Phone</label>
                  <input type="tel" value={editingBranch.phone || ''} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setEditingBranch({...editingBranch, phone: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">Address</label>
                <input type="text" value={editingBranch.address || ''} className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[#D4AF37]" onChange={e => setEditingBranch({...editingBranch, address: e.target.value})} />
              </div>

              {/* Map Picker */}
              <div>
                <label className="text-[10px] font-black uppercase text-gray-400 block mb-2">📍 Click Map to Update Pin</label>
                <div className="rounded-2xl overflow-hidden border-2 border-dashed border-gray-200 hover:border-[#D4AF37] transition-colors" style={{height: '280px'}}>
                  <MapContainer
                    center={branchPinPreview ? [branchPinPreview.lat, branchPinPreview.lng] : (editingBranch.latitude ? [parseFloat(editingBranch.latitude), parseFloat(editingBranch.longitude)] : [-1.286389, 36.817223])}
                    zoom={14}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
                    <MapClickHandler onMapClick={(lat, lng) => setBranchPinPreview({ lat, lng })} />
                    {/* Show previous pin in gold */}
                    {!branchPinPreview && editingBranch.latitude && editingBranch.longitude && (
                      <Marker position={[parseFloat(editingBranch.latitude), parseFloat(editingBranch.longitude)]} icon={goldIcon}>
                        <Popup>Current: {parseFloat(editingBranch.latitude).toFixed(6)}, {parseFloat(editingBranch.longitude).toFixed(6)}</Popup>
                      </Marker>
                    )}
                    {/* Show new pin in red */}
                    {branchPinPreview && (
                      <Marker position={[branchPinPreview.lat, branchPinPreview.lng]} icon={redIcon}>
                        <Popup>New: {branchPinPreview.lat.toFixed(6)}, {branchPinPreview.lng.toFixed(6)}</Popup>
                      </Marker>
                    )}
                  </MapContainer>
                </div>
                {branchPinPreview ? (
                  <p className="text-[10px] font-mono text-[#D4AF37] mt-2 font-bold">✓ New pin: {branchPinPreview.lat.toFixed(6)}, {branchPinPreview.lng.toFixed(6)}</p>
                ) : editingBranch.latitude ? (
                  <p className="text-[10px] font-mono text-gray-400 mt-2">Current: {parseFloat(editingBranch.latitude).toFixed(6)}, {parseFloat(editingBranch.longitude).toFixed(6)} — click to repin</p>
                ) : (
                  <p className="text-[10px] text-gray-400 mt-2">No pin set. Click map above to pin this branch.</p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="branch-active-edit" checked={editingBranch.is_active == 1 || editingBranch.is_active === true} onChange={e => setEditingBranch({...editingBranch, is_active: e.target.checked})} className="w-4 h-4 accent-[#D4AF37]" />
                <label htmlFor="branch-active-edit" className="text-sm font-bold text-gray-600">Active (visible to clients)</label>
              </div>

              <button
                onClick={handleUpdateBranch}
                disabled={isSavingBranch}
                className="w-full py-5 bg-black text-[#D4AF37] rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-2xl shadow-black/20 transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                {isSavingBranch ? 'Saving...' : 'Update Branch'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
