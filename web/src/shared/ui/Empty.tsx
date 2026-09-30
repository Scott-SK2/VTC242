import { useTranslation } from 'react-i18next';

export function Empty({ text }: { text?: string }) {
  const { t } = useTranslation();
  return <p className="py-10 text-center text-gray-500">{text ?? t('common.empty')}</p>;
}
