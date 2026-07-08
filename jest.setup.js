// Polyfills / mocks for jest. React Native globals are injected by the
// react-native preset; we just need a few stubs that the smoke tests rely on.
global.WebSocket = require('ws');
global.fetch = require('node-fetch');
