import { createLazyFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Field, Label } from '../components/ui/label.tsx'
import { useMessages } from '../i18n/I18nProvider.tsx'
import {
  beginPasskeyLogin,
  beginPasskeyRegister,
  signalAllAcceptedCredentials,
  signalUnknownCredential,
  signInWithToken,
} from '../lib/auth.ts'
import { errorMessage } from '../lib/http.ts'
import { fetchBootstrap, fetchCredentials } from '../lib/queries.ts'

export const Route = createLazyFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const t = useMessages()
  const navigate = useNavigate()
  const { bootstrap: bootstrapToken } = Route.useSearch()
  const methods = Route.useLoaderData()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)

  async function afterAuth() {
    const bootstrap = await fetchBootstrap()
    const { credentials } = await fetchCredentials()
    await signalAllAcceptedCredentials(
      bootstrap.settings.user_handle,
      credentials.map((row) => row.id),
    )
    await navigate({ to: '/' })
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-xs flex-col gap-4">
        <h1 className="text-center text-xl font-semibold">Konpeito</h1>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (bootstrapToken !== undefined) {
              void run(async () => {
                await beginPasskeyRegister(bootstrapToken)
                await afterAuth()
              }, t.login.registerFailed)
              return
            }
            void run(async () => {
              const result = await beginPasskeyLogin()
              if ('unknownCredential' in result) {
                await signalUnknownCredential(result.credentialId)
                setError(t.login.unknownPasskey)
                return
              }
              await afterAuth()
            }, t.login.loginFailed)
          }}
        >
          {t.login.submit}
        </Button>
        {methods.accessToken && bootstrapToken === undefined ? (
          <>
            <div className="flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              {t.login.or}
              <span className="h-px flex-1 bg-line" />
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  await signInWithToken(token)
                  await afterAuth()
                }, t.login.tokenFailed)
              }}
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value="konpeito"
                readOnly
                hidden
              />
              <Field>
                <Label htmlFor="access-token">{t.login.tokenLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    id="access-token"
                    name="password"
                    type={tokenVisible ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTokenVisible(!tokenVisible)}
                  >
                    {tokenVisible ? t.login.hideToken : t.login.showToken}
                  </Button>
                </div>
              </Field>
              <Button type="submit" variant="outline" disabled={busy || token.length === 0}>
                {t.login.tokenSubmit}
              </Button>
            </form>
          </>
        ) : null}
        {error ? (
          <p className="text-center text-sm text-danger-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  )
}
