var storageArea = chrome.storage.sync || chrome.storage.local;
var noreferrerCheckbox = document.getElementById('noreferrer');
var nopingCheckbox = document.getElementById('noping');
var noGotoFixupViaNetworkCheckbox = document.getElementById('noGotoFixupViaNetwork');
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
noGotoFixupViaNetworkCheckbox.onchange = function() {
    storageArea.set({
        noGotoFixupViaNetwork: noGotoFixupViaNetworkCheckbox.checked,
    });
};
storageArea.get({
    forceNoReferrer: true,
    referrerPolicy: 'no-referrer',
    noping: true,
    noGotoFixupViaNetwork: false,
}, function(items) {
    if (items.referrerPolicy === '') {
        items.forceNoReferrer = false;
    }
    noreferrerCheckbox.checked = items.forceNoReferrer;
    nopingCheckbox.checked = items.noping;
    noGotoFixupViaNetworkCheckbox.checked = items.noGotoFixupViaNetwork;
});
