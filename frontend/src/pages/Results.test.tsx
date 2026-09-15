import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Results } from './Results';
import { ResultsDetails } from './ResultsDetails';
import { MEASUREMENT, MEASUREMENT_WITH_GAPS } from '../test/fixtures';
import { renderApp } from '../test/render';

describe('Results', () => {
  it('shows the fused pulse rate as the headline metric', () => {
    renderApp(<Results />, { result: MEASUREMENT });
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText(/BPM/)).toBeInTheDocument();
    expect(screen.getByText('Pulse rate')).toBeInTheDocument();
  });

  it('renders every available metric with its unit', () => {
    renderApp(<Results />, { result: MEASUREMENT });
    expect(screen.getByText('97.2')).toBeInTheDocument();
    expect(screen.getByText('15.4')).toBeInTheDocument();
    expect(screen.getByText('0.20')).toBeInTheDocument();
    expect(screen.getByText('Regular')).toBeInTheDocument();
  });

  it('labels the experimental metrics', () => {
    renderApp(<Results />, { result: MEASUREMENT });
    expect(screen.getAllByText('Experimental').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the research disclaimer', () => {
    renderApp(<Results />, { result: MEASUREMENT });
    expect(screen.getByText(/not a\s+medical device/i)).toBeInTheDocument();
  });

  it('never shows a blood pressure metric', () => {
    renderApp(<Results />, { result: MEASUREMENT });
    expect(screen.queryByText(/blood pressure/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mmHg/i)).not.toBeInTheDocument();
  });

  it('renders unavailable metrics honestly instead of showing a zero', () => {
    renderApp(<Results />, { result: MEASUREMENT_WITH_GAPS });
    expect(screen.getAllByText('Not available')).toHaveLength(3);
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  });

  it('warns when the signal-quality assessment failed', () => {
    renderApp(<Results />, { result: MEASUREMENT_WITH_GAPS });
    expect(screen.getByText('BAD')).toBeInTheDocument();
    expect(screen.getByText(/may be unreliable/i)).toBeInTheDocument();
  });

  it('explains when pulse-rate fusion was inconclusive', () => {
    renderApp(<Results />, { result: MEASUREMENT_WITH_GAPS });
    expect(screen.getByText(/Fusion was inconclusive/i)).toBeInTheDocument();
    // Falls back to the AMDF estimate rather than inventing a number.
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('surfaces analysis notes returned by the backend', () => {
    renderApp(<Results />, { result: MEASUREMENT_WITH_GAPS });
    expect(screen.getByText('Notes from the analysis')).toBeInTheDocument();
    expect(
      screen.getByText('Too few pulse peaks were detected to estimate a respiratory rate.'),
    ).toBeInTheDocument();
  });
});

describe('ResultsDetails', () => {
  it('lists every pulse-rate method the notebook implements', () => {
    renderApp(<ResultsDetails />, { result: MEASUREMENT });
    expect(screen.getByText('Count-based')).toBeInTheDocument();
    expect(screen.getByText('PPI-based')).toBeInTheDocument();
    expect(screen.getByText('AMDF-based')).toBeInTheDocument();
    expect(screen.getByText('Fused')).toBeInTheDocument();
    expect(screen.getByText('74 bpm')).toBeInTheDocument();
  });

  it('shows the per-segment rhythm breakdown', () => {
    renderApp(<ResultsDetails />, { result: MEASUREMENT });
    expect(screen.getByText('Segment 1')).toBeInTheDocument();
    expect(screen.getByText('Segment 3')).toBeInTheDocument();
  });

  it('exposes the SpO2 calculation inputs', () => {
    renderApp(<ResultsDetails />, { result: MEASUREMENT });
    expect(screen.getByText('Ratio of ratios (R)')).toBeInTheDocument();
    expect(screen.getByText('SpO2 = -1.1 * R + 98')).toBeInTheDocument();
  });

  it('reports inconclusive fusion in the methods table', () => {
    renderApp(<ResultsDetails />, { result: MEASUREMENT_WITH_GAPS });
    expect(screen.getByText('Inconclusive')).toBeInTheDocument();
  });

  it('says a metric is unavailable rather than rendering an empty table', () => {
    renderApp(<ResultsDetails />, { result: MEASUREMENT_WITH_GAPS });
    expect(screen.getAllByText(/Not available for this measurement/i)).toHaveLength(2);
  });

  it('describes the captured signal', () => {
    renderApp(<ResultsDetails />, { result: MEASUREMENT });
    expect(screen.getByText('Duration analysed')).toBeInTheDocument();
    expect(screen.getByText('30 fps')).toBeInTheDocument();
  });
});
