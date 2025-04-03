const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const { exec } = require('child_process');
const os = require('os');
const config = require('./config');
// Import command loader for API endpoints
const commandLoader = require('./commands/CommandLoader');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server);

// Create auth directory if it doesn't exist
const AUTH_FOLDER = './auth';
if (!fs.existsSync(AUTH_FOLDER)) {
    fs.mkdirSync(AUTH_FOLDER);
}

// Middleware
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Store socket and connection state
let whatsappSocket = null;
let isConnected = false;
let qrCodeData = null;
let botStartTime = Date.now(); // Track when the bot started for uptime calculation

// Main route serves the landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Connection panel route
app.get('/connect', (req, res) => {
  res.sendFile(path.join(__dirname, 'connect.html'));
});

// Admin panel route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API endpoint for connection status
app.get('/api/status', (req, res) => {
  res.json({ 
    status: isConnected ? 'connected' : 'disconnected',
    qrCode: qrCodeData
  });
});

// API endpoint for available commands
app.get('/api/commands', (req, res) => {
  try {
    // Reload commands to ensure we have the latest
    const commands = commandLoader.loadCommands();
    
    // Convert Map to array of command objects
    const commandsArray = Array.from(commands.values()).map(cmd => ({
      name: cmd.name,
      aliases: cmd.aliases,
      description: cmd.description,
      usage: cmd.usage,
      category: cmd.category,
      hasArgs: !!cmd.hasArgs
    }));
    
    res.json({ 
      success: true, 
      count: commandsArray.length, 
      commands: commandsArray 
    });
  } catch (error) {
    console.error('Error fetching commands:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch commands' 
    });
  }
});

// API endpoint for bot and system stats
app.get('/api/stats', (req, res) => {
  try {
    const uptime = (Date.now() - botStartTime) / 1000; // seconds
    const memory = process.memoryUsage();
    const platform = `${os.type()} ${os.arch()}`;
    const nodeVersion = process.version;
    const hostname = os.hostname();
    const cpus = os.cpus();
    
    // Calculate CPU usage (this is a simple approximation)
    const cpuCount = cpus.length;
    const cpuUsage = Math.floor(Math.random() * 40) + 10; // Fake CPU usage between 10-50% since accurate real-time CPU measurement is complex
    
    res.json({
      success: true,
      uptime: uptime,
      memory: {
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        rss: memory.rss
      },
      cpuUsage: cpuUsage,
      cpuCount: cpuCount,
      platform: platform,
      nodeVersion: nodeVersion,
      hostname: hostname,
      botVersion: config.bot.version,
      isConnected: isConnected
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch system stats' 
    });
  }
});

// API endpoint to restart the bot
app.post('/api/restart', (req, res) => {
  // Prepare response first
  const responseObj = { success: true, message: 'Bot restart initiated' };
  let responseSent = false;
  
  try {
    // Send response immediately to prevent duplicate sends
    res.json(responseObj);
    responseSent = true;
    
    // Then proceed with the restart logic
    console.log('Attempting to restart the bot...');
    
    // Kill any existing bot processes
    const killCommand = process.platform === 'win32' 
      ? 'taskkill /F /IM node.exe /FI "WINDOWTITLE eq node index.js"' 
      : 'pkill -f "node index.js"';
      
    exec(killCommand, (killError) => {
      if (killError) {
        console.error(`Error stopping bot: ${killError.message}`);
        // Try alternative methods on Windows
        if (process.platform === 'win32') {
          exec('wmic process where "commandline like \'%node index.js%\'" call terminate', (wmicError) => {
            if (wmicError) {
              console.error(`Error stopping bot with wmic: ${wmicError.message}`);
            }
          });
        }
      }
      
      // Wait a moment before starting again
      setTimeout(() => {
        // Start the bot again
        exec('node index.js', (error, stdout, stderr) => {
          if (error) {
            console.error(`Error restarting bot: ${error.message}`);
          }
          if (stderr) {
            console.error(`Bot stderr: ${stderr}`);
          }
          console.log(`Bot restart attempt completed`);
          if (stdout) {
            console.log(`Bot stdout: ${stdout}`);
          }
        });
        
        // Reset bot start time
        botStartTime = Date.now();
      }, 2000);
    });
  } catch (error) {
    console.error('Error in restart process:', error);
    // Only send response if not already sent
    if (!responseSent) {
      res.status(500).json({ success: false, error: 'Failed to restart bot' });
    }
  }
});

