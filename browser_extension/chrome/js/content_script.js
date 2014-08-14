/**
 * @author pasq.lisena@gmail.com
 */
chrome.runtime.onInstalled.addListener(function () {
//    console.log('content HELLO!');
});

chrome.webRequest.onBeforeSendHeaders.addListener(
    function (details) {
        console.log(details);
        if (details.method != "GET")return;

        var url = MediaFragments.parse(details.url);
        var t = url.hash.t;
        if (t) {
            chrome.pageAction.show(details.tabId);

            t = t[0];

            var rangeValue = "t:npt=" + t.start + '-' + t.end;
            var rangeHeader;
            details.requestHeaders.forEach(function (header) {
                if (header.name == "Range") {
                    rangeHeader = header;
                }
            });
            if (!rangeHeader) {
                rangeHeader = {name: "Range"};
                details.requestHeaders.push(rangeHeader);
            }
            rangeHeader.value = rangeValue;

//            var xhr = new XMLHttpRequest();
//            details.requestHeaders.forEach(function (header) {
//                xhr.setRequestHeader(header.name, header.value)
//            });
//            console.log(xhr);
//
//            xhr.open("GET", details.url, true);
//            xhr.onreadystatechange = function () {
//                if (xhr.readyState == 4) {
//                    console.log("Gone");
//                    console.log(xhr.getAllResponseHeaders().toString());
//                }
//            };
//            xhr.send();
            return {requestHeaders: details.requestHeaders};
        }
    },
    {urls: [
        "*://*/*.aac",
        "*://*/*.mp4",
        "*://*/*.m4a",
        "*://*/*.m4v",
        "*://*/*.mp1",
        "*://*/*.mp2",
        "*://*/*.mp3",
        "*://*/*.mpg",
        "*://*/*.mpeg",
        "*://*/*.oga",
        "*://*/*.ogv",
        "*://*/*.ogg",
        "*://*/*.wav",
        "*://*/*.webm"
    ]}, ["blocking", "requestHeaders"]
);
