import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from './ui';
import { PixelButton } from '../PixelButton';

export function UsageLimitsSection({ onSummary }: { onSummary: (s: string) => void }) {
  const { t } = useTranslation();

  const [limits, setLimits] = useState({ fiveHour: 500000, weekly: 5000000 });

  useEffect(() => {
    window.cth.getConfig().then((config) => {
       setLimits(config?.usageLimits?.default ?? { fiveHour: 500000, weekly: 5000000 });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    onSummary(`5h: ${limits.fiveHour}, weekly: ${limits.weekly}`);
  }, [onSummary, limits]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="5 Hour Token Limit">
         <input type="number" style={{ padding: '3px 6px' }} value={limits.fiveHour} onChange={(e) => setLimits({ ...limits, fiveHour: parseInt(e.target.value) || 0 })} />
      </Field>
      <Field label="Weekly Token Limit">
         <input type="number" style={{ padding: '3px 6px' }} value={limits.weekly} onChange={(e) => setLimits({ ...limits, weekly: parseInt(e.target.value) || 0 })} />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <PixelButton variant="primary" size="sm" onClick={() => {
          window.cth.updateConfig({ usageLimits: { default: limits } });
        }}>
          Save Limits
        </PixelButton>
      </div>
    </div>
  );
}
