import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const port = process.env.AKARI_CDP_PORT || '8944'
const outDir = path.join(os.tmpdir(), 'akari-member-analysis-ui-audit')
const sections = [
  'roles',
  'champions',
  'pairs',
  'jungle',
  'conversion',
  'early',
  'synergy',
  'scatter',
  'matches'
]

await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(outDir, { recursive: true })

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const pages = browser.contexts().flatMap((context) => context.pages())
const page = pages.find((candidate) => candidate.url().includes('/main-window.html'))
if (!page) throw new Error('League Akari main window was not found')
let playerAliases = []

async function dismissFirstRun() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const dialog = page.locator('[role="dialog"]:visible, .n-modal:visible').first()
    if (!(await dialog.count())) return

    let dismissed = false
    for (const label of ['开始使用', '我知道了', '跳过', '稍后', '关闭']) {
      const button = dialog.getByRole('button', { name: label, exact: true })
      if (!(await button.count())) continue
      await button.first().click()
      await page.waitForTimeout(250)
      dismissed = true
      break
    }
    if (!dismissed) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
    }
  }
}

async function resize(width, height) {
  await page.evaluate(({ width, height }) => window.resizeTo(width, height), { width, height })
  await page.waitForTimeout(350)
}

async function openSection(section) {
  await page.evaluate((target) => {
    window.location.hash = `#/member-analysis/${target}`
  }, section)
  await dismissFirstRun()
  await page.waitForTimeout(800)
}

async function scrollContent(position) {
  await page.locator('.member-analysis-content').evaluate((element, target) => {
    element.scrollTop =
      target === 'bottom'
        ? element.scrollHeight
        : target === 'middle'
          ? element.scrollHeight / 2
          : 0
  }, position)
  await page.waitForTimeout(250)
}

async function collectVisibleAliases() {
  const visibleNames = await page
    .locator('.member-cell strong, .member-line strong, .roster em, .menu-item__label-game-name')
    .allTextContents()
  playerAliases = [
    ...new Set([
      ...playerAliases,
      ...visibleNames
        .map((value) => value.trim())
        .filter((value) => value && !/^成员\d+$/.test(value) && value !== '本机玩家')
    ])
  ]
}

async function capture(name) {
  // Vue may replace previously redacted text nodes after a control change. Refresh the
  // alias list immediately before every capture so repeat runs remain privacy-safe.
  await collectVisibleAliases()
  await page.evaluate((aliases) => {
    const replacements = aliases.map((value, index) => [value, `成员${index + 1}`])
    const redact = (input) => {
      let output = input
      for (const [source, replacement] of replacements)
        output = output.split(source).join(replacement)
      return output.replace(/#[\p{L}\p{N}_-]+/gu, '').replace(/\b\d{9,13}\b/g, '对局编号')
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) node.nodeValue = redact(node.nodeValue ?? '')
    for (const element of document.querySelectorAll('[aria-label], [title]')) {
      for (const attribute of ['aria-label', 'title']) {
        const value = element.getAttribute(attribute)
        if (value) element.setAttribute(attribute, redact(value))
      }
    }
    const gameName = document.querySelector('.menu-item__label-game-name')
    const tagLine = document.querySelector('.menu-item__label-tag-line')
    if (gameName) gameName.textContent = '本机玩家'
    if (tagLine) tagLine.textContent = '#本机'
    for (const profileImage of document.querySelectorAll(
      '.summoner-profile-icon img, .sidebar-profile img, [class*="profile"] img'
    )) {
      profileImage.style.filter = 'blur(10px)'
    }
  }, playerAliases)
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    animations: 'disabled'
  })
}

async function captureSections(prefix, includeBottom) {
  for (const section of sections) {
    await openSection(section)
    await scrollContent('top')
    await capture(`${prefix}-${section}-top`)
    if (includeBottom) {
      await scrollContent('bottom')
      await capture(`${prefix}-${section}-bottom`)
    }
  }
}

