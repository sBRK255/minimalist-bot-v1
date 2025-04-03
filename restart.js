const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Restarting WhatsApp Bot System...');

// Kill any existing processes
const killCommands = [
    'pkill -f "node index.js"',
    'pkill -f "node server.js"',
    'taskkill /F /IM node.exe /FI "WINDOWTITLE eq node index.js"',
    'taskkill /F /IM node.exe /FI "WINDOWTITLE eq node server.js"'
];

// Try each kill command, ignoring errors (some will fail depending on platform)
for (const cmd of killCommands) {
    try {
        exec(cmd, () => {});
    } catch (e) {
        // Ignore errors
    }
}

// Clean up any temporary files that might be causing issues
const AUTH_FOLDER = './auth';
const filesToClean = ['contacts.json', 'qrcode.txt'];

for (const file of filesToClean) {
    try {
        const filePath = path.join(AUTH_FOLDER, file);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up ${file}`);
        }
    } catch (e) {
        console.error(`Error cleaning up ${file}:`, e);
    }
}

// Wait a moment for processes to terminate
setTimeout(() => {
    // Start the bot in background
    exec('node index.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error starting bot: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Bot stderr: ${stderr}`);
        }
        if (stdout) {
            console.log(`Bot stdout: ${stdout}`);
        }
    });
    console.log('WhatsApp bot started in background');
    
    // Wait a moment for the bot to initialize
    setTimeout(() => {
        // Start the web server in background
        exec('node server.js', (error, stdout, stderr) => {
            if (error) {
                console.error(`Error starting web server: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`Web server stderr: ${stderr}`);
            }
            if (stdout) {
                console.log(`Web server stdout: ${stdout}`);
            }
        });
        console.log('Web server started in background');
        console.log('System restart complete! Wait a few moments for the system to fully initialize.');
        console.log('Then visit http://localhost:3000/admin to access the bot admin panel');
    }, 2000);
}, 1000); 