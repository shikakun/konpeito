import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchAuthMethods } from '../lib/auth.ts'
import { UnauthorizedError } from '../lib/http.ts'
import { type Bootstrap, fetchBootstrap } from '../lib/queries.ts'

type LoginSearch = {
  bootstrap?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    if (typeof search.bootstrap === 'string' && search.bootstrap.length > 0) {
      return { bootstrap: search.bootstrap }
    }
    return {}
  },
  beforeLoad: async () => {
    let bootstrap: Bootstrap
    try {
      bootstrap = await fetchBootstrap()
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return
      }
      throw error
    }
    if (bootstrap.demo) {
      throw redirect({ to: '/' })
    }
  },
  loader: () => fetchAuthMethods(),
})
