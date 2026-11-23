/* ============================================================
   HackBar Classic - background page (MV2, persistent).

   Two things here are not possible with plain navigation APIs and
   need deliberate workarounds:

   1. POST - there is no WebExtension API that navigates a tab with
      a request body (the old nsIWebNavigation.loadURI(postData) was
      XPCOM-only). We inject a hidden auto-submitting <form>, which
      produces a real navigation and carries the tab's cookies.

   2. Referer - a forbidden header for fetch/XHR, so it can only be
      set by intercepting the outbound request. We arm a one-shot
      blocking webRequest listener immediately before navigating.
      This is why the extension targets Manifest V2: blocking
      webRequest is unambiguously supported there.
   ============================================================ */
"use strict";

/* ------------------------------------------------------------
   One-shot Referer override
   ------------------------------------------------------------ */

function armReferer(tabId, referer) {
  return new Promise(function (resolve) {
    var fired = false;
    var timer = null;

    function cleanup() {
      clearTimeout(timer);
      try { browser.webRequest.onBeforeSendHeaders.removeListener(listener); } catch (e) {}
    }

    function listener(details) {
      if (fired) return {};
      fired = true;

      var headers = (details.requestHeaders || []).filter(function (h) {
        return h.name.toLowerCase() !== "referer";
      });
      headers.push({ name: "Referer", value: referer });

      /* remove on the next tick - mutating listeners mid-dispatch is
         legal but this keeps the return value clean */
      setTimeout(cleanup, 0);
      return { requestHeaders: headers };
    }

    browser.webRequest.onBeforeSendHeaders.addListener(
      listener,
      { urls: ["<all_urls>"], tabId: tabId, types: ["main_frame", "sub_frame"] },
      ["blocking", "requestHeaders"]
    );

    /* never leave a blocking listener installed indefinitely */
    timer = setTimeout(cleanup, 15000);

    resolve();
  });
}

/* ------------------------------------------------------------
   POST body -> hidden auto-submitting form
   ------------------------------------------------------------ */

function parsePairs(body) {
  var out = [];
  if (!body) return out;

  body.split("&").forEach(function (chunk) {
    if (chunk === "") return;
    var eq = chunk.indexOf("=");
    var rawK = eq === -1 ? chunk : chunk.slice(0, eq);
    var rawV = eq === -1 ? ""    : chunk.slice(eq + 1);

    function dec(s) {
      try { return decodeURIComponent(s.replace(/\+/g, " ")); }
      catch (e) { return s; }   /* malformed %-escapes stay literal */
    }
    out.push([dec(rawK), dec(rawV)]);
  });
  return out;
}

function buildFormCode(url, pairs, multipart, newTab) {
  var cfg = {
    url: url,
    pairs: pairs,
    enctype: multipart ? "multipart/form-data" : "application/x-www-form-urlencoded",
    target: newTab ? "_blank" : "_self"
  };

  return "(function(){try{" +
    "var c=" + JSON.stringify(cfg) + ";" +
    "var host=document.body||document.documentElement;" +
    "if(!host){return 'no-document';}" +
    "var f=document.createElement('form');" +
    "f.method='POST';f.action=c.url;f.enctype=c.enctype;" +
    "f.acceptCharset='UTF-8';f.target=c.target;" +
    "f.style.display='none';" +
    "c.pairs.forEach(function(p){" +
      "var i=document.createElement('input');" +
      "i.type='hidden';i.name=p[0];i.value=p[1];" +
      "f.appendChild(i);" +
    "});" +
    "host.appendChild(f);" +
    "f.submit();" +
    "return 'ok';" +
    "}catch(e){return 'error: '+(e&&e.message?e.message:String(e));}})();";
}

/* ------------------------------------------------------------
   Request execution
   ------------------------------------------------------------ */

