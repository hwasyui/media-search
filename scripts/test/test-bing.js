import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function testBing() {
  const q = 'Telkom Percepat Adopsi AI di Segmen Enterprise';
  try {
    const { stdout } = await execFileAsync('curl.exe', [
      '-s', '-L', '--max-time', '6',
      `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=id&cc=ID`
    ], { maxBuffer: 1024 * 1024 });

    console.log('Bing RSS length:', stdout.length);
    const matches = [...stdout.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g)];
    console.log('Matches found:', matches.length);
    for (const m of matches.slice(0, 5)) {
      console.log('Title:', m[1]);
      console.log('Link:', m[2]);
    }
  } catch (e) {
    console.error('Bing error:', e.message);
  }
}
testBing();

