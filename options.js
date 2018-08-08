var storageArea = chrome.storage.sync || chrome.storage.local;
var noreferrerCheckbox = document.getElementById('noreferrer');
var newtabCheckbox = document.getElementById('newtab');

newtabCheckbox.onchange = function() {
    storageArea.set({
        openInNewTab: newtabCheckbox.checked,
    });
};

noreferrerCheckbox.onchange = function() {
    storageArea.remove('referrerPolicy');
    storageArea.set({
        forceNoReferrer: noreferrerCheckbox.checked,
    });
};

storageArea.get({
    openInNewTab: false,
    referrerPolicy: 'no-referrer',
    forceNoReferrer: true,
}, function(items) {
    if (items.referrerPolicy === '') {
        items.forceNoReferrer = false;
    }

    newtabCheckbox.checked = items.openInNewTab;
    noreferrerCheckbox.checked = items.forceNoReferrer;
});
