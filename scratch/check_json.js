const fs = require('fs');
const path = require('path');

const filePath = path.join('public', 'video-comercial.html');
const content = fs.readFileSync(filePath, 'utf8');

console.log('Checking Video Comercial HTML...');

const manifestMatch = content.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
if (manifestMatch) {
    const jsonStr = manifestMatch[1].trim();
    try {
        JSON.parse(jsonStr);
        console.log('✅ Manifest JSON is valid');
    } catch (e) {
        console.log('❌ Manifest JSON Error:', e.message);
        const posMatch = e.message.match(/at position (\d+)/);
        if (posMatch) {
            const pos = parseInt(posMatch[1]);
            console.log('Error around position:', pos);
            console.log('Snippet:', jsonStr.substring(Math.max(0, pos - 50), Math.min(jsonStr.length, pos + 50)));
        }
    }
} else {
    console.log('❓ Manifest script not found');
}

const templateMatch = content.match(/<script type="__bundler\/template" id="__bundler_template">([\s\S]*?)<\/script>/);
if (templateMatch) {
    const jsonStr = templateMatch[1].trim();
    try {
        JSON.parse(jsonStr);
        console.log('✅ Template JSON is valid');
    } catch (e) {
        console.log('❌ Template JSON Error:', e.message);
        const posMatch = e.message.match(/at position (\d+)/);
        if (posMatch) {
            const pos = parseInt(posMatch[1]);
            console.log('Error around position:', pos);
            console.log('Snippet:', jsonStr.substring(Math.max(0, pos - 50), Math.min(jsonStr.length, pos + 50)));
        }
    }
} else {
    console.log('❓ Template script not found');
}
