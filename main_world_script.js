// This script is the part of Don't Track Me Google (DTMG) that modifies
// objects in the page's context. It should run in the MAIN world.
// It may run in the ISOLATED world if the MAIN world is not supported.

// This content script runs as document_start, so we can have some assurance
// that the methods in the page are reliable.

// Keep the following functions in sync with contentscript.js:
// - getRealLinkFromGoogleUrl
// - getGoogleGotoUrl
// - resolveGoogleGotoUrl (function body differs, keep logic equivalent)
// - getReferrerPolicy (dtmgLink.referrerPolicy)
// - isNoPingEnabled (dtmgLink.noping)

// The indentation of this file is somewhat strange:
// - getRealLinkFromGoogleUrl is not indented, for easier diffing against
//   its copy in contentscript.js
// - The comments before setupAggresiveUglyLinkPreventer, blockTrackingBeacons
//   and overwriteWindowOpen have not been indented yet because of blame.

(function dtmg_main_closure() {
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
    if ((a.hostname === location.hostname || a.hostname === 'www.google.com' || a.hostname === 'www.youtube.com') &&
        (a.pathname === '/url' || a.pathname === '/local_url' ||
         a.pathname === '/searchurl/rr.html' ||
         a.pathname === '/linkredirect' || a.pathname === '/redirect')) {
        // Google Maps / Dito (/local_url?q=<url>)
        // Mobile (/url?q=<url>)
        // Google Meet's chat (/linkredirect?authuser=0&dest=<url>)
        // YouTube (/redirect?q=<url>)
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
    const gotoUrl = getGoogleGotoUrl(a);
    if (gotoUrl) {
        try {
            url = resolveGoogleGotoUrl(a, gotoUrl);
            if (url) {
                return url;
            }
        } catch (e) {
            // console.error("[DTMG] resolveGoogleGotoUrl failed:", e);
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
 * Since aug 2026, https://www.google.com/goto?url= is very common:
 * https://github.com/Rob--W/dont-track-me-google/issues/67
 *
 * @param {URL|HTMLHyperlinkElementUtils} a
 * @returns {string} "/goto?..." if link is a Google /goto URL or equivalent.
 */
function getGoogleGotoUrl(a) {
    if (a.hostname !== location.hostname && a.hostname !== 'www.google.com') {
        return;
    }
    if (a.pathname === '/goto') {
        // "/goto?url=CAES..."
        return a.pathname + a.search;
    }
    if (a.pathname === '/url') {
        // "/url?...&url=CAES&..." is generated on pointer release by Google,
        // after we fix up a /goto URL in handlePointerPress.
        let urlGotoParam = /(?<=[?&])url=CAES[^&#]+/.exec(a.search);
        if (urlGotoParam) {
            return '/goto?' + urlGotoParam[0];
        }
    }
}

/**
 * Resolves a /goto?url=... to the actual destination; see
 * https://github.com/Rob--W/dont-track-me-google/issues/67 and
 * https://github.com/Rob--W/dont-track-me-google/issues/67#issuecomment-5469760244
 *
 * May unexpectedly throw due to direct interactions with the main world.
 *
 * @param {URL|HTMLHyperlinkElementUtils} a
 * @param {string} gotoUrl - value of getGoogleGotoUrl(a)
 * @returns {String} The URL for the given /goto?url=... URL, if known.
 */
function resolveGoogleGotoUrl(a, gotoUrl) {
    // The format of a /goto?url= is explained at
    // https://github.com/Rob--W/dont-track-me-google/issues/67#issuecomment-4826792358
    // https://github.com/Rob--W/dont-track-me-google/issues/67#issuecomment-4826901453
    // ... and is basically an encrypted version of the actual URL. Assuming
    // properly implemented crypto, the only way to resolve the URL is:
    //
    // - Identify a side channel from which the URL can be recovered. The
    //   downside is that this is typically fragile and breaks easily.
    //
    // - Or actually send the request and see what the redirect target is.
    //   An obvious downside is that it involves a network request to Google.
    //
    //   To get the results synchronously, sync XHR would be needed, but that
    //   automatically follows redirects, and HEAD /goto does not respond with
    //   the actual URL (200 instead of 302). Besides, sync XHR freezes the
    //   page until a response would be received. So sync XHR is infeasible.
    //
    //   fetch() with manual redirect control can be used, but that does not
    //   support a synchronous mode, so it either requires eagerly resolving
    //   URLs, or some disruptive interruption of the user's interaction.

    // W_jd is the backing store for some mapper  in Google's code. The page
    // initializes it to a plain object mapping random keys to arrays; later on
    // the W_jd global is wrapped by a Proxy with a custom setter trap.
    var W_jd = window.W_jd;
    if (typeof W_jd != 'object' || W_jd === null) {
        // Does not exist. Perhaps renamed?
        return;
    }
    function isRealUrlImpl(val) {
        if (typeof val != 'string' || !val.startsWith('http')) {
            return false;
        }
        let { protocol, hostname, pathname } = new URL(val); // May throw.
        if (protocol !== 'https:' && protocol !== 'http:') {
            return false;
        }
        if (hostname === location.hostname || hostname === 'www.google.com') {
            // When the target is Google, there is a non-zero chance of the
            // identified URL to be incorrect.
            return (
                // /goto to /goto is unlikely to be interesting.
                pathname !== '/goto' &&
                // Googling Google, or some base URL / origin.
                pathname !== '/' &&
                // Search back to search, likely not interesting.
                pathname !== '/search'
            );
        }
        // TODO: Maybe hostname.endsWith('gstatic.com')?
        // e.g. encrypted-tbn0.gstatic.com

        // Assume real URL unless given a reason otherwise.
        return true;
    }
    function isRealUrl(val) {
        try {
            return isRealUrlImpl(val);
        } catch (e) {
            // Parsing URL can fail. Can also fail if page tampers.
            return false;
        }
    }
    var urlFound;
    function doFindUrl(arr) {
        // Search result (SERP): Array(33)
        // arr[17] = goto
        // arr[32][2][6] = goto
        // arr[32][3][0] = real
        // arr[32][7][0] = goto
        //
        // Image result at SERP: Array(33)
        // arr[17] = goto
        // arr[32][2][5][1] = real (between image size/URL)
        // arr[32][2][6] = goto
        // arr[32][7][0] = goto
        //
        // News result at SERP: Array(33) --- no real URL
        // arr[17] = goto
        // arr[32][2][6] = goto
        // arr[32][7][0] = goto
        //
        // Short video at SERP: Array(33)
        // arr[17] = goto
        // arr[32][2][6] = goto
        // arr[32][7][0] = goto
        // arr[32][11][7] = real
        //
        // "Latest posts" (socials) at SERP: Array(33) --- no real URL
        // arr[17] = goto
        // arr[32][2][6] = goto
        // arr[32][7][0] = goto
        //
        // Image result (1/2): Array(10) --- no goto URL
        // arr[1] = data-docid
        // arr[9].2003[2] = real
        // Image result (2/2): Array(15) --- no goto URL
        // arr[1].Cr = Array(10), also separately in map, see above.
        // arr[1][1] = data-docid
        // arr[1].Cr[9].2003[2] = real
        // arr[7] = data-docid
        // Image result <a> element:
        // - a < div < div < div[data-docid][data-lpage]
        // - data-docid cross-references with W_jd data.
        // - data-lpage contains the actual URL as well, without needing W_jd.
        // (this special case is handled below, outside this function)
        //
        // News result: Not in W_jd
        //
        // Video result: Same as Short video at SERP
        // Short video result: Same as Short video at SERP
        if (arr[17] === gotoUrl) {
            // SERP
            let real = arr[32]?.[3]?.[0];
            if (isRealUrl(real)) {
                urlFound = real;
                return;
            }
            // Image result at SERP
            real = arr[32]?.[2]?.[5]?.[1];
            if (isRealUrl(real)) {
                urlFound = real;
                return;
            }
            // Short video at SERP, videos, short videos
            real = arr[32]?.[11]?.[7];
            if (isRealUrl(real)) {
                urlFound = real;
                return;
            }
        }
    }
    function tryFindUrl(arr) {
        try {
            doFindUrl(arr);
        } catch (e) {
            // console.error("[DTMG] tryFindUrl failed:", e);
        }
        return !!urlFound;
    }
    for (let v of Object.values(W_jd)) {
        if (!Array.isArray(v)) {
            continue;
        }
        if (tryFindUrl(v)) {
            return urlFound;
        }
        // Past initialization, the value is no longer available as a raw
        // value, but stored as some class member, which itself is stored
        // as the value of a Symbol on an empty array.
        // 2026-08-29 example: actual array is stored in: [][Symbol()].Cr
        // 2026-08-30 example: actual array is stored in: [][Symbol()].Ar
        for (let sym of Object.getOwnPropertySymbols(v)) {
            let v2 = v[sym];
            if (typeof v2 != 'object' || v2 === null || Array.isArray(v2)) {
                continue;
            }
            // The property name is randomized, so we cannot rely on the name.
            // Instead, we enumerate property values instead.
            for (let v3 of Object.values(v2)) {
                if (Array.isArray(v3) && tryFindUrl(v3)) {
                    return urlFound;
                }
            }
        }
    }
    if (a.tagName === 'A' || a.tagName === 'a') {
        let real = a.closest('[data-lpage]')?.dataset.lpage;
        if (isRealUrl(real)) {
            return real;
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

        document.addEventListener('dtmg_sync_fixup_goto_url', function(event) {
            const a = event.target;
            if (a.tagName === 'A' || a.tagName === 'a') {
                // Trigger above setter, which calls getRealLinkFromGoogleUrl
                // that ultimately calls resolveGoogleGotoUrl for /goto URLs.
                a.href += '';
            }
        });
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
            /^(?:(?:https?:\/\/[^/]+)?\/)?gen_204(?:[?#]|$)/);

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
        s.onload = s.onerror = function(e) {
            s.onload = s.onerror = null;
            if (e.type === 'error') {
                // Forgotten to delete MV2 code after MV3 migration?
                // Could also happen during development in Firefox, because
                // manifest.json defaults to manifest_version 3, and
                // tools/make-firefox-manifest.js sets MV3 to MV2.
                // Note: this execution could be blocked by the page's CSP.
                var s2 = document.createElement('script');
                s2.textContent = '(' + dtmg_main_closure + ')()';
                s.replaceWith(s2);
                console.warn('[DTMG] Falling back to inline script injection');
            }
            shadowHost.remove();
        };
        (document.body || document.documentElement).append(shadowHost);
        return true;
    }
})();
