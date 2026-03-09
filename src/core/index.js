'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode                = require('qrcode-terminal');
const path                  = require('path');
const fs                    = require('fs');
const ModuleLoader          = require('../lib/loader/modules');

// logger level
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

const DEFAULT_COOLDOWN_MS      = 1000;   // ms between commands per user
const RECONNECT_DELAY_MS       = 5000;   // ms before reconnect attempt
const MAX_RECONNECT_ATTEMPTS   = 5;

class Userbot {
    /**
     * @param {object}   options
     * @param {string}   [options.prefix='.']          - Command prefix
     * @param {string}   [options.sessionPath]         - WhatsApp session directory
     * @param {string}   [options.modulesPath]         - User modules directory
     * @param {string}   [options.systemPath]          - System modules directory
     * @param {string}   [options.configDir]           - Config directory
     * @param {boolean}  [options.respondToSelf=false] - Process own messages
     * @param {string[]} [options.allowedUsers=[]]     - Whitelist of JIDs; empty = allow all
     * @param {string[]} [options.blockedUsers=[]]     - Blacklist of JIDs
     * @param {number}   [options.cooldownMs]          - Per-user command cooldown in ms
     */
    constructor(options = {}) {
        this.options = options;

        this.prefix         = options.prefix       || '.';
        this.sessionPath    = options.sessionPath  || './session';
        this.modulesPath    = options.modulesPath  || './src/modules';
        this.systemPath     = options.systemPath   || './src/system';
        this.configDir      = options.configDir    || './config';
        this.respondToSelf  = options.respondToSelf ?? false;
        this.cooldownMs     = options.cooldownMs   ?? DEFAULT_COOLDOWN_MS;

        // Authorization sets (JID strings)
        this.allowedUsers = new Set(options.allowedUsers || []);
        this.blockedUsers = new Set(options.blockedUsers || []);

        // System modules — loaded from src/system/
        this.systemModules = new Map();
        // User modules — loaded from src/modules/
        this.userModules   = new Map();

        this.moduleLoader = new ModuleLoader(this, this.configDir);
        this.commands     = new Map();

        // { name, version, description, system } per every module
        this.moduleMeta          = new Map();
        // commandName -> description string
        this.commandDescriptions = new Map();

        // Middleware chain: Array<(msg, next) => Promise<void>>
        this.middlewares = [];

        // Per-user cooldown tracking: userId -> timestamp
        this._cooldowns = new Map();

        // Reconnect state
        this._reconnectAttempts = 0;
        this._stopping          = false;

        this.client = null;
        this._initClient();
    }

    // Client setup

    _initClient() {
        const puppeteerOptions = {
            headless:       process.env.HEADLESS !== 'false',
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
                                 puppeteer:    puppeteerOptions
        });

        // QR — require at top of file, not inside callback
        this.client.on('qr', (qr) => {
            log('info', 'QR Code received. Scan with WhatsApp:');
            QRCode.generate(qr, { small: true });
        });

        // Avoid registering two handlers for the same event;
        // message_create fires for both incoming and outgoing — filter in handler
        this.client.on('message_create', (msg)  => this._handleMessage(msg));

