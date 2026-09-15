import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Instructions } from './Instructions';
import { Landing } from './Landing';
import { renderApp } from '../test/render';

describe('Landing', () => {
  it('presents the product and a way to start', () => {
    renderApp(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/measure your vital signals/i);
    expect(screen.getByRole('link', { name: /start measurement/i })).toHaveAttribute(
      'href',
      '/instructions',
    );
  });

  it('only advertises metrics the pipeline produces', () => {
    renderApp(<Landing />);
    expect(screen.getByText('Pulse rate')).toBeInTheDocument();
    expect(screen.getByText('Respiratory rate')).toBeInTheDocument();
    expect(screen.getByText('SpO₂ estimate')).toBeInTheDocument();
    expect(screen.queryByText(/blood pressure/i)).not.toBeInTheDocument();
  });

  it('carries the research disclaimer', () => {
    renderApp(<Landing />);
    expect(screen.getByText(/not a\s+medical device/i)).toBeInTheDocument();
  });
});

describe('Instructions', () => {
  it('lists the measurement steps in order', () => {
    renderApp(<Instructions />, { route: '/instructions' });
    const steps = screen.getAllByRole('listitem');
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/place your fingertip flat over the rear camera/i)).toBeInTheDocument();
    expect(screen.getByText(/30 seconds/i)).toBeInTheDocument();
  });

  it('explains the manual flashlight fallback', () => {
    renderApp(<Instructions />, { route: '/instructions' });
    expect(screen.getByText(/switch your phone's flashlight on yourself/i)).toBeInTheDocument();
  });

  it('links on to the measurement screen', () => {
    renderApp(<Instructions />, { route: '/instructions' });
    expect(screen.getByRole('link', { name: /continue/i })).toHaveAttribute('href', '/measure');
  });
});
