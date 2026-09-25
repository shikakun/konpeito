#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runWrangler, withTempDir } from './wrangler.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(packageRoot, 'dist', 'konpeito')
const buildConfigPath = path.join(buildDir, 'wrangler.json')
const migrationsDir = path.join(packageRoot, 'migrations')
const stateDir = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
  'konpeito',
)

const WORKER_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
const LOCATIONS = [
  { value: null, label: 'No preference' },
  { value: 'apac', label: 'Asia Pacific' },
  { value: 'oc', label: 'Oceania' },
  { value: 'weur', label: 'Western Europe' },
  { value: 'eeur', label: 'Eastern Europe' },
  { value: 'wnam', label: 'Western North America' },
  { value: 'enam', label: 'Eastern North America' },
]
const PRICING_URL = 'https://developers.cloudflare.com/workers/platform/pricing/'

class CliError extends Error {}

const heading = (text) => console.log(`\n${text}\n${'-'.repeat(text.length)}`)
const info = (text) => console.log(`  ${text}`)
const blank = () => console.log('')

// `curl | sh` leaves stdin attached to the pipe, so questions are read from the
// controlling terminal instead.
function openTerminal() {
  if (process.stdin.isTTY) return { fd: 0, interactive: true }
  try {
    return { fd: fs.openSync('/dev/tty', 'r+'), interactive: true }
  } catch {
    return { fd: null, interactive: false }
  }
}

const terminal = openTerminal()

function closeTerminal() {
  if (terminal.fd !== null && terminal.fd !== 0) fs.closeSync(terminal.fd)
}

async function question(text) {
  if (!terminal.interactive) {
    throw new CliError(
      `No terminal is available to ask "${text.trim()}". Pass the answer as a flag, or run this from a terminal.`,
    )
  }
  const usesStdin = terminal.fd === 0
  const input = usesStdin
    ? process.stdin
    : fs.createReadStream(null, { fd: terminal.fd, autoClose: false })
  const output = usesStdin
    ? process.stdout
    : fs.createWriteStream(null, { fd: terminal.fd, autoClose: false })
  const rl = createInterface({ input, output, terminal: true })
  try {
    return (await rl.question(text)).trim()
  } finally {
    rl.close()
    if (usesStdin) process.stdin.pause()
    else input.destroy()
  }
}

async function askText(label, { defaultValue, validate }) {
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  while (true) {
    const answer = (await question(`  ${label}${suffix}: `)) || defaultValue || ''
    const problem = validate(answer)
    if (!problem) return answer
    info(problem)
  }
}

async function askYesNo(label, defaultYes) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]'
  while (true) {
    const answer = (await question(`  ${label} ${suffix}: `)).toLowerCase()
    if (!answer) return defaultYes
    if (answer === 'y' || answer === 'yes') return true
    if (answer === 'n' || answer === 'no') return false
  }
}

async function askChoice(label, choices, defaultIndex) {
  info(label)
  for (const [index, choice] of choices.entries()) info(`  ${index + 1}. ${choice.label}`)
  while (true) {
    const answer = await question(`  Choice [${defaultIndex + 1}]: `)
    const index = answer ? Number(answer) - 1 : defaultIndex
    if (Number.isInteger(index) && index >= 0 && index < choices.length) return choices[index].value
  }
}

function tryWrangler(args, mode = 'capture') {
  return runWrangler(args, { cwd: packageRoot, mode, stdin: terminal.fd ?? 'ignore' })
}

async function wrangler(args, mode = 'capture') {
  const result = await tryWrangler(args, mode)
  if (result.code !== 0) {
    const detail = result.output.trim()
    throw new CliError(`\`wrangler ${args.join(' ')}\` failed.${detail ? `\n\n${detail}` : ''}`)
  }
  return result
}

async function ensureAuth() {
  const result = await tryWrangler(['whoami'])
  if (result.code === 0 && !/not authenticated/i.test(result.output)) {
    const email = result.output.match(/email\s+['"`]?([^\s'"`]+@[^\s'"`]+?)['"`]?[\s.]/i)
    info(email ? `Signed in to Cloudflare as ${email[1]}.` : 'Signed in to Cloudflare.')
    return
  }
  info('Not signed in to Cloudflare. Starting the login flow.')
  await wrangler(['login'], 'inherit')
  await wrangler(['whoami'], 'capture')
}

