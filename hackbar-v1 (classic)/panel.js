/* ============================================================
   HackBar Classic - DevTools panel mount.

   Thin adapter: builds the shared UI and routes its two host
   calls through the background page, scoped to the tab that
   DevTools is inspecting.
   ============================================================ */
"use strict";

var TAB_ID = browser.devtools.inspectedWindow.tabId;

document.body.insertAdjacentHTML("afterbegin", HB_MARKUP);

HB_createUI(document, {

  getTabUrl: function () {
    return browser.runtime.sendMessage({ cmd: "getTabUrl", tabId: TAB_ID })
      .then(function (r) {
        if (r && r.error) throw new Error(r.error);
        return r && r.url;
      });
  },

  execute: function (spec) {
    spec.cmd = "execute";
    spec.tabId = TAB_ID;
    return browser.runtime.sendMessage(spec);
  }
});
