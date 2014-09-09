var ffmpeg = require('fluent-ffmpeg'),
    spawn = require('child_process').spawn,
    path = require('path'),
    fs = require('fs'),
    mongo = require('mongodb'),
    Grid = require('gridfs-stream'),
    config = require('../config.json');

var db = mongo.Db('maffin', new mongo.Server(config.app_options.mongo_host, config.app_options.mongo_port, {}), {safe: true});
var gfs, media;
db.open(function (err) {
    media = db.collection('media');
    if (err)
        throw err;
    gfs = Grid(db, mongo);

    var ttl_millis = config.app_options.frag_ttl * 1000;
    setInterval(function () {
        gfs.files.find({'metadata.lastRequest': {$lt: Date.now() - ttl_millis}}).toArray(function (err, data) {
            if (err) {
                console.err(err);
                return;
            }
            if (!data)return;

            for (var v in data) {
                if (!data.hasOwnProperty(v)) continue;
                var video = data[v];
                gfs.remove({_id: video._id}, function (err) {
                    if (err)console.log(err);
                });
                media.remove({alias: video._id}, function (err) {
                    if (err)console.log(err);
                })
            }
        });
    }, ttl_millis);
});

ffmpeg.setFfmpegPath(config.ffmpeg_path.ffmpeg);
ffmpeg.setFfprobePath(config.ffmpeg_path.ffprobe);

var supportedFormats = {
    'mp4': {
        'media': 'video',
        'ext': 'mp4',
        'name': 'mp4',
        'lib': {
            'v': 'libx264'
        }
    },
    'webm': {
        'media': 'video',
        'ext': 'webm',
        'name': 'webm',
        'lib': {
            'v': 'libvpx'
        }
    },
    'ogv': {
        'media': 'video',
        'ext': 'ogv',
        'name': 'ogv',
        'lib': {
            'v': 'libtheora'
        }
    }
};

var input_dir = config.app_options.input_dir,
    output_dir = config.app_options.output_dir,
    DEBUG = config.debug;

var availableTrack = ['video', 'audio'];
availableTrack.sort();

function addAlias(name, file, callback) {
    media.insert({
        frag: name,
        alias: file._id
    }, callback);
}

function findAliasInDb(key, callback) {
    media.find({frag: key}).limit(1).toArray(function (err, doc) {
        if (err) {
            callback(err);
            return;
        }
        if (doc && doc.length) {
            var alias = doc[0].alias;
            gfs.files.findAndModify({_id: alias}, [
                ['_id', 'asc']
            ], {$set: {'metadata.lastRequest': Date.now()}}, {}, function (err, file) {
                callback(err, file);
            });
        } else {
            callback();
        }

    });
}

function findFileInDb(key, callback) {
    gfs.exist({filename: key}, function (err, found) {
        if (err) {
            callback(err);
            return;
        }
        if (found) {
            gfs.files.findAndModify({filename: key}, [
                ['_id', 'asc']
            ], {$set: {'metadata.lastRequest': Date.now()}}, {}, function (err, file) {
                callback(err, file);
            });
        } else callback();
    });
}

var Fragment = function (inputFilename, mfJson) {
    if (!inputFilename || !mfJson)
        throw Error('Fragment: all fields are mandatory');

    var lastDot = inputFilename.lastIndexOf('.');
    this.inputFilename = inputFilename.substr(0, lastDot);
    this.inputFormat = supportedFormats[inputFilename.substr(lastDot + 1)];
    if (!this.inputFormat) throw Error('Format not supported');

    this.inputPath = path.join(input_dir, inputFilename);
    this.mfJson = mfJson;

    var t = mfJson.t && mfJson.t[0];
    if (t) {
        this.ssStart = (t && t.startNormalized) || 0;
        this.ssEnd = t && t.endNormalized;
    }
    var trackList = [];
    if (mfJson.track) {
        mfJson.track.forEach(function (tk) {
            trackList.push(tk.value);
        });
    }
    this.trackList = trackList;

    if (mfJson.xywh && (!this.trackList.length || this.trackList.indexOf('video') != -1)) {
        var xywh = mfJson.xywh[0];
        if (xywh.unit == 'percent' && xywh.x == 0 && xywh.y == 0 && xywh.w == 100 && xywh.h === 100) {
            xywh = null;
        }
        this.xywh = xywh;
    }
};

Fragment.prototype.getOutputFilename = function () {
    /*
     * It returns an appropriate output filename for fragment selected.
     * If there is a "false" fragment (i.e. "?t=0&track=audio&track=video"), it returns null
     */
    if (this.outputFilename && !this.hasFragChanged) return this.outputFilename;
    this.hasFragChanged = false;

    var fragPart = '';
    var start = typeof this.iStart != "undefined" ? this.iStart : this.ssStart;
    if (start || this.ssEnd)
        fragPart += '_' + start + (this.ssEnd ? '-' + this.ssEnd : '');
    if (this.trackList.length && !this.trackList.sort().join(',') != availableTrack.join(',')) { // if user select all tracks, is not a track-fragment
        this.trackList.forEach(function (tk) {
            fragPart += '_' + tk;
        });
    }
    if (this.xywh && this.xywh.unit == 'pixel')
        fragPart += '_' + this.xywh.x + '-' + this.xywh.y + '-' + this.xywh.w + '-' + this.xywh.h;
    else if (this.xywh && this.xywh.unit == 'percent')
        fragPart += '_PERCENT' + this.xywh.x + '-' + this.xywh.y + '-' + this.xywh.w + '-' + this.xywh.h;

    if (!fragPart) throw Error("False fragment!", "FalseFragmentError");

    this.outputFilename = this.inputFilename + fragPart + '.' + this.inputFormat.ext;
    return this.outputFilename;
};

