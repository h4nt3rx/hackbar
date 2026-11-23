/* ============================================================
   HackBar Classic - shared UI.

   One implementation, two mounts:
     - the DevTools panel        (panel.js)
     - the in-page F9 overlay    (content.js)

   HB_MARKUP is the interface. HB_createUI(root, api) wires it up
   against whichever host supplied `api`:

     api.getTabUrl() -> Promise<string>
     api.execute(spec) -> Promise<{ok, note} | {ok:false, error}>
     api.onClose      -> optional, shows a close button
   ============================================================ */
"use strict";

var HB_MARKUP = [
  '<div id="hb">',
  '  <div class="hb-menubar">',
  '    <select id="injMode" title="SQL injection point type">',
  '      <option value="INT">INT</option>',
  '      <option value="STR">STR</option>',
  '    </select>',
  '    <span class="hb-dots" title="Request status">',
  '      <i id="dotIdle" class="dot dot-idle on"></i>',
  '      <i id="dotOk" class="dot dot-ok"></i>',
  '      <i id="dotWarn" class="dot dot-warn"></i>',
  '    </span>',
  '    <span class="hb-menu" data-menu="SQL">SQL<b>&#9662;</b></span>',
  '    <span class="hb-menu" data-menu="XSS">XSS<b>&#9662;</b></span>',
  '    <span class="hb-menu" data-menu="Encryption">Encryption<b>&#9662;</b></span>',
  '    <span class="hb-menu" data-menu="Encoding">Encoding<b>&#9662;</b></span>',
  '    <span class="hb-menu" data-menu="Other">Other<b>&#9662;</b></span>',
  '    <span class="hb-spacer"></span>',
  '    <span id="hbStatus" class="hb-status"></span>',
  '    <span id="hbClose" class="hb-close hidden" title="Hide HackBar (F9)">&#10005;</span>',
  '  </div>',
  '  <div class="hb-main">',
  '    <div class="hb-buttons">',
  '      <button id="btnLoad" title="Load this page\'s URL (Alt+A)">Load URL <span class="gly">&#8635;</span></button>',
  '      <button id="btnSplit" title="Split the query string onto separate lines (Alt+P)">Split URL <span class="gly">&#9986;</span></button>',
  '      <button id="btnExecute" title="Send the request (Alt+X)">Execute <span class="gly">&#9654;</span></button>',
  '    </div>',
  '    <div class="hb-fields">',
  '      <textarea id="urlBox" spellcheck="false" placeholder="http://target/path?param=value"></textarea>',
  '      <div id="postWrap" class="hb-sub hidden">',
  '        <label class="hb-sublabel">Post data</label>',
  '        <textarea id="postBox" spellcheck="false" placeholder="a=1&amp;b=2"></textarea>',
  '      </div>',
  '      <div id="refWrap" class="hb-sub hidden">',
  '        <label class="hb-sublabel">Referrer</label>',
  '        <textarea id="refBox" spellcheck="false" rows="1" placeholder="http://target/"></textarea>',
  '      </div>',
  '      <div id="advWrap" class="hb-sub hidden">',
  '        <label class="hb-sublabel">Advanced</label>',
  '        <div class="hb-adv">',
  '          <label class="ck"><input type="checkbox" id="ckMultipart"> Use multipart/form-data</label>',
  '          <label class="ck"><input type="checkbox" id="ckNewTab"> Send in a new tab</label>',
  '        </div>',
  '      </div>',
  '    </div>',
  '    <div class="hb-plus"><button id="btnPlus" title="Show advanced options">+</button></div>',
  '  </div>',
  '  <div class="hb-footer">',
  '    <label class="ck"><input type="checkbox" id="ckPost"> Enable Post data</label>',
  '    <label class="ck"><input type="checkbox" id="ckRef"> Enable Referrer</label>',
  '  </div>',
  '</div>',
  '<div id="hbPop" class="hb-pop hidden"></div>'
].join("\n");


