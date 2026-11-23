# HackBar Classic

A recreation of the original XUL HackBar toolbar for modern Firefox, built with
plain HTML/CSS/JS on the WebExtensions API. No build step, no dependencies,
no network calls of its own.

The original was a XUL overlay that injected itself into Firefox's chrome. That
capability was removed in Firefox 57. This rebuild keeps the classic interface,
the classic keybindings, and — via an in-page overlay — the classic *placement*.

---

## Two surfaces

| | Where | Toggle |
|---|---|---|
| **In-page overlay** | Pinned to the top of the page viewport, directly under the address bar | **F9**, or the toolbar button |
| **DevTools panel** | Bottom of the DevTools toolbox | **F12** → *HackBar* tab |

Both run the same UI (`ui.js`) and share state through `storage.local`, so what
you type in one appears in the other.

The overlay survives navigation. Executing a request reloads the tab, which
destroys the content script, so the open/closed flag is kept per tab in the
background page and the bar re-opens itself on the next page. It stays up until
you close it with F9 or the X — including across ordinary link clicks. A request
sent with **new tab** ticked lands in a tab of its own, where the bar starts
closed; press F9 there.

The overlay is the one that reproduces the classic feel. It lives in a **closed
shadow root**, so the target page's stylesheet cannot repaint it and its styles
cannot leak into the page. Content scripts also run in an isolated world, so the
bar works on sites whose CSP would block an injected inline script. When shown,
it shifts the page down rather than covering it.

The honest caveat: this is the top of the *content area*, not browser chrome.
Visually it sits where the old bar sat; structurally it is in the page. That
also means it cannot appear on privileged pages (`about:`, `view-source:`,
`addons.mozilla.org`, the PDF viewer) — use the DevTools panel there.

---

## What makes this one different

HackBar has several WebExtension successors. They differ in *where the bar
lives* — which is the one thing the original's design was actually about.

| Project | Surface | Toggle |
|---|---|---|
| `noobfromvn/hackbar` | DevTools panel | — |
| `mxcxvn/newhackbar` (New Hackbar) | Browser sidebar | F9 |
| `Jalkhov/hackbar-future` | Browser sidebar | F1 |
| `PhHitachi/HackBar` | Toolbar popup | — |
| **HackBar Classic** | **In-page overlay** + DevTools panel | **F9** |

A sidebar is vertical, down the side of the window. A DevTools panel sits at the
bottom of the toolbox. A popup floats and dismisses when you click away. The
original was a horizontal toolbar directly beneath the address bar, and none of
those geometries reproduce it.

This is the only one of them that renders **in the page viewport**, pinned to
the top — which is why it reads as the bar it replaces rather than as a panel
that happens to hold the same buttons. It is also the only one that offers both
surfaces at once over shared state, so there is still a bar on `about:` and
`view-source:` pages, where no content script is permitted to run.

The keybinding is *not* the distinction — several successors also bind F9.
Surfaces above are read from each project's `manifest.json`; SecuriTeam's AMO
build is not on GitHub, but its listing describes itself as a "developer tool
panel".

## In-page overlay (F9 - Hide/Show)
<img width="1915" height="619" alt="image" src="https://github.com/user-attachments/assets/aa4e19d3-e80d-4e61-88a0-200266af5dfa" />

---

## Install

Firefox refuses to permanently install unsigned extensions in release builds, so
pick whichever suits you.

### 1. Temporary load — fastest, resets on restart

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…**
3. Select `D:\hackbar\manifest.json`

### 2. Developer Edition / Nightly — permanent, no signing

1. `about:config` → set `xpinstall.signatures.required` to `false`
2. Install `hackbar-classic.xpi` from `about:addons` → gear → *Install Add-on From File…*

> This pref is ignored by Firefox Release and Beta. It works on Developer
> Edition, Nightly, and ESR only.

### 3. AMO unlisted signing — permanent on release Firefox

