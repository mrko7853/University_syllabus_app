import { cp, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

const routeAliases = {
  assignments: 'assignments.html',
  calendar: 'calendar.html',
  profile: 'profile.html',
  login: 'login.html',
  register: 'register.html',
  'native-tests': 'native-tests.html',
  courses: 'index.html',
  dashboard: 'index.html',
  settings: 'index.html',
  help: 'index.html',
  index: 'index.html',
};

async function createAliases() {
  for (const [route, sourceHtml] of Object.entries(routeAliases)) {
    const sourcePath = path.join(distDir, sourceHtml);
    const targetDir = path.join(distDir, route);
    const targetPath = path.join(targetDir, 'index.html');

    await mkdir(targetDir, { recursive: true });
    await cp(sourcePath, targetPath);
  }

  console.log('Created extensionless route aliases in dist/.');
}

createAliases().catch((error) => {
  console.error('Failed to create route aliases:', error);
  process.exit(1);
});
