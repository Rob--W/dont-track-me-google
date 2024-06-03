// This script is the part of Don't Track Me Google (DTMG) that modifies
// objects in the page's context. It should run in the MAIN world.
// It may run in the ISOLATED world if the MAIN world is not supported.

// This content script runs as document_start, so we can have some assurance
// that the methods in the page are reliable.

// Keep the following functions in sync with contentscript.js:
// - getRealLinkFromGoogleUrl
// - getReferrerPolicy (dtmgLink.referrerPolicy)
// - isNoPingEnabled (dtmgLink.noping)

// The indentation of this file is somewhat strange:
// - getRealLinkFromGoogleUrl is not indented, for easier diffing against
//   its copy in contentscript.js
// - The comments before setupAggresiveUglyLinkPreventer, blockTrackingBeacons
//   and overwriteWindowOpen have not been indented yet because of blame.

;(function dtmg_main_closure() {
    // This element is inserted by contentscript.js
    var dtmgLink = document.querySelector('link#dont_track_me_google_link');

    if (injectInMainWorldIfIsolatedWorldInFirefox()) {
        // world:"MAIN" was not supported by Firefox: https://bugzil.la/1736575
        // ... and we ended up being executed in the ISOLATED world.
        // Note: in Chrome we set minimum_chrome_version:111, which implies
        // availability of world:MAIN, as introduced in:
        // https://chromium.googlesource.com/chromium/src/+/8f07eaff87947a2e93214de2695de8052119180b
        return;
    }

    // These are the main functions:
    setupAggresiveUglyLinkPreventer();
    blockTrackingBeacons();
    overwriteWindowOpen();
    if (dtmgLink) {
        dtmgLink.remove();
    }

/**
 * @param {URL|HTMLHyperlinkElementUtils} a
 * @returns {String} the real URL if the given link is a Google redirect URL.
 */
function getRealLinkFromGoogleUrl(a) {
    if (a.protocol !== 'https:' && a.protocol !== 'http:') {
        return;
    }
    var url;
    if ((a.hostname === location.hostname || a.hostname === 'www.google.com') &&
        (a.pathname === '/url' || a.pathname === '/local_url' ||
         a.pathname === '/searchurl/rr.html' ||
         a.pathname === '/linkredirect')) {
        // Google Maps / Dito (/local_url?q=<url>)
        // Mobile (/url?q=<url>)
        // Google Meet's chat (/linkredirect?authuser=0&dest=<url>)
        url = /[?&](?:q|url|dest)=((?:https?|ftp)[%:][^&]+)/.exec(a.search);
        if (url) {
            return decodeURIComponent(url[1]);
        }
        // Help pages, e.g. safe browsing (/url?...&q=%2Fsupport%2Fanswer...)
        url = /[?&](?:q|url)=((?:%2[Ff]|\/)[^&]+)/.exec(a.search);
        if (url) {
            return a.origin + decodeURIComponent(url[1]);
        }
        // Redirect pages for Android intents (/searchurl/rr.html#...&url=...)
        // rr.html only supports http(s). So restrict to http(s) only.
        url = /[#&]url=(https?[:%][^&]+)/.exec(a.hash);
        if (url) {
            return decodeURIComponent(url[1]);
        }
    }
    // Google Search with old mobile UA (e.g. Firefox 41).
    if (a.hostname === 'googleweblight.com' && a.pathname === '/fp') {
        url = /[?&]u=((?:https?|ftp)[%:][^&]+)/.exec(a.search);
        if (url) {
            return decodeURIComponent(url[1]);
        }
    }
}

/**
 * Intercept the .href setter in the page so that the page can never change the
 * URL to a tracking URL. Just intercepting mousedown/touchstart is not enough
 * because e.g. on Google Maps, the page rewrites the URL in the contextmenu
 * event at the bubbling event stage and then stops the event propagation. So
 * there is no event-driven way to fix the URL. The DOMAttrModified event could
 * be used, but the event is deprecated, so not a viable long-term solution.
 */
    function setupAggresiveUglyLinkPreventer() {
        var proto = HTMLAnchorElement.prototype;
        // The link target can be changed in many ways, but let's only consider
        // the .href attribute since it's probably the only used setter.
        var hrefProp = Object.getOwnPropertyDescriptor(proto, 'href');
        var hrefGet = Function.prototype.call.bind(hrefProp.get);
        var hrefSet = Function.prototype.call.bind(hrefProp.set);

        Object.defineProperty(proto, 'href', {
            configurable: true,
            enumerable: true,
            get() {
                return hrefGet(this);
            },
            set(v) {
                hrefSet(this, v);
                try {
                    v = getRealLinkFromGoogleUrl(this);
                    if (v) {
                        hrefSet(this, v);
                    }
                } catch (e) {
                    // Not expected to happen, but don't break the setter if for
                    // some reason the (hostile) page broke the link APIs.
                }
                updateReferrerPolicy(this);
            },
        });
        function replaceAMethod(methodName, methodFunc) {
            // Overwrite the methods without triggering setters, because that
            // may inadvertently overwrite the prototype, as observed in
            // https://github.com/Rob--W/dont-track-me-google/issues/52#issuecomment-1596207655
            Object.defineProperty(proto, methodName, {
                configurable: true,
                // All methods that we are overriding are not part of
                // HTMLAnchorElement.prototype, but inherit.
                enumerable: false,
                writable: true,
                value: methodFunc,
            });
        }

        // proto inherits Element.prototype.setAttribute:
        var setAttribute = Function.prototype.call.bind(proto.setAttribute);
        replaceAMethod('setAttribute', function(name, value) {
            // Attribute names are not case-sensitive, but weird capitalizations
            // are unlikely, so only check all-lowercase and all-uppercase.
            if (name === 'href' || name === 'HREF') {
                this.href = value;
            } else {
                setAttribute(this, name, value);
            }
        });

        // proto inherits EventTarget.prototype.dispatchEvent:
        var aDispatchEvent = Function.prototype.apply.bind(proto.dispatchEvent);
        replaceAMethod('dispatchEvent', function() {
            updateReferrerPolicy(this);
            return aDispatchEvent(this, arguments);
        });

        // proto inherits HTMLElement.prototype.click:
        var aClick = Function.prototype.apply.bind(proto.click);
        replaceAMethod('click', function() {
            updateReferrerPolicy(this);
            return aClick(this, arguments);
        });

        var rpProp = Object.getOwnPropertyDescriptor(proto, 'referrerPolicy');
        var rpGet = Function.prototype.call.bind(rpProp.get);
        var rpSet = Function.prototype.call.bind(rpProp.set);

        function getReferrerPolicy() {
            // This mirrors getReferrerPolicy() from contentscript.js; by
            // default, forceNoReferrer = true, which translates to 'origin'.
            return dtmgLink ? dtmgLink.referrerPolicy : 'origin';
        }

        function updateReferrerPolicy(a) {
            try {
                if (rpGet(a) === 'no-referrer') {
                    // "no-referrer" is more privacy-friendly than "origin".
                    return;
                }
                var referrerPolicy = getReferrerPolicy();
                if (referrerPolicy) {
                    rpSet(a, referrerPolicy);
                }
            } catch (e) {
                // Not expected to happen, but don't break callers if it happens
                // anyway.
            }
        }
    }

// Block sendBeacon requests with destination /gen_204, because Google
// asynchronously sends beacon requests in response to mouse events on links:
// https://github.com/Rob--W/dont-track-me-google/issues/20
//
// This implementation also blocks other forms of tracking via gen_204 as a side
// effect. That is not fully intentional, but given the lack of obvious ways to
// discern such link-tracking events from others, I will block all of them.
    function blockTrackingBeacons() {
        var navProto = window.Navigator.prototype;
        var navProtoSendBeacon = navProto.sendBeacon;
        if (!navProtoSendBeacon) {
            return;
        }
        var sendBeacon = Function.prototype.apply.bind(navProtoSendBeacon);

        // Blocks the following:
        //   gen_204
        //   /gen_204
        //   https://www.google.com/gen_204
        var isTrackingUrl = RegExp.prototype.test.bind(
            /^(?:(?:https?:\/\/[^\/]+)?\/)?gen_204(?:[?#]|$)/);

        navProto.sendBeacon = function(url, data) {
            if (isTrackingUrl(url) && isNoPingEnabled()) {
                // Lie that the data has been transmitted to avoid fallbacks.
                return true;
            }
            return sendBeacon(this, arguments);
        };

        function isNoPingEnabled() {
            try {
                // Mirrors the noping variable from contentscript.js
                return dtmgLink ? dtmgLink.disabled : true;
            } catch (e) {
                return true;
            }
        }
    }

// Google sometimes uses window.open() to open ugly links.
// https://github.com/Rob--W/dont-track-me-google/issues/18
// https://github.com/Rob--W/dont-track-me-google/issues/41
    function overwriteWindowOpen() {
        var open = window.open;
        window.open = function(url, windowName, windowFeatures) {
            var isBlankUrl = !url || url === "about:blank";
            try {
                if (!isBlankUrl) {
                    var a = document.createElement('a');
                    // Triggers getRealLinkFromGoogleUrl via the href setter in
                    // setupAggresiveUglyLinkPreventer.
                    a.href = url;
                    url = a.href;
                    // The origin check exists to avoid adding "noreferrer" to
                    // same-origin popups. That implies noopener and causes
                    // https://github.com/Rob--W/dont-track-me-google/issues/43
                    // And allow any Google domain to support auth popups:
                    // https://github.com/Rob--W/dont-track-me-google/issues/45
                    // And don't bother editing the list if it already contains
                    // "opener" (it would be disabled by "noreferrer").
                    if (a.referrerPolicy && a.origin !== location.origin &&
                        !/\.google\.([a-z]+)$/.test(a.hostname) &&
                        !/\bopener|noreferrer/.test(windowFeatures)) {
                        if (windowFeatures) {
                            windowFeatures += ',';
                        } else {
                            windowFeatures = '';
                        }
                        windowFeatures += 'noreferrer';
                    }
                }
            } catch (e) {
                // Not expected to happen, but don't break callers if it does.
            }
            var win = open(url, windowName, windowFeatures);
            try {
                if (isBlankUrl && win) {
                    // In Google Docs, sometimes a blank document is opened,
                    // and document.write is used to insert a redirector.
                    // https://github.com/Rob--W/dont-track-me-google/issues/41
                    var doc = win.document;
                    var docWrite = win.Function.prototype.call.bind(doc.write);
                    doc.write = function(markup) {
                        try {
                            markup = fixupDocMarkup(markup);
                        } catch (e) {
                            // Not expected, but don't break callers otherwise.
                        }
                        return docWrite(this, markup);
                    };
                }
            } catch (e) {
                // Not expected to happen, but don't break callers if it does.
            }
            return win;
        };
        function fixupDocMarkup(html) {
            html = html || '';
            html += '';
            return html.replace(
                /<meta [^>]*http-equiv=(["']?)refresh\1[^>]*>/i,
                function(m) {
                    var doc = new DOMParser().parseFromString(m, 'text/html');
                    var meta = doc.querySelector('meta[http-equiv=refresh]');
                    return meta && fixupMetaUrl(meta) || m;
                });
        }
        function fixupMetaUrl(meta) {
            var parts = /^(\d*;\s*url=)(.+)$/i.exec(meta.content);
            if (!parts) {
                return;
            }
            var metaPrefix = parts[1];
            var url = parts[2];
            var a = document.createElement('a');
            // Triggers getRealLinkFromGoogleUrl via the href setter in
            // setupAggresiveUglyLinkPreventer.
            a.href = url;
            url = a.href;
            meta.content = metaPrefix + url;

            var html = meta.outerHTML;
            if (a.referrerPolicy) {
                // Google appears to already append the no-referrer
                // meta tag, but add one just in case it doesn't.
                html = '<meta name="referrer" content="no-referrer">' + html;
            }
            return html;
        }
    }

    function injectInMainWorldIfIsolatedWorldInFirefox() {
        /* globals globalThis */
        if (globalThis === window) {
            // Content script world check relies on https://bugzil.la/1208775
            // (globalThis is the content script's Sandbox global in Firefox).
            // In Chrome, globalThis === window is always true, and in every
            // regular browser (including Firefox), being in the main world
            // implies globalThis === window.
            return false;
        }
        // Extra sanity checks in case the above logic was messed up.
        let browser = globalThis.browser;
        if (
            typeof browser !== 'object' ||
            !browser.runtime ||
            typeof browser.runtime.getURL !== 'function'
        ) {
            return false;
        }
        var mainWorldScript = browser.runtime.getURL('main_world_script.js');
        if (!mainWorldScript.startsWith('moz-extension:')) {
            return false; // Unexpectedly not Firefox.
        }

        // MV2 extensions in Firefox can inject moz-extension:-scripts without
        // web_accessible_resources. MV3 cannot: https://bugzil.la/1783078
        // MV3 should use world:main when available: https://bugzil.la/1736575
        var s = document.createElement('script');
        s.src = mainWorldScript;

        // Use closed shadow DOM to avoid leaking extension UUID to the page.
        var shadowHost = document.createElement('span');
        shadowHost.attachShadow({ mode: 'closed' }).append(s);
        s.onload = s.onerror = function() {
            shadowHost.remove();
            s.onload = s.onerror = null;
        };
        (document.body || document.documentElement).append(shadowHost);
        return true;
    }
})();
