var express = require('express'),
    path = require('path'),
    fs = require('fs'),
    async = require('async'),
    mfParser = require('mediafragment'),
    Fragment = require('../controller/fragment'),
    config = require('../config.json'),
    Grid = require('gridfs-stream'),
    mongo = require('mongodb');

var db = mongo.Db('maffin', new mongo.Server(config.app_options.mongo_host, config.app_options.mongo_port, {}), {safe: true});
var gfs;

db.open(function (err) {
    if (err)return handleError(err);
    gfs = Grid(db, mongo);
});

var router = express.Router();
var videoDir = config.app_options.input_dir;

var DEBUG = config.debug;
mfParser.setVerbose(DEBUG);


router.get('/show/:filename', function (req, res, next) {
    var filename = req.params.filename;
    var queryString = req._parsedUrl.search || '';
    res.render("video", {src: filename + '.mp4' + queryString});
});

router.get('/:filename', function (req, res, next) {
    var filename = req.params.filename;
    var inputVideoPath = path.join(videoDir, filename);
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
                console.error("Something went wrong.\nOriginal video will be served");
                serveVideo(inputVideoPath, req, res);
                return;
            }
            serveVideo(fragment, req, res);
        });
    } catch (e) {
        console.log("Original video will be served");
        serveVideo(inputVideoPath, req, res);
    }
});

