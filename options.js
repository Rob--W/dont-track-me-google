var storageArea = chrome.storage.sync || chrome.storage.local;
var noreferrerCheckbox = document.getElementById('noreferrer');
var nopingCheckbox = document.getElementById('noping');
noreferrerCheckbox.onchange = function() {
    storageArea.remove('referrerPolicy');
    storageArea.set({
        forceNoReferrer: noreferrerCheckbox.checked,
    });
};
nopingCheckbox.onchange = function() {
    storageArea.set({
        noping: nopingCheckbox.checked,
    });
};
storageArea.get({
    forceNoReferrer: true,
    referrerPolicy: 'no-referrer',
    noping: true,
}, function(items) {
    if (items.referrerPolicy === '') {
        items.forceNoReferrer = false;
    }
    noreferrerCheckbox.checked = items.forceNoReferrer;
    nopingCheckbox.checked = items.noping;
});
