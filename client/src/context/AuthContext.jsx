/**
 * AuthContext.jsx – Global authentication state provider
 */
import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('pl_token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('pl_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (newToken, newUser) => {
    localStorage.setItem('pl_token', newToken);
    localStorage.setItem('pl_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('pl_token');
    localStorage.removeItem('pl_user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: Boolean(token),
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
