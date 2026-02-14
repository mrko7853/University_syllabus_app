import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

interface AuthStorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase keys are missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in native/.env');
}

const isServer = typeof window === 'undefined';
const hasLocalStorage = !isServer && typeof window.localStorage !== 'undefined';

const webStorage: AuthStorageAdapter = {
  getItem: async (key: string) => (hasLocalStorage ? window.localStorage.getItem(key) : null),
  setItem: async (key: string, value: string) => {
    if (hasLocalStorage) window.localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (hasLocalStorage) window.localStorage.removeItem(key);
  },
};

const storage: AuthStorageAdapter =
  Platform.OS === 'web'
    ? webStorage
    : {
        getItem: AsyncStorage.getItem,
        setItem: AsyncStorage.setItem,
        removeItem: AsyncStorage.removeItem,
      };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: !isServer,
    persistSession: !isServer,
    detectSessionInUrl: false,
  },
});
