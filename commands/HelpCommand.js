const BaseCommand = require('./BaseCommand');
const commandLoader = require('./CommandLoader');

/**
 * Help command - Displays information about available commands
 */
class HelpCommand extends BaseCommand {
    constructor() {
        super({
            name: 'help',
            aliases: ['commands', 'menu'],
            description: 'Shows available commands or info about a specific command',
            usage: 'help [command name]',
            category: 'Utility'
        });
        
        // This command optionally accepts arguments
        this.hasArgs = true;
    }

    /**
     * Executes the help command
     * @param {Object} context - The context object
     * @returns {Promise<string>} - The help message
     */
    async execute(context) {
        const { args } = context;
        const commands = commandLoader.getCommands();
        
        // If a specific command was requested
        if (args && args.trim() !== '') {
            const requestedCmd = args.toLowerCase().trim();
            const command = commands.get(requestedCmd);
            
            if (command) {
                return this.formatCommandHelp(command);
            }
            
            // Check if it's an alias
            for (const [, cmd] of commands) {
                if (cmd.aliases.includes(requestedCmd)) {
                    return this.formatCommandHelp(cmd);
                }
            }
            
            return `❌ Command "${requestedCmd}" not found. Try "help" to see all available commands.`;
        }
        
        // Otherwise, show all commands grouped by category
        return this.formatAllCommands(commands);
    }

    /**
     * Formats detailed help for a specific command
     * @param {Object} command - The command object
     * @returns {string} - Formatted help text
     */
    formatCommandHelp(command) {
        let help = `*📌 Command: ${command.name}*\n\n`;
        help += `*Description:* ${command.description}\n`;
        
        if (command.aliases.length > 0) {
            help += `*Aliases:* ${command.aliases.join(', ')}\n`;
        }
        
        help += `*Usage:* ${command.usage}\n`;
        help += `*Category:* ${command.category}`;
        
        return help;
    }

    /**
     * Formats help for all commands, grouped by category
     * @param {Map<string, Object>} commands - Map of command name to command object
     * @returns {string} - Formatted help text
     */
    formatAllCommands(commands) {
        // Group commands by category
        const categories = new Map();
        
        for (const [, command] of commands) {
            if (!command.enabled) continue;
            
            if (!categories.has(command.category)) {
                categories.set(command.category, []);
            }
            
            categories.get(command.category).push(command);
        }
        
        // Build the help message
        let help = `*📚 Available Commands*\n\n`;
        
        for (const [category, cmds] of categories) {
            help += `*${category}*\n`;
            
            for (const cmd of cmds) {
                help += `• *${cmd.name}*: ${cmd.description}\n`;
            }
            
            help += '\n';
        }
        
        help += '_Use "help <command>" for more details about a specific command._';
        
        return help;
    }
}

module.exports = HelpCommand; 