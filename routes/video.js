var express = require('express'),
    path = require('path'),
    fs = require('fs'),
    mfParser = require('mediafragment'),
    Fragment = require('../controller/fragment'),
    config = require('../config.json'),
    Grid = require('gridfs-stream'),
    mongo = require('mongodb');

var db = mongo.Db('maffin', new mongo.Server(config.app_path.mongo_host, config.app_path.mongo_port, {}), {safe: true});
var gfs;

db.open(function (err) {
    if (err)return handleError(err);
    gfs = Grid(db, mongo);
});

var router = express.Router();
var videoDir = config.app_path.input_dir;

var DEBUG = config.debug;
mfParser.setVerbose(DEBUG);

router.get('/:filename', function (req, res, next) {
    var filename = req.params.filename;
    var inputVideoPath = path.join(videoDir,filename);
    if (!fs.existsSync(inputVideoPath)) {
        res.send(404);
        return;
    }

    if (DEBUG)
        console.log('Request: ' + req.url);

    var mfquery = mfParser.parse(req.url).query;
    if (Object.getOwnPropertyNames(mfquery).length == 0) {// is mf query empty?
        serveVideo(inputVideoPath, req, res);
        return;
    }

    try {
        var fragment = new Fragment(filename, mfquery);
        fragment.generate(function (err, outputFragment) {
            if (err) {
                console.error(err);
                console.error("Something went wrong. Original video will be served");
                //serve original video
                serveVideo(inputVideoPath, req, res);
                return;
            }
            serveVideo(outputFragment, req, res);
        });
    } catch (e) {
        console.log("Original video will be served");
        serveVideo(inputVideoPath, req, res);
    }
});

function serveVideo(file, req, res) {
    var gfsSource = file._id;

    var totalBytes;
    if (gfsSource) {
        totalBytes = file.length;
    } else {
        var stat = fs.statSync(file);
        totalBytes = stat.size;
    }

    var headers = {
        'Content-Length': totalBytes,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes, t'
    };

    var outStream, httpCode;
    if (req.headers['range']) {
        var range = req.headers.range;
        httpCode = 206;
        if (range.indexOf('bytes') != -1) {
            var parts = range.replace(/bytes=/, "").split("-");
            var partialstart = parts[0];
            var partialend = parts[1];

            var start = parseInt(partialstart, 10);
            var end = partialend ? parseInt(partialend, 10) : totalBytes - 1;
            var chunksize = (end - start) + 1;

            if (DEBUG)
                console.log('RANGE: ' + start + ' - ' + end + ' = ' + chunksize);

            outStream = gfsSource ? gfs.createReadStream({'_id': file._id, range: {startPos: start, endPos: end}}) : fs.createReadStream(file, {start: start, end: end});

            headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + totalBytes;
            headers['Content-Length'] = chunksize;
        } else {
            //TODO t
        }
    } else {
        if (DEBUG)
            console.log('ALL: ' + totalBytes);
        httpCode = 200;
        outStream = gfsSource ? gfs.createReadStream({'_id': file._id}) : fs.createReadStream(file);
    }
    res.writeHead(httpCode, headers);
    outStream.pipe(res);
}

router.get('/', function (req, res) {
    res.send('respond with a resource');
});

module.exports = router;