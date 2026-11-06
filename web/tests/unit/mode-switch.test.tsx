import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModeSwitch } from '@/shared/ui/ModeSwitch';
import { useAuthStore } from '@/shared/store/auth';
import type { User } from '@/shared/api/types';

function renderWith(user: Partial<User>) {
  useAuthStore
    .getState()
    .setUser({ id: 'u1', phone_number: '+242069000001', first_name: 'Ana', ...user } as User);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ModeSwitch />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ModeSwitch (double profil)', () => {
  it('affiche le mode actuel et demande confirmation avant de devenir chauffeur', async () => {
    renderWith({ role: 'passenger', has_driver_profile: false });
    expect(screen.getByRole('radio', { name: /Passager/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /Chauffeur/ }));
    expect(screen.getByText(/créer votre profil chauffeur/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Changer de mode' })).toBeInTheDocument();
  });

  it("n'est pas proposé au personnel du back-office", () => {
    const { container } = renderWith({ role: 'support' });
    expect(container).toBeEmptyDOMElement();
  });
});
