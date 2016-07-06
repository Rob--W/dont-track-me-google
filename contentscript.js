document.addEventListener('mousedown', handlePointerPress, true);
document.addEventListener('touchstart', handlePointerPress, true);

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
    if (a.hostname === location.hostname &&
        /^\/(local_)?url$/.test(a.pathname)) {
        // Google Maps / Dito (/local_url?q=<url>)
        // Mobile (/url?q=<url>)
        var url = /[?&](?:q|url)=(http[^&]+)/.exec(a.search);
        if (url) {
            a.href = decodeURIComponent(url[1]);
        }
    }
}
