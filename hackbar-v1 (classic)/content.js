/* ============================================================
   HackBar Classic - in-page F9 overlay mount.

   This is the surface that restores the classic *placement*: a bar
   pinned to the very top of the viewport, directly under the address
   bar, toggled with F9 - exactly as the XUL original behaved.

   Two details make it safe to drop into an arbitrary target page:

   1. Shadow DOM. The bar lives in a closed shadow root, so the page's
      stylesheet cannot repaint it and our stylesheet cannot leak into
      the page. The old XUL bar got this for free by living in chrome.

   2. Isolated world. Content scripts are exempt from the page's CSP
      for their own execution, so the bar works on sites whose policy
      would block an injected inline script.

   The DOM is built lazily on the first F9, so pages where the bar is
   never opened pay only for one keydown listener.
   ============================================================ */
"use strict";

(function () {

  /* don't inject into frames, or into our own pages */
  if (window.top !== window.self) return;

  var HOST_ID = "__hackbar_classic_host__";
  if (document.getElementById(HOST_ID)) return;

  var host = null, shadow = null, ui = null, visible = false;
  var prevPadding = null;

  /* The bar's open/closed state belongs to the *tab*, not to this
     document. Executing a request navigates the tab, which tears this
     content script down and runs a fresh one - so without this the bar
     would vanish the moment you hit Execute. The background page holds
     the flag; we report every change to it and ask for it on load. */
  function reportState() {
    browser.runtime.sendMessage({ cmd: "overlayState", visible: visible })
      .catch(function () {});
  }

  /* ---------------- build (once, on first F9) ---------------- */

  function build() {
    return fetch(browser.runtime.getURL("panel.css"))
      .then(function (r) { return r.text(); })
      .then(function (css) {

        host = document.createElement("div");
        host.id = HOST_ID;

        /* Every declaration is !important.
           Shadow DOM blocks the page's selectors from matching anything
           *inside* the tree, but the host element itself is still an
           ordinary page element - so a rule like
               div { letter-spacing: 3px !important }
           matches the host, and inherited properties then flow into the
           shadow tree. A plain inline style loses to an author
           !important rule; an inline !important declaration wins. */
        host.setAttribute("style", [
          "all: initial !important",
          "position: fixed !important",
          "top: 0 !important",
          "left: 0 !important",
          "right: 0 !important",
          "width: auto !important",
          "height: auto !important",
          "margin: 0 !important",
          "padding: 0 !important",
          "z-index: 2147483647 !important",
          "display: block !important",
          "visibility: visible !important",
          "opacity: 1 !important",
          "transform: none !important",
          "filter: none !important",
          "box-shadow: 0 2px 6px rgba(0,0,0,.35) !important"
        ].join(";"));

        shadow = host.attachShadow({ mode: "closed" });

        var style = document.createElement("style");
        style.textContent = css + "\n" + [
          /* overlay-only chrome */
          ":host { display:block; }",
          /* belt-and-braces: neutralise any inherited text metrics that
             might still reach the tree through the host element */
          "#hb, #hb *, .hb-pop, .hb-pop * {",
          "  letter-spacing: normal; word-spacing: normal; text-transform: none;",
          "  text-indent: 0; text-shadow: none; direction: ltr; writing-mode: horizontal-tb;",
          "}",
          "#hb { background:#f0f0f0; border-bottom:1px solid #9a9a9a; padding:3px 4px 0 4px; }",
          ".hb-close { float:right; cursor:pointer; padding:0 6px; color:#444; font-size:12px; }",
          ".hb-close:hover { color:#000; background:#e2e6ea; }"
        ].join("\n");
        shadow.appendChild(style);

        var wrap = document.createElement("div");
        wrap.innerHTML = HB_MARKUP;
        while (wrap.firstChild) shadow.appendChild(wrap.firstChild);

        (document.body || document.documentElement).appendChild(host);

        ui = HB_createUI(shadow, {
          getTabUrl: function () { return location.href; },
          execute: function (spec) {
            spec.cmd = "execute";
            return browser.runtime.sendMessage(spec);
          },
          onClose: function () { hide(); },
          /* .hb-pop is absolutely positioned inside the fixed host at
             top:0, so viewport coords map straight through */
          popAnchorTop: function () { return 0; }
        });
      });
  }

  /* ---------------- show / hide ---------------- */

  function shiftPage(on) {
    var de = document.documentElement;
    if (on) {
      if (prevPadding === null) prevPadding = de.style.paddingTop || "";
      /* measured after layout so the page is pushed down exactly */
      de.style.paddingTop = host.getBoundingClientRect().height + "px";
    } else if (prevPadding !== null) {
      de.style.paddingTop = prevPadding;
      prevPadding = null;
    }
  }

  function show(opts) {
    /* a restore after navigation must not steal focus from the page */
    var wantFocus = !(opts && opts.noFocus);
    var ready = host ? Promise.resolve() : build();
    ready.then(function () {
      /* setProperty with "important" so a page rule such as
         div { display:none !important } cannot hide the bar */
      host.style.setProperty("display", "block", "important");
      visible = true;
      reportState();
      /* reload shared state in case the DevTools panel changed it */
      if (ui) ui.reload();
      requestAnimationFrame(function () {
        shiftPage(true);
        if (ui && wantFocus) ui.focusUrl();
      });
    }).catch(function (e) {
      console.error("[HackBar] could not build the overlay:", e);
    });
  }

  function hide() {
    if (!host) return;
    if (ui) ui.closeMenus();
    shiftPage(false);
    host.style.setProperty("display", "none", "important");
    visible = false;
    reportState();
  }

  function toggle() { visible ? hide() : show(); }

  /* ---------------- F9, as in the original ---------------- */

  window.addEventListener("keydown", function (e) {
    if (e.key !== "F9" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }, true);

  /* let the toolbar button and the background page drive it too */
  browser.runtime.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.cmd === "toggleOverlay") { toggle(); return Promise.resolve({ ok: true, visible: visible }); }
    if (msg.cmd === "showOverlay")   { show();   return Promise.resolve({ ok: true }); }
  });

  /* ---------------- restore after a navigation ---------------- */

  browser.runtime.sendMessage({ cmd: "getOverlayState" })
    .then(function (r) { if (r && r.visible) show({ noFocus: true }); })
    .catch(function () {});

})();
