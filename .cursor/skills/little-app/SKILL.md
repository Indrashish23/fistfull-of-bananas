---
name: little-app
description: >-
  Turn an existing website into a Little TV app (one the AI television can
  perceive and drive by voice) using @kabletv/little-sdk. Covers the whole path
  A-Z: authenticating npm to GitHub Packages, installing the SDK, connect(),
  data-little-* perception annotations, tools + the little/manifest.json contract,
  authority rails, events, capabilities (identity, notifications, location, voice, sense,
  media, commerce, assets, social invitations and livestreams), pause/resume, answers
  served while the app is closed, generated content (compose/image/music), runtime tool
  scoping + steering, the no-TV inspector, headless tests, the `little` CLI (init, the local device
  simulator `little dev`, manifest validate, publish) and publishing. Use when the
  user wants to build, port, annotate, run, or publish a Little/TV app, mentions
  @kabletv/little-sdk, @kabletv/little-cli, connect(), data-little attributes, a
  Little manifest, little.config.json, app.can(), app.compose(),
  app.notifications, notification consent/delivery, app.voice/sense/media/commerce/social,
  createAnswerHandler,
  @kabletv/little-motion, createMotionSession(), semantic motion, motion-controlled
  games, @kabletv/little-phone, a live mic, or "make my site work on the TV".
---

# Turn your website into a Little TV app

A **Little app is a normal website at its own origin plus a manifest.** You add
one `connect()` call, a few `data-little-*` attributes to the UI you already have,
and serve a `little/manifest.json`. The website then becomes a **TV app the agent
can *see* and *drive* by voice**. The SDK owns the connection to the host; you never
touch the transport.

Nothing about your site's own rendering, framework, or hosting changes. You are
adding a perception/actuation layer on top of what you already ship.

## The three planes (the whole mental model)

| Plane | Direction | What it is | How you write it |
|---|---|---|---|
| **Perception** | app → agent | what's on screen (the "referent map") | `data-little-*` attributes (no code) |
| **Actuation** | agent → app | tools the agent may call | `app.tool(name, handler)` + the manifest |
| **Events** | app → agent | something the viewer did | `app.emit(name, data)` |

Plus your app's **saved state** (`app.saveState`), which brings the viewer back where
they were after the TV closes your app ("Saved state and per-viewer storage"), and the
**remote**, which reaches your page as ordinary trusted `keydown` events (§3, "The remote").

Beyond being *seen* and *driven*, an app can reach two more platform surfaces:
**content** it renders (the platform writes typed data / an image / a music
bed; you never run a model) and **capabilities** it requests (host-brokered powers:
identity, voice, camera/pose/speech, a brokered vendor token, a charge). Both are
declared in the manifest and covered in [Capabilities & content](#capabilities--content-host-powers--generated-content).

## The `little` CLI: the terminal path (install this first)

`@kabletv/little-cli` is the developer front door: it scaffolds, runs, validates and
publishes a Little app, and every command takes `--json` (the result document on
stdout, all chrome on stderr) so **an agent can drive it directly**. Same `@kabletv`
registry + token as the SDK (§1).

```bash
npm i -g @kabletv/little-cli           # or: npx @kabletv/little-cli <command>
little login                           # device grant: a code + QR, approve in the browser
little init my-app                     # NEW app: SDK wired, starter manifest, little.config.json, AGENTS.md
little dev                             # run the app inside the real device harness + debug panel
little mcp                             # your editor starts this: the running simulator as MCP tools (§8)
little device pair <code>              # once per TV: the code from its Settings > Developer
little dev --device <name>             # run the app on that paired television instead of the simulator
little manifest validate               # offline shape check + the server's authoritative verdict
little publish --url https://app.example.com   # fetch → sanitize → pin the manifest into the catalog
little products create pro --name "Pro" --price 4.99   # what the app sells (commerce.purchase)
little purchases ls                    # sandbox (test) purchases; `refund <id>` takes one back (`--live` for real ones)
little sign-in create --redirect https://app.example.com/cb   # the client identity.signIn needs
little notifications credentials create   # the server credential for createClient()
little webhooks create https://api.example.com/little/webhooks   # purchase events to your server
little webhooks listen --forward-to http://localhost:3000/hooks  # sandbox events, signed, to your machine
little doctor                          # Node, JDK, auth, registry, manifest, when anything is off
```

Nothing needs the developer portal: `little org create`, `little team`, `little apps
versions|set|rm`, `little testers` and `little open [page]` (a deep link for what belongs
in a browser) cover the rest. Destructive commands ask first; pass `--yes` when scripting.

Two ways in:

- **Starting a new app?** `little init` (templates: react / vanilla / vue) does §1–§6
  for you and writes an `AGENTS.md` at the root that briefs you on the project. Skip to
  §4 (perception) and §5 (tools) to make it *your* app, then §8 (`little dev`) and §9.
  `little init .` works in a folder your editor already opened (`.cursor/`, `.vscode/`,
  `.git/` don't count as content) and names the app after the folder; `--slug <slug>`
  overrides that. With `--json` the result carries `nextSteps` (the commands to run
  next, in order), so read that rather than parsing the chrome.
- **Porting an existing site?** `little init --template annotate` drops only a
  `little/manifest.json` + a `LITTLE.md` guide into the site, then follow §1–§9 below.

`little <command> --help` is exact and the full reference is at
<https://docs.little.co/docs/cli>.

## Workflow checklist

Copy this and track progress:

```
- [ ] 0. Prereqs: Node 22+, GitHub token with read:packages for the kabletv org, the little CLI
- [ ] 1. Point the @kabletv scope at GitHub Packages (.npmrc)
- [ ] 2. Install @kabletv/little-sdk (+ @kabletv/little-react if you use React)
- [ ] 3. connect() and wire the lifecycle
- [ ] 4. Annotate the DOM for perception (data-little-*)
- [ ] 5. Declare tools + write handlers (actuation)
- [ ] 6. Serve /little/manifest.json (the routing + tool contract)
- [ ] 7. Emit events for things the agent can't see
- [ ] 8. Verify: the inspector (no TV) and `little dev` (the real harness on your machine)
- [ ] 9. Publish: `little manifest validate` → `little publish --url <your origin>`
```

---

## 0. Prerequisites

- **Node 22+** and npm (or pnpm).
- Access to the `kabletv` GitHub org and a token with the **`read:packages`**
  scope. The SDK and the CLI are **private** packages on GitHub Packages, so even
  installing them needs auth. If the org enforces SAML SSO, authorize the token for
  `kabletv` once.
  - Easiest locally: the [`gh` CLI](https://cli.github.com/): `gh auth token`
    prints a usable token.
- For `little dev` (the local device simulator): macOS, Linux or Windows (native, no
  WSL) and a **JDK 17+** (Temurin 21 recommended). `little doctor` checks both.

## 1. Authenticate npm to GitHub Packages

In your app's repo root, create an `.npmrc` (safe to commit: the token is read
from the environment, not hardcoded):

```ini
@kabletv:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then export a token so `${NODE_AUTH_TOKEN}` resolves:

```bash
export NODE_AUTH_TOKEN=$(gh auth token)     # or a PAT with read:packages
```

In **CI**, set `NODE_AUTH_TOKEN` from the built-in `GITHUB_TOKEN` with
`permissions: packages: read`; no PAT needed.

`NODE_AUTH_TOKEN` is only needed at **install** (`npm install` resolving the
package). Dev, build, and runtime don't touch it: the SDK is inlined into your
bundle at build time, so you don't need to export it for `npm run dev`/`build`.

## 2. Install the SDK

Any web framework works. The package is dependency-free (it inlines everything at
build time), so there is nothing else to
add. It ships unminified: about **275 KB raw, 62 KB gzipped**. Your bundler's
production build minifies it to roughly 155 KB raw, 47 KB gzipped. Your production
bundle will be larger because it also includes your UI framework; that weight is your
app's, not the SDK's.

```bash
npm install @kabletv/little-sdk        # or: pnpm add @kabletv/little-sdk
```

From SDK 0.39.0 every result type narrows on `ok`, so `if (art.ok) img.src = art.url`
compiles; on an older SDK, check the field too. Upgrading? Read the
[changelog](https://docs.little.co/docs/changelog) and the
[migration guide](https://docs.little.co/docs/migration).

**Using React?** Also install the hooks (same `@kabletv` scope + `.npmrc`, so no
extra auth). They depend on the SDK, so this is all you need:

```bash
npm install @kabletv/little-react      # pulls @kabletv/little-sdk as a dependency
```

**Using phones as microphones?** Your phone page installs `@kabletv/little-phone` (same
scope and `.npmrc`, same version as your SDK) to accept a live mic; see §Capabilities,
`media`.

**No bundler / plain `index.html`?** GitHub Packages is auth-gated and not on a
public CDN, so there is no `<script src="…cdn…">` one-liner. Vendor the standalone
ESM bundle instead: `npm install @kabletv/little-sdk`, copy
`node_modules/@kabletv/little-sdk/dist/little.mjs` next to your HTML, and
`import { connect } from "./little.mjs"`.

## 3. Connect and wire the lifecycle

`connect()` wires your page to the TV host and returns a handle. The handshake is
robust to either side mounting first, so you never manage it.

```js
import { connect } from "@kabletv/little-sdk";

const app = connect();

// Fires once when the TV launches (or re-attaches to) your app. `params` is what the
// viewer just asked for; `state` is the saved state you kept with app.saveState, when
// the TV closed your last window session itself (`restored` is then true; else `{}`).
// `granted`/`denied` are the capability names the host resolved for this launch (see
// §Capabilities); `environment` is the household's resolved device settings (see below).
app.onEnter(({ params, state, restored, granted, denied, environment }) => render(state, params));

// A tool the agent may call. It must match a tool name in your manifest. Declare
// the arg shape with a generic to get a typed handler instead of `unknown` args.
app.tool("open_product", ({ id }) => {
  showProduct(id);
  return { say: "Here it is." }; // an ActionResult; returning nothing is a plain success
});
app.tool("evaluate", ({ expression }) => run(expression)); // typed via <{ expression: string }>
```

`tool(name, …)` is **last-writer-wins** per name (re-registering replaces, never
stacks), and `tool()`/`onEnter()`/`onTool()` each return
an **unsubscribe** you can call to clear the handler. Use it as a React effect
cleanup so a StrictMode remount can't leave a stale registration.

### The device environment

`onEnter`'s `environment` (a `LittleEnvironment`) is the household's resolved
device settings: `locale`, `timeZone`, `temperatureUnit`
(`celsius`|`fahrenheit`), `measurementSystem` (`metric`|`imperial`), and `hourCycle`
(`h12`|`h23`). **You rarely read it.** Locale and timezone already reach you through
the web platform (`navigator.language`, `Intl`/`Date`), so an app built with `Intl`
is correct with no code. Read `environment` only for what has **no** web primitive:
the unit and clock choices (label a temperature °C/°F, a distance km/mi, a time 24h
the way the household chose). It is `undefined` under an older host or the inspector,
so treat absence as "use the platform defaults". A change reaches an already-open app
on its next launch.

### The remote

The remote arrives as **ordinary, trusted `keydown` events**: six keys, identical on
every host and from every remote (TV remote, keyboard, phone): `ArrowUp` /
`ArrowDown` / `ArrowLeft` / `ArrowRight`, `Enter` (Select), `Escape` (Back). Directions
auto-repeat while held; Select/Back never do. Back is never `Backspace`. **Home never
reaches your page**: the platform pauses your app on it (`app.onPause`), so you never
handle it and the viewer is never trapped.

**When you want to leave, call `app.exit()`.** That is the whole exit story: Back is just
a key, Home only pauses you, and this call is how your app closes. The usual shape:

```js
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (canPopView()) popView();
  else app.exit();
});
```

`exit()` is equally right for leaving on your own terms (a finished game). It resolves
`{ ok: true }` once the host accepted; the window is torn down right after. In the
inspector it resolves `{ ok: false, error: { code: "no_host" } }`.

There is no button API, no `onButton`, and no platform behaviour layered on the keys:
the `keydown` event IS the contract. Do NOT expect a Home/`menu` key: Home is the
platform's. Do NOT expect Back to exit by itself: an app that never calls `exit()` only
leaves through Home.

A game controller the viewer paired sends these same keys (D-pad, A as `Enter`, B as
`Escape`; its other buttons do nothing) and is invisible to `navigator.getGamepads()`,
unless your app declares `input.gamepad` (§Capabilities, "Game controllers").

React apps can install the `@kabletv/little-react` hooks
(`useLittleEnter`, `useLittleTool`, `useLittleEvent`,
`useLittleParams`, `useLittlePaused`, `useLittleVisible`, plus `useLittleActiveTools`,
`useLittleSignIn`, `useLittleSignOut`, the commerce hooks `useLittleProducts`, `useLittleOwned`,
`useLittlePurchase` and `useLittleConsume`, `useLittleLiveMic` for a live mic, and `useLittleApp`
for the raw handle), published to GitHub Packages under
the same `@kabletv` scope as the SDK (the `.npmrc` from step 1 covers both). They own
the single page connection, read the latest handler through a ref, and unregister on
unmount, so you don't hand-roll the "mirror state into a ref" dance:

```tsx
import { configureLittle, useLittleEnter, useLittleTool } from "@kabletv/little-react";

