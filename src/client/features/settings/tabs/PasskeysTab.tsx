import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ui/alert-dialog.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { useMessages } from '../../../i18n/I18nProvider.tsx'
import {
  beginPasskeyRegister,
  PasskeyConfirmationError,
  signalAllAcceptedCredentials,
  withPasskeyConfirmation,
} from '../../../lib/auth.ts'
import { formatDateTime } from '../../../lib/format.ts'
import { errorMessage } from '../../../lib/http.ts'
import { useNotify } from '../../../lib/notify.ts'
import { deleteCredential, fetchCredentials, queryKeys } from '../../../lib/queries.ts'
import { SettingsList, SettingsListItem, SettingsPanel } from '../SettingsPanel.tsx'

export function PasskeysTab(props: { userHandle: string }) {
  const t = useMessages()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: queryKeys.credentials, queryFn: fetchCredentials })
  const credentials = query.data?.credentials ?? []

  async function syncAuthenticator() {
    const { credentials } = await queryClient.fetchQuery({
      queryKey: queryKeys.credentials,
      queryFn: fetchCredentials,
      staleTime: 0,
    })
    await signalAllAcceptedCredentials(
      props.userHandle,
      credentials.map((row) => row.id),
    )
  }

  async function run(action: () => Promise<void>, done: string, fallback: string) {
    setError(null)
    try {
      await action()
      await syncAuthenticator()
      notify(done)
    } catch (caught) {
      const next =
        caught instanceof PasskeyConfirmationError
          ? t.settings.passkeys.reauthFailed
          : errorMessage(caught, fallback)
      setError(next)
      notify(next, 'destructive')
    }
  }

  async function remove() {
    if (!pending) {
      return
    }
    const id = pending.id
    setBusy(true)
    try {
      await run(
        () => withPasskeyConfirmation(() => deleteCredential(id)),
        t.settings.passkeys.deleted,
        t.settings.passkeys.deleteFailed,
      )
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPanel
      title={t.settings.passkeys.title}
      description={t.settings.passkeys.description}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void run(
              () => withPasskeyConfirmation(() => beginPasskeyRegister()),
              t.settings.passkeys.added,
              t.settings.passkeys.registerFailed,
            )
          }
        >
          {t.settings.passkeys.add}
        </Button>
      }
    >
      {error ? (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      ) : null}
      <SettingsList
        count={credentials.length}
        empty={query.data ? t.settings.passkeys.empty : t.common.loading}
      >
        {credentials.map((cred) => {
          const name = cred.nickname ?? cred.device_type ?? t.settings.passkeys.fallbackName
          return (
            <SettingsListItem
              key={cred.id}
              actions={
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={credentials.length <= 1}
                  onClick={() => setPending({ id: cred.id, name })}
                >
                  {t.common.delete}
                </Button>
              }
            >
              <div className="truncate font-medium">{name}</div>
              <div className="text-fg-muted">
                {t.settings.passkeys.registered(formatDateTime(cred.created_at))}
              </div>
            </SettingsListItem>
          )
        })}
      </SettingsList>
      {credentials.length <= 1 ? (
        <p className="text-sm text-fg-muted">{t.settings.passkeys.lastCannotDelete}</p>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPending(null)
          }
        }}
        title={t.settings.passkeys.deleteTitle}
        description={t.settings.passkeys.deleteBody(pending?.name ?? '')}
        confirmLabel={t.settings.passkeys.deleteConfirm}
        icon={Trash2}
        busy={busy}
        onConfirm={remove}
      />
    </SettingsPanel>
  )
}
