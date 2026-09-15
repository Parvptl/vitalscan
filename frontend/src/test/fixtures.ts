import type { Measurement } from '../types/measurement';

/** A complete, good-quality measurement shaped exactly like the API response. */
export const MEASUREMENT: Measurement = {
  status: 'success',
  source: 'frame-signals',
  capture: {
    fps: 30,
    duration_s: 30,
    samples: 900,
    effective_fps: 29.94,
    jitter_ms: 2.1,
    dropped_samples: 0,
    torch_enabled: true,
    facing_mode: 'environment',
    roi_width: 64,
    roi_height: 48,
  },
  pulse_rate: {
    count_based: 74,
    ppi_based: 76,
    amdf_based: 75,
    fused: 75,
    unit: 'bpm',
    peaks_detected: 37,
  },
  signal_quality: {
    sqa_flag: 0,
    label: 'Good',
    method_spread_bpm: 2,
    good_segments: 3,
    total_segments: 3,
  },
  rhythm: {
    ppi_method: 'Regular',
    amdf_method: 'Regular',
    segment_pulse_rates: [75, 74, 75],
    segment_quality: [0, 0, 0],
  },
  spo2: {
    value: 97.2,
    unit: '%',
    experimental: true,
    ratio_of_ratios: 0.7273,
    ac_red: 0.42,
    dc_red: 205.1,
    ac_blue: 0.11,
    dc_blue: 34.8,
    calibration: 'SpO2 = -1.1 * R + 98',
  },
  perfusion_index: { value: 0.2, unit: '%', experimental: true },
  respiratory_rate: { value: 15.4, unit: 'breaths/min', experimental: true },
  waveform: {
    rppg: Array.from({ length: 200 }, (_, i) => Math.sin(i / 4)),
    raw: Array.from({ length: 200 }, (_, i) => Math.sin(i / 9)),
    peak_indices: [10, 35, 60, 85],
    decimation: 1,
    fps: 30,
  },
  amdf: {
    curve: Array.from({ length: 120 }, (_, i) => -Math.cos(i / 6)),
    minima_indices: [24, 48],
  },
  pulse_intervals_s: [0.8, 0.81, 0.79, 0.8],
  notes: [],
};

/** The same measurement with every optional metric unavailable. */
export const MEASUREMENT_WITH_GAPS: Measurement = {
  ...MEASUREMENT,
  pulse_rate: { ...MEASUREMENT.pulse_rate, fused: null },
  signal_quality: {
    sqa_flag: 1,
    label: 'Bad',
    method_spread_bpm: 24,
    good_segments: 1,
    total_segments: 3,
  },
  spo2: null,
  perfusion_index: null,
  respiratory_rate: null,
  notes: ['Too few pulse peaks were detected to estimate a respiratory rate.'],
};
