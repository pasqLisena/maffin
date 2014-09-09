/**
 * @author pasquale.lisena@eurecom.fr
 */
const multipartRegex = new RegExp("^multipart\/byteranges;boundary=(.+)$");
const contentRangeRegex = new RegExp("^Content-Range: bytes ([0-9]+)-([0-9]+)");

var tRequests = {};

chrome.runtime.onInstalled.addListener(function () {
//    console.log('content HELLO!');
});

chrome.webRequest.onBeforeSendHeaders.addListener(
    function (details) {
        console.debug(details);
        if (details.tabId < 0 || details.method != "GET")return;

        var url = MediaFragments.parse(details.url);
        var t = url.hash.t;
        if (t) {
            chrome.pageAction.show(details.tabId);

            t = t[0];

            var rangeValue = "t:npt=" + t.start + '-' + t.end + ';include-setup';
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

            var xhr = new XMLHttpRequest();
            xhr.open("GET", details.url, true);
            details.requestHeaders.forEach(function (header) {
                if (['User-Agent', 'Accept-Encoding', 'Referer'].indexOf(header.name) == -1)
                    xhr.setRequestHeader(header.name, header.value)
            });

            xhr.onreadystatechange = function () {
                if (xhr.readyState == 4) {

                    console.log("Gone");
                    var contentType = xhr.getResponseHeader("Content-Type");
                    var contentRange = xhr.getResponseHeader("Content-Range");

                    if (!contentType)throw new Error("No content type");
                    var boundary = contentType.match(multipartRegex);
                    if (boundary && boundary.length < 2)throw new Error("No explicit boundary");
                    boundary = boundary[1].trim();

                    var file = xhr.response;

                    console.log('file length' + file.length);
                    var view = new jDataView(file, 0);
                    readByteRow(view);
                    var end = readByteRow(view);
                    if (end && end.substr(2).trim() != boundary) throw new Error("A different boundary found");
                    console.log(end);

                    var contentType1 = readByteRow(view);
                    console.log(contentType1);
                    var contentRange1 = readByteRow(view);
                    console.log(contentRange1);
                    contentRange1 = contentRange1.trim().match(contentRangeRegex);
                    var cRange1Diff = contentRange1[2] - contentRange1[1];
                    console.log(cRange1Diff);
//                    view.skip(cRange1Diff + 1);
                    var mdStart = view.tell(), mdEnd;
                    var s = "";
                    while (s != null && s.trim().substr(2) != boundary) {
                        mdEnd = view.tell();
                        s = readByteRow(view);
                    }

                    var contentType2 = readByteRow(view);
                    console.log(contentType2);
                    var contentRange2 = readByteRow(view);
                    console.log(contentRange2);
                    contentRange2 = contentRange2.trim().match(contentRangeRegex);
                    var cRange2Diff = contentRange2[2] - contentRange2[1];
                    var dataStart = view.tell(), dataEnd = file.length;

                    console.log("Ideal parts:");
                    console.log("metadata: " + cRange1Diff + " bytes");
                    console.log("data: " + cRange2Diff + " bytes");
                    console.log("\n");

                    console.log("Actual parts:");
                    console.log("metadata: " + (mdEnd - mdStart) + " bytes");
                    console.log("data: " + (dataEnd - dataStart) + " bytes");

                    view.seek(0);
//                    var videoBin = new jDataView(file, mdStart, (mdEnd - mdStart));
//                    videoBin.seek(videoBin.byteLength);
//                    var bytes = view.getBytes((dataEnd - dataStart) - 1, dataStart);
//                    videoBin.writeBytes(bytes);
//                    console.log(videoBin)

                    var bytes1 = view.getBytes((mdEnd - mdStart) - 1, mdStart);
                    var bytes2 = view.getBytes((dataEnd - dataStart) - 1, dataStart);

                    var binaryLength = bytes1.length + bytes2.length;
                    var bin = new jBinary(binaryLength);
                    bin.write('blob', bytes1);
                    bin.write('blob', bytes2);

                    var blobUri = bin.toURI('video/mp4')
                    console.log(blobUri);
                    chrome.tabs.create({'url': blobUri});
                }
            };
            xhr.send();
//            return {requestHeaders: details.requestHeaders};
            return {cancel: true};
        }
    },
    {urls: [
//        "*://*/*.aac",
        "*://*/*.mp4",
//        "*://*/*.m4a",
//        "*://*/*.m4v",
//        "*://*/*.mp1",
//        "*://*/*.mp2",
//        "*://*/*.mp3",
//        "*://*/*.mpg",
//        "*://*/*.mpeg",
//        "*://*/*.oga",
        "*://*/*.ogv",
//        "*://*/*.ogg",
//        "*://*/*.wav",
        "*://*/*.webm"
    ]}, ["blocking", "requestHeaders"]
);


//chrome.webRequest.onResponseStarted.addListener(
//    function (details) {
//        var url = MediaFragments.parse(details.url);
//        var t = url.hash.t;
//        if (t) {
//            console.log("complete");
//            console.log(details);
//            chrome.tabs.executeScript(details.tabId, {file:"js/jquery-2.1.1.min.js"})
//            chrome.tabs.executeScript(details.tabId, {file:"js/videoFragView.js"})
//        }
//    }, {urls: ["<all_urls>"]}
//);


function readByteRow(view) {
    if (!view instanceof jDataView) throw new Exception("Internal Error");

    var s = "";
    try {
        var char = view.getString(1);
        while (char != "\n") {
            s += char;
            char = view.getString(1);
        }
        return s;
    } catch (e) {
        console.error(e);
        console.log(view.tell());
    }
}