Submit the zip at <https://addons.mozilla.org/developers/addon/submit/distribution>
choosing **"On your own"**. You get a signed `.xpi` back, private to you, that
installs on stock Firefox. Free, no public listing.

> After a temporary load, already-open tabs have no content script yet. Press the
> toolbar button once (it injects on demand) or reload the tab, then F9 works.

---

## Use

### Keyboard — unchanged from the original

| Key | Action |
|---|---|
| `F9` | Show / hide the in-page bar |
| `Alt+A` | Load URL — pull the current page's address into the box |
| `Alt+P` | Split URL — one query parameter per line |
| `Alt+X` | Execute — send the request |
| `Ctrl+Enter` | Execute (as in the later v2 forks) |
| `Esc` | Close an open menu |

Newlines added by **Split URL** are stripped again at execute time, exactly as
the XUL version did — so you can split, edit a parameter across lines, and fire
without cleaning up first.

### Menus

Payload items **insert at the caret**. Encoding and hashing items **transform the
current selection**, or the whole field if nothing is selected. The focused field
is the target, so the menus work on the URL, the POST body and the Referrer box
alike.

- **INT / STR** — the injection-point shape used by the SQL menu.
  `INT` emits `1 UNION…`, `STR` emits `1' UNION…`
- **SQL** — generic, MySQL, MSSQL, Oracle, PostgreSQL, SQLite
- **XSS** — basics, filter evasion, proof-of-impact, SSTI/traversal probes
- **Encryption** — MD5, SHA-1/256/384/512, ROT13
- **Encoding** — URL, Base64, hex, HTML entities, `\uXXXX`, MySQL/MSSQL `CHAR()`
- **Other** — string ops, JSON pretty/minify, JWT decode

### Checkboxes

- **Enable Post data** — reveals the body field and switches to POST
- **Enable Referrer** — reveals the Referrer field and overrides the header
- **`+`** — advanced row: `multipart/form-data`, send-in-new-tab

State persists in `storage.local` across page loads, panel closes and restarts.

### Density

The bar is sized to read comfortably at 100% browser zoom on a 1x display. The
classic screenshots people remember are often downscaled or HiDPI captures, so
they look tighter than the bar actually was. One value in `panel.css` controls
it:

```css
#hb, .hb-pop { zoom: 1; }   /* 0.85 ~ a scaled screenshot, 1.15 roomier */
```

---

## How the hard parts work

**POST.** No WebExtension API navigates a tab with a request body — the old
`nsIWebNavigation.loadURI(postData)` was XPCOM-only. A hidden auto-submitting
`<form>` is injected instead. That produces a real navigation and carries the
tab's cookies, so the response renders normally.

**Referer.** A forbidden header for `fetch`/XHR, so it can only be set by
intercepting the outbound request. A one-shot blocking `webRequest` listener is
armed immediately before navigating and torn down as soon as it fires (or after
15s, so a blocking listener is never left installed).

That is why this targets **Manifest V2**: blocking `webRequest` is unambiguously
supported there, and Mozilla has committed to supporting MV2 indefinitely. Chrome
finished removing MV2 in 2026, so this is Firefox-only by design.

**Style isolation.** The overlay's host element is still an ordinary page
element, so a page rule like `div { letter-spacing: 3px !important }` matches it
and leaks into the shadow tree through inheritance. A plain inline style loses to
an author `!important` rule, so every declaration on the host is itself
`!important`, with a text-metric reset inside the shadow tree as a second line of
defence. This was a real observed bug, not a hypothetical — see
`screenshots/`.

---

## Known limitations