function doExecute(msg) {
  var tabId = msg.tabId;

  var pre = msg.useReferer && msg.referer
    ? armReferer(tabId, msg.referer)
    : Promise.resolve();

  return pre.then(function () {

    /* ---- GET ---- */
    if (!msg.usePost) {
      if (msg.newTab) {
        return browser.tabs.create({ url: msg.url })
          .then(function () { return { ok: true, note: "Sent (GET, new tab)" }; });
      }
      return browser.tabs.update(tabId, { url: msg.url })
        .then(function () { return { ok: true, note: "Sent (GET)" }; });
    }

    /* ---- POST ---- */
    var pairs = parsePairs(msg.postData);
    var code  = buildFormCode(msg.url, pairs, msg.multipart, msg.newTab);

    return browser.tabs.executeScript(tabId, {
      code: code,
      runAt: "document_idle"
    }).then(function (results) {
      var r = results && results[0];
      if (r === "ok") {
        return {
          ok: true,
          note: "Sent (POST, " + pairs.length + " field" +
                (pairs.length === 1 ? "" : "s") +
                (msg.multipart ? ", multipart" : "") +
                (msg.newTab ? ", new tab" : "") + ")"
        };
      }
      if (r === "no-document") {
        return { ok: false, error: "The page has no document to inject into" };
      }
      return { ok: false, error: String(r || "Form injection returned nothing") };
    }).catch(function (e) {
      var m = String(e && e.message ? e.message : e);
      if (/Missing host permission|cannot access|Invalid tab ID|insufficient/i.test(m)) {
        m = "Cannot inject into this page. POST needs an ordinary http(s) page " +
            "in the inspected tab (not about:, view-source:, or addons.mozilla.org). " +
            "Navigate there first, then Execute.";
      }
      return { ok: false, error: m };
    });
  });
}

/* ------------------------------------------------------------
   Overlay visibility, per tab

   Executing a request navigates the tab, so the overlay's content
   script is destroyed and rebuilt. The flag has to outlive it, and
   the background page is the only thing in the extension that does.
   ------------------------------------------------------------ */

var overlayOpen = Object.create(null);

browser.tabs.onRemoved.addListener(function (tabId) {
  delete overlayOpen[tabId];
});

/* ------------------------------------------------------------
   Message router
   ------------------------------------------------------------ */

browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || !msg.cmd) return;

  /* The DevTools panel knows the inspected tab and passes tabId
     explicitly. The in-page overlay does not, so fall back to the
     tab the message came from. */
  var tabId = (typeof msg.tabId === "number")
    ? msg.tabId
    : (sender && sender.tab && sender.tab.id);

  if (msg.cmd === "overlayState") {
    if (typeof tabId === "number") {
      if (msg.visible) overlayOpen[tabId] = true;
      else delete overlayOpen[tabId];
    }
    return Promise.resolve({ ok: true });
  }

  if (msg.cmd === "getOverlayState") {
    return Promise.resolve({ visible: typeof tabId === "number" && !!overlayOpen[tabId] });
  }

  if (msg.cmd === "getTabUrl") {
    return browser.tabs.get(tabId)
      .then(function (t) { return { url: t.url }; })
      .catch(function (e) { return { error: String(e.message || e) }; });
  }

  if (msg.cmd === "execute") {
    if (typeof tabId !== "number") {
      return Promise.resolve({ ok: false, error: "No target tab for this request" });
    }
    msg.tabId = tabId;
    return doExecute(msg)
      .catch(function (e) { return { ok: false, error: String(e.message || e) }; });
  }
});

/* ------------------------------------------------------------
   Toolbar button -> toggle the in-page overlay
   ------------------------------------------------------------ */

browser.browserAction.onClicked.addListener(function (tab) {
  browser.tabs.sendMessage(tab.id, { cmd: "toggleOverlay" })
    .catch(function () {
      /* no content script here - privileged page, or the extension
         was loaded after this tab was already open */
      browser.tabs.executeScript(tab.id, { file: "lib/md5.js" })
        .then(function () { return browser.tabs.executeScript(tab.id, { file: "payloads.js" }); })
        .then(function () { return browser.tabs.executeScript(tab.id, { file: "ui.js" }); })
        .then(function () { return browser.tabs.executeScript(tab.id, { file: "content.js" }); })
        .then(function () { return browser.tabs.sendMessage(tab.id, { cmd: "showOverlay" }); })
        .catch(function (e) {
          console.warn("[HackBar] cannot attach to this page:", e && e.message);
        });
    });
});