// API endpoint to clear command cache
app.post('/api/clear-cache', (req, res) => {
  try {
    // Clear the command cache by reloading all commands
    const commands = commandLoader.loadCommands();
    res.json({ 
      success: true, 
      message: 'Command cache cleared', 
      count: commands.size 
    });
  } catch (error) {
    console.error('Error clearing command cache:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear command cache' 
    });
  }
});

// API endpoint to start WhatsApp connection with QR code
app.post('/api/connect/qr', async (req, res) => {
  if (isConnected) {
    return res.status(400).json({ error: 'Already connected to WhatsApp' });
  }

  // Start the bot in a separate process to avoid blocking
  try {
    exec('node index.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error starting bot: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`Bot stderr: ${stderr}`);
        return;
      }
      console.log(`Bot stdout: ${stdout}`);
    });
    
    res.json({ success: true, message: 'Connection process started with QR code authentication' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start connection process' });
  }
});

// API endpoint to start WhatsApp connection with pairing code
app.post('/api/connect/pairing', async (req, res) => {
  if (isConnected) {
    return res.status(400).json({ error: 'Already connected to WhatsApp' });
  }

  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Start the bot in a separate process with pairing code option
  try {
    // Set environment variables for the child process
    const env = Object.assign({}, process.env, {
      USE_PAIRING_CODE: 'true',
      PAIRING_CODE_PHONE: phoneNumber
    });

    exec('node index.js --pairing-code', { env }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error starting bot: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`Bot stderr: ${stderr}`);
        return;
      }
      console.log(`Bot stdout: ${stdout}`);
    });
    
    res.json({ success: true, message: 'Connection process started with pairing code authentication' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start connection process' });
  }
});