async function listDatabases() {
  const { stdout } = await wrangler(['d1', 'list', '--json'])
  const start = stdout.indexOf('[')
  if (start === -1) return []
  try {
    const parsed = JSON.parse(stdout.slice(start))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const databaseIdOf = (row) => row.uuid ?? row.id ?? row.database_id ?? null

async function ensureDatabase(name, location, { assumeYes, recordedId }) {
  const existing = (await listDatabases()).find((row) => row.name === name)
  if (existing) {
    const id = databaseIdOf(existing)
    if (!id) throw new CliError(`Cloudflare returned no id for the database ${name}.`)
    if (id !== recordedId) {
      const notice = `A database named ${name} exists, but it is not recorded for this Worker.`
      if (assumeYes) {
        throw new CliError(
          `${notice} Run setup without --yes to use it anyway, or choose another database name.`,
        )
      }
      info(notice)
      if (!(await askYesNo('Use it anyway?', false))) {
        throw new CliError('Choose another database name and run setup again.')
      }
    }
    info(`Using the existing database ${name}.`)
    return id
  }
  await wrangler(['d1', 'create', name, ...(location ? ['--location', location] : [])])
  const created = (await listDatabases()).find((row) => row.name === name)
  const id = created && databaseIdOf(created)
  if (!id) throw new CliError(`Created the database ${name}, but could not read back its id.`)
  info(`Created the database ${name}.`)
  return id
}

async function workerExists(name) {
  const result = await tryWrangler(['deployments', 'list', '--name', name, '--json'])
  if (result.code === 0) return true
  // 10007はWorkerが存在しないことを示すエラーコード
  if (/code:\s*10007\b/.test(result.output)) return false
  throw new CliError(
    `Could not check whether the Worker ${name} exists.\n\n${result.output.trim()}`,
  )
}

async function ensureQueue(name) {
  const result = await tryWrangler(['queues', 'create', name])
  if (result.code === 0) {
    info(`Created the queue ${name}.`)
    return
  }
  if (/already exists/i.test(result.output)) {
    info(`Using the existing queue ${name}.`)
    return
  }
  const paidPlan = /paid plan|not entitled|billing|workers_paid/i.test(result.output)
  const hint = paidPlan
    ? `\n\nCloudflare Queues is only available on the Workers Paid plan. See ${PRICING_URL}`
    : ''
  throw new CliError(`Could not create the queue ${name}.\n\n${result.output.trim()}${hint}`)
}

function buildDeployConfig(state) {
  if (!fs.existsSync(buildConfigPath)) {
    throw new CliError(`This package is missing its build output (${buildConfigPath}).`)
  }
  const config = JSON.parse(fs.readFileSync(buildConfigPath, 'utf8'))
  // The build output records the paths of the machine that built it, and resolves
  // the rest relative to itself. The deploy config is written to a temporary
  // directory, so every path here is made absolute.
  config.configPath = undefined
  config.userConfigPath = undefined
  config.name = state.worker
  if ('topLevelName' in config) config.topLevelName = state.worker
  config.main = path.resolve(buildDir, config.main)
  if (config.assets?.directory) {
    config.assets.directory = path.resolve(buildDir, config.assets.directory)
  }

  const database = config.d1_databases?.[0]
  if (!database) throw new CliError('The build output has no D1 binding.')
  database.database_name = state.database.name
  database.database_id = state.database.id
  database.migrations_dir = migrationsDir

  const producer = config.queues?.producers?.[0]
  const consumer = config.queues?.consumers?.[0]
  if (!producer || !consumer) throw new CliError('The build output has no queue bindings.')
  producer.queue = state.queues.main
  consumer.queue = state.queues.main
  consumer.dead_letter_queue = state.queues.dlq

  if (state.domain) {
    config.routes = [{ pattern: state.domain, custom_domain: true }]
    config.workers_dev = false
  } else {
    config.routes = undefined
    config.workers_dev = true
  }
  return config
}

function writeDeployConfig(dir, state) {
  const configPath = path.join(dir, 'wrangler.json')
  fs.writeFileSync(configPath, `${JSON.stringify(buildDeployConfig(state), null, 2)}\n`)
  return configPath
}

function findWorkerUrl(output, state) {
  if (state.domain) return `https://${state.domain}`
  const matches = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/gi) ?? []
  return matches.find((url) => url.startsWith(`https://${state.worker}.`)) ?? matches[0] ?? null
}

const stateFileOf = (worker) => path.join(stateDir, `${worker}.json`)

function readState(worker) {
  const file = stateFileOf(worker)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function listStates() {
  if (!fs.existsSync(stateDir)) return []
  return fs
    .readdirSync(stateDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(stateDir, entry), 'utf8')))
    .sort((a, b) => a.worker.localeCompare(b.worker))
}

function writeState(state) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const next = { ...state, updatedAt: new Date().toISOString() }
  fs.writeFileSync(stateFileOf(state.worker), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  return next
}

function listStatesOrFail() {
  const states = listStates()
  if (states.length === 0) {
    throw new CliError('No installation is recorded yet. Run `konpeito setup` first.')
  }
  return states
}

