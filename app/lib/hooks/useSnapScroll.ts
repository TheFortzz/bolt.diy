import { useRef, useCallback, useEffect } from 'react';

export function useSnapScroll(isStreaming?: boolean) {
  const autoScrollRef = useRef(true);
  const scrollNodeRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef<() => void>();
  const observerRef = useRef<ResizeObserver | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    if (!scrollNodeRef.current) return;
    const node = scrollNodeRef.current;
    const scrollTarget = node.scrollHeight - node.clientHeight;

    if (scrollTarget > 0) {
      node.scrollTo({
        top: scrollTarget,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // When streaming starts or during streaming, auto-scroll stays enabled and locks to bottom
  useEffect(() => {
    if (isStreaming) {
      autoScrollRef.current = true;
      scrollToBottom(false);
    }
  }, [isStreaming, scrollToBottom]);

  const messageRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (node) {
      const observer = new ResizeObserver(() => {
        if (autoScrollRef.current && scrollNodeRef.current) {
          const scrollNode = scrollNodeRef.current;
          const scrollTarget = scrollNode.scrollHeight - scrollNode.clientHeight;

          if (scrollTarget > 0) {
            scrollNode.scrollTo({
              top: scrollTarget,
              behavior: 'auto',
            });
          }
        }
      });

      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    if (scrollNodeRef.current && onScrollRef.current) {
      scrollNodeRef.current.removeEventListener('scroll', onScrollRef.current);
    }

    if (node) {
      onScrollRef.current = () => {
        const { scrollTop, scrollHeight, clientHeight } = node;
        const scrollTarget = scrollHeight - clientHeight;

        // Generous threshold (120px) so subpixel rounding or small shifts don't stop auto-scrolling
        autoScrollRef.current = scrollTarget - scrollTop <= 120;
      };

      node.addEventListener('scroll', onScrollRef.current, { passive: true });
      scrollNodeRef.current = node;

      // Scroll immediately on mount if already active
      if (autoScrollRef.current) {
        requestAnimationFrame(() => {
          const scrollTarget = node.scrollHeight - node.clientHeight;
          if (scrollTarget > 0) {
            node.scrollTo({ top: scrollTarget, behavior: 'auto' });
          }
        });
      }
    } else {
      scrollNodeRef.current = null;
      onScrollRef.current = undefined;
    }
  }, []);

  return [messageRef, scrollRef, scrollToBottom] as const;
}
