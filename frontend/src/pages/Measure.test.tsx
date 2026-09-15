import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Measure } from './Measure';
import { renderApp } from '../test/render';

function stubMediaDevices(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

describe('Measure', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  it('asks for camera permission before starting', () => {
    stubMediaDevices(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    renderApp(<Measure />, { route: '/measure' });
    expect(screen.getByRole('heading', { name: /allow camera access/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /turn on camera/i })).toBeInTheDocument();
  });

  it('explains that nothing is recorded', () => {
    stubMediaDevices(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    renderApp(<Measure />, { route: '/measure' });
    expect(screen.getByText(/stays on this device/i)).toBeInTheDocument();
  });

  it('shows a recovery path when camera permission is denied', async () => {
    stubMediaDevices(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    renderApp(<Measure />, { route: '/measure' });

    await userEvent.click(screen.getByRole('button', { name: /turn on camera/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/camera permission needed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('reports a missing camera distinctly from a denied permission', async () => {
    stubMediaDevices(() => Promise.reject(new DOMException('none', 'NotFoundError')));
    renderApp(<Measure />, { route: '/measure' });

    await userEvent.click(screen.getByRole('button', { name: /turn on camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/no usable camera found/i)).toBeInTheDocument();
    });
  });

  it('refuses to start over an insecure connection', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, hostname: 'example.test' },
    });
    stubMediaDevices(() => Promise.reject(new Error('should not be called')));
    renderApp(<Measure />, { route: '/measure' });

    await userEvent.click(screen.getByRole('button', { name: /turn on camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/secure connection required/i)).toBeInTheDocument();
    });
  });

  it('reports an unsupported browser when getUserMedia is missing', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    renderApp(<Measure />, { route: '/measure' });

    await userEvent.click(screen.getByRole('button', { name: /turn on camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera not supported/i)).toBeInTheDocument();
    });
  });

  it('never claims a measurement succeeded when the camera failed', async () => {
    stubMediaDevices(() => Promise.reject(new DOMException('busy', 'NotReadableError')));
    renderApp(<Measure />, { route: '/measure' });

    await userEvent.click(screen.getByRole('button', { name: /turn on camera/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/bpm/i)).not.toBeInTheDocument();
  });

  it('shows the research disclaimer during the camera flow', () => {
    stubMediaDevices(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    renderApp(<Measure />, { route: '/measure' });
    expect(screen.getByText(/not a\s+medical device/i)).toBeInTheDocument();
  });

  it('does not call getUserMedia until the user asks for it', () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    stubMediaDevices(getUserMedia);
    renderApp(<Measure />, { route: '/measure' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
