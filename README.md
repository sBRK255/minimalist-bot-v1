# minimalist-bot-v1

A minimalist WhatsApp chatbot built with Node.js and @whiskeysockets/baileys.

## Features

- Easy to set up and deploy
- Responds to basic commands
- Maintains authentication sessions
- Simple to extend with custom commands
- Comes with a beautiful landing page
- Graceful connection handling for smooth restarts
- Multiple authentication options (QR code or pairing code)
- Web-based connection management panel

## Prerequisites

- Node.js (v14 or higher recommended)
- npm (Node Package Manager)
- A smartphone with WhatsApp installed

## Installation

1. Clone this repository
```bash
git clone https://github.com/sBRK255/minimalist-bot-v1.git
cd minimalist-bot-v1
```

2. Install dependencies:
```bash
npm install
```

## Usage

### Starting the Bot

Start with default QR code authentication:
```bash
npm start
```
or
```bash
node index.js
```

Start with pairing code authentication:
```bash
node index.js --pairing-code
```
or set environment variable:
```bash
# On Linux/Mac
export USE_PAIRING_CODE=true
npm start

# On Windows PowerShell
$env:USE_PAIRING_CODE="true"
npm start
```

You can also provide phone number via environment variable:
```bash
# On Linux/Mac
export USE_PAIRING_CODE=true
export PAIRING_CODE_PHONE="123456789"
npm start

# On Windows PowerShell
$env:USE_PAIRING_CODE="true"
$env:PAIRING_CODE_PHONE="123456789"
npm start
```

### Authentication Methods

#### QR Code Authentication (Default)
1. When you run the bot, it will generate a QR code in the terminal
2. Scan this QR code with your WhatsApp app (WhatsApp Web pairing)
3. After successful authentication, the bot will log "Connected to WhatsApp!"

#### Pairing Code Authentication
1. Start the bot with the `--pairing-code` flag
2. You will be prompted to enter your phone number (or it will use the one from environment variable)
3. The bot will display a pairing code
4. On your phone, go to WhatsApp > Settings > Linked Devices > Link a Device
5. Enter the pairing code when prompted

### Web-based Connection Panel

The project includes a web-based connection management panel that allows you to:

1. Connect to WhatsApp using QR code or pairing code directly from your browser
2. View connection status in real-time
3. Disconnect the bot when needed
4. View connection logs

To access the panel:

1. Start the web server:
```bash
npm run web
```

2. Visit http://localhost:3000/connect in your browser
3. Use the interface to manage your WhatsApp connection

You can also run both the bot and web server simultaneously:

```bash
npm run dev
```

### Smooth Reconnection

This bot implements advanced connection handling to ensure:

- You don't need to scan QR codes after each restart
- Graceful shutdown preserves connection state
- Automatic reconnection attempts if connection is lost
- Proper authentication state management 

The bot saves your session in the `./auth` directory and implements proper connection management to maintain your WhatsApp session even when restarting the bot.

## Web Server

You can also run the included web server to showcase your bot:

```bash
npm run web
```

Or run both the bot and web server simultaneously:

```bash
npm run dev
```

## Landing Page

The project includes a simple yet elegant landing page built with Bootstrap. To view it:
1. Open the `index.html` file in your browser
2. Or deploy it to a web hosting service to showcase your bot
3. If running the web server, visit http://localhost:3000

The landing page features:
- Status indicator showing the bot is live
- Key features of the bot
- Repository information
- Credits section
- Link to the connection management panel

## Available Commands

The bot now includes the following commands:

- `hi` or `hello` - Bot responds with a greeting
- `help` - Shows available commands and their descriptions
- `info` - Shows information about the bot
- `time` - Shows current time
- `gemini <question>` - Ask Google's Gemini AI a question
  - Aliases: `ai`, `ask`, `chatgpt`
  - Example: `gemini What is the capital of France?`

## Command System

This bot uses a modular command system that makes it easy to add, remove, or modify commands:

1. **BaseCommand** - All commands extend this base class
2. **CommandLoader** - Automatically loads and manages commands
3. **Modular Structure** - Each command is in its own file

### Adding a New Command

To create a new command:

1. Create a new file in the `commands` folder (e.g., `MyCommand.js`)
2. Extend the `BaseCommand` class
3. Implement the `execute` method

