import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import styles from './styles.module.scss';

const BackgroundRays = () => {
  const chat = useStore(chatStore);
  const isChatRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/chat/');

  if (chat.started || isChatRoute) {
    return null;
  }

  return (
    <div className={`${styles.rayContainer} `}>
      <div className={`${styles.lightRay} ${styles.ray1}`}></div>
      <div className={`${styles.lightRay} ${styles.ray2}`}></div>
      <div className={`${styles.lightRay} ${styles.ray3}`}></div>
      <div className={`${styles.lightRay} ${styles.ray4}`}></div>
      <div className={`${styles.lightRay} ${styles.ray5}`}></div>
      <div className={`${styles.lightRay} ${styles.ray6}`}></div>
      <div className={`${styles.lightRay} ${styles.ray7}`}></div>
      <div className={`${styles.lightRay} ${styles.ray8}`}></div>
    </div>
  );
};

export default BackgroundRays;
