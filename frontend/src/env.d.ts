/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
  readonly VITE_MEASUREMENT_SECONDS?: string;
  /** 'local' runs the pipeline on-device (Android build); 'remote' calls the API. */
  readonly VITE_PROCESSING_MODE?: 'local' | 'remote';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * `torch` is part of the Image Capture spec and is implemented by Chromium on
 * Android, but it is not in the baseline TypeScript DOM lib. Declaring it here
 * keeps the call sites type-safe without casting away the whole constraint
 * object. Support is still checked at runtime - see `trackSupportsTorch`.
 */
interface MediaTrackConstraintSet {
  torch?: ConstrainBoolean;
}

interface MediaTrackCapabilities {
  torch?: boolean;
}

interface MediaTrackSettings {
  torch?: boolean;
}