function HB_createUI(root, api) {

  var $ = function (id) { return root.getElementById(id); };

  var urlBox   = $("urlBox"),
      postBox  = $("postBox"),
      refBox   = $("refBox"),
      ckPost   = $("ckPost"),
      ckRef    = $("ckRef"),
      ckMulti  = $("ckMultipart"),
      ckNewTab = $("ckNewTab"),
      injMode  = $("injMode"),
      pop      = $("hbPop"),
      statusEl = $("hbStatus"),
      closeEl  = $("hbClose");

  /* payload target follows focus */
  var activeField = urlBox;
  [urlBox, postBox, refBox].forEach(function (f) {
    f.addEventListener("focus", function () { activeField = f; });
  });

  /* ---------------- status ---------------- */

  function setDots(which) {
    ["dotIdle", "dotOk", "dotWarn"].forEach(function (id) { $(id).classList.remove("on"); });
    $(which).classList.add("on");
  }

  function status(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "hb-status" + (kind ? " " + kind : "");
    if (kind === "err")     setDots("dotWarn");
    else if (kind === "ok") setDots("dotOk");
    else                    setDots("dotIdle");
  }

  /* ---------------- shared persistence ----------------
     Both mounts read and write the same hbState key, so the
     DevTools panel and the F9 overlay stay in sync.           */

  function collectState() {
    return {
      url: urlBox.value, post: postBox.value, ref: refBox.value,
      usePost: ckPost.checked, useRef: ckRef.checked,
      multipart: ckMulti.checked, newTab: ckNewTab.checked,
      mode: injMode.value
    };
  }

  var saveTimer = null, suppressSync = false;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      suppressSync = true;
      browser.storage.local.set({ hbState: collectState() })
        .then(function () { setTimeout(function () { suppressSync = false; }, 50); });
    }, 250);
  }

  /* Executing navigates the page out from under us, which would drop a
     debounced save and lose whatever was typed in the last 250ms. Flush
     first, then send. */
  function flushState() {
    clearTimeout(saveTimer);
    suppressSync = true;
    return browser.storage.local.set({ hbState: collectState() })
      .then(function () { setTimeout(function () { suppressSync = false; }, 50); })
      .catch(function () { suppressSync = false; });
  }

  function applyState(s) {
    if (!s) return;
    urlBox.value  = s.url  || "";
    postBox.value = s.post || "";
    refBox.value  = s.ref  || "";
    ckPost.checked   = !!s.usePost;
    ckRef.checked    = !!s.useRef;
    ckMulti.checked  = !!s.multipart;
    ckNewTab.checked = !!s.newTab;
    injMode.value    = s.mode || "INT";
    syncToggles();
  }

  function restoreState() {
    return browser.storage.local.get("hbState").then(function (r) {
      applyState(r && r.hbState);
    });
  }

  browser.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local" || !changes.hbState || suppressSync) return;
    var focused = root.activeElement;
    if (focused === urlBox || focused === postBox || focused === refBox) return;
    applyState(changes.hbState.newValue);
  });

  [urlBox, postBox, refBox].forEach(function (f) {
    f.addEventListener("input", saveState);
  });
  [ckPost, ckRef, ckMulti, ckNewTab, injMode].forEach(function (c) {
    c.addEventListener("change", function () { syncToggles(); saveState(); });
  });

  function syncToggles() {
    $("postWrap").classList.toggle("hidden", !ckPost.checked);
    $("refWrap").classList.toggle("hidden", !ckRef.checked);
  }

  $("btnPlus").addEventListener("click", function () {
    $("advWrap").classList.toggle("hidden");
  });

  /* ---------------- undoable programmatic edits ----------------

     Assigning .value rewrites the field behind the editor's back and
     clears the native undo stack, so after any Load, Split, encode or
     payload insert, Ctrl+Z would do nothing - including undoing what
     you had typed by hand before it. Routing every programmatic edit
     through execCommand("insertText") makes the editor record it as a
     normal edit, so Ctrl+Z / Ctrl+Shift+Z step back through it.

     execCommand is deprecated but it is the only API that writes to a
     text field *and* keeps undo; setRangeText and .value both drop it.
     Fall back to assignment if it is ever refused. */

  function editField(field, start, end, text) {
    field.focus();
    field.setSelectionRange(start, end);

    var ok = false;
    try {
      var doc = field.ownerDocument || document;
      if (text !== "")        ok = doc.execCommand("insertText", false, text);
      else if (start !== end) ok = doc.execCommand("delete");
      else                    ok = true;
    } catch (err) { ok = false; }

    if (!ok) {
      var v = field.value;
      field.value = v.slice(0, start) + text + v.slice(end);
    }
    saveState();
  }

  /* Keys typed in the bar belong to the bar. The overlay lives inside
     the target page, so without this a page listener sees them too and
     can act on them - or preventDefault Ctrl+Z and kill undo outright.
     Capture-phase listeners on window still run first, so F9 keeps
     working while a field has focus. */

  ["keydown", "keyup", "keypress"].forEach(function (type) {
    root.addEventListener(type, function (e) { e.stopPropagation(); });
  });

  /* ---------------- the three classic actions ---------------- */

  function loadUrl() {
    Promise.resolve(api.getTabUrl()).then(function (url) {
      if (!url) { status("Could not read the page URL", "err"); return; }
      editField(urlBox, 0, urlBox.value.length, url);
      status("Loaded", "ok");
    }).catch(function (e) { status(String(e.message || e), "err"); });
  }

  function splitUrl() {
    var v = urlBox.value.replace(/\r?\n/g, "");
    editField(urlBox, 0, urlBox.value.length,
              v.replace(/\?/, "?\n").replace(/&/g, "\n&"));
    status("Split", "ok");
  }

  function execute() {
    var url = urlBox.value.replace(/\r?\n/g, "").trim();
    if (!url) { status("Nothing to send", "err"); return; }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "http://" + url;

    status("Sending...", null);

    flushState().then(function () {
      return api.execute({
        url: url,
        usePost: ckPost.checked,
        postData: postBox.value.replace(/\r?\n/g, ""),
        useReferer: ckRef.checked,
        referer: refBox.value.replace(/\r?\n/g, "").trim(),
        multipart: ckMulti.checked,
        newTab: ckNewTab.checked
      });
    }).then(function (r) {
      if (r && r.ok) status(r.note || "Sent", "ok");
      else status((r && r.error) || "Request failed", "err");
    }).catch(function (e) { status(String(e.message || e), "err"); });
  }

  $("btnLoad").addEventListener("click", loadUrl);
  $("btnSplit").addEventListener("click", splitUrl);
  $("btnExecute").addEventListener("click", execute);

  if (api.onClose) {
    closeEl.classList.remove("hidden");
    closeEl.addEventListener("click", api.onClose);
  }

  /* ---------------- classic shortcuts ---------------- */

  root.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); execute(); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    var k = (e.key || "").toLowerCase();
    if (k === "a")      { e.preventDefault(); loadUrl();  }
    else if (k === "p") { e.preventDefault(); splitUrl(); }
    else if (k === "x") { e.preventDefault(); execute();  }
  });

  /* ---------------- caret insert / selection transform ---------------- */

  function insertAtCaret(field, text) {
    var s = field.selectionStart, e = field.selectionEnd;
    editField(field, s, e, text);
    var caret = s + text.length;
    field.setSelectionRange(caret, caret);
  }

  function applyTransform(field, fn) {
    var s = field.selectionStart, e = field.selectionEnd;
    var whole = s === e;
    var target = whole ? field.value : field.value.slice(s, e);

    Promise.resolve(fn(target)).then(function (out) {
      out = String(out);
      if (whole) {
        editField(field, 0, field.value.length, out);
        field.setSelectionRange(out.length, out.length);
      } else {
        editField(field, s, e, out);
        field.setSelectionRange(s, s + out.length);
      }
      status("Applied", "ok");
    }).catch(function (err) {
      status("Transform failed: " + (err.message || err), "err");
    });
  }

  /* ---------------- dropdown menus ---------------- */

  function closeMenus() {
    pop.classList.add("hidden");
    pop.innerHTML = "";
    Array.prototype.forEach.call(
      root.querySelectorAll(".hb-menu.open"),
      function (m) { m.classList.remove("open"); }
    );
  }

  function openMenu(labelEl) {
    var items = HB_MENUS[labelEl.dataset.menu];
    if (!items) return;

    closeMenus();
    labelEl.classList.add("open");

    var frag = document.createDocumentFragment();
    items.forEach(function (it) {
      var el = document.createElement("div");
      if (it.sep) {
        el.className = "sep";
      } else if (it.grp) {
        el.className = "grp";
        el.textContent = it.grp;
      } else {
        el.className = "item";
        el.textContent = it.label;
        el.title = it.label;
        el.addEventListener("click", function () {
          var field = activeField || urlBox;
          if (it.xform) {
            applyTransform(field, it.xform);
          } else if (it.insert) {
            insertAtCaret(field, (typeof it.insert === "function")
              ? it.insert({ mode: injMode.value })
              : it.insert);
          }
          closeMenus();
        });
      }
      frag.appendChild(el);
    });

    pop.appendChild(frag);
    pop.classList.remove("hidden");

    var r = labelEl.getBoundingClientRect();
    var hostTop = api.popAnchorTop ? api.popAnchorTop() : 0;
    pop.style.left = Math.max(2, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4)) + "px";
    pop.style.top  = (r.bottom - hostTop) + "px";
  }

  Array.prototype.forEach.call(root.querySelectorAll(".hb-menu"), function (m) {
    m.addEventListener("click", function (e) {
      e.stopPropagation();
      if (m.classList.contains("open")) closeMenus();
      else openMenu(m);
    });
  });

  root.addEventListener("click", closeMenus);
  root.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenus();
  });

  /* ---------------- boot ---------------- */

  restoreState().then(function () { status("Ready"); });

  return { closeMenus: closeMenus, focusUrl: function () { urlBox.focus(); }, reload: restoreState };
}
