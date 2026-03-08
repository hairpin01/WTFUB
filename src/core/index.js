const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs   = require('fs');
const ModuleLoader = require('../lib/loader/modules');

const LOG_LEVELS = {
    info:  '[INFO]',
    warn:  '[WARN]',
    error: '[ERROR]',
    debug: '[DEBUG]'
};

function log(level, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${LOG_LEVELS[level] || '[INFO]'}`, ...args);
}

class Userbot {
    constructor(options = {}) {
        this.prefix      = options.prefix      || '.';
        this.sessionPath = options.sessionPath  || './session';
        this.modulesPath = options.modulesPath  || './src/modules';
        this.systemPath  = options.systemPath   || './src/system';
        this.configDir   = options.configDir    || './config';

        this.client = null;

        // System modules — loaded from src/system/
        this.modules        = new Map();
        // User modules — loaded from src/modules/
        this.modules_loaded = new Map();

        this.moduleLoader = new ModuleLoader(this, this.configDir);
        this.commands     = new Map();

        // { name, version, description, system } per every module
        this.moduleMeta          = new Map();
        // commandName -> description string
        this.commandDescriptions = new Map();

        this._initClient();
    }

    _initClient() {
        const puppeteerOptions = {
            headless: process.env.HEADLESS !== 'false',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        };

        if (process.env.HTTP_PROXY) {
            puppeteerOptions.proxyUrl = process.env.HTTP_PROXY;
        }

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: this.sessionPath }),
                                 puppeteer: puppeteerOptions
        });

        this.client.on('qr', (qr) => {
            log('info', 'QR Code received. Scan with WhatsApp:');
            const QRCode = require('qrcode-terminal');
            QRCode.generate(qr, { small: true });
        });

        this.client.on('message',        (msg)  => this._handleMessage(msg));
        this.client.on('message_create', (msg)  => this._handleMessage(msg));
        this.client.on('message_create', (msg)  => log('debug', 'Message created:', msg.body));
        this.client.on('incoming_call',  (call) => log('info', 'Incoming call:', call));

        this.client.on('authenticated',  ()       => log('info', 'Authentication successful'));
        this.client.on('auth_failure',   (msg)    => log('error', 'Authentication failed:', msg));
        this.client.on('ready',          ()       => log('info', 'Bot is ready'));
        this.client.on('disconnected',   (reason) => log('warn', 'Client disconnected:', reason));
        this.client.on('change_state',   (state)  => log('debug', 'State changed:', state));
        this.client.on('loading_screen', (p, m)   => log('info', `Loading: ${p}% - ${m}`));
    }

    async _handleMessage(msg) {
        log('debug', `Message received: ${msg.body} from ${msg.from}`);

        if (!msg.body.startsWith(this.prefix)) return;

        const args        = msg.body.slice(this.prefix.length).trim().split(/\s+/);
        const commandName = args.shift().toLowerCase();

        log('debug', `Command: ${commandName}, args: ${args}`);
        log('debug', `Available commands:`, Array.from(this.commands.keys()));

        const command = this.commands.get(commandName);
        if (command) {
            try {
                if (typeof command.execute === 'function') {
                    await command.execute(msg, args, this);
                } else {
                    await command(msg, args, this);
                }
                log('info', `Executed command: ${commandName}`);
            } catch (error) {
                log('error', `Command error: ${commandName}`, error);
                msg.reply('An error occurred while executing the command');
            }
        } else {
            log('warn', `Command not found: ${commandName}`);
        }
    }

    async start() {
        try {
            log('info', 'Starting bot...');
            await this.loadSystemModules();
            await this.loadModules();
            log('info', 'Initializing client...');

            this.client.on('failure', (error) => {
                log('error', 'Client failure:', error.message);
            });

            await this.client.initialize();
            log('info', 'Client initialized successfully');
        } catch (error) {
            log('error', 'Failed to start bot:', error.message);
            throw error;
        }
    }

    async stop() {
        if (this.client) {
            await this.client.destroy();
        }
    }

    async loadSystemModules() {
        const loaded = await this.moduleLoader.loadAll(this.systemPath);
        for (const [name, module] of loaded) {
            this._registerModule(name, module, true);
        }
        log('info', `Loaded ${loaded.size} system module(s)`);
    }

    async loadModules() {
        const loaded = await this.moduleLoader.loadAll(this.modulesPath);
        for (const [name, module] of loaded) {
            this._registerModule(name, module, false);
        }
        log('info', `Loaded ${loaded.size} user module(s)`);
    }

    async loadModule(modulePath) {
        const loaded = await this.moduleLoader.loadOne(modulePath);
        if (loaded) {
            this._registerModule(loaded.name, loaded.module, false);
            log('info', `Module loaded: ${loaded.name}`);
            return loaded.module;
        }
        return null;
    }

    /**
     * Module shape:
     *   module.name        {string}
     *   module.version     {string}
     *   module.description {string}
     *   module.commands    {object}  — { cmdName: fn | { execute, description } }
     *   module._cfg        {Config}  — attached by ModuleLoader automatically
     */
    _registerModule(name, module, isSystem = false) {
        if (isSystem) {
            this.modules.set(name, module);
        } else {
            this.modules_loaded.set(name, module);
        }

        this.moduleMeta.set(name, {
            name,
            version:     module.version     || '1.0.0',
            description: module.description || 'No description provided',
            system:      isSystem
        });

        if (module.commands) {
            for (const [cmdName, cmdHandler] of Object.entries(module.commands)) {
                const key = cmdName.toLowerCase();

                if (typeof cmdHandler === 'object' && typeof cmdHandler.execute === 'function') {
                    this.commands.set(key, cmdHandler);
                    if (cmdHandler.description) {
                        this.commandDescriptions.set(key, cmdHandler.description);
                    }
                } else {
                    this.commands.set(key, cmdHandler);
                }
            }
        }
    }

    async unloadModule(moduleName) {
        const meta  = this.moduleMeta.get(moduleName);
        const store = meta?.system ? this.modules : this.modules_loaded;
        const module = store.get(moduleName);

        if (module) {
            if (module.commands) {
                for (const cmdName of Object.keys(module.commands)) {
                    const key = cmdName.toLowerCase();
                    this.commands.delete(key);
                    this.commandDescriptions.delete(key);
                }
            }
            store.delete(moduleName);
            this.moduleMeta.delete(moduleName);
            log('info', `Module unloaded: ${moduleName}`);
            return true;
        }
        return false;
    }

    getModule(name) {
        return this.modules.get(name) ?? this.modules_loaded.get(name) ?? null;
    }

    getModuleMeta(name) {
        return this.moduleMeta.get(name) || null;
    }

    getCommand(name) {
        return this.commands.get(name.toLowerCase());
    }

    getCommandDescription(name) {
        return this.commandDescriptions.get(name.toLowerCase()) || null;
    }

    /**
     * Returns the Config instance for a module.
     * Useful inside commands: const cfg = bot.getCfg('settings')
     * @param {string} moduleName
     * @returns {Config|null}
     */
    getCfg(moduleName) {
        const module = this.getModule(moduleName);
        return module?._cfg ?? null;
    }
}

module.exports = Userbot;
