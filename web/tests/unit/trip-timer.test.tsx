import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TripTimer } from '@/shared/ui/TripTimer';
import type { Ride } from '@/shared/api/types';

function ride(over: Partial<Ride>): Ride {
  return { status: 'arrived', arrived_at: null, started_at: null, planned_duration_s: 900, ...over } as Ride;
}

describe('TripTimer', () => {
  it("affiche l'attente et le temps gratuit restant", () => {
    const arrived = new Date(Date.now() - 65_000).toISOString();
    render(<TripTimer ride={ride({ status: 'arrived', arrived_at: arrived })} freeWaitingSeconds={180} />);
    expect(screen.getByRole('timer').textContent).toMatch(/Attente : 1:0[4-6]/);
    expect(screen.getByRole('timer').textContent).toMatch(/gratuit encore 1:5[4-6]/);
  });

  it("signale l'attente facturée au-delà du temps gratuit", () => {
    const arrived = new Date(Date.now() - 400_000).toISOString();
    render(<TripTimer ride={ride({ status: 'arrived', arrived_at: arrived })} freeWaitingSeconds={180} />);
    expect(screen.getByRole('timer').textContent).toMatch(/facturé/);
  });

  it('affiche la durée écoulée et le temps restant estimé en course', () => {
    const started = new Date(Date.now() - 120_000).toISOString();
    render(
      <TripTimer ride={ride({ status: 'in_progress', started_at: started, planned_duration_s: 900 })} />,
    );
    expect(screen.getByRole('timer').textContent).toMatch(/En course depuis 2:0/);
    expect(screen.getByRole('timer').textContent).toMatch(/arrivée estimée dans 13 min/);
  });

  it("n'affiche rien hors attente et course", () => {
    const { container } = render(<TripTimer ride={ride({ status: 'accepted' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
