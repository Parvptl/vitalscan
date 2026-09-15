import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Disclaimer } from '../components/Disclaimer';
import { SignalPlot } from '../components/SignalPlot';
import { StatusPill } from '../components/StatusPill';
import { useMeasurementStore } from '../state/MeasurementContext';

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <tr data-emphasis={emphasis}>
      <td>{label}</td>
      <td>{value}</td>
    </tr>
  );
}

export function ResultsDetails() {
  const navigate = useNavigate();
  const { result } = useMeasurementStore();

  useEffect(() => {
    if (!result) navigate('/', { replace: true });
  }, [navigate, result]);

  const intervalStats = useMemo(() => {
    if (!result || result.pulse_intervals_s.length === 0) return null;
    const values = result.pulse_intervals_s;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    return {
      count: values.length,
      mean,
      sd,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [result]);

  if (!result) return null;

  const { pulse_rate, signal_quality, rhythm, spo2, perfusion_index, respiratory_rate, capture } =
    result;

  return (
    <div className="vs-page vs-page--wide">
      <section className="vs-stack vs-stack--tight vs-reveal">
        <p className="vs-eyebrow">Detailed analysis</p>
        <h1 className="vs-title" style={{ fontSize: 'var(--vs-text-2xl)' }}>
          Under the hood
        </h1>
        <p className="vs-body">
          Every number below comes from the rPPG pipeline in the project's reference notebook,
          applied to the signal captured by your camera.
        </p>
      </section>

      <div className="vs-split">
        <section className="vs-card vs-card--lg vs-stack">
          <h2 className="vs-eyebrow">rPPG signal &amp; detected peaks</h2>
          <SignalPlot
            series={result.waveform.rppg}
            markers={result.waveform.peak_indices}
            label="Preprocessed rPPG signal with detected systolic peaks"
            xLabel={`Frame (×${result.waveform.decimation} decimation, ${capture.fps} fps)`}
          />
          <h2 className="vs-eyebrow" style={{ marginTop: 8 }}>
            Normalised raw intensity
          </h2>
          <SignalPlot
            series={result.waveform.raw}
            label="Detrended and normalised frame-intensity signal before high-pass filtering"
            xLabel="Frame"
            height={100}
          />
        </section>

        <section className="vs-card vs-card--lg vs-stack">
          <h2 className="vs-eyebrow">Pulse rate by method</h2>
          <table className="vs-table">
            <caption className="vs-visually-hidden">Pulse-rate estimates by method</caption>
            <tbody>
              <Row label="Count-based" value={`${pulse_rate.count_based} bpm`} />
              <Row label="PPI-based" value={`${pulse_rate.ppi_based} bpm`} />
              <Row label="AMDF-based" value={`${pulse_rate.amdf_based} bpm`} />
              <Row
                label="Fused"
                value={pulse_rate.fused !== null ? `${pulse_rate.fused} bpm` : 'Inconclusive'}
                emphasis
              />
            </tbody>
          </table>

          <h2 className="vs-eyebrow" style={{ marginTop: 8 }}>
            AMDF (normalised)
          </h2>
          <SignalPlot
            series={result.amdf.curve}
            markers={result.amdf.minima_indices}
            label="Average Magnitude Difference Function; the first minimum gives the pulse period"
            xLabel="Lag (samples)"
            markerLabel="Detected minima"
            height={110}
          />
        </section>
      </div>

      <div className="vs-split">
        <section className="vs-card vs-card--lg vs-stack">
          <h2 className="vs-eyebrow">Signal quality assessment</h2>
          <div>
            <StatusPill
              tone={signal_quality.label === 'Good' ? 'good' : 'bad'}
              label={signal_quality.label.toUpperCase()}
            />
          </div>
          <table className="vs-table">
            <tbody>
              <Row label="SQA flag (0 = good, 1 = bad)" value={String(signal_quality.sqa_flag)} />
              <Row
                label="Good 10-second segments"
                value={`${signal_quality.good_segments} / ${signal_quality.total_segments}`}
              />
              <Row label="Spread across methods" value={`${signal_quality.method_spread_bpm} bpm`} />
              <Row label="Peaks detected" value={String(pulse_rate.peaks_detected)} />
            </tbody>
          </table>
        </section>

        <section className="vs-card vs-card--lg vs-stack">
          <h2 className="vs-eyebrow">Rhythm regularity</h2>
          <table className="vs-table">
            <tbody>
              <Row label="Pulse-interval variability" value={rhythm.ppi_method} />
              <Row label="Per-segment AMDF check" value={rhythm.amdf_method} />
            </tbody>
          </table>
          <h3 className="vs-eyebrow" style={{ marginTop: 8 }}>
            Per-segment pulse rate
          </h3>
          <table className="vs-table">
            <thead>
              <tr>
                <th scope="col">10s segment</th>
                <th scope="col">Pulse rate / quality</th>
              </tr>
            </thead>
            <tbody>
              {rhythm.segment_pulse_rates.map((value, index) => (
                <tr key={index}>
                  <td>Segment {index + 1}</td>
                  <td>
                    {value} bpm · {rhythm.segment_quality[index] === 0 ? 'good' : 'bad'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="vs-split">
        <section className="vs-card vs-card--lg vs-stack">
          <h2 className="vs-eyebrow">
            SpO₂ &amp; perfusion index <span className="vs-tag">Experimental</span>
          </h2>
          {spo2 ? (
            <table className="vs-table">
              <tbody>
                <Row label="SpO₂" value={`${spo2.value.toFixed(1)} %`} emphasis />
                <Row label="Ratio of ratios (R)" value={spo2.ratio_of_ratios.toFixed(4)} />
                <Row label="Red AC / DC" value={`${spo2.ac_red.toFixed(4)} / ${spo2.dc_red.toFixed(2)}`} />
                <Row label="Blue AC / DC" value={`${spo2.ac_blue.toFixed(4)} / ${spo2.dc_blue.toFixed(2)}`} />
                <Row label="Calibration" value={spo2.calibration} />
                <Row
                  label="Perfusion index"
                  value={perfusion_index ? `${perfusion_index.value.toFixed(2)} %` : 'Not available'}
                />
              </tbody>
            </table>
          ) : (
            <p className="vs-body">Not available for this measurement.</p>
          )}
          <p className="vs-fine">
            Derived from a standard RGB camera using generic calibration constants, not a
            clinically calibrated red/infrared oximeter. Research-use estimate only.
          </p>
        </section>

        <section className="vs-card vs-card--lg vs-stack">
          <h2 className="vs-eyebrow">
            Respiratory rate <span className="vs-tag">Experimental</span>
          </h2>
          {respiratory_rate ? (
            <table className="vs-table">
              <tbody>
                <Row
                  label="Respiratory rate"
                  value={`${respiratory_rate.value.toFixed(1)} breaths/min`}
                  emphasis
                />
                <Row label="Method" value="Pulse-amplitude modulation, 0.15–0.7 Hz" />
              </tbody>
            </table>
          ) : (
            <p className="vs-body">Not available for this measurement.</p>
          )}

          <h3 className="vs-eyebrow" style={{ marginTop: 8 }}>
            Pulse intervals
          </h3>
          {intervalStats ? (
            <table className="vs-table">
              <tbody>
                <Row label="Intervals" value={String(intervalStats.count)} />
                <Row label="Mean" value={`${intervalStats.mean.toFixed(3)} s`} />
                <Row label="Std. deviation" value={`${intervalStats.sd.toFixed(3)} s`} />
                <Row
                  label="Range"
                  value={`${intervalStats.min.toFixed(3)} – ${intervalStats.max.toFixed(3)} s`}
                />
              </tbody>
            </table>
          ) : (
            <p className="vs-body">No pulse intervals were available.</p>
          )}
        </section>
      </div>

      <section className="vs-card vs-stack">
        <h2 className="vs-eyebrow">Capture</h2>
        <table className="vs-table">
          <tbody>
            <Row label="Duration analysed" value={`${capture.duration_s} s`} />
            <Row label="Frame rate used" value={`${capture.fps} fps`} />
            {capture.effective_fps != null && (
              <Row label="Measured camera rate" value={`${capture.effective_fps.toFixed(2)} fps`} />
            )}
            {capture.jitter_ms != null && (
              <Row label="Frame-interval jitter" value={`${capture.jitter_ms.toFixed(1)} ms`} />
            )}
            <Row label="Samples" value={String(capture.samples)} />
            {capture.roi_width != null && capture.roi_height != null && (
              <Row label="Analysis resolution" value={`${capture.roi_width}×${capture.roi_height}`} />
            )}
            {capture.torch_enabled != null && (
              <Row label="Torch" value={capture.torch_enabled ? 'On' : 'Off / unavailable'} />
            )}
          </tbody>
        </table>
      </section>

      <div className="vs-stack">
        <Link to="/results" className="vs-btn vs-btn--secondary vs-btn--block">
          Back to results
        </Link>
      </div>

      <Disclaimer />
    </div>
  );
}
