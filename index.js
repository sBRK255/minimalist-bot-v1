const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { toDataURL } = require('qrcode');

// Import command loader
const commandLoader = require('./commands/CommandLoader');

// Create auth directory if it doesn't exist
const AUTH_FOLDER = './auth';
if (!fs.existsSync(AUTH_FOLDER)) {
    fs.mkdirSync(AUTH_FOLDER);
}

// Global socket variable to access outside the connect function
let sock = null;
let isConnected = false;

// Check if pairing code method is requested via command line arg
const USE_PAIRING_CODE = process.argv.includes('--pairing-code') || process.env.USE_PAIRING_CODE === 'true';
const PAIRING_CODE_PHONE = process.env.PAIRING_CODE_PHONE || ''; // Format: 123456789 (no + or country code)

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Add a single instance check
const instanceLockFile = path.join(AUTH_FOLDER, 'instance.lock');
let connectionRetryCount = 0;
const MAX_RETRY_COUNT = 5;
const CONNECTION_CHECK_INTERVAL = 30000; // 30 seconds
let connectionCheckTimer = null;
let contactFetchRetryCount = 0;

// Add this near the top of the file with other variables
let lastContactRefresh = 0;
const CONTACT_REFRESH_COOLDOWN = 15 * 60 * 1000; // 15 minutes cooldown

// Check if another instance is running
function checkForExistingInstance() {
    try {
        if (fs.existsSync(instanceLockFile)) {
            const lockData = JSON.parse(fs.readFileSync(instanceLockFile));
            const now = Date.now();
            // If lock is less than 1 minute old, consider it active
            if (now - lockData.timestamp < 60000) {
                console.log('WARNING: Another instance appears to be running!');
                console.log('If no other instance is running, delete the file: ' + instanceLockFile);
                return true;
            }
        }
        
        // Create or update lock file
        fs.writeFileSync(instanceLockFile, JSON.stringify({
            timestamp: Date.now(),
            pid: process.pid
        }));
        
        // Update lock file periodically
        setInterval(() => {
            fs.writeFileSync(instanceLockFile, JSON.stringify({
                timestamp: Date.now(),
                pid: process.pid
            }));
        }, 30000);
        
        // Remove lock file on exit
        process.on('exit', () => {
            try {
                if (fs.existsSync(instanceLockFile)) {
                    fs.unlinkSync(instanceLockFile);
                }
            } catch (err) {
                console.error('Failed to remove lock file:', err);
            }
        });
        
        return false;
    } catch (err) {
        console.error('Error checking for existing instance:', err);
        return false;
    }
}

// Function to save QR code for web interface
async function saveQRCodeToFile(qr) {
    try {
        const qrDataURL = await toDataURL(qr);
        // Save to a file that the web interface can access
        fs.writeFileSync(path.join(AUTH_FOLDER, 'qrcode.txt'), qrDataURL);
        console.log('QR code saved for web interface');
    } catch (error) {
        console.error('Failed to save QR code:', error);
    }
}

// Function to save connection status for web interface
function saveConnectionStatus(status) {
    try {
        fs.writeFileSync(path.join(AUTH_FOLDER, 'status.txt'), status);
        console.log(`Connection status updated: ${status}`);
    } catch (error) {
        console.error('Failed to save connection status:', error);
    }
}

// Function to save pairing code for web interface
function savePairingCode(code, phone) {
    try {
        fs.writeFileSync(
            path.join(AUTH_FOLDER, 'pairingcode.txt'),
            JSON.stringify({ code, phone })
        );
        console.log(`Pairing code saved for web interface: ${code}`);
    } catch (error) {
        console.error('Failed to save pairing code:', error);
    }
}

// Load all commands
function loadCommands() {
    console.log('Loading commands...');
    const commands = commandLoader.loadCommands();
    console.log(`Loaded ${commands.size} commands.`);
    return commands;
}