// The hooks connect lazily with no options, so pass connect() options HERE,
// once, before the first hook mounts (module scope or the top of your root
// component). This is the hook-path way to set `debug` / `hostOrigin`.
configureLittle({ debug: true });

function App() {
  useLittleEnter(({ params }) => setName(String(params.name ?? "")));
  useLittleTool<{ id: string }>("open_product", ({ id }) => { show(id); });
}
```

Because that connection is lazy, `window.__little` only exists **after the first
hook mounts** (before that it's `undefined`). The model is otherwise identical to
the raw handle.

The handle exposes, grouped by what they do:

- **Perception + actuation + events:** `onEnter`, `observeEnter` (an extra enter
  observer for libraries, beside the one `onEnter` slot), `tool`, `onTool`,
  `saveState`, `exit`, `emit`, `snapshot`, `validate`, `report`, `call`, `params`,
  `disconnect`.
- **Pause and resume:** `onPause` (the viewer left and the TV keeps your app alive off
  screen: stop media and timers), `onResume` (back as it was left), `paused`. See
  [Pause and resume](#pause-and-resume).
- **Runtime steering:** `setActiveTools` (narrow the offered tool set to the current
  view) and `setGuide` (a runtime steering guide), covered in
  [Runtime steering](#runtime-steering-setactivetools-and-setguide).
- **Content + capabilities:** `can`, `compose`, `image`, `music`, and the capability
  namespaces `identity`, `notifications`, `location`, `voice`, `sense`, `media`,
  `commerce`, `assets`, `social`, covered in
  [Capabilities & content](#capabilities--content-host-powers--generated-content).
  (`app.can(name)` reports whether the host granted a declared capability.)

## 4. Perception: make your UI perceivable

The agent can only resolve "the rightmost card" or "the cheapest one" if it can
*see* the cards. The SDK builds a **referent map** (a positional ASCII grid + a
typed key table) from your annotations and streams it to the host. You annotate
the DOM you already have, with **no perception code.**

### Vocabulary

- `data-little`: the kind: `region` (container/grouping), `item` (selectable
  content: a card, a product, a row), `control` (a button / affordance), or
  `readout` (output the agent should *read* but not select, such as a total, a price, a
  status line, a timer, a calculator display; perceived, never actionable).
- `data-little-id`: the stable handle a tool call passes. **Prefer opaque ids**
  (`sku_9931`, not `the-sherpa-one`) so the agent must read the map, not guess.
- `data-little-action`: the tool this element triggers. Must match a manifest tool.
- `data-little-label`: a short, spoken label (falls back to `aria-label`/`title`/text).
  For a `region`, the label comes **only** from here, never its children's text.
- `data-little-data`: JSON of small, flat, **typed** fields
  (`{"price":128,"rating":4.6}`). This is what makes "the cheapest" / "highest
  rated" real comparisons instead of string-guessing the label.
- `data-little-order`: explicit reading order within a region (else DOM order).
- `data-little-state`: a small enum you and the agent agree on (`selected|disabled|…`).
- `data-little-caption`: a text description of an image, so "the mountain photo"
  resolves without pixels.

```html
<section data-little="region" data-little-label="Catalog">
  <article
    data-little="item"
    data-little-id="sku_3"
    data-little-action="open_product"
    data-little-label="Sherpa Trucker"
    data-little-order="3"
    data-little-data='{"price":128,"rating":4.6}'>
    …your existing markup…
  </article>
</section>
```

`data-little-data` is not just for catalogs: it types any comparable value. A
calculator's display is a `readout` (perceived, not clickable), and putting the
number in `data-little-data` lets the agent reason over it ("is it negative?",
"round that") instead of parsing the label string:

```html
<output data-little="readout" data-little-label="Display" data-little-data='{"value":1024}'>
  1,024
</output>
```

With no annotations at all, the SDK falls back to a coarse pass over focus rails
and common interactive tags: still observable, just less precise. Annotate anything the
viewer will refer to.

**In JSX** the attributes are identical (already kebab-case). Numbers and objects
render as strings, so compute them inline, and use `undefined` to omit an attribute:

```jsx
<article
  data-little="item"
  data-little-id={sku}
  data-little-action="open_product"
  data-little-label={title}
  data-little-order={i + 1}                        {/* number → string */}
  data-little-data={JSON.stringify({ price, rating })}
  data-little-state={selected ? "selected" : undefined}  {/* omit when falsy */}
