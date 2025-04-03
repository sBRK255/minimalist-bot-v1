const fs = require('fs');
const path = require('path');

/**
 * Loads all command modules from the commands directory
 */
class CommandLoader {
    constructor() {
        this.commands = new Map();
    }

    /**
     * Loads all command modules from the commands directory
     * @returns {Map<string, Object>} - Map of command name to command instance
     */
    loadCommands() {
        const commandsDir = path.join(__dirname);
        const commandFiles = fs.readdirSync(commandsDir)
            .filter(file => 
                file.endsWith('.js') && 
                !file.startsWith('BaseCommand') && 
                !file.startsWith('CommandLoader') &&
                !file.startsWith('index')
            );

        for (const file of commandFiles) {
            try {
                const commandPath = path.join(commandsDir, file);
                // Clear cache to ensure changes are loaded
                delete require.cache[require.resolve(commandPath)];
                
                const CommandClass = require(commandPath);
                const command = new CommandClass();
                
                if (command.name) {
                    this.commands.set(command.name.toLowerCase(), command);
                    console.log(`Loaded command: ${command.name}`);
                } else {
                    console.warn(`Command file ${file} has no name property and was not loaded.`);
                }
            } catch (error) {
                console.error(`Error loading command from ${file}:`, error);
            }
        }

        return this.commands;
    }

    /**
     * Finds a command that should handle the given message
     * @param {string} message - The message text to find a handler for
     * @returns {Object|null} - The command instance, or null if no handler found
     */
    findHandler(message) {
        for (const [_, command] of this.commands) {
            if (command.enabled && command.shouldHandle(message)) {
                return command;
            }
        }
        return null;
    }

    /**
     * Gets all commands
     * @returns {Map<string, Object>} - Map of command name to command instance
     */
    getCommands() {
        return this.commands;
    }
}

module.exports = new CommandLoader(); 