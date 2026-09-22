// Corsiri AI - Stealth & Tab-Detection Cloaking Engine
// Completely prevents websites from detecting tab switches, focus loss, window blurs, or overlay interactions.
(function () {
  "use strict";

  if (window.__corsiri_stealth_installed__) return;
  window.__corsiri_stealth_installed__ = true;

  try {
    // 1. Override document.hidden, visibilityState, and vendor prefixes
    const defineGetter = (obj, prop, getter) => {
      try {
        Object.defineProperty(obj, prop, {
          get: getter,
          set: () => {},
          configurable: true,
          enumerable: true
        });
      } catch {}
    };

    defineGetter(Document.prototype, "hidden", () => false);
    defineGetter(document, "hidden", () => false);
    defineGetter(Document.prototype, "visibilityState", () => "visible");
    defineGetter(document, "visibilityState", () => "visible");

    defineGetter(Document.prototype, "webkitHidden", () => false);
    defineGetter(document, "webkitHidden", () => false);
    defineGetter(Document.prototype, "webkitVisibilityState", () => "visible");
    defineGetter(document, "webkitVisibilityState", () => "visible");

    defineGetter(Document.prototype, "mozHidden", () => false);
    defineGetter(document, "mozHidden", () => false);
    defineGetter(Document.prototype, "mozVisibilityState", () => "visible");
    defineGetter(document, "mozVisibilityState", () => "visible");

    defineGetter(Document.prototype, "msHidden", () => false);
    defineGetter(document, "msHidden", () => false);
    defineGetter(Document.prototype, "msVisibilityState", () => "visible");
    defineGetter(document, "msVisibilityState", () => "visible");

    // 2. Override hasFocus to always return true
    try {
      Document.prototype.hasFocus = function () { return true; };
      document.hasFocus = function () { return true; };
    } catch {}

    // 3. Block tab-switch & blur events in the capturing phase before page listeners can ever see them
    const BLOCKED_EVENTS = new Set([
      "blur",
      "focusout",
      "visibilitychange",
      "webkitvisibilitychange",
      "mozvisibilitychange",
      "msvisibilitychange"
    ]);

    const captureHandler = function (e) {
      if (e && (BLOCKED_EVENTS.has(e.type) || e.type === "visibilitychange")) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return false;
      }
    };

    window.addEventListener("blur", captureHandler, true);
    window.addEventListener("focusout", captureHandler, true);
    document.addEventListener("visibilitychange", captureHandler, true);
    document.addEventListener("webkitvisibilitychange", captureHandler, true);
    document.addEventListener("mozvisibilitychange", captureHandler, true);
    document.addEventListener("msvisibilitychange", captureHandler, true);
    document.addEventListener("focusout", captureHandler, true);

    // 4. Hook EventTarget.prototype.addEventListener to neutralize tab-detection listeners
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const lowerType = (type || "").toLowerCase().trim();

      if (BLOCKED_EVENTS.has(lowerType)) {
        // Wrap listener to never execute for blur/visibilitychange
        const wrappedListener = function (evt) {
          // If a blur/visibilitychange event somehow reaches here, suppress it
          return;
        };
        return originalAddEventListener.call(this, type, wrappedListener, options);
      }

      if (lowerType === "mouseleave" || lowerType === "mouseout") {
        if (this === document || this === window || this === document.documentElement || this === document.body) {
          const wrappedMouseListener = function (evt) {
            // If mouse is still on screen or over overlay, don't report leave
            if (evt && (evt.clientX > 0 && evt.clientX < window.innerWidth && evt.clientY > 0 && evt.clientY < window.innerHeight)) {
              return;
            }
            if (typeof listener === "function") {
              return listener.call(this, evt);
            } else if (listener && typeof listener.handleEvent === "function") {
              return listener.handleEvent(evt);
            }
          };
          return originalAddEventListener.call(this, type, wrappedMouseListener, options);
        }
      }

      return originalAddEventListener.call(this, type, listener, options);
    };

    // 5. Neutralize onblur / onvisibilitychange / onfocusout property setters
    const neutralizeProperty = (target, propName) => {
      try {
        let _dummy = null;
        Object.defineProperty(target, propName, {
          get: () => null,
          set: (fn) => {
            // Silently ignore or store dummy so website thinks it succeeded
            _dummy = null;
          },
          configurable: true,
          enumerable: true
        });
      } catch {}
    };

    neutralizeProperty(window, "onblur");
    neutralizeProperty(document, "onblur");
    neutralizeProperty(document, "onvisibilitychange");
    neutralizeProperty(window, "onvisibilitychange");
    neutralizeProperty(document, "onwebkitvisibilitychange");
    neutralizeProperty(window, "onwebkitvisibilitychange");
    neutralizeProperty(window, "onfocusout");
    neutralizeProperty(document, "onfocusout");

    if (document.body) {
      neutralizeProperty(document.body, "onblur");
      neutralizeProperty(document.body, "onfocusout");
    }

    // 6. Ensure window.top/self relationships are standard
    window.addEventListener("DOMContentLoaded", () => {
      if (document.body) {
        neutralizeProperty(document.body, "onblur");
        neutralizeProperty(document.body, "onfocusout");
      }
    });

  } catch (err) {
    // Fail-safe stealth init
  }
})();