/>
```

## 5. Actuation: tools

**Default actuation clicks the annotated element** whose `data-little-id` +
`data-little-action` match the call. So for "click this button" you often need
**no handler at all**: the call routes to the element you already wrote. A call with
no `id` clicks the first element carrying that `data-little-action`. A call whose `id`
matches no `data-little-id` answers `{ ok: false, detail }` (SDK 0.39.0+; older SDKs
click the first element with that action instead). Register a `tool()` only for
dynamic behaviour (filtering, sorting, anything that isn't "click this element").

```js
app.tool("filter", ({ tag }) => {
  applyFilter(tag); // returning nothing: it acted, and that is the whole story
});
```

A handler returns an `ActionResult`, and what you put in it decides what the agent
does next. Returning nothing acks a plain success and ends the turn; most handlers do
this. The fields:

- `ok`: did it succeed (defaults true when you return anything but `{ ok: false }`).
  `{ ok: false, detail }` says it could not act, and why, so the agent tries something else.
- `detail`: something the agent must **read** (the passages a question is answered
  from, the rows a lookup found). The agent takes another step to use it, so do not
  spend one describing an action that is already complete (`"opened sku_3"`).
- `say`: a line for **the agent to speak**. Use it to hand the agent words.
- `spoke`: set `true` when **your handler already narrated** the outcome (you
  played audio, or streamed your own speech), so the agent should *not* add a line
  of its own on top. `say` gives the agent something to say; `spoke: true` tells it
  to stay quiet. Most handlers use neither, or just `say`.

**Every call is acked**: a bad reference returns `{ ok: false, detail }` the agent
can recover from, never a silent no-op. Use `app.onTool((name, args) => …)` as a
catch-all.

**A handler that throws** is answered by the SDK, which logs the error to the console.
For a `read` tool the agent gets a failure with the error message. For any other tool
it treats the outcome as unknown (the handler may have acted before it threw), so it
neither reports the call as done nor makes it again. When the call did nothing, catch
the error and return `{ ok: false, detail }` so the agent can try something else.

**Args are passed through as received, not coerced.** The SDK hands your handler the
args exactly as they arrive (JSON-typed from the agent), and does **not** validate or
coerce them to the tool's declared `params` schema. So a `{ "type": "integer" }` param
can still reach you as a string or a float, so coerce or guard in the handler
(`Number(args.digit)`). The `tool<A>()` / `useLittleTool<A>()` generic is a
**compile-time** convenience for your own code; it is not a runtime check.

## 6. The manifest: routing + the tool contract

Serve a manifest at **your origin, `/little/manifest.json`**. It is what a host
reads to route to, launch, and steer your app. On publish the platform
**fetches → sanitizes → hashes → pins** it; your site content stays live, only
this contract is pinned.

```json
{
  "id": "acme-shop",
  "title": "Acme Shop",
  "description": "Browse and buy Acme denim. Launch when the viewer wants to shop denim, jackets, or a specific wash/fit.",
  "url": "https://shop.acme.example",
  "launchSchema": {
    "type": "object",
    "properties": {
      "category": { "type": "string", "description": "A product category the viewer named, e.g. \"jackets\"; omit for a general browse." }
    },
    "additionalProperties": false
  },
  "guide": "You are the shopkeeper. Steer the viewer to a fit, never invent stock.",
  "recommendation": {
    "enabled": true,
    "preview": "/api/little/recommendation-preview"
  },
  "capabilities": [
    { "name": "commerce.purchase", "reason": "Buy the items you pick on screen" }
  ],
  "content": [
    {
      "name": "lookbook",
      "instruction": "Write a 3-item outfit for the given wash. Titles ≤ 5 words.",
      "schema": { "type": "object", "properties": { "items": { "type": "array" } } }
    }
  ],
  "tools": [
    {
      "name": "open_product",
      "description": "Open a product by id. Resolve the viewer's on-screen reference (e.g. 'the rightmost jacket', 'the cheaper one') to the element's id from the referent map, then pass it.",
      "authority": "read",
      "params": {
        "type": "object",
        "properties": { "id": { "type": "string", "description": "Product id from the referent map." } },
        "required": ["id"]
      }
    },
    {
      "name": "add_to_cart",
      "description": "Add a product to the cart by id.",
      "authority": "mutate",
      "params": {
        "type": "object",
        "properties": { "id": { "type": "string" }, "qty": { "type": "integer", "minimum": 1, "default": 1 } },
        "required": ["id"]
      }
    },
    {
      "name": "checkout",
      "description": "Begin checkout for the current cart.",
      "authority": "consequential",
      "params": { "type": "object", "properties": {} }
    }
  ]
}
```

### Fields

| Field | Notes |
|---|---|
| `id` | Stable app id (usually supplied by the catalog on publish). |
| `title` | Human title (launcher, consoles). |
| `description` | **Written for the model**: the routing copy (when to launch). |
| `url` | Your origin. Its presence tells the host to load over the SDK. |
| `launchSchema` | **The one launch contract.** A strict JSON Schema for the params delivered to `onEnter`. The host validates against it, and the agent reads it (types, enums, `required`, every `description`) as its guidance, exactly as a tool's `params` reaches the agent. Root `type: "object"` with `additionalProperties: false`; without a valid schema the host accepts only empty params. Write each property's `description` **for the agent**; use the root `description` for guidance that spans properties. There is no separate prose field. The old `launch` string is retired; `little manifest validate` flags it and says where the text belongs. |
| `guide` | Optional **steering copy for the agent** that drives your app: its role, rules and tool discipline. The platform's own rules always win. At most 4,000 characters; publish truncates a longer guide. The runtime twin is `app.setGuide()` (see [Runtime steering](#runtime-steering-setactivetools-and-setguide)). |
| `tools[]` | The actuation contract (below). |
| `content[]` | Content types you ask the platform to produce and your app renders. See below. |
| `capabilities[]` | Host powers you request (identity, camera, mic, purchase, …), granted on the handshake. See below. |
| `recommendation` | Contextual discovery opt-in and optional app-owned dynamic card preview. See below. |
| `art` | Optional tile art: `poster` (portrait, 3:4), `icon` (a small square mark) and `tint` (a `#rgb`/`#rrggbb` brand colour). Each asset is a path resolved against your `url`, or an absolute URL. Without art the host draws a generated placeholder. |
| `invitationEndpoint` | Optional same-origin path (e.g. `/api/little/rooms`) Little POSTs to for a room while your app is closed. Requires a `launchSchema` with a string `roomId` and no other required field. See [Social](#social-invitations-and-livestreams). |
| `answers` | Optional `queries` (read-only data Little uses in an answer) and `actions` (what your server does for a viewer's background task), both while your app is closed. See [Answers](#answers-data-without-opening-your-app) and [Actions](#actions-work-for-a-background-task). |
| `signIn` | **Set by the platform, not by you.** It carries the sign-in client your publisher registered (`little sign-in create`); anything you write here is dropped at publish. |

### Tool

| Field | Notes |
|---|---|
| `name` | The tool id; `data-little-action` values must match a tool `name`. |
| `description` | **Written for the model**: when/why to call it. |
| `authority` | `read` \| `mutate` \| `consequential` (empty ⇒ `read`). |
| `params` | JSON Schema, identical to the OpenAI function-calling `parameters` object. |

> **The single most common failure:** a tool that takes arguments but declares no
> `params`. The agent then calls it with **none**. Always declare `params` for any
> tool with args. A tool with no `params` is a **no-arg** tool.

### ContentType (`content[]`)

Content the platform produces and your app renders. You declare the *shape*,
never run a model. You never hold a key; the platform generates the data (validated
against your schema before it reaches you) and meters it as an ordinary turn. You
request one at runtime with `app.compose(name, …)` (or `app.image` / `app.music`).

| Field | Notes |
|---|---|
| `name` | The content id your app requests (e.g. `board`, `page`, `lookbook`). |
| `instruction` | Reusable guidance for this content: the role + guardrails, folded into the turn as trusted policy. Optional. |
| `schema` | JSON Schema the output is validated against (text content). Omit for an `image`/`music` type. |
| `kind` | `"image"` or `"music"` for those modalities; empty/omitted ⇒ typed text (`compose`). |
| `depth` | `"deep"` for data worth waiting for (a whole deck, a long report): a stronger model reasons before it writes, tens of seconds per reply; if it fails or takes longer than about two minutes the platform composes a quick reply instead. Empty/omitted ⇒ quick. Keep a type you race against a short timer quick. Data only; pinned types only (an inline request is always quick). |

### Capability (`capabilities[]`)

A power your sandboxed page cannot hold itself: a camera, a microphone, a brokered
vendor token, a charge, identity. **Declare** it here; the host **brokers** it and
keeps the secret, reporting what it granted on the launch handshake. Read the grant
with `app.can(name)`.

| Field | Notes |
|---|---|
| `name` | The capability id. The complete set you can declare: `identity.signIn`, `identity.signOut`, `notifications.getSubscription`, `location`, `voice.say`, `voice.config`, `sense.motion`, `sense.pose`, `sense.speech`, `media.camera`, `media.mic`, `media.liveMic`, `media.vendor`, `commerce.purchase`, `assets.pick`, `assets.list`, `assets.save`, `assets.remove`, `assets.receive`, `social.invite`, `social.livestream`, `input.gamepad`. Anything else comes back denied. |
| `reason` | **Written for the viewer.** The host shows it on the permission card when it asks the viewer to allow a capability. |
| `scope` | An optional capability-specific qualifier. For `location`: `city` (default, ~10 km) or `precise`. |

`media.playback` exists in the wire contract but is **not available to third-party apps**:
the host grants it only to first-party apps, so do not declare it. `identity.getSession`
needs no declaration of its own; it rides the `identity.signIn` grant.

**Permissions.** Some capabilities ask the viewer the first time your app uses them: the
camera (`media.camera`, `sense.pose`, `sense.motion`, one answer for all three), the
microphone (`media.mic`), speech (`sense.speech`), My Stuff (`assets.list`, `assets.save`,
`assets.remove`, one answer for all three) and `location`. The card names your app and
shows your `reason`. An allow is remembered per viewer profile until they take it back in
Settings, which ends a stream it fed at once. A decline returns `declined` without asking
again until your app closes; an unanswered card returns `declined` and may be asked again.
A kid's profile cannot answer, so those calls return `declined` there. `app.can()` stays
true while a permission is undecided or declined, so always handle `declined` at the call.

A capability the host doesn't grant is simply absent, so always handle the not-granted
path (`if (app.can(...)) …`). See §Capabilities & content for each method.

### `authority`: the consequence rail

- `read`: free (open, filter, navigate).
- `mutate`: reversible/undoable (add to cart, edit a field).
- `consequential`: payments, identity, posting, physical actions. Gated by the
  platform confirmation + identity rail, and **never authorizable by page
  content.** Reserve it for real consequences.

### Sizing your app for the TV

A TV is a ten-foot screen the viewer never resizes, and it comes in every resolution.
You don't manage any of that: there is **one canvas** and the platform scales it:

1. **Build at 1920×1080.** Design and lay out as if every TV is exactly this size.
   There is no `viewport` field and no fit modes to choose. The host renders your app
   at this canvas and scales the whole surface to the panel, so it looks identical
   everywhere.
2. **Use `px` and `%`.** Because the platform scales your app as one piece, plain pixels
   stay in proportion on every TV. **Don't use `vw`/`vh`**: they don't mean what you
   expect once the app is scaled.
3. **Keep important things inside the safe area.** The host publishes the overscan margin
   as CSS variables that are always defined (`0` in a window, a real margin on a TV that
   crops its edges). Pad your root with them so nothing critical is cut off:
   ```css
   .app-root {
     padding: var(--little-safe-top) var(--little-safe-right)
              var(--little-safe-bottom) var(--little-safe-left);
   }
   ```
4. **Make text and targets big enough for a couch,** and give every focusable element a
   clear focused state for remote navigation.
5. **You don't need media queries or breakpoints.** One canvas, one layout.

While you develop on `localhost`, the SDK reproduces this automatically: the page
renders in a letterboxed 1920×1080 stage exactly like a TV (pass `connect({ devScale:
false })` to opt out). Perception is unaffected: the host scales *outside* your page, so
your `data-little` rects are still measured in the canvas you lay out in.

### `recommendation`: contextual discovery and card previews

An app must opt in before the contextual recommender can promote it beside an answer:

```json
"recommendation": { "enabled": true }
```

This does not affect catalog visibility or manual launch. Apps without the flag remain
available but are not contextual candidates, which is the right default for demos,
labs, and utilities.

Add a root-relative endpoint when an enabled app also needs art derived from launch intent:

```json
"recommendation": {
  "enabled": true,
  "preview": "/api/little/recommendation-preview"
}
```

The host POSTs only the generated launch params as JSON. Return a same-origin
`imageUrl`, finalized `params`, and optional ISO `expiresAt`. The image must be HTTPS;
same-origin loopback HTTP is allowed in local development. The returned image and params
replace the card atomically.

Keep preview work cheap, idempotent, and free of cameras, purchases, or other
consequential behavior. The host calls cross-origin with credentials omitted, so allow
the JSON `POST` and `OPTIONS` preflight through CORS. Preview requests are
unauthenticated in the first version. Empty params must still preserve the app's normal
entrance. A selected card enters through the same `onEnter` / `useLittleEnter`
lifecycle as every other launch.

### Serve the manifest

The host owns the manifest it fetched from `/little/manifest.json`; the app does not
re-declare an imported copy during its SDK handshake.

**Vite**: place the authored file at `public/little/manifest.json`. Vite serves it at
that path in development and copies it to the same path on build.

**Next.js**: keep the file at `little/manifest.json` in the project root and re-serve it
from a route so there's one source:

```ts
// app/little/manifest.json/route.ts
import manifest from "@/little/manifest.json";
export function GET() {
  return Response.json(manifest);
}
```

## 7. Events: the message-back channel

Events are how the agent learns things it can't see: the viewer changed a field, a
timer elapsed, playback ended. Keep names stable and payloads small.

```js
video.addEventListener("ended", () => app.emit("finished", { id: currentId }));
input.addEventListener("input", () => app.emit("note_changed", { text: input.value }));
```

`app.emit(name, data)` only informs the live agent. It does not create inbox,
email or push notifications; use the server notification flow below for those.

The agent may answer an event with a short line, or by calling one of your tools. It
only calls a tool you offer right now (`app.setActiveTools`), and never a
`consequential` one, because an event comes from your page, not from the viewer.

## 8. Verify with the inspector (no TV, no agent)

With no host around it, `connect()` runs an in-page **inspector**. On your page,
in the browser console:

```js
__little.snapshot().prompt              // the exact block the agent is handed
__little.validate(await fetch("/little/manifest.json").then((r) => r.json()))
__little.call("open_product", { id: "sku_3" })  // drive a tool locally, watch it route
```

`window.__little` is typed (the SDK ships a `Window` augmentation), so those
console calls autocomplete. Pass the served manifest explicitly when you want
`validate()` to flag an **action not in the manifest**. The host independently reads
that same `/little/manifest.json` to route and launch the app.

Run `connect({ debug: true })` for an on-page overlay of the live referent map,
toggled with **`A`**. If your app captures that key (a text field, or a calculator
wired to a physical keyboard), pass a different key:
`connect({ debug: { overlayKey: "Backquote" } })` (a KeyboardEvent `code`). These
same calls are on the returned handle (`app.snapshot()`, `app.validate()`,
`app.call()`, `app.report()`) and are dependency-free, so they power **headless CI
tests** of the referent map and tool routing.

```js
// vitest + happy-dom (or a headless browser for real layout)
import { snapshotDom, validateDom, dispatchToDom } from "@kabletv/little-sdk";

expect(validateDom(manifest)).toEqual([]);                            // annotations are clean
expect(snapshotDom().prompt).toMatch(/id=sku_3/);                     // the agent can see it
expect(dispatchToDom("open_product", { id: "sku_3" }).ok).toBe(true); // and drive it
```

`snapshotDom` / `validateDom` / `dispatchToDom` are re-exported from
`@kabletv/little-sdk` and need **no connection**: the escape hatch for checking the
referent map or running `validateDom(manifest)` in CI (or anywhere the live handle
isn't set up), independent of `connect()`/the hooks.

### `little dev`: the real harness on your machine

The inspector shows you what the agent *would* see. `little dev` runs your app inside
the **same app-driving harness the television uses**, in a device-owned window beside a
debug panel: the live perception snapshot, a tool-firing form (play the agent), and a
feed of status, calls, results and narration. Needs a JDK 17+ (§0).

```bash
little dev            # from the project root; Ctrl-C stops everything
little dev --offline  # no network: you drive tools as the agent
little dev --print    # show the resolved plan (JDK, toolchain, app, what lights up) and exit
little dev <verb>     # in ANOTHER terminal while it runs: call / snapshot / events / say / answers / actions (below)
```

With a `little.config.json` at the root (`little init` writes one) `little dev` also
**starts and supervises your dev server**, so it is the only command you run:

```json
{ "appUrl": "http://127.0.0.1:7140", "manifest": "public/little/manifest.json", "dev": "npm run dev" }
```

If something already answers at `appUrl` (you started Vite yourself, or a previous run
is still up) `little dev` uses it and does not start `dev` again, because the scaffold's Vite is
`strictPort`, so a second start would fail. The first `little dev` fetches the simulator
toolchain into `~/.little/toolchain/<cli-version>` with `NODE_AUTH_TOKEN`; it brings its
own registry wiring, so no `~/.npmrc` is needed for that step. When it can't, the error
says exactly why (token unset, refused, or the version unpublished). Do not `npm i` the
toolchain yourself; `little dev` never looks in a global install.

What runs is **detected, not chosen**: `little dev` asks Little what realtime
services it offers and lights up voice, camera, pose and the app agent when they answer;
otherwise the media rails settle truthfully (an app that asks gets a prompt negative,
never a hang) and you fire tools by hand. The startup summary says, per line, what is
live and why not. There are no mode flags to pick.

**Drive the running simulator from a second terminal.** This is how you verify your own
work without a human at the window. Every verb takes `--json`:

```bash
little dev answers --json             # list optional manifest answer queries
little dev answers menu '{"storeId":"101"}' --json # validate endpoint data, content and launch targets
little dev actions --json             # list declared actions (manifest `answers.actions`)
little dev actions save_favorite '{"dish":"Miso"}' --json # call one as Little would: signed as your sandbox call, answer validated (create your verifier with allowSandbox where you test, or it answers 401)
little dev actions place_order --status <operationId> --json # also --cancel <operationId>, --cancel-invoke <requestId>, and --request-id to send an invoke again
little dev snapshot --json            # { prompt, referents }: the referent map the agent sees right now
little dev call <tool> '{"id":"…"}'   # fire a declared tool as the agent would; returns { tool, args, ok, detail }, exit 1 on a failed ack
little dev events --follow            # the live feed (status / say / tool / result / screen); one JSON object per line with --json
little dev say "…"                    # one viewer turn through the agent (when the agent line is live; offline it says so)
little dev pause                      # the app pauses as on the TV's Home (onPause); { state, detail }, exit 1 if refused
little dev resume                     # it comes back as it was left (onResume)
little dev evict                      # closed to make room; the next open gets its saved state (restored)
little dev reboot                     # every window closed as a reboot, the app reopened; { state, restored, detail }
little dev profile kid                # switch the profile on screen (dev or kid); the app closes; storage is per profile
```

**The same verbs drive a real television.** After `little device pair <code>` (the code
from the TV's Settings > Developer; you must be an owner or member of its household), run
`little dev --device <name>`; while it runs, every verb above and `little mcp` reach the
television instead of the simulator. The television connects to your computer over your
network and loads your app from your dev server, so both must be on the same network and a
`localhost` dev server must also listen on your network address (Vite: `--host`). It opens
only private-network origins or ones your publisher verified, and the verbs act only on
your app while it is on screen. Camera and microphone need an `https` origin (a tunnel).
`screenshot`, `environment`, `evict`, `reboot`, `profile` and the purchase script are
simulator-only. Full guide:
<https://docs.little.co/docs/cli/device>.

Events are attributed: a turn's carry its `turnId`, a `call`'s carry its `id`, so the
panel and several terminals can run at once. Offline (no agent line), `sense.pose` and
voice are granted but stay silent; `sense.motion` supplies deterministic transport
fixtures. Test live providers on a television or with the full plane.

**Prefer the `little` MCP tools when you have them.** If your tool list includes tools
from an MCP server named `little`, your editor is running `little mcp` against the same
simulator. Use them instead of shelling out: they return structured results. The tools:

- `status` (call it first), `snapshot` (the referent map), `call_tool` (fire a declared
  tool as the agent would), `say` (one viewer turn), and `events` (a buffer you read from
  a cursor; your app's console arrives there as `log` events).
- `launch` (open the app, optionally with launch params checked against your
  `launchSchema`; `restored` when it got its saved state), `pause` and `resume` (as the
  TV's Home does), `evict` and `reboot` (the TV closing it, saved state kept), `profile`
  (switch the profile on screen), and `reload` (a fresh page load and handshake).
- `environment` (read or change the device settings the app gets on its next launch) and
  `purchases` (script the sandbox purchase rail: an adult or kid buyer, the next charge
  completing or failing, a parent's answer, a refund).
- `screenshot` (a PNG of the screen, plus any platform dialog over it) and `press` (the
  remote: up, down, left, right, select, back, home).
- `validate_manifest` (the offline shape check plus the server verdict), `search_docs`
  and `read_doc` (these docs; `read_doc` accepts an SDK error's `docsUrl`). These three
  need no running simulator.

There is no publish tool; publishing stays a deliberate CLI step. `little init`
writes the editor config (`.cursor/mcp.json` and `.mcp.json`); for an existing project, add
`{ "command": "little", "args": ["mcp"] }` as `little` under `mcpServers` in either file.
The editor starts it, so `little` must be on PATH (`npm i -g @kabletv/little-cli`; `npx`
alone is not enough).
Guide: <https://docs.little.co/docs/cli/mcp>.

## 9. Publish onto a device

Everything is from the terminal (the developer portal at
<https://developers.little.co> is the equivalent web path):

```bash
little manifest validate                 # offline shape check + the server's authoritative verdict
little org create "Acme Studios"         # only if you have no org yet (link/publish also offer it)
little link                              # once per project: bind the dir to a publisher org + app slug
little domains add https://app.example.com      # prove you control the origin (HTTP well-known challenge)
little domains verify https://app.example.com   # re-run to poll
little publish --url https://app.example.com    # fetch → sanitize → pin the manifest → install into the catalog
```

`publish` requires `--url` (the origin that serves `/little/manifest.json`); the slug
comes from `little link` (or `--slug`), and `--status draft|unlisted|published` sets the
status. Without it, an app keeps its status, and a new app is `published`.

Non-interactively (`--json`, CI) an account with no org gets an error naming
`little org create <name>` instead of a prompt; run that first.

`manifest validate` needs no sign-in: the server verdict is anonymous, so unless you pass
`--offline` you are getting it. Its `--json` puts the answer in `verdict`, whose `source`
says which layer produced it: `server` (the authoritative publish check ran;
`verdict.ok` and `verdict.diagnostics` hold it), `skipped` (with `reason` `offline` or
`shape-invalid`, so no server was asked), or `unreachable` (asked, no answer;
`verdict.error` says why). Add `--print-pinned` (or read `pinned` in `--json`) to see the
manifest exactly as the server would pin it. `publish` fetches `/little/manifest.json` from your origin,
sanitizes it, pins it at a content hash and prints the pin diff. If the origin isn't verified yet it walks you
through `domains verify` inline. Add `--yes` to skip the confirmation and `--json` for a
machine-readable result. Afterwards: `little apps status <slug>`, `little apps versions`
(the pin history), `little apps set --category <c>`, `little channels` (release
channels: `publish --channel beta` puts a build on one without changing production, and
`channels promote <slug> beta` serves it in production), `little invite create <slug> --channel <name>`
(a tester invite link, or `--email` to send it to one tester; a tester opens it in the
Little phone app to join, and their televisions open that channel's build, marked Beta, for
`--grant-days` days, 90 by default), `little testers`
(list/revoke who joined, by name and email), `little team` (org members by email), `little products`
(what the app sells) and `little purchases` (its purchases, sandbox unless `--live`; refund
one to test losing an unlock, and a live refund asks first unless you pass `--yes`).

---

## Capabilities & content (host powers + generated content)

Perception and tools make your app *seen* and *driven*. Two further surfaces let it
reach platform-generated content and host-held resources. Both are **declared in the manifest**
(§6) and neither ever puts a key, a token, a camera, or a charge inside your page.

### The shared model: declare → grant → gate

- **Content** (`compose`/`image`/`music`) is *not* a capability: it holds no secret,
  so it needs no grant and no `app.can()`. Declare a `content[]` type (or go inline)
  and call it. It's metered as an ordinary agent turn.
- **Capabilities** (`identity`, `notifications`, `location`, `voice.*`, `sense.*`,
  `media.*`, `commerce.*`, `assets.pick`, `social.*`, `input.gamepad`) are host-brokered powers. Declare
  each in `capabilities[]`; the host resolves it against the pinned manifest, what the
  account is entitled to, and what this host can provide, and reports the result on the
  handshake. A few powers also ask the viewer at the moment of use (the `location` card,
  the sign-in approval, the purchase card, the asset picker). **Gate every capability call
  on `app.can(name)`**: it returns `false` before the handshake lands and always in the
  inspector (no host), so "not granted" is a normal, handled state, never an exception.

```ts
app.onEnter(({ granted, denied }) => { /* the resolved capability names */ });

if (app.can("voice.say")) {
  await app.voice.say("Welcome back.");
} else {
  // not granted, or running headless: degrade gracefully
}
```

Every one-shot host call resolves a **Result envelope** (`{ ok, error?, …data }`) and
**never throws** for an expected negative (no host, denied, declined). On failure `error`
is a structured **`LittleError`**: `{ category, code, message, viewerHint?, retryable,
requestId?, docsUrl }`. Switch on the stable `error.code` (never parse `message`), use
`error.category` for a coarse strategy, `error.retryable` to decide whether to retry, and
`error.viewerHint` for the line to say to the viewer. Handle the codes you care about and
let a `default` fall back on `error.retryable`/`error.viewerHint`; if you handle every code,
a local `assertNever(x: never)` helper in the `default` makes the compiler flag any you
missed. The full code set is the [Errors reference](https://docs.little.co/docs/errors). Every stream is `x(onFrame, opts?) → Unsubscribe` and a
no-op with no host or no grant.

### Content: the platform writes, you render

Ask the platform for typed data your app renders. You declare the shape, never operate a
model. Name a manifest `content[]` type (its pinned `instruction`/`schema` apply) or
pass an inline `instruction`/`schema`; supply per-call `context`/`hint`.

```ts
// pinned policy (declared once in the manifest), dynamic data every call
const board = await app.compose("board", { context: { existing }, hint: "go deeper on food" });
if (board.ok) render(board.data);          // { ok, data }; never throws
// or fully inline, no pre-declared type:
const page = await app.compose({ instruction, schema, context });
```

Two more modalities ride the same rail:

```ts
const art = await app.image("hero", { hint: "a foggy pine ridge at dawn" });
if (art.ok) img.src = art.url;             // { ok, url }, a data: URL today

const bed = await app.music("ambient", { hint: "calm, sparse, hopeful" });
if (bed.ok) audio.src = bed.url;           // instrumental; call early, fade in when it lands
```

### `identity`: Sign in with Little

The host brokers the OAuth flow. Your app gets a signed **assertion** plus the claims
inside it; the Little access token stays with the host.

Requires that your publisher registered a client for this app. Without one,
`app.can("identity.signIn")` is false and the call is denied, because an approval the
viewer grants has to name the app that asked. Register it from the app directory (the
redirect must be on a verified domain; the secret prints once):

```bash
little sign-in create --redirect https://app.example.com/auth/callback \
  --scope openid profile offline_access   # offline_access: getSession can restore silently
```

```ts
// 1. The host runs the flow; the viewer approves on their phone.
const res = await app.identity.signIn({ scopes: ["profile", "email"] });

// 2. Send the ASSERTION to your backend. Never the claims.
if (res.ok) await fetch("/auth/little", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identityToken: res.identityToken }),
});

await app.identity.signOut();               // host revokes and drops what it holds
```

**The one rule that matters: `claims` is for pixels, `identityToken` is for servers.**
`res.claims` is plain JSON sitting in your page, so it is something your page could have
made up: a backend that trusts it is trusting the app, not Little. Render with it, key
nothing on it.

On your server, verify it with `createVerifier` from `@kabletv/little-sdk/server`, then mint
your own session:

```ts
import { createVerifier } from "@kabletv/little-sdk/server";

const little = createVerifier({
  apiUrl: process.env.LITTLE_API_URL ?? "https://api.little.co",
  appId: "my-app",
  clientId: process.env.LITTLE_CLIENT_ID,   // the audience: addressed to YOU
});

const result = await little.identityToken(identityToken);   // signature, issuer, audience, ≤5 min old
if (!result.ok) throw new Error(result.error.code);        // invalid | expired | unavailable

// One assertion, one sign-in. Remember what you have already accepted.
const { replayKey, expiresAt, subject, claims } = result.identity;
if (await cache.has(replayKey)) throw new Error("replay");
await cache.set(replayKey, true, { expiresAt });
```

The freshness bound and that cache are the replay control, and neither is optional. Little
assertions expire in **five minutes** (pass `{ maxAge }` to tighten it), and `replayKey` is the
token's SHA-256: keep each until `expiresAt`. There is no `nonce` claim on this flow (the TV
sign-in runs the device grant, which has no authorization request to carry one), so do not
write a check against it. (OIDC Core leaves the replay-detection method to you; this is ours.)
Backend not in TypeScript? Verify over HTTP: <https://docs.little.co/docs/server/http>.

Everything granted is *inside* the token (`sub`, and with `profile` / `email` the
viewer's name, picture and address), so one verification gives you a signed copy of all
of it. `res.claims` is the same payload decoded for rendering; they cannot disagree,
because the host reads one out of the other.

Three things that surprise people:

- **Do not link accounts on the email alone.** `email` arrives with `email_verified`.
  Unless that is `true`, Little has not confirmed the viewer controls the mailbox, and
  merging on it lets a stranger walk into an existing user's account. Absent means false.

  ```ts
  if (claims.email && claims.email_verified) linkToExistingUser(claims.email);
  else createSeparateAccount(subject);
  ```

- **`sub` is yours alone.** The same viewer is a different `sub` in every other app on
  the television, so never expect it to match a subject you saw in someone else's
  product. It is per *client*, not per surface: your own website matches if it signs in
  under the same registered client, which is how a viewer's TV and web accounts join up.
  Sign in on your website: <https://docs.little.co/docs/server/web-sign-in>.
- **The assertion is a receipt, not a session.** It is short-lived and single-use by
  design. Verify it once and issue your own cookie; do not attach it to every request.

#### Calling your own API

Little issues nothing for this, on purpose. Once you have verified the assertion, mint
your own session (a cookie, your own JWT, whatever your stack already uses) and
authenticate your API calls with that. It is the Sign in with Apple shape: we tell you
who signed in, and you stay the authority on your own service.

### Location: where the television is

Declare `{ "name": "location", "reason": "…" }` (add `"scope": "precise"` only if you
need more than the town), then call `app.location.get()`. It resolves
`{ ok: true, latitude, longitude, accuracy, place }` or `{ ok: false, error }`. The first
call raises a permission card naming your app and `reason`; an allow is remembered per viewer profile.
`city` scope rounds the point to about 10 km; `accuracy` is 10000 at either scope today,
since every source is town-level. Handle `declined` (the viewer said no or left the card
unanswered), `unavailable` (no location known yet; nobody was asked; ask for a town in
your own UI), `denied` (not declared, or this host cannot answer), `busy` (another
question is on screen) and `paused` (ask again after `onResume`).
`app.can("location")` means the host can answer, not that the viewer allowed it. Do not
use `navigator.geolocation`: the television has no position to give it. In the simulator,
`little dev environment location="40.68,-73.94|Brooklyn"` sets one (and
`permissions="location=city"` skips the card).

### Notifications: permission, server submission and re-entry

Notification support is a preview: use matching SDK, API and TV host builds. Check
the installed SDK types and host capabilities before using it; do not assume an
older published SDK includes this integration. There is no feature flag to add.

**Browser: restore sign-in and read permission.** Merge these capabilities into
your app's manifest:

```json
{
  "capabilities": [
    { "name": "identity.signIn" },
    { "name": "identity.signOut" },
    { "name": "notifications.getSubscription" }
  ]
}
```

The app needs its own registered public sign-in client. Persistent sign-in requires
that registration to allow `offline_access` and `refresh_token`, plus the viewer's
approval.

```ts
// On entry: never open approval or send a notification automatically.
if (app.can("identity.getSession")) {
  const restored = await app.identity.getSession({ scopes: ["profile"] });
  if (restored.ok && restored.session) {
    // Render claims; exchange identityToken with your backend for a verified session.
  } else if (restored.ok) {
    // No saved session: offer Sign in with Little.
  } else {
    // Restore failed: show a retry, not another automatic QR prompt.
  }
}

// Bind this handler to the viewer's Sign in with Little action; do not call on entry.
async function onSignInClick() {
  if (!app.can("identity.signIn")) return; // Show unavailable UI as appropriate.
  const signedIn = await app.identity.signIn({ scopes: ["profile"] });
  // Handle !signedIn.ok; otherwise exchange signedIn.identityToken with your backend.
  // The Little-owned approval screen offers optional notifications.
}

// Lookup only; can() is capability support, not notification consent.
if (app.can("notifications.getSubscription")) {
  const subscription = await app.notifications.getSubscription();
  // !ok = lookup failure; ok + null = not subscribed; ok + ID = subscribed.
}
```

`identity.getSession` uses the `identity.signIn` grant; it needs no separate
manifest capability. `signIn` also restores an approved session before prompting.
Use `prompt: "consent"` only when the viewer explicitly chooses to review
permissions, not before every send. Declining notifications must still allow
sign-in. On sign-out, call `identity.signOut()` and clear your app's own
session/UI; never persist decoded claims or an assertion as authentication.

There is no browser `notifications.subscribe()`, `notifications.emit()` or
`notifications.openSettings()`.
Little owns consent and delivery settings. Lookup takes no app/profile/channel
inputs: the host supplies the current app and verified TV profile.

**Backend: verify the viewer, then request delivery.** Exchange the fresh
`identityToken` from sign-in/restoration once with your backend. Verify it with
`createVerifier({ …, clientId }).identityToken(token)` and refuse a repeated `replayKey`
before creating your own session. Never just decode it.
The verified `https://little.co/notifications` claim (in `result.identity.claims`) holds
`{ bindingId, subscriptionId }`; bind it to the verified subject. A missing claim
or null subscription is not permission. Do not trust a subscription ID supplied
by page JavaScript or allow callers to choose other recipients.

Import the server entry only in your backend. The confidential notification
producer credential is separate from the public sign-in client; never put it in
browser code, `VITE_*`, `NEXT_PUBLIC_*`, logs or notification payloads. Mint it with
`little notifications credentials create` once the app is published or unlisted
(owners/admins; the secret prints once) and revoke it with
`little notifications credentials revoke <client-id>`.

```ts
import { createClient } from "@kabletv/little-sdk/server";

const little = createClient({
  apiUrl: config.littleApiOrigin,
  clientId: config.notificationClientId,
  clientSecret: config.notificationClientSecret,
});

const result = await little.notifications.emit({
  subscriptionId: verifiedSubscriptionId, // Little-issued UUID bound to your user
  idempotencyKey: notificationOperationKey, // Persist one key per logical notice
  message: {
    title: "Your update is ready", // Plain text; maximum 60 Unicode code points
    body: "Open the app to continue.", // Maximum 180 Unicode code points
  },
  launchParams: { referenceId: updateReference }, // Optional app-owned lookup key
});

if (result.ok) {
  // { notificationId, status: "accepted" }: saved, NOT proof of delivery.
} else {
  // Inspect result.error.code and .retryable; do not log credentials or tokens.
}
```

These are the currently enforced preview limits: title/body 60/180 code points,
idempotency key 128, reference ID 256. Text must be nonblank, single-line and free
of disallowed control characters; do not silently truncate. Omit `launchParams`
to reopen the root. Do not add event categories, template keys, arbitrary `data`,
channels, app IDs, raw URLs, caller-selected expiry or `sendAt`. Your backend owns
when to request a notification; Little owns eligibility, deduplication, spam
limits, inbox creation and email/push routing under the viewer's preferences.

**Retry and suppression rules.** Persist the key and immutable payload together.
Retry a timeout or retryable failure with the same key and unchanged payload,
using bounded exponential backoff with jitter; the SDK does not retry for you.
Changed input with the same key conflicts. A genuinely new event gets a new key,
not a lost response or refreshed identity assertion. Permission changes,
cooldowns and budgets can suppress alerts; never rotate keys or re-prompt to
bypass them. Read/dismiss before delivery skips that external alert. An inbox item
without a push can be correct; accepted is not a delivery guarantee.

**Re-entry.** Declare `referenceId` in the pinned manifest's `launchSchema`.
Handle `onEnter({ params })` (or React `useLittleEnter`) through the normal
lifecycle; `params.referenceId` is your lookup key, not Little's
`launchRequestId`. Resolve it in your backend under the current user's authority.
Schema validation checks shape, not access to your data. Missing, stale or
unauthorized references need a safe root/unavailable view; preserve existing
game/app state. Never auto-accept an invitation, place a bet or emit another
notification merely because the app opened. Little handles phone confirmation
and TV launch authorization; apps do not implement the relay.

**Verify:** approve once, send distinct notices and reopen without repeated QR
prompts; decline notifications without blocking sign-in; sign out/change profile
without leaking identity; retry one key without duplicates; distinguish
suppression from failure; reopen with valid/invalid references.
Inspector/mocked tests do not prove native consent, OS push arrival or phone-to-TV
display.

### `voice`: governed hooks into the voice pipe

These hooks never hand your app the mic or a transcript; the agent owns the turn (for
app-owned audio, see `media.mic` below). Two governed hooks (require `voice.say` /
`voice.config`):

`voice.say` resolves when playback ends, including interruption. Its result adds
`interrupted?: boolean`: false proves real completion; true means the line was cut
off. It is absent on older hosts or a lost playout callback. Keep `ok` compatibility:
ok alone does not prove the whole line played. Pause a narrated sequence unless
`result.ok && result.interrupted === false`; never infer completion from elapsed time.

```ts
const line = await app.voice.say("Muy bien. Try the next line.", { language: "es-ES" });
if (line.ok && line.interrupted === false) nextLine();

await app.voice.say("Time's up!", { interrupt: true }); // cut off whatever is speaking now

await app.voice.config({
  lang: "es-ES",
  hints: vocab,
  context: "Spanish vocabulary practice.",
  feedback: { hideProcessing: true, compactTranscript: true, interruptStaleReplies: true },
}); // an acceptance result; it biases recognition
```

`say` requests narration (TTS); its `language` retunes **only that line**, and
`interrupt: true` cuts off current speech instead of waiting behind it. `config` pushes
recognition preferences *up* to the platform while your app is focused. It is
**stateless**: each call replaces the whole config (call it again to change the bias; the
host resets on blur/exit), and it only sharpens what the *agent* hears.

- `context` is a short factual description of the current domain or scenario, updated
  alongside dynamic vocabulary. Omitting it (or passing it empty) clears the previous
  context. Recognizers that support it use it; others ignore it and keep transcribing.
  The platform bounds it to 2,000 Unicode characters. Describe likely speech, never
  instructions to rewrite it or execute commands.
- `feedback` opts out of parts of the host's ambient voice UI while your app is in
  front: `hideProcessing` hides the processing copy, `compactTranscript` shows a single
  line transcript that settles 500 ms after recognition, and `interruptStaleReplies`
  cuts off an older host reply once a newer app action succeeds. Omitting it restores
  the defaults. It never changes capture indicators, permission or purchase UI, or your
  own `voice.say` audio.

SDK acceptance is not proof of improved recognition.

### `sense`: derived perception (never raw pixels/audio)

The host runs the models and recognizers and streams only the derived results (keypoints,
motion evidence, transcript text) to your app. Your app never receives raw video, audio,
or the mic through these.

```ts
if (app.can("sense.speech")) {
  const stop = app.sense.speech(({ text, final }) => renderCaption(text)); // read-only tap
}
if (app.can("sense.pose")) {
  const stop = app.sense.pose((frame) => updateSkeleton(frame), { fps: 12 });
}
if (app.can("sense.motion")) {
  const motion = app.sense.motion(
    {
      onCapabilities: (capabilities) => configure(capabilities.channels),
      onStatus: (status) => showStatus(status.state, status.reason),
      onFrame: (frame) => updateMotion(frame),
    },
    { channels: ["body.pose-2d"], rateHz: 20, maximumEntities: 1 },
  );
  motion.close(); // callable motion() and motion.unsubscribe() are equivalent
}
```

`sense.speech` is a **read-only tap** of the transcript the platform is already producing
(interim `{ final: false }` → committed `{ final: true }`); it never diverts the transcript
or takes the turn. **`sense.pose` is live wherever the host provides a pose provider:** the
host owns the camera and runs the model, streaming only COCO-17 keypoints (never pixels).
That holds on a television and in `little dev` when the realtime services are live, so
`app.can("sense.pose")` is `true` there. The **inspector** (no host) has no provider, so
always handle the not-granted path.

`sense.pose`, `sense.motion` and `createMotionSession` take `accuracy: "standard" | "high"`
(default `"standard"`). `"high"` runs a larger pose model for steadier keypoints on hard
poses and costs the television more, so ask for it only when your app needs it. It is a
request: the camera runs one model at the highest accuracy any open stream asks for, and a
television that cannot serve `"high"` serves `"standard"`. The output shape is the same
either way, so never branch on which one you got.

`sense.motion` is the model-neutral evidence stream: negotiated semantic capabilities,
explicit provider status, and timestamped observed/retained/predicted/missing frames.
Apps request channel IDs, never provider/model names. The SDK performs no tracking,
calibration, feature extraction, gesture recognition, or application mapping. No-host
and denied calls report one explicit unavailable status and return an already-closed,
idempotent subscription.

### Semantic motion MDK: actions, held states, controls and players

Use `@kabletv/little-motion` when your app needs semantic behavior such as a jump,
squat repetition, held shield, cursor or steering value. Use `sense.motion` directly
only when the app genuinely needs model-neutral evidence and will own its
interpretation. Do not copy pose thresholds or import the private motion core.

Install the SDK and Motion package, then declare `sense.motion` in the manifest:

```json
{
  "capabilities": [
    {
      "name": "sense.motion",
      "reason": "Control the game with semantic motion."
    }
  ]
}
```

```ts
import { connect } from "@kabletv/little-sdk";
import { createMotionSession } from "@kabletv/little-motion";

const app = connect();
const motion = createMotionSession(app, {
  actions: ["both-arms-raise", "squat-rep"],
  held: ["arms-spread"],
  controls: ["right-hand-cursor", "torso-lateral-lean"],
  participants: {
    minimum: 1,
    maximum: 2,
    assignment: { mode: "spatial" },
  },
});

const leaveStatus = motion.onStatus((status) => updateAvailability(status));
const leaveResult = motion.onResult(({ actions, held, controls }) => {
  for (const event of actions) {
    if (event.phase === "confirmed") applyActionOnce(event);
  }
  renderHeldStates(held);
  applyControls(controls);
});

// App teardown:
leaveStatus();
leaveResult();
motion.close();
```

The request names semantics, not provider/model names or detector settings. Read
`MOTION_SEMANTICS` for public lifecycle and qualification metadata; the valid ids are
`MOTION_ACTION_IDS`, `MOTION_HELD_IDS` and `MOTION_CONTROL_IDS`. Pointer dwell
and select are target-agnostic; your app owns hit testing and never sends target
geometry into the MDK.

Actions are live edges. A confirmed action is exactly once and does not appear in
`snapshot().result.actions`; still make effects idempotent with `playerSlot`,
`instanceId` and phase. Held states and controls are current snapshots and can
repeat. Treat unavailable required controls as neutral/no input and never reuse a
stale value or synthesize motion.

`onStatus` is a snapshot stream, not a transition emitter or app clock. The object
and `atMs` can change at provider cadence. Never make a countdown, timeout,
interval or UI effect depend on the complete status object, and never schedule UI
from motion timestamps. Derive stable app-owned gates and use app-owned wall-clock
or fixed-step reducer time. For example, in React:

```ts
import { useEffect } from "react";

const minimumPlayers = motion.request.participants?.minimum ?? 1;
const requiredControlIds = ["torso-lateral-lean"] as const satisfies typeof motion.request.controls;
const providerBlocked =
  status.state === "unavailable" ||
  status.state === "closed" ||
  (status.state === "paused" && status.reason === "provider-degraded");

const controlEvidenceReady =
  requiredControlIds.length > 0 &&
  (status.participants === undefined
    ? requiredControlIds.every((id) =>
        latestControls.some(
          (control) =>
            control.id === id &&
            control.playerSlot === undefined &&
            control.state === "active",
        ),
      )
    : status.participants.filter(
        (participant) =>
          participant.state === "active" &&
          requiredControlIds.every((id) =>
            latestControls.some(
              (control) =>
                control.id === id &&
                control.playerSlot === participant.slot &&
                control.state === "active",
            ),
          ),
      ).length >= minimumPlayers);
const phaseReady = !providerBlocked && controlEvidenceReady;

useEffect(() => {
  if (!phaseReady) return;
  const timer = window.setTimeout(advancePhase, delayMs);
  return () => window.clearTimeout(timer);
}, [phaseReady, delayMs]);
```

This is a control-gated phase, so `requiredControlIds` is deliberately non-empty.
For an action-only phase, enter only from a stable `status.state === "ready"` plus
the configured active-player quorum, then consume its exactly-once action edges.
Never represent action readiness with an empty control list.

Status is aggregate across every requested semantic. Decide which semantics gate
the current app phase. A lobby-only cursor can report `waiting-for-evidence`
without making gameplay controls unusable. Provider/session terminal conditions
and required unavailable controls remain fail-closed.

Multiplayer is opt-in. `minimum` is the ready-player quorum; `maximum` is slot
capacity, up to four. Outputs include `playerSlot`. Keep one session when slots
must survive phase changes, preserve committed app state through transient
non-gating loss, and continue to honor slot vacancy, replacement, epoch and
terminal lifecycle from the MDK.

In `little dev --offline`, `sense.motion` supplies deterministic evidence fixtures.
That proves app wiring and lifecycle, not physical recognition. A live test without
`--offline` is required to verify the camera/provider path and real movement.

### `media`: governed camera + microphone + live mics + brokered vendor tokens

```ts
const cam = await app.media.camera({ facing: "user" });
if (cam.ok) { videoEl.srcObject = cam.stream; /* … */ cam.stop(); } // host owns the on-air indicator
const mic = await app.media.mic({ echoCancellation: false });
if (mic.ok) { new AudioContext().createMediaStreamSource(mic.stream); /* … */ mic.stop(); } // its own mic light
const grant = await app.media.vendor("decart");                     // short-lived, per-app token
const invited = await app.media.liveMic.invite({ label: "Ana", fallback: anaStream }); // a phone's mic, played in the room
```

`media.vendor` is for vendors the PLATFORM holds the account with: it mints a short-lived,
origin-scoped credential server-side so page content never sees a platform key. It is not
bring-your-own. If the account is YOURS, don't ask for a capability at all: your app is a
website, so keep the key in your own backend and mint there. Only wired vendors resolve;
anything else answers `unknown vendor`. **`media.camera` is live:** the host gates the camera
(grant + on-air indicator) and your app receives the track under the grant, on a television
and in `little dev` alike. Only the inspector has no camera, so keep gating on
`app.can(...)`.

**`media.mic` mirrors `media.camera`:** the host gates the mic (grant + its own microphone
light, independent of the camera) and your app opens the audio under the grant. Prefer
`app.media.mic()`. It returns the Result envelope every capability does and is a handled
no-op in the inspector, so a refusal is never a thrown exception. Your app's audio never
reaches the agent. An app mic grant blocks ambient platform recognition and managed speech
actions. Explicit host push-to-talk suspends app audio and resumes the same live grant
after the host turn and reply playback finish; Back/Home remain available.

For app-owned speech, use `app.media.mic({ onState({ state, reason, generation }) { ... } })`.
States are `active`, `suspended` and `closed`. Synchronously cancel app speech/actions on
suspension or closure, fence late model/tool callbacks with the generation, and continue
input only on `active`. Pause, close, track loss or disconnect revoke capture. An older
host without notifications returns `no_host` when `onState` is requested.

```ts
if (app.can("media.mic")) {
  const mic = await app.media.mic({ echoCancellation: false });
  if (mic.ok) {
    const source = new AudioContext().createMediaStreamSource(mic.stream);
    // ... score pitch, mix with your backing track, record ...
    mic.stop(); // releases the mic; the light goes out here
  }
}
```

**Existing web audio libraries work unchanged.** `app.media.mic()` is sugar over the
browser's own `getUserMedia({ audio })`, which the host brokers, so a library (or your own
code) that calls `getUserMedia` directly gets the same grant and light, and the same denial
(`NotAllowedError` without the capability). Stopping the last audio track is the release
either way. Combined `{ audio, video }` requests work through the raw path; the two tracks
arrive in one stream (video still needs `media.camera`).

**`media.liveMic` plays a phone's microphone in the room through the television**, for apps
that use phones as microphones (karaoke, party games, a toast). Playing a phone's audio in
your page adds enough delay that singers hear an echo; a live mic plays the phone through
the television itself. It connects in four steps: your app calls `invite()` and gets an
invitation (a string); it sends the invitation to its phone page over its own connection;
the phone page passes it to `accept()` from `@kabletv/little-phone`, which opens the
microphone and returns a reply; your app passes that reply to `mic.connect(reply)`. The
audio then goes phone to television over the home network, never through your page, so keep
your own connection for scoring or recording. Pass the stream you already receive from that
phone as `fallback`: the SDK plays it in your page whenever the television isn't playing the
phone (while it connects, while its connection is down, after the mic ends on its own), so
never play that stream yourself while the mic exists. `available` is true where the host
granted `media.liveMic`: a television, and also `little dev` and the desktop television,
which play phones through the computer's speakers. The inspector doesn't grant it, so keep
your own playback when it is false.

```ts
// Your app, on the television
const liveMic = app.media.liveMic;
const invited = liveMic.available
  ? await liveMic.invite({ label: "Ana", volume: 1, fallback: anaStream }) // volume 0..1
  : null;
if (invited?.ok) {
  sendToPhone({ invitation: invited.invitation });              // over your own connection
  onPhoneReply((reply) => invited.mic.connect(reply));           // invalid_args: not its reply, ended, or unusable
  invited.mic.onChange((mic) => render(mic.state, mic.reason, mic.delayMs));
  await invited.mic.setVolume(0.5);                              // works while paused
  // when the phone leaves your app: await invited.mic.end(), which also stops the fallback
} else {
  playInPage(anaStream); // invited.error.code: not_granted | paused | busy | invalid_args | unavailable | no_host
}
```

```ts
// Your phone page (npm i @kabletv/little-phone, the same version as your SDK)
import { accept } from "@kabletv/little-phone";

const accepted = await accept(invitation); // opens the mic raw: no echo cancellation, noise suppression or AGC
if (accepted.ok) {
  sendToTelevision({ reply: accepted.reply });
  accepted.mic.onChange((mic) => show(mic.state, mic.reason)); // connecting | live | ended
  // accepted.mic.end() ends it from the phone, and the television's mic ends with "left"
} else {
  show(accepted.error.code); // denied | expired | invalid_args | unavailable
}
```

`mic.state` is `waiting` (invited, not playing yet), `heard` (playing in the room), `silent`
(connected, but your app is off screen or the volume is 0), `trouble` (the phone's
connection dropped or its audio stopped arriving, and the television is waiting for it) or
`ended`, with `reason`:
`stopped` (you called `end`), `left` (the phone ended it), `expired` (no reply connected
within a minute of the invitation), `unreachable` (the phone couldn't reach the television
from its network, or didn't come back), `failed` (the television couldn't play it; an
unknown reason reads as `failed`) or `closed` (your app's window closed or reloaded).
`delayMs` is the latest measured delay from the phone sending to the television's speaker
(the computer's speakers in `little dev`), without the phone's capture time, and null until
measured.

A live mic belongs to your app's window: silent while it is paused, heard again on resume,
ended with `closed` when it closes or reloads. Only the app on screen can invite (`paused`
otherwise), but `connect`, `setVolume` and `end` work while paused; `busy` means the television is already playing as many phones as it can. An
invitation is good for one phone, once. Pass `accept` a `track` to choose your own
microphone settings (it then leaves that track running). The phone page must be https, and
the phone must reach the television directly on the home network (in `little dev`, be on
the same network as your computer): on mobile data or an isolating guest network the mic
ends `unreachable`, and the fallback keeps the phone heard.
In React, `useLittleLiveMic({ label, volume, fallback })` from `@kabletv/little-react`
invites while the component is mounted and the app is on screen, returns
`{ available, invitation, mic, state, reason, delayMs, error }`, sends a changed `volume`,
and ends the mic on unmount.

### Game controllers: `input.gamepad`

Declare `{ "name": "input.gamepad", "reason": "…" }` and read a paired controller
(DualSense, Xbox) with the browser's own Gamepad API: poll `navigator.getGamepads()` each
`requestAnimationFrame`, `standard` mapping (`buttons[0]` is A/Cross, `buttons[12..15]`
the D-pad, `axes[0..3]` the sticks). There is no SDK method and no request; gate on
`app.can("input.gamepad")`. The browser lists a pad only after one of its buttons is
pressed, so expect an empty list at launch.

- Your app has the controller only while it is in front and no system panel or question
  (a purchase card, sign-in, the Control Center) is up; then that panel has it and your
  page sees no input. Read the state every frame; never assume a button stays held.
- The controller's home button (PS, Xbox) is always Home: it pauses your app and never
  reaches the page. Leave with `app.exit()`.
- The remote keeps arriving as `keydown` beside the controller.
- Without the grant, `navigator.getGamepads()` is empty and `gamepadconnected` never
  fires. On the television the controller then acts as the remote (D-pad arrows, A
  `Enter`, B `Escape`). The simulator hides it but does not translate it; use the keyboard.

### `commerce.purchase`: unlocks, consumables, subscriptions

Products and prices are defined outside the code (`little products create pro --name "Pro"
--price 4.99`, `--type consumable`, or `--type subscription --interval month|year`, or the
developer portal). A price must be one of the fixed price points from $1.99 to $999.99
($1 steps to $49.99, then wider; all end in .99, and any other amount is refused with the
nearest ones). The app names only the sku; the television shows the confirm card with
the catalog's name and price ("$4.99/month" for a subscription). An `unlock` is owned once; a
`consumable` is bought repeatedly and stays in `owned()` until the app calls
`commerce.consume(purchaseId)` after granting it (grant first, keyed by `purchaseId`;
consuming twice is harmless; an unlock or subscription answers `not_consumable`); a
`subscription` renews until the household cancels on the web, and `owned()` lists its current
period with `expiresAt`, `autoRenews`, `subscriptionId` and `subscriptionStatus` (`active`,
`canceled`, or `past_due` while a failed renewal is retried: keep it working and remind the
viewer to check their card; absent on older televisions, so treat missing as `active`).

```ts
const { products } = await app.commerce.products(); // all on sale (or pass skus); empty = can't buy: hide the store
// Register at startup, before purchase(): "pending" (a parent must approve, or the household must add a card) ends here later.
app.commerce.onPurchaseUpdate((u) => { if (u.ok) unlock(u.purchase.receipt); /* else u.error.code */ });
// accountToken (optional): your opaque id for the signed-in user, signed into the receipt
const result = await app.commerce.purchase({ sku: "pro", accountToken: session.userId });
if (result.ok && result.purchase.status === "completed") unlock(result.purchase.receipt);
const { items, pending } = await app.commerce.owned(); // restore on launch; pending = waiting on a parent or a card (each with its accountToken, unsigned)
for (const i of items.filter((i) => i.type === "consumable")) { await grantOnce(i); await app.commerce.consume(i.purchaseId); }
```

Errors: `declined`, `already_owned` (call `owned()`), `already_requested` (a parent is
already being asked for it under another `accountToken`; retry once that ends), `payment_failed`, `busy`, `paused`,
`unavailable` (also an archived product, or a PIN lockout; the TV explains only the lockout, so
say so in your UI and hide the offer), `unreachable` (retry later),
`unknown_product` (no such sku), `invalid_args` (a malformed `accountToken`), `denied`,
`no_host`. Send `receipt.token` to your backend and check it with
`createVerifier({ apiUrl, appId }).receipt(token)` from `@kabletv/little-sdk/server`
(`verifyReceipt(token, { apiUrl, appId })` is the same check in one call); it returns
`accountToken` when you passed one, and a subscription period's `subscriptionId` and
`expiresAt` (grant until then; the receipt stays valid after; a renewal can land a little
after `expiresAt`, or be retried for a few days, and `owned()` keeps the subscription listed
meanwhile). Record `purchaseId` when you
grant and never grant one to two users. Sandbox receipts (testers, `little dev`) are rejected
unless you pass `allowSandbox: true`; sandbox subscriptions renew every 5 minutes (month) or
hour (year), up to 12 times. Your server hears completions (each renewal is one), refunds
(`purchase.refunded`, `data.reason` `refund` or `dispute`; a live refund first sends
`purchase.refunding`, stop granting, then `purchase.refunded` or `purchase.refund_failed`,
grant again), `subscription.canceled`,
`subscription.resumed` (a cancel undone), `subscription.past_due` (a renewal failed and is
retried; owned until `data.expiresAt`) and `subscription.expired` (`data.reason`: `canceled`,
`renewal_failed`, `refunded` or `sandbox_limit`; treat any other as ended) as
**webhooks**:
`little webhooks create <https url>`, then `createVerifier({ …, webhookSecret }).webhook(rawBody,
headers)` returns the event with its receipt already verified as `event.purchase`; an event
type your SDK version doesn't know resolves `{ ok: true, event: null, type }`, so answer it
2xx. Delivery is
at least once and unordered: dedupe on `event.id`, answer 2xx fast, and treat a refunded
purchase as refunded whatever arrives later. Every event other than `purchase.completed` is
about a purchase that completed in Little, or its subscription, so nothing arrives for a
purchase or subscription whose first payment never went through. `little webhooks listen --forward-to <local url>`
forwards sandbox events to your machine while you develop (that local verifier needs
`allowSandbox: true`). To catch up after an outage, `createClient(...).events.list({ since })`
and dedupe on `event.id`; `failed: true` leaves out events recorded while the endpoint was
disabled. The same events-reader credential (`little webhooks credentials create`) looks up
where one purchase or subscription stands now: `client.subscriptions.get(subscriptionId)` →
`{ ok, status, owned, autoRenews, currentPeriodEnd, environment, subject, accountToken? }` (grant
while `owned`), `client.purchases.get(purchaseId)` → `{ ok, status: "completed" | "refunding" |
"refunded", consumedAt?, environment, ... }`; an id not of your app fails with `not_found`. Both
include sandbox purchases: check `environment`. `client.purchases.owned(subject, { environment?
})` → `{ ok, items }` is what one buyer (the receipt's `sub`) owns now, the same items as
`commerce.owned()`, live unless you pass `"sandbox"`. Requires `commerce.purchase`. A household PIN or a parent's
approval happens on the card and the phone; the app only sees the outcomes above. A refunded
purchase drops out of `owned()` (the household's owner can refund within two hours on the
web; owners and admins refund from the portal or `little purchases refund <id> [--live]`);
re-check `owned()` at launch rather than trusting an old receipt. Getting paid: set up payouts
in the developer portal (org Settings, "Billing & payouts"; Stripe holds the bank account);
until then `products()` is empty for live buyers, and once it's started but unfinished the
products list while a live purchase answers `unavailable`. Prices are before tax: Little adds any sales
tax on top and keeps it out of the split. Little keeps 30% of each live sale's price (it pays
Stripe's fee) and a refund returns it; the balance is paid out monthly once it reaches $50, and
yearly whatever it comes to. The app's Purchases tab shows 30-day sales, and "Open Stripe
dashboard" shows payouts and tax forms. Live purchasing isn't open to households yet: test
purchases in the simulator or with invited testers, both in the sandbox.

### `assets.pick`: one thing off the viewer's shelf

```ts
const picked = await app.assets.pick({
  accept: ["image/", ".pdf"], // type prefixes or filename extensions
  exclude: [".draft.pdf"],    // narrows and wins ties
  reason: "Pick something to try on.", // shown above their things
});
if (picked.ok && picked.asset) {
  await fetch(picked.asset.url); // { id, name, contentType, url }: signed, time-limited
} else {
  showMessage(picked.error?.viewerHint ?? "Nothing was picked.");
}
```

The television keeps what the viewer saved to it from their phone ("My Stuff"). The **host**
draws the picker over your app and hands back only the chosen thing; you never receive the
library or the household's token. Tell the negatives apart on `error.code` and answer each
in your own voice: `declined`, `signed_out`, `unreachable` (a library that could not be read,
not an empty one), `empty`, `busy`, `unavailable` (they chose one and it could not be handed
over), `denied`, `no_host`.

`assets.list`, `assets.save`, `assets.remove` and `assets.rename` (which rides
`assets.save`) read and change the whole household library. The first call asks the
viewer's My Stuff permission, one answer for all of them; until they allow it, calls return
`declined`. If you need one item at a time, use `pick`, which asks nothing up front.

For an ordered batch, use `pickMany({ accept, exclude, reason, maxItems,
selectJustAdded })`. It raises the same host-owned picker with checkmarks and a Done action;
`selectJustAdded` preselects only the exact newest incoming batch, never the whole rolling
Just Added shelf.

An app that wants an explicit phone handoff declares:

```json
{ "name": "assets.receive", "accept": ["image/"], "maxItems": 10 }
```

The phone then offers the platform-authored **Share with _Experience Name_** destination only
while that exact app window is foreground and the files match. Receive with
`app.assets.onReceived(handler)`, import each session-scoped URL, then call
`app.assets.acknowledge(batch.id)`. Unacknowledged batches replay when the stream reconnects;
a stale window target, excess count, or mismatched MIME type is rejected by the host.

### Runtime steering: `setActiveTools` and `setGuide`

The manifest is the *pinned universe*; these narrow/refine it live, per view. Both are
**stateless** (call again on every state change; pass `null` to revert to the manifest
default) and a no-op in the inspector.

```ts
app.setActiveTools(["answer", "skip"]);  // offer only these declared tools right now
app.setActiveTools(null);                // revert to all declared tools

app.setGuide("You are refereeing round 3. Only judge; do not reveal the answer.");
app.setGuide(null);                      // revert to the pinned manifest `guide`
```

`setActiveTools` can only **narrow** the pinned set (never add a tool), so it is safe by
construction. In React, `useLittleActiveTools(names)` sets the subset while the component
is mounted and reverts on unmount.

A guide is steering copy you write for the agent that drives your app: its role, rules
and tool discipline. Pin one in the manifest `guide` field (at most 4,000 characters) and
replace it per view with `setGuide`. The platform's own safety rules always win, so a
guide can shape behavior but never override them.

### Pause and resume

When the viewer leaves your app (Home, or another app coming to the front), the television
can keep it alive off screen instead of closing it. `onPause` tells you it went off screen;
`onResume` tells you it is back exactly as it was left. `app.paused` reads the current
state. Requires SDK 0.19 or later.

```ts
app.onPause(() => {
  video.pause();
  clearInterval(timer); // stop media, timers and anything the viewer would hear
});
app.onResume(() => {
  timer = setInterval(tick, 1000); // restart what you paused, re-open any stream
});
```

While paused, the host ends your pose and speech streams, and foreground requests (a
purchase, a location read, an asset pick) fail with error code `paused`. Every listener is
called, and one added while paused is called at once. React apps read the state with
`useLittlePaused()`. To gate the camera, audio, or animation on being on screen, use
`useLittleVisible()`: it is false while the app is paused or its page is hidden. Don't copy
`document.hidden` into state and listen for `visibilitychange` in an effect instead. Your
page can become visible between the first render and that effect, and the change is
missed, so the camera never opens. Test it with `little dev pause` and `little dev resume` (or the MCP
`pause`/`resume` tools); a resume reports `restarted` when device settings changed while
paused, in which case the app started fresh.

### Saved state and per-viewer storage

The television closes apps for its own reasons: to make room (it keeps only a few paused),
after a crash, on a reboot, or when the household switches profile. Saved state brings the
viewer back where they were anyway. Call `app.saveState(state)` whenever where the viewer
is changes (the screen, the item, the position); the next `onEnter` carries it as `state`
with `restored: true`. Requires SDK 0.38 or later.

```ts
app.onEnter(({ params, state, restored }) => {
  if (restored) openScreen(state.screen, state.position); // where the viewer was
  if (params.recipe) openRecipe(params.recipe);           // what they just asked for
});
function showStep(recipe: string, step: number) {
  render(recipe, step);
  void app.saveState({ screen: "recipe", recipe, step });
}
```

- The newest call wins and one save is in flight at a time, so save on every change. Also
  save from `onPause` if anything is unsaved: a paused app can be closed without notice,
  and a crash gives none.
- A deliberate close clears it: the viewer closing your app, `app.exit()`, or the viewer
  opening it with other launch params. It also expires a week after the last save.
  `app.saveState(null)` clears it now.
- Params are what the viewer just asked for and state is where they were: when a launch
  carries both, apply the params over the state.
- At most 64 KiB of JSON (more resolves `too_large`; not a plain object resolves
  `invalid_args`; the inspector resolves `no_host`). Saved state is position, not
  content: keep content in web storage or on your backend.
- If your app crashes twice in a row with the same saved state, the TV drops it so the
  next open is fresh. A page that reloads in its window enters with the newest state.
- A profile switch closes your app; its next open is under the new profile, with that
  profile's own state (none yet means `restored: false`).
- React: `useLittleApp().saveState(...)` in an effect; read `state` in `useLittleEnter`.

**Your web storage belongs to the viewer.** `localStorage`, IndexedDB, cache and cookies
belong to the household profile on screen, and so does saved state. Another profile (a
kid's included) never sees them, and a profile switch closes your app: its next open is
under the new one. Write ordinary web storage code; there is nothing to opt into. Data the
whole household shares belongs on your backend, behind Sign in with Little.

Test it in the simulator: `little dev evict` (closed to make room; the next open is
restored), `little dev reboot` (every window closed, the app reopened restored), and
`little dev profile kid` (the simulator's second profile; the app closes and opens with the
kid's own storage). The MCP tools are `evict`, `reboot` and `profile`, and `launch` reports
`restored`.

### Social: invitations and livestreams

Little connects profiles and delivers invitations; your app owns rooms, membership and
shared state. Declare `social.invite` and accept an optional string `roomId` in a strict
`launchSchema` (no other field may be required). Requires SDK 0.19 or later.

```ts
if (app.can("social.invite")) {
  await app.social.setRoom(roomId);  // publish the current room; setRoom(null) when it closes
  const opened = await app.social.invite(); // the system friend picker
  // opened.ok means the picker opened, not that an invitation was sent
}

app.onEnter(({ params }) => {
  if (typeof params.roomId === "string") joinRoom(params.roomId); // an accepted invitation
});
```

Your app never receives the friend graph. Validate room membership in your backend: a
room id alone proves nothing. To create rooms while your app is closed, declare an
`invitationEndpoint` and check each signed request with
`createVerifier(...).invitation({ authorization, idempotencyKey, body })` from
`@kabletv/little-sdk/server`.

`social.livestream` adds discovery over this app's broadcasts. Capture, audience and
playback stay with Little; your app never receives a capture or playback credential.

```ts
if (app.can("social.livestream")) {
  await app.social.livestreams.openGoLive(); // Little's Go Live review UI; ok = it opened (0.27+)
  const live = await app.social.livestreams.isLive(); // this viewer broadcasting this app (0.28+)
  if (live.ok && live.isLive) {
    await app.social.livestreams.updateMetadata({ title: "Final table", description: "The last game." });
  }
  const found = await app.social.livestreams.query({ query: "final", limit: 20 });
  const first = found.ok ? found.livestreams[0] : undefined;
  if (first) await app.social.livestreams.watch(first.id); // hands off to Little's player
}
```

`query`, `watch` and `updateMetadata` need SDK 0.26 or later. Full guide, including the
metadata limits: <https://docs.little.co/docs/social>.

### Answers: data without opening your app

An app can expose read-only data that Little uses in an answer while the app is closed.
Declare `answers` in the manifest (version, a same-origin `endpoint`, and up to eight
`queries`, each with a `name`, a `description` written for the agent, `access`, and strict
`inputSchema`/`outputSchema`). Serve the endpoint with `createAnswerHandler` from
`@kabletv/little-sdk/server` (SDK 0.21 or later), never from browser code:

```ts
import { createAnswerHandler } from "@kabletv/little-sdk/server";
import { manifest } from "./manifest.js";

export const POST = createAnswerHandler({
  declaration: manifest.answers,
  launchSchema: manifest.launchSchema,
  handlers: {
    menu: async (_request, { signal }) => {
      signal.throwIfAborted();
      const fetchedAt = new Date();
      return {
        ready: {
          revision: `menu-${fetchedAt.getTime()}`,
          data: { items: await readMenu(signal) }, // must match the query's outputSchema
          freshness: {
            fetchedAt: fetchedAt.toISOString(),
            expiresAt: new Date(fetchedAt.getTime() + 60_000).toISOString(),
            quality: "observed",
          },
        },
      };
    },
  },
});
```

The handler validates requests and your results against the declaration. Return `ready`,
`empty`, `unavailable` or `accessRequired`. Test it with `little dev answers --json` and
`little dev answers <query> '<args>' --json`. Schema limits, card content
(`answerField`), refresh and account access:
<https://docs.little.co/docs/experience-answers>.

### Actions: work for a background task

An action is something your server does for a viewer's background task while your app is
closed (SDK 0.32 or later). The full guide: <https://docs.little.co/docs/app-actions>.

1. **Declare** `actions` beside your queries in `answers` (up to 20 actions and up to eight
   queries, names unique across both). Each has a `name`, a short `title` the viewer sees, a
   `description` the agent reads (facts, never instructions), strict
   `inputSchema`/`outputSchema`, an `authority` (`read`, `mutate`, or `consequential` for
   money or what cannot be undone), an `access` (`public`, or `account` for the viewer's
   account with you) and an `execution` (`immediate`, or `background` for work Little follows
   with `status`). A consequential action is always background and titles every input
   property: the viewer allows exactly that call, asked in those words. Let the viewer pick
   in a `read` or `mutate` action, and make only the final step consequential, with what
   they picked in its input, so they consent once to a question that lists it.
2. **Serve** them from the same endpoint: `createAnswerHandler({ declaration, actions,
   verifier })`, with `accountAction(...)` for an account action, whose handlers get the
   requester's `subject` (your Sign in with Little client's pairwise `sub`). Key every side
   effect on the invoke's `request.requestId`, and answer a request sent again from where its
   work stands, never from a stored answer. Pass `onError` to log each error the endpoint
   answered for you (`threw`, `invalid_request`, `invalid_outcome`), each named by its field
   and what to change. A field or an operation a newer Little adds is read past, the
   operation answered `unsupported`.
   - **Ask the viewer** with an `asks` outcome (a `clarification`, `terms` or a `deviation`,
     within `ANSWER_ACTION_ASK_LIMITS`). Check one worded at run time with
     `asksProblems(asks, request)` first, and hand its reasons back to whatever worded it. To have the
     viewer pick among things you have (SDK 0.37.0+), a `clarification` or a `deviation` offers up to 24
     `items` (each an `id`, a `title`, and an optional `text`, `image` and up to three
     `facts`; `ANSWER_ITEM_LIMITS`; at most 20 KiB of items as JSON), with the question's `id`
     (never `__proto__`, `prototype` or `constructor`) and `pick: { min, max }` (one when left
     out; a `min` of 0 allows none). Little calls the action again itself with the same input
     and the pick in `request.picked[id]`. Ask several picks one at a time, each under its own
     `id`: the call made again carries every pick so far, within the 16 KiB request, and a
     question whose largest pick would not fit is refused.
   - **Show what it did** (SDK 0.36.0+): a `done` may hand back what the viewer sees once the
     task ends, each field a JSON Pointer into `data`. `content` cards hold a title, text, an
     image and facts (your own code image goes here, shown as it is on a dark surface, so give
     it a light background). `takeaways` are each a link to open on the phone (`openRef`,
     HTTPS) or a value drawn as a QR code (`code: { valueRef, format: "qr" }`). At most 4
     cards and 2 takeaways, a link or code at most 1024 characters
     (`ANSWER_ACTION_SHOWN_LIMITS`); no `launchParamsRef` or `sourceIds` in a card. The agent
     never reads the field a takeaway points at, so keep its value there alone. Hand back only
     what the viewer needs at the end.
3. **Test** with `little dev actions --json` and `little dev actions <action> '<input>' --json`
   (a sandbox call: create the verifier with `allowSandbox` where you test); add
   `--picked <question>=<id>,<id>` to call it again as after the viewer's pick.
4. **Publish** with `little publish`. Tasks call a published app that a household installed;
   account actions also need a sign-in client bound to the app.

A task keeps calling the version of your app it opened, so keep serving each action an
older version declared until its tasks have ended, and rename an action you change
incompatibly.

---

## Writing for the model (why your copy matters)

The manifest's `description`, each tool's `description`/`params`, and your
`data-little-label`s are **read by the agent**, not by a human. They drive
routing and steering. Treat them like code, not docs:

- Describe **when to route/call**, not what the UI looks like: *"Launch when the
  viewer wants to shop denim…"*, *"Call when the viewer refers to a product."*
- Name the referent-map contract in tool descriptions: *"resolve the on-screen
  reference to the element's id, then pass it."*
- Keep `data-little-label`s short and spoken; put comparables in
  `data-little-data`, not prose.

## Common pitfalls

- **Tool with args but no `params`** → the agent calls it with none. Declare `params`.
- **Guessable ids** (`the-sherpa-one`) → the agent guesses instead of reading the
  map. Use opaque ids and rely on `data-little-label`/`-data`.
- **`data-little-action` with no matching manifest tool** → `validate()` flags it.
- **Marking a mutation `read`** → skips confirmation. Match `authority` to real
  consequence; only true consequences are `consequential`.
- **A region whose label you expect from children** → a `region` label comes only
  from `data-little-label`.
- **A pure output tagged `item`** (a total, a display) → implies it's selectable.
  Use `readout` for text the agent should read but not click.
- **`data-little-data` that isn't valid JSON** → dropped; `validate()` warns.
- **Calling a capability without gating on `app.can(name)`** → in the **inspector** (no
  host) it's a handled negative with no behavior and no visible failure. Always branch on
  `can()`. `sense.pose`/`media.camera`/`media.mic` are granted wherever a host provides them
  (a television and `little dev`), so gate rather than assuming they're absent off-device.
  `media.liveMic` is granted there too: `little dev` plays a phone on your computer's
  network through its speakers, so test the live mic there before a television.
- **Declaring a capability method but forgetting the manifest `capabilities[]` entry** →
  the host never grants it, so `app.can()` stays `false`. Declare it, with a viewer-facing
  `reason`.
- **Renaming a tool in code but not in the manifest (or vice versa)** → the agent calls a
  name nobody handles. No single check sees every layer: `little manifest validate` checks
  only the manifest; the inspector's `validate()` flags a `data-little-action` that names
  no manifest tool; and nothing static checks that a declared tool has a **handler**, so fire
  each declared tool in `little dev`'s panel (or `dispatchToDom` in a test) before
  `little publish`. (A declared tool with no handler still works when an element carries a
  matching `data-little-action`, via default actuation.)
- **Reading CLI output by scraping the chrome** → pass `--json`; the result document is
  the only thing on stdout.

## API surface (quick reference)

- `connect(options?) → LittleApp`: options: `hostOrigin?`, `perception?` (bool |
  tuning + `reportMs`), `sdkVersion?`, `transport?`, `debug?` (`true` |
  `{ overlayKey }`), `devScale?` (default on, localhost only).
- `LittleApp`:
  - **core:** `onEnter`, `observeEnter`, `tool`, `onTool`, `saveState`, `exit`, `emit`,
    `snapshot`, `validate`, `report`, `call`, `params`, `disconnect`. The
    remote is six trusted `keydown` keys (arrows, `Enter`, `Escape`=Back); leaving is
    `exit()` and nothing else; Home never reaches the page.
  - **lifecycle:** `onPause`, `onResume`, `paused` (off screen, kept alive).
  - **steering:** `setActiveTools(names | null)`, `setGuide(text | null)` (both
    stateless; narrow/refine the pinned manifest, no-op in the inspector).
  - **content:** `compose(name | opts, opts?)`, `image(…)`, `music(…)`: Result
    envelopes (`{ ok, data }` / `{ ok, url }`); never throw.
  - **capabilities (gate on `can(name)`):** `identity.{signIn,getSession,signOut}`,
    `notifications.getSubscription`, `location.get` (under the `location` capability),
    `voice.say(text, { language?, interrupt? })`,
    `voice.config({ lang?, hints?, context?, feedback? })`, `sense.{motion,pose,speech}`,
    `media.{camera,mic,vendor}`,
    `media.liveMic.{available,invite({ label?, volume?, fallback? })}`, whose mic has
    `{id,label,state,reason,delayMs,connect,setVolume,end,onChange}` (under
    `media.liveMic`), `commerce.{products,purchase,owned,consume,onPurchaseUpdate}`
    (all under the `commerce.purchase` capability), `assets.{pick,pickMany}` (`assets.pick`),
    `assets.{onReceived,acknowledge}` (`assets.receive`),
    `assets.{list,save,remove,rename}` (`assets.list`/`save`/`remove`; they ask the viewer's
    My Stuff permission first), `social.{setRoom,invite}` (`social.invite`) and
    `social.livestreams.{openGoLive,isLive,query,watch,updateMetadata}`
    (`social.livestream`). `input.gamepad` has no method: it gives the page the
    browser's own `navigator.getGamepads()`. `can(name)` reads the grant reported on
    the handshake.
  - **present but not available to third-party apps:** `media.playback`; the host grants
    it only to first-party apps.
  - `tool` and the `on*` registrars return an **unsubscribe**; `tool` is
    last-writer-wins per name and takes a `<Args>` generic; `call()` always returns a
    `Promise<ActionResult>`.
- Server only, from `@kabletv/little-sdk/server`: `createVerifier({ apiUrl, appId,
  clientId?, issuerUrl?, webhookSecret?, allowSandbox? })` → `.receipt(token)`,
  `.identityToken(token, { maxAge? })`, `.invitation({ authorization, idempotencyKey, body })`,
  `.action({ authorization, idempotencyKey, body })`, `.webhook(rawBody, headers)`, each resolving `{ ok: true, … }` or `{ ok: false, error: { code } }`
  with `code` one of `invalid | expired | sandbox | unavailable` (retry only `unavailable`);
  `createAnswerHandler({ declaration, handlers?, actions?, verifier?, replay?, authorize?,
  launchSchema?, timeoutMs?, onError? })`, your answers endpoint (queries, and the actions a background
  task calls while your app is closed: <https://docs.little.co/docs/app-actions>), with
  `accountAction(handlers)` for an account action, whose handlers get the requester's
  `subject`; `verifyReceipt(token, { apiUrl, appId, allowSandbox? })`; and `createClient(config)` →
  `little.notifications.emit(input)`, and `little.events.list({ since?, failed?, cursor? })`,
  `little.purchases.get(purchaseId)`, `little.purchases.owned(subject, { environment? })` and
  `little.subscriptions.get(subscriptionId)` (a separate client built with an events-reader
  credential from `little webhooks credentials create`; each credential holds one capability). The verifier needs no credentials. Never import
  producer credentials or webhook secrets into the browser. `createAnswerHandler` returns a
  `(Request) => Promise<Response>` endpoint; beside it, `answerField` and the
  `validateAnswerProvider` / `validateAnswerRequest` / `validateAnswerResponse` checks, and
  `validateAnswerActionRequest` / `validateAnswerActionResponse` for actions (the latter →
  `{ response, shown }`, what a `done` shows resolved from its data), with
  `ANSWER_ACTION_ASK_LIMITS`, `ANSWER_ITEM_LIMITS`, `answerPickOf(asks)` and
  `asksProblems(asks, request?)` → `{ path, reason }[]` for an action's question, and
  `ANSWER_ACTION_SHOWN_LIMITS` for what a `done` shows.
- React: the `@kabletv/little-react` hooks (`useLittleEnter<P>`,
  `useLittleTool<A>`, `useLittleEvent`, `useLittleParams<T>`,
  `useLittlePaused`, `useLittleVisible`, `useLittleActiveTools`, `useLittleSignIn`,
  `useLittleSignOut`, `useLittleProducts(skus?)`, `useLittleOwned()` → `{ owned, refresh }`
  (re-reads when a purchase ends, on resume, and after `useLittlePurchase`/`useLittleConsume`),
  `useLittlePurchase`, `useLittleConsume`,
  `useLittleLiveMic({ label?, volume?, fallback? })` →
  `{ available, invitation, mic, state, reason, delayMs, error }` (invites while mounted and
  on screen, ends the mic on unmount), and
  `useLittleApp` →
  the raw handle for `validate()`/`snapshot()`/`call()`/`compose()`/`voice`/etc.), in the
  same `@kabletv` scope, plus `configureLittle(options)` to pass `debug`/`hostOrigin`
  to the hooks' lazy connection (call once before the first hook mounts).
  It re-exports the manifest/result types too (`LittleManifest`, `LittleManifestJson`,
  `ActionResult`, `ActionResultInput`, `ConnectOptions`, `EnterInfo`, `ToolHandler`,
  `SignInResult`, `LittleClaims`, `LittleError`, `LittleErrorCategory`, `LittleErrorCode`,
  `Product`, `OwnedItem`, `SaveStateResult`, and the live mic types `LiveMic`, `LiveMicState`,
  `LiveMicEndReason`, `LiveMicInviteOptions`, `LiveMicResult`).
- Motion: `@kabletv/little-motion` exports `createMotionSession(app, { actions?, held?,
  controls?, participants?, accuracy? })` → a session with `onResult`, `onStatus`,
  `snapshot()`, `request`, `closed` and `close()`; `MOTION_SEMANTICS`; and the valid ids
  `MOTION_ACTION_IDS`, `MOTION_HELD_IDS`, `MOTION_CONTROL_IDS`. Declare `sense.motion`.
- Also exported: `SDK_VERSION`, `mountDevStage` (the localhost canvas scaler behind
  `devScale`), and for headless/CI use `snapshotDom`, `validateDom`, `dispatchToDom`,
  `MODEL_COLS`, `MODEL_ROWS`, `rowsForCols`.
- Phone pages: `@kabletv/little-phone` exports `accept(invitation, { track? })` →
  `{ ok: true, reply, mic }` (the mic has `state`, `reason`, `end()`, `onChange`) or
  `{ ok: false, error }` with `error.code` `denied`, `expired`, `invalid_args` or
  `unavailable`.

## Further reading

The developer docs at <https://docs.little.co/docs> are the source of truth:
the [quickstart](https://docs.little.co/docs/quickstart), the
[authoring guide](https://docs.little.co/docs/authoring-guide), the
[manifest reference](https://docs.little.co/docs/manifest-reference),
[capabilities](https://docs.little.co/docs/capabilities),
[social](https://docs.little.co/docs/social),
[answers](https://docs.little.co/docs/experience-answers),
[actions](https://docs.little.co/docs/app-actions),
[your server](https://docs.little.co/docs/server),
[versioning](https://docs.little.co/docs/versioning), the
[CLI guide + generated command reference](https://docs.little.co/docs/cli), and
the SDK API reference. For an agent, <https://docs.little.co/llms.txt> indexes
every page (`/llms-full.txt` is the full text). The developer portal serves this skill at
<https://developers.little.co/skill/SKILL.md>.
