/*
 * TalkEvent Augment content script.
 *
 * Two augmentations, applied to the proxied page and re-applied as the DOM mutates:
 *   1. Orange -> Blue: rewrite any orange-ish color found in inline styles,
 *      relevant CSS properties, and SVG fill/stroke attributes to a blue counterpart.
 *   2. RTL: set the document layout direction to right-to-left (text stays readable,
 *      layout mirrors).
 *
 * CSS file injection is not supported in Webfuse extensions, so all styling is done
 * from JavaScript. Content scripts run after the document loads.
 */
(function () {
    "use strict";

    // ---- Color handling ---------------------------------------------------

    // Target blue used to replace orange.
    var BLUE = { r: 33, g: 99, b: 235 }; // ~ #2163eb
    var BLUE_CSS = "rgb(33, 99, 235)";

    // Named oranges that commonly appear in author CSS / attributes.
    var NAMED_ORANGE = {
        orange: true,
        darkorange: true,
        orangered: true,
        coral: true,
        tomato: true,
        chocolate: true,
        sandybrown: true,
        peru: true
    };

    // CSS properties whose color values we rewrite.
    var COLOR_PROPS = [
        "color",
        "backgroundColor",
        "borderColor",
        "borderTopColor",
        "borderRightColor",
        "borderBottomColor",
        "borderLeftColor",
        "outlineColor",
        "fill",
        "stroke",
        "textDecorationColor",
        "caretColor",
        "columnRuleColor"
    ];

    // Decide whether an (r,g,b) triple is "orange-ish".
    // Orange = high red, mid green, low blue, with red clearly dominant.
    function isOrange(r, g, b) {
        if (r < 180) return false;            // needs strong red
        if (b > 110) return false;            // little blue
        if (g < 60 || g > 190) return false;  // mid green band
        if (r - b < 90) return false;         // red must dominate blue
        if (r - g < 40) return false;         // red must lead green (excludes yellow/red)
        return true;
    }

    function parseColor(str) {
        if (!str) return null;
        str = String(str).trim();
        var m = str.match(/^#([0-9a-f]{3})$/i);
        if (m) {
            var h = m[1];
            return {
                r: parseInt(h[0] + h[0], 16),
                g: parseInt(h[1] + h[1], 16),
                b: parseInt(h[2] + h[2], 16),
                a: 1
            };
        }
        m = str.match(/^#([0-9a-f]{6})$/i);
        if (m) {
            var h6 = m[1];
            return {
                r: parseInt(h6.slice(0, 2), 16),
                g: parseInt(h6.slice(2, 4), 16),
                b: parseInt(h6.slice(4, 6), 16),
                a: 1
            };
        }
        m = str.match(/^rgba?\(([^)]+)\)$/i);
        if (m) {
            var parts = m[1].split(",").map(function (p) { return p.trim(); });
            return {
                r: parseFloat(parts[0]),
                g: parseFloat(parts[1]),
                b: parseFloat(parts[2]),
                a: parts.length > 3 ? parseFloat(parts[3]) : 1
            };
        }
        return null;
    }

    // Returns a replacement color string if the input is orange, else null.
    function blueOrNull(value) {
        if (!value) return null;
        var v = String(value).trim();
        var lower = v.toLowerCase();
        if (NAMED_ORANGE[lower]) return BLUE_CSS;
        var c = parseColor(v);
        if (!c) return null;
        if (isOrange(c.r, c.g, c.b)) {
            if (c.a !== 1 && !isNaN(c.a)) {
                return "rgba(" + BLUE.r + ", " + BLUE.g + ", " + BLUE.b + ", " + c.a + ")";
            }
            return BLUE_CSS;
        }
        return null;
    }

    function recolorElement(el) {
        if (!el || el.nodeType !== 1) return;

        // Computed style tells us the *effective* color (covers stylesheet rules).
        var cs;
        try {
            cs = window.getComputedStyle(el);
        } catch (e) {
            cs = null;
        }
        if (cs) {
            for (var i = 0; i < COLOR_PROPS.length; i++) {
                var prop = COLOR_PROPS[i];
                var cssName = prop.replace(/[A-Z]/g, function (s) { return "-" + s.toLowerCase(); });
                var current = cs.getPropertyValue(cssName);
                var repl = blueOrNull(current);
                if (repl) {
                    el.style.setProperty(cssName, repl, "important");
                }
            }
        }

        // SVG presentation attributes.
        if (el.namespaceURI === "http://www.w3.org/2000/svg") {
            ["fill", "stroke", "stop-color"].forEach(function (attr) {
                var a = el.getAttribute(attr);
                var r = blueOrNull(a);
                if (r) el.setAttribute(attr, r);
            });
        }
    }

    function recolorAll(root) {
        var scope = root || document;
        if (scope.nodeType === 1) recolorElement(scope);
        var all = scope.querySelectorAll ? scope.querySelectorAll("*") : [];
        for (var i = 0; i < all.length; i++) recolorElement(all[i]);
    }

    // ---- RTL --------------------------------------------------------------

    function applyRtl() {
        if (document.documentElement) {
            document.documentElement.setAttribute("dir", "rtl");
            document.documentElement.style.setProperty("direction", "rtl", "important");
        }
        if (document.body) {
            document.body.setAttribute("dir", "rtl");
            document.body.style.setProperty("direction", "rtl", "important");
        }
    }

    // ---- Apply + keep applying on mutation --------------------------------

    function applyAll() {
        try { applyRtl(); } catch (e) {}
        try { recolorAll(document); } catch (e) {}
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", applyAll);
    } else {
        applyAll();
    }

    // Re-apply to dynamically added / changed content. Debounced to avoid thrash.
    var pending = false;
    var observer = new MutationObserver(function (mutations) {
        if (pending) return;
        pending = true;
        (window.requestAnimationFrame || window.setTimeout)(function () {
            pending = false;
            applyRtl();
            for (var i = 0; i < mutations.length; i++) {
                var mu = mutations[i];
                if (mu.type === "childList") {
                    for (var j = 0; j < mu.addedNodes.length; j++) {
                        var n = mu.addedNodes[j];
                        if (n.nodeType === 1) recolorAll(n);
                    }
                } else if (mu.type === "attributes" && mu.target) {
                    recolorElement(mu.target);
                }
            }
        }, 0);
    });

    function startObserver() {
        if (!document.documentElement) return;
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["style", "class", "fill", "stroke"]
        });
    }

    if (document.body) {
        startObserver();
    } else {
        document.addEventListener("DOMContentLoaded", startObserver);
    }
})();
