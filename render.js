import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';

console.log("------------------------------------------------");
console.log("   🎬  FREDALIZER BATCH RENDER ENGINE  🎬    ");
console.log("------------------------------------------------");

// Check for batch list first, then legacy cut-list
let jsonPath = 'batch-cut-list.json';
if (!fs.existsSync(jsonPath)) {
    // Try to find a file matching the pattern batch-cut-list-*.json
    const files = fs.readdirSync('.');
    const batchFile = files.find(f => f.startsWith('batch-cut-list-') && f.endsWith('.json'));
    if (batchFile) {
        jsonPath = batchFile;
    } else if (fs.existsSync('cut-list.json')) {
        jsonPath = 'cut-list.json';
    }
}

if (!fs.existsSync(jsonPath)) {
    console.error(`❌ Error: Could not find 'batch-cut-list.json' or similar manifest file.`);
    process.exit(1);
}

console.log(`📄 Loading manifest: ${jsonPath}`);
const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// Normalize to array (support both legacy single object and new batch array)
const queue = Array.isArray(rawData) ? rawData : [rawData];

console.log(`📂 Found ${queue.length} jobs in queue.\n`);

const processNext = (index) => {
    if (index >= queue.length) {
        console.log("\n✅ ALL JOBS COMPLETED!");
        return;
    }

    const data = queue[index];
    // Handle property naming differences between versions
    const inputVideo = data.file || data.fileName; 
    const ranges = data.keepRanges || data.ranges;

    console.log(`\n[${index + 1}/${queue.length}] Processing: ${inputVideo}`);

    if (!inputVideo || !fs.existsSync(inputVideo)) {
        console.error(`   ❌ Skipped: File '${inputVideo}' not found.`);
        processNext(index + 1);
        return;
    }

    if (!ranges || ranges.length === 0) {
        console.log("   ⚠️  No cuts needed. Copying file...");
        // Logic to just copy could go here, but for now we skip or simple render
    }

    let filterComplex = '';
    let concatInputs = '';

    ranges.forEach((r, i) => {
        const start = r.start.toFixed(3);
        const end = r.end.toFixed(3);
        filterComplex += `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}];`;
        filterComplex += `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}];`;
        concatInputs += `[v${i}][a${i}]`;
    });

    filterComplex += `${concatInputs}concat=n=${ranges.length}:v=1:a=1[outv][outa]`;

    const namePart = path.parse(inputVideo).name;
    const extPart = path.parse(inputVideo).ext;
    const outputName = `${namePart}_clean${extPart}`;

    // Added -y to overwrite output without asking
    const cmd = `ffmpeg -i "${inputVideo}" -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -g 1 -crf 12 -tune animation -pix_fmt yuv420p -c:a aac -b:a 320k "${outputName}" -y`;

    console.log(`   🚀 Rendering...`);
    
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`   ❌ Error: ${error.message}`);
        } else {
            console.log(`   ✅ Done!`);
        }
        processNext(index + 1);
    });
};

// Start Loop
processNext(0);