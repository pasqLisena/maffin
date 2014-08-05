var ffmpeg = require('fluent-ffmpeg'),
    fs = require('fs'),
    spawn = require('child_process').spawn,
    config = require('../config.json');

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

var input_dir = config.app_path.input_dir,
    output_dir = config.app_path.output_dir,
    DEBUG = config.debug;

var availableTrack = ['video', 'audio'];
availableTrack.sort();

var Fragment = function (inputFilename, mfJson) {
    if (!inputFilename || !mfJson)
        throw Error('Fragment: all fields are mandatory');

    var lastDot = inputFilename.lastIndexOf('.');
    this.inputFilename = inputFilename.substr(0, lastDot);
    this.inputFormat = supportedFormats[inputFilename.substr(lastDot + 1)];
    if (!this.inputFormat) throw Error('Format not supported');

    this.inputPath = input_dir + inputFilename;
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

    var fragPart = '';
    if (this.ssStart || this.ssEnd)
        fragPart += '_' + this.ssStart + (this.ssEnd ? '-' + this.ssEnd : '');
    if (this.trackList.length && !this.trackList.sort().join(',') != availableTrack.join(',')) { // if user select all tracks, is not a track-fragment
        this.trackList.forEach(function (tk) {
            fragPart += '_' + tk;
        });
    }
    if (this.xywh && this.xywh.unit == 'pixel')
        fragPart += '_' + this.xywh.x + '-' + this.xywh.y + '-' + this.xywh.w + '-' + this.xywh.h;
    else if (this.xywh && this.xywh.unit == 'percent')
        fragPart += '_PERCENT' + this.xywh.x + '-' + this.xywh.y + '-' + this.xywh.w + '-' + this.xywh.h;

    if (!fragPart)
        return this.inputPath;
    else
        return output_dir + this.inputFilename + fragPart + '.' + this.inputFormat.ext;
};

Fragment.prototype.checkClosestIframe = function (time, callback) {
    /*
     *  Use ffmpeg to search closest I-frame (Intra-coded frame).
     *  In the actual application, the param "time" is the start of fragment.
     *
     */
    var checkUntil = time + 7;
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
        if (code)callback(code);
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

        if (!foll) callback(code, prev.pkt_pts_time);

        var follDiff = Math.abs(foll.pkt_pts_time - time);
        var closest = (prevDiff > follDiff) ? foll : prev;

        callback(code, closest.pkt_pts_time);
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

        frag.checkClosestIframe(frag.ssStart, function (err, newStart) {
            if (!err && newStart && newStart != frag.ssStart) {
                frag.iStart = Math.floor(newStart);
                hasFragChanged = true;
            }

            if (DEBUG)
                console.log("the closest iframe is at time" + frag.iStart);

            frag.hasFragChanged = hasFragChanged;
            callback(err);
        });
    });
};

Fragment.prototype.process = function (callback) {
    var options = ['-movflags', 'faststart'];
//    if (DEBUG)
//        options.push('-report', '-loglevel', 'verbose');

    var vcodec = 'copy', acodec = 'copy';
    var ffProcess = ffmpeg(this.inputPath);

    var start = this.iStart || this.ssStart;
    if (start)
        options.push('-ss', start + '');
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
    ffProcess.on('start', function (commandLine) {
        if (DEBUG)
            console.log('Spawned Ffmpeg with command: ' + commandLine);
    }).on('data', function (data) {
        if (DEBUG)
            console.log(data.toString());
    }).on('end', function () {
        if (DEBUG)
            console.log('file has been converted succesfully');
        callback(false);
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
    if (!this.outputFilename)
        this.getOutputFilename();
    ffProcess.output(this.outputFilename).run();
};

Fragment.prototype.generate = function (callback) {
    /*
     * It runs the entire fragment generation process.
     * At the end it returns the path of the file to serve
     */
    this.outputFilename = this.getOutputFilename();
    if (fs.existsSync(this.outputFilename)) {
        callback(false, this.outputFilename);
        return;
    }

    var frag = this;
    this.checkSource(function (err, hasFragChanged) {
        if (err) throw Error('Ffprobe error');

        //recalculate outputfile name
        frag.outputFilename = frag.getOutputFilename();
        if (fs.existsSync(frag.outputFilename)) {
            callback(false, frag.outputFilename);
            return;
        }

        frag.process(function (err) {
            if (err) throw Error('Ffmpeg error');

            callback(false, frag.outputFilename);
        });

    });
};

module.exports = Fragment;

