import { memo, useEffect, useRef } from 'react';
import { classNames } from '~/utils/classNames';

interface MatrixRainProps {
  className?: string;
}

/**
 * Original "AI working" animation: falling code rain on a dark stage. Coded
 * from scratch for Fortz Studio, so it is free to use forever — no GIF
 * licensing or hotlinking involved.
 */
export const MatrixRain = memo(({ className }: MatrixRainProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return undefined;
    }

    const FONT = 14;
    const HEIGHT = 96;
    const GLYPHS = 'アイウエオカキクケコサシスセソ01<>+*#$%&/=';
    let columns: number[] = [];
    let raf = 0;
    let last = 0;

    const paintStaticFrame = () => {
      ctx.fillStyle = '#020610';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${FONT}px monospace`;

      for (let i = 0; i < columns.length; i++) {
        const glyph = GLYPHS[(i * 7) % GLYPHS.length];
        ctx.fillStyle = i % 9 === 0 ? '#e9d5ff' : '#22d3ee';
        ctx.fillText(glyph, i * FONT, ((i * 37) % HEIGHT) + FONT);
      }
    };

    const resize = () => {
      const width = Math.max(1, Math.floor(canvas.getBoundingClientRect().width));
      canvas.width = width;
      canvas.height = HEIGHT;
      columns = Array.from({ length: Math.ceil(width / FONT) }, (_, i) => -Math.random() * 30 - i * 0.4);
    };

    resize();

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      paintStaticFrame();

      return undefined;
    }

    const step = (time: number) => {
      raf = requestAnimationFrame(step);

      if (time - last < 66) {
        return;
      }

      last = time;
      ctx.fillStyle = 'rgba(2,6,16,0.28)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${FONT}px monospace`;

      for (let i = 0; i < columns.length; i++) {
        const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        ctx.fillStyle = Math.random() < 0.07 ? '#e9d5ff' : '#22d3ee';
        ctx.fillText(glyph, i * FONT, columns[i] * FONT);
        columns[i] += 1;

        if (columns[i] * FONT > HEIGHT + 48 && Math.random() < 0.06) {
          columns[i] = 0;
        }
      }
    };

    raf = requestAnimationFrame(step);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={classNames('block h-24 w-full', className)} aria-hidden="true" />;
});