// Improve the fetchContactNames function with better error handling and alternative approaches
async function fetchContactNames() {
    console.log('Attempting to fetch contact names from WhatsApp...');
    
    try {
        // First attempt: Use the store to get contacts
        if (sock && sock.store) {
            try {
                const contacts = sock.store.contacts;
                if (contacts && Object.keys(contacts).length > 0) {
                    console.log(`Found ${Object.keys(contacts).length} contacts from store`);
                    return contacts;
                }
            } catch (storeError) {
                console.log('Could not fetch contacts from store:', storeError.message);
            }
        }
        
        // Second attempt: Try direct query with error handling
        try {
            if (sock && sock.query) {
                const contactsResult = await sock.query({
                    json: ['query', 'ContactsArray'],
                    requiresPhoneConnection: false,
                });
                
                if (contactsResult && Array.isArray(contactsResult) && contactsResult.length > 0) {
                    console.log(`Successfully fetched ${contactsResult.length} contacts via query`);
                    return contactsResult;
                }
            }
        } catch (queryError) {
            console.log('Error querying contacts:', queryError.message);
        }
        
        // Third attempt: Try alternative API endpoint
        try {
            if (sock && sock.groupFetchAllParticipating) {
                const groups = await sock.groupFetchAllParticipating();
                if (groups) {
                    console.log('Fetched contacts from groups');
                    const participants = [];
                    Object.values(groups).forEach(group => {
                        if (group.participants) {
                            group.participants.forEach(participant => {
                                participants.push({
                                    jid: participant.id,
                                    name: participant.name || '',
                                    notify: participant.notify || ''
                                });
                            });
                        }
                    });
                    if (participants.length > 0) {
                        return participants;
                    }
                }
            }
        } catch (groupError) {
            console.log('Error fetching groups:', groupError.message);
        }
        
        // Fourth attempt: Try to access internal properties safely
        if (sock && sock.contacts) {
            console.log('Trying to access contacts directly from sock.contacts');
            const directContacts = Object.values(sock.contacts);
            if (directContacts && directContacts.length > 0) {
                console.log(`Found ${directContacts.length} contacts from sock.contacts`);
                return directContacts;
            } else {
                console.log('Found 0 contacts from sock.contacts');
            }
        }
        
        // If all attempts fail
        console.log('All contact fetching methods failed, falling back to session files');
        return null;
    } catch (error) {
        console.error('Error fetching contacts from WhatsApp:', error);
        return null;
    }
}

