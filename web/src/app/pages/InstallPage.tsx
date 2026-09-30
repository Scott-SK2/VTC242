import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useUiStore } from '@/shared/store/ui';
import { isIos, isStandalone, markInstallPromptShown } from '@/pwa';

/** Écran d'installation PWA (F-N-03) : proposé après la première course terminée. */
export function InstallPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const prompt = useUiStore((s) => s.installPromptEvent);
  const setPrompt = useUiStore((s) => s.setInstallPrompt);

  async function install() {
    markInstallPromptShown();
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
    }
    nav(-1);
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 h-20 w-20 rounded-3xl bg-brand text-white flex items-center justify-center text-3xl font-extrabold">
          242
        </div>
        <h1 className="text-2xl font-extrabold mb-2">{t('pwa.installTitle')}</h1>
        <p className="text-gray-600 mb-6">{isStandalone() ? t('pwa.installed') : t('pwa.installBody')}</p>
        {isIos() && !prompt && <p className="mb-4 rounded-xl bg-gray-100 p-3 text-sm">{t('pwa.iosHint')}</p>}
        {prompt && (
          <Button block onClick={() => void install()} className="mb-2">
            {t('pwa.install')}
          </Button>
        )}
        <Button
          variant="secondary"
          block
          onClick={() => {
            markInstallPromptShown();
            nav(-1);
          }}
        >
          {t('pwa.later')}
        </Button>
      </div>
    </div>
  );
}
