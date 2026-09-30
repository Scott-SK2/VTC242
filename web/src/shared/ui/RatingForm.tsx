import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Stars } from './Stars';
import { Button } from './Button';
import { TextAreaField } from './Field';
import { ridesApi } from '@/shared/api/endpoints';
import { toast } from '@/shared/store/ui';
import { errorMessage } from './ErrorBox';

export function RatingForm({
  rideId,
  title,
  onDone,
}: {
  rideId: string;
  title: string;
  onDone: (score: number, comment: string) => void;
}) {
  const { t } = useTranslation();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit() {
    if (!score) return;
    setLoading(true);
    try {
      await ridesApi.rate(rideId, score, comment.trim() || undefined);
      toast(t('passenger.done.rated'), 'success');
      onDone(score, comment);
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div>
      <h3 className="font-extrabold mb-2">{title}</h3>
      <Stars value={score} onChange={setScore} />
      <div className="mt-3">
        <TextAreaField
          label={t('passenger.done.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
        />
      </div>
      <Button block loading={loading} disabled={!score} onClick={() => void submit()}>
        {t('rating.submit')}
      </Button>
    </div>
  );
}
