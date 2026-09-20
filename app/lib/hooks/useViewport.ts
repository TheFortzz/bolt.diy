import { useState, useEffect } from 'react';

const useViewport = (threshold = 1024) => {
  const [isSmallViewport, setIsSmallViewport] = useState(
    typeof window !== 'undefined' ? window.innerWidth < threshold : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => setIsSmallViewport(window.innerWidth < threshold);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [threshold]);

  return isSmallViewport;
};

export default useViewport;
