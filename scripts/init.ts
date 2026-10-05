import { localPlatform, migrate } from '../local/platform';
const platform = await localPlatform();
try { await migrate(platform.env.DB); console.log('Local archive initialized.'); }
finally { await platform.dispose(); }
