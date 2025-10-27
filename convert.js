const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs/promises');
const path = require('path');

// --- 1. Define Paths ---
const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');

// --- 2. Logger Setup ---
const now = new Date();
const dateStr = now.toISOString().split('T')[0].replace(/-/g, '_'); // YYYY_MM_DD
const logFileName = path.join(__dirname, `process_${dateStr}.log`);

/**
 * Writes a message to the console and to the log file.
 * @param {string} message - The message to log.
 */
async function logInfo(message) {
  const logMessage = `${new Date().toISOString()}: ${message}\n`;
  try {
    // Log to console without timestamp for cleanliness
    console.log(message);
    // Append to log file with timestamp
    await fs.appendFile(logFileName, logMessage);
  } catch (err) {
    console.error('CRITICAL: Failed to write to log file:', err);
  }
}

// --- 3. Define Your Presets ---
const PRESETS = {
  'conv0_5': {
    cli: [
      '-vf', 'scale=iw*0.5:ih*0.5',
      '-c:v', 'libx264',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '128k',
    ],
    outputExtension: '.mp4'
  },
// --- NEW PRESET ---
  'conv0_25s': {
    cli: [
      '-vf', 'scale=iw*0.25:ih*0.25', // Scale video to 0.25
      '-c:v', 'libxvid',             // Video codec: Xvid
      '-q:v', '5',                   // Xvid quality (1-31, lower is better)
      '-c:a', 'libmp3lame',          // Audio codec: MP3
      '-b:a', '128k'                 // Audio bitrate: 128k
    ],
    outputExtension: '.avi' // Xvid and MP3 are best packed into .avi
  },
  // --- END NEW PRESET ---

// --- UPDATED PRESET ---
  'conv256s': {
    cli: [
      // Auto width (-2), Height 256
      '-vf', 'scale=-2:256',
    '-af', 'volume=2.0',       // Audio filter: volume 2x
      '-c:v', 'libxvid',
      '-q:v', '5',
      '-c:a', 'libmp3lame',
      '-b:a', '192k'
    ],
    outputExtension: '.avi'
  },
  // --- END UPDATED PRESET ---
  'web_h264': {
    cli: [
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'medium',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart'
    ],
    outputExtension: '.mp4'
  },
  'extract_audio': {
    cli: [
      '-vn',
      '-c:a', 'libmp3lame',
      '-q:a', '2'
    ],
    outputExtension: '.mp3'
  }
};

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv'];

// --- 4. Helper Functions ---

/**
 * Wraps ffprobe in a Promise to get file metadata.
 * @param {string} filePath - Path to the file.
 * @returns {Promise<object>} - Object with metadata.
 */
function getFileStats(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return reject(new Error(`ffprobe error for ${filePath}: ${err.message}`));
      }
      
      const format = metadata.format;
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      
      resolve({
        size: format.size,
        duration: format.duration,
        videoCodec: videoStream ? videoStream.codec_name : 'N/A',
        videoBitrate: videoStream ? (videoStream.bit_rate || 'N/A') : 'N/A',
        audioCodec: audioStream ? audioStream.codec_name : 'N/A',
        audioBitrate: audioStream ? (audioStream.bit_rate || 'N/A') : 'N/A',
      });
    });
  });
}

/** Formats bytes into human-readable (KB, MB, GB). */
function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** Formats bitrate into human-readable (kb/s). */
function formatBitrate(bitrate) {
  if (!bitrate || bitrate === 'N/A' || isNaN(bitrate)) return 'N/A';
  return (parseInt(bitrate) / 1000).toFixed(0) + ' kb/s';
}

