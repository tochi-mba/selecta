import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Area A (product audit): a deep link opened signed out comes back after sign-in AND after
// sign-up. Sign-up used to start with no state, so a new customer landed on the home page.

const auth = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn() }));
vi.mock('@workos-inc/authkit-react', () => ({
  LoginRequiredError: class extends Error {},
  useAuth: () => ({ isLoading: false, user: null, getAccessToken: async () => 'token', signIn: auth.signIn, signUp: auth.signUp, signOut: vi.fn() }),
}));

const { CloudApp } = await import('./CloudApp');

describe('a deep link opened signed out', () => {
  it('is carried through sign-up as well as sign-in', async () => {
    window.history.replaceState({}, '', '/account/billing?checkout=cancelled');
    render(<CloudApp />);
    const buttons = await screen.findAllByRole('button');
    const signUp = buttons.find((button) => /create|sign up|get started/i.test(button.textContent ?? ''));
    expect(signUp, 'the welcome page offers sign-up').toBeTruthy();
    await userEvent.click(signUp!);
    expect(auth.signUp).toHaveBeenCalledWith({ state: { returnTo: '/account/billing?checkout=cancelled' } });
  });
});
