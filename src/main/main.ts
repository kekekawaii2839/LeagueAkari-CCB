import 'reflect-metadata'

import { app, dialog } from 'electron'

import { bootstrap } from './bootstrap'
import { checkSharedProfileCompatibility, selectSharedProfile } from './bootstrap/shared-profile'
import { i18next } from './i18n'

if (process.platform === 'win32') {
  app.setAppUserModelId('com.ccb.leagueakari')
}

try {
  const sharedProfile = selectSharedProfile(app)
  const gotTheLock = app.requestSingleInstanceLock()
  if (gotTheLock) {
    if (sharedProfile) checkSharedProfileCompatibility(sharedProfile)
    bootstrap()
  } else {
    app.quit()
  }
} catch {
  // Do not log private paths, SQL or payloads, and never fall back to an empty profile.
  dialog.showErrorBox('League Akari CCB', i18next.t('shared-profile.startup-error'))
  app.quit()
}
