var storageArea = chrome.storage.sync || chrome.storage.local;
var noreferrerCheckbox = document.getElementById('noreferrer');
noreferrerCheckbox.onchange = function() {
    storageArea.set({
        referrerPolicy: noreferrerCheckbox.checked ? 'no-referrer' : '',
    });
};
storageArea.get({
    referrerPolicy: 'no-referrer',
}, function(items) {
    noreferrerCheckbox.checked = items.referrerPolicy === 'no-referrer';
});
