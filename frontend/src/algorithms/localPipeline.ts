/**
 * On-device measurement pipeline.
 *
 * Port of `backend/app/services/pipeline.py`. Produces exactly the same
 * `Measurement` shape the API returns, so the results and detailed-analysis
 * screens are identical whether the measurement was processed on the device
 * (Android build) or by the Render backend (web build).
 */

import type { CaptureMeta, FrameSignals, Measurement } from '../types/measurement';
import {
  assessRhythm,
  estimateRr,
  estimateSpo2Pi,
  PipelineError,
  preprocess,
  pulseRate,
  SPO2_INTERCEPT,
  SPO2_SLOPE,
  toUniformGrid,
} from './stages';

/** Matches `settings.min_analysis_seconds` on the backend. */
export const MIN_ANALYSIS_SECONDS = 20;
/** Matches `WAVEFORM_MAX_POINTS` in the backend pipeline. */
const WAVEFORM_MAX_POINTS = 1800;

function decimateForPlot(
  x: ArrayLike<number>,
  peaks: number[],
  maxPoints = WAVEFORM_MAX_POINTS,
): { series: number[]; markers: number[]; step: number } {
  const n = x.length;
  if (n <= maxPoints) {
    return {
      series: Array.from(x as ArrayLike<number> & Iterable<number>),
      markers: peaks.filter((p) => p >= 0 && p < n),
      step: 1,
    };
  }
  const step = Math.ceil(n / maxPoints);
  const series: number[] = [];
  for (let i = 0; i < n; i += step) series.push(x[i]);
  const mapped = [...new Set(peaks.filter((p) => p >= 0 && p < n).map((p) => Math.trunc(p / step)))]
    .sort((a, b) => a - b)
    .filter((p) => p < series.length);
  return { series, markers: mapped, step };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Analyse captured frame signals entirely on the device.
 *
 * Throws `PipelineError` with a user-facing message when the capture cannot be
 * analysed - never returns a fabricated result.
 */
export function runLocalPipeline(signals: FrameSignals, meta?: CaptureMeta): Measurement {
  const uniform = toUniformGrid(
    signals.timestamps,
    signals.gray,
    signals.red,
    signals.green,
    signals.blue,
  );

  const { fps, gray, red, blue } = uniform;
  const n = gray.length;
  const durationS = n / fps;

  if (durationS < MIN_ANALYSIS_SECONDS) {
    throw new PipelineError(
      `Only ${durationS.toFixed(1)}s of signal was captured; at least ` +
        `${MIN_ANALYSIS_SECONDS}s is required for analysis.`,
    );
  }

  const notes: string[] = [];

  // Stage 1: preprocessing (cell 11)
  const pre = preprocess(gray, fps);

  // Stage 2/3: peaks, three PR estimators, fusion (cells 15 + 16)
  const pr = pulseRate(pre.x, fps, durationS);
  if (pr.fused === null) {
    notes.push(
      'The three pulse-rate estimates disagreed by more than the fusion rule allows, ' +
        'so no fused pulse rate is reported.',
    );
  }

  // Stage 4: rhythm (cell 20)
  const refPr = pr.fused ?? pr.prAmdf;
  const rhythmRes = assessRhythm(pre.x, fps, pr.ppi, refPr);
  const totalSegments = rhythmRes.segmentSqa.length;
  const goodSegments = rhythmRes.segmentSqa.filter((v) => v === 0).length;
  if (totalSegments < 2) {
    notes.push(
      'Fewer than two 10-second segments were available, so the per-segment ' +
        'AMDF rhythm check is inconclusive.',
    );
  }

  // Stage 5: SpO2 + PI (cell 22)
  let oximetry: ReturnType<typeof estimateSpo2Pi> | null = null;
  try {
    oximetry = estimateSpo2Pi(red, blue, fps);
  } catch {
    notes.push(
      'SpO2 and perfusion index could not be computed from the captured colour signal.',
    );
  }

  // Stage 6: respiratory rate (cell 24)
  const rr = estimateRr(pr.peaks, fps, pr.ySmooth);
  if (rr === null) {
    notes.push('Too few pulse peaks were detected to estimate a respiratory rate.');
  }

  const waveform = decimateForPlot(pre.x, pr.peaks);
  const rawWaveform = decimateForPlot(pre.dA, []);
  const amdf = decimateForPlot(pr.amdfCurve, pr.amdfLocs, pr.amdfCurve.length);

  const spread =
    Math.max(pr.prCount, pr.prPpi, pr.prAmdf) - Math.min(pr.prCount, pr.prPpi, pr.prAmdf);

  return {
    status: 'success',
    source: 'frame-signals',
    capture: {
      fps,
      duration_s: round(durationS, 2),
      samples: n,
      effective_fps: round(uniform.effectiveFps, 2),
      jitter_ms: round(uniform.jitterMs, 2),
      dropped_samples: uniform.droppedSamples,
      torch_enabled: meta?.torch_enabled ?? null,
      facing_mode: meta?.facing_mode ?? null,
      frame_width: meta?.frame_width ?? null,
      frame_height: meta?.frame_height ?? null,
      roi_width: meta?.roi_width ?? null,
      roi_height: meta?.roi_height ?? null,
    },
    pulse_rate: {
      count_based: pr.prCount,
      ppi_based: pr.prPpi,
      amdf_based: pr.prAmdf,
      fused: pr.fused,
      unit: 'bpm',
      peaks_detected: pr.peaks.length,
    },
    signal_quality: {
      sqa_flag: pr.sqaFlag,
      label: pr.sqaFlag === 1 ? 'Bad' : 'Good',
      method_spread_bpm: spread,
      good_segments: goodSegments,
      total_segments: totalSegments,
    },
    rhythm: {
      ppi_method: rhythmRes.ppiRegular ? 'Regular' : 'Irregular',
      amdf_method: rhythmRes.amdfRegular ? 'Regular' : 'Irregular',
      segment_pulse_rates: rhythmRes.segmentPr,
      segment_quality: rhythmRes.segmentSqa,
    },
    spo2:
      oximetry === null
        ? null
        : {
            value: round(oximetry.spo2, 1),
            unit: '%',
            experimental: true,
            ratio_of_ratios: round(oximetry.ratioOfRatios, 4),
            ac_red: oximetry.acRed,
            dc_red: oximetry.dcRed,
            ac_blue: oximetry.acBlue,
            dc_blue: oximetry.dcBlue,
            calibration: `SpO2 = ${SPO2_SLOPE} * R + ${SPO2_INTERCEPT}`,
          },
    perfusion_index:
      oximetry === null
        ? null
        : { value: round(oximetry.perfusionIndex, 2), unit: '%', experimental: true },
    respiratory_rate:
      rr === null ? null : { value: round(rr, 1), unit: 'breaths/min', experimental: true },
    waveform: {
      rppg: waveform.series,
      raw: rawWaveform.series,
      peak_indices: waveform.markers,
      decimation: waveform.step,
      fps,
    },
    amdf: { curve: amdf.series, minima_indices: amdf.markers },
    pulse_intervals_s: Array.from(pr.ppi).map((v) => round(v, 4)),
    notes,
  };
}
