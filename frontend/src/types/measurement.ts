/**
 * Response/domain types for VitalScan.
 *
 * These mirror the backend Pydantic models in `backend/app/models/schemas.py`,
 * which in turn expose exactly the outputs of
 * `reference/Finger_Pulse_rPPG_Analysis_New.ipynb`.
 *
 * Metrics the pipeline could not produce are `null` - never a placeholder
 * number. Consumers must render "Not available" for those.
 */

export interface CaptureInfo {
  fps: number;
  duration_s: number;
  samples: number;
  effective_fps?: number | null;
  jitter_ms?: number | null;
  dropped_samples?: number | null;
  torch_enabled?: boolean | null;
  facing_mode?: string | null;
  frame_width?: number | null;
  frame_height?: number | null;
  roi_width?: number | null;
  roi_height?: number | null;
}

/** All four notebook pulse-rate outputs. `fused` is null when the notebook's
 * fusion rule is inconclusive. */
export interface PulseRateResult {
  count_based: number;
  ppi_based: number;
  amdf_based: number;
  fused: number | null;
  unit: 'bpm';
  peaks_detected: number;
}

export interface SignalQualityResult {
  /** siv_SQA verdict: 0 = good, 1 = bad. */
  sqa_flag: number;
  label: 'Good' | 'Bad';
  method_spread_bpm: number;
  good_segments: number;
  total_segments: number;
}

export interface RhythmResult {
  ppi_method: 'Regular' | 'Irregular';
  amdf_method: 'Regular' | 'Irregular';
  segment_pulse_rates: number[];
  segment_quality: number[];
}

export interface SpO2Result {
  value: number;
  unit: '%';
  experimental: true;
  ratio_of_ratios: number;
  ac_red: number;
  dc_red: number;
  ac_blue: number;
  dc_blue: number;
  calibration: string;
}

export interface PerfusionIndexResult {
  value: number;
  unit: '%';
  experimental: true;
}

export interface RespiratoryRateResult {
  value: number;
  unit: 'breaths/min';
  experimental: true;
}

export interface WaveformPayload {
  rppg: number[];
  raw: number[];
  peak_indices: number[];
  decimation: number;
  fps: number;
}

export interface AmdfPayload {
  curve: number[];
  minima_indices: number[];
}

export interface Measurement {
  status: 'success';
  source: 'frame-signals' | 'video';
  capture: CaptureInfo;
  pulse_rate: PulseRateResult;
  signal_quality: SignalQualityResult;
  rhythm: RhythmResult;
  spo2: SpO2Result | null;
  perfusion_index: PerfusionIndexResult | null;
  respiratory_rate: RespiratoryRateResult | null;
  waveform: WaveformPayload;
  amdf: AmdfPayload;
  pulse_intervals_s: number[];
  notes: string[];
}

export interface ServerConfig {
  measurement_seconds: number;
  min_analysis_seconds: number;
  max_samples: number;
  metrics: string[];
}

/** Per-frame optical signals extracted in the browser (notebook cell 9). */
export interface FrameSignals {
  timestamps: number[];
  gray: number[];
  red: number[];
  green: number[];
  blue: number[];
}

export interface CaptureMeta {
  torch_enabled?: boolean;
  facing_mode?: string;
  frame_width?: number;
  frame_height?: number;
  roi_width?: number;
  roi_height?: number;
}

/** Finger-placement / precondition states (measured from real frame statistics). */
export type PlacementState =
  | 'NO_FINGER'
  | 'DETECTING'
  | 'FINGER_DETECTED'
  | 'SIGNAL_WEAK'
  | 'TOO_MUCH_MOVEMENT'
  | 'SIGNAL_GOOD'
  | 'READY';

export type MeasurementPhase =
  | 'CAMERA_PERMISSION'
  | 'CAMERA_READY'
  | 'FINGER_PLACEMENT'
  | 'SIGNAL_CHECK'
  | 'COUNTDOWN'
  | 'MEASURING'
  | 'PROCESSING'
  | 'ERROR';

export type AppErrorCode =
  | 'CAMERA_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'CAMERA_UNAVAILABLE'
  | 'FINGER_LOST'
  | 'SIGNAL_TOO_WEAK'
  | 'TOO_MUCH_MOVEMENT'
  | 'INTERRUPTED'
  | 'PAYLOAD_REJECTED'
  | 'PROCESSING_FAILED'
  | 'BACKEND_UNAVAILABLE'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE';

export interface AppError {
  code: AppErrorCode;
  title: string;
  message: string;
  /** Label for the primary recovery action. */
  action: string;
}
