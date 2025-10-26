const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs/promises');
const path = require('path');

// --- 1. Определите пути ---
const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');

// --- 2. Определите ваши пресеты ---
// Мы используем массив 'cli' для опций, так как это безопаснее
// для обработки путей и аргументов, чем одна строка.
const PRESETS = {
  // Сжимает видео, уменьшая разрешение на 50%
  'conv0_5': {
    cli: [
      '-vf', 'scale=iw*0.5:ih*0.5', // video filter: scale width and height by 0.5
      '-c:v', 'libx264',           // video codec: h.264
      '-crf', '28',                // quality (constant rate factor): 28 (higher is smaller/worse)
      '-c:a', 'aac',               // audio codec: aac
      '-b:a', '128k',              // audio bitrate: 128k
    ],
    outputExtension: '.mp4'
  },
  
  // Стандартный веб-пресет H.264 (хорошее качество)
  'web_h264': {
    cli: [
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'medium', // 'slow' is better quality, 'fast' is faster
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart' // Оптимизирует для веб-стриминга
    ],
    outputExtension: '.mp4'
  },
  
  // Извлекает только аудио в MP3
  'extract_audio': {
    cli: [
      '-vn',         // No video
      '-c:a', 'libmp3lame',
      '-q:a', '2'    // MP3 quality (0-9, 0 is best)
    ],
    outputExtension: '.mp3'
  }
};

// Список расширений файлов, которые мы считаем видео
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv'];

// --- 3. Главная функция конвертации ---
async function convertVideos(presetName) {
  console.log(`🚀 Начинаем конвертацию с пресетом: ${presetName}`);

  // 3.1. Проверяем, существует ли пресет
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(`❌ Ошибка: Пресет "${presetName}" не найден.`);
    console.log('Доступные пресеты:', Object.keys(PRESETS).join(', '));
    return;
  }

  try {
    // 3.2. Убедимся, что папки существуют
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    // 3.3. Читаем все файлы из папки input
    const files = await fs.readdir(inputDir);

    const videoFiles = files.filter(file => 
      VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase())
    );

    if (videoFiles.length === 0) {
      console.warn('🟡 В папке /input не найдено видеофайлов.');
      return;
    }

    console.log(`Найдено ${videoFiles.length} видеофайлов. Начинаем обработку...`);

    // 3.4. Создаем массив промисов для каждой конвертации
    const conversionPromises = videoFiles.map(file => {
      const inputPath = path.join(inputDir, file);
      
      // Формируем имя выходного файла
      const fileData = path.parse(file);
      const outputName = `${fileData.name}${preset.outputExtension}`;
      const outputPath = path.join(outputDir, outputName);

      // Возвращаем промис, который управляет одним процессом ffmpeg
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .addOutputOptions(preset.cli) // Применяем наши CLI опции
          .output(outputPath)
          .on('start', (command) => console.log(`[${file}]: Начата обработка...`))
          .on('end', () => {
            console.log(`[${file}]: ✅ Конвертация успешно завершена -> ${outputName}`);
            resolve({ file, status: 'success' });
          })
          .on('error', (err) => {
            console.error(`[${file}]: ❌ Ошибка: ${err.message}`);
            reject({ file, status: 'error', message: err.message });
          })
          .run();
      });
    });

    // 3.5. Ждем завершения всех конвертаций
    const results = await Promise.allSettled(conversionPromises);

    // 3.6. Выводим итог
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.length - successCount;

    console.log('\n--- 🏁 Конвертация завершена ---');
    console.log(`Успешно: ${successCount}`);
    console.log(`С ошибками: ${failedCount}`);

  } catch (err) {
    console.error('❌ Произошла критическая ошибка:', err.message);
  }
}

// --- 4. Запуск скрипта ---

// Получаем имя пресета из аргументов командной строки
// Пример: node convert.js web_h264
const presetName = process.argv[2];

if (!presetName) {
  console.log('Пожалуйста, укажите имя пресета.');
  console.log('Пример: node convert.js web_h264');
  console.log('Доступные пресеты:', Object.keys(PRESETS).join(', '));
} else {
  convertVideos(presetName);
}