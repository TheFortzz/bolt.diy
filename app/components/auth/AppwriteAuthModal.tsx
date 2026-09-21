import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { isAuthModalOpen } from '~/lib/auth/appwrite';

export function AppwriteAuthModal() {
  const isOpen = useStore(isAuthModalOpen);

  useEffect(() => {
    if (isOpen) {
      if (typeof window !== 'undefined') {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
        } else {
          window.dispatchEvent(new CustomEvent('thefortz-open-login'));
        }
      }
      isAuthModalOpen.set(false);
    }
  }, [isOpen]);

  return null;
}
