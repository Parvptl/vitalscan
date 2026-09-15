import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MeasurementProvider, type PendingCapture } from '../state/MeasurementContext';
import type { Measurement } from '../types/measurement';

interface RenderOptions {
  route?: string;
  result?: Measurement | null;
  pending?: PendingCapture | null;
}

/** Renders a screen with the in-memory store seeded to a given state. */
export function renderApp(
  ui: ReactElement,
  { route = '/', result = null, pending = null }: RenderOptions = {},
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <MeasurementProvider initial={{ result, pending }}>{ui}</MeasurementProvider>
    </MemoryRouter>,
  );
}