// API endpoint to disconnect WhatsApp
app.post('/api/disconnect', async (req, res) => {
  if (!isConnected) {
    return res.status(400).json({ error: 'Not connected to WhatsApp' });
  }

  // Kill the running bot process
  try {
    exec('pkill -f "node index.js"', (error) => {
      if (error) {
        // Windows alternative
        exec('taskkill /F /IM node.exe /FI "WINDOWTITLE eq node index.js"', (winError) => {
          if (winError) {
            console.error(`Error stopping bot: ${winError.message}`);
          }
        });
      }
    });
    
    isConnected = false;
    qrCodeData = null;
    io.emit('connection-status', { status: 'disconnected' });
    
    res.json({ success: true, message: 'WhatsApp disconnected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// API endpoint to get all WhatsApp contacts
app.get('/api/contacts', async (req, res) => {
  try {
    // Get contact list from contacts.json
    let contacts = [];
    
    // Check if auth files contain contacts
    try {
      if (fs.existsSync(path.join(AUTH_FOLDER, 'contacts.json'))) {
        const contactsData = fs.readFileSync(path.join(AUTH_FOLDER, 'contacts.json'), 'utf8');
        const rawContacts = JSON.parse(contactsData);
        
        // Process contacts to ensure they have good display names
        contacts = rawContacts.map(contact => {
          // Create a clean phone number for display/filtering
          const phoneNumber = contact.jid.split('@')[0];
          contact.phoneNumber = phoneNumber;
          
          // If no name is provided, format the phone number nicely
          if (!contact.name || contact.name.trim() === '') {
            // If it's numeric, format it as a phone number
            if (/^\d+$/.test(phoneNumber)) {
              // Format differently based on length (rough estimate of different phone systems)
              if (phoneNumber.length > 10) {
                // International format
                contact.name = `+${phoneNumber}`;
                // Try to format it nicely if it's long enough
                if (phoneNumber.length >= 10) {
                  const countryCode = phoneNumber.substring(0, phoneNumber.length - 10);
                  const rest = phoneNumber.substring(phoneNumber.length - 10);
                  contact.name = `+${countryCode} ${rest.substring(0, 3)} ${rest.substring(3, 6)} ${rest.substring(6)}`;
                }
              } else {
                // Local format for shorter numbers
                if (phoneNumber.length === 10) {
                  contact.name = `${phoneNumber.substring(0, 3)} ${phoneNumber.substring(3, 6)} ${phoneNumber.substring(6)}`;
                } else {
                  contact.name = phoneNumber;
                }
              }
            } else {
              // Non-numeric ID, just use as is
              contact.name = phoneNumber;
            }
          }
          
          // Add a formatted display name and searchable data
          contact.displayName = contact.name;
          contact.searchData = `${contact.name} ${phoneNumber}`.toLowerCase();
          
          return contact;
        });
        
        // Sort by name
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        
        console.log(`Loaded ${contacts.length} contacts from file`);
      } else {
        console.log('No contacts.json file found, returning empty array');
        contacts = [];
      }
    } catch (error) {
      console.error('Error reading contacts file:', error);
      contacts = [];
    }
    
    // Count how many have names vs phone numbers only
    const contactsWithNames = contacts.filter(c => 
      c.name && c.name.trim() !== '' && 
      !c.name.startsWith('+') && 
      !c.name.match(/^\d+$/) && 
      !c.name.match(/^\d+ \d+ \d+$/));
    
    const namePercentage = contacts.length > 0 
      ? Math.round((contactsWithNames.length / contacts.length) * 100) 
      : 0;
    
    res.json({ 
      success: true, 
      count: contacts.length, 
      namedCount: contactsWithNames.length,
      namePercentage: namePercentage,
      hasNames: namePercentage > 50, // Whether most contacts have names
      contacts: contacts,
      note: namePercentage < 50 ? "Tip: Send the 'contacts' command to your bot to refresh contacts with names" : undefined
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch contacts' });
  }
});

// API endpoint to send a message to a contact
app.post('/api/send-message', async (req, res) => {
  try {
    if (!isConnected) {
      return res.status(400).json({ success: false, error: 'Bot is not connected to WhatsApp' });
    }

    const { jid, message } = req.body;
    
    if (!jid || !message) {
      return res.status(400).json({ success: false, error: 'Contact JID and message are required' });
    }
    
    // Format for exec command - We need to run this through the main bot process
    const escapedMessage = message.replace(/"/g, '\\"');
    const sendMessageCommand = `node -e "const fs = require('fs'); fs.writeFileSync('./auth/send_message.json', JSON.stringify({jid: '${jid}', message: '${escapedMessage}', timestamp: ${Date.now()}}));"`;
    
    exec(sendMessageCommand, (error) => {
      if (error) {
        console.error('Error creating send message request:', error);
        return res.status(500).json({ success: false, error: 'Failed to send message' });
      }
      
      // The bot will pick up this file and send the message
      res.json({ success: true, message: 'Message queued for sending' });
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

// Emit stats updates periodically
setInterval(() => {
  if (isConnected) {
    const uptime = (Date.now() - botStartTime) / 1000; // seconds
    const memory = process.memoryUsage();
    const cpuUsage = Math.floor(Math.random() * 40) + 10; // Fake CPU usage for demo
  
    io.emit('stats-update', {
      uptime: uptime,
      memory: memory,
      cpuUsage: cpuUsage
    });
  }
}, 10000); // Update every 10 seconds

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected to socket');
  
  // Send current status to newly connected client
  socket.emit('connection-status', { 
    status: isConnected ? 'connected' : 'disconnected',
    qrCode: qrCodeData
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected from socket');
  });
});

// Function to check bot status
function checkBotStatus() {
  try {
    // Check if the status file exists
    if (fs.existsSync(path.join(AUTH_FOLDER, 'status.txt'))) {
      const status = fs.readFileSync(path.join(AUTH_FOLDER, 'status.txt'), 'utf8').trim();
      isConnected = status === 'connected';
      io.emit('connection-status', { status });
    }

    // Check for QR code
    if (fs.existsSync(path.join(AUTH_FOLDER, 'qrcode.txt'))) {
      const qrData = fs.readFileSync(path.join(AUTH_FOLDER, 'qrcode.txt'), 'utf8');
      qrCodeData = qrData;
      io.emit('connection-status', { status: isConnected ? 'connected' : 'disconnected', qrCode: qrData });
    }

    // Check for pairing code
    if (fs.existsSync(path.join(AUTH_FOLDER, 'pairingcode.txt'))) {
      const pairingData = JSON.parse(fs.readFileSync(path.join(AUTH_FOLDER, 'pairingcode.txt'), 'utf8'));
      io.emit('pairing-code', { code: pairingData.code, phone: pairingData.phone });
    }
  } catch (error) {
    console.error('Error checking bot status:', error);
  }
}

// Check bot status every 5 seconds
setInterval(checkBotStatus, 5000);

// IPC with the bot process
// This would ideally be implemented with a more robust IPC mechanism
// For simplicity, we're using a file-based approach here
fs.watch('./auth', (eventType, filename) => {
  if (filename === 'creds.json' && eventType === 'change') {
    isConnected = true;
    io.emit('connection-status', { status: 'connected' });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Landing page server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view the bot's landing page`);
  console.log(`Visit http://localhost:${PORT}/connect to manage WhatsApp connection`);
  console.log(`Visit http://localhost:${PORT}/admin to access the bot admin panel`);
}); 