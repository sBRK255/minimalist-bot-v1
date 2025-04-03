const BaseCommand = require('./BaseCommand');
const fs = require('fs');
const path = require('path');

const AUTH_FOLDER = './auth';

class FetchContactsCommand extends BaseCommand {
    constructor() {
        super();
        this.name = 'contacts';
        this.aliases = ['fetchcontacts', 'refreshcontacts', 'updatecontacts', 'refresh contacts'];
        this.description = 'Fetch and update all WhatsApp contacts with their names';
        this.usage = 'contacts';
        this.category = 'Utility';
        this.hasArgs = false;
    }

    async execute({ sock, senderJid }) {
        await sock.sendPresenceUpdate('composing', senderJid);
        
        try {
            // Load existing contacts first
            let contacts = [];
            if (fs.existsSync(path.join(AUTH_FOLDER, 'contacts.json'))) {
                contacts = JSON.parse(fs.readFileSync(path.join(AUTH_FOLDER, 'contacts.json'), 'utf8'));
            }
            
            // Create a map for quick lookup
            const contactMap = new Map();
            contacts.forEach(contact => contactMap.set(contact.jid, contact));
            
            // Track how many are updated
            let updated = 0;
            let added = 0;
            let successfulMethod = '';
            let contactsFound = 0;
            
            // Try multiple methods to get contacts
            
            // Method 1: Using the query API
            try {
                const contactsResult = await sock.query({
                    json: ['query', 'ContactsArray'],
                    requiresPhoneConnection: false,
                });
                
                if (contactsResult && Array.isArray(contactsResult) && contactsResult.length > 0) {
                    // Process contacts from this method
                    successfulMethod = 'WhatsApp Query API';
                    contactsFound = contactsResult.length;
                    
                    for (const contact of contactsResult) {
                        if (contact.jid === 'status@broadcast') continue;
                        
                        // Format JID if needed
                        let jid = contact.jid;
                        if (!jid.includes('@')) {
                            jid = `${jid}@s.whatsapp.net`;
                        }
                        
                        this._updateContactInMap(contactMap, jid, contact, added, updated);
                    }
                }
            } catch (error) {
                console.log('Method 1 (Query API) failed:', error.message);
            }
            
            // Method 2: Try to use sock.store
            if (!successfulMethod && sock.store) {
                try {
                    const contacts = sock.store.contacts;
                    if (contacts && Object.keys(contacts).length > 0) {
                        successfulMethod = 'Store Contacts';
                        contactsFound = Object.keys(contacts).length;
                        
                        Object.entries(contacts).forEach(([jid, contact]) => {
                            if (jid === 'status@broadcast') return;
                            
                            this._updateContactInMap(contactMap, jid, contact, added, updated);
                        });
                    }
                } catch (error) {
                    console.log('Method 2 (Store) failed:', error.message);
                }
            }
            
            // Method 3: Try direct contacts
            if (!successfulMethod && sock.contacts) {
                try {
                    const directContacts = Object.entries(sock.contacts);
                    if (directContacts && directContacts.length > 0) {
                        successfulMethod = 'Direct Contacts';
                        contactsFound = directContacts.length;
                        
                        directContacts.forEach(([jid, contact]) => {
                            if (jid === 'status@broadcast') return;
                            
                            this._updateContactInMap(contactMap, jid, contact, added, updated);
                        });
                    }
                } catch (error) {
                    console.log('Method 3 (Direct) failed:', error.message);
                }
            }
            
            // Method 4: Try groups
            if (!successfulMethod && sock.groupFetchAllParticipating) {
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    if (groups && Object.keys(groups).length > 0) {
                        successfulMethod = 'Group Participants';
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
                            contactsFound = participants.length;
                            
                            participants.forEach(contact => {
                                if (!contact.jid || contact.jid === 'status@broadcast') return;
                                
                                this._updateContactInMap(contactMap, contact.jid, contact, added, updated);
                            });
                        }
                    }
                } catch (error) {
                    console.log('Method 4 (Groups) failed:', error.message);
                }
            }
            
