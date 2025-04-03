/**
 * Base Command class that all command implementations should extend
 */
class BaseCommand {
    /**
     * Creates a new command instance
     * @param {Object} options - Command configuration options
     * @param {string} options.name - The name of the command
     * @param {string[]} options.aliases - Alternative command names
     * @param {string} options.description - Short description of what the command does
     * @param {string} options.usage - How to use the command
     * @param {string} options.category - Category the command belongs to
     */
    constructor(options = {}) {
        this.name = options.name || '';
        this.aliases = options.aliases || [];
        this.description = options.description || 'No description provided';
        this.usage = options.usage || 'No usage information';
        this.category = options.category || 'General';
        this.enabled = true;
    }

    /**
     * Checks if a message should trigger this command
     * @param {string} message - The message text to check
     * @returns {boolean} - Whether the message should trigger this command
     */
    shouldHandle(message) {
        const lowerMessage = message.toLowerCase().trim();
        
        // Check if message starts with command name or aliases
        if (lowerMessage === this.name.toLowerCase()) {
            return true;
        }
        
        for (const alias of this.aliases) {
            if (lowerMessage === alias.toLowerCase()) {
                return true;
            }
        }
        
        // For commands that support arguments, check if the message starts with the command
        if (this.hasArgs) {
            if (lowerMessage.startsWith(`${this.name.toLowerCase()} `)) {
                return true;
            }
            
            for (const alias of this.aliases) {
                if (lowerMessage.startsWith(`${alias.toLowerCase()} `)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Gets the arguments from a message
     * @param {string} message - The message text
     * @returns {string|null} - The arguments portion of the message, or null if no args
     */
    getArgs(message) {
        const lowerMessage = message.toLowerCase().trim();
        
        // Check for args with main command name
        if (lowerMessage.startsWith(`${this.name.toLowerCase()} `)) {
            return message.trim().substring(this.name.length).trim();
        }
        
        // Check for args with aliases
        for (const alias of this.aliases) {
            if (lowerMessage.startsWith(`${alias.toLowerCase()} `)) {
                return message.trim().substring(alias.length).trim();
            }
        }
        
        return null;
    }

    /**
     * Executes the command
     * @param {Object} context - The context object
     * @param {Object} context.sock - The WhatsApp socket connection
     * @param {Object} context.message - The message object
     * @param {string} context.senderJid - The sender's JID
     * @param {string} context.messageText - The message text
     * @param {string|null} context.args - Arguments passed to the command
     * @returns {Promise<string>} - The response message to send
     */
    async execute(context) {
        // This should be implemented by subclasses
        throw new Error('Command execute method must be implemented');
    }
}

module.exports = BaseCommand; 