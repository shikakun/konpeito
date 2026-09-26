import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import {
  bufferToBase64URLString,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import { isRecord } from '../../shared/records.ts'
import { getMessages } from '../i18n/locale.ts'
import { ApiError, isApiError } from './http.ts'

function currentRpId(): string {
  return window.location.hostname
}

function hasChallenge(value: unknown): value is PublicKeyCredentialRequestOptionsJSON {
  return isRecord(value) && typeof value.challenge === 'string'
}

function hasRegistrationChallenge(value: unknown): value is PublicKeyCredentialCreationOptionsJSON {
  return isRecord(value) && typeof value.challenge === 'string' && isRecord(value.user)
}

async function authJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init?.headers)
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }
  const res = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  const body: unknown = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function fetchLoginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { status, body } = await authJson('/auth/login/options')
  if (status !== 200 || !hasChallenge(body)) {
    throw new Error(getMessages().login.challengeFailed)
  }
  return body
}

async function verifyLogin(
  response: AuthenticationResponseJSON,
): Promise<{ ok: true } | { unknownCredential: true }> {
  const { status, body } = await authJson('/auth/login/verify', {
    method: 'POST',
    body: JSON.stringify(response),
  })
  if (status === 401 && isApiError(body) && body.error.code === 'unauthorized') {
    return { unknownCredential: true }
  }
  if (status !== 200) {
    throw new Error(isApiError(body) ? body.error.message : getMessages().login.loginFailed)
  }
  return { ok: true }
}

async function fetchRegisterOptions(
  bootstrapToken?: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const url =
    bootstrapToken !== undefined && bootstrapToken.length > 0
      ? `/auth/register/options?bootstrap=${encodeURIComponent(bootstrapToken)}`
      : '/auth/register/options'
  const { status, body } = await authJson(url)
  if (status !== 200 || !hasRegistrationChallenge(body)) {
    throw new Error(
      isApiError(body) ? body.error.message : getMessages().login.registerChallengeFailed,
    )
  }
  return body
}

async function verifyRegister(response: RegistrationResponseJSON): Promise<void> {
  const { status, body } = await authJson('/auth/register/verify', {
    method: 'POST',
    body: JSON.stringify(response),
  })
  if (status !== 200) {
    throw new Error(
      isApiError(body) ? body.error.message : getMessages().login.registerVerifyFailed,
    )
  }
}

export async function fetchAuthMethods(): Promise<{ accessToken: boolean }> {
  const { status, body } = await authJson('/auth/methods')
  return { accessToken: status === 200 && isRecord(body) && body.access_token === true }
}

export async function signInWithToken(token: string): Promise<void> {
  const { status } = await authJson('/auth/token/login', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
  if (status !== 200) {
    throw new Error(getMessages().login.tokenFailed)
  }
}

export class PasskeyConfirmationError extends Error {
  constructor() {
    super('passkey confirmation failed')
    this.name = 'PasskeyConfirmationError'
  }
}

async function confirmWithPasskey(): Promise<void> {
  let verified = false
  try {
    const options = await authJson('/auth/reauth/options')
    if (options.status === 200 && hasChallenge(options.body)) {
      const assertion = await startAuthentication({ optionsJSON: options.body })
      const result = await authJson('/auth/reauth/verify', {
        method: 'POST',
        body: JSON.stringify(assertion),
      })
      verified = result.status === 200
    }
  } catch {
    verified = false
  }
  if (!verified) {
    throw new PasskeyConfirmationError()
  }
}

export async function withPasskeyConfirmation<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'reauth_required')) {
      throw error
    }
  }
  await confirmWithPasskey()
  return action()
}

export async function logout(): Promise<void> {
  await authJson('/auth/logout', { method: 'POST', body: '{}' })
}

export async function beginPasskeyLogin(): Promise<
  { ok: true } | { unknownCredential: true; credentialId: string }
> {
  const options = await fetchLoginOptions()
  const assertion = await startAuthentication({ optionsJSON: options })
  const result = await verifyLogin(assertion)
  if ('unknownCredential' in result) {
    return { unknownCredential: true, credentialId: assertion.id }
  }
  return { ok: true }
}

export async function beginPasskeyRegister(bootstrapToken?: string): Promise<void> {
  const options = await fetchRegisterOptions(bootstrapToken)
  const attestation = await startRegistration({ optionsJSON: options })
  await verifyRegister(attestation)
}

function signalFns(): {
  unknown?: (opts: { rpId: string; credentialId: string }) => Promise<void>
  all?: (opts: {
    rpId: string
    userId: string
    allAcceptedCredentialIds: string[]
  }) => Promise<void>
} {
  if (typeof PublicKeyCredential !== 'function') {
    return {}
  }
  const unknownRaw = Reflect.get(PublicKeyCredential, 'signalUnknownCredential')
  const allRaw = Reflect.get(PublicKeyCredential, 'signalAllAcceptedCredentials')
  const result: {
    unknown?: (opts: { rpId: string; credentialId: string }) => Promise<void>
    all?: (opts: {
      rpId: string
      userId: string
      allAcceptedCredentialIds: string[]
    }) => Promise<void>
  } = {}
  if (typeof unknownRaw === 'function') {
    result.unknown = async (opts) => {
      await Reflect.apply(unknownRaw, PublicKeyCredential, [opts])
    }
  }
  if (typeof allRaw === 'function') {
    result.all = async (opts) => {
      await Reflect.apply(allRaw, PublicKeyCredential, [opts])
    }
  }
  return result
}

export async function signalUnknownCredential(credentialId: string): Promise<void> {
  const fns = signalFns()
  if (!fns.unknown) {
    return
  }
  await fns.unknown({ rpId: currentRpId(), credentialId })
}

export async function signalAllAcceptedCredentials(
  userHandle: string,
  credentialIds: string[],
): Promise<void> {
  if (credentialIds.length === 0) {
    return
  }
  const fns = signalFns()
  if (!fns.all) {
    return
  }
  const bytes = new TextEncoder().encode(userHandle)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const userId = bufferToBase64URLString(buffer)
  await fns.all({
    rpId: currentRpId(),
    userId,
    allAcceptedCredentialIds: credentialIds,
  })
}
