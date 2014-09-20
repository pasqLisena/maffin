MaFFiN
======

A Media Fragment Server in Node.js.


#Requirements

* A recent version of [Node.js](http://www.nodejs.org/)
* A [MongoDb](https://www.mongodb.org/) database running on your machine (or on a reachable host)
* A recent build of [ffmpeg](https://ffmpeg.org/), that includes ffprobe


# Install

Please install dependencies with
<pre>npm install</pre>

You need also to setup the file <code>config.json</code>:
<pre>
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
</pre>


# Supports

This server supports the most common containers and codecs for web videos:
* MP4 with H264 video codec
* WebM with VP8 video codec
* Ogg with Theora video codec


# How to use

<pre>
set DEBUG = maffin
node www
</pre>


Coming soon...
