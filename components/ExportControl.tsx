import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';

// Usage: node render.js <video_file> <json_file>
const args = process.argv.slice(2);
const inputVideo = args[0];
const jsonFile = args[1];

if (!inputVideo || !jsonFile) {
  console.log("❌ Usage: node render.js <video.mp4> <cut-list.json>");
  process.exit(1);
}

// Read the Cut List
console.log(`📂 Reading cut list: ${jsonFile}`);
const ranges = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
console.log(`✂️  Stitching ${ranges.length} segments...`);

// Build the FFmpeg Filter
let filter = '';
let concat = '';

ranges.forEach((r, i) => {
  // Trim video & audio, reset timestamps
  filter += `[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS[v${i}];`;
  filter += `[0:a]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS[a${i}];`;
  concat += `[v${i}][a${i}]`;
});

filter += `${concat}concat=n=${ranges.length}:v=1:a=1[outv][outa]`;

// Output filename
const outputName = `${path.parse(inputVideo).name}_clean.mp4`;

// The Command
// Since you added FFmpeg to PATH, we can just call 'ffmpeg' directly!
const cmd = `ffmpeg -i "${inputVideo}" -filter_complex "${filter}" -map "[outv]" -map "[outa]" -c:v libx264 -crf 18 -preset fast "${outputName}" -y`;

console.log("🚀 Rendering started... (This might take a moment)");

exec(cmd, (error, stdout, stderr) => {
  if (error) {
    console.error(`❌ Error: ${error.message}`);
    return;
  }
  console.log(`✅ Done! Saved as: ${outputName}`);
});