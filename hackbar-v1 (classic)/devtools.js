/* Registers the HackBar panel inside the DevTools toolbox.
   This is the closest modern analogue to the old XUL toolbar: full width,
   horizontal, and persistent across page navigations. */
browser.devtools.panels.create(
  "HackBar",
  "icons/icon.svg",
  "panel.html"
);