// Improve the saveContacts function with better merging of contacts
async function saveContacts() {
    // Check if we're in cooldown period
    const now = Date.now();
    if (now - lastContactRefresh < CONTACT_REFRESH_COOLDOWN) {
        console.log(`Contact refresh on cooldown. Next refresh available in ${Math.ceil((lastContactRefresh + CONTACT_REFRESH_COOLDOWN - now) / 1000)} seconds`);
        return false;
    }
    
    console.log('Attempting to save contacts...');
    lastContactRefresh = now; // Update timestamp
    
    try {
        // Load existing contacts first
        let contacts = [];
        const contactsPath = path.join(AUTH_FOLDER, 'contacts.json');
        
        if (fs.existsSync(contactsPath)) {
            try {
                contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
                console.log(`Loaded ${contacts.length} existing contacts from file`);
            } catch (err) {
                console.error('Error reading contacts file:', err);
                contacts = [];
            }
        }
        
        // Create a map of existing contacts for easy lookup
        const contactMap = new Map();
        contacts.forEach(contact => {
            if (contact && contact.jid) {
                contactMap.set(contact.jid, contact);
            }
        });
        
        // Get fresh contacts from WhatsApp
        const freshContacts = await fetchContactNames();
        let updatedCount = 0;
        
        if (freshContacts) {
            // If it's an array, process each contact
            if (Array.isArray(freshContacts)) {
                freshContacts.forEach(contact => {
                    if (!contact || !contact.jid) return;
                    
                    // Skip status broadcast
                    if (contact.jid === 'status@broadcast') return;
                    
                    const existingContact = contactMap.get(contact.jid);
                    
                    if (existingContact) {
                        // Update existing contact if new data has a name
                        let updated = false;
                        
                        if (contact.name && contact.name.trim() !== '') {
                            existingContact.name = contact.name;
                            updated = true;
                        } else if (contact.notify && contact.notify.trim() !== '') {
                            existingContact.name = contact.notify;
                            updated = true;
                        } else if (contact.vname && contact.vname.trim() !== '') {
                            existingContact.name = contact.vname;
                            updated = true;
                        }
                        
                        if (updated) updatedCount++;
                    } else {
                        // Add new contact
                        const newContact = {
                            jid: contact.jid,
                            name: contact.name || contact.notify || contact.vname || '',
                            lastMessageTime: 0,
                            unreadCount: 0,
                            isContact: true
                        };
                        
                        // Format the phone number as the name if no name is available
                        if (!newContact.name || newContact.name.trim() === '') {
                            const phoneNumber = contact.jid.split('@')[0];
                            newContact.name = `+${phoneNumber}`;
                        }
                        
                        contactMap.set(contact.jid, newContact);
                        updatedCount++;
                    }
                });
                
                console.log(`Updated ${updatedCount} contacts from WhatsApp API`);
            } else {
                // If it's an object (like sock.store.contacts), process it differently
                Object.entries(freshContacts).forEach(([jid, contact]) => {
                    if (jid === 'status@broadcast') return;
                    
                    const existingContact = contactMap.get(jid);
                    
                    if (existingContact) {
                        // Update existing contact if new data has a name
                        let updated = false;
                        
                        if (contact.name && contact.name.trim() !== '') {
                            existingContact.name = contact.name;
                            updated = true;
                        } else if (contact.notify && contact.notify.trim() !== '') {
                            existingContact.name = contact.notify;
                            updated = true;
                        } else if (contact.vname && contact.vname.trim() !== '') {
                            existingContact.name = contact.vname;
                            updated = true;
                        }
                        
                        if (updated) updatedCount++;
                    } else {
                        // Add new contact
                        const newContact = {
                            jid: jid,
                            name: contact.name || contact.notify || contact.vname || '',
                            lastMessageTime: 0,
                            unreadCount: 0,
                            isContact: true
                        };
                        
                        // Format the phone number as the name if no name is available
                        if (!newContact.name || newContact.name.trim() === '') {
                            const phoneNumber = jid.split('@')[0];
                            newContact.name = `+${phoneNumber}`;
                        }
                        
                        contactMap.set(jid, newContact);
                        updatedCount++;
                    }
                });
                
                console.log(`Updated ${updatedCount} contacts from WhatsApp store`);
            }
        }
        
        // If we couldn't get any contacts or update existing ones, extract from session files
        if (updatedCount === 0) {
            const extractedContacts = await extractContactsFromSessions();
            
            if (extractedContacts && extractedContacts.length > 0) {
                extractedContacts.forEach(extractedContact => {
                    if (!extractedContact || !extractedContact.jid) return;
                    
                    // Skip status broadcast
                    if (extractedContact.jid === 'status@broadcast') return;
                    
                    const existingContact = contactMap.get(extractedContact.jid);
                    
                    if (!existingContact) {
                        contactMap.set(extractedContact.jid, extractedContact);
                        updatedCount++;
                    }
                });
                
                console.log(`Added ${updatedCount} contacts from session files`);
            }
        }
        
        // Convert map to array
        const updatedContacts = Array.from(contactMap.values());
        
        // Save to file if we have contacts
        if (updatedContacts.length > 0) {
            fs.writeFileSync(contactsPath, JSON.stringify(updatedContacts));
            console.log(`Saved ${updatedContacts.length} contacts to file`);
            return true;
        } else {
            console.log('No contacts to save');
            return false;
        }
    } catch (error) {
        console.error('Error saving contacts:', error);
        return false;
    }
}

