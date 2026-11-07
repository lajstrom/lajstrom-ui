// Applies the stored or system theme before the first paint, so dark mode does not flash.
// A file rather than an inline script, so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem("lajstrom.theme");
    var dark = t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {
    // Storage disabled: light theme.
  }
})();