async function resolveState(name) {
  if (name) {
    const state = readState(name)
    if (!state) throw new CliError(`No installation named ${name} is recorded in ${stateDir}.`)
    return state
  }
  const states = listStatesOrFail()
  if (states.length === 1) return states[0]
  if (!terminal.interactive) {
    const names = states.map((state) => state.worker).join(', ')
    throw new CliError(
      `Several installations are recorded (${names}). Pick one with --name, or pass --all.`,
    )
  }
  const choices = states.map((state) => ({
    value: state,
    label: state.url ? `${state.worker} (${state.url})` : state.worker,
  }))
  return askChoice('Which installation should be updated?', choices, 0)
}

async function migrateAndDeploy(state, prepare) {
  return withTempDir('konpeito-', async (dir) => {
    const configPath = writeDeployConfig(dir, state)

    heading('Migrations')
    await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '-c', configPath], 'inherit')

    heading('Deploy')
    const extraArgs = prepare ? prepare(dir) : []
    const result = await wrangler(['deploy', '-c', configPath, ...extraArgs], 'tee')
    return result.output
  })
}

function suggestWorkerName() {
  const taken = new Set(listStates().map((state) => state.worker))
  if (!taken.has('konpeito')) return 'konpeito'
  for (let n = 2; ; n++) {
    if (!taken.has(`konpeito-${n}`)) return `konpeito-${n}`
  }
}

async function confirmWorker(worker, assumeYes) {
  if (readState(worker)) {
    if (assumeYes) return true
    info(`${worker} is already recorded in ${stateDir}.`)
    if (await askYesNo('Set it up again? Its data is kept.', false)) return true
    throw new CliError('Nothing was changed. Run `konpeito update` to update it.')
  }
  if (!(await workerExists(worker))) return true
  const notice = `A Worker named ${worker} exists on Cloudflare, but it is not recorded in ${stateDir}.`
  if (assumeYes) {
    throw new CliError(`${notice} Run setup without --yes to take it over, or choose another name.`)
  }
  info(notice)
  return askYesNo('Take it over? Its secrets are replaced.', false)
}

async function chooseWorker(fixedName, assumeYes) {
  while (true) {
    const worker =
      fixedName ??
      (await askText('Worker name', {
        defaultValue: suggestWorkerName(),
        validate: (value) =>
          WORKER_NAME.test(value) ? null : 'Use lowercase letters, digits and hyphens.',
      }))
    if (!WORKER_NAME.test(worker)) throw new CliError(`${worker} is not a valid Worker name.`)
    if (await confirmWorker(worker, assumeYes)) return worker
    if (fixedName) throw new CliError('Nothing was changed. Choose another name with --name.')
    info('Choose another name.')
  }
}

async function setup(values) {
  const assumeYes = values.yes === true

  heading('Konpeito')
  await ensureAuth()

  heading('Configuration')
  const worker = await chooseWorker(values.name ?? (assumeYes ? 'konpeito' : null), assumeYes)
  const recorded = readState(worker)

  blank()
  info('A passkey is bound to the domain it was registered on, so decide now.')
  info('Changing the domain later means registering again.')
  const wantsDomain = values.domain
    ? true
    : assumeYes
      ? false
      : await askYesNo('Serve Konpeito from your own domain instead of workers.dev?', false)
  const domain = wantsDomain
    ? (values.domain ??
      (await askText('Domain', {
        defaultValue: undefined,
        validate: (value) =>
          HOSTNAME.test(value) ? null : 'Enter a hostname, such as reader.example.com.',
      })))
    : null
  if (domain && !HOSTNAME.test(domain)) throw new CliError(`${domain} is not a valid hostname.`)

  blank()
  const databaseName =
    values.database ??
    (assumeYes
      ? worker
      : await askText('Database name', {
          defaultValue: worker,
          validate: (value) =>
            WORKER_NAME.test(value) ? null : 'Use lowercase letters, digits and hyphens.',
        }))
  const location =
    values.location ??
    (assumeYes ? null : await askChoice('Where should the database live?', LOCATIONS, 0))

  const state = {
    version: 1,
    worker,
    domain,
    database: { name: databaseName, id: null, location },
    queues: { main: `${worker}-feed-fetch`, dlq: `${worker}-feed-fetch-dlq` },
    url: null,
    createdAt: new Date().toISOString(),
  }

  heading('Summary')
  info(`Worker    ${state.worker}`)
  info(`Domain    ${state.domain ?? 'workers.dev'}`)
  info(`Database  ${state.database.name}${location ? ` (${location})` : ''}`)
  info(`Queues    ${state.queues.main}, ${state.queues.dlq}`)
  blank()
  if (!assumeYes && !(await askYesNo('Create these on Cloudflare?', true))) {
    throw new CliError('Nothing was changed.')
  }

  heading('Resources')
  state.database.id = await ensureDatabase(state.database.name, location, {
    assumeYes,
    recordedId: recorded?.database.id ?? null,
  })
  await ensureQueue(state.queues.main)
  await ensureQueue(state.queues.dlq)

  const bootstrapToken = randomBytes(32).toString('hex')
  const output = await migrateAndDeploy(state, (dir) => {
    const secretsPath = path.join(dir, 'secrets.env')
    fs.writeFileSync(
      secretsPath,
      `BOOTSTRAP_TOKEN=${bootstrapToken}\nIMAGE_PROXY_KEY=${randomBytes(32).toString('hex')}\n`,
      { mode: 0o600 },
    )
    return ['--secrets-file', secretsPath]
  })

  state.url = findWorkerUrl(output, state)
  writeState(state)

  heading('Register your passkey')
  if (state.url) {
    info('Open this URL. The bootstrap token works until the first passkey exists.')
    blank()
    info(`${state.url}/login?bootstrap=${bootstrapToken}`)
  } else {
    info('Open /login?bootstrap=<token> on your Worker, with this token:')
    blank()
    info(bootstrapToken)
  }
  blank()
  if (state.domain) info('A new custom domain can take a few minutes to start serving.')
  info(`Settings saved to ${stateFileOf(state.worker)}.`)
}

