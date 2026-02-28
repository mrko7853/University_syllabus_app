import { cp, mkdir, writeFile } from 'fs/promises';
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
  home: 'index.html',
  courses: 'courses.html',
  course: 'course.html',
  dashboard: 'courses.html',
  settings: 'profile.html',
  help: 'profile.html',
  index: 'index.html',
};

const nestedRouteFallbacks = {
  course: '/dev/course/',
  courses: '/dev/courses/',
};

function buildHtaccessForNestedAlias(rewriteBase) {
  return [
    '<IfModule mod_rewrite.c>',
    'RewriteEngine On',
    `RewriteBase ${rewriteBase}`,
    'RewriteCond %{REQUEST_FILENAME} -f [OR]',
    'RewriteCond %{REQUEST_FILENAME} -d',
    'RewriteRule ^ - [L]',
    'RewriteRule ^ index.html [L]',
    '</IfModule>',
    '',
  ].join('\n');
}

async function createAliases() {
  for (const [route, sourceHtml] of Object.entries(routeAliases)) {
    const sourcePath = path.join(distDir, sourceHtml);
    const targetDir = path.join(distDir, route);
    const targetPath = path.join(targetDir, 'index.html');

    await mkdir(targetDir, { recursive: true });
    await cp(sourcePath, targetPath);

    if (nestedRouteFallbacks[route]) {
      const htaccessPath = path.join(targetDir, '.htaccess');
      await writeFile(htaccessPath, buildHtaccessForNestedAlias(nestedRouteFallbacks[route]), 'utf8');
    }
  }

  console.log('Created extensionless route aliases in dist/.');
}

createAliases().catch((error) => {
  console.error('Failed to create route aliases:', error);
  process.exit(1);
});