async function captureJungleGroups(prefix) {
  await openSection('jungle')
  if (!(await page.locator('.composition-bar').count()))
    throw new Error('Jungle composition views are missing')
  if (await page.getByText('精确数据', { exact: false }).count())
    throw new Error('The duplicate jungle exact-metric table is still visible')
  for (const [label, name] of [
    ['开野与首轮', 'opening'],
    ['早期抓人与方向', 'gank'],
    ['资源控制', 'objectives'],
    ['发育与对位', 'development']
  ]) {
    await page.getByRole('radio', { name: label, exact: true }).click({ force: true })
    await page.waitForTimeout(250)
    await scrollContent('top')
    await capture(`${prefix}-jungle-${name}`)
  }
  const sideSwitch = page.locator('.jungle-view .side-toggle .n-switch')
  if (await sideSwitch.count()) {
    await sideSwitch.click()
    await page.waitForTimeout(250)
    await capture(`${prefix}-jungle-side-breakdown`)
    await sideSwitch.click()
    await page.waitForTimeout(250)
  }
}

async function captureLaneGankThemes(prefix) {
  await openSection('roles')
  await page.getByRole('radio', { name: '被抓统计', exact: true }).click({ force: true })
  const originalTheme = await page.evaluate(async () =>
    window.akariManager
      .getInstance('setting-utils-renderer')
      .get('app-common-main', 'theme', 'dark')
  )
  try {
    for (const theme of [
      'light',
      'dark',
      'butter',
      'graphite',
      'cyber',
      'sakura',
      'mint',
      'aurora'
    ]) {
      await page.evaluate(
        (value) => window.akariManager.getInstance('app-common-renderer').setTheme(value),
        theme
      )
      await page.waitForTimeout(300)
      await scrollContent('top')
      await capture(`${prefix}-roles-gank-deaths-${theme}`)
    }
  } finally {
    await page.evaluate(
      (value) => window.akariManager.getInstance('app-common-renderer').setTheme(value),
      originalTheme
    )
    await page.waitForTimeout(300)
  }
}

await openSection('champions')
await openSection('roles')
playerAliases = [
  ...new Set(
    (await page.locator('.member-cell strong').allTextContents())
      .map((value) => value.trim())
      .filter(Boolean)
  )
]

await resize(1440, 900)
await captureSections('wide', true)
await captureJungleGroups('wide')
await captureLaneGankThemes('wide')

await openSection('champions')
if (!(await page.locator('.pool-donut .segment').count()))
  throw new Error('Champion-pool composition donuts are missing')
if (!(await page.locator('.hero-detail').count()))
  throw new Error('Champion detail evidence panel is missing')

await openSection('roles')
const explainedHeadings = page.locator('.metric-heading.explained')
if (!(await explainedHeadings.count()))
  throw new Error('Member-role metric definitions are missing')
for (const title of await explainedHeadings.evaluateAll((elements) =>
  elements.map((element) => element.getAttribute('title'))
)) {
  if (!title?.trim()) throw new Error('A member-role metric definition is empty')
}
const sideBreakdownSwitch = page.locator('.side-toggle .n-switch')
if (await sideBreakdownSwitch.count()) {
  await sideBreakdownSwitch.click()
  await page.waitForTimeout(250)
  await scrollContent('top')
  await capture('wide-roles-side-breakdown')
  await sideBreakdownSwitch.click()
  await page.waitForTimeout(250)
}
for (const [label, name, roleIndex] of [
  ['输出与经济', 'efficiency', 1],
  ['视野', 'vision', 2],
  ['承伤与功能', 'utility', 3],
  ['对线与资源', 'lane', 4],
  ['被抓统计', 'gank-deaths', 3]
]) {
  await page.getByRole('radio', { name: label, exact: true }).click({ force: true })
  await page.waitForTimeout(250)
  await scrollContent('top')
  await capture(`wide-roles-${name}`)
  await page.locator('.role-section').nth(roleIndex).scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await capture(`wide-roles-${name}-other-role`)
}

await resize(900, 760)
await captureSections('narrow', true)
await captureJungleGroups('narrow')
await captureLaneGankThemes('narrow')

await openSection('roles')
const settingsButton = page
  .locator('.member-analysis-header')
  .getByRole('button', { name: '设置', exact: true })
if (await settingsButton.count()) {
  await settingsButton.click()
  await page.waitForTimeout(350)
  await capture('narrow-settings-top')
  const drawer = page.locator('.n-drawer-body-content-wrapper:visible').first()
  if (await drawer.count()) {
    await drawer.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.waitForTimeout(250)
    await capture('narrow-settings-bottom')
  }
  await page.keyboard.press('Escape')
}

console.log(outDir)
await browser.close()
