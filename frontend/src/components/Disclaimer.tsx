import { ShieldIcon } from './Icons';

/** The standing research-prototype disclaimer, shown wherever results appear. */
export function Disclaimer() {
  return (
    <p className="vs-disclaimer">
      VitalScan provides experimental estimates for research and internship purposes. It is not a
      medical device and must not be used for diagnosis or treatment decisions. SpO₂, perfusion
      index and respiratory rate are research-grade estimates derived from a standard RGB camera,
      not from a clinically calibrated pulse oximeter.
    </p>
  );
}

/** Short privacy note for the camera stages. */
export function PrivacyNote() {
  return (
    <p className="vs-fine" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <ShieldIcon size={16} />
      <span>
        Your camera feed stays on this device. Only the per-frame brightness and colour numbers
        needed for the analysis are sent to the server, they are processed in memory and never
        stored.
      </span>
    </p>
  );
}
