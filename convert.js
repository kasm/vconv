const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs/promises');
const path = require('path');

// --- 1. Определите пути ---
const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');

// --- 2. Настройка логгера ---
const now = new Date();
const dateStr = now.toISOString().split('T')[0].replace(/-/g, '_'); // YYYY_MM_DD
const logFileName = path.join(__dirname, `process_${dateStr}.log`);

/**
 * Записывает сообщение в консоль и в файл лога.
 * @param {string} message - Сообщение для логирования.
 */
async function logInfo(message) {
  const logMessage = `${new Date().toISOString()}: ${message}\n`;
  try {
    // Выводим в консоль без временной метки для чистоты
    console.log(message);
    // Записываем в файл с временной меткой
    await fs.appendFile(logFileName, logMessage);
  } catch (err) {
    console.error('CRITICAL: Failed to write to log file:', err);
  }
}

// --- 3. Определите ваши пресеты ---
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

// --- 4. Вспомогательные функции ---

/**
 * Оборачивает ffprobe в Promise для получения метаданных файла.
 * @param {string} filePath - Путь к файлу.
 * @returns {Promise<object>} - Объект с метаданными.
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

/** Форматирует байты в читаемый вид (KB, MB, GB). */
function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** Форматирует битрейт в читаемый вид (kb/s). */
function formatBitrate(bitrate) {
  if (!bitrate || bitrate === 'N/A' || isNaN(bitrate)) return 'N/A';
  return (parseInt(bitrate) / 1000).toFixed(0) + ' kb/s';
}

// --- 5. Главная функция конвертации ---
async function convertVideos(presetName) {
  await logInfo(`🚀 Начинаем сессию конвертации с пресетом: ${presetName}`);

  const preset = PRESETS[presetName];
  if (!preset) {
    await logInfo(`❌ Ошибка: Пресет "${presetName}" не найден.`);
    await logInfo(`Доступные пресеты: ${Object.keys(PRESETS).join(', ')}`);
    return;
  }

  let files;
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    files = await fs.readdir(inputDir);
  } catch (err) {
    await logInfo(`❌ Критическая ошибка чтения/создания папок: ${err.message}`);
    return;
  }

  const videoFiles = files.filter(file => 
    VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase())
  );

  if (videoFiles.length === 0) {
    await logInfo('🟡 В папке /input не найдено видеофайлов.');
    return;
  }

  await logInfo(`Найдено ${videoFiles.length} видеофайлов. Начинаем поочередную обработку...`);

  let successCount = 0;
  let failedCount = 0;

  // Используем for...of цикл для последовательной обработки
  for (let i = 0; i < videoFiles.length; i++) {
    const file = videoFiles[i];
    const fileData = path.parse(file);
    const inputPath = path.join(inputDir, file);
    const outputName = `${fileData.name}${preset.outputExtension}`;
    const outputPath = path.join(outputDir, outputName);

    await logInfo(`\n--- [${i + 1}/${videoFiles.length}] Начинаем обработку: ${file} ---`);
    
    let sourceStats;
    try {
      // 1. Получаем статистику ИСХОДНОГО файла
      sourceStats = await getFileStats(inputPath);
      await logInfo(`  Source Stats:`);
      await logInfo(`    File Size: ${formatBytes(sourceStats.size)}`);
      await logInfo(`    Video: ${sourceStats.videoCodec} @ ${formatBitrate(sourceStats.videoBitrate)}`);
      await logInfo(`    Audio: ${sourceStats.audioCodec} @ ${formatBitrate(sourceStats.audioBitrate)}`);
    } catch (err) {
      await logInfo(`❌ Ошибка получения статистики (ffprobe) для ${file}: ${err.message}`);
      await logInfo(`--- Пропускаем файл: ${file} ---`);
      failedCount++;
      continue; // Переходим к следующему файлу
    }

    const startTime = new Date();
    await logInfo(`  Start Time: ${startTime.toISOString()}`);

    // 2. Запускаем конвертацию в Promise
    let conversionError = null;
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .addOutputOptions(preset.cli)
          .output(outputPath)
          .on('start', (command) => {
            // Не логируем в файл, слишком много спама, но полезно для отладки
            console.log(`[${file}] FFmpeg команда: ${command}`);
          })
          .on('progress', (progress) => {
            // Показываем % в консоли на одной строке
            if (progress.percent) {
              process.stdout.write(`[${file}]: ⏳ Processing... ${progress.percent.toFixed(2)}% complete\r`);
            }
          })
          .on('end', () => {
            process.stdout.write('\n'); // Очищаем строку прогресса
            resolve();
          })
          .on('error', (err) => {
            process.stdout.write('\n'); // Очищаем строку прогресса
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

    // 3. Обрабатываем результат
    if (conversionError) {
      await logInfo(`  ❌ [${file}]: FAILED. Error: ${conversionError.message}`);
      failedCount++;
    } else {
      // 4. Получаем статистику РЕЗУЛЬТИРУЮЩЕГО файла
      try {
        const targetStats = await getFileStats(outputPath);
        await logInfo(`  Target Stats:`);
        await logInfo(`    File Size: ${formatBytes(targetStats.size)}`);
        await logInfo(`    Video: ${targetStats.videoCodec} @ ${formatBitrate(targetStats.videoBitrate)}`);
        await logInfo(`    Audio: ${targetStats.audioCodec} @ ${formatBitrate(targetStats.audioBitrate)}`);
        
        // Сравнение размеров
        const sizeChange = ((targetStats.size - sourceStats.size) / sourceStats.size) * 100;
        await logInfo(`    Size Change: ${sizeChange.toFixed(2)}% (from ${formatBytes(sourceStats.size)} to ${formatBytes(targetStats.size)})`);

        await logInfo(`  ✅ [${file}]: SUCCESS -> ${outputName}`);
        successCount++;
      } catch (err) {
        await logInfo(`  ⚠️ [${file}]: SUCCESS, но не удалось получить статистику результата: ${err.message}`);
        successCount++; // Считаем успешным, т.к. конвертация прошла
      }
    }
    await logInfo(`--- Завершили: ${file} ---`);
  }

  // 6. Выводим итог
  await logInfo('\n--- 🏁 Сессия конвертации завершена ---');
  await logInfo(`Успешно: ${successCount}`);
  await logInfo(`С ошибками / Пропущено: ${failedCount}`);
  await logInfo(`Все логи сохранены в: ${logFileName}`);
}

// --- 6. Запуск скрипта ---

const presetName = process.argv[2];

if (!presetName) {
  console.log('Пожалуйста, укажите имя пресета.');
  console.log('Пример: node convert.js web_h264');
  console.log('Доступные пресеты:', Object.keys(PRESETS).join(', '));
} else {
  convertVideos(presetName);
}