import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startBot } from './src/bot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), bot: 'Viper#2531' });
});

app.listen(PORT, () => {
    console.log(`[Web] Server running on port ${PORT}`);
});

startBot().catch(err => {
    console.error('[Bot] Fatal error:', err);
    process.exit(1);
});