Fragment.prototype.checkClosestIframe = function (time, callback) {
    /*
     *  Use ffmpeg to search closest I-frame (Intra-coded frame).
     *  i.e. the param "time" is the start of fragment.
     *
     */
    if (typeof time != 'number') {
        callback(); //no error, no data
        return;
    }

    if (DEBUG)
        console.log("look for iframe that is closest to time " + time);

    var checkUntil = time + 7;

    // workaround: ffprobe has some trouble with read_intervals at 0
    if(time == 0) time = -1;

    if (DEBUG)
        console.log("running ffprobe -select_streams 0:v:0 -show_frames -read_intervals "+ time + '%' + checkUntil, " -print_format json "+this.inputPath);

    var ffProcess = spawn(config.ffmpeg_path.ffprobe, ['-select_streams', '0:v:0', '-show_frames', '-read_intervals', time + '%' + checkUntil, '-print_format', 'json', this.inputPath]);
    var jsonStr = '', metadata;
    ffProcess.stdout.on('data', function (data) {
        jsonStr += data;
    });
//    ffProcess.stderr.on('data', function (err) {
//        if (DEBUG)
//            console.error(err.toString());
//    });
    ffProcess.on('close', function (code) {
        if (DEBUG)
            console.log('child process exited with code ' + code);
        if (code) {
            callback(code);
            return;
        }
        metadata = JSON.parse(jsonStr);

        if (!Array.isArray(metadata.frames)) {
            callback('ffprobe did not return an array');
            return;
        }

        var frames = metadata.frames;

        // previous I-frame is always the first one
        var prev = frames[0], foll;
        var prevDiff = Math.abs(prev.pkt_pts_time - time);

        // search for the next one
        for (var f in frames) {
            if (!frames.hasOwnProperty(f)) {
                continue;
            }
            if (f == 0)continue;
            var frame = frames[f];
            if (frame.pict_type == 'I') {
                foll = frame;
                break;
            }
        }

        if (!foll) {
            callback(code, prev);
            return;
        }

        var follDiff = Math.abs(foll.pkt_pts_time - time);
        var closest = (prevDiff > follDiff) ? foll : prev;

        callback(code, closest);
    });
};

Fragment.prototype.checkSource = function (callback) {
    /*
     *  6.3 Errors detectable based on information of the source media
     *  W3C reccomandation Media Fragments URI 1.0 (basic) @ http://www.w3.org/TR/2012/REC-media-frags-20120925/
     */
    var frag = this;
    ffmpeg.ffprobe(frag.inputPath, function (err, metadata) {
        if (err || !metadata || !metadata.hasOwnProperty('streams')) {
            console.error(err);
            // TODO something
            callback(err, false);
            return;
        }

        var hasFragChanged;
        // time control
        var duration = metadata.streams[0].duration;
        frag.totalDuration = duration;

        if (frag.ssStart >= duration) {
            console.warn("Invalid time argument: it cannot be start >= total duration of video. Temporal fragment will be ignored");
            frag.ssStart = 0;
            frag.ssEnd = null;
            hasFragChanged = true;
        }

        if (frag.ssEnd && frag.ssEnd >= duration) {
            console.warn("Invalid time argument: it cannot be end >= total duration of video. End parameter will be ignored");
            frag.ssEnd = null;
            hasFragChanged = true;
        }

        // spatial control
        var videoStream;
        for (var s in metadata.streams) {
            if (metadata.streams.hasOwnProperty(s)) {
                var stream = metadata.streams[s];
                if (stream.codec_type == 'video') {
                    videoStream = stream;
                    break;
                }
            }
        }

        if (videoStream && frag.xywh) {
            var vw = videoStream.width, vh = videoStream.height;

            if (frag.xywh.unit == 'pixel') {
                if (frag.xywh.x >= vw || frag.xywh.y >= vh || frag.xywh.x + frag.xywh.w > vw || frag.xywh.y + frag.xywh.h > vh) {
                    console.warn("Invalid spatial argument: the rectangle area must be contained in video resolution. Spatial fragment will be ignored.");
                    frag.xywh = null;
                    hasFragChanged = true;
                }
            } else {
                if (vw * frag.xywh.w / 100 < 1) {
                    frag.xywh.w = Math.ceil(100 / vw);
                    console.warn("Invalid spatial argument: the fragment width must be at least 1px Spatial fragment will be modified.");
                    hasFragChanged = true;
                }
                if (vh * frag.xywh.h / 100 < 1) {
                    frag.xywh.h = Math.ceil(100 / vh);
                    console.warn("Invalid spatial argument: the fragment height must be at least 1px Spatial fragment will be modified.");
                    hasFragChanged = true;
                }
            }
        }

        if (!frag.ssStart) {
            frag.hasFragChanged = hasFragChanged;
            callback(err, hasFragChanged);
            return;
        }

        frag.checkClosestIframe(frag.ssStart, function (err, closest) {
            if (!err && closest && closest.pkt_pts_time != frag.ssStart) {
                frag.iStart = parseFloat(parseFloat(closest.pkt_pts_time).toFixed(2));
                hasFragChanged = true;

                if (DEBUG)
                    console.log("the closest iframe is at time " + frag.iStart);
            }
            frag.hasFragChanged = hasFragChanged;
            callback(err, hasFragChanged);
        });
    });
};

