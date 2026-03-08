const fs     = require('fs');
const path   = require('path');
const Config = require('./config');

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

class ModuleLoader {
    /**
     * @param {object} bot
     * @param {string} [configDir='./config']  — where per-module JSON files are stored
     */
    constructor(bot, configDir = './config') {
        this.bot       = bot;
        this.configDir = configDir;
    }

    async loadOne(modulePath) {
        try {
            const fullPath = path.isAbsolute(modulePath)
            ? modulePath
            : path.resolve(modulePath);

            const module = require(fullPath);

            let name = module.name;
            if (!name) {
                name = path.basename(modulePath, path.extname(modulePath));
            }

            const version     = module.version     || '1.0.0';
            const description = module.description || 'No description provided';

            // Give the module its own persistent config
            const cfg = new Config(name, this.configDir);

            if (module.init && typeof module.init === 'function') {
                await module.init(this.bot, cfg);
            }

            // Attach cfg to the module object so the bot can expose it later
            module._cfg = cfg;

            log('debug', `Module loaded: ${name} v${version} — ${description}`);
            return { name, version, description, module, path: fullPath };
        } catch (error) {
            log('error', `Failed to load module: ${modulePath}`, error.message);
            return null;
        }
    }

    async loadAll(modulesDir) {
        const modules = new Map();

        if (!fs.existsSync(modulesDir)) {
            log('warn', `Modules directory not found: ${modulesDir}`);
            return modules;
        }

        const files = fs.readdirSync(modulesDir);

        for (const file of files) {
            if (!file.endsWith('.js')) continue;

            const fullPath = path.join(modulesDir, file);
            const stat     = fs.statSync(fullPath);

            if (stat.isFile()) {
                const loaded = await this.loadOne(fullPath);
                if (loaded) {
                    modules.set(loaded.name, loaded.module);
                }
            }
        }

        return modules;
    }

    async reloadModule(moduleName) {
        const module = this.bot.getModule(moduleName);
        if (!module) {
            log('warn', `Module not found for reload: ${moduleName}`);
            return null;
        }

        const cached = require.cache[module.path];
        if (cached) {
            delete require.cache[module.path];
        }

        log('info', `Reloading module: ${moduleName}`);
        return await this.loadOne(module.path);
    }
}

module.exports = ModuleLoader;