Example:
```javascript
const BaseCommand = require('./BaseCommand');

class MyCommand extends BaseCommand {
    constructor() {
        super({
            name: 'mycommand',
            aliases: ['mc', 'mycmd'],
            description: 'My custom command',
            usage: 'mycommand [args]',
            category: 'Custom'
        });
        
        // If your command accepts arguments
        this.hasArgs = true;
    }

    async execute(context) {
        const { sock, senderJid, args } = context;
        
        // Your command logic here
        return 'This is my custom command response!';
    }
}

module.exports = MyCommand;
```

## Gemini AI Integration

The bot integrates with Google's Gemini AI to provide intelligent responses to user queries. This feature allows users to ask questions or have conversations with the AI directly through WhatsApp.

### Setting Up Gemini API

To use the Gemini AI feature, you need to:

1. Get a Gemini API key from Google AI Studio:
   - Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create an account or sign in
   - Create a new API key

2. Configure your API key:
   - Open the `config.js` file in the project root
   - Replace the placeholder API key with your actual API key:
   ```javascript
   gemini: {
       apiKey: 'YOUR_ACTUAL_API_KEY_HERE',
       model: 'gemini-pro',
       maxOutputTokens: 1000
   }
   ```

### How to Use Gemini

Send a message with the command `gemini` followed by your question:

```
gemini What is the theory of relativity?
```

You can also use aliases: `ai`, `ask`, or `chatgpt`:

```
ask What will the weather be like tomorrow?
```

### Features

- Maintains conversation context for each user
- Shows typing indicator while generating responses
- Informative error messages if something goes wrong
- Maximum output token limit to prevent excessively long messages

The AI uses the Gemini Pro model to generate high-quality, informative responses.

## How It Works

The bot uses the @whiskeysockets/baileys library to connect to WhatsApp's web API. When messages come in, it processes them according to simple rules and responds accordingly.

Connection management improvements:
- Uses proper authentication state persistence
- Handles graceful shutdown on SIGINT and SIGTERM
- Implements reconnection attempts with delay
- Provides detailed connection status logging
- Supports both QR code and pairing code authentication
- Web-based connection management with real-time status updates

## Troubleshooting

### Gemini AI Command Not Working

If you encounter a 404 error with the Gemini AI command, follow these steps:

1. Check your API key:
   - Make sure you've replaced the placeholder API key in `config.js` with your actual Gemini API key
   - Verify that your API key is active and valid in the Google AI Studio dashboard

2. Connection issues:
   - Ensure your bot has internet access to reach the Gemini API servers
   - Check if there are any regional restrictions for your location

3. Rate limiting:
   - If you see a 429 error, you've exceeded the rate limits
   - Wait a while before trying again or upgrade your API plan

### WhatsApp Connection Issues

If you're having trouble connecting to WhatsApp:

1. Authentication problems:
   - Delete the `auth` folder and try reconnecting
   - Try using the pairing code method instead of QR code or vice versa

2. Network issues:
   - Check your internet connection
   - Ensure WhatsApp services are not blocked on your network

3. Session expired:
   - If your session expires frequently, check if another instance is using the same credentials
   - Try keeping the bot running continuously to maintain the session

## Extending the Bot

To add new commands, edit the message handling logic in the `index.js` file. Look for the section with comment `// Simple response logic` and add your own conditions and responses.

Example:
```javascript
// Add this to the existing if-else chain
else if (messageText.toLowerCase() === 'weather') {
    await sock.sendMessage(senderJid, { text: 'The weather today is sunny!' });
}
```

## Authentication

The bot will save your authentication credentials in the `./auth` directory. This means you only need to authenticate once. Subsequent runs will use the saved credentials.

Choose the authentication method that works best for your use case:
- QR code is simpler but requires camera access
- Pairing code is useful for servers without displays or when QR scanning is not feasible
- Web-based connection is ideal for remote management

## Credits

Developed with ❤️ by **sirtheprogrammer**

## Repository

This project is hosted on GitHub: [https://github.com/sBRK255/minimalist-bot-v1](https://github.com/sBRK255/minimalist-bot-v1)

## Notes

- This is a simple implementation for educational purposes
- Respect WhatsApp's terms of service when using this bot
- Avoid spamming or using the bot for unauthorized purposes 