/**
 * Finger-placement detection.
 *
 * IMPORTANT: this is a PRECONDITION check, not a measurement. It decides only
 * whether the camera is currently receiving a signal worth recording, using
 * statistics measured from the actual camera frames. It never produces a
 * physiological value, and it does not claim certainty about what is in front
 * of the lens - a covered, torch-lit fingertip simply has a characteristic
 * optical signature (bright, very red, spatially uniform) that an uncovered
 * lens does not.
 *
 * All thresholds below are placement heuristics, tuned for a torch-lit rear
 * camera. They are deliberately gathered here so they are easy to inspect and
 * adjust; none of them feed the notebook pipeline.
 */

import type { PlacementState } from '../types/measurement';
import type { FrameStats } from './frameStats';

/** Minimum mean red level - below this the lens is uncovered or unlit. */
export const MIN_RED = 35;
/** Above this (with most pixels clipped) the sensor is blown out. */
export const MAX_SATURATED_FRACTION = 0.9;
/** Red share of total intensity. A torch-lit fingertip transmits mostly red. */
export const MIN_REDNESS = 0.45;
/** Spatial uniformity: red std-dev as a share of mean red. A covered lens is
 * close to flat; a scene has structure. */
export const MAX_RELATIVE_SPATIAL_STD = 0.32;
/** Frame-to-frame mean-intensity jump, in intensity units, that indicates the
 * finger moved rather than pulsed. */
export const MAX_FRAME_JUMP = 6.0;
/** Minimum AC/DC pulsatility (%) in the cardiac band for a usable signal. */
export const MIN_PERFUSION_PCT = 0.06;
/** Minimum share of in-window power that sits inside the cardiac band. */
export const MIN_BAND_POWER_RATIO = 0.25;
/** Seconds of continuous good placement before the capture may start. */
export const READY_HOLD_SECONDS = 1.5;
/** Seconds of history needed before a placement verdict is meaningful. */
export const DETECTING_SECONDS = 1.0;

export interface PlacementInput {
  stats: FrameStats;
  /** Absolute change in mean gray vs the previous frame. */
  frameJump: number;
  /** Seconds of continuously covered frames so far. */
  coveredForS: number;
  /** Latest cardiac-band analysis from the worker, if any yet. */
  quality: { perfusionPct: number; bandPowerRatio: number } | null;
  /** Seconds the state has continuously been SIGNAL_GOOD. */
  goodForS: number;
}

export interface PlacementVerdict {
  state: PlacementState;
  /** Short, user-facing instruction for the current state. */
  hint: string;
  /** True when a 30-second capture may begin. */
  canStart: boolean;
}

export function isCovered(stats: FrameStats): boolean {
  const total = stats.red + stats.green + stats.blue;
  if (total <= 0) return false;
  const redness = stats.red / total;
  const relativeStd = stats.red > 0 ? stats.redStdDev / stats.red : 1;
  return (
    stats.red >= MIN_RED &&
    stats.saturatedFraction <= MAX_SATURATED_FRACTION &&
    redness >= MIN_REDNESS &&
    relativeStd <= MAX_RELATIVE_SPATIAL_STD
  );
}

const HINTS: Record<PlacementState, string> = {
  NO_FINGER: 'Cover the rear camera and flash completely with your fingertip.',
  DETECTING: 'Hold still while we check the signal.',
  FINGER_DETECTED: 'Finger detected. Looking for your pulse.',
  SIGNAL_WEAK: 'Signal is weak. Rest your finger gently - do not press hard.',
  TOO_MUCH_MOVEMENT: 'Too much movement. Keep your hand and finger still.',
  SIGNAL_GOOD: 'Good signal. Hold steady.',
  READY: 'Ready to measure.',
};

export function classifyPlacement(input: PlacementInput): PlacementVerdict {
  const { stats, frameJump, coveredForS, quality, goodForS } = input;

  if (!isCovered(stats)) {
    return { state: 'NO_FINGER', hint: HINTS.NO_FINGER, canStart: false };
  }
  if (frameJump > MAX_FRAME_JUMP) {
    return { state: 'TOO_MUCH_MOVEMENT', hint: HINTS.TOO_MUCH_MOVEMENT, canStart: false };
  }
  if (coveredForS < DETECTING_SECONDS) {
    return { state: 'DETECTING', hint: HINTS.DETECTING, canStart: false };
  }
  if (!quality) {
    return { state: 'FINGER_DETECTED', hint: HINTS.FINGER_DETECTED, canStart: false };
  }
  if (
    quality.perfusionPct < MIN_PERFUSION_PCT ||
    quality.bandPowerRatio < MIN_BAND_POWER_RATIO
  ) {
    return { state: 'SIGNAL_WEAK', hint: HINTS.SIGNAL_WEAK, canStart: false };
  }
  if (goodForS >= READY_HOLD_SECONDS) {
    return { state: 'READY', hint: HINTS.READY, canStart: true };
  }
  return { state: 'SIGNAL_GOOD', hint: HINTS.SIGNAL_GOOD, canStart: false };
}

/** Coarse live-quality label shown during capture. Distinct from the backend's
 * siv_SQA verdict, which is the one reported with the results. */
export type LiveQuality = 'GOOD' | 'FAIR' | 'POOR';

export function liveQuality(
  quality: { perfusionPct: number; bandPowerRatio: number } | null,
  moving: boolean,
): LiveQuality {
  if (!quality || moving) return 'POOR';
  if (quality.perfusionPct >= MIN_PERFUSION_PCT * 2 && quality.bandPowerRatio >= 0.45) {
    return 'GOOD';
  }
  if (quality.perfusionPct >= MIN_PERFUSION_PCT && quality.bandPowerRatio >= MIN_BAND_POWER_RATIO) {
    return 'FAIR';
  }
  return 'POOR';
}
