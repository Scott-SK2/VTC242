import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

/** État vide : icône, message et action facultative (ex. « Commander une course »). */
export function Empty({
  text,
  icon = 'sparkle',
  action,
}: {
  text?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="py-10 flex flex-col items-center text-center gap-3">
      <span className="h-14 w-14 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center">
        <Icon name={icon} size={26} />
      </span>
      <p className="text-gray-600 max-w-xs">{text ?? t('common.empty')}</p>
      {action}
    </div>
  );
}