Fragment.prototype.process = function (callback) {
    var options = ['-movflags', 'faststart'];
//    if (DEBUG)
//        options.push('-report','-loglevel', 'verbose');

    var vcodec = 'copy', acodec = 'copy';
    var ffProcess = ffmpeg(this.inputPath);

    var start = typeof this.iStart != "undefined" ? this.iStart : this.ssStart;
    if (start) {
        start = start > 0.1 ? start - 0.1 : 0; // empirical correction
        options.push('-ss', start + '');
    }
    if (this.ssEnd)
        options.push('-to', this.ssEnd + '');

    if (this.trackList.length) {
        if (this.trackList.indexOf('video') == -1) { //no video in tracklist
            ffProcess.noVideo();
        }
        if (this.trackList.indexOf('audio') == -1) { //no audio in tracklist
            ffProcess.noAudio();
        }
    }

    if (this.xywh) {
        vcodec = this.inputFormat.lib.v;
        if (this.xywh.unit == 'pixel')
            ffProcess.videoFilters('crop=' + this.xywh.w + ':' + this.xywh.h + ':' + this.xywh.x + ':' + this.xywh.y);
        else if (this.xywh.unit == 'percent')
            ffProcess.videoFilters('crop=in_w*' + this.xywh.w + '/100:in_h*' + this.xywh.h + '/100:in_w*' + this.xywh.x + '/100:in_h*' + this.xywh.y + '/100');
    }

    if (options.length > 0)
        ffProcess.addOptions(options);

    ffProcess.videoCodec(vcodec).audioCodec(acodec);
    var outPath = path.join(output_dir, this.getOutputFilename());
    ffProcess.on('start', function (commandLine) {
        if (DEBUG)
            console.log('Spawned Ffmpeg with command: ' + commandLine);
    }).on('data', function (data) {
        if (DEBUG)
            console.log(data.toString());
    }).on('end', function () {
        if (DEBUG)
            console.log('file has been converted succesfully');
        callback(null, outPath);
    }).on('error', function (err, stdout, stderr) {
        console.error(err.message); //this will likely return "code=1" not really useful
        console.log("stdout:\n" + stdout);
        console.error("stderr:\n" + stderr); //this will contain more detailed debugging info
        callback(err);
    }).on('exit', function () {
        if (DEBUG)
            console.log('child process exited');
    }).on('close', function () {
        if (DEBUG)
            console.log('...closing time! bye');
    });
    ffProcess.output(outPath).run();
};

Fragment.prototype.generate = function (callback) {
    /*
     * It runs the entire fragment generation process.
     * At the end it returns the file to serve
     */
    var frag = this;
    frag.originalOutputFileName = frag.getOutputFilename();
    // we have now not a definitive filename but an alias
    findAliasInDb(frag.getOutputFilename(), function (err, file) {
        if (err) {
            callback(err);
            return;
        }
        if (file) {
            frag.dbFile = file;
            callback(err, file);
            return;
        }

        frag.checkSource(function (err, hasFragChanged) {
            if (err) throw Error('Ffprobe error');

            // we have now not a definitive filename
            findFileInDb(frag.getOutputFilename(), function (err, file) {
                if (err) {
                    callback(err);
                    return;
                }
                if (file) {
                    //we have a new "alias-file" couple
                    frag.dbFile = file;
                    addAlias(frag.originalOutputFileName, file, function (err) {
                        callback(err, file);
                    });
                    return;
                }

                frag.process(function (err, outPath) {
                    if (err) throw Error('Ffmpeg error');

                    var writestream = gfs.createWriteStream({
                        filename: frag.getOutputFilename(),
                        mode: 'w',
                        content_type: 'video/' + frag.inputFormat.name,
                        metadata: {
                            totalDuration: frag.totalDuration,
                            lastRequest: Date.now()
                        }
                    }).on('close', function (file) {
                        media.insert({
                            frag: frag.originalOutputFileName,
                            alias: file._id
                        }, function (err) {
                            frag.dbFile = file;
                            fs.unlink(outPath, function (err) {
                                if (err) console.error(err);
                            });
                            callback(err, file);
                        });
                    });
                    fs.createReadStream(outPath).pipe(writestream);
                });
            });
        });
    });
};

module.exports = Fragment;