// Helper function to extract contacts from session files
async function extractContactsFromSessions() {
    try {
        const contacts = [];
        const processedJids = new Set();
        
        // Get all session files
        const sessionFiles = fs.readdirSync(AUTH_FOLDER)
            .filter(f => f.startsWith('session-') && f.endsWith('.json'));
        
        console.log(`Found ${sessionFiles.length} session files`);
        
        for (const file of sessionFiles) {
            try {
                // Extract the JID from the filename (session-1234567890.0.json)
                const jidMatch = file.match(/session-([^.]+)/);
                if (!jidMatch || !jidMatch[1]) continue;
                
                let jid = jidMatch[1];
                
                // Skip status broadcasts
                if (jid === 'status@broadcast') continue;
                
                // Add WhatsApp suffix if not present
                if (!jid.includes('@')) {
                    // Check if this is a group ID
                    if (jid.length > 15) {
                        jid = `${jid}@g.us`;
                    } else {
                        jid = `${jid}@s.whatsapp.net`;
                    }
                }
                
                // Skip groups
                if (jid.includes('@g.us')) continue;
                
                // Skip if already processed
                if (processedJids.has(jid)) continue;
                processedJids.add(jid);
                
                // Try to get contact name from message history if possible
                let contactName = '';
                try {
                    // Attempt to read the session file to extract more info
                    const sessionData = JSON.parse(fs.readFileSync(path.join(AUTH_FOLDER, file), 'utf8'));
                    if (sessionData.name) {
                        contactName = sessionData.name;
                    } else if (sessionData.notify) {
                        contactName = sessionData.notify;
                    }
                } catch (e) {
                    // Ignore errors reading session files
                }
                
                // Format the phone number as a name if no name is available
                if (!contactName) {
                    const phoneNumber = jid.split('@')[0];
                    // Format as +XX XXX XXX XXXX if it's a number
                    if (/^\d+$/.test(phoneNumber)) {
                        contactName = phoneNumber;
                        // Try to format it nicely if it's just digits
                        if (phoneNumber.length > 8) {
                            contactName = `+${phoneNumber.substring(0, phoneNumber.length - 8)} ${phoneNumber.substring(phoneNumber.length - 8)}`;
                        }
                    } else {
                        contactName = phoneNumber;
                    }
                }
                
                contacts.push({
                    jid: jid,
                    name: contactName,
                    lastMessageTime: 0,
                    unreadCount: 0,
                    isContact: true
                });
            } catch (fileError) {
                console.error(`Error processing session file ${file}:`, fileError);
            }
        }
        
        console.log(`Extracted ${contacts.length} contacts from session files`);
        return contacts;
    } catch (error) {
        console.error('Error extracting contacts from sessions:', error);
        return [];
    }
}

// Function to check for messages to send
async function checkPendingMessages() {
    try {
        const messageFile = path.join(AUTH_FOLDER, 'send_message.json');
        
        if (fs.existsSync(messageFile)) {
            const data = JSON.parse(fs.readFileSync(messageFile, 'utf8'));
            const { jid, message, timestamp } = data;
            
            // Only process recent messages (less than 5 minutes old)
            if (Date.now() - timestamp < 5 * 60 * 1000) {
                console.log(`Sending message to ${jid}: ${message}`);
                
                if (sock && isConnected) {
                    await sock.sendMessage(jid, { text: message });
                    console.log('Message sent successfully');
                }
            }
            
            // Delete the file after processing
            fs.unlinkSync(messageFile);
        }
    } catch (error) {
        console.error('Error checking pending messages:', error);
    }
}

