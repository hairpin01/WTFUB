const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * If a module with the same name is already loaded — unload it first.
 * Returns 'updated' | 'loaded'.
 */
async function upsertModule(bot, modulePath) {
    const loaded = await bot.loadModule(modulePath);
    if (!loaded) return null;

    const existing = bot.getModule(loaded.name);
    if (existing) {
        await bot.unloadModule(loaded.name);
        bot._registerModule(loaded.name, loaded.module, false);
        return { ...loaded, action: 'updated' };
    }

    return { ...loaded, action: 'loaded' };
}

module.exports = {
    name: 'loader',
    version: '1.0.0',
    description: 'Module manager — load, reload and unload modules at runtime',

    commands: {
        im: {
            description: 'Load a module from a replied message attachment',
            execute: async (msg, args, bot) => {
                const quoted = await msg.getQuotedMessage().catch(() => null);
                if (!quoted) {
                    return msg.reply('❌ Reply to a message with a .js file attached.');
                }

                if (!quoted.hasMedia) {
                    return msg.reply('❌ The replied message has no attachment.');
                }

                const media = await quoted.downloadMedia().catch(() => null);
                if (!media) {
                    return msg.reply('❌ Failed to download the attachment.');
                }

                // Accept only js files
                const filename = quoted.body || 'module.js';
                if (!filename.endsWith('.js') && media.mimetype !== 'application/javascript') {
                    return msg.reply('❌ Only .js files are supported.');
                }

                const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
                const tmpPath  = path.join(os.tmpdir(), `wa_module_${Date.now()}_${safeName}`);

                try {
                    fs.writeFileSync(tmpPath, Buffer.from(media.data, 'base64').toString('utf8'));
                    const result = await upsertModule(bot, tmpPath);

                    if (!result) {
                        fs.unlinkSync(tmpPath);
                        return msg.reply('❌ Failed to load module. Check the file for errors.');
                    }

                    // Copy to modules dir so it survives reloads
                    // (renameSync fails across different filesystems e.g. /tmp -> ./src)
                    const dest = path.join(bot.modulesPath, safeName);
                    fs.mkdirSync(bot.modulesPath, { recursive: true });
                    fs.copyFileSync(tmpPath, dest);
                    fs.unlinkSync(tmpPath);

                    const verb = result.action === 'updated' ? 'updated' : 'loaded';
                    return msg.reply(`✅ Module *${result.name || safeName}* ${verb}.`);
                } catch (err) {
                    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                    return msg.reply(`❌ Error: ${err.message}`);
                }
            }
        },

        dlm: {
            description: 'Load a module from a URL. Usage: .dlm <url>',
            execute: async (msg, args, bot) => {
                if (!args.length) {
                    return msg.reply('Usage: .dlm <url>');
                }

                const url = args[0];

                let rawUrl;
                try {
                    const parsed = new URL(url);
                    // Auto-convert GitHub blob URL to raw
                    if (parsed.hostname === 'github.com') {
                        rawUrl = url
                        .replace('github.com', 'raw.githubusercontent.com')
                        .replace('/blob/', '/');
                    } else {
                        rawUrl = url;
                    }
                } catch {
                    return msg.reply('❌ Invalid URL.');
                }

                await msg.reply(`⏳ Downloading...`);

                let code;
                try {
                    const res = await fetch(rawUrl);
                    if (!res.ok) return msg.reply(`❌ HTTP ${res.status}: ${res.statusText}`);
                    code = await res.text();
                } catch (err) {
                    return msg.reply(`❌ Download failed: ${err.message}`);
                }

                const filename = path.basename(new URL(rawUrl).pathname);
                const safeName = filename.endsWith('.js') ? filename : `${filename}.js`;
                const dest     = path.join(bot.modulesPath, safeName);

                try {
                    fs.writeFileSync(dest, code, 'utf8');
                    const result = await upsertModule(bot, dest);

                    if (!result) {
                        fs.unlinkSync(dest);
                        return msg.reply('❌ File downloaded but module failed to load. Check the code.');
                    }

                    const verb = result.action === 'updated' ? 'updated' : 'loaded';
                    return msg.reply(`✅ Module *${result.name || safeName}* ${verb} from URL.`);
                } catch (err) {
                    if (fs.existsSync(dest)) fs.unlinkSync(dest);
                    return msg.reply(`❌ Error: ${err.message}`);
                }
            }
        },

        reload: {
            description: 'Reload a module by name, or reload all user modules. Usage: .reload [module]',
            execute: async (msg, args, bot) => {
                // reload all
                if (!args.length) {
                    await msg.reply('⏳ Reloading all modules...');

                    // Unload all user modules
                    const names = [...bot.userModules.keys()];
                    for (const name of names) {
                        await bot.unloadModule(name);
                    }

                    // Re-load from disk
                    await bot.loadModules();

                    return msg.reply(`✅ Reloaded ${bot.userModules.size} module(s).`);
                }

                // reload one
                const moduleName = args[0].toLowerCase();
                const module     = bot.getModule(moduleName);

                if (!module) {
                    return msg.reply(`❌ Module *${moduleName}* not found.`);
                }

                const reloaded = await bot.moduleLoader.reloadModule(moduleName);
                if (!reloaded) {
                    return msg.reply(`❌ Failed to reload *${moduleName}*.`);
                }

                // Re-register with updated code
                await bot.unloadModule(moduleName);
                bot._registerModule(reloaded.name, reloaded.module, false);

                return msg.reply(`✅ Module *${moduleName}* reloaded.`);
            }
        },

        um: {
            description: 'Unload a module by name. Usage: .um <module>',
            execute: async (msg, args, bot) => {
                if (!args.length) {
                    return msg.reply('Usage: .um <module>');
                }

                const moduleName = args[0].toLowerCase();
                const meta       = bot.getModuleMeta(moduleName);

                if (!meta) {
                    return msg.reply(`❌ Module *${moduleName}* not found.`);
                }

                if (meta.system) {
                    return msg.reply(`❌ Cannot unload system module *${moduleName}*.`);
                }

                const ok = await bot.unloadModule(moduleName);
                if (!ok) {
                    return msg.reply(`❌ Failed to unload *${moduleName}*.`);
                }

                return msg.reply(`✅ Module *${moduleName}* unloaded.`);
            }
        }
    }
};
