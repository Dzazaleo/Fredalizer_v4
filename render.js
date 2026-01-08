import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';

console.log("------------------------------------------------");
console.log("   🎬  FREDALIZER BATCH RENDER ENGINE  🎬    ");
console.log("------------------------------------------------");

// --- CONFIGURATION ---
// defined as relative paths to ensure machine independence
const VIDEO_SOURCE_DIR = path.join('game_elements', 'footage');
const VIDEO_OUTPUT_DIR = path.join('game_elements', 'processed');

// Ensure output directory exists
if (!fs.existsSync(VIDEO_OUTPUT_DIR)) {
    console.log(`📂 Creating output folder: ${VIDEO_OUTPUT_DIR}`);
    fs.mkdirSync(VIDEO_OUTPUT_DIR, { recursive: true });
}

// --- 1. MULTI-MANIFEST LOADER ---
function loadAllManifests() {
    const files = fs.readdirSync('.');
    // Find ALL files starting with "batch-cut-list" and ending in .json
    const manifestFiles = files.filter(f => f.startsWith('batch-cut-list') && f.endsWith('.json'));

    let combinedQueue = [];

    if (manifestFiles.length > 0) {
        console.log(`📚 Found ${manifestFiles.length} manifest file(s):`);
        manifestFiles.forEach(file => {
            console.log(`   - Loaded: ${file}`);
            try {
                const rawData = JSON.parse(fs.readFileSync(file, 'utf8'));
                const batchItems = Array.isArray(rawData) ? rawData : [rawData];
                combinedQueue = [...combinedQueue, ...batchItems];
            } catch (err) {
                console.error(`     ❌ Failed to parse ${file}: ${err.message}`);
            }
        });
    } else if (fs.existsSync('cut-list.json')) {
        console.log(`📄 Using Legacy Manifest: cut-list.json`);
        const rawData = JSON.parse(fs.readFileSync('cut-list.json', 'utf8'));
        combinedQueue = Array.isArray(rawData) ? rawData : [rawData];
    } else {
        return null;
    }

    return combinedQueue;
}

const queue = loadAllManifests();

if (!queue || queue.length === 0) {
    console.error(`❌ Error: No valid manifest files found (or they are empty).`);
    process.exit(1);
}

console.log(`\n📂 Total Jobs Queued: ${queue.length}`);
console.log(`📂 Source: ${VIDEO_SOURCE_DIR}`);
console.log(`📂 Output: ${VIDEO_OUTPUT_DIR}\n`);

// --- 2. PROCESSING LOOP ---
const processNext = (index) => {
    if (index >= queue.length) {
        console.log("\n✅ ALL MANIFESTS COMPLETED!");
        return;
    }

    const data = queue[index];
    
    // Normalize Keys (Handle both schemas)
    const inputVideo = data.file || data.fileName; 
    const ranges = data.keepRanges || data.ranges;

    if (!inputVideo) {
        console.error(`   ❌ Error: Job #${index + 1} missing filename. Skipping.`);
        processNext(index + 1);
        return;
    }

    console.log(`\n[${index + 1}/${queue.length}] Processing: ${inputVideo}`);

    // --- Path Resolution ---
    // Looks for file in game_elements/footage OR in the root folder
    const pathInSourceDir = path.join(VIDEO_SOURCE_DIR, inputVideo);
    const pathInRoot = inputVideo;

    let finalInputPath = '';

    if (fs.existsSync(pathInSourceDir)) {
        finalInputPath = pathInSourceDir;
    } else if (fs.existsSync(pathInRoot)) {
        finalInputPath = pathInRoot;
        console.log(`   (Found in root folder)`);
    } else {
        console.error(`   ❌ Skipped: File not found in source or root.`);
        processNext(index + 1);
        return;
    }

    if (!ranges || ranges.length === 0) {
        console.log("   ⚠️  No cuts needed. Skipped.");
        processNext(index + 1);
        return;
    }

    // --- FFmpeg Command Build ---
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
    const outputFileName = `${namePart}_clean${extPart}`;
    const finalOutputPath = path.join(VIDEO_OUTPUT_DIR, outputFileName);

    const cmd = `ffmpeg -i "${finalInputPath}" -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -g 1 -crf 12 -tune animation -pix_fmt yuv420p -c:a aac -b:a 320k "${finalOutputPath}" -y`;

    console.log(`   🚀 Rendering to: ${outputFileName}`);
    
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`   ❌ Error: ${error.message}`);
        } else {
            console.log(`   ✅ Saved to: ${finalOutputPath}`);
        }
        processNext(index + 1);
    });
};

processNext(0);