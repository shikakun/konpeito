import { expect, test } from '@playwright/test'
import { at, makeItems, mockItemApis, registerPasskey } from './helpers.ts'

test.describe('settings', () => {
  test('settings opens as a modal, applies display changes, and renders every tab', async ({
    page,
  }) => {
    await mockItemApis(page, makeItems(2))
    await registerPasskey(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings\/display/)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('combobox', { name: 'Theme' }).click()
    await page.getByRole('option', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await expect(dialog.getByRole('tabpanel')).toBeVisible()
    const tabs = [
      'Data',
      'Storage',
      'Fetch status',
      'Passkeys',
      'Signed-in devices',
      'Access tokens',
    ]
    for (const name of tabs) {
      await page.getByRole('tab', { name }).click()
      const panel = dialog.getByRole('tabpanel', { name })
      await expect(panel, name).toBeVisible()
      await expect(panel, name).not.toBeEmpty()
    }

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(page).toHaveURL((url) => url.pathname === '/')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Feeds' })).toBeVisible()
  })

  test('display settings put language first and switch English to Japanese', async ({ page }) => {
    await registerPasskey(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    const languageSelect = dialog.getByRole('combobox', { name: 'Language' })
    const themeSelect = dialog.getByRole('combobox', { name: 'Theme' })
    const languageBox = await languageSelect.boundingBox()
    const themeBox = await themeSelect.boundingBox()
    expect(languageBox?.y ?? 0).toBeLessThan(themeBox?.y ?? 0)
    await expect(languageSelect).toContainText('English')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await languageSelect.click()
    await page.getByRole('option', { name: '日本語' }).click()
    await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.getByRole('combobox', { name: '言語' })).toContainText('日本語')
  })

  test('the home page shows unread articles once the display setting is on', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const items = makeItems(3)
    at(items, 0).is_read = true
    await mockItemApis(page, items)
    await registerPasskey(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('checkbox', { name: 'Use Unread articles as the home page' }).click()
    await dialog.getByRole('button', { name: 'Close' }).click()

    await page.goto('/')
    await expect(page).toHaveURL((url) => url.pathname === '/')
    await expect(page.getByRole('heading', { name: 'Unread', level: 1 })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Feeds' })
    await expect(nav.getByRole('link', { name: /^Unread/ })).toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'All articles' }).click()
    await expect(page).toHaveURL((url) => url.pathname === '/items')
    await expect(page.getByRole('heading', { name: 'All articles', level: 1 })).toBeVisible()
    const list = page.getByRole('feed', { name: 'Articles' })
    await expect(list.getByRole('article', { name: '記事 1' })).toBeVisible()

    await page.goto('/unread')
    await expect(page.getByRole('heading', { name: 'Unread', level: 1 })).toBeVisible()
    await expect(list.getByRole('article', { name: '記事 1' })).toHaveCount(0)
  })
})
