// This script is the part of Don't Track Me Google (DTMG) that modifies
// objects in the page's context. It should run in the MAIN world.
// It may run in the ISOLATED world if the MAIN world is not supported.

// Keep the following functions in sync with contentscript.js:
// - getReferrerPolicy
// - getRealLinkFromGoogleUrl

// The main functions of this file are:
// - setupAggresiveUglyLinkPreventer
// - blockTrackingBeacons
// - overwriteWindowOpen
//
// TODO: refactor use of:
// - cleanLinksWhenJsIsDisabled
// - findScriptCspNonce
// - getScriptCspNonce
// - preferenceObservers

/* globals cleanLinksWhenJsIsDisabled, preferenceObservers */
/* globals forceNoReferrer, noping */

var scriptCspNonce;
var needsCspNonce = typeof browser !== 'undefined'; // Firefox.
setupAggresiveUglyLinkPreventer();

function callImmediatelyAndOnPreferenceUpdate(callback) {
    callback();
    preferenceObservers.push(callback);
}

function getReferrerPolicy() {
    return forceNoReferrer ? 'origin' : '';
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
    // This content script runs as document_start, so we can have some assurance
    // that the methods in the page are reliable.
    var s = document.createElement('script');
    if (getScriptCspNonce()) {
        s.setAttribute('nonce', scriptCspNonce);
    } else if (document.readyState !== 'complete' && needsCspNonce) {
        // In Firefox, a page's CSP is enforced for content scripts, so we need
        // to wait for the document to be loaded (we may be at document_start)
        // and find a fitting CSP nonce.
        findScriptCspNonce(setupAggresiveUglyLinkPreventer);
        return;
    }
    s.textContent = '(' + function(getRealLinkFromGoogleUrl) {
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

        var currentScript = document.currentScript;
        var getReferrerPolicy = Object.getOwnPropertyDescriptor(
            HTMLScriptElement.prototype,
            'referrerPolicy'
        ).get.bind(currentScript);

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
        currentScript.dataset.jsEnabled = 1;
    } + ')(' + getRealLinkFromGoogleUrl + ');';
    callImmediatelyAndOnPreferenceUpdate(function forceNoReferrerChanged() {
        // Send the desired referrerPolicy value to the injected script.
        s.referrerPolicy = getReferrerPolicy();
    });
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    if (!s.dataset.jsEnabled) {
        cleanLinksWhenJsIsDisabled();
        if (!needsCspNonce) {
            needsCspNonce = true;
            // This is not Firefox, but the script was blocked. Perhaps a CSP
            // nonce is needed anyway.
            findScriptCspNonce(function() {
                if (scriptCspNonce) {
                    setupAggresiveUglyLinkPreventer();
                }
            });
        }
    } else {
        // Scripts enabled (not blocked by CSP), run other inline scripts.
        blockTrackingBeacons();
        overwriteWindowOpen();

        if (location.hostname === 'docs.google.com') {
            // Google Docs have simple non-JS interfaces where the ugly links
            // are hard-coded in the HTML. Remove them (#51).
            // https://docs.google.com/document/d/.../mobilebasic
            // https://docs.google.com/spreadsheets/d/.../htmlview
            cleanLinksWhenJsIsDisabled();
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
    var s = document.createElement('script');
    if (getScriptCspNonce()) {
        s.setAttribute('nonce', scriptCspNonce);
    }
    s.textContent = '(' + function() {
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

        var currentScript = document.currentScript;
        var getElementId = Object.getOwnPropertyDescriptor(
            Element.prototype,
            'id'
        ).get.bind(currentScript);
        function isNoPingEnabled() {
            try {
                return getElementId() !== '_dtmg_do_not_touch_ping';
            } catch (e) {
                return true;
            }
        }
    } + ')();';
    callImmediatelyAndOnPreferenceUpdate(function nopingChanged() {
        // Send the noping value to the injected script. The "id" property is
        // mirrored and can have an arbitrary (string) value, so we use that:
        s.id = noping ? '' : '_dtmg_do_not_touch_ping';
    });
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}

// Google sometimes uses window.open() to open ugly links.
// https://github.com/Rob--W/dont-track-me-google/issues/18
// https://github.com/Rob--W/dont-track-me-google/issues/41
function overwriteWindowOpen() {
    var s = document.createElement('script');
    if (getScriptCspNonce()) {
        s.setAttribute('nonce', scriptCspNonce);
    }
    s.textContent = '(' + function() {
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
    } + ')();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}

function getScriptCspNonce() {
    var scripts = document.querySelectorAll('script[nonce]');
    for (var i = 0; i < scripts.length && !scriptCspNonce; ++i) {
        scriptCspNonce = scripts[i].nonce;
    }
    return scriptCspNonce;
}

function findScriptCspNonce(callback) {
    var timer;
    function checkDOM() {
        if (getScriptCspNonce() || document.readyState === 'complete') {
            document.removeEventListener('DOMContentLoaded', checkDOM, true);
            if (timer) {
                clearTimeout(timer);
            }
            callback();
            return;
        }
        timer = setTimeout(checkDOM, 50);
    }
    document.addEventListener('DOMContentLoaded', checkDOM, true);
    checkDOM();
}
