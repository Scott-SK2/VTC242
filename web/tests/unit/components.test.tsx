import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/shared/ui/Button';
import { Money } from '@/shared/ui/Money';
import { Stars } from '@/shared/ui/Stars';
import { OfferScreen } from '@/features/driver/components/OfferScreen';

describe('composants', () => {
  it('Button : hauteur tactile ≥ 48 px et état de chargement', () => {
    render(<Button loading>Commander</Button>);
    const btn = screen.getByRole('button', { name: /Commander/ });
    expect(btn.className).toContain('btn-primary');
    // La hauteur tactile (N-01) est portée par la classe composant .btn dans styles.css
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css).toMatch(/\.btn\s*\{[^}]*min-h-tap/);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('Money affiche le format XAF', () => {
    render(<Money value="12500.00" />);
    expect(screen.getByText('12 500 F')).toBeInTheDocument(); // espace insécable normalisée par Testing Library
  });

  it('Stars permet de noter de 1 à 5', async () => {
    const onChange = vi.fn();
    render(<Stars value={0} onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: '4 étoile(s)' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('OfferScreen affiche la prise en charge, le gain et le compte à rebours', () => {
    const offer = {
      ride_id: 'r1',
      category: 'taxi' as const,
      estimated_earning: '1500.00',
      expires_at: new Date(Date.now() + 15000).toISOString(),
      pickup: { address: 'Marché Total', lat: -4.28, lng: 15.26, distance_m: 850 },
      dropoff: { address: 'Aéroport Maya-Maya', lat: -4.25, lng: 15.25 },
    };
    render(
      <OfferScreen offer={offer} busy={false} onAccept={() => {}} onDecline={() => {}} onExpire={() => {}} />,
    );
    expect(screen.getByText('Marché Total')).toBeInTheDocument();
    expect(screen.getByText('1 500 F')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accepter' })).toBeInTheDocument();
  });
});
