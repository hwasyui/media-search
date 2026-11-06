import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function testDDG() {
  const q = 'Telkom Percepat Adopsi AI di Segmen Enterprise';
  const { stdout } = await execFileAsync('curl.exe', [
    '-s', '-L', '--max-time', '6',
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  ], { maxBuffer: 1024 * 1024 });

  console.log('DDG HTML length:', stdout.length);
  const matches = [...stdout.matchAll(/href="([^"]*uddg=[^"]*)"/g)];
  console.log('Matches found:', matches.length);
  for (const m of matches.slice(0, 5)) {
    const raw = m[1].split('uddg=')[1]?.split('&')[0];
    if (raw) {
      console.log('->', decodeURIComponent(raw));
    }
  }
}
testDDG();

