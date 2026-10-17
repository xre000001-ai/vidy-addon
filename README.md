# Vidy

Stremio addon family: **Vidy · MovieBox · MultiMovies** in one package, with an embedded **resolver bridge** for ToonWorld4All + RareToons.

- Direct streams, multi-audio, subtitles — no media bytes ever pass through the server.
- Proxies are supplied exclusively by [PoolHub](https://github.com/) sub-spaces (IP/geo-flag bypass only — never playback).
- Embedded MovieBox engine (`nethex/`): catalog search → JWT gates → episode matrix → CDN-direct MP4.

## Install

Open the deployed manifest in Stremio, or paste it in Add-ons:

```
https://<deployment>/manifest.json
```

The configure page (`/configure`) offers quality, audio-language and subtitle filters encoded straight into the manifest URL.

## Layout

```
server.js              HTTP addon: catalogs, streams, subtitles, config page
nethex/                vendored MovieBox engine (own server, spawned as a child)
  mb-lib/              pool · search · episode-matrix · links · subtitles
resolver/twr_bridge.js ToonWorld + RareToons resolver bridge (hub-only)
config/                PoolHub sub-space API keys
docs/                  ARCHITECTURE · DEPLOY · CHANGELOG
assets/                logos
test.js                self-test suite (node test.js [baseURL])
```

## Sources

| Family | Path |
|---|---|
| vidy (own) | seed API → decrypt → CDN-direct |
| MovieBox | embedded nethex child (`/stream` proxy) |
| MultiMovies | vidbolt/vidout pipelines |
| ToonWorld / RareToons | resolver bridge → PoolHub sub-spaces |

## Run

```
npm i
PORT=7000 node server.js
```

Environment: `POOLHUB` (hub base), `POOLHUB_KEYS` (keys JSON/path), `TWRT_BRIDGE=1` + `TWBASE`/`RTBASE` (resolver bridge), `NEXBASE` (external MovieBox engine), `VDBG=1` (debug logs).

## License

MIT — see [LICENSE](LICENSE).
