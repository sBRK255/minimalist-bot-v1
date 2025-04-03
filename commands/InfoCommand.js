const BaseCommand = require('./BaseCommand');
const os = require('os');
const config = require('../config');

/**
 * Info command - Displays information about the bot
 */
class InfoCommand extends BaseCommand {
    constructor() {
        super({
            name: 'info',
            aliases: ['about', 'bot'],
            description: 'Shows information about the bot',
            usage: 'info',
            category: 'Utility'
        });
    }

    /**
     * Executes the info command
     * @param {Object} context - The context object
     * @returns {Promise<string>} - The info message
     */
    async execute(context) {
        const uptime = this.formatUptime(process.uptime());
        const memory = this.formatMemory(process.memoryUsage().heapUsed);
        const hostname = os.hostname();
        const platform = `${os.type()} ${os.arch()}`;
        const nodeVersion = process.version;
        
        let infoMessage = `*🤖 ${config.bot.name}*\n\n`;
        infoMessage += `*Version:* ${config.bot.version}\n`;
        infoMessage += `*Author:* ${config.bot.author}\n`;
        infoMessage += `*Uptime:* ${uptime}\n`;
        infoMessage += `*Memory Usage:* ${memory}\n`;
        infoMessage += `*Platform:* ${platform}\n`;
        infoMessage += `*Node Version:* ${nodeVersion}\n`;
        infoMessage += `*Hostname:* ${hostname}\n\n`;
        infoMessage += `_Made with ❤️ using @whiskeysockets/baileys_\n`;
        infoMessage += `_Repository: ${config.bot.repository}_`;
        
        return infoMessage;
    }

    /**
     * Formats uptime into a human-readable string
     * @param {number} seconds - Uptime in seconds
     * @returns {string} - Formatted uptime
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / (3600 * 24));
        const hours = Math.floor((seconds % (3600 * 24)) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        const parts = [];
        
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
        
        return parts.join(' ');
    }

    /**
     * Formats memory usage into a human-readable string
     * @param {number} bytes - Memory usage in bytes
     * @returns {string} - Formatted memory usage
     */
    formatMemory(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
        if (i === 0) return `${bytes} ${sizes[i]}`;
        return `${(bytes / (1024 ** i)).toFixed(2)} ${sizes[i]}`;
    }
}

module.exports = InfoCommand; 