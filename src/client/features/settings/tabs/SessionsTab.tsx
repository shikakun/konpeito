import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ui/alert-dialog.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { useMessages } from '../../../i18n/I18nProvider.tsx'
import { formatDateTime } from '../../../lib/format.ts'
import { errorMessage } from '../../../lib/http.ts'
import { useNotify } from '../../../lib/notify.ts'
import { fetchSessions, queryKeys, signOutSession } from '../../../lib/queries.ts'
import { Badge, SettingsList, SettingsListItem, SettingsPanel } from '../SettingsPanel.tsx'

interface PendingSignOut {
  id: string
  current: boolean
  name: string
}

export function SessionsTab() {
  const t = useMessages()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [pending, setPending] = useState<PendingSignOut | null>(null)
  const [busy, setBusy] = useState(false)
  const query = useQuery({ queryKey: queryKeys.sessions, queryFn: fetchSessions })
  const sessions = query.data?.sessions ?? []

  async function signOut() {
    if (!pending) {
      return
    }
    setBusy(true)
    try {
      await signOutSession(pending.id)
      if (pending.current) {
        window.location.href = '/login'
        return
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      notify(t.settings.sessions.signedOut)
      setPending(null)
    } catch (error) {
      notify(errorMessage(error, t.settings.sessions.signOutFailed), 'destructive')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPanel title={t.settings.sessions.title} description={t.settings.sessions.description}>
      <SettingsList
        count={sessions.length}
        empty={query.data ? t.settings.sessions.empty : t.common.loading}
      >
        {sessions.map((session) => {
          const name = session.user_agent ?? t.settings.sessions.unknownDevice
          const lastSeen = t.settings.sessions.lastSeen(formatDateTime(session.last_seen_at))
          return (
            <SettingsListItem
              key={session.id}
              actions={
                <Button
                  size="sm"
                  variant="destructive-outline"
                  onClick={() => setPending({ id: session.id, current: session.current, name })}
                >
                  {t.settings.sessions.signOut}
                </Button>
              }
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{name}</span>
                {session.current ? <Badge>{t.settings.sessions.current}</Badge> : null}
              </div>
              <div className="text-fg-muted">
                {session.token_name === null
                  ? lastSeen
                  : t.settings.sessions.signedInWithToken(session.token_name, lastSeen)}
              </div>
            </SettingsListItem>
          )
        })}
      </SettingsList>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPending(null)
          }
        }}
        title={
          pending?.current
            ? t.settings.sessions.signOutCurrentTitle
            : t.settings.sessions.signOutOtherTitle
        }
        description={
          pending?.current
            ? t.settings.sessions.signOutCurrentBody
            : t.settings.sessions.signOutOtherBody(pending?.name ?? '')
        }
        confirmLabel={
          pending?.current
            ? t.settings.sessions.signOutCurrentConfirm
            : t.settings.sessions.signOutOtherConfirm
        }
        icon={LogOut}
        busy={busy}
        onConfirm={signOut}
      />
    </SettingsPanel>
  )
}
