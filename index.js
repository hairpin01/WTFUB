const Userbot = require('./src/core');

const bot = new Userbot({
    prefix: '.',
    sessionPath: './session',
    modulesPath: './src/modules'
});

bot.start().catch(console.error);

process.on('SIGINT', async () => {
    console.log('\n[Userbot] Shutting down...');
    await bot.stop();
    process.exit(0);
});
