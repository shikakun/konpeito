import { createLazyFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
  const [step, setStep] = useState<'choose' | 'token'>('choose')
  const tokenInput = useRef<HTMLInputElement>(null)
  const tokenButton = useRef<HTMLButtonElement>(null)
  const tokenAvailable = methods.accessToken && bootstrapToken === undefined

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

  function changeStep(next: 'choose' | 'token') {
    const update = () => {
      flushSync(() => {
        setStep(next)
        setError(null)
      })
      ;(next === 'token' ? tokenInput : tokenButton).current?.focus()
    }
    if (typeof document.startViewTransition !== 'function') {
      update()
      return
    }
    const root = document.documentElement
    root.dataset.loginTransition = next === 'token' ? 'forward' : 'backward'
    void document.startViewTransition(update).finished.finally(() => {
      delete root.dataset.loginTransition
    })
  }

  function signInWithPasskey() {
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
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        className="flex w-full max-w-xs flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            await signInWithToken(token)
            await afterAuth()
          }, t.login.tokenFailed)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && step === 'token') {
            event.preventDefault()
            changeStep('choose')
          }
        }}
      >
        <h1 className="mb-3 flex justify-center">
          <img
            src="/icon-192.png"
            alt="Konpeito"
            width={192}
            height={192}
            className="size-24 [view-transition-name:login-mark]"
          />
        </h1>
        {step === 'choose' ? (
          <Button
            type="button"
            className="[view-transition-name:login-method]"
            disabled={busy}
            onClick={signInWithPasskey}
          >
            {t.login.submit}
          </Button>
        ) : (
          <Field className="[view-transition-name:login-method]">
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="konpeito"
              readOnly
              hidden
            />
            <Label htmlFor="access-token">{t.login.tokenLabel}</Label>
            <Input
              ref={tokenInput}
              id="access-token"
              name="password"
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
        )}
        {tokenAvailable ? (
          <Button
            ref={tokenButton}
            type={step === 'token' ? 'submit' : 'button'}
            variant={step === 'token' ? 'default' : 'outline'}
            className="[view-transition-name:login-token]"
            disabled={busy}
            onClick={(event) => {
              if (step === 'choose') {
                event.preventDefault()
                changeStep('token')
              }
            }}
          >
            {t.login.tokenSubmit}
          </Button>
        ) : null}
        {step === 'token' ? (
          <Button
            type="button"
            variant="ghost"
            className="text-fg-muted [view-transition-name:login-back]"
            onClick={() => changeStep('choose')}
          >
            {t.login.back}
          </Button>
        ) : null}
        {error ? (
          <p className="text-center text-sm text-danger-text" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  )
}
