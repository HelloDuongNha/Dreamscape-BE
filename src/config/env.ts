import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Resolve .env path, falling back to a trailing-space name if it exists on disk
let envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath) && fs.existsSync(envPath + ' ')) {
  envPath = envPath + ' ';
}

dotenv.config({
  path: envPath,
});
