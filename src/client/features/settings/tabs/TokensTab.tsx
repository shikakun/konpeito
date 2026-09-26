import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CirclePause, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ui/alert-dialog.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { CheckboxField } from '../../../components/ui/checkbox.tsx'
import { Input } from '../../../components/ui/input.tsx'
import { Field, Label } from '../../../components/ui/label.tsx'
import { useMessages } from '../../../i18n/I18nProvider.tsx'
import { PasskeyConfirmationError, withPasskeyConfirmation } from '../../../lib/auth.ts'
import { formatDateTime } from '../../../lib/format.ts'
import { errorMessage } from '../../../lib/http.ts'
import { useNotify } from '../../../lib/notify.ts'
import {
  createToken,
  deleteToken,
  fetchTokenSignIn,
  fetchTokens,
  queryKeys,
  setTokenSignInPaused,
} from '../../../lib/queries.ts'
import {
  Badge,
  SettingsList,
  SettingsListItem,
  SettingsPanel,
  SettingsSection,
} from '../SettingsPanel.tsx'

type Token = Awaited<ReturnType<typeof fetchTokens>>['tokens'][number]

export function TokensTab() {
  const t = useMessages()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [name, setName] = useState('')
  const [canSignIn, setCanSignIn] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [created, setCreated] = useState<{ secret: string; canSignIn: boolean } | null>(null)
  const [pending, setPending] = useState<Token | null>(null)
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: queryKeys.tokens, queryFn: fetchTokens })
  const tokens = query.data?.tokens ?? []
  const signInTokenCount = tokens.filter((token) => token.can_sign_in).length

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tokens }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tokenSignIn }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    ])
  }

  async function create() {
    setIssuing(true)
    try {
      const result = await withPasskeyConfirmation(() => createToken({ name, canSignIn }))
      setCreated({ secret: result.secret, canSignIn: result.can_sign_in })
      setName('')
      setCanSignIn(false)
      await refresh()
      notify(result.sign_in_resumed ? t.settings.tokens.issuedAndResumed : t.settings.tokens.issued)
    } catch (error) {
      notify(
        error instanceof PasskeyConfirmationError
          ? t.settings.tokens.reauthFailed
          : errorMessage(error, t.settings.tokens.issueFailed),
        'destructive',
      )
    } finally {
      setIssuing(false)
    }
  }

  async function copy(secret: string) {
    try {
      await navigator.clipboard.writeText(secret)
      notify(t.settings.tokens.copied)
    } catch {
      notify(t.settings.tokens.copyFailed, 'destructive')
    }
  }

  async function remove() {
    if (!pending) {
      return
    }
    setBusy(true)
    try {
      const result = await deleteToken(pending.id)
      if (result.signed_out) {
        window.location.href = '/login'
        return
      }
      await refresh()
      notify(t.settings.tokens.deleted)
      setPending(null)
    } catch (error) {
      notify(errorMessage(error, t.settings.tokens.deleteFailed), 'destructive')
    } finally {
      setBusy(false)
    }
  }

  function deleteDescription(token: Token): string {
    const sentences = [t.settings.tokens.deleteBody(token.name)]
    if (token.can_sign_in) {
      sentences.push(t.settings.tokens.deleteSignsOut)
      if (signInTokenCount === 1) {
        sentences.push(t.settings.tokens.deleteLastSignIn)
      }
    }
    if (token.signed_in_here) {
      sentences.push(t.settings.tokens.deleteCurrent)
    }
    return t.common.joinSentences(sentences)
  }

  return (
    <SettingsPanel title={t.settings.tokens.title} description={t.settings.tokens.description}>
      <SettingsSection title={t.settings.tokens.issueTitle}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Field>
            <Label htmlFor="token-name">{t.settings.tokens.name}</Label>
            <Input
              id="token-name"
              value={name}
              aria-describedby="token-name-hint"
              onChange={(event) => setName(event.target.value)}
            />
            <p id="token-name-hint" className="text-sm text-fg-muted">
              {t.settings.tokens.nameHint}
            </p>
          </Field>
          <CheckboxField
            checked={canSignIn}
            onCheckedChange={setCanSignIn}
            description={t.settings.tokens.allowSignInHint}
          >
            {t.settings.tokens.allowSignIn}
          </CheckboxField>
          <div>
            <Button type="submit" variant="outline" disabled={name.length === 0 || issuing}>
              {t.settings.tokens.issue}
            </Button>
          </div>
        </form>
        {created ? (
          <div role="status" className="rounded-md border border-line bg-sunken p-3">
            <p className="text-sm font-medium">{t.settings.tokens.newToken}</p>
            <div className="mt-1 flex items-start gap-2">
              <p className="min-w-0 flex-1 font-mono text-sm break-all select-all">
                {created.secret}
              </p>
              <Button size="sm" variant="outline" onClick={() => void copy(created.secret)}>
                {t.settings.tokens.copy}
              </Button>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {created.canSignIn ? t.settings.tokens.showOnceSignIn : t.settings.tokens.showOnce}
            </p>
          </div>
        ) : null}
      </SettingsSection>
      <SettingsSection title={t.settings.tokens.listTitle}>
        <SettingsList
          count={tokens.length}
          empty={query.data ? t.settings.tokens.empty : t.common.loading}
        >
          {tokens.map((token) => (
            <SettingsListItem
              key={token.id}
              actions={
                <Button size="sm" variant="destructive-outline" onClick={() => setPending(token)}>
                  {t.settings.tokens.delete}
                </Button>
              }
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{token.name}</span>
                {token.can_sign_in ? <Badge>{t.settings.tokens.signInBadge}</Badge> : null}
              </div>
              <div className="text-fg-muted">
                {t.settings.tokens.issuedAt(formatDateTime(token.created_at))}
              </div>
            </SettingsListItem>
          ))}
        </SettingsList>
      </SettingsSection>
      {signInTokenCount > 0 ? <TokenSignInSection /> : null}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPending(null)
          }
        }}
        title={t.settings.tokens.deleteTitle}
        description={pending === null ? '' : deleteDescription(pending)}
        confirmLabel={t.settings.tokens.deleteConfirm}
        icon={Trash2}
        busy={busy}
        onConfirm={remove}
      />
    </SettingsPanel>
  )
}

