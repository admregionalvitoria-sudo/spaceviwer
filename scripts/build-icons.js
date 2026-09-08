const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const logoSource = path.join(__dirname, '..', 'imagens', 'logo.png');
const iconPngDest = path.join(__dirname, '..', 'resources', 'icon.png');
const iconIcoDest = path.join(__dirname, '..', 'resources', 'icon.ico');
const assetsLogoDest = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'logo.png');

console.log('--- SpaceViewer Icon Sync/Build Tool ---');

if (!fs.existsSync(logoSource)) {
  console.error(`Erro: Arquivo original do logo nao encontrado em ${logoSource}`);
  process.exit(1);
}

// 1. Copy original logo.png to resources/icon.png and src/renderer/assets/logo.png
console.log('Copiando logo original...');
fs.copyFileSync(logoSource, iconPngDest);
console.log(`Copiado logo para: ${iconPngDest}`);

fs.copyFileSync(logoSource, assetsLogoDest);
console.log(`Copiado logo para: ${assetsLogoDest}`);

// 2. Generate 256x256 resized PNG using PowerShell
const tempPngPath = path.join(__dirname, '..', 'temp_256.png');
console.log('Redimensionando logo para 256x256 via PowerShell...');

const escapedLogoSource = logoSource.replace(/\\/g, '\\\\');
const escapedTempPngPath = tempPngPath.replace(/\\/g, '\\\\');

const psScript = `
Add-Type -AssemblyName System.Drawing;
$srcImg = [System.Drawing.Image]::FromFile('${escapedLogoSource}');
$newImg = New-Object System.Drawing.Bitmap(256, 256);
$g = [System.Drawing.Graphics]::FromImage($newImg);
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;
$g.DrawImage($srcImg, 0, 0, 256, 256);
$newImg.Save('${escapedTempPngPath}', [System.Drawing.Imaging.ImageFormat]::Png);
$g.Dispose();
$newImg.Dispose();
$srcImg.Dispose();
`;

try {
  execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'inherit' });
} catch (err) {
  console.error('Falha ao redimensionar imagem via PowerShell:', err);
  process.exit(1);
}

// 3. Read the 256x256 PNG and build a valid ICO container
if (!fs.existsSync(tempPngPath)) {
  console.error('Erro: Arquivo temporario 256x256 nao foi criado');
  process.exit(1);
}

const pngBuffer = fs.readFileSync(tempPngPath);
const icoBuffer = Buffer.alloc(22 + pngBuffer.length);

// Header
icoBuffer.writeUInt16LE(0, 0);     // Reserved
icoBuffer.writeUInt16LE(1, 2);     // Type (1 = icon)
icoBuffer.writeUInt16LE(1, 4);     // Image count (1)

// Directory Entry
icoBuffer.writeUInt8(0, 6);        // Width 256 (0)
icoBuffer.writeUInt8(0, 7);        // Height 256 (0)
icoBuffer.writeUInt8(0, 8);        // Color palette (0)
icoBuffer.writeUInt8(0, 9);        // Reserved
icoBuffer.writeUInt16LE(1, 10);    // Color planes (1)
icoBuffer.writeUInt16LE(32, 12);   // Bits per pixel (32)
icoBuffer.writeUInt32LE(pngBuffer.length, 14); // Size of image data
icoBuffer.writeUInt32LE(22, 18);   // Offset of image data (header + entry = 22 bytes)

// Copy PNG data
pngBuffer.copy(icoBuffer, 22);

// Write ICO file
fs.writeFileSync(iconIcoDest, icoBuffer);
console.log(`Gerado arquivo ICO com sucesso em: ${iconIcoDest}`);

// Cleanup
fs.unlinkSync(tempPngPath);
console.log('Limpeza de arquivos temporarios concluida.');
console.log('Icones atualizados com sucesso!');
