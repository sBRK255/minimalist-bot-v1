/**
 * Configuration file for the WhatsApp bot
 * Contains API keys and other settings
 */

module.exports = {
    // Gemini AI configuration
    gemini: {
        // Replace with your actual Gemini API key
        apiKey: 'AIzaSyDwsSu3DsBS-UVjGL9q8pXEj6-RAoAnIjc',
        model: 'gemini-2.0-flash',
        maxOutputTokens: 1000
    },
    
    // Bot configuration
    bot: {
        name: 'Minimalist WhatsApp Bot',
        version: '1.0.0',
        author: 'sirtheprogrammer',
        repository: 'https://github.com/sBRK255/minimalist-bot-v1'
    },
    
    // Commands configuration
    commands: {
        prefix: '', // No prefix by default, commands are detected by name
        enableLegacyCommands: true // Keep supporting old 'hi', 'hello', etc. commands
    }
}; 