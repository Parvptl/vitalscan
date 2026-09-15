import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Processing } from './Processing';
import { Results } from './Results';
import { MeasurementProvider } from '../state/MeasurementContext';
import { MEASUREMENT } from '../test/fixtures';
import type { FrameSignals } from '../types/measurement';

const SIGNALS: FrameSignals = {
  timestamps: [0, 0.033, 0.066],
  gray: [100, 101, 100],
  red: [200, 201, 200],
  green: [50, 51, 50],
  blue: [30, 31, 30],
};

function renderProcessing() {
  return render(
    <MemoryRouter initialEntries={['/processing']}>
      <MeasurementProvider initial={{ pending: { signals: SIGNALS, meta: {} } }}>
        <Routes>
          <Route path="/processing" element={<Processing />} />
          <Route path="/results" element={<Results />} />
          <Route path="/" element={<p>Landing</p>} />
          <Route path="/measure" element={<p>Measure screen</p>} />
        </Routes>
      </MeasurementProvider>
    </MemoryRouter>,
  );
}

describe('Processing', () => {
  it('shows the analysis stages while waiting', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderProcessing();
    expect(screen.getByText(/analysing your measurement/i)).toBeInTheDocument();
    expect(screen.getByText('Signal extracted')).toBeInTheDocument();
    expect(screen.getByText('Pulse peaks detected')).toBeInTheDocument();
  });

  it('marks no stage complete before the response arrives', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderProcessing();
    expect(screen.queryAllByText('complete')).toHaveLength(0);
  });

  it('completes the stages from the real response and moves to the results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => MEASUREMENT } as Response),
    );
    renderProcessing();

    await waitFor(() => {
      expect(screen.getAllByText('complete').length).toBe(5);
    });
    await waitFor(() => expect(screen.getByText('Pulse rate')).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('shows an honest failure when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderProcessing();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/unable to process measurement/i)).toBeInTheDocument();
    expect(screen.queryByText(/bpm/i)).not.toBeInTheDocument();
  });

  it('offers to measure again after a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderProcessing();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again|measure again/i })).toBeInTheDocument();
  });

  it('does not report a server error as a successful measurement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'boom' }),
      } as Response),
    );
    renderProcessing();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/analysis failed/i)).toBeInTheDocument();
  });
});
