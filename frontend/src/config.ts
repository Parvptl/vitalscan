/** Client-side configuration. Values come from the environment, never hard-coded URLs. */

export const MEASUREMENT_SECONDS = Number(import.meta.env.VITE_MEASUREMENT_SECONDS ?? 30);

/** Seconds of live signal shown in the waveform. */
export const WAVEFORM_WINDOW_SECONDS = 6;
