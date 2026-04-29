import './style.css';
import { initTestPage } from './testPage.js';
import { initAppPage } from './appPage.js';

const app = document.querySelector('#app');
const isTestRoute =
  window.location.pathname === '/test' ||
  window.location.pathname.endsWith('/test') ||
  window.location.pathname.endsWith('/test/') ||
  window.location.hash === '#/test';

if (isTestRoute) {
  initTestPage(app);
} else {
  initAppPage(app);
}