function serveVideo(video, req, res, options) {
    options = options || {};
    var isAFragment = video instanceof Fragment;

    var totalBytes, mime, filename;
    if (isAFragment) {
        totalBytes = video.dbFile.length;
        mime = 'video/' + video.inputFormat.name;
        // TODO filename
    } else {
        var stat = fs.statSync(video);
        totalBytes = stat.size;
        mime = 'video/' + video.substr(video.lastIndexOf('.') + 1);
        filename = video.substr(video.lastIndexOf('\\') + 1);
    }
    console.log('filename ' + filename);

    var headers = {
        'Content-Length': totalBytes,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes, t'
    };

    var outStream, httpCode;
    if (!options.ignoreRange && req.headers['range']) {
        var range = req.headers.range;
        httpCode = 206;
        var parts, partialstart , partialend;
        if (range.indexOf('bytes') != -1) {
            parts = range.replace(/bytes=/, "").split("-");
            partialstart = parts[0];
            partialend = parts[1];

            var start = parseInt(partialstart, 10);
            var end = partialend ? parseInt(partialend, 10) : totalBytes - 1;
            var chunksize = (end - start) + 1;

            if (DEBUG)
                console.log('RANGE: bytes ' + start + ' - ' + end + ' = ' + chunksize);

            outStream = isAFragment ? gfs.createReadStream({'_id': video.dbFile._id, range: {startPos: start, endPos: end}}) : fs.createReadStream(video, {start: start, end: end});

            headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + totalBytes;
            headers['Content-Length'] = chunksize;
        } else {
            parts = range.split(";");
            var partials = parts[0].replace(/t:npt=/, "").split("-");
            partialstart = partials[0];
            partialend = partials[1];
            console.log(parts[1]);
            var includeSetup = parts[1] == "include-setup";

            if (DEBUG)
                console.log('RANGE: t ' + partialstart + ' - ' + partialend);

            var hashFragJSON = mfParser.parse('#t=npt:' + partialstart + ',' + partialend).hash;

            if (!hashFragJSON.t) serveVideo(video, req, res, {ignoreRange: true});
            var hashFrag = new Fragment(filename, hashFragJSON);
            hashFrag.checkSource(function () {
                var startByte, endByte, startNPT, endNPT, mdEnd = 0;

//            hashFrag.generate(function (err, outputFragment) {
//                if (err) {
//                    console.error(err);
//                    console.error("Something went wrong. Original video will be served");
//                    //serve original video
//                    serveVideo(video, req, res, {ignoreRange: true});
//                    return;
//                }
//                serveVideo(hashFrag, req, res, {ignoreRange: true});
//            });

                async.parallel([
                    function (asyncCallback) { // metadata
                        if (!includeSetup) {
                            asyncCallback();
                            return;
                        }
                        hashFrag.checkClosestIframe(0, function (err, frame) {
                            if (frame) {
                                mdEnd = parseInt(frame.pkt_pos) - 1;

                            }
                            asyncCallback(err);
                        });
                    },
                    function (asyncCallback) { //start frame
                        hashFrag.checkClosestIframe(hashFrag.ssStart, function (err, frame) {
                            if (frame) {
                                startByte = parseInt(frame.pkt_pos);
                                startNPT = frame.best_effort_timestamp_time;
                            }
                            asyncCallback(err);
                        });
                    }, function (asyncCallback) { //end frame
                        if (!hashFrag.ssEnd) {
                            endByte = totalBytes;
                            endNPT = 'end';
                            asyncCallback();
                            return;
                        }
                        hashFrag.checkClosestIframe(hashFrag.ssEnd, function (err, frame) {
                            if (frame) {
                                endByte = parseInt(frame.pkt_pos) + parseInt(frame.pkt_size);
                                endNPT = frame.best_effort_timestamp_time;
                            }
                            asyncCallback(err);
                        });
                    }
                ], function (err) {
                    if (err) {
                        console.error(err);
                        console.error("Something went wrong.\nThe Range request will be ingored");
                        serveVideo(video, req, res, true);
                        return;
                    }

                    if (typeof endByte != 'number') {
                        endNPT = hashFrag.totalDuration;
                        endByte = totalBytes;
                    }

                    var readFile = function (callback) {
                        if (isAFragment) {
                            //FIXME gridfs
                        } else {
                            fs.readFile(video, 'binary', callback);
                        }
                    };

                    readFile(function (err, file) {
                        if (err) {
                            console.error(err);
                            console.error("Something went wrong.\nThe Range request will be ingored");
                            serveVideo(video, req, res, true);
                            return;
                        }

                        if (includeSetup)
                            headers['Content-Type'] = 'multipart/byteranges;boundary=End';
                        headers['Content-Range'] = 'bytes ' + startByte + '-' + endByte + '/' + totalBytes;
                        headers['Content-Length'] = chunksize;
                        headers['Content-Range-Mapping'] = '{ t:npt ' + parseFloat(startNPT).toFixed(1) + '-' + parseFloat(endNPT).toFixed(1)
                            + (includeSetup ? ';include-setup' : '') + ' } = { bytes '
                            + (includeSetup ? '0-' + mdEnd + ',' : '') + startByte + '-' + endByte + '/' + totalBytes + ' }';

                        if (DEBUG)
                            console.log('Content-Range-Mapping: ' + headers['Content-Range-Mapping']);

                        var mdStream, block1, block2;
                        outStream = new Buffer(file.slice(startByte, endByte));

                        if (includeSetup) {
//                            mdStream = isAFragment ? gfs.createReadStream({'_id': video.dbFile._id, range: {startPos: 0, endPos: mdEnd}}) : fs.createReadStream(video, {start: 0, end: mdEnd});

                            mdStream = new Buffer(file.slice(0, mdEnd));

                            var s1 = '\n--End\n' +
                                'Content-Type: ' + mime + '\n' +
                                'Content-Range: bytes 0-' + mdEnd + '\n';
                            var s2 = '\n--End\n' +
                                'Content-Type: ' + mime + '\n' +
                                'Content-Range: bytes ' + startByte + '-' + endByte + '\n';
                            block1 = new Buffer(s1, 'ascii');
                            block2 = new Buffer(s2, 'ascii');
                            headers['Content-Length'] = mdStream.length + outStream.length + block1.length + block2.length - 1;
                        }
//                        outStream = isAFragment ? gfs.createReadStream({'_id': video.dbFile._id, range: {startPos: startByte, endPos: endByte}}) : fs.createReadStream(video, {start: startByte, end: endByte});

                        res.writeHead(httpCode, headers);
                        if (!includeSetup) {
                            outStream.pipe(res);
                        } else {
                            res.write(block1);
                            res.write(mdStream);
                            res.write('0'); // ask to Yunlia
                            res.write(block2);
                            res.write(outStream);
                            res.end();
//                        mdStream.pipe(res, { end: false });
//                            mdStream.on('data', function (chunk) {
//
//                                console.log('got %d bytes of metadata', chunk.length);
////                            mdL += chunk.length;
//                                res.write(chunk, 'binary');
//                            });
//                            mdStream.on('end', function () {
//                                console.log('end mdstream');
//                                res.write(block2);
//
////                                outStream = isAFragment ? gfs.createReadStream({'_id': video.dbFile._id, range: {startPos: startByte, endPos: endByte}}) : fs.createReadStream(video, {start: startByte, end: endByte});
//                                outStream = new Buffer(video.slice(startByte, endByte));
//                                outStream.on('data', function (chunk) {
//                                    console.log('got %d bytes of data', chunk.length);
////                                outL += chunk.length;
//                                    res.write(chunk, 'binary');
////                                if (ready === false) {
////                                    this.pause();
////                                    res.once('drain', this.resume.bind(this))
////                                }
//                                });
////                            outStream.pipe(res, { end: false });
//                                outStream.on('end', function () {
//                                    console.log(totalBytes + ' ' + endByte)
////                              outStream.unpipe();
//                                    console.log('ENDING');
////                                res.write(new Buffer("ENDING", 'binary'));
//                                    res.end();
//                                });
//                            });

                        }
                    });

                });
            });
            return;
        }
    }
    else {
        if (DEBUG)
            console.log('ALL: ' + totalBytes);
        httpCode = 200;
        outStream = isAFragment ? gfs.createReadStream({'_id': video.dbFile._id}) : fs.createReadStream(video);
    }
    res.writeHead(httpCode, headers);
    outStream.pipe(res);
}

router.get('/', function (req, res) {
    res.send('respond with a resource');
});

module.exports = router;