// --- 5. Main Conversion Function ---
async function convertVideos(presetName) {
  await logInfo(`🚀 Starting conversion session with preset: ${presetName}`);

  const preset = PRESETS[presetName];
  if (!preset) {
    await logInfo(`❌ Error: Preset "${presetName}" not found.`);
    await logInfo(`Available presets: ${Object.keys(PRESETS).join(', ')}`);
    return;
  }

  let files;
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    files = await fs.readdir(inputDir);
  } catch (err) {
    await logInfo(`❌ Critical error reading/creating directories: ${err.message}`);
    return;
  }

  const videoFiles = files.filter(file => 
    VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase())
  );

  if (videoFiles.length === 0) {
    await logInfo('🟡 No video files found in /input folder.');
    return;
  }

  await logInfo(`Found ${videoFiles.length} video files. Starting sequential processing...`);

  let successCount = 0;
  let failedCount = 0;

  // Use a for...of loop for sequential processing
  for (let i = 0; i < videoFiles.length; i++) {
    const file = videoFiles[i];
    const fileData = path.parse(file);
    const inputPath = path.join(inputDir, file);
    const outputName = `${fileData.name}${preset.outputExtension}`;
    const outputPath = path.join(outputDir, outputName);

    await logInfo(`\n--- [${i + 1}/${videoFiles.length}] Starting processing: ${file} ---`);
    
    let sourceStats;
    try {
      // 1. Get stats for the SOURCE file
      sourceStats = await getFileStats(inputPath);
      await logInfo(`  Source Stats:`);
      await logInfo(`    File Size: ${formatBytes(sourceStats.size)}`);
      await logInfo(`    Video: ${sourceStats.videoCodec} @ ${formatBitrate(sourceStats.videoBitrate)}`);
      await logInfo(`    Audio: ${sourceStats.audioCodec} @ ${formatBitrate(sourceStats.audioBitrate)}`);
    } catch (err) {
      await logInfo(`❌ Error getting stats (ffprobe) for ${file}: ${err.message}`);
      await logInfo(`--- Skipping file: ${file} ---`);
      failedCount++;
      continue; // Continue to the next file
    }

    const startTime = new Date();
    await logInfo(`  Start Time: ${startTime.toISOString()}`);

    // 2. Start the conversion in a Promise
    let conversionError = null;
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .addOutputOptions(preset.cli)
          .output(outputPath)
          .on('start', (command) => {
            // Don't log to file, too much spam, but useful for debugging
            console.log(`[${file}] FFmpeg command: ${command}`);
          })
          .on('progress', (progress) => {
            // Show % in console on a single line
            if (progress.percent) {
              process.stdout.write(`[${file}]: ⏳ Processing... ${progress.percent.toFixed(2)}% complete\r`);
            }
          })
          .on('end', () => {
            process.stdout.write('\n'); // Clear the progress line
            resolve();
          })
          .on('error', (err) => {
            process.stdout.write('\n'); // Clear the progress line
            reject(err);
          })
          .run();
      });
    } catch (err) {
      conversionError = err;
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    await logInfo(`  End Time: ${endTime.toISOString()}`);
    await logInfo(`  Duration: ${(durationMs / 1000).toFixed(2)} seconds`);

    // 3. Process the result
    if (conversionError) {
      await logInfo(`  ❌ [${file}]: FAILED. Error: ${conversionError.message}`);
      failedCount++;
    } else {
      // 4. Get stats for the TARGET file
      try {
        const targetStats = await getFileStats(outputPath);
        await logInfo(`  Target Stats:`);
        await logInfo(`    File Size: ${formatBytes(targetStats.size)}`);
        await logInfo(`    Video: ${targetStats.videoCodec} @ ${formatBitrate(targetStats.videoBitrate)}`);
        await logInfo(`    Audio: ${targetStats.audioCodec} @ ${formatBitrate(targetStats.audioBitrate)}`);
        
        // Size comparison
        const sizeChange = ((targetStats.size - sourceStats.size) / sourceStats.size) * 100;
        await logInfo(`    Size Change: ${sizeChange.toFixed(2)}% (from ${formatBytes(sourceStats.size)} to ${formatBytes(targetStats.size)})`);

        await logInfo(`  ✅ [${file}]: SUCCESS -> ${outputName}`);
        successCount++;
      } catch (err) {
        await logInfo(`  ⚠️ [${file}]: SUCCESS, but failed to get target stats: ${err.message}`);
        successCount++; // Count as success since the conversion itself passed
      }
    }
    await logInfo(`--- Finished: ${file} ---`);
  }

  // 6. Print summary
  await logInfo('\n--- 🏁 Conversion session finished ---');
  await logInfo(`Successful: ${successCount}`);
  await logInfo(`Failed / Skipped: ${failedCount}`);
  await logInfo(`All logs saved to: ${logFileName}`);
}

// --- 6. Run the Script ---

const presetName = process.argv[2];

if (!presetName) {
  console.log('Please provide a preset name.');
  console.log('Usage: node convert.js web_h264');
  console.log('Available presets:', Object.keys(PRESETS).join(', '));
} else {
  convertVideos(presetName);
}