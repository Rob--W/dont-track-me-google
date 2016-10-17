var storageArea = chrome.storage.sync || chrome.storage.local;
var noreferrerCheckbox = document.getElementById('noreferrer');
noreferrerCheckbox.onchange = function() {
    storageArea.remove('referrerPolicy');
    storageArea.set({
        forceNoReferrer: noreferrerCheckbox.checked,
    });
};
storageArea.get({
    forceNoReferrer: true,
    referrerPolicy: 'no-referrer',
}, function(items) {
    if (items.referrerPolicy === '') {
        items.forceNoReferrer = false;
    }
    noreferrerCheckbox.checked = items.forceNoReferrer;
});