function TokenSignInSection() {
  const t = useMessages()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: queryKeys.tokenSignIn, queryFn: fetchTokenSignIn })
  const state = query.data
  if (!state) {
    return null
  }

  async function pause() {
    setBusy(true)
    try {
      const result = await setTokenSignInPaused(true)
      if (result.signed_out) {
        window.location.href = '/login'
        return
      }
      queryClient.setQueryData(queryKeys.tokenSignIn, { ...result, signed_in_with_token: false })
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      notify(t.settings.tokens.signIn.paused)
      setConfirming(false)
    } catch (error) {
      notify(errorMessage(error, t.settings.tokens.signIn.pauseFailed), 'destructive')
    } finally {
      setBusy(false)
    }
  }

  async function resume() {
    setBusy(true)
    try {
      await withPasskeyConfirmation(() => setTokenSignInPaused(false))
      await queryClient.invalidateQueries({ queryKey: queryKeys.tokenSignIn })
      notify(t.settings.tokens.signIn.resumed)
    } catch (error) {
      notify(
        error instanceof PasskeyConfirmationError
          ? t.settings.tokens.signIn.reauthFailed
          : errorMessage(error, t.settings.tokens.signIn.resumeFailed),
        'destructive',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title={t.settings.tokens.signIn.title}>
      <div className="flex items-start justify-between gap-4 text-sm">
        <div className="min-w-0">
          <p>
            {state.paused
              ? t.settings.tokens.signIn.statusPaused
              : t.settings.tokens.signIn.statusEnabled}
          </p>
          {state.paused ? (
            <p className="mt-0.5 text-fg-muted">{t.settings.tokens.signIn.resumeHint}</p>
          ) : null}
        </div>
        {state.paused ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void resume()}>
            {t.settings.tokens.signIn.resume}
          </Button>
        ) : (
          <Button size="sm" variant="destructive-outline" onClick={() => setConfirming(true)}>
            {t.settings.tokens.signIn.pause}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setConfirming(false)
          }
        }}
        title={t.settings.tokens.signIn.pauseTitle}
        description={t.common.joinSentences(
          state.signed_in_with_token
            ? [t.settings.tokens.signIn.pauseBody, t.settings.tokens.signIn.pauseCurrent]
            : [t.settings.tokens.signIn.pauseBody],
        )}
        confirmLabel={t.settings.tokens.signIn.pauseConfirm}
        icon={CirclePause}
        busy={busy}
        onConfirm={pause}
      />
    </SettingsSection>
  )
}