            // Method 5: Try to extract from session files if all else fails
            if (!successfulMethod) {
                try {
                    const sessionFiles = fs.readdirSync(AUTH_FOLDER)
                        .filter(file => file.endsWith('.json') && !['creds.json', 'contacts.json', 'send_message.json', 'instance.lock'].includes(file));
                    
                    if (sessionFiles.length > 0) {
                        successfulMethod = 'Session Files';
                        contactsFound = sessionFiles.length;
                        
                        const processedJids = new Set();
                        
                        for (const file of sessionFiles) {
                            try {
                                // Extract JID from filename
                                let jid = file.split('.')[0];
                                
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
                                
                                // Skip groups and already processed JIDs
                                if (jid.includes('@g.us') || processedJids.has(jid)) continue;
                                processedJids.add(jid);
                                
                                // Try to get contact name from session file
                                try {
                                    const sessionData = JSON.parse(fs.readFileSync(path.join(AUTH_FOLDER, file), 'utf8'));
                                    
                                    const contact = {
                                        jid: jid,
                                        name: sessionData.name || sessionData.notify || '',
                                    };
                                    
                                    this._updateContactInMap(contactMap, jid, contact, added, updated);
                                } catch (e) {
                                    // Ignore errors reading session files
                                }
                            } catch (fileError) {
                                // Skip error processing this file
                            }
                        }
                    }
                } catch (error) {
                    console.log('Method 5 (Session Files) failed:', error.message);
                }
            }
            
            // Convert map back to array
            const updatedContacts = Array.from(contactMap.values());
            
            // Save updated contacts
            fs.writeFileSync(path.join(AUTH_FOLDER, 'contacts.json'), JSON.stringify(updatedContacts));
            
            if (successfulMethod) {
                return `✅ Contacts updated successfully!\n\n📊 Stats:\n- Method: ${successfulMethod}\n- Total contacts: ${updatedContacts.length}\n- Found: ${contactsFound}\n- Added: ${added}\n- Updated: ${updated}`;
            } else {
                return '⚠️ Contacts were updated with limited information. WhatsApp API limitations prevented retrieving all contact details.';
            }
        } catch (error) {
            console.error('Error in FetchContactsCommand:', error);
            return '❌ Error fetching contacts: ' + (error.message || 'Unknown error');
        }
    }
    
    // Helper method to update a contact in the map
    _updateContactInMap(contactMap, jid, contact, added, updated) {
        // Get or create contact
        let existingContact = contactMap.get(jid);
        const isNew = !existingContact;
        
        if (!existingContact) {
            existingContact = {
                jid: jid,
                name: '',
                lastMessageTime: 0,
                unreadCount: 0,
                isContact: true
            };
            contactMap.set(jid, existingContact);
            added++;
        }
        
        // Check if name will be updated
        const oldName = existingContact.name;
        
        // Update contact info (prioritize keeping real names)
        if (contact.name && contact.name.trim() !== '') {
            existingContact.name = contact.name;
        } else if (contact.notify && contact.notify.trim() !== '') {
            existingContact.name = contact.notify;
        } else if (contact.vname && contact.vname.trim() !== '') {
            existingContact.name = contact.vname;
        } else if (contact.short && contact.short.trim() !== '') {
            existingContact.name = contact.short;
        }
        
        // Count as updated if name changed
        if (!isNew && oldName !== existingContact.name) {
            updated++;
        }
        
        // Add phone number if no name available
        if (!existingContact.name || existingContact.name.trim() === '') {
            const phoneNumber = jid.split('@')[0];
            // Format nicely as a phone number
            if (/^\d+$/.test(phoneNumber)) {
                if (phoneNumber.length > 10) {
                    // International format with spacing
                    const countryCode = phoneNumber.substring(0, phoneNumber.length - 10);
                    const rest = phoneNumber.substring(phoneNumber.length - 10);
                    existingContact.name = `+${countryCode} ${rest.substring(0, 3)} ${rest.substring(3, 6)} ${rest.substring(6)}`;
                } else {
                    // Local format
                    existingContact.name = `+${phoneNumber}`;
                }
            } else {
                existingContact.name = phoneNumber;
            }
        }
        
        // Return updated counters
        return { added, updated };
    }
}

module.exports = FetchContactsCommand; 