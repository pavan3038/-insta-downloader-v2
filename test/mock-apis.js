'use strict';
/* Local mock of (a) an Instagram Graph API and (b) a generic provider API + a CDN, for tests only. */
const http = require('http');

const VIDEO = Buffer.alloc(3 * 1024 * 1024 + 123, 7); // fake 3 MB "mp4"
const AUDIO = Buffer.alloc(200 * 1024 + 5, 3); // fake 200 KB "mp3"
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function start(port) {
  const origin = `http://127.0.0.1:${port}`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, origin);
    const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

    if (u.pathname === '/cdn/video.mp4') {                       // CDN with Range support
      const r = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
      if (r) {
        const s = +r[1], e = r[2] ? +r[2] : VIDEO.length - 1;
        res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${s}-${e}/${VIDEO.length}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' });
        return res.end(VIDEO.subarray(s, e + 1));
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': VIDEO.length, 'Accept-Ranges': 'bytes' });
      return res.end(VIDEO);
    }
    if (u.pathname === '/cdn/song.mp3') { res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': AUDIO.length }); return res.end(req.method === 'HEAD' ? undefined : AUDIO); }
    if (u.pathname === '/cdn/thumb.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
    if (u.pathname === '/cdn/photo.jpg' || u.pathname === '/cdn/photo2.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': PNG.length }); return res.end(PNG); }
    if (u.pathname === '/cdn/page.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>nope</html>'); }

    // --- mock Instagram Graph API ---
    if (u.pathname === '/v21.0/me/stories') {
      return json({ data: [{ id: '17900000000001', media_type: 'VIDEO', media_url: origin + '/cdn/video.mp4', thumbnail_url: origin + '/cdn/thumb.png', permalink: 'https://www.instagram.com/stories/me/17900000000001/' }] });
    }
    if (u.pathname === '/v21.0/me') {
      if (u.searchParams.get('access_token') !== 'GOOD_TOKEN') return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
      return json({ id: '123' });
    }
    if (u.pathname === '/v21.0/c1/children') {
      return json({ data: [
        { id: 'k1', media_type: 'IMAGE', media_url: origin + '/cdn/photo.jpg' },
        { id: 'k2', media_type: 'IMAGE', media_url: origin + '/cdn/photo2.jpg' },
        { id: 'k3', media_type: 'VIDEO', media_url: origin + '/cdn/video.mp4', thumbnail_url: origin + '/cdn/thumb.png' } ] });
    }
    if (u.pathname === '/v21.0/me/media') {
      if (u.searchParams.get('access_token') !== 'GOOD_TOKEN') return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
      if (u.searchParams.get('page') === '2') {
        return json({ data: [{ id: '3', media_type: 'VIDEO', media_url: origin + '/cdn/video.mp4', thumbnail_url: origin + '/cdn/thumb.png', permalink: 'https://www.instagram.com/reel/PAGE2video/', caption: 'Second page reel' }] });
      }
      return json({
        data: [
          { id: '1', media_type: 'IMAGE', media_url: origin + '/cdn/photo.jpg', permalink: 'https://www.instagram.com/p/IMAGEonly1/', caption: 'A photo' },
          { id: 'c1', media_type: 'CAROUSEL_ALBUM', media_url: origin + '/cdn/photo.jpg', permalink: 'https://www.instagram.com/p/CAROUSEL01/', caption: 'Carousel post' },
          { id: '2', media_type: 'VIDEO', media_url: origin + '/cdn/video.mp4', thumbnail_url: origin + '/cdn/thumb.png', permalink: 'https://www.instagram.com/reel/OWNreel123/', caption: 'My own reel\nsecond line' },
          { id: '9', media_type: 'VIDEO', media_url: origin + '/cdn/page.html', permalink: 'https://www.instagram.com/reel/BADhtml99/', caption: 'bad' },
        ],
        paging: { next: `${origin}/v21.0/me/media?page=2&access_token=GOOD_TOKEN` },
      });
    }

    // --- mock RapidAPI-style provider (unknown JSON shape on purpose: tests auto-detection) ---
    if (u.pathname === '/rapid/convert') {
      if (req.headers['x-rapidapi-key'] !== 'RKEY' || req.headers['x-rapidapi-host'] !== 'ig.p.rapidapi.com') return json({ message: 'You are not subscribed to this API.' }, 403);
      const t = u.searchParams.get('url') || '';
      if (t.includes('QUOTA')) return json({ message: 'quota' }, 429);
      if (t.includes('MISSING')) return json({ status: 'ok', result: [] });
      if (t.includes('VARIANTS')) return json({ caption: 'Variants', video_versions: [
        { url: origin + '/cdn/video.mp4?q=low', width: 480, height: 854 }, { url: origin + '/cdn/video.mp4?q=hd', width: 720, height: 1280 } ], duration: 12.5 });
      if (t.includes('WITHAUDIO')) return json({ caption: 'Audio reel', video_versions: [
        { url: origin + '/cdn/video.mp4?q=sd', width: 540, height: 960, quality: '540p' }, { url: origin + '/cdn/video.mp4?q=hd', width: 1080, height: 1920, quality: '1080p' } ],
        audio_url: origin + '/cdn/song.mp3', duration: 9 });
      const kind = t.includes('/stories/') ? 'story' : t.includes('/p/') ? 'post' : 'reel';
      return json({ status: 'ok', kind, caption: 'Rapid ' + kind, result: [
        { type: 'image', display_url: origin + '/cdn/thumb.png' },
        { type: 'video', thumbnail: origin + '/cdn/thumb.png', video_url: origin + '/cdn/video.mp4?q=hd' } ] });
    }

    // --- mock generic provider ---
    if (u.pathname === '/provider') {
      if (req.headers['x-api-key'] !== 'KEY123') return json({ error: 'unauthorized' }, 401);
      const target = u.searchParams.get('url') || '';
      if (target.includes('MISSING')) return json({ data: {} });
      return json({ data: { medias: [{ url: origin + '/cdn/video.mp4' }], title: 'Provider video', thumb: origin + '/cdn/thumb.png' } });
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, origin, VIDEO })));
}
module.exports = { start };
if (require.main === module) start(+process.env.MOCK_PORT || 4010).then((m) => console.log('mock on', m.origin));
