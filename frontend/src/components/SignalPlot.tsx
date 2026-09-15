/**
 * Static plot of a processed signal returned by the backend - the rPPG trace
 * with its detected systolic peaks, or the AMDF curve with its minima.
 *
 * Drawn once to a canvas (re-drawn on resize / theme change) rather than as
 * thousands of SVG nodes.
 */

import { useEffect, useRef } from 'react';

interface SignalPlotProps {
  series: number[];
  markers?: number[];
  height?: number;
  label: string;
  /** Description of the x axis, e.g. "Frame" or "Lag (samples)". */
  xLabel?: string;
  markerLabel?: string;
}

export function SignalPlot({
  series,
  markers = [],
  height = 140,
  label,
  xLabel,
  markerLabel = 'Detected peaks',
}: SignalPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const styles = getComputedStyle(document.documentElement);
    const stroke = styles.getPropertyValue('--vs-accent').trim() || '#0f7a6b';
    const marker = styles.getPropertyValue('--vs-pulse').trim() || '#c0392b';
    const grid = styles.getPropertyValue('--vs-border').trim() || '#e2e6e5';

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth || 320;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const n = series.length;
      if (n < 2) return;

      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i += 1) {
        if (series[i] < min) min = series[i];
        if (series[i] > max) max = series[i];
      }
      const span = max - min || 1;
      const pad = 10;
      const usable = height - pad * 2;
      const xAt = (i: number) => (i / (n - 1)) * width;
      const yAt = (v: number) => pad + usable - ((v - min) / span) * usable;

      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yAt(min + span / 2));
      ctx.lineTo(width, yAt(min + span / 2));
      ctx.stroke();

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = xAt(i);
        const y = yAt(series[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = marker;
      markers.forEach((index) => {
        if (index < 0 || index >= n) return;
        ctx.beginPath();
        ctx.arc(xAt(index), yAt(series[index]), 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    render();
    window.addEventListener('resize', render);
    return () => window.removeEventListener('resize', render);
  }, [series, markers, height]);

  const description = markers.length
    ? `${label}. ${series.length} samples with ${markers.length} ${markerLabel.toLowerCase()}.`
    : `${label}. ${series.length} samples.`;

  return (
    <figure style={{ margin: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height }}
        role="img"
        aria-label={description}
      />
      {xLabel && (
        <figcaption className="vs-fine" style={{ marginTop: 4 }}>
          {xLabel}
          {markers.length > 0 && ` · ${markers.length} ${markerLabel.toLowerCase()}`}
        </figcaption>
      )}
    </figure>
  );
}
