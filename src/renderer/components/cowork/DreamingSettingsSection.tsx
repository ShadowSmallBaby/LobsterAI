import React, { useState, useMemo } from 'react';

import { i18nService } from '../../services/i18n';

interface DreamingSettingsSectionProps {
  dreamingEnabled: boolean;
  dreamingFrequency: string;
  dreamingModel: string;
  dreamingTimezone: string;
  onDreamingEnabledChange: (value: boolean) => void;
  onDreamingFrequencyChange: (value: string) => void;
  onDreamingModelChange: (value: string) => void;
  onDreamingTimezoneChange: (value: string) => void;
}

const FREQUENCY_PRESETS = [
  { value: '0 3 * * *', labelKey: 'coworkMemoryDreamingFreqNightly3am' },
  { value: '0 0 * * *', labelKey: 'coworkMemoryDreamingFreqMidnight' },
  { value: '0 0,12 * * *', labelKey: 'coworkMemoryDreamingFreqTwiceDaily' },
  { value: '0 */6 * * *', labelKey: 'coworkMemoryDreamingFreqEvery6h' },
  { value: '0 3 * * 0', labelKey: 'coworkMemoryDreamingFreqWeekly' },
] as const;

const CUSTOM_VALUE = '__custom__';

const DreamingSettingsSection: React.FC<DreamingSettingsSectionProps> = ({
  dreamingEnabled,
  dreamingFrequency,
  dreamingModel,
  dreamingTimezone,
  onDreamingEnabledChange,
  onDreamingFrequencyChange,
  onDreamingModelChange,
  onDreamingTimezoneChange,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isPreset = useMemo(
    () => FREQUENCY_PRESETS.some((p) => p.value === dreamingFrequency),
    [dreamingFrequency],
  );

  const [customMode, setCustomMode] = useState(!isPreset);

  const localTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const handleSelectChange = (val: string) => {
    if (val === CUSTOM_VALUE) {
      setCustomMode(true);
    } else {
      setCustomMode(false);
      onDreamingFrequencyChange(val);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border px-4 py-4 border-border">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">
            {i18nService.t('coworkMemoryDreamingEnabled')}
          </div>
          <div className="text-xs text-secondary">
            {i18nService.t('coworkMemoryDreamingEnabledHint')}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dreamingEnabled}
          onClick={() => onDreamingEnabledChange(!dreamingEnabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            dreamingEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              dreamingEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {dreamingEnabled && (
        <div className="space-y-3 pt-2">
          {/* Frequency selector */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              {i18nService.t('coworkMemoryDreamingFrequency')}
            </label>
            <select
              value={customMode ? CUSTOM_VALUE : dreamingFrequency}
              onChange={(e) => handleSelectChange(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface"
            >
              {FREQUENCY_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {i18nService.t(preset.labelKey)}
                </option>
              ))}
              <option value={CUSTOM_VALUE}>
                {i18nService.t('coworkMemoryDreamingFreqCustom')}
              </option>
            </select>
            <div className="text-xs text-secondary mt-1">
              {i18nService.t('coworkMemoryDreamingFrequencyHint')}
            </div>
          </div>

          {/* Custom cron input */}
          {customMode && (
            <div>
              <input
                type="text"
                value={dreamingFrequency}
                onChange={(e) => onDreamingFrequencyChange(e.target.value)}
                placeholder={i18nService.t('coworkMemoryDreamingFreqCustomPlaceholder')}
                className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface font-mono"
              />
            </div>
          )}

          {/* Timezone */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              {i18nService.t('coworkMemoryDreamingTimezone')}
            </label>
            <input
              type="text"
              value={dreamingTimezone}
              onChange={(e) => onDreamingTimezoneChange(e.target.value)}
              placeholder={localTimezone}
              className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface font-mono"
            />
            <div className="text-xs text-secondary mt-1">
              {i18nService.t('coworkMemoryDreamingTimezoneHint')}
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="text-xs text-primary hover:underline"
          >
            {showAdvanced
              ? i18nService.t('coworkMemoryAdvancedHide')
              : i18nService.t('coworkMemoryAdvancedShow')}
          </button>

          {showAdvanced && (
            <div className="space-y-3">
              {/* Dream Diary model override */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  {i18nService.t('coworkMemoryDreamingModel')}
                </label>
                <input
                  type="text"
                  value={dreamingModel}
                  onChange={(e) => onDreamingModelChange(e.target.value)}
                  placeholder="claude-sonnet-4-20250514"
                  className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface font-mono"
                />
                <div className="text-xs text-secondary mt-1">
                  {i18nService.t('coworkMemoryDreamingModelHint')}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DreamingSettingsSection;
