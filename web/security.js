/* Loaded synchronously in <head> before any other JS so a malicious
   frame-loader cannot delay-init us. Safe no-op when not framed. */
(function () {
    "use strict";
    if (window.top !== window.self) {
        try { window.top.location = window.self.location; }
        catch (e) { document.documentElement.style.display = "none"; }
    }
})();
