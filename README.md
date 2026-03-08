# WTPUB
| [RU](https://github.com/hairpin01/WTFUB/blob/main/README-ru.md) |

WhatsApp Userbot for Node.js with modular command system.

## Features

- Modular command system
- System modules (src/system/)
- User modules (src/modules/)
- JSON configuration
- Logging
- QR-code authentication

## Installation

```bash
npm install
```

## Usage

```bash
node index.js
```

On first run, a QR code will appear for WhatsApp authentication.

## Configuration

Settings in `config/settings.json`:

- `prefix` - command prefix (default `.`)
- `sessionPath` - session path
- `modulesPath` - modules path

### Basic Commands

- `.man` - List all loaded modules
- `.man <module>` - Show commands of a specific module

## Commands

Commands are invoked via prefix, e.g.: `.command`

### Creating a Module

```javascript
module.exports = {
    name: 'mymodule',
    version: '1.0.0',
    description: 'My module',
    commands: {
        hello: {
            description: 'Greeting',
            execute: async (msg, args, bot) => {
                await msg.reply('Hello!');
            }
        }
    }
};
```

## Project Structure

```
├── index.js          # Entry point
├── config/          # Configuration
├── src/
│   ├── core/        # Bot core
│   ├── modules/    # User modules
│   ├── system/     # System modules
│   └── lib/        # Utilities
└── session/         # WhatsApp session
```

## Dependencies

- whatsapp-web.js
- qrcode-terminal
