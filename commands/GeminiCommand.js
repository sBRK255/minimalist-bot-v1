const BaseCommand = require('./BaseCommand');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

// Initialize the Google Generative AI with API key from config
const API_KEY = config.gemini.apiKey;
const genAI = new GoogleGenerativeAI(API_KEY);

/**
 * Gemini command - Allows users to interact with Google's Gemini AI model
 */
class GeminiCommand extends BaseCommand {
    constructor() {
        super({
            name: 'gemini',
            aliases: ['ai', 'ask', 'chatgpt'],
            description: 'Ask Google\'s Gemini AI model a question',
            usage: 'gemini <your question or prompt>',
            category: 'AI'
        });
        
        // This command requires arguments
        this.hasArgs = true;
        
        // Initialize the Gemini Pro model
        this.model = genAI.getGenerativeModel({ 
            model: config.gemini.model,
            generationConfig: {
                maxOutputTokens: config.gemini.maxOutputTokens,
            }
        });
        
        // Store chat history for each user
        this.chatHistory = new Map();
    }

    /**
     * Executes the Gemini command
     * @param {Object} context - The context object
     * @returns {Promise<string>} - The AI's response message
     */
    async execute(context) {
        const { sock, senderJid, args } = context;
        
        // Check if there's a question/prompt
        if (!args || args.trim() === '') {
            return 'Please provide a question or prompt for Gemini AI.\nExample: gemini What is the capital of France?';
        }

        try {
            // Check if API key is set
            if (!API_KEY || API_KEY.includes('your') || API_KEY === 'AIzaSyAoapBGo5DThK8IwNgc11cLKY9jcEE_psU') {
                return '❌ API Key Error: The Gemini API key has not been properly configured.\n\nPlease update the API key in the config.js file with your actual Gemini API key.';
            }

            // Set typing indicator
            await sock.sendPresenceUpdate('composing', senderJid);
            
            // Get or create a chat session for this user
            if (!this.chatHistory.has(senderJid)) {
                this.chatHistory.set(senderJid, this.model.startChat({
                    history: [],
                    generationConfig: {
                        maxOutputTokens: config.gemini.maxOutputTokens,
                    },
                }));
            }
            
            const chat = this.chatHistory.get(senderJid);
            
            // Send the message to Gemini and get a response
            const result = await chat.sendMessage(args);
            const response = result.response;
            const text = response.text();
            
            // Set typing indicator to false
            await sock.sendPresenceUpdate('paused', senderJid);
            
            // Return the AI's response
            return text;
        } catch (error) {
            console.error('Error with Gemini AI:', error);
            
            // Provide more specific error messages based on status codes
            let errorMessage = 'Sorry, I encountered an error while processing your request.';
            
            if (error.status === 404) {
                errorMessage = '❌ API Error: The Gemini AI service endpoint was not found (404). This is likely due to an invalid or expired API key.';
                console.error('Invalid or expired Gemini API key. Please update the API key in config.js');
            } else if (error.status === 403) {
                errorMessage = '❌ API Error: Access forbidden (403). The API key may not have permission to access this service.';
            } else if (error.status === 429) {
                errorMessage = '❌ API Error: Rate limit exceeded (429). The bot has made too many requests to the Gemini API. Please try again later.';
            } else if (error.status >= 500) {
                errorMessage = '❌ API Error: Server error. There seems to be an issue with the Gemini AI service. Please try again later.';
            }
            
            // Set typing indicator to false
            await sock.sendPresenceUpdate('paused', senderJid);
            
            // Return a helpful error message
            return `${errorMessage}\n\nTo fix this issue, the bot admin needs to update the Gemini API key in the config.js file.`;
        }
    }
}

module.exports = GeminiCommand; 