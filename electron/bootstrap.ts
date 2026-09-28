import { app } from 'electron';
import path from 'path';

// Imported first by main.ts. Anything that resolves the userData folder at import time (the
// config store does) has to see this override, and ES imports run before main.ts's own code.
if (process.env.PULSECONVERT_USER_DATA) app.setPath('userData', path.resolve(process.env.PULSECONVERT_USER_DATA));
if (process.platform === 'win32') app.setAppUserModelId('dev.pulsesystems.convertdesktop');
