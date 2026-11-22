import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

/**
 * Fallback en memoria solo para entornos de prueba (Jest/Node) donde el módulo nativo
 * AsyncStorage no está disponible. En Android usa AsyncStorage persistente en disco.
 */
class MemoryAuthStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const memoryStorage = new MemoryAuthStorage();

const authStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (AsyncStorage && typeof AsyncStorage.getItem === 'function') {
        return await AsyncStorage.getItem(key);
      }
    } catch {
      // Fallback a memoria si AsyncStorage nativo no está disponible
    }
    return memoryStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (AsyncStorage && typeof AsyncStorage.setItem === 'function') {
        await AsyncStorage.setItem(key, value);
        return;
      }
    } catch {
      // Fallback a memoria
    }
    memoryStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    try {
      if (AsyncStorage && typeof AsyncStorage.removeItem === 'function') {
        await AsyncStorage.removeItem(key);
        return;
      }
    } catch {
      // Fallback a memoria
    }
    memoryStorage.removeItem(key);
  },
};

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase no está configurado. Verifica EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY en android-app/.env.'
    );
  }

  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: authStorage,
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }

  return cachedClient;
}
