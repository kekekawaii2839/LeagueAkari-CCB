import { vi } from 'vitest'

// Vitest's upstream config intentionally lacks the renderer YAML plugin.
// Load the real feature translations without importing every application locale.
vi.mock('@renderer-shared/i18n', async () => {
  const { createInstance } = await import('i18next')
  const i18next = createInstance()
  await i18next.init({ lng: 'zh-CN', resources: {}, interpolation: { escapeValue: false } })
  return { i18next }
})
vi.mock('./ui-copy.yaml', async () => {
  const { readFileSync } = await import('node:fs')
  const { parse } = await import('yaml')
  return { default: parse(readFileSync(new URL('./ui-copy.yaml', import.meta.url), 'utf8')) }
})
