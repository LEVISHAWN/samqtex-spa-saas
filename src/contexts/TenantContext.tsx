import React, { createContext, useContext, useState, useEffect } from 'react';
import { authFetch } from '../api';

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  theme: {
    primaryColor: string;
    secondaryColor: string;
  };
  subscriptionStatus: 'active' | 'suspended' | 'trial';
  latitude?: number;
  longitude?: number;
  address?: string;
  phone?: string;
}

interface TenantContextType {
  tenant: Tenant | null;
  loading: boolean;
  setTenantId: (id: string) => void;
  refetchTenant: () => Promise<void>;
}

const DEFAULT_TENANT: Tenant = {
  id: 'samqtex-1',
  name: 'SamQtex Spa',
  subdomain: 'samqtex',
  theme: { primaryColor: '#D4AF37', secondaryColor: '#9A4C58' },
  subscriptionStatus: 'active',
  latitude: undefined,
  longitude: undefined,
  address: undefined,
  phone: undefined
};

const TenantContext = createContext<TenantContextType>({
  tenant: DEFAULT_TENANT,
  loading: false,
  setTenantId: () => {},
  refetchTenant: async () => {},
});

export const useTenant = () => useContext(TenantContext);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTenantSettings = async () => {
    try {
      const res = await authFetch('/api/settings');
      const data = await res.json();
      if (data) {
        setTenant({
          id: data.tenant_id?.toString() || 'samqtex-1',
          name: data.salon_name || 'SamQtex Spa',
          subdomain: data.subdomain || 'samqtex',
          theme: {
            primaryColor: data.primary_color || '#D4AF37',
            secondaryColor: data.secondary_color || '#9A4C58'
          },
          subscriptionStatus: 'active',
          latitude: data.latitude,
          longitude: data.longitude,
          address: data.address,
          phone: data.phone
        });
        if (data.tenant_id) localStorage.setItem('tenantId', data.tenant_id.toString());
      } else {
        setTenant(DEFAULT_TENANT);
      }
    } catch (err) {
      console.error("Failed to fetch tenant", err);
      setTenant(DEFAULT_TENANT);
    }
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tenantIdFromUrl = urlParams.get('tenantId');
    if (tenantIdFromUrl) {
      localStorage.setItem('tenantId', tenantIdFromUrl);
    }
    
    fetchTenantSettings().finally(() => setLoading(false));

    // Refetch tenant settings when user returns to tab
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchTenantSettings();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const setTenantId = (id: string) => {
    localStorage.setItem('tenantId', id);
    window.location.reload();
  };

  const refetchTenant = async () => {
    await fetchTenantSettings();
  };

  return (
    <TenantContext.Provider value={{ tenant, loading, setTenantId, refetchTenant }}>
      {children}
    </TenantContext.Provider>
  );
};
