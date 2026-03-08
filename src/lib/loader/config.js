const fs   = require('fs');
const path = require('path');

/**
 * Per-module persistent config backed by a JSON file.
 *
 * Each module gets its own file: <configDir>/<moduleName>.json
 *
 * API:
 *   cfg.get(key, default?)   — read a value
 *   cfg.set(key, value)      — write a value and save
 *   cfg.delete(key)          — remove a key and save
 *   cfg.all()                — returns full config object (read-only copy)
 *   cfg.clear()              — wipe all keys and save
 */
class Config {
    /**
     * @param {string} moduleName  — used as filename
     * @param {string} configDir   — directory to store JSON files
     */
    constructor(moduleName, configDir) {
        this._file = path.join(configDir, `${moduleName}.json`);
        this._data = {};
        this._load();
    }

    get(key, defaultValue = undefined) {
        return key in this._data ? this._data[key] : defaultValue;
    }

    set(key, value) {
        this._data[key] = value;
        this._save();
        return this;
    }

    delete(key) {
        delete this._data[key];
        this._save();
        return this;
    }

    all() {
        return { ...this._data };
    }

    clear() {
        this._data = {};
        this._save();
        return this;
    }

    _load() {
        try {
            if (fs.existsSync(this._file)) {
                const raw = fs.readFileSync(this._file, 'utf8');
                this._data = JSON.parse(raw);
            }
        } catch (err) {
            console.error(`[Config] Failed to load ${this._file}:`, err.message);
            this._data = {};
        }
    }

    _save() {
        try {
            fs.mkdirSync(path.dirname(this._file), { recursive: true });
            fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2), 'utf8');
        } catch (err) {
            console.error(`[Config] Failed to save ${this._file}:`, err.message);
        }
    }
}

module.exports = Config;
