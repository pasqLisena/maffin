var express = require('express'),
    fs = require('fs'),
    mfParser = require('mediafragment'),
    Fragment = require('../controller/fragment'),
    config = require('../config.json');


var router = express.Router();
var videoPath = config.app_path.input_dir;

var DEBUG = config.debug;
mfParser.setVerbose(DEBUG);

router.get('/:filename', function (req, res, next) {
    var filename = req.params.filename;
    var path = videoPath + filename;
    if (!fs.existsSync(path)) {
        res.send(404);
        return;
    }

    if (DEBUG)
        console.log('Request: ' + req.url);

    var mfquery = mfParser.parse(req.url).query;
    if (Object.getOwnPropertyNames(mfquery).length == 0) {// is mf query empty?
        serveVideo(path, req, res);
        return;
    }

    try {
        var fragment = new Fragment(filename, mfquery);
        fragment.generate(function (err, output_path) {
            if (err) {
                console.error("Something went wrong. Original video will be served");
                //serve original video
                serveVideo(path, req, res);
                return;
            }
            serveVideo(output_path, req, res);
        });
    } catch (e) {
        console.error(e);
        console.log("Original video will be served");
        serveVideo(path, req, res);
    }
});

function serveVideo(path, req, res) {
//    res.contentType('mp4').sendfile(path);

    var stat = fs.statSync(path);
    var totalBytes = stat.size;

    var headers = {
        'Content-Length': totalBytes,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes, t'
    };

    if (req.headers['range']) {
        var range = req.headers.range;
        if (range.indexOf('bytes') != -1) {
            var parts = range.replace(/bytes=/, "").split("-");
            var partialstart = parts[0];
            var partialend = parts[1];

            var start = parseInt(partialstart, 10);
            var end = partialend ? parseInt(partialend, 10) : totalBytes - 1;
            var chunksize = (end - start) + 1;
            console.log('RANGE: ' + start + ' - ' + end + ' = ' + chunksize);

            var file = fs.createReadStream(path, {start: start, end: end});

            headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + totalBytes;
            headers['Content-Length'] = chunksize;
        } else {
//TODO
        }

        res.writeHead(206, headers);
        file.pipe(res);
    } else {
        console.log('ALL: ' + totalBytes);
        res.writeHead(200, headers);
        fs.createReadStream(path).pipe(res);
    }
}


router.get('/', function (req, res) {
    res.send('respond with a resource');
});

module.exports = router;