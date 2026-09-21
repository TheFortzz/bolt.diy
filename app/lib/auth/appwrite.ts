import { Client, Account, ID, OAuthProvider, type Models } from 'appwrite';
import { atom } from 'nanostores';

export const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = '6a83071d00217ab38269';

export interface AppwriteUser {
  $id: string;
  name: string;
  email: string;
  photoURL?: string;
  prefs?: Record<string, any>;
}

export interface AuthState {
  user: AppwriteUser | null;
  loading: boolean;
  initialized: boolean;
}

export const authStore = atom<AuthState>({
  user: null,
  loading: true,
  initialized: false,
});

export const isAuthModalOpen = atom<boolean>(false);

let client: Client | null = null;
let account: Account | null = null;

export function getAppwriteClient(): Client {
  if (!client) {
    client = new Client()
      .setEndpoint(APPWRITE_ENDPOINT)
      .setProject(APPWRITE_PROJECT_ID);
  }
  return client;
}

export function getAppwriteAccount(): Account {
  if (!account) {
    account = new Account(getAppwriteClient());
  }
  return account;
}

if (typeof window !== 'undefined') {
  // Listen for real-time auth sync from thefortz.me parent window
  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'thefortz-auth-sync') {
      const { user, balance } = event.data;
      if (user) {
        const rawPhoto = user.photoURL || user.prefs?.photoURL || '';
        const cleanPhoto = (function(url: string) {
          if (!url || typeof url !== 'string') return '';
          const trimmed = url.trim();
          if (trimmed.includes('/avatars/initials') || trimmed.includes('ui-avatars.com')) return '';
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) return trimmed;
          if (trimmed.includes('346f7ce283c24a248b435f41acd3a081') || /^[a-f0-9]{32}/i.test(trimmed)) {
            const cleanHash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
            return `https://cdn.discordapp.com/avatars/1440344883914080280/${cleanHash}`;
          }
          return '';
        })(rawPhoto);

        const userObj: AppwriteUser = {
          $id: user.$id || user.id || 'usr_synced',
          name: user.name || user.displayName || 'Creator',
          email: user.email || '',
          photoURL: cleanPhoto,
          prefs: {
            ...(user.prefs || {}),
            fortz_balance: typeof balance === 'number' ? balance : (user.prefs?.fortz_balance ?? 100),
            photoURL: cleanPhoto,
          },
        };

        authStore.set({
          user: userObj,
          loading: false,
          initialized: true,
        });

        try {
          localStorage.setItem('thefortz_synced_user', JSON.stringify(userObj));
          if (typeof balance === 'number') {
            localStorage.setItem('thefortz_fortz_balance', String(balance));
            window.dispatchEvent(new CustomEvent('thefortz-balance-updated', { detail: { balance } }));
          }
        } catch {}
      } else {
        // Parent indicates user is logged out
        authStore.set({
          user: null,
          loading: false,
          initialized: true,
        });
        try {
          localStorage.removeItem('thefortz_synced_user');
        } catch {}
      }
    }
  });

  // Request sync immediately if inside iframe
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'thefortz-auth-request' }, '*');
    } catch {}
  }
}

/**
 * Check if the user already has an active Appwrite session or synced session
 */
export async function checkAuthSession(): Promise<AppwriteUser | null> {
  if (typeof window === 'undefined') return null;

  // 1. If embedded in iframe, rely entirely on parent window auth sync to prevent CORS errors
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'thefortz-auth-request' }, '*');
    } catch {}

    // Check cached synced user
    try {
      const cached = localStorage.getItem('thefortz_synced_user');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.$id) {
          authStore.set({
            user: parsed,
            loading: false,
            initialized: true,
          });
          return parsed;
        }
      }
    } catch {}

    return authStore.get().user;
  }

  // 2. Check local cached synced user first for instant hydration
  try {
    const cached = localStorage.getItem('thefortz_synced_user');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.$id) {
        authStore.set({
          user: parsed,
          loading: false,
          initialized: true,
        });
        return parsed;
      }
    }
  } catch {}

  try {
    authStore.set({ ...authStore.get(), loading: true });

    // Handle OAuth redirect return params first
    await handleOAuthCallback();

    const acc = getAppwriteAccount();
    const current = await acc.get<Models.Preferences>().catch(() => null);

    if (current && current.$id) {
      const userObj: AppwriteUser = {
        $id: current.$id,
        name: current.name || current.email?.split('@')[0] || 'Creator',
        email: current.email || '',
        prefs: current.prefs || {},
      };

      // Sync Fortz balance from prefs or localStorage
      const userBalance = (current.prefs as Record<string, any>)?.fortz_balance;
      if (typeof userBalance === 'number') {
        localStorage.setItem('thefortz_fortz_balance', String(userBalance));
        window.dispatchEvent(new CustomEvent('thefortz-balance-updated', { detail: { balance: userBalance } }));
      }

      authStore.set({
        user: userObj,
        loading: false,
        initialized: true,
      });

      return userObj;
    }
  } catch (error) {
    // User is not signed in or session expired
  }

  // Preserve existing synced user if set by postMessage
  const currentVal = authStore.get();
  if (!currentVal.user) {
    authStore.set({
      user: null,
      loading: false,
      initialized: true,
    });
  }

  return authStore.get().user;
}

/**
 * Handle URL query params when returning from Appwrite OAuth2 redirect (userId & secret).
 */
export async function handleOAuthCallback(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('userId');
    const secret = urlParams.get('secret');

    if (userId && secret) {
      const acc = getAppwriteAccount();
      await acc.createSession(userId, secret);

      // Clean query params without reloading
      urlParams.delete('userId');
      urlParams.delete('secret');
      const newSearch = urlParams.toString();
      const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
      return true;
    }
  } catch (e) {
    console.info('[Appwrite] OAuth callback error:', e);
  }

  return false;
}

/**
 * Sign in with Email & Password
 */
export async function appwriteLogin(email: string, pass: string): Promise<AppwriteUser> {
  const acc = getAppwriteAccount();
  
  // Clear any stale local session before creating new
  try {
    await acc.deleteSession('current');
  } catch {}

  await acc.createEmailPasswordSession(email.trim(), pass);
  const current = await acc.get<Models.Preferences>();

  const userObj: AppwriteUser = {
    $id: current.$id,
    name: current.name || current.email?.split('@')[0] || 'Creator',
    email: current.email || '',
    prefs: current.prefs || {},
  };

  const userBalance = (current.prefs as Record<string, any>)?.fortz_balance;
  if (typeof userBalance === 'number') {
    localStorage.setItem('thefortz_fortz_balance', String(userBalance));
  } else {
    localStorage.setItem('thefortz_fortz_balance', '100');
  }
  window.dispatchEvent(new CustomEvent('thefortz-balance-updated'));

  authStore.set({
    user: userObj,
    loading: false,
    initialized: true,
  });

  isAuthModalOpen.set(false);
  return userObj;
}

/**
 * Sign up with Email, Password & Name
 */
export async function appwriteSignup(name: string, email: string, pass: string): Promise<AppwriteUser> {
  const acc = getAppwriteAccount();
  
  // 1. Create account
  await acc.create(ID.unique(), email.trim(), pass, name.trim());

  // 2. Log in immediately
  await acc.createEmailPasswordSession(email.trim(), pass);

  // 3. Initialize default starting balance (100 FORTZ)
  try {
    await acc.updatePrefs({ fortz_balance: 100 });
  } catch {}

  const current = await acc.get<Models.Preferences>();
  const userObj: AppwriteUser = {
    $id: current.$id,
    name: current.name || name.trim(),
    email: current.email || email.trim(),
    prefs: current.prefs || {},
  };

  localStorage.setItem('thefortz_fortz_balance', '100');
  window.dispatchEvent(new CustomEvent('thefortz-balance-updated'));

  authStore.set({
    user: userObj,
    loading: false,
    initialized: true,
  });

  isAuthModalOpen.set(false);
  return userObj;
}

/**
 * Google OAuth2 Login
 */
export function appwriteLoginWithGoogle() {
  if (typeof window === 'undefined') return;
  const acc = getAppwriteAccount();
  const url = window.location.origin + window.location.pathname;
  return acc.createOAuth2Token(
    OAuthProvider.Google,
    url,
    url,
    ['openid', 'profile', 'email'],
  );
}

/**
 * Discord OAuth2 Login
 */
export function appwriteLoginWithDiscord() {
  if (typeof window === 'undefined') return;
  const acc = getAppwriteAccount();
  const url = window.location.origin + window.location.pathname;
  return acc.createOAuth2Token(
    OAuthProvider.Discord,
    url,
    url,
    ['identify', 'email'],
  );
}

/**
 * Sign out of current Appwrite session
 */
export async function appwriteLogout(): Promise<void> {
  try {
    const acc = getAppwriteAccount();
    await acc.deleteSession('current');
  } catch (e) {
    console.warn('[Appwrite] Logout notice:', e);
  }

  try {
    localStorage.removeItem('thefortz_synced_user');
  } catch {}

  authStore.set({
    user: null,
    loading: false,
    initialized: true,
  });
}
