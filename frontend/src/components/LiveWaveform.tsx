/**
 * Live pulse waveform.
 *
 * Renders from its own requestAnimationFrame loop, pulling the latest samples
 * straight out of the capture buffer through `getWindow`. It holds no React
 * state and never re-renders while the camera is running, so a 30 fps stream
 * costs zero component updates.
 */

import { useEffect, useRef } from 'react';

interface LiveWaveformProps {
  /** Returns the most recent `n` grayscale samples from the capture buffer. */
  getWindow: (sampleCount: number) => Float64Array;
  /** Seconds of signal to display. */
  windowSeconds?: number;
  /** Estimated capture rate, used to size the window. */
  fps: number;
  active: boolean;
  label?: string;
}

const HEIGHT = 84;

export function LiveWaveform({
  getWindow,
  windowSeconds = 6,
  fps,
  active,
  label = 'Live pulse signal',
}: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let raf = 0;
    let stopped = false;

    const styles = getComputedStyle(document.documentElement);
    const strokeActive = styles.getPropertyValue('--vs-accent').trim() || '#0f7a6b';
    const strokeIdle = styles.getPropertyValue('--vs-ink-faint').trim() || '#8a9793';
    const baseline = styles.getPropertyValue('--vs-border').trim() || '#e2e6e5';

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth || 320;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return width;
    };

    let width = resize();
    const onResize = () => {
      width = resize();
    };
    window.addEventListener('resize', onResize);

    const draw = () => {
      if (stopped) return;
      const effectiveFps = fpsRef.current > 0 ? fpsRef.current : 30;
      const count = Math.max(32, Math.round(windowSeconds * effectiveFps));
      const samples = getWindow(count);

      ctx.clearRect(0, 0, width, HEIGHT);

      // Baseline
      ctx.strokeStyle = baseline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, HEIGHT / 2);
      ctx.lineTo(width, HEIGHT / 2);
      ctx.stroke();

      const n = samples.length;
      if (n >= 4) {
        // Detrend + normalise to the window so the trace always fills the box.
        let mean = 0;
        for (let i = 0; i < n; i += 1) mean += samples[i];
        mean /= n;
        let peak = 1e-9;
        for (let i = 0; i < n; i += 1) {
          const d = Math.abs(samples[i] - mean);
          if (d > peak) peak = d;
        }

        const pad = 8;
        const amp = (HEIGHT / 2 - pad) / peak;
        ctx.strokeStyle = activeRef.current ? strokeActive : strokeIdle;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < n; i += 1) {
          const x = (i / (n - 1)) * width;
          const y = HEIGHT / 2 - (samples[i] - mean) * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [getWindow, windowSeconds]);

  return (
    <figure className="vs-wave" style={{ margin: 0 }}>
      <figcaption className="vs-wave__head">
        <span className="vs-eyebrow">{label}</span>
      </figcaption>
      <canvas ref={canvasRef} className="vs-wave__canvas" role="img" aria-label={label} />
    </figure>
  );
}
