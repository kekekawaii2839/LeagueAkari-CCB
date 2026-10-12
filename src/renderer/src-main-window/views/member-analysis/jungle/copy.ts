import { i18next } from '@renderer-shared/i18n'
import { useTranslation } from 'i18next-vue'

import copy from './copy.yaml'

for (const language of ['zh-CN', 'en'] as const)
  i18next.addResourceBundle(language, 'member-analysis-jungle', copy[language], true, true)
// Record translation access using the app's existing reactive i18next-vue context.
export function useJungleText() {
  const { t } = useTranslation('member-analysis-jungle')
  return (key: keyof typeof copy.en, values: Record<string, unknown> = {}) =>
    String(t(String(key), values))
}