// Improve the connectToWhatsApp function with better error handling
async function connectToWhatsApp() {
    // Check for existing instance
    if (checkForExistingInstance()) {
        console.log('Another instance appears to be running. Exiting to prevent conflicts.');
        process.exit(1);
    }
    
    // Reset connection retry count
    connectionRetryCount = 0;
    
    try {
        console.log('Connecting to WhatsApp...');
        saveConnectionStatus('connecting');
        
        // Using the saved auth state
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
        
        // Create WhatsApp connection with optimized settings for stability
        sock = makeWASocket({
            printQRInTerminal: !USE_PAIRING_CODE, // Only print QR if not using pairing code
            auth: state,
            browser: ['WhatsApp Bot', 'Chrome', '10.0'],
            // Adding connection options for stability
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000, // Increased from 15000
            // Prevent browser sessions being logged out on reload
            markOnlineOnConnect: false,
            // Enable proper message store
            syncFullHistory: true,
            // Prevent timeout issues
            maxRetries: 5,
            // Manage message history to prevent using excessive memory
            msgRetryCounterMap: {},
            // Enable retries for connection
            retryRequestDelayMs: 1000,
            // Additional connection options
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000, // Increased timeout
            // Anti-badSession options
            generateHighQualityLinkPreview: false
        });
        
        // Initialize contacts tracking
        sock.contacts = sock.contacts || {};
        
        // Make sure we have a proper event handlers by checking them after creation
        if (!sock.ev) {
            throw new Error('WhatsApp socket event emitter not initialized properly');
        }
        
        // Ensure we can add event handlers by wrapping them in try-catch
        try {
            // Track all contacts we get from messages
            sock.ev.on('contacts.update', updates => {
                for (const update of updates) {
                    // Skip status broadcast
                    if (update.id === 'status@broadcast') continue;
                    
                    // Store in our contacts object
                    if (!sock.contacts[update.id]) {
                        sock.contacts[update.id] = { id: update.id };
                    }
                    
                    // Update fields
                    if (update.notify) sock.contacts[update.id].notify = update.notify;
                    if (update.name) sock.contacts[update.id].name = update.name;
                    if (update.status) sock.contacts[update.id].status = update.status;
                    if (update.imgUrl) sock.contacts[update.id].imgUrl = update.imgUrl;
                    
                    console.log(`Updated contact: ${update.id} (${update.name || update.notify || ''})`);
                }
                
                // Save contacts on updates
                saveContacts();
            });
            
            // Track chats for contact discovery
            sock.ev.on('chats.set', ({ chats }) => {
                console.log(`Got ${chats.length} chats`);
                // Extract contacts from chats
                for (const chat of chats) {
                    if (!chat.id.includes('@g.us') && chat.id !== 'status@broadcast') {
                        if (!sock.contacts[chat.id]) {
                            sock.contacts[chat.id] = { id: chat.id };
                        }
                        if (chat.name) sock.contacts[chat.id].name = chat.name;
                    }
                }
                
                // Save contacts when we get new chats
                saveContacts();
            });
            
            // Track new chats
            sock.ev.on('chats.upsert', (newChats) => {
                console.log(`Got ${newChats.length} new chats`);
                // Extract contacts from new chats
                for (const chat of newChats) {
                    if (!chat.id.includes('@g.us') && chat.id !== 'status@broadcast') {
                        if (!sock.contacts[chat.id]) {
                            sock.contacts[chat.id] = { id: chat.id };
                        }
                        if (chat.name) sock.contacts[chat.id].name = chat.name;
                    }
                }
                
                // Save contacts when we get new chats
                saveContacts();
            });
            
            // Listen for auth updates and save immediately
            sock.ev.on('creds.update', async (creds) => {
                await saveCreds();
                console.log('Credentials updated and saved');
            });
            
            // Listen for connection updates
            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (connection === 'close') {
                    // Determine the disconnect reason and proper action
                    const statusCode = lastDisconnect?.error?.output?.statusCode || 0;
                    const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
                    const errorName = lastDisconnect?.error?.name || 'Unknown';
                    
                    console.log(`Connection closed due to: ${errorName} (${statusCode}): ${errorMessage}`);
                    
                    // Check if we should reconnect based on the error type
                    let shouldReconnect = true;
                    let reconnectDelay = 5000; // Default 5 seconds
                    
                    // Handle specific error cases
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log('User logged out from another device. Bot will not reconnect.');
                        shouldReconnect = false;
                    } else if (statusCode === DisconnectReason.badSession) {
                        console.log('Bad session, clearing auth state and reconnecting...');
                        // Try to clear the session
                        try {
                            const credentialsFile = path.join(AUTH_FOLDER, 'creds.json');
                            if (fs.existsSync(credentialsFile)) {
                                fs.unlinkSync(credentialsFile);
                                console.log('Credentials file removed to force new login');
                            }
                        } catch (e) {
                            console.error('Error clearing credentials:', e);
                        }
                        reconnectDelay = 2000; // Faster reconnect for bad session
                    } else if (statusCode === DisconnectReason.connectionClosed) {
                        console.log('Connection closed unexpectedly, reconnecting...');
                        reconnectDelay = 3000;
                    } else if (statusCode === DisconnectReason.connectionLost) {
                        console.log('Connection lost, reconnecting quickly...');
                        reconnectDelay = 2000; // Quick reconnect for lost connection
                    } else if (statusCode === DisconnectReason.connectionReplaced) {
                        console.log('Connection replaced, may be running in multiple locations');
                        shouldReconnect = true;
                        reconnectDelay = 10000; // Longer delay to avoid conflicts
                    } else if (statusCode === DisconnectReason.timedOut) {
                        console.log('Connection timed out, reconnecting...');
                        reconnectDelay = 3000;
                    } else if (errorName === 'TypeError' && errorMessage.includes('Cannot read properties of undefined')) {
                        console.log('Connection error related to undefined properties, likely API issue. Reconnecting...');
                        reconnectDelay = 5000;
                    }
                    
                    // Save disconnected status
                    isConnected = false;
                    saveConnectionStatus('disconnected');
                    
                    if (shouldReconnect) {
                        // Check retry count for persistent failures
                        if (connectionRetryCount >= MAX_RETRY_COUNT) {
                            console.log(`Maximum retry attempts (${MAX_RETRY_COUNT}) reached. Waiting before trying again...`);
                            
                            // Wait for 5 minutes before trying again
                            setTimeout(() => {
                                console.log('Attempting to reconnect after waiting period...');
                                connectionRetryCount = 0;
                                connectToWhatsApp();
                            }, 5 * 60 * 1000);
                        } else {
                            console.log(`Attempting to reconnect in ${reconnectDelay/1000} seconds...`);
                            connectionRetryCount++;
                            setTimeout(connectToWhatsApp, reconnectDelay);
                        }
                    } else {
                        console.log('Connection closed permanently, no reconnection will be attempted.');
                    }
                } else if (connection === 'open') {
                    console.log('Connected to WhatsApp!');
                    isConnected = true;
                    connectionRetryCount = 0;
                    saveConnectionStatus('connected');
                    
                    // Set up periodic connection checks
                    if (connectionCheckTimer) {
                        clearInterval(connectionCheckTimer);
                    }
                    
                    connectionCheckTimer = setInterval(() => {
                        if (sock && isConnected) {
                            // Ping the connection using promises instead of async/await
                            sock.sendPresenceUpdate('available')
                                .catch(err => {
                                    console.log('Error in connection check:', err);
                                    // If we can't send a presence update, the connection might be dead
                                    if (isConnected) {
                                        console.log('Connection appears to be dead. Reconnecting...');
                                        isConnected = false;
                                        connectToWhatsApp();
                                    }
                                });
                        }
                    }, CONNECTION_CHECK_INTERVAL);
                    
                    // Save contacts after connection is established
                    saveContacts()
                        .then(() => {
                            // Start periodic contact updates
                            setInterval(() => {
                                if (isConnected && sock) {
                                    saveContacts()
                                        .catch(err => console.error('Error in periodic contact save:', err));
                                }
                            }, 5 * 60 * 1000);
                        })
                        .catch(err => {
                            console.error('Error in initial contact save:', err);
                        });
                    
                    // Load commands after connection is established
                    loadCommands();
                    
                    // Check for pending messages
                    checkPendingMessages();
                    // Set interval to check for pending messages
                    setInterval(() => {
                        if (isConnected && sock) {
                            checkPendingMessages()
                                .catch(err => console.error('Error checking pending messages:', err));
                        }
                    }, 10000);
                }
                
                // Handle pairing code when connection is still in connecting state
                if (USE_PAIRING_CODE && connection === 'connecting' && !isConnected) {
                    // If phone number not provided via environment variable, ask for it
                    if (!PAIRING_CODE_PHONE) {
                        requestPhoneNumber();
                    } else {
                        requestPairingCode(PAIRING_CODE_PHONE);
                    }
                }
                
                // QR code display and save for web interface
                if (qr && !USE_PAIRING_CODE) {
                    console.log('QR Code received, please scan with your phone:');
                    qrcode.generate(qr, { small: true });
                    
                    // Save QR code for web interface using promise chaining
                    saveQRCodeToFile(qr)
                        .catch(err => console.error('Error saving QR code:', err));
                }
            });
            
            // Add message handler - this is crucial for processing commands
            sock.ev.on('messages.upsert', async ({ messages }) => {
                console.log('New message received!');
                
                for (const message of messages) {
                    // Skip messages from yourself or status updates
                    if (!message.message || message.key.fromMe || message.key.remoteJid === 'status@broadcast') {
                        continue;
                    }
                    
                    // Update contacts from message
                    const senderJid = message.key.remoteJid;
                    if (!senderJid.includes('@g.us')) {
                        // Store or update contact
                        if (!sock.contacts[senderJid]) {
                            sock.contacts[senderJid] = { id: senderJid };
                        }
                        
                        // Try to get the name from the message
                        if (message.pushName) {
                            sock.contacts[senderJid].name = message.pushName;
                            console.log(`Added/updated contact from message: ${senderJid} (${message.pushName})`);
                            
                            // Update the name in our contacts.json
                            try {
                                if (fs.existsSync(path.join(AUTH_FOLDER, 'contacts.json'))) {
                                    const existingContacts = JSON.parse(fs.readFileSync(path.join(AUTH_FOLDER, 'contacts.json'), 'utf8'));
                                    let updated = false;
                                    
                                    for (const contact of existingContacts) {
                                        if (contact.jid === senderJid) {
                                            contact.name = message.pushName;
                                            updated = true;
                                            break;
                                        }
                                    }
                                    
                                    if (!updated) {
                                        existingContacts.push({
                                            jid: senderJid,
                                            name: message.pushName,
                                            lastMessageTime: Date.now(),
                                            unreadCount: 0,
                                            isContact: true
                                        });
                                    }
                                    
                                    fs.writeFileSync(path.join(AUTH_FOLDER, 'contacts.json'), JSON.stringify(existingContacts));
                                }
                            } catch (error) {
                                console.error('Error updating contact in contacts.json:', error);
                            }
                        }
                    }
                    
                    // Get the text message
                    const messageType = Object.keys(message.message)[0];
                    let messageText = '';
                    
                    if (messageType === 'conversation') {
                        messageText = message.message.conversation;
                    } else if (messageType === 'extendedTextMessage') {
                        messageText = message.message.extendedTextMessage.text;
                    } else {
                        // Skip non-text messages for simplicity
                        continue;
                    }
                    
                    console.log('Received message:', messageText);
                    
                    // Wrap all message handling in try/catch to prevent crashes
                    try {
                        // Legacy/default commands for contact refresh
                        if (messageText.toLowerCase() === 'refresh contacts' || messageText.toLowerCase() === 'update contacts') {
                            await sock.sendMessage(senderJid, { text: 'Refreshing contacts...' })
                                .catch(err => console.error('Error sending refresh contacts response:', err));
                            await fetchContactNames();
                            await sock.sendMessage(senderJid, { text: 'Contacts refreshed successfully!' })
                                .catch(err => console.error('Error sending contacts refresh success message:', err));
                            continue;
                        }
                        
                        // Admin command to restart bot - Use a specific command format to avoid accidental triggers
                        if (messageText.toLowerCase() === '!restart bot now!') {
                            await sock.sendMessage(senderJid, { text: '🔄 Bot restart initiated. I will be back shortly!' })
                                .catch(err => console.error('Error sending restart notification:', err));
                            console.log('Bot restart requested via WhatsApp command');
                            
                            // Give time for the message to be sent
                            setTimeout(() => {
                                // Save state and exit - The process manager or system service should restart the bot
                                saveConnectionStatus('restarting');
                                process.exit(0);
                            }, 2000);
                            continue;
                        }
                        
                        // Command handling using the command system
                        try {
                            const commands = commandLoader.loadCommands();
                            const command = commandLoader.findHandler(messageText, commands);
                            
                            if (command) {
                                console.log(`Executing command: ${command.name}`);
                                
                                // Set typing indicator (with error handling)
                                await sock.sendPresenceUpdate('composing', senderJid)
                                    .catch(err => console.error('Error setting typing indicator:', err));
                                
                                // Extract args if the command supports them
                                let args = null;
                                if (command.hasArgs) {
                                    args = command.getArgs(messageText);
                                }
                                
                                // Execute the command
                                const response = await command.execute({ 
                                    sock, 
                                    message, 
                                    senderJid, 
                                    messageText,
                                    args 
                                });
                                
                                // Send the response with error handling
                                if (response) {
                                    try {
                                        await sock.sendMessage(senderJid, { text: response });
                                    } catch (sendError) {
                                        console.error('Error sending command response:', sendError);
                                        // Try a simpler response as fallback
                                        try {
                                            await sock.sendMessage(senderJid, { 
                                                text: 'Command completed, but I had trouble sending the full response.'
                                            });
                                        } catch (fallbackError) {
                                            console.error('Even fallback response failed:', fallbackError);
                                        }
                                    }
                                }
                                
                                // Clear typing indicator (with error handling)
                                await sock.sendPresenceUpdate('paused', senderJid)
                                    .catch(err => console.error('Error clearing typing indicator:', err));
                                continue;
                            }
                            
                            // Legacy/default commands for backward compatibility
                            if (messageText.toLowerCase() === 'hi' || messageText.toLowerCase() === 'hello') {
                                await sock.sendMessage(senderJid, { text: 'Hello there! 👋 How can I help you today?' })
                                    .catch(err => console.error('Error sending greeting response:', err));
                            } else if (messageText.toLowerCase() === 'time') {
                                const now = new Date().toLocaleString();
                                await sock.sendMessage(senderJid, { text: `Current time is: ${now}` })
                                    .catch(err => console.error('Error sending time response:', err));
                            } else {
                                // Default response
                                await sock.sendMessage(senderJid, { 
                                    text: 'I received your message! To see available commands, type "help".'
                                }).catch(err => console.error('Error sending default response:', err));
                            }
                        } catch (commandError) {
                            console.error('Error processing command:', commandError);
                            // Try to send an error response, but don't crash if it fails
                            try {
                                await sock.sendMessage(senderJid, { 
                                    text: 'Sorry, there was an error processing your command. Please try again later.'
                                });
                            } catch (errorMsgError) {
                                console.error('Failed to send error message:', errorMsgError);
                            }
                        }
                    } catch (messageHandlingError) {
                        console.error('Critical error in message handling:', messageHandlingError);
                        // We catch the error at the top level to prevent the entire bot from crashing
                    }
                }
            });
        } catch (handlerError) {
            console.error('Error setting up event handlers:', handlerError);
            throw handlerError; // Re-throw to trigger the outer catch block
        }
    } catch (err) {
        console.error('Error in WhatsApp connection:', err);
        saveConnectionStatus('error');
        // Try to reconnect after error
        setTimeout(connectToWhatsApp, 10000);
    }
}

