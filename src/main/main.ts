import 'reflect-metadata'

import { app } from 'electron'

import { bootstrap } from './bootstrap'

if (process.platform === 'win32') {
  app.setAppUserModelId('com.ccb.leagueakari')
}

const gotTheLock = app.requestSingleInstanceLock()

if (gotTheLock) {
  bootstrap()
} else {
  app.quit()
}
