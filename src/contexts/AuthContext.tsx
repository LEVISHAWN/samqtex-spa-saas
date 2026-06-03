import React, { createContext, useContext, useEffect, useState } from 'react';

export interface AppUser {
  id: number;
  email: string;
  username?: string;
  name: string;
  phone?: string;
  role: 'admin' | 'worker' | 'client';
  bio?: string;
  skills?: string | string[];
  commission_rate?: number;
  tenant_id?: number;
}

interface AuthContextType {
  user: AppUser | null;
  setUser: (user: AppUser | null) => void;
  loading: boolean;
  login: (identifier: string, password: string, tenant_id: string, portal?: string) => Promise<void>;
  signup: (name: string, email: string, phone: string, password: string, tenant_id: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  loading: true,
  login: async () => {},
  signup: async () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (storedUser && token) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
      } catch (e) {
        console.error("Failed to parse stored user", e);
      }
    }
    setLoading(false);
  }, []);

  const handleSetUser = (u: AppUser | null) => {
    setUser(u);
    if (u) {
      localStorage.setItem('user', JSON.stringify(u));
    } else {
      localStorage.removeItem('user');
    }
  };

  const login = async (identifier: string, password: string, tenant_id: string, portal?: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, tenant_id, portal })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    
    handleSetUser(data.user);
    localStorage.setItem('token', data.token);
  };

  const signup = async (name: string, email: string, phone: string, password: string, tenant_id: string) => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, password, tenant_id, role: 'client' })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');
    
    handleSetUser(data.user);
    localStorage.setItem('token', data.token);
  };

  const logout = () => {
    handleSetUser(null);
    localStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, setUser: handleSetUser, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
