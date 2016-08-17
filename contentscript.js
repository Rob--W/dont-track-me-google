document.addEventListener('mousedown', handlePointerPress, true);
document.addEventListener('touchstart', handlePointerPress, true);
setupAggresiveUglyLinkPreventer();

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
    if (inlineMousedown && /\brwt\(/.test(inlineMousedown)) {
        a.removeAttribute('onmousedown');
        // Just in case:
        a.removeAttribute('ping');
        // A previous version (3.6) also tried to mask the referrer header, but
        // thanks to Google's <meta content="origin" name="referrer">, that is
        // not needed. It's not a problem to expose the Google origin to link
        // targets, since that is not private-sensitive information.
    }
    var realLink = getRealLinkFromGoogleUrl(a);
    if (realLink) {
        a.href = realLink;
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
    } + ')(' + getRealLinkFromGoogleUrl + ');';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}
