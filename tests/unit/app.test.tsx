import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { resolveConfig } from '../../src/config';
import { createDemoApi } from '../../src/demo/demoApi';
import { createDemoGeo } from '../../src/geo/demoGeo';

vi.mock('../../src/components/MapView', () => ({ default: () => <div data-testid="map" /> }));

function renderApp(path = '/') {
  window.location.hash = `#${path}`;
  const services = { config: resolveConfig({ VITE_DATA_MODE: 'demo' }), api: createDemoApi(), geo: createDemoGeo() };
  return { services, ...render(<App services={services} />) };
}

describe('app (demo mode)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('labels demo mode clearly', async () => {
    renderApp();
    expect(screen.getByRole('note')).toHaveTextContent(/Demo mode/);
    expect(screen.getByRole('note')).toHaveTextContent(/Nothing is shared/);
  });

  it('manual search works without ever requesting geolocation', async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    renderApp();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'Temple{Enter}');
    await waitFor(() => expect(screen.getByText(/straight-line distance from Temple, TX/)).toBeInTheDocument());
    const first = within(screen.getAllByRole('article')[0]);
    expect(first.getByText('Pecan Grove Gas & Go')).toBeInTheDocument();
    expect(first.getByText(/mi straight-line/)).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    // Browsing never creates a browser identity.
    expect(localStorage.length).toBe(0);
  });

  it('shows "No crowd ratings yet" rather than a zero score', async () => {
    renderApp('/stop/d0000000-0000-4000-8000-000000000006');
    expect(await screen.findByRole('heading', { name: 'Red Oak Rest Stop' })).toBeInTheDocument();
    expect(screen.getByText('No crowd ratings yet')).toBeInTheDocument();
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  });

  it('shows original, agreement and crowd separately with counts', async () => {
    renderApp('/stop/d0000000-0000-4000-8000-000000000001');
    await screen.findByRole('heading', { name: 'Lone Star Travel Stop' });
    expect(screen.getByText('4.6')).toBeInTheDocument();
    expect(screen.getByText('18 crowd ratings')).toBeInTheDocument();
    expect(screen.getByText('21 agree')).toBeInTheDocument();
    expect(screen.getByText('3 disagree')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Was the original 5-plop rating fair/ })).toBeInTheDocument();
  });

  it('agreement votes toggle and leave the crowd score unchanged', async () => {
    renderApp('/stop/d0000000-0000-4000-8000-000000000001');
    const user = userEvent.setup();
    await screen.findByText('21 agree');
    await user.click(screen.getByRole('button', { name: /Agree/ }));
    expect(await screen.findByText('22 agree')).toBeInTheDocument();
    expect(screen.getByText('4.6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agree/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^Agree/ }));
    expect(await screen.findByText('21 agree')).toBeInTheDocument();
    expect(screen.getAllByText(/Demo only: vote kept in this tab/).length).toBeGreaterThan(0);
  });

  it('submits a rating, renders comments as plain text, and offers editing', async () => {
    renderApp('/stop/d0000000-0000-4000-8000-000000000006/rate');
    const user = userEvent.setup();
    await screen.findByText(/Rate/);
    await user.click(screen.getByRole('button', { name: /Submit rating/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Choose an overall rating/);
    await user.click(screen.getByRole('radio', { name: /^3 plops/ }));
    await user.type(screen.getByLabelText(/next traveler/), '<img src=x onerror=alert(1)> clean enough');
    await user.click(screen.getByRole('button', { name: /Submit 3 plops/ }));
    expect(await screen.findByRole('heading', { name: 'Red Oak Rest Stop' })).toBeInTheDocument();
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)> clean enough/)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(/^1 crowd rating · Early read/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Edit your rating/ })).toBeInTheDocument();
  });

  it('route mode labels sample geometry honestly and never shows added time', async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Along a route' }));
    const [from, to] = screen.getAllByRole('searchbox');
    await user.type(from, 'Dallas{Enter}');
    await user.type(to, 'Austin{Enter}');
    await user.click(screen.getByRole('button', { name: /Find stops/ }));
    expect(await screen.findByText(/Sample route \(demo\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/ahead along sample line/).length).toBeGreaterThan(3);
    expect(screen.queryByText(/Adds \d+ min/)).not.toBeInTheDocument();
    expect(screen.queryByText('Bosque Bend Gas')).not.toBeInTheDocument(); // ~13 km off the route
    expect(screen.getByRole('button', { name: 'Under 10 min extra' })).toBeDisabled();
  });
});