// Function to request phone number from user input
function requestPhoneNumber() {
    return new Promise((resolve) => {
        rl.question('Please enter your phone number in international format (e.g., 123456789 without "+" or country code): ', (phoneNumber) => {
            requestPairingCode(phoneNumber.trim()).then(resolve);
        });
    });
}

// Function to request a pairing code
async function requestPairingCode(phoneNumber) {
    try {
        if (!phoneNumber) {
            console.error('Phone number is required for pairing code authentication');
            return;
        }
        
        console.log(`Requesting pairing code for phone number: ${phoneNumber}`);
        // Format phone number with country code
        const formattedPhone = phoneNumber.includes('+') ? 
            phoneNumber : 
            `+${phoneNumber}`;
            
        // Request pairing code for the provided phone number
        const code = await sock.requestPairingCode(formattedPhone);
        console.log(`Your pairing code: ${code}`);
        console.log('Please enter this code in your WhatsApp app > Linked Devices > Link a Device');
        
        // Save pairing code for web interface
        savePairingCode(code, phoneNumber);
    } catch (error) {
        console.error('Failed to request pairing code:', error);
        // If it fails, maybe we can fall back to QR code
        console.log('Falling back to QR code authentication...');
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Bot shutting down gracefully...');
    saveConnectionStatus('disconnected');
    if (sock) {
        // Close the connection properly
        await sock.ev.removeAllListeners();
        console.log('WhatsApp connection closed properly');
    }
    rl.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Bot shutting down gracefully...');
    saveConnectionStatus('disconnected');
    if (sock) {
        // Close the connection properly
        await sock.ev.removeAllListeners();
        console.log('WhatsApp connection closed properly');
    }
    rl.close();
    process.exit(0);
});

// Start the bot
connectToWhatsApp().catch(err => {
    console.log('Fatal Error in WhatsApp connection: ', err);
    saveConnectionStatus('error');
    rl.close();
    process.exit(1);
});

// Initialize contacts quickly after startup
setTimeout(() => {
    if (isConnected && sock) {
        saveContacts()
            .catch(err => console.error('Error saving contacts after startup:', err));
    }
}, 15 * 1000); // First save after 15 seconds (instead of 10)

// Then adjust the periodic save interval to be less frequent
setInterval(() => {
    if (isConnected && sock) {
        saveContacts()
            .catch(err => console.error('Error in periodic contact save:', err));
    }
}, 30 * 60 * 1000); // Every 30 minutes (instead of 5 minutes)

// Check for messages to send frequently (every 5 seconds)
setInterval(() => {
    if (isConnected && sock) {
        checkPendingMessages()
            .catch(err => console.error('Error checking pending messages:', err));
    }
}, 5 * 1000); 