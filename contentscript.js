document.addEventListener('mousedown', function(e) {
    var a = e.target;
    while (a && !a.href) {
        a = a.parentElement;
    }
    var inlineMousedown = a && a.getAttribute('onmousedown');
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
}, true);