        this.client.on('incoming_call',  (call)   => log('info',  'Incoming call:', call));
        this.client.on('authenticated',  ()        => log('info',  'Authentication successful'));
        this.client.on('auth_failure',   (msg)     => log('error', 'Authentication failed:', msg));
        this.client.on('ready',          ()        => { this._reconnectAttempts = 0; log('info', 'Bot is ready'); });
        this.client.on('disconnected',   (reason)  => this._onDisconnected(reason));
        this.client.on('change_state',   (state)   => log('debug', 'State changed:', state));
        this.client.on('loading_screen', (p, m)    => log('info',  `Loading: ${p}% - ${m}`));
        this.client.on('failure',        (error)   => log('error', 'Client failure:', error?.message ?? error));
    }

    // Auto-reconnec

    async _onDisconnected(reason) {
        log('warn', 'Client disconnected:', reason);

        if (this._stopping) return;

        if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            log('error', `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
            return;
        }

        this._reconnectAttempts++;
        log('info', `Reconnect attempt ${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY_MS}ms…`);

        await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));

        try {
            await this.client.initialize();
        } catch (err) {
            log('error', 'Reconnect failed:', err.message);
        }
    }

    // Middleware

    /**
     * Register a middleware that runs before every command.
     * Call next() to continue the chain.
     * @param {(msg: object, next: () => Promise<void>) => Promise<void>} fn
     */
    use(fn) {
        if (typeof fn !== 'function') throw new TypeError('Middleware must be a function');
        this.middlewares.push(fn);
        return this;
    }

    async _runMiddlewares(msg, final) {
        let i = 0;
        const next = async () => {
            if (i < this.middlewares.length) {
                await this.middlewares[i++](msg, next);
            } else {
                await final();
            }
        };
        await next();
    }

    // Authorization & rate-limit

    _isAuthorized(userId) {
        if (this.blockedUsers.has(userId)) return false;
        if (this.allowedUsers.size > 0 && !this.allowedUsers.has(userId)) return false;
        return true;
    }

    _isOnCooldown(userId) {
        const last = this._cooldowns.get(userId) || 0;
        if (Date.now() - last < this.cooldownMs) return true;
        this._cooldowns.set(userId, Date.now());
        return false;
    }

    // Message handling

    async _handleMessage(msg) {
        // Ignore own messages unless opted in
        if (msg.fromMe && !this.respondToSelf) return;

        log('debug', `Message received: "${msg.body}" from ${msg.from}`);

        if (!msg.body || !msg.body.startsWith(this.prefix)) return;

        const userId = msg.from;

        if (!this._isAuthorized(userId)) {
            log('warn', `Unauthorized user: ${userId}`);
            return;
        }

        if (this._isOnCooldown(userId)) {
            log('debug', `Cooldown active for: ${userId}`);
            return;
        }

        const args        = msg.body.slice(this.prefix.length).trim().split(/\s+/);
        const commandName = args.shift().toLowerCase();

        log('debug', `Command: "${commandName}", args: [${args.join(', ')}]`);

        const command = this.commands.get(commandName);

        if (!command) {
            log('warn', `Command not found: ${commandName}`);
            return;
        }

        await this._runMiddlewares(msg, async () => {
            try {
                if (typeof command.execute === 'function') {
                    await command.execute(msg, args, this);
                } else {
                    await command(msg, args, this);
                }
                log('info', `Executed command: ${commandName}`);
            } catch (error) {
                log('error', `Command error [${commandName}]:`, error);
                try {
                    await msg.reply('An error occurred while executing the command.');
                } catch (replyError) {
                    log('error', 'Failed to send error reply:', replyError);
                }
            }
        });
    }

    // Lifecycle

    async start() {
        try {
            log('info', 'Starting bot…');
            await this.loadSystemModules();
            await this.loadModules();
            log('info', 'Initializing client…');
            await this.client.initialize();
            log('info', 'Client initialized successfully');
        } catch (error) {
            log('error', 'Failed to start bot:', error.message);
            throw error;
        }
    }

    async stop() {
        this._stopping = true;
        if (this.client) {
            await this.client.destroy();
            log('info', 'Bot stopped');
        }
    }

    // Module loading

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

    /**
     * Dynamically load a single module by file path.
     * @param {string} modulePath
     * @returns {{ name: string, module: object } | null}
     */
    async loadModule(modulePath) {
        const loaded = await this.moduleLoader.loadOne(modulePath);
        if (loaded) {
            this._registerModule(loaded.name, loaded.module, false);
            log('info', `Module loaded: ${loaded.name}`);
            return { name: loaded.name, module: loaded.module };
        }
        return null;
    }

    // Module registration

    /**
     * Module shape:
     *   module.name        {string}
     *   module.version     {string}
     *   module.description {string}
     *   module.commands    {object}  — { cmdName: fn | { execute, description } }
     *   module._cfg        {Config}  — attached by ModuleLoader automatically
     */
    _registerModule(name, module, isSystem = false) {
        const store = isSystem ? this.systemModules : this.userModules;
        store.set(name, module);

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
                } else if (typeof cmdHandler === 'function') {
                    this.commands.set(key, cmdHandler);
                } else {
                    log('warn', `Module "${name}": command "${cmdName}" is neither a function nor an object with execute(). Skipped.`);
                }
            }
        }
    }

    async unloadModule(moduleName) {
        const meta  = this.moduleMeta.get(moduleName);
        if (!meta) return false;

        const store  = meta.system ? this.systemModules : this.userModules;
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

    // Accessors

    getModule(name) {
        return this.systemModules.get(name) ?? this.userModules.get(name) ?? null;
    }

    getModuleMeta(name) {
        return this.moduleMeta.get(name) || null;
    }

    getCommand(name) {
        return this.commands.get(name.toLowerCase()) ?? null;
    }

    getCommandDescription(name) {
        return this.commandDescriptions.get(name.toLowerCase()) ?? null;
    }

    /**
     * Returns the Config instance for a module.
     * Useful inside commands: const cfg = bot.getCfg('settings')
     * @param {string} moduleName
     * @returns {Config|null}
     */
    getCfg(moduleName) {
        return this.getModule(moduleName)?._cfg ?? null;
    }
     }

     module.exports = Userbot;
