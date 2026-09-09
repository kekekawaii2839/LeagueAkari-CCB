import { i18next } from '@renderer-shared/i18n'

import copy from './ui-copy.yaml'

// Feature-owned resources: do not expand upstream's renderer namespace.
for (const language of ['zh-CN', 'en'] as const)
  i18next.addResourceBundle(language, 'member-analysis-ui', copy[language], true, true)

export const uiText = (key: keyof typeof copy.en, values: Record<string, unknown> = {}) =>
  String(i18next.t(String(key), { ns: 'member-analysis-ui', ...values }))
