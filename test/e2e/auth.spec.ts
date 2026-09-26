import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { registerPasskey } from './helpers.ts'

test.describe('passkey auth', () => {
  test('register, login, sign out this device, and login again', async ({ page }) => {
    await registerPasskey(page)
    await expect(page.getByRole('navigation', { name: 'Feeds' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'All articles' })).toBeVisible()

    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Signed-in devices' }).click()
    await page
      .getByRole('tabpanel', { name: 'Signed-in devices' })
      .getByRole('button', { name: 'Sign out', exact: true })
      .first()
      .click()
    await page
      .getByRole('alertdialog', { name: 'Sign out of this device' })
      .getByRole('button', { name: 'Sign out' })
      .click()
    await expect(page).toHaveURL(/\/login/)

    await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
    await expect(page).toHaveURL((url) => url.pathname === '/', { timeout: 15_000 })

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('does not register when a credential already exists', async ({ page }) => {
    test.setTimeout(60_000)
    await registerPasskey(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
    const bootstrap = process.env.BOOTSTRAP_TOKEN ?? 'dev-bootstrap-token'
    await page.goto(`/login?bootstrap=${encodeURIComponent(bootstrap)}`)
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
    await expect(page.getByText('Bootstrap is disabled')).toBeVisible()
  })
})

test.describe('access token sign-in', () => {
  test('create a sign-in token, sign in with it, and pause it', async ({ page }) => {
    test.setTimeout(90_000)
    await registerPasskey(page)

    await page.goto('/settings/tokens')
    const tokens = page.getByRole('tabpanel', { name: 'Access tokens' })
    await tokens.getByLabel('Name').fill('Emergency')
    await tokens.getByRole('checkbox', { name: 'Also allow signing in with this token' }).click()
    await tokens.getByRole('button', { name: 'Create' }).click()
    const created = tokens.getByRole('status')
    await expect(created).toContainText('Save it in a password manager')
    const secret = (await created.getByText(/^[a-z2-7]{52}$/).textContent()) ?? ''
    await expect(tokens.getByText('Sign-in allowed')).toBeVisible()
    await expect(tokens.getByRole('button', { name: 'Pause' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
    const passkeyButton = page.getByRole('button', { name: 'Sign in with a passkey' })
    const tokenButton = page.getByRole('button', { name: 'Sign in with an access token' })
    const tokenField = page.getByLabel('Access token')
    await expect(tokenButton).toBeVisible()
    await expect(tokenField).toHaveCount(0)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])

    await tokenButton.click()
    await expect(tokenField).toBeFocused()
    await expect(passkeyButton).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(tokenButton).toBeFocused()
    await expect(passkeyButton).toBeVisible()

    await tokenButton.click()
    await expect(tokenField).toBeFocused()
    await tokenField.fill('wrong')
    await tokenButton.click()
    await expect(page.getByRole('alert')).toContainText('Couldn’t sign in')

    await tokenField.fill(secret)
    await tokenButton.click()
    await expect(page).toHaveURL((url) => url.pathname === '/', { timeout: 15_000 })

    await page.goto('/settings/sessions')
    await expect(page.getByRole('tabpanel', { name: 'Signed-in devices' })).toContainText(
      'Signed in with the access token “Emergency”',
    )

    await page.goto('/settings/tokens')
    await tokens.getByRole('button', { name: 'Pause' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Pause sign-in with access tokens' })
    await expect(dialog).toContainText('This device will be signed out too.')
    await dialog.getByRole('button', { name: 'Pause' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Sign in with an access token' })).toHaveCount(0)
  })
})
