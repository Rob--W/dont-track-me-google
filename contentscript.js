document.addEventListener('mousedown', handlePointerPress, true);
document.addEventListener('touchstart', handlePointerPress, true);
document.addEventListener('click', handleClick, true);
setupAggresiveUglyLinkPreventer();

var forceNoReferrer = true;
if (typeof chrome == 'object' && chrome.storage) {
    (chrome.storage.sync || chrome.storage.local).get({
        forceNoReferrer: true,
        // From version 4.7 until 4.11, the preference was the literal value of
        // the referrer policy.
        referrerPolicy: 'no-referrer',
    }, function(items) {
        if (items) {
            // Migration code (to be removed in the future).
            if (items.referrerPolicy === '') {
                // User explicitly allowed referrers to be sent, respect that.
                items.forceNoReferrer = false;
            }
            forceNoReferrer = items.forceNoReferrer;
        }
    });
    chrome.storage.onChanged.addListener(function(changes) {
        if (changes.forceNoReferrer) {
            forceNoReferrer = changes.forceNoReferrer.newValue;
        }
    });
}

function getReferrerPolicy() {
    return forceNoReferrer ? 'origin' : '';
}

function handlePointerPress(e) {
    var a = e.target;
    while (a && !a.href) {
        a = a.parentElement;
    }
    if (!a) {
        return;
    }
    var inlineMousedown = a.getAttribute('onmousedown');
    // return rwt(....); // E.g Google search results.
    // return google.rwt(...); // E.g. sponsored search results
    // return google.arwt(this); // E.g. sponsored search results (dec 2016).
    if (inlineMousedown && /\ba?rwt\(/.test(inlineMousedown)) {
        a.removeAttribute('onmousedown');
        // Just in case:
        a.removeAttribute('ping');
    }
    var realLink = getRealLinkFromGoogleUrl(a);
    if (realLink) {
        a.href = realLink;
    }
    a.referrerPolicy = getReferrerPolicy();
}

// This is specifically designed for catching clicks in Gmail.
// Gmail binds a click handler to a <div> and cancels the event after opening
// a window with an ugly URL. It uses a blank window + meta refresh in Firefox,
// which is too crazy to patch. So we just make sure that the browser's default
// click handler is activated (=open link in new tab).
// The entry point for this crazy stuff is shown in my comment at
// https://github.com/Rob--W/dont-track-me-google/issues/2
function handleClick(e) {
    if (e.button !== 0) {
        return;
    }
    var a = e.target;
    while (a && !a.href) {
        a = a.parentElement;
    }
    if (!a) {
        return;
    }
    if (a.origin === location.origin && (
        // Same URL except for query string and/or reference fragment.
        // E.g. an in-page navigation at Google Docs (#...)
        // or an attachment at Gmail (?ui=2&...)
        a.pathname === location.pathname ||
        // When the "Open each selected result in a new browser window" option
        // is selected, then target="_blank" is added, even though the link
        // should be opened in the same page. So do not block the propagation
        // of clicks. https://github.com/Rob--W/dont-track-me-google/issues/6
        a.pathname === '/imgres' && /[?&]imgurl=/.test(a.search) ||
        a.pathname === '/search' && /[?&]q=/.test(a.search)
    )) {
        return;
    }
    if (a.protocol !== 'http:' &&
        a.protocol !== 'https:' &&
        a.protocol !== 'ftp:') {
        // Be conservative and don't block too much. E.g. Gmail has special
        // handling for mailto:-URLs, and using stopPropagation now would
        // cause mailto:-links to be opened by the platform's default mailto
        // handler instead of Gmail's handler (=open in new window).
        return;
    }
    if (a.target === '_blank') {
        e.stopPropagation();
        a.referrerPolicy = getReferrerPolicy();
    }
}

/**
 * @returns {String} the real URL if the given link is a Google redirect URL.
 */
function getRealLinkFromGoogleUrl(a) {
    if ((a.hostname === location.hostname || a.hostname === 'www.google.com') &&
        /^\/(local_)?url$/.test(a.pathname)) {
        // Google Maps / Dito (/local_url?q=<url>)
        // Mobile (/url?q=<url>)
        var url = /[?&](?:q|url)=((?:https?|ftp)[%:][^&]+)/.exec(a.search);
        if (url) {
            return decodeURIComponent(url[1]);
        }
        // Help pages, e.g. safe browsing (/url?...&q=%2Fsupport%2Fanswer...)
        url = /[?&](?:q|url)=((?:%2[Ff]|\/)[^&]+)/.exec(a.search);
        if (url) {
            return a.origin + decodeURIComponent(url[1]);
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
        var setAttribute = Function.prototype.call.bind(proto.setAttribute);
        proto.setAttribute = function(name, value) {
            // Attribute names are not case-sensitive, but weird capitalizations
            // are unlikely, so only check all-lowercase and all-uppercase.
            if (name === 'href' || name === 'HREF') {
                this.href = value;
            } else {
                setAttribute(this, name, value);
            }
        };

        var aDispatchEvent = Function.prototype.apply.bind(proto.dispatchEvent);
        proto.dispatchEvent = function() {
            updateReferrerPolicy(this);
            return aDispatchEvent(this, arguments);
        };

        var aClick = Function.prototype.apply.bind(proto.click);
        proto.click = function() {
            updateReferrerPolicy(this);
            return aClick(this, arguments);
        };

        var CustomEvent = window.CustomEvent;
        var currentScript = document.currentScript;
        var dispatchEvent = currentScript.dispatchEvent.bind(currentScript);
        var getScriptAttribute = currentScript.getAttribute.bind(currentScript);

        function updateReferrerPolicy(a) {
            try {
                dispatchEvent(new CustomEvent('dtmg-get-referrer-policy'));
                var referrerPolicy = getScriptAttribute('referrerPolicy');
                if (typeof referrerPolicy === 'string' && referrerPolicy) {
                    setAttribute(a, 'referrerPolicy', referrerPolicy);
                }
            } catch (e) {
                // Not expected to happen, but don't break callers if it happens
                // anyway.
            }
        }
    } + ')(' + getRealLinkFromGoogleUrl + ');';
    s.addEventListener('dtmg-get-referrer-policy', function(event) {
        s.setAttribute('referrerPolicy', getReferrerPolicy());
    });
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}
