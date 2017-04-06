MaFFiN
======

MaFFiN is a Node.JS server that implements the [Media Fragment W3C Recommendation](http://www.w3.org/TR/media-frags/).

It supports temporal (npt) and track fragment, both in hash and query format.

See my [slides](https://www.slideshare.net/SquaLeLis/developing-a-nodejs).

![MaFFiN is the acronym of MediA Fragment FIlesystem Node.JS server](https://github.com/pasqLisena/maffin/blob/master/public/images/maffin_logotipo.png)

# Requirements

* A recent version of [Node.js](http://www.nodejs.org/)
* A [MongoDb](https://www.mongodb.org/) database running on your machine (or on a reachable host)
* A recent build of [ffmpeg](https://ffmpeg.org/), that includes ffprobe

# Install

Please install dependencies with
<pre>npm install</pre>

You need also to setup the file `config.json`:
```js
{
    "app_options": {
        "input_dir": "D:\\video\\",           \\ input video path
        "output_dir": "D:\\video\\tmp\\",     \\ temporary output video path
        "mongo_host": "localhost",            \\ host where MongoDb is running
        "mongo_port": 27017,                  \\ port where MongoDb is running
        "frag_ttl": 60                        \\ how much time output video must be deleted after (in seconds)
    },
    "ffmpeg_path": {
        "ffmpeg": "C:\\ffmpeg\\bin\\ffmpeg.exe",  \\ ffmpeg build path
        "ffprobe": "C:\\ffmpeg\\bin\\ffprobe.exe" \\ ffprobe build path
    },
    "debug": true                             \\ if false, it hides some logs on Node.js console
}
```

Please make sure that `input_dir` and `output_dir` exist on your filesystem.

# Supports

This server supports the most common containers and codecs for web videos:
* MP4 with H264 video codec
* WebM with VP8 video codec
* Ogg with Theora video codec


# How to use

    set DEBUG = maffin
    node www

Than just try to run Media Fragments on your browser.
Some examples:
* [localhost:3000/video/video.mp4?t=10,20](localhost:3000/video/video.mp4?t=10,20)
* [localhost:3000/video/video.mp4#t=10,20](localhost:3000/video/video.mp4#t=10,20)
* [localhost:3000/video/video.mp4?t=10,40#t=0,10](localhost:3000/video/video.mp4?t=10,40#t=0,10)