| Limitation | Why |
|---|---|
| The bar is in the page, not browser chrome | WebExtensions cannot draw in chrome. Visually identical placement; structurally in the content area. |
| No overlay on privileged pages | `about:`, `view-source:`, AMO and the PDF viewer reject content scripts. Use the DevTools panel. |
| POST bodies are re-encoded, not byte-preserved | The form serialiser re-encodes values. Hand-crafted raw bodies with deliberate malformed encoding won't survive verbatim — use Burp Repeater for those. |
| POST can fail under a strict `form-action` CSP | The injected form is subject to the page's own CSP. |
| MD5 is bundled, not native | `crypto.subtle` deliberately omits MD5. The bundled implementation is verified against RFC 1321 vectors. |
| Firefox only | Depends on MV2 blocking `webRequest`. A Chrome MV3 port would need `declarativeNetRequest` for the Referer override. |

---

## Permissions, and why each is needed

| Permission | Reason |
|---|---|
| `tabs` | Read the page URL for **Load URL**; navigate it on **Execute** |
| `storage` | Persist panel contents and keep the two surfaces in sync |
| `webRequest` + `webRequestBlocking` | The **Enable Referrer** override |
| `<all_urls>` | Mount the F9 overlay and inject the POST form on the host you are testing |

Nothing is sent anywhere except the request you explicitly execute. No telemetry,
no update server, no remote code.

---

## Scope of use

This is an offensive-testing tool. Use it only against systems you own or have
written authorisation to test — your own lab, a signed engagement, or a bug
bounty program whose scope explicitly covers the target. Check the program policy
before firing payloads at anything.

---

## Layout

```
D:\hackbar\
  manifest.json      MV2, minimal permissions
  ui.js              shared UI - markup + all behaviour
  content.js         F9 in-page overlay mount (shadow DOM)
  panel.html/.js     DevTools panel mount
  devtools.html/.js  registers the panel
  panel.css          period-correct chrome, works in document and shadow root
  payloads.js        all menu definitions - edit here to add your own
  background.js      navigation, POST form injection, Referer override
  lib/md5.js         bundled MD5 (SubtleCrypto has none)
  icons/icon.svg
  screenshots/       rendered verification shots
```

### Adding your own payloads

Everything lives in `payloads.js`. Append to any menu array:

```js
{ label: "My payload", insert: "..." }                      // insert at caret
{ label: "My payload", insert: c => hbBreak(c) + "..." }    // INT/STR aware
{ label: "My transform", xform: s => s.toUpperCase() }      // transform selection
{ grp: "Heading" }                                          // group label
{ sep: true }                                               // separator
```

`xform` may return a promise, so async transforms (anything via `crypto.subtle`)
work the same way.

## Screenshots

<img width="1180" height="210" alt="image" src="https://github.com/user-attachments/assets/e1c38605-c2c4-4d97-8d83-2dafe68d9346" />

<img width="1180" height="380" alt="image" src="https://github.com/user-attachments/assets/e32085ac-9a8e-45dc-ac23-2872905972ed" />

<img width="1180" height="560" alt="image" src="https://github.com/user-attachments/assets/6541fd15-3cad-4ded-8e4c-dd645a795d70" />


---

## Credits

HackBar was created by **Johan Adriaans**, with contributions from **Pedro
Laguna**. The original was a XUL extension, hosted first on Google Code and now
archived at <https://github.com/johan-adriaans/hackbar>. It stopped working when
Firefox 57 removed support for XUL extensions.

This project is an independent reimplementation on the WebExtensions API,
written from the original's observable behaviour — its interface, its
keybindings and its placement. It is **not a port and contains no code from the
original**, which is unlicensed and whose source therefore could not be reused.
The design, and the idea of HackBar itself, belong to its original authors.

Not affiliated with, endorsed by, or supported by the original authors. The name
is used only to describe what this tool reimplements.

---

## License

MIT — see [LICENSE](../LICENSE).

`lib/md5.js` is a standard RFC 1321 implementation of public-domain lineage
(the same core as blueimp/js-md5, MIT) and adds no further restrictions.

HackBar Classic is intended for authorised security testing only. Using it
against systems you do not own or have written permission to test is your
responsibility, not the author's.
