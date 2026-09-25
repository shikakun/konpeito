<img src="https://raw.githubusercontent.com/shikakun/konpeito/main/public/icon-1024.png" alt="" width="192" height="192">

# Konpeito

[日本語](./README.ja.md)

Konpeito (金平糖) is a feed reader that runs on Cloudflare Workers and D1. It consists of an API server and a web frontend.

It makes a few deliberate trade-offs: each server serves a single user, and passkeys are the only way to sign in. The result is simple and lightweight. It covers the essentials: RSS, Atom, RDF, and JSON Feed subscriptions; full-text extraction with Mozilla Readability; an image proxy; and full-text search. It is also compatible with the Google Reader API, so it can serve as a backend for clients such as Reeder Classic.

See it in action in the live demo: [sample.konpeito.shikakun.com](https://sample.konpeito.shikakun.com)

<img src="https://raw.githubusercontent.com/shikakun/konpeito/main/public/screenshot.jpg" alt="Screenshot of Konpeito with three columns showing the feed list, the article list, and the article body" width="3840" height="2160">

## Requirements

- A Cloudflare account on the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/)
  - Konpeito uses Cloudflare Queues to fetch feeds, and Queues is not available on the Workers Free plan.
  - Konpeito uses D1 as its database. At the scale of a single user, it is designed to stay within the free allowance included in the Paid plan.
- Node.js 20 or later for running the installer
- A web browser and device that support passkeys

## Installation

```sh
npx @shikakun/konpeito@latest setup
```

The installer walks you through creating a Worker, a D1 database, and a queue in Cloudflare Queues, then deploys them. When the deployment finishes, it prints a URL containing a bootstrap token. Once you open that URL and register a passkey, you can sign in. Your answers are saved to `~/.config/konpeito/<worker-name>.json`.

To run several servers on a single Cloudflare account, give each one its own Worker name, either at the installer's prompt or with the `--name` option. Each name gets its own Worker, D1 database, and queues.

```sh
npx @shikakun/konpeito@latest setup --name konpeito-alice
npx @shikakun/konpeito@latest setup --name konpeito-bob
```

## Updating

```sh
npx @shikakun/konpeito@latest update
```

This fetches the latest source code, deploys it, and applies any pending database migrations.

If you run several servers on a single Cloudflare account, pick one with `--name`, or update all of them with `--all`. Without either, the installer asks which one to update.

```sh
npx @shikakun/konpeito@latest update --name konpeito-alice
npx @shikakun/konpeito@latest update --all
```

## License

Licensed under the MIT License, Copyright © 2026 [@shikakun](https://shikakun.com).

See [LICENSE](./LICENSE) for more information.
