import { useApp } from './app/store';
import { OnboardingScreen } from './ui/screens/Onboarding';
import { UnlockScreen } from './ui/screens/Unlock';
import { VaultScreen } from './ui/screens/VaultScreen';

export function App() {
  const { phase } = useApp();

  switch (phase) {
    case 'loading':
      return (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Opening…
        </div>
      );

    case 'onboarding':
      return <OnboardingScreen />;

    case 'unlocked':
      return <VaultScreen />;

    case 'locked':
    default:
      // Anything unexpected lands on the lock screen. Failing closed means a
      // state we did not anticipate shows the vault locked, never open.
      return <UnlockScreen />;
  }
}