async function deployUpdate(state) {
  const output = await migrateAndDeploy(state)

  const next = writeState({ ...state, url: findWorkerUrl(output, state) ?? state.url })
  heading('Done')
  info(`${next.worker} is up to date${next.url ? ` at ${next.url}` : ''}.`)
  info('Secrets and the registered passkey were left untouched.')
}

async function updateAll() {
  const states = listStatesOrFail()
  heading('Konpeito')
  await ensureAuth()

  const failed = []
  for (const state of states) {
    heading(`Konpeito ${state.worker}`)
    try {
      await deployUpdate(state)
    } catch (error) {
      failed.push(state.worker)
      blank()
      console.error(error instanceof CliError ? error.message : error)
    }
  }

  heading('Summary')
  for (const state of states) {
    info(`${failed.includes(state.worker) ? 'Failed ' : 'Updated'}  ${state.worker}`)
  }
  if (failed.length > 0) process.exitCode = 1
}

async function update(values) {
  if (values.all) {
    if (values.name) throw new CliError('Pass either --name or --all, not both.')
    return await updateAll()
  }
  const state = await resolveState(values.name)
  heading(`Konpeito ${state.worker}`)
  await ensureAuth()
  await deployUpdate(state)
}

function status() {
  const states = listStates()
  if (states.length === 0) {
    heading('No installation is recorded')
    info(`Nothing found in ${stateDir}. Run \`konpeito setup\` to install.`)
    return
  }
  for (const state of states) {
    heading(state.worker)
    info(`URL       ${state.url ?? 'unknown'}`)
    info(`Domain    ${state.domain ?? 'workers.dev'}`)
    info(`Database  ${state.database.name} (${state.database.id})`)
    info(`Queues    ${state.queues.main}, ${state.queues.dlq}`)
    info(`Updated   ${state.updatedAt ?? state.createdAt}`)
  }
}

function help() {
  const hints = LOCATIONS.filter((entry) => entry.value)
    .map((entry) => entry.value)
    .join(', ')
  console.log(`Konpeito, a feed reader you host yourself on Cloudflare Workers.

Usage
  konpeito setup     Create the Cloudflare resources and deploy
  konpeito update    Deploy the current version over an existing installation
  konpeito status    Show what has been installed

Options
  --name <name>      Worker name
  --database <name>  D1 database name (setup only)
  --domain <host>    Serve from your own domain instead of workers.dev (setup only)
  --location <hint>  Where the database lives: ${hints} (setup only)
  --all              Update every recorded installation (update only)
  -y, --yes          Accept the defaults and skip the questions
  -h, --help         Show this message
  -v, --version      Show the version
`)
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      database: { type: 'string' },
      domain: { type: 'string' },
      location: { type: 'string' },
      all: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

  if (values.help) return help()
  if (values.version) {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
    console.log(manifest.version)
    return
  }
  if (values.location && !LOCATIONS.some((entry) => entry.value === values.location)) {
    throw new CliError(`${values.location} is not one of the D1 location hints.`)
  }

  const command = positionals[0] ?? 'setup'
  if (command === 'setup') return await setup(values)
  if (command === 'update') return await update(values)
  if (command === 'status') return status()
  if (command === 'help') return help()
  throw new CliError(`Unknown command: ${command}. Run \`konpeito --help\`.`)
}

try {
  await main()
} catch (error) {
  blank()
  console.error(error instanceof CliError ? error.message : error)
  process.exitCode = 1
} finally {
  closeTerminal()
}
