/**
 * Entry point for the React Native app.
 * Registers the root component with the platform's app registry.
 */
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
