const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const TABBAR_DIR = path.join(__dirname, '../src/assets/tabbar');
const OUTPUT_DIR = path.join(__dirname, '../src/assets/tabbar/png');

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Convert all SVG files to PNG
fs.readdirSync(TABBAR_DIR).forEach(file => {
  if (file.endsWith('.svg')) {
    const inputPath = path.join(TABBAR_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file.replace('.svg', '.png'));
    
    sharp(inputPath)
      .resize(81, 81) // WeChat recommended size (27pt × 27pt @3x)
      .png()
      .toFile(outputPath)
      .then(() => {
        console.log(`Converted ${file} to PNG`);
      })
      .catch(err => {
        console.error(`Error converting ${file}:`, err);
      });
  }
